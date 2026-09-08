import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const port = Number(process.env.LAB_PORT || 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("LAB_PORT must be 1024–65535");
const python = resolve(
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
if (!existsSync(python))
  throw new Error(
    "Create .venv and install requirements-lab.txt first. See README.md.",
  );
if (!existsSync(".dev.vars"))
  writeFileSync(
    ".dev.vars",
    `LAB_WORKER_TOKEN=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600 },
  );
const children = [];
let stopping = false;
function start(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
const url = `http://127.0.0.1:${port}`;
// Fail explicitly instead of silently attaching a worker to a different project.
try {
  await fetch(url + "/api/lab/health", { signal: AbortSignal.timeout(700) });
  throw new Error(
    `Port ${port} is in use. Stop the existing lab or set LAB_PORT.`,
  );
} catch (error) {
  if (error.message?.startsWith("Port ")) throw error;
}
const frontendArgs = [
  "run",
  "dev",
  "--",
  "--port",
  String(port),
  "--strictPort",
];
if (process.platform === "win32") {
  start(process.env.ComSpec || "cmd.exe", [
    "/d", "/s", "/c", `npm.cmd ${frontendArgs.join(" ")}`,
  ]);
} else {
  start("npm", frontendArgs);
}
let ready = false;
for (let i = 0; i < 120 && !stopping; i++) {
  try {
    const response = await fetch(url + "/api/lab/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  console.error("Frontend did not become ready within 60 seconds.");
  stop(1);
} else {
  start(python, ["-m", "lab.worker", "--url", url]);
  console.log(`\nSoren policy lab: ${url}\n`);
}
