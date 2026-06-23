import { config } from "../config.js";
import { countPathReaders, getPathStats } from "./mediamtx.service.js";
import {
  getLifecycleTargets,
  stopQualityStream,
  cleanupOrphanQualityStream,
} from "./stream.service.js";

/** @type {ReturnType<typeof setInterval> | null} */
let poller = null;

/**
 * @param {{ cameraId: number, qualityId: string, state: import('./stream.service.js').QualityStreamState, mtxPathName: string | null }} target
 */
async function evaluateTarget(target) {
  const { cameraId, qualityId, state, mtxPathName } = target;

  if (state.localViewerCount > 0 || state.remoteViewerCount > 0) {
    state.idleSince = null;
    state.centralIdleSince = null;
    return;
  }

  const orphanResult = await cleanupOrphanQualityStream(cameraId, qualityId);
  if (orphanResult.cleaned) return;

  // Local ingest idle backup
  if (state.localMtxActive && mtxPathName) {
    const idleStopMs = config.streamIdleStopMs;
    if (idleStopMs > 0) {
      let readerCount = 0;
      try {
        const stats = await getPathStats("local", mtxPathName);
        readerCount = countPathReaders(stats);
      } catch (err) {
        console.warn(
          `[stream-lifecycle] Không đọc được local stats path ${mtxPathName}:`,
          err instanceof Error ? err.message : err,
        );
        state.idleSince = null;
      }

      if (readerCount > 0) {
        state.idleSince = null;
      } else {
        const now = Date.now();
        if (state.idleSince == null) {
          state.idleSince = now;
        } else if (now - state.idleSince >= idleStopMs) {
          console.log(
            `[stream-lifecycle] Local idle stop camera ${cameraId} quality ${qualityId}`,
          );
          state.idleSince = null;
          await stopQualityStream(cameraId, qualityId, { scope: "local" });
          await stopQualityStream(cameraId, qualityId, { scope: "remote" });
          return;
        }
      }
    }
  }

  // Central relay safety net (remote viewer count = 0)
  if (state.centralRelayActive && mtxPathName) {
    const relayIdleMs = config.centralRelayIdleStopMs;
    if (relayIdleMs <= 0) return;

    let readerCount = 0;
    try {
      const stats = await getPathStats("central", mtxPathName);
      readerCount = countPathReaders(stats);
    } catch (err) {
      console.warn(
        `[stream-lifecycle] Không đọc được central stats path ${mtxPathName}:`,
        err instanceof Error ? err.message : err,
      );
      state.centralIdleSince = null;
      return;
    }

    if (readerCount > 0) {
      state.centralIdleSince = null;
      return;
    }

    const now = Date.now();
    if (state.centralIdleSince == null) {
      state.centralIdleSince = now;
      return;
    }

    if (now - state.centralIdleSince >= relayIdleMs) {
      console.log(
        `[stream-lifecycle] Central relay idle stop camera ${cameraId} quality ${qualityId}`,
      );
      state.centralIdleSince = null;
      await stopQualityStream(cameraId, qualityId, { scope: "remote" });
    }
  }
}

async function pollOnce() {
  const targets = getLifecycleTargets();
  for (const target of targets) {
    await evaluateTarget(target);
  }
}

export function startStreamLifecyclePoller() {
  if (poller) return;

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
    `[stream-lifecycle] Poller started (poll=${intervalMs}ms, localIdle=${config.streamIdleStopMs}ms, centralRelayIdle=${config.centralRelayIdleStopMs}ms)`,
  );
}

export function stopStreamLifecyclePoller() {
  if (!poller) return;
  clearInterval(poller);
  poller = null;
}
