import os from 'os';
import { execSync } from 'child_process';
import mongoose from 'mongoose';

export const errorLog = [];
const MAX_ERRORS = 200;

export function logError(message, stack = null, context = '') {
  if (errorLog.length >= MAX_ERRORS) errorLog.shift();
  errorLog.push({
    message: String(message).slice(0, 500),
    stack: stack ? String(stack).slice(0, 1000) : null,
    context: context || null,
    timestamp: new Date()
  });
}

export const getStats = async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const freePercent = Math.round((freeMem / totalMem) * 100);

    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    let disk = null;
    try {
      const dfOut = execSync("df -BM / 2>/dev/null | tail -1", { timeout: 3000 }).toString().trim();
      const parts = dfOut.split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const free = parseInt(parts[3]) || 0;
      const usePercent = parseInt(parts[4]) || 0;
      disk = { totalMB: total, usedMB: used, freeMB: free, usedPercent: usePercent, freePercent: 100 - usePercent };
    } catch {}

    const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const dbStatus = dbState[mongoose.connection.readyState] || 'unknown';

    const uptimeSeconds = Math.floor(process.uptime());

    return res.status(200).json({
      memory: {
        totalMB: Math.round(totalMem / 1024 / 1024),
        usedMB: Math.round(usedMem / 1024 / 1024),
        freeMB: Math.round(freeMem / 1024 / 1024),
        freePercent,
        usedPercent: 100 - freePercent
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model?.trim() || 'Unknown',
        loadAvg: {
          '1m': parseFloat(loadAvg[0].toFixed(2)),
          '5m': parseFloat(loadAvg[1].toFixed(2)),
          '15m': parseFloat(loadAvg[2].toFixed(2))
        }
      },
      disk,
      db: { status: dbStatus },
      uptimeSeconds,
      errors: errorLog.slice().reverse().slice(0, 100)
    });
  } catch (err) {
    console.error('[Health] getStats error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};
