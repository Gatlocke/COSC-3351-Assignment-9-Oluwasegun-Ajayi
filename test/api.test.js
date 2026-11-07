import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { createPool } from "../db/pool.js";
import { startServer } from "../scripts/server-harness.js";

async function api(t) {
  const pool = createPool();
  const owned = [];
  const logs = [];
  const server = createApp({ pool, logger: (line) => logs.push(line) })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    try {
      // Only remove rows this test created. Never truncate an existing collection.
      if (owned.length) await pool.query("DELETE FROM assignment9.items WHERE id = ANY($1::int[])", [owned]);
    } finally {
      await pool.end();
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path = "/api/items", method = "GET", body) {
    const options = { method };
    if (body !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${base}${path}`, options);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const data = await response.json();
    if (method === "POST" && response.status === 201) owned.push(data.id);
    return { status: response.status, body: data, response };
  }
  return { pool, request, base, logs };
}

test("GET collection matches rows read directly from PostgreSQL", async (t) => {
  const { request, pool } = await api(t);
  const { rows } = await pool.query("SELECT id, title, completed FROM assignment9.items ORDER BY id");
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, rows);
});

test("POST returns 201, a database-generated unique integer ID, and the inserted row", async (t) => {
  const { request, pool } = await api(t);
  const created = await request("/api/items", "POST", { title: "  Read SQL notes  " });
  const second = await request("/api/items", "POST", { title: "Practice", completed: true });
  assert.equal(created.status, 201);
  assert.equal(second.status, 201);
  assert.ok(Number.isInteger(created.body.id) && created.body.id > 0);
  assert.notEqual(created.body.id, second.body.id);
  assert.equal(created.body.title, "Read SQL notes");
  assert.equal(created.body.completed, false);
  assert.equal(created.response.headers.get("location"), `/api/items/${created.body.id}`);
  const { rows } = await pool.query(
    "SELECT id, title, completed FROM assignment9.items WHERE id = $1", [created.body.id],
  );
  assert.deepEqual(rows[0], created.body);
});

test("GET one reads current database state, including external SQL changes", async (t) => {
  const { request, pool } = await api(t);
  const { body } = await request("/api/items", "POST", { title: "Before" });
  await pool.query("UPDATE assignment9.items SET title = $1 WHERE id = $2", ["Changed directly in SQL", body.id]);
  const result = await request(`/api/items/${body.id}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.title, "Changed directly in SQL");
});

test("PUT persists full and partial updates, preserves ID, and accepts false", async (t) => {
  const { request, pool } = await api(t);
  const { body } = await request("/api/items", "POST", { title: "Before" });
  const path = `/api/items/${body.id}`;
  const updated = await request(path, "PUT", { title: "  After  ", completed: true });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, { id: body.id, title: "After", completed: true });
  const partial = await request(path, "PUT", { completed: false });
  assert.deepEqual(partial.body, { id: body.id, title: "After", completed: false });
  const { rows } = await pool.query("SELECT id, title, completed FROM assignment9.items WHERE id = $1", [body.id]);
  assert.deepEqual(rows[0], partial.body);
});

test("DELETE removes the database row and repeated operations return 404", async (t) => {
  const { request, pool } = await api(t);
  const { body } = await request("/api/items", "POST", { title: "Delete me" });
  const path = `/api/items/${body.id}`;
  const deleted = await request(path, "DELETE");
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { message: "Item deleted.", item: body });
  assert.equal((await pool.query("SELECT id FROM assignment9.items WHERE id = $1", [body.id])).rowCount, 0);
  for (const method of ["GET", "PUT", "DELETE"]) {
    const result = await request(path, method, method === "PUT" ? { title: "Missing" } : undefined);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "Item not found." });
  }
});

test("POST rejects invalid fields, blank titles, null characters, types, and supplied IDs", async (t) => {
  const { request } = await api(t);
  for (const body of [
    {}, null, [], { title: "" }, { title: "   " }, { title: 3 },
    { title: "x".repeat(121) }, { title: "Bad\0title" },
    { title: "Read", completed: "true" }, { title: "Read", id: 1 },
    { title: "Read", unsupported: true },
  ]) {
    const result = await request("/api/items", "POST", body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof result.body.error, "string");
  }
});

test("Rejected PUT requests cannot change the ID or partially update a row", async (t) => {
  const { request } = await api(t);
  const { body: original } = await request("/api/items", "POST", { title: "Original" });
  const path = `/api/items/${original.id}`;
  for (const body of [{}, null, [], { title: "" }, { completed: null },
    { title: "No", id: 500 }, { title: "No", unsupported: true }]) {
    assert.equal((await request(path, "PUT", body)).status, 400);
    assert.deepEqual((await request(path)).body, original);
  }
});

test("SQL-looking titles are stored as data, not executed", async (t) => {
  const { request } = await api(t);
  const title = "Study'); DROP TABLE assignment9.items; --";
  const created = await request("/api/items", "POST", { title });
  assert.equal(created.status, 201);
  assert.equal((await request(`/api/items/${created.body.id}`)).body.title, title);
  assert.equal((await request()).status, 200);
});

test("Invalid database identifiers return 400 instead of querying a malformed ID", async (t) => {
  const { request } = await api(t);
  for (const id of ["abc", "0", "-1", "01", "2147483648", "1%20OR%201=1"]) {
    assert.equal((await request(`/api/items/${id}`)).status, 400, id);
  }
});

test("Malformed JSON, missing body, wrong media type, and oversized JSON are handled", async (t) => {
  const { request, base } = await api(t);
  const malformed = await fetch(`${base}/api/items`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"title":',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Invalid JSON body." });
  assert.equal((await request("/api/items", "POST")).status, 400);
  const plain = await fetch(`${base}/api/items`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "not JSON",
  });
  assert.equal(plain.status, 400);
  await plain.json();
  assert.equal((await request("/api/items", "POST", { title: "x".repeat(17000) })).status, 413);
  assert.equal((await request()).status, 200);
});

test("Request logging includes valid requests, unknown routes, and parser failures", async (t) => {
  const { request, base, logs } = await api(t);
  await request();
  assert.equal((await request("/missing-endpoint")).status, 404);
  const bad = await fetch(`${base}/api/items`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  await bad.json();
  assert.equal(logs.length, 3);
  assert.match(logs[0], /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] GET \/api\/items$/);
  assert.match(logs[1], /GET \/missing-endpoint$/);
  assert.match(logs[2], /POST \/api\/items$/);
});

test("Database failure returns sanitized 503, never a fake successful response", async (t) => {
  const logs = [];
  const failingPool = { async query() { throw new Error("Internal database details"); } };
  const server = createApp({ pool: failingPool, logger: () => {}, errorLogger: (line) => logs.push(line) })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/items`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Database unavailable. Try again later." });
  assert.deepEqual(logs, ["Database operation failed."]);
});

test("Missing database configuration fails explicitly", () => {
  assert.throws(() => createPool(""), /DATABASE_URL is required/);
});

test("An occupied port exits clearly without dereferencing a null server address", async (t) => {
  const occupied = createServer().listen(0, "0.0.0.0");
  await once(occupied, "listening");
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  await assert.rejects(
    promisify(execFile)(process.execPath, ["--env-file-if-exists=.env", "server.js"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, PORT: String(occupied.address().port) },
      timeout: 10000,
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /already in use \(EADDRINUSE\)/);
      assert.doesNotMatch(error.stderr, /TypeError|Cannot read properties of null/);
      assert.doesNotMatch(error.stdout, /API listening on/);
      return true;
    },
  );
});

test("Creation and deletion both persist across actual API process restarts", async (t) => {
  let current = await startServer();
  let id;
  const pool = createPool();
  t.after(async () => {
    await current.stop();
    try {
      if (id) await pool.query("DELETE FROM assignment9.items WHERE id = $1", [id]);
    } finally { await pool.end(); }
  });
  const created = await fetch(`${current.url}/api/items`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Must survive restart" }),
  });
  assert.equal(created.status, 201);
  const item = await created.json();
  id = item.id;
  const port = current.port;
  await current.stop();
  current = await startServer(port);
  const retained = await fetch(`${current.url}/api/items/${id}`);
  assert.equal(retained.status, 200);
  assert.deepEqual(await retained.json(), item);
  const deleted = await fetch(`${current.url}/api/items/${id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  await deleted.json();
  await current.stop();
  current = await startServer(port);
  const missing = await fetch(`${current.url}/api/items/${id}`);
  assert.equal(missing.status, 404);
  await missing.json();
});
