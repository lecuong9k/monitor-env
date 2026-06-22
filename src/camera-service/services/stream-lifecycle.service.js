import { config } from "../config.js";
import { countPathReaders, getPathStats } from "./mediamtx.service.js";
import {
  countLocalMpegtsClients,
  getLifecycleTargets,
  stopQualityStream,
} from "./stream.service.js";

/** @type {ReturnType<typeof setInterval> | null} */
let poller = null;

/**
 * @param {{ cameraId: number, qualityId: string, state: import('./stream.service.js').QualityStreamState, mtxPathName: string | null }} target
 */
async function evaluateTarget(target) {
  const { cameraId, qualityId, state, mtxPathName } = target;
  const idleStopMs = config.streamIdleStopMs;
  if (idleStopMs <= 0) {
    state.idleSince = null;
    return;
  }

  let readerCount = 0;

  if (state.localFallback) {
    readerCount = countLocalMpegtsClients(state);
  } else if (mtxPathName) {
    try {
      const stats = await getPathStats(mtxPathName);
      readerCount = countPathReaders(stats);
    } catch (err) {
      console.warn(
        `[stream-lifecycle] Không đọc được stats path ${mtxPathName}:`,
        err instanceof Error ? err.message : err,
      );
      state.idleSince = null;
      return;
    }
  }

  if (readerCount > 0) {
    state.idleSince = null;
    return;
  }

  const now = Date.now();
  if (state.idleSince == null) {
    state.idleSince = now;
    return;
  }

  if (now - state.idleSince >= idleStopMs) {
    console.log(
      `[stream-lifecycle] Idle stop camera ${cameraId} quality ${qualityId} (${idleStopMs}ms)`,
    );
    state.idleSince = null;
    await stopQualityStream(cameraId, qualityId);
  }
}

async function pollOnce() {
  const targets = getLifecycleTargets();
  for (const target of targets) {
    await evaluateTarget(target);
  }
}

export function startStreamLifecyclePoller() {
  if (poller || config.streamIdleStopMs <= 0) return;

  const intervalMs = Math.max(config.streamIdlePollMs, 15_000);
  poller = setInterval(() => {
    void pollOnce().catch((err) => {
      console.warn(
        "[stream-lifecycle] Poll error:",
        err instanceof Error ? err.message : err,
      );
    });
  }, intervalMs);

  if (typeof poller.unref === "function") {
    poller.unref();
  }

  console.log(
    `[stream-lifecycle] Poller started (poll=${intervalMs}ms, idle=${config.streamIdleStopMs}ms)`,
  );
}

export function stopStreamLifecyclePoller() {
  if (!poller) return;
  clearInterval(poller);
  poller = null;
}
