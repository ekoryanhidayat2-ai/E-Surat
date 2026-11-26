import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createApiApp } from './server/app.ts';
import { PersuratanDatabase } from './server/db.ts';
import { AppLogger } from './server/logger.ts';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'persuratan.db'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(DATA_DIR, 'logs'));
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

const logger = new AppLogger(LOG_DIR, ALERT_WEBHOOK_URL);
const store = new PersuratanDatabase(DB_PATH, true);
logger.attachDatabase(store.db);

const app = createApiApp({
  store,
  logger,
  uploadDir: UPLOAD_DIR,
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve('./dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[E-Surat SMPN 2 Girimulyo] Server berjalan di http://0.0.0.0:${PORT} (DB: ${DB_PATH})`
    );
  });

  // Checkpoint WAL berkala agar data terbaru selalu tersinkron ke berkas database utama
  const checkpointTimer = setInterval(() => {
    store.checkpointDatabase('PASSIVE');
  }, 30 * 1000);
  checkpointTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[E-Surat] Menerima sinyal ${signal}, menyinkronkan database...`);
    clearInterval(checkpointTimer);
    try {
      store.checkpointDatabase('TRUNCATE');
      store.db.close();
    } catch {
      // Abaikan jika database sudah tertutup
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGHUP', () => shutdown('SIGHUP'));
  process.once('beforeExit', () => {
    if (!shuttingDown) {
      try {
        store.checkpointDatabase('TRUNCATE');
      } catch {
        // Abaikan jika database sudah tertutup
      }
    }
  });
}

startServer().catch((err) => {
  logger.logError({
    level: 'error',
    route: 'startup',
    method: 'INIT',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : '',
  });
  console.error('Gagal memulai server:', err);
  process.exit(1);
});
