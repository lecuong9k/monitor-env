import { config } from "../config.js";
import {
  countPathReaders,
  getPathStats,
  sweepUnmanagedMtxPaths,
} from "./mediamtx.service.js";
import {
  getLifecycleTargets,
  getManagedMtxPathNames,
  stopQualityStream,
  cleanupOrphanQualityStream,
  stopOrphanCentralRelay,
  maintainViewerSessions,
  expireGhostViewersNoReaders,
} from "./stream.service.js";

/** @type {ReturnType<typeof setInterval> | null} */
let poller = null;
let pollCount = 0;

/**
 * @param {{ cameraId: number, qualityId: string, state: import('./stream.service.js').QualityStreamState, mtxPathName: string | null }} target
 */
async function evaluateTarget(target) {
  const { cameraId, qualityId, state, mtxPathName } = target;

  await maintainViewerSessions(cameraId, qualityId, state, mtxPathName);

  const hasViewers = state.localViewers.size + state.remoteViewers.size > 0;

  if (hasViewers) {
    if (mtxPathName) {
      let localReaders = 0;
      let centralReaders = 0;
      try {
        const localStats = await getPathStats("local", mtxPathName);
        localReaders = countPathReaders(localStats);
        if (state.centralRelayActive || state.remoteViewers.size > 0) {
          const centralStats = await getPathStats("central", mtxPathName);
          centralReaders = countPathReaders(centralStats);
        }
      } catch (err) {
        console.warn(
          `[stream-lifecycle] Không đọc được reader stats path ${mtxPathName}:`,
          err instanceof Error ? err.message : err,
        );
        state.readerGhostSince = null;
        state.idleSince = null;
        state.centralIdleSince = null;
        return;
      }

      const warmingRemoteRelay =
        state.remoteViewers.size > 0 &&
        !state.centralRelayActive &&
        (state.startingPromise != null || state.primaryActive);

      const activeReaders =
        (state.localViewers.size > 0 ? localReaders : 0) +
        (state.remoteViewers.size > 0 && state.centralRelayActive
          ? centralReaders
          : 0);

      if (activeReaders > 0 || warmingRemoteRelay) {
        state.readerGhostSince = null;
        state.idleSince = null;
        state.centralIdleSince = null;
        return;
      }

      const ghostMs = config.streamReaderGhostMs;
      if (ghostMs > 0) {
        const now = Date.now();
        if (state.readerGhostSince == null) {
          state.readerGhostSince = now;
          return;
        }
        if (now - state.readerGhostSince >= ghostMs) {
          console.log(
            `[stream-lifecycle] Reader ghost expire camera ${cameraId} quality ${qualityId}`,
          );
          await expireGhostViewersNoReaders(
            cameraId,
            qualityId,
            state,
            mtxPathName,
          );
          return;
        }
        return;
      }
    }

    state.idleSince = null;
    state.centralIdleSince = null;
    return;
  }

  state.readerGhostSince = null;

  if (mtxPathName && (state.primaryActive || state.centralRelayActive)) {
    let localReaders = 0;
    let centralReaders = 0;
    try {
      const localStats = await getPathStats("local", mtxPathName);
      localReaders = countPathReaders(localStats);
      if (state.centralRelayActive) {
        const centralStats = await getPathStats("central", mtxPathName);
        centralReaders = countPathReaders(centralStats);
      }
    } catch (err) {
      console.warn(
        `[stream-lifecycle] Không đọc được reader stats path ${mtxPathName}:`,
        err instanceof Error ? err.message : err,
      );
    }

    if (localReaders > 0 || centralReaders > 0) {
      state.idleSince = null;
      state.centralIdleSince = null;
      return;
    }
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
      await stopOrphanCentralRelay(cameraId, qualityId);
    }
  }
}

async function pollOnce() {
  pollCount += 1;

  const sweepEvery = config.streamMtxSweepEveryPolls;
  if (sweepEvery > 0 && pollCount % sweepEvery === 0) {
    try {
      const result = await sweepUnmanagedMtxPaths(getManagedMtxPathNames());
      if (result.cleared > 0) {
        console.log(
          `[stream-lifecycle] MTX sweep cleared ${result.cleared} path(s)`,
        );
      }
    } catch (err) {
      console.warn(
        "[stream-lifecycle] MTX sweep error:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const targets = getLifecycleTargets();
  for (const target of targets) {
    await evaluateTarget(target);
  }
}

export function startStreamLifecyclePoller() {
  if (poller) return;

  pollCount = 0;
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
    `[stream-lifecycle] Poller started (poll=${intervalMs}ms, localIdle=${config.streamIdleStopMs}ms, centralRelayIdle=${config.centralRelayIdleStopMs}ms, readerGhost=${config.streamReaderGhostMs}ms)`,
  );
}

export function stopStreamLifecyclePoller() {
  if (!poller) return;
  clearInterval(poller);
  poller = null;
  pollCount = 0;
}
