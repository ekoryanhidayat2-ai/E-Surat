import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export interface LogRecordInput {
  level: 'error' | 'warn';
  route: string;
  method: string;
  message: string;
  stack?: string;
}

export class AppLogger {
  private logFilePath: string;
  private securityLogFilePath: string;
  private db: DatabaseSync | null = null;
  private webhookUrl: string;

  constructor(logDir: string, webhookUrl = '') {
    fs.mkdirSync(logDir, { recursive: true });
    this.logFilePath = path.join(logDir, 'error.log');
    this.securityLogFilePath = path.join(logDir, 'security.log');
    this.webhookUrl = webhookUrl.trim();
  }

  attachDatabase(db: DatabaseSync): void {
    this.db = db;
  }

  logError(input: LogRecordInput): string {
    const id = `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const stack = (input.stack || '').slice(0, 4000);
    const message = input.message.slice(0, 1000);

    const line = JSON.stringify({
      id,
      level: input.level,
      route: input.route,
      method: input.method,
      message,
      createdAt,
    });

    try {
      fs.appendFileSync(this.logFilePath, `${line}\n`, 'utf8');
    } catch (fileErr) {
      console.error('[AppLogger] Gagal menulis error.log:', fileErr);
    }

    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT INTO error_logs (id, level, route, method, message, stack, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, input.level, input.route, input.method, message, stack, createdAt);
      } catch (dbErr) {
        console.error('[AppLogger] Gagal menyimpan error ke SQLite:', dbErr);
      }
    }

    if (this.webhookUrl && input.level === 'error') {
      void this.notifyWebhook({
        id,
        level: input.level,
        route: input.route,
        method: input.method,
        message,
        createdAt,
      });
    }

    return id;
  }

  logSecurityEvent(payload: {
    id: string;
    severity: string;
    category: string;
    title: string;
    message: string;
    ipAddress: string;
    route: string;
    method: string;
    actorUsername?: string;
    createdAt: string;
  }): void {
    const line = JSON.stringify({
      id: payload.id,
      severity: payload.severity,
      category: payload.category,
      title: payload.title,
      message: payload.message,
      ipAddress: payload.ipAddress,
      route: payload.route,
      method: payload.method,
      actorUsername: payload.actorUsername || '',
      createdAt: payload.createdAt,
    });

    try {
      fs.appendFileSync(this.securityLogFilePath, `${line}\n`, 'utf8');
    } catch (fileErr) {
      console.error('[AppLogger] Gagal menulis security.log:', fileErr);
    }

    if (this.webhookUrl && (payload.severity === 'high' || payload.severity === 'critical')) {
      void this.notifyWebhook({
        id: payload.id,
        level: `SECURITY-${payload.severity.toUpperCase()}`,
        route: payload.route,
        method: payload.method,
        message: `${payload.title} (${payload.ipAddress}) — ${payload.message}`,
        createdAt: payload.createdAt,
      });
    }
  }

  private async notifyWebhook(payload: Record<string, string>): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[E-Surat SMPN 2 Girimulyo] ${payload.level.toUpperCase()} pada ${payload.method} ${payload.route}: ${payload.message}`,
          ...payload,
        }),
      });
    } catch (err) {
      console.error('[AppLogger] Gagal mengirim notifikasi webhook:', err);
    }
  }
}
