import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import "dotenv/config";

const development = process.argv.includes("--dev");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children: ChildProcess[] = [];
let shuttingDown = false;

function start(label: string, script: string): ChildProcess {
  console.log(`[launcher] Starting ${label} with npm run ${script}...`);
  const child = spawn(npmCommand, ["run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`[launcher] ${label} could not start`, error);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[launcher] ${label} stopped unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"}).`
    );
    void shutdown(code && code > 0 ? code : 1);
  });
  return child;
}

async function waitForReviewService(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8000/health", {
        signal: AbortSignal.timeout(1_500)
      });
      if (response.ok) {
        const health = (await response.json()) as {
          ok?: boolean;
          aiEnabled?: boolean;
        };
        console.log(
          `[launcher] Review service ready (AI ${health.aiEnabled ? "enabled" : "disabled"}).`
        );
        return;
      }
    } catch {
      // The Python environment may take a few seconds to initialize.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Review service did not become healthy within 30 seconds. Check uv/Python and OPENAI settings."
  );
}

async function reviewServiceIsReady(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:8000/health", {
      signal: AbortSignal.timeout(1_500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function publicApiIsAlreadyRunning(): Promise<boolean> {
  if (process.env.PUBLIC_API_ENABLED !== "true") return false;
  const port = process.env.PORT ?? process.env.PUBLIC_API_PORT ?? "8787";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) return false;
    const health = (await response.json()) as { service?: string };
    return health.service === "spoonos-community-api";
  } catch {
    return false;
  }
}

function stopChild(child: ChildProcess): void {
  if (!child.pid || child.exitCode != null) return;
  child.kill("SIGTERM");
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopChild(child);
  setTimeout(() => process.exit(exitCode), 750);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

try {
  if (await reviewServiceIsReady()) {
    console.log(
      "[launcher] An AI review service is already running; reusing it."
    );
  } else {
    start("AI review service", development ? "dev:review" : "start:review");
  }
  await waitForReviewService();
  if (await publicApiIsAlreadyRunning()) {
    throw new Error(
      "A SpoonOS Bot/Public API instance is already using the configured port. Stop the previous npm run dev process before starting another one."
    );
  }
  start("Discord Bot", development ? "dev:bot" : "start:bot");
} catch (error) {
  console.error("[launcher] Startup failed", error);
  await shutdown(1);
}
