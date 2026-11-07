import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createPool } from "../db/pool.js";
import { startServer } from "./server-harness.js";

// This report records actual HTTP/SQL results, not screenshots from another client.
const entries = [];
const logs = [];
const owned = [];
let server;
const pool = createPool();

async function request(title, path, expected, { method = "GET", body, raw } = {}) {
  const options = { method };
  if (body !== undefined || raw !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = raw ?? JSON.stringify(body);
  }
  const url = `${server.url}${path}`;
  const response = await fetch(url, options);
  const data = await response.json();
  if (method === "POST" && response.status === 201) owned.push(data.id);
  assert.equal(response.status, expected, title);
  entries.push({
    title,
    request: `${method} ${url}\n${options.body !== undefined ? "Content-Type: application/json\n\n" + options.body : ""}`.trim(),
    response: `HTTP ${response.status} ${response.statusText}\nContent-Type: ${response.headers.get("content-type")}\n${response.headers.has("location") ? "Location: " + response.headers.get("location") + "\n" : ""}\n${JSON.stringify(data, null, 2)}`,
  });
  console.log(`PASS ${response.status} ${title}`);
  return data;
}

try {
  server = await startServer();
  const port = server.port;
  const created = await request("POST creates a database row", "/api/items", 201, {
    method: "POST", body: { title: "Review database-backed endpoints", completed: false },
  });
  assert.ok(Number.isInteger(created.id));
  const path = `/api/items/${created.id}`;
  const all = await request("GET collection includes the saved row", "/api/items", 200);
  assert.ok(all.some((item) => item.id === created.id));
  assert.deepEqual(await request("GET finds the database-generated ID", path, 200), created);
  const updated = await request("PUT updates the row without changing its ID", path, 200, {
    method: "PUT", body: { title: "Finish database-backed endpoints", completed: true },
  });
  assert.deepEqual(updated, { id: created.id, title: "Finish database-backed endpoints", completed: true });
  const { rows } = await pool.query(
    "SELECT id, title, completed FROM assignment9.items WHERE id = $1", [created.id],
  );
  assert.deepEqual(rows[0], updated);
  entries.push({
    title: "Independent SQL read confirms the updated row",
    request: `SELECT id, title, completed FROM assignment9.items WHERE id = $1\nBound parameter: ${created.id}`,
    response: JSON.stringify(rows, null, 2),
  });
  await server.stop();
  logs.push(server.output);
  entries.push({ title: "Actual process restart", note: "Stopped server.js and started a new Node process using the same database. No schema setup or reinsertion was performed." });
  server = await startServer(port);
  assert.deepEqual(await request("GET after restart returns the same saved values", path, 200), updated);
  await request("Blank title is rejected", "/api/items", 400, { method: "POST", body: { title: "   " } });
  await request("Malformed JSON is rejected", "/api/items", 400, { method: "POST", raw: '{"title":' });
  await request("ID replacement is rejected", path, 400, { method: "PUT", body: { id: 42, title: "Do not save" } });
  assert.deepEqual(await request("Rejected update left the saved row unchanged", path, 200), updated);
  const deleted = await request("DELETE removes the row", path, 200, { method: "DELETE" });
  assert.equal(deleted.item.id, created.id);
  assert.equal((await pool.query("SELECT id FROM assignment9.items WHERE id = $1", [created.id])).rowCount, 0);
  for (const method of ["GET", "PUT", "DELETE"]) {
    await request(`${method} deleted ID returns 404`, path, 404,
      method === "PUT" ? { method, body: { title: "Missing" } } : { method });
  }
  await server.stop();
  logs.push(server.output);
  entries.push({ title: "Second actual process restart", note: "Restarted the API again without changing PostgreSQL, to check that the deletion is permanent." });
  server = await startServer(port);
  await request("Deleted row remains absent after restart", path, 404);
  const remaining = await request("Final collection does not contain the deleted item", "/api/items", 200);
  assert.ok(!remaining.some((item) => item.id === created.id));
  await server.stop();
  logs.push(server.output);
  const count = entries.filter((entry) => entry.request?.match(/^(GET|POST|PUT|DELETE) /)).length;
  const report = `# Assignment 9 — Testing Evidence

Captured: ${new Date().toISOString()} (UTC)  
Runtime: Node ${process.version}  
Database: PostgreSQL, table \`assignment9.items\`  
Result: **${count} actual HTTP checks passed**, plus an independent SQL check and two actual process restarts.

## Evidence method

These results were captured by \`npm run evidence\`, using Node's HTTP client
against a real Express server and PostgreSQL database. No connection
credentials are included.

\`requests.http\` contains the corresponding requests for VS Code REST Client.
The completed client response captures are documented separately from this
automated run in the supporting evidence below. Each test run generates its
own IDs, so the automated transcript may use different IDs from the manual
captures.

## Supporting evidence

- [REST Client response evidence](evidence/CLIENT-RESULTS.md): all eight
  verified response screenshots, including persistence after restart.
- [Mac automated test results](evidence/MAC-TESTS.md): 15 tests passed,
  zero failures, and the evidence-generation confirmation screenshots.
- [Local Mac setup verification](evidence/SETUP.md): installation, database
  setup, startup output, and the Terminal restart capture.

These supporting files and any screenshot images in \`evidence/\` are
preserved when \`npm run evidence\` regenerates this report.

## Endpoint summary

| Operation | Route | Observed status |
| --- | --- | --- |
| Retrieve collection | GET /api/items | 200 |
| Retrieve saved item | GET /api/items/:id | 200 |
| Insert item | POST /api/items | 201 |
| Update item | PUT /api/items/:id | 200 |
| Delete item | DELETE /api/items/:id | 200 |
| Target missing item | GET/PUT/DELETE /api/items/:id | 404 |
| Reject invalid input | POST /api/items or PUT /api/items/:id | 400 |

IDs and ports below are actual values from this run and will differ on a
new run. Tests only delete records they create; pre-existing data is not
cleared. For setup, see README.md. To repeat: \`npm test\` and \`npm run evidence\`.

${entries.map((entry, i) => `## ${i + 1}. ${entry.title}\n\n${entry.note ?? `Request/query executed:\n\n\`\`\`text\n${entry.request}\n\`\`\`\n\nObserved response:\n\n\`\`\`text\n${entry.response}\n\`\`\``}\n`).join("\n")}
## Captured server logs

\`\`\`text
${logs.join("\n--- new API process ---\n").trim()}
\`\`\`
`;
  await writeFile(new URL("../TESTING.md", import.meta.url), report);
  console.log(`Wrote TESTING.md with ${count} successful HTTP checks.`);
} catch (error) {
  console.error(`Evidence generation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await server?.stop();
  try {
    if (owned.length) await pool.query("DELETE FROM assignment9.items WHERE id = ANY($1::int[])", [owned]);
  } finally { await pool.end(); }
}
