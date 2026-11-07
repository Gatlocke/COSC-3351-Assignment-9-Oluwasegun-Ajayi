import express from "express";
import { validateItem } from "./validation.js";

export function createApp({ pool, logger = console.log, errorLogger = console.error }) {
  if (!pool || typeof pool.query !== "function") throw new Error("A PostgreSQL pool is required.");
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    logger(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  app.param("id", (req, res, next, id) => {
    if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) {
      return res.status(400).json({ error: "id must be a positive PostgreSQL integer." });
    }
    req.itemId = Number(id);
    next();
  });

  // Every operation reads or writes PostgreSQL; no in-memory collection or fallback.
  app.get("/api/items", async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, title, completed FROM assignment9.items ORDER BY id",
    );
    res.json(rows);
  });

  app.get("/api/items/:id", async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, title, completed FROM assignment9.items WHERE id = $1",
      [req.itemId],
    );
    if (!rows.length) return res.status(404).json({ error: "Item not found." });
    res.json(rows[0]);
  });

  app.post("/api/items", async (req, res) => {
    const error = validateItem(req.body);
    if (error) return res.status(400).json({ error });
    const { rows } = await pool.query(
      `INSERT INTO assignment9.items (title, completed)
       VALUES ($1, $2) RETURNING id, title, completed`,
      [req.body.title.trim(), req.body.completed ?? false],
    );
    res.status(201).location(`/api/items/${rows[0].id}`).json(rows[0]);
  });

  app.put("/api/items/:id", async (req, res) => {
    const error = validateItem(req.body, true);
    if (error) return res.status(400).json({ error });
    // Validation prohibits null; SQL NULL here means "keep the existing value."
    // COALESCE correctly preserves explicit false rather than treating it as absent.
    const { rows } = await pool.query(
      `UPDATE assignment9.items
       SET title = COALESCE($2, title), completed = COALESCE($3, completed)
       WHERE id = $1 RETURNING id, title, completed`,
      [req.itemId, req.body.title?.trim() ?? null, req.body.completed ?? null],
    );
    if (!rows.length) return res.status(404).json({ error: "Item not found." });
    res.json(rows[0]);
  });

  app.delete("/api/items/:id", async (req, res) => {
    const { rows } = await pool.query(
      "DELETE FROM assignment9.items WHERE id = $1 RETURNING id, title, completed",
      [req.itemId],
    );
    if (!rows.length) return res.status(404).json({ error: "Item not found." });
    res.json({ message: "Item deleted.", item: rows[0] });
  });

  app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));

  // Express 5 forwards rejected async route promises to this error middleware.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON body." });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "JSON body exceeds the 16 KB limit." });
    }
    if (error instanceof URIError) {
      return res.status(400).json({ error: "Invalid URL encoding." });
    }
    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: "Invalid or unsupported request body." });
    }
    errorLogger("Database operation failed.");
    res.status(503).json({ error: "Database unavailable. Try again later." });
  });
  return app;
}
