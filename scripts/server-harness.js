import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

export async function startServer(port = 0) {
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", "server.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  let ready = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const actualPort = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("API startup timed out."));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/listening on http:\/\/localhost:(\d+)/);
      if (!ready && match) {
        ready = true;
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not start Node server process."));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (!ready) reject(new Error(`Server exited (${code}). ${errors}`));
    });
  });
  return {
    url: `http://localhost:${actualPort}`,
    port: actualPort,
    get output() { return output; },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    },
  };
}
