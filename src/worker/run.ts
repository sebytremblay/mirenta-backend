import { setTimeout as sleep } from "node:timers/promises";

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
      log("tick error", { error: (err as Error).message });
    }
    await sleep(config.worker.pollIntervalMs);
  }
  log("worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("shutdown signal received", { signal });
    running = false;
  });
}

await loop();
