import os from "os";

export function collectSystemStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSec: Math.round(os.uptime()),
    loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100),
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: totalMem ? Math.round((usedMem / totalMem) * 100) : 0,
    },
    cpus: os.cpus().length,
    at: new Date().toISOString(),
  };
}
