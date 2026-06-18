// Standalone worker process (D46). Runs the tick on a fixed interval until
// signaled. The worker is a pure function over the jobs table behind this thin
// scheduler, so a Supabase scheduled function or pg_cron host can replace this
// loop later (D32 stays open) without touching the stage logic.

import { config } from "../config/env.ts";
import { runTick, type TickLogger } from "./tick.ts";

const log: TickLogger = (msg, meta) => {
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  console.log(`[worker] ${line}`);
};

let running = true;

async function loop(): Promise<void> {
  log("worker started", {
    pollIntervalMs: config.worker.pollIntervalMs,
    claimBatchSize: config.worker.claimBatchSize,
    maxAttempts: config.worker.maxJobAttempts,
  });

  while (running) {
    try {
      const result = await runTick(log);
      if (result.claimed > 0) {
        log("tick", {
          claimed: result.claimed,
          advanced: result.advanced,
          failed: result.failed,
        });
      }
    } catch (err) {
      // A tick-level failure (e.g. the claim query) should not kill the loop.
      log("tick error", { error: (err as Error).message });
    }
    await sleep(config.worker.pollIntervalMs);
  }
  log("worker stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("shutdown signal received", { signal });
    running = false;
  });
}

await loop();
