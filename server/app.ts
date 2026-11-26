import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { readSheet } from 'read-excel-file/node';
import type {
  AiDraftTone,
  AuthUser,
  SchoolSettings,
  SecurityAlertCategory,
  SecurityAlertSeverity,
} from '../src/types.ts';
import {
  CLASSIFICATION_SCHEMA_SPEC,
  parseClassificationRows,
  validateClassificationItemsSchema,
} from '../src/lib/classificationParser.ts';
import {
  RECIPIENT_SCHEMA_SPEC,
  parseRecipientRows,
} from '../src/lib/recipientParser.ts';
import {
  AiServiceError,
  analyzeIncomingLetterWithAi,
  draftOutgoingLetterWithAi,
  queryArchiveWithAi,
  summarizeLetterWithAi,
  type InlineAttachmentData,
} from './ai.ts';
import {
  ConflictError,
  NotFoundError,
  PersuratanDatabase,
  ValidationError,
} from './db.ts';
import type { AppLogger } from './logger.ts';
import {
  generateBloggerExportPackage,
  generateBloggerSourceZipBuffer,
} from './bloggerExport.ts';

export interface CreateAppOptions {
  store: PersuratanDatabase;
  logger: AppLogger;
  uploadDir: string;
  workspaceRoot?: string;
}

interface AuthedRequest extends Request {
  authUser?: AuthUser;
  authToken?: string;
}

const ALLOWED_UPLOAD_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PDF_UPLOAD_BYTES = 10 * 1024 * 1024;
const SESSION_COOKIE_NAME = 'esurat_session';

const SUSPICIOUS_SCANNER_PATHS = [
  '/.env',
  '/.git',
  '/wp-admin',
  '/wp-login',
  '/phpmyadmin',
  '/pma',
  '/cgi-bin',
  '/actuator',
  '/server-status',
];

const SQLI_PATTERN =
  /\b(UNION\s+(ALL\s+)?SELECT|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|INSERT\s+INTO\s+\w+\s+VALUES|WAITFOR\s+DELAY|BENCHMARK\s*\(|SLEEP\s*\()\b|'\s*(OR|AND)\s+['\d]+=['\d]+|;\s*--/i;

const XSS_PATTERN =
  /<\s*script\b|javascript\s*:|\bon(error|load|click|mouseover|focus)\s*=/i;

const PATH_TRAVERSAL_PATTERN = /(^|[/\\])\.\.([/\\]|$)|%2e%2e(%2f|%5c|[/\\])|\/etc\/passwd|\0/i;

function sanitizeFileName(raw: string): string {
  const base = path.basename(raw).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 80) || 'lampiran';
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 80);
  }
  return (req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 80);
}

function verifyUploadMagicBytes(mimeType: string, buffer: Buffer): { ok: boolean; reason?: string } {
  if (mimeType === 'application/pdf') {
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return { ok: false, reason: 'Header berkas tidak cocok dengan tanda tangan PDF resmi (%PDF-).' };
    }
    return { ok: true };
  }
  if (mimeType === 'image/png') {
    const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const matches = pngSig.every((byte, idx) => buffer[idx] === byte);
    if (!matches) {
      return { ok: false, reason: 'Header berkas tidak cocok dengan format PNG yang valid.' };
    }
    return { ok: true };
  }
  if (mimeType === 'image/jpeg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      return { ok: false, reason: 'Header berkas tidak cocok dengan format JPEG yang valid.' };
    }
    return { ok: true };
  }
  if (mimeType === 'image/webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') {
      return { ok: false, reason: 'Header berkas tidak cocok dengan format WEBP yang valid.' };
    }
    return { ok: true };
  }
  if (mimeType === 'image/svg+xml') {
    const text = buffer.toString('utf8');
    if (!/<svg\b/i.test(text)) {
      return { ok: false, reason: 'Berkas SVG tidak memiliki elemen <svg> yang valid.' };
    }
    if (
      /<\s*script\b|javascript\s*:|<\s*foreignObject\b|\bon[a-z]+\s*=/i.test(text)
    ) {
      return {
        ok: false,
        reason: 'Berkas SVG mengandung skrip atau event handler aktif yang berisiko XSS.',
      };
    }
    return { ok: true };
  }
  return { ok: false, reason: 'Tipe berkas tidak diizinkan.' };
}

const DEFAULT_SKIP_WAF_KEYS = new Set(['dataBase64']);
const RESTORE_SKIP_WAF_KEYS = new Set(['dataBase64', 'backupPayload']);

function isBenignClientNoise(message: string, stack: string): boolean {
  const combined = `${message}\n${stack}`.toLowerCase();
  return (
    combined.includes('websocket closed without opened') ||
    combined.includes('failed to connect to websocket') ||
    (combined.includes('@vite/client') && combined.includes('websocket')) ||
    combined.includes('resizeobserver loop')
  );
}

function findDangerousPayload(
  value: unknown,
  keyPath = '',
  skipKeys: Set<string> = DEFAULT_SKIP_WAF_KEYS
): { type: 'INJECTION_ATTEMPT' | 'PATH_TRAVERSAL'; snippet: string } | null {
  if (typeof value === 'string') {
    for (const skipKey of skipKeys) {
      if (keyPath === skipKey || keyPath.endsWith(`.${skipKey}`)) {
        return null;
      }
    }
    if (PATH_TRAVERSAL_PATTERN.test(value)) {
      return { type: 'PATH_TRAVERSAL', snippet: value.slice(0, 120) };
    }
    if (SQLI_PATTERN.test(value) || XSS_PATTERN.test(value)) {
      return { type: 'INJECTION_ATTEMPT', snippet: value.slice(0, 120) };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findDangerousPayload(value[i], `${keyPath}[${i}]`, skipKeys);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (skipKeys.has(k)) continue;
      const found = findDangerousPayload(v, keyPath ? `${keyPath}.${k}` : k, skipKeys);
      if (found) return found;
    }
  }
  return null;
}

function extractSessionToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const parts = cookieHeader.split(';');
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=');
      if (k === SESSION_COOKIE_NAME) {
        return decodeURIComponent(rest.join('='));
      }
    }
  }
  return '';
}

export function createApiApp(options: CreateAppOptions) {
  const { store, logger, uploadDir, workspaceRoot = process.cwd() } = options;
  store.syncUploadsDirectory(uploadDir);

  const app = express();
  app.disable('x-powered-by');

  // Lapisan 1: Header Keamanan HTTP & Anti-Cache untuk Data Terbaru
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  app.use(express.json({ limit: '16mb' }));
  app.use(
    '/uploads',
    express.static(uploadDir, {
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (filePath.toLowerCase().endsWith('.svg')) {
          res.setHeader('Content-Disposition', 'attachment');
        }
      },
    })
  );

  // Fallback langsung dari database SQLite apabila berkas di folder disk terhapus/belum disinkronkan
  app.get('/uploads/:fileKey', (req: Request, res: Response) => {
    const fileKey = String(req.params.fileKey || '');
    if (!fileKey || PATH_TRAVERSAL_PATTERN.test(fileKey) || fileKey.includes('/') || fileKey.includes('\\')) {
      res.status(400).json({ error: 'Nama berkas tidak valid.' });
      return;
    }
    const stored = store.getUploadedFile(fileKey);
    if (!stored) {
      res.status(404).json({ error: 'Berkas lampiran tidak ditemukan.' });
      return;
    }
    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, stored.fileKey), stored.content);
    } catch {
      // Abaikan kegagalan cache disk; berkas tetap dilayani langsung dari SQLite
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', stored.mimeType || 'application/octet-stream');
    if (stored.mimeType === 'image/svg+xml' || stored.fileKey.toLowerCase().endsWith('.svg')) {
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.send(stored.content);
  });

  // Jendela geser di memori untuk mendeteksi probing 401 berulang
  const unauthProbeMap = new Map<string, { count: number; firstAt: number; lastAlertAt: number }>();

  const raiseSecurityAlert = (input: {
    severity: SecurityAlertSeverity;
    category: SecurityAlertCategory;
    title: string;
    message: string;
    req: Request;
    actorUsername?: string;
  }) => {
    const ipAddress = getClientIp(input.req);
    const userAgent = String(input.req.headers['user-agent'] || '');
    const alert = store.recordSecurityAlert({
      severity: input.severity,
      category: input.category,
      title: input.title,
      message: input.message,
      ipAddress,
      route: input.req.originalUrl,
      method: input.req.method,
      actorUsername: input.actorUsername || '',
      userAgent,
    });
    logger.logSecurityEvent({
      id: alert.id,
      severity: alert.severity,
      category: alert.category,
      title: alert.title,
      message: alert.message,
      ipAddress: alert.ipAddress,
      route: alert.route,
      method: alert.method,
      actorUsername: alert.actorUsername,
      createdAt: alert.createdAt,
    });
    return alert;
  };

  // Lapisan 2: Deteksi Intrusi & Pola Serangan (WAF Ringan)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const lowerUrl = (req.originalUrl || '').toLowerCase();
    if (SUSPICIOUS_SCANNER_PATHS.some((p) => lowerUrl.includes(p))) {
      raiseSecurityAlert({
        severity: 'high',
        category: 'PATH_TRAVERSAL',
        title: 'Pemindaian Path Sensitif Terdeteksi',
        message: `Permintaan mencurigakan ke path sensitif "${req.originalUrl}" diblokir otomatis.`,
        req,
      });
      res.status(403).json({ error: 'Akses ditolak oleh sistem keamanan aplikasi.' });
      return;
    }

    if (PATH_TRAVERSAL_PATTERN.test(req.originalUrl || '')) {
      raiseSecurityAlert({
        severity: 'critical',
        category: 'PATH_TRAVERSAL',
        title: 'Upaya Path Traversal Diblokir',
        message: `Terdeteksi pola traversal direktori pada URL "${req.originalUrl}".`,
        req,
      });
      res.status(403).json({ error: 'Permintaan tidak aman ditolak oleh sistem keamanan.' });
      return;
    }

    if (req.path.startsWith('/api/')) {
      const dangerousQuery = findDangerousPayload(req.query, 'query');
      const isClientErrorRoute = req.path === '/api/monitoring/client-error';
      const skipBodyKeys =
        req.path === '/api/monitoring/restore' ? RESTORE_SKIP_WAF_KEYS : DEFAULT_SKIP_WAF_KEYS;
      const dangerousBody = isClientErrorRoute
        ? null
        : findDangerousPayload(req.body, 'body', skipBodyKeys);
      const hit = dangerousQuery || dangerousBody;
      if (hit) {
        raiseSecurityAlert({
          severity: 'critical',
          category: hit.type,
          title:
            hit.type === 'PATH_TRAVERSAL'
              ? 'Upaya Manipulasi Path pada Payload API'
              : 'Upaya Injeksi SQL / XSS Terdeteksi',
          message: `Payload mencurigakan terdeteksi pada ${req.method} ${req.path} (potongan: "${hit.snippet}").`,
          req,
        });
        res.status(403).json({
          error: 'Input mengandung pola berbahaya dan telah diblokir oleh sistem keamanan.',
        });
        return;
      }
    }

    next();
  });

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = extractSessionToken(req);
    const user = store.getSessionUser(token);
    if (!user) {
      const ip = getClientIp(req);
      if (token) {
        raiseSecurityAlert({
          severity: 'high',
          category: 'AUTH_PROBE',
          title: 'Token Sesi Tidak Valid / Palsu Digunakan',
          message: `Seseorang mencoba mengakses ${req.method} ${req.originalUrl} menggunakan token sesi tidak valid atau kedaluwarsa.`,
          req,
        });
      } else {
        const now = Date.now();
        const rec = unauthProbeMap.get(ip);
        if (!rec || now - rec.firstAt > 5 * 60 * 1000) {
          unauthProbeMap.set(ip, { count: 1, firstAt: now, lastAlertAt: 0 });
        } else {
          rec.count += 1;
          if (rec.count >= 4 && now - rec.lastAlertAt > 60 * 1000) {
            rec.lastAlertAt = now;
            raiseSecurityAlert({
              severity: 'medium',
              category: 'AUTH_PROBE',
              title: 'Probing Akses Tanpa Autentikasi Berulang',
              message: `IP ${ip} melakukan ${rec.count} percobaan akses ke endpoint terproteksi tanpa sesi sah (${req.originalUrl}).`,
              req,
            });
          }
        }
      }
      res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' });
      return;
    }
    req.authUser = user;
    req.authToken = token;
    next();
  };

  const requireNonStaff = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser || req.authUser.role === 'staf') {
      if (req.authUser) {
        raiseSecurityAlert({
          severity: 'medium',
          category: 'PRIVILEGE_ESCALATION',
          title: 'Akses Ditolak pada Endpoint Operator/Pimpinan',
          message: `Akun "${req.authUser.username}" (${req.authUser.role}) mencoba memanggil ${req.method} ${req.originalUrl}.`,
          req,
          actorUsername: req.authUser.username,
        });
      }
      res.status(403).json({ error: 'Peran Anda hanya memiliki akses lihat dan tindak lanjut disposisi.' });
      return;
    }
    next();
  };

  const requireAdmin = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser || req.authUser.role !== 'admin') {
      if (req.authUser) {
        raiseSecurityAlert({
          severity: 'high',
          category: 'PRIVILEGE_ESCALATION',
          title: 'Percobaan Akses Endpoint Khusus Admin',
          message: `Pengguna non-admin "${req.authUser.username}" (${req.authUser.role}) mencoba mengakses ${req.method} ${req.originalUrl}.`,
          req,
          actorUsername: req.authUser.username,
        });
      }
      res.status(403).json({ error: 'Tindakan ini hanya diizinkan untuk Admin Tata Usaha.' });
      return;
    }
    next();
  };

  // --- Endpoint Publik (Kesehatan & Branding Login) ---
  app.get('/api/health', (_req: Request, res: Response) => {
    try {
      store.db.prepare('SELECT 1 AS ok').get();
      res.json({
        ok: true,
        service: 'e-surat-smpn2-girimulyo',
        database: 'sqlite-connected',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Database check failed';
      logger.logError({
        level: 'error',
        route: '/api/health',
        method: 'GET',
        message: msg,
        stack: err instanceof Error ? err.stack : '',
      });
      res.status(503).json({ ok: false, error: msg });
    }
  });

  app.get('/api/public/school-branding', (_req: Request, res: Response) => {
    res.json(store.getPublicBranding());
  });

  // --- Autentikasi + Proteksi Brute Force ---
  app.post('/api/auth/login', (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body || {}) as { username?: unknown; password?: unknown };
    const ip = getClientIp(req);
    const rawUser = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';

    try {
      const limitCheck = store.checkLoginRateLimit(rawUser, ip);
      if (!limitCheck.allowed) {
        const mins = Math.max(1, Math.ceil(limitCheck.retryAfterSeconds / 60));
        res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds));
        res.status(429).json({
          error: `Terlalu banyak percobaan login gagal. Akses dikunci sementara selama ${mins} menit demi keamanan.`,
        });
        return;
      }

      const { token, user } = store.authenticateUser(body.username, body.password, {
        ipAddress: ip,
        userAgent: String(req.headers['user-agent'] || ''),
      });
      store.clearFailedLogins(rawUser, ip);

      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
      );
      res.json({ token, user });
    } catch (err) {
      if (err instanceof ValidationError && (err.statusCode === 401 || err.statusCode === 403)) {
        const failInfo = store.recordFailedLogin(rawUser, ip);
        if (failInfo.locked) {
          raiseSecurityAlert({
            severity: 'critical',
            category: 'BRUTE_FORCE',
            title: 'Kunci Keamanan Aktif: Indikasi Brute-Force Login',
            message: `IP ${ip} gagal login ${failInfo.attempts}x untuk akun "${rawUser || '(kosong)'}". Login dikunci otomatis selama 15 menit.`,
            req,
            actorUsername: rawUser,
          });
          res.setHeader('Retry-After', String(failInfo.retryAfterSeconds));
          res.status(429).json({
            error:
              'Terlalu banyak percobaan login gagal (5x). Akun/IP dikunci sementara selama 15 menit dan insiden dilaporkan ke Admin.',
          });
          return;
        }
        if (failInfo.attempts >= 3) {
          raiseSecurityAlert({
            severity: 'high',
            category: 'BRUTE_FORCE',
            title: 'Peringatan Percobaan Login Gagal Berulang',
            message: `Tercatat ${failInfo.attempts} percobaan login gagal berturut-turut untuk akun "${rawUser || '(kosong)'}" dari IP ${ip}.`,
            req,
            actorUsername: rawUser,
          });
        }
      }
      next(err);
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractSessionToken(req);
    store.deleteSession(token);
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
    res.status(204).end();
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const token = extractSessionToken(req);
    const user = store.getSessionUser(token);
    if (!user) {
      res.status(401).json({ error: 'Belum masuk.' });
      return;
    }
    res.json({ user });
  });

  app.post(
    '/api/auth/change-password',
    requireAuth,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as {
          currentPassword?: unknown;
          newPassword?: unknown;
        };
        store.changeOwnPassword(
          req.authUser!.id,
          body.currentPassword,
          body.newPassword
        );
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Keamanan Berlapis & Notifikasi Pembobolan (Admin Only) ---
  app.get('/api/security/alerts', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    const { alerts, unreadCount } = store.listSecurityAlerts(limit);
    res.json({
      alerts,
      unreadCount,
      storage: store.getStorageStatus(),
    });
  });

  app.patch(
    '/api/security/alerts/:id/read',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const updated = store.markSecurityAlertRead(
          String(req.params.id),
          req.authUser?.displayName || req.authUser?.username || 'Admin'
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/security/alerts/read-all',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response) => {
      const updatedCount = store.markAllSecurityAlertsRead(
        req.authUser?.displayName || req.authUser?.username || 'Admin'
      );
      res.json({ updatedCount });
    }
  );

  app.delete('/api/security/alerts', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    store.clearReadSecurityAlerts();
    res.status(204).end();
  });

  // --- Stabilitas Penyimpanan, Checkpoint & Cadangan (Admin Only) ---
  app.get('/api/monitoring/storage', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    res.json(store.getStorageStatus());
  });

  app.post(
    '/api/monitoring/checkpoint',
    requireAuth,
    requireAdmin,
    (_req: Request, res: Response) => {
      const status = store.checkpointDatabase('TRUNCATE');
      res.json(status);
    }
  );

  app.get('/api/monitoring/backup', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    const snapshot = store.exportFullBackup();
    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cadangan-esurat-${dateStamp}.json"`
    );
    res.send(JSON.stringify(snapshot, null, 2));
  });

  app.get('/api/monitoring/backups', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    res.json({
      snapshots: store.listSnapshots(),
      storage: store.getStorageStatus(),
    });
  });

  app.post('/api/monitoring/backups', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    const fileName = store.createAutoSnapshot('manual', false);
    res.status(201).json({
      fileName,
      snapshots: store.listSnapshots(),
      storage: store.getStorageStatus(),
    });
  });

  app.post(
    '/api/monitoring/restore',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as {
          mode?: unknown;
          snapshotFileName?: unknown;
          backupPayload?: unknown;
        };
        const mode = body.mode === 'replace' ? 'replace' : 'merge';
        let payload = body.backupPayload;
        if (typeof body.snapshotFileName === 'string' && body.snapshotFileName.trim()) {
          payload = store.readSnapshotPayload(body.snapshotFileName.trim());
        }
        const result = store.restoreFromBackup(payload, mode);
        store.syncUploadsDirectory(uploadDir);
        res.json({
          result,
          snapshots: store.listSnapshots(),
          storage: store.getStorageStatus(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Monitoring & Error Log ---
  app.get('/api/monitoring/errors', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ errors: store.listErrorLogs(limit) });
  });

  app.delete(
    '/api/monitoring/errors',
    requireAuth,
    requireAdmin,
    (_req: Request, res: Response) => {
      store.clearErrorLogs();
      res.status(204).end();
    }
  );

  app.get('/api/monitoring/activity', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 150, 1), 300);
    res.json({ activities: store.listActivityLogs(limit) });
  });

  app.delete(
    '/api/monitoring/activity',
    requireAuth,
    requireAdmin,
    (_req: Request, res: Response) => {
      store.clearActivityLogs();
      res.status(204).end();
    }
  );

  app.post('/api/monitoring/client-error', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const rawMessage = typeof body.message === 'string' ? body.message : 'Client error';
    const rawRoute = typeof body.route === 'string' ? body.route : '/client';
    const rawStack = typeof body.stack === 'string' ? body.stack : '';

    if (isBenignClientNoise(rawMessage, rawStack)) {
      res.status(200).json({ logged: false, ignored: true });
      return;
    }

    const message = rawMessage.trim().slice(0, 500) || 'Client error';
    const route = rawRoute.trim().slice(0, 200) || '/client';
    const stack = rawStack.slice(0, 3000);

    const logId = logger.logError({
      level: 'error',
      route,
      method: 'CLIENT',
      message,
      stack,
    });
    res.status(201).json({ logged: true, id: logId });
  });

  // --- Manajemen Pengguna (Admin TU) ---
  app.get('/api/users', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    res.json({ users: store.listUsers() });
  });

  app.post('/api/users', requireAuth, requireAdmin, (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body || {}) as {
        username?: unknown;
        password?: unknown;
        displayName?: unknown;
        jabatan?: unknown;
        role?: unknown;
      };
      const created = store.createUser({
        username: body.username,
        password: body.password,
        displayName: body.displayName,
        jabatan: body.jabatan,
        role: body.role,
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch(
    '/api/users/:id',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const targetId = String(req.params.id);
        if (req.authUser && req.authUser.id === targetId) {
          throw new ValidationError('Anda tidak dapat menonaktifkan akun Anda sendiri.');
        }
        const body = (req.body || {}) as { isActive?: unknown };
        const updated = store.updateUserStatus(targetId, Boolean(body.isActive));
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/users/:id/password',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const targetId = String(req.params.id);
        const body = (req.body || {}) as { newPassword?: unknown };
        const isSelf = req.authUser?.id === targetId;
        store.updateUserPassword(targetId, body.newPassword, !isSelf);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/users/:id',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        store.deleteUser(String(req.params.id), req.authUser!.id);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Bootstrap & Upload (dengan Verifikasi Magic-Byte & Anti-SVG-XSS) ---
  app.get('/api/bootstrap', requireAuth, (_req: Request, res: Response) => {
    res.json(store.getBootstrapData());
  });

  app.post(
    '/api/uploads',
    requireAuth,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const fileName = typeof body.fileName === 'string' ? body.fileName : '';
        const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
        const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';

        if (!fileName || !dataBase64) {
          throw new ValidationError('Nama berkas dan isi dokumen wajib disertakan.');
        }
        if (PATH_TRAVERSAL_PATTERN.test(fileName)) {
          raiseSecurityAlert({
            severity: 'high',
            category: 'MALICIOUS_UPLOAD',
            title: 'Upaya Path Traversal pada Nama Berkas Unggahan',
            message: `Pengguna "${req.authUser?.username}" mengirim nama berkas mencurigakan: "${fileName.slice(0, 80)}".`,
            req,
            actorUsername: req.authUser?.username,
          });
          throw new ValidationError('Nama berkas tidak valid atau berisiko keamanan.');
        }
        if (!ALLOWED_UPLOAD_MIME.has(mimeType)) {
          raiseSecurityAlert({
            severity: 'high',
            category: 'MALICIOUS_UPLOAD',
            title: 'Percobaan Unggah Berkas Format Terlarang',
            message: `Pengguna "${req.authUser?.username}" mencoba mengunggah "${fileName.slice(0, 80)}" (${mimeType || 'unknown'}).`,
            req,
            actorUsername: req.authUser?.username,
          });
          throw new ValidationError('Format berkas harus berupa PDF, PNG, JPG, WEBP, atau SVG.');
        }

        const cleanBase64 = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (buffer.byteLength === 0) {
          throw new ValidationError('Berkas lampiran kosong atau rusak.');
        }
        const maxAllowedBytes =
          mimeType === 'application/pdf' ? MAX_PDF_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;
        const maxLabel = mimeType === 'application/pdf' ? '10 MB' : '4 MB';
        if (buffer.byteLength > maxAllowedBytes) {
          throw new ValidationError(`Ukuran berkas melebihi batas maksimal ${maxLabel}.`);
        }

        const magicCheck = verifyUploadMagicBytes(mimeType, buffer);
        if (!magicCheck.ok) {
          raiseSecurityAlert({
            severity: 'critical',
            category: 'MALICIOUS_UPLOAD',
            title: 'Berkas Unggahan Palsu atau Berbahaya Ditolak',
            message: `Berkas "${fileName.slice(0, 80)}" (${mimeType}) gagal verifikasi isi: ${magicCheck.reason}`,
            req,
            actorUsername: req.authUser?.username,
          });
          throw new ValidationError(magicCheck.reason || 'Isi berkas tidak sesuai dengan format yang dipilih.');
        }

        const safeName = `${Date.now()}_${sanitizeFileName(fileName)}`;
        const stored = store.saveUploadedFile({
          fileKey: safeName,
          originalName: fileName.slice(0, 120),
          mimeType,
          content: buffer,
          uploadedBy: req.authUser?.username || '',
        });
        const targetPath = path.join(uploadDir, safeName);
        fs.writeFileSync(targetPath, buffer);

        res.status(201).json({
          attachmentUrl: stored.urlPath,
          attachmentName: stored.originalName,
          sizeBytes: stored.sizeBytes,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Draf Formulir Surat Otomatis per Pengguna (Tersimpan di SQLite) ---
  app.get('/api/drafts/:draftKey', requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const draft = store.getUserDraft(req.authUser!.id, String(req.params.draftKey));
      res.json({ draft });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/drafts/:draftKey', requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const body = (req.body || {}) as { payload?: unknown };
      const draft = store.saveUserDraft(
        req.authUser!.id,
        String(req.params.draftKey),
        body.payload ?? body
      );
      res.json({ draft });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/drafts/:draftKey', requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      store.deleteUserDraft(req.authUser!.id, String(req.params.draftKey));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // --- Surat Masuk ---
  app.get('/api/incoming', requireAuth, (_req: Request, res: Response) => {
    res.json({ items: store.listIncomingLetters() });
  });

  app.post(
    '/api/incoming',
    requireAuth,
    requireNonStaff,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const created = store.createIncomingLetter(
          {
            ...body,
            createdBy: body.createdBy || req.authUser?.displayName || 'Staf Tata Usaha',
          },
          req.authUser
        );
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/incoming/:id',
    requireAuth,
    requireNonStaff,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const updated = store.updateIncomingLetter(
          String(req.params.id),
          (req.body || {}) as Record<string, unknown>,
          req.authUser
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/incoming/:id',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        store.deleteIncomingLetter(String(req.params.id), req.authUser);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Disposisi ---
  app.post(
    '/api/incoming/:id/dispositions',
    requireAuth,
    requireNonStaff,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const updated = store.addDisposition(String(req.params.id), {
          ...body,
          createdBy: body.createdBy || req.authUser?.displayName || 'Kepala Sekolah',
        });
        res.status(201).json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/incoming/:id/dispositions/:dispId',
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const updated = store.updateDisposition(
          String(req.params.id),
          String(req.params.dispId),
          (req.body || {}) as Record<string, unknown>
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Surat Keluar ---
  app.get('/api/outgoing', requireAuth, (_req: Request, res: Response) => {
    res.json({ items: store.listOutgoingLetters() });
  });

  app.post(
    '/api/outgoing',
    requireAuth,
    requireNonStaff,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const created = store.createOutgoingLetter(
          {
            ...body,
            createdBy: body.createdBy || req.authUser?.displayName || 'Staf Tata Usaha',
          },
          req.authUser
        );
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/outgoing/:id',
    requireAuth,
    requireNonStaff,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const updated = store.updateOutgoingLetter(
          String(req.params.id),
          (req.body || {}) as Record<string, unknown>,
          req.authUser
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/outgoing/:id',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        store.deleteOutgoingLetter(String(req.params.id), req.authUser);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Klasifikasi & Pengaturan ---
  app.post(
    '/api/classifications',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as { code: string; name: string; description?: string };
        const saved = store.upsertClassification(body);
        res.status(201).json(saved);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/classifications/import',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          throw new ValidationError('Payload impor klasifikasi tidak valid.');
        }
        const body = req.body as {
          items?: unknown;
          mode?: unknown;
        };
        const checked = validateClassificationItemsSchema(body.items, body.mode);
        if (!checked.valid) {
          const message =
            checked.errors[0]?.message || 'Data klasifikasi tidak memenuhi validasi skema.';
          logger.logError({
            level: 'warn',
            route: req.originalUrl,
            method: req.method,
            message,
          });
          res.status(400).json({
            error: message,
            validationErrors: checked.errors,
          });
          return;
        }
        const result = store.importClassifications(checked.items, checked.mode);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/classifications/import-xlsx',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          throw new ValidationError('Payload unggah Excel (.xlsx) tidak valid.');
        }
        const body = req.body as {
          fileName?: unknown;
          dataBase64?: unknown;
          mode?: unknown;
          dryRun?: unknown;
        };
        const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
        if (!fileName || fileName.length > 180) {
          throw new ValidationError('Nama berkas Excel wajib diisi (maks. 180 karakter).');
        }
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.xls')) {
          throw new ValidationError(
            'Format .xls lama tidak didukung. Simpan berkas sebagai Excel (.xlsx) terlebih dahulu.'
          );
        }
        if (!lowerName.endsWith('.xlsx')) {
          throw new ValidationError('Format berkas harus berupa Excel (.xlsx).');
        }
        if (body.mode !== undefined && body.mode !== 'merge' && body.mode !== 'replace') {
          throw new ValidationError('Mode impor harus bernilai "merge" atau "replace".');
        }
        const mode: 'merge' | 'replace' = body.mode === 'replace' ? 'replace' : 'merge';
        const dryRun = body.dryRun === true;

        const rawData = typeof body.dataBase64 === 'string' ? body.dataBase64.trim() : '';
        if (!rawData) {
          throw new ValidationError('Isi berkas Excel (.xlsx) tidak boleh kosong.');
        }
        const strippedBase64 = rawData.includes(',')
          ? rawData.slice(rawData.indexOf(',') + 1)
          : rawData;
        const cleanBase64 = strippedBase64.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
          throw new ValidationError('Encoding base64 berkas Excel (.xlsx) tidak valid.');
        }
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (buffer.length === 0) {
          throw new ValidationError('Berkas Excel (.xlsx) kosong (0 byte).');
        }
        if (buffer.length > CLASSIFICATION_SCHEMA_SPEC.maxFileBytes) {
          throw new ValidationError('Ukuran berkas Excel maksimal 5 MB.');
        }

        const isZipSignature =
          buffer.length >= 4 &&
          buffer[0] === 0x50 &&
          buffer[1] === 0x4b &&
          buffer[2] === 0x03 &&
          buffer[3] === 0x04;
        if (!isZipSignature) {
          raiseSecurityAlert({
            severity: 'high',
            category: 'MALICIOUS_UPLOAD',
            title: 'Unggahan Excel (.xlsx) Palsu Ditolak',
            message: `Admin/pengguna mencoba mengunggah berkas "${sanitizeFileName(fileName)}" yang tidak memiliki header OpenXML (.xlsx) yang sah.`,
            req,
          });
          throw new ValidationError(
            'Header berkas tidak cocok dengan format Excel OpenXML (.xlsx) yang sah.'
          );
        }

        let rawRows: unknown[][];
        try {
          rawRows = (await readSheet(buffer, CLASSIFICATION_SCHEMA_SPEC.sheetName)) as unknown[][];
        } catch {
          try {
            rawRows = (await readSheet(buffer, 1)) as unknown[][];
          } catch {
            throw new ValidationError(
              'Berkas .xlsx tidak dapat dibaca atau rusak. Pastikan format berkas sesuai Excel standar (.xlsx).'
            );
          }
        }

        const parsed = parseClassificationRows(rawRows);
        if (dryRun) {
          res.json({
            valid: parsed.schemaValid,
            items: parsed.items,
            validation: parsed.validation,
          });
          return;
        }

        if (!parsed.schemaValid || parsed.errors.length > 0 || parsed.items.length === 0) {
          const message =
            parsed.errors[0]?.message ||
            'Validasi skema berkas Excel klasifikasi gagal sebelum disimpan ke database.';
          logger.logError({
            level: 'warn',
            route: req.originalUrl,
            method: req.method,
            message,
          });
          res.status(400).json({
            error: message,
            validation: parsed.validation,
          });
          return;
        }

        const result = store.importClassifications(parsed.items, mode);
        res.json({
          ...result,
          validation: parsed.validation,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/classifications/:code',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        store.deleteClassification(String(req.params.code));
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Direktori Guru & Karyawan Penerima Disposisi ---
  app.get('/api/disposition-recipients', requireAuth, (req: Request, res: Response) => {
    const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
    res.json({ items: store.listDispositionRecipients(activeOnly) });
  });

  app.post(
    '/api/disposition-recipients',
    requireAuth,
    requireNonStaff,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const created = store.createDispositionRecipient(body);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/disposition-recipients/:id',
    requireAuth,
    requireNonStaff,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const updated = store.updateDispositionRecipient(
          String(req.params.id),
          (req.body || {}) as Record<string, unknown>
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/disposition-recipients/:id',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        store.deleteDispositionRecipient(String(req.params.id));
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/disposition-recipients/import',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          throw new ValidationError('Payload impor penerima tidak valid.');
        }
        const body = req.body as { items?: unknown; mode?: unknown };
        const mode = body.mode === 'replace' ? 'replace' : 'merge';
        const result = store.importDispositionRecipients(body.items, mode);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/disposition-recipients/import-xlsx',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          throw new ValidationError('Payload unggah Excel (.xlsx) tidak valid.');
        }
        const body = req.body as {
          fileName?: unknown;
          dataBase64?: unknown;
          mode?: unknown;
          dryRun?: unknown;
        };
        const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
        if (!fileName || fileName.length > 180) {
          throw new ValidationError('Nama berkas Excel wajib diisi (maks. 180 karakter).');
        }
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.xls')) {
          throw new ValidationError(
            'Format .xls lama tidak didukung. Simpan berkas sebagai Excel (.xlsx) terlebih dahulu.'
          );
        }
        if (!lowerName.endsWith('.xlsx')) {
          throw new ValidationError('Format berkas harus berupa Excel (.xlsx).');
        }
        if (body.mode !== undefined && body.mode !== 'merge' && body.mode !== 'replace') {
          throw new ValidationError('Mode impor harus bernilai "merge" atau "replace".');
        }
        const mode: 'merge' | 'replace' = body.mode === 'replace' ? 'replace' : 'merge';
        const dryRun = body.dryRun === true;

        const rawData = typeof body.dataBase64 === 'string' ? body.dataBase64.trim() : '';
        if (!rawData) {
          throw new ValidationError('Isi berkas Excel (.xlsx) tidak boleh kosong.');
        }
        const strippedBase64 = rawData.includes(',')
          ? rawData.slice(rawData.indexOf(',') + 1)
          : rawData;
        const cleanBase64 = strippedBase64.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
          throw new ValidationError('Encoding base64 berkas Excel (.xlsx) tidak valid.');
        }
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (buffer.length === 0) {
          throw new ValidationError('Berkas Excel (.xlsx) kosong (0 byte).');
        }
        if (buffer.length > RECIPIENT_SCHEMA_SPEC.maxFileBytes) {
          throw new ValidationError('Ukuran berkas Excel maksimal 5 MB.');
        }

        const isZipSignature =
          buffer.length >= 4 &&
          buffer[0] === 0x50 &&
          buffer[1] === 0x4b &&
          buffer[2] === 0x03 &&
          buffer[3] === 0x04;
        if (!isZipSignature) {
          raiseSecurityAlert({
            severity: 'high',
            category: 'MALICIOUS_UPLOAD',
            title: 'Unggahan Excel (.xlsx) Palsu Ditolak',
            message: `Admin/pengguna mencoba mengunggah berkas "${sanitizeFileName(fileName)}" yang tidak memiliki header OpenXML (.xlsx) yang sah.`,
            req,
          });
          throw new ValidationError(
            'Header berkas tidak cocok dengan format Excel OpenXML (.xlsx) yang sah.'
          );
        }

        let rawRows: unknown[][];
        try {
          rawRows = (await readSheet(buffer, RECIPIENT_SCHEMA_SPEC.sheetName)) as unknown[][];
        } catch {
          try {
            rawRows = (await readSheet(buffer, 1)) as unknown[][];
          } catch {
            throw new ValidationError(
              'Berkas .xlsx tidak dapat dibaca atau rusak. Pastikan format berkas sesuai Excel standar (.xlsx).'
            );
          }
        }

        const parsed = parseRecipientRows(rawRows);
        if (dryRun) {
          res.json({
            valid: parsed.schemaValid,
            items: parsed.items,
            validation: parsed.validation,
          });
          return;
        }

        if (!parsed.schemaValid || parsed.errors.length > 0 || parsed.items.length === 0) {
          const message =
            parsed.errors[0]?.message ||
            'Validasi skema berkas Excel guru & karyawan gagal sebelum disimpan ke database.';
          logger.logError({
            level: 'warn',
            route: req.originalUrl,
            method: req.method,
            message,
          });
          res.status(400).json({
            error: message,
            validation: parsed.validation,
          });
          return;
        }

        const result = store.importDispositionRecipients(parsed.items, mode);
        res.json({
          ...result,
          validation: parsed.validation,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.put(
    '/api/settings',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const updated = store.updateSettings((req.body || {}) as Partial<SchoolSettings>);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Referensi Peraturan Persuratan (Upload PDF) ---
  app.get('/api/regulations', requireAuth, (_req: Request, res: Response) => {
    res.json({ items: store.listRegulations() });
  });

  app.post(
    '/api/regulations',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const created = store.createRegulation({
          ...body,
          uploadedBy: body.uploadedBy || req.authUser?.displayName || 'Admin Tata Usaha',
        });
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/regulations/:id',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const updated = store.updateRegulation(
          String(req.params.id),
          (req.body || {}) as Record<string, unknown>
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/regulations/:id',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        store.deleteRegulation(String(req.params.id));
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/counters/:year/init',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const year = Number(req.params.year);
        const result = store.initializeYearCounter(year);
        res.status(result.alreadyInitialized ? 200 : 201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.put(
    '/api/counters/:year',
    requireAuth,
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const year = Number(req.params.year);
        const body = (req.body || {}) as { incomingLastSeq?: number; outgoingLastSeq?: number };
        const updated = store.updateCounter(
          year,
          Number(body.incomingLastSeq ?? 0),
          Number(body.outgoingLastSeq ?? 0)
        );
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Asisten Kecerdasan Buatan (Gemini AI Server-Side) ---
  const resolveStoredAttachment = (attachmentUrl?: string): InlineAttachmentData | null => {
    const rawUrl = String(attachmentUrl || '').trim();
    if (!rawUrl.startsWith('/uploads/')) return null;
    const fileKey = rawUrl.slice('/uploads/'.length).split('?')[0];
    if (!fileKey || PATH_TRAVERSAL_PATTERN.test(fileKey) || fileKey.includes('/') || fileKey.includes('\\')) {
      return null;
    }
    const stored = store.getUploadedFile(fileKey);
    if (stored) {
      return {
        mimeType: stored.mimeType,
        content: stored.content,
        fileName: stored.fileKey,
      };
    }
    const diskPath = path.join(uploadDir, fileKey);
    if (fs.existsSync(diskPath)) {
      const ext = path.extname(fileKey).toLowerCase();
      const mimeType =
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : 'application/octet-stream';
      return {
        mimeType,
        content: fs.readFileSync(diskPath),
        fileName: fileKey,
      };
    }
    return null;
  };

  app.post(
    '/api/ai/analyze-incoming',
    requireAuth,
    requireNonStaff,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as {
          rawText?: string;
          attachmentUrl?: string;
        };
        const attachment = resolveStoredAttachment(body.attachmentUrl);
        const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
        if (!attachment && !rawText) {
          throw new ValidationError(
            'Unggah berkas lampiran (PDF/gambar) atau masukkan teks surat terlebih dahulu untuk dianalisis AI.'
          );
        }
        const result = await analyzeIncomingLetterWithAi({
          rawText,
          attachment,
          classifications: store.listClassifications(),
          settings: store.getSettings(),
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/ai/draft-outgoing',
    requireAuth,
    requireNonStaff,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as {
          recipient?: string;
          subject?: string;
          classificationCode?: string;
          letterDate?: string;
          drafterName?: string;
          existingBody?: string;
          notes?: string;
          tone?: string;
        };
        const recipient = String(body.recipient || '').trim();
        const subject = String(body.subject || '').trim();
        const existingBody = String(body.existingBody || '').trim();
        const notes = String(body.notes || '').trim();
        if (!subject && !recipient && !existingBody && !notes) {
          throw new ValidationError(
            'Isi minimal perihal, tujuan surat, catatan, atau naskah awal agar AI dapat menyusun draf surat.'
          );
        }
        const allowedTones: AiDraftTone[] = [
          'surat_dinas',
          'undangan',
          'permohonan',
          'pemberitahuan',
          'sempurnakan',
        ];
        const tone: AiDraftTone = allowedTones.includes(body.tone as AiDraftTone)
          ? (body.tone as AiDraftTone)
          : 'surat_dinas';

        const result = await draftOutgoingLetterWithAi({
          recipient,
          subject,
          classificationCode: String(body.classificationCode || '421.3'),
          letterDate: String(body.letterDate || new Date().toISOString().slice(0, 10)),
          drafterName: String(body.drafterName || 'Bagian Tata Usaha'),
          existingBody,
          notes,
          tone,
          settings: store.getSettings(),
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/ai/summarize-letter',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as {
          kind?: string;
          letterId?: string;
        };
        const kind = body.kind === 'outgoing' ? 'outgoing' : body.kind === 'incoming' ? 'incoming' : null;
        const letterId = String(body.letterId || '').trim();
        if (!kind || !letterId) {
          throw new ValidationError('Parameter jenis surat dan ID surat wajib diisi.');
        }

        if (kind === 'incoming') {
          const incomingLetter = store.listIncomingLetters().find((l) => l.id === letterId);
          if (!incomingLetter) {
            throw new NotFoundError('Data surat masuk tidak ditemukan.');
          }
          const attachment = resolveStoredAttachment(incomingLetter.attachmentUrl);
          const result = await summarizeLetterWithAi({
            kind: 'incoming',
            incomingLetter,
            attachment,
            settings: store.getSettings(),
          });
          res.json(result);
          return;
        }

        const outgoingLetter = store.listOutgoingLetters().find((l) => l.id === letterId);
        if (!outgoingLetter) {
          throw new NotFoundError('Data surat keluar tidak ditemukan.');
        }
        const attachment = resolveStoredAttachment(outgoingLetter.attachmentUrl);
        const result = await summarizeLetterWithAi({
          kind: 'outgoing',
          outgoingLetter,
          attachment,
          settings: store.getSettings(),
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/ai/archive-assistant',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body || {}) as { question?: string };
        const question = String(body.question || '').trim();
        if (!question) {
          throw new ValidationError('Pertanyaan untuk Asisten AI tidak boleh kosong.');
        }
        const result = await queryArchiveWithAi({
          question,
          incoming: store.listIncomingLetters(),
          outgoing: store.listOutgoingLetters(),
          settings: store.getSettings(),
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Ekspor Kode Aplikasi & Template Blogger (Khusus Admin) ---
  app.get(
    '/api/export/blogger/preview',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
        const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
        const fallbackOrigin = `${proto === 'http' ? 'http' : 'https'}://${host}`;
        const requestedOrigin = typeof req.query.origin === 'string' ? req.query.origin : fallbackOrigin;
        const pkg = await generateBloggerExportPackage({
          workspaceRoot,
          store,
          appOrigin: requestedOrigin,
        });
        res.json(pkg);
      } catch (err) {
        next(err);
      }
    }
  );

  app.get(
    '/api/export/blogger/source-zip',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
        const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
        const fallbackOrigin = `${proto === 'http' ? 'http' : 'https'}://${host}`;
        const requestedOrigin = typeof req.query.origin === 'string' ? req.query.origin : fallbackOrigin;
        const { fileName, buffer } = await generateBloggerSourceZipBuffer({
          workspaceRoot,
          store,
          appOrigin: requestedOrigin,
        });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Ekspor Data Database ke Google Spreadsheet (Khusus Admin) ---
  app.get(
    '/api/export/spreadsheet-data',
    requireAuth,
    requireAdmin,
    (_req: Request, res: Response) => {
      store.checkpointDatabase('PASSIVE');
      res.json({
        exportedAt: new Date().toISOString(),
        service: 'e-surat-smpn2-girimulyo',
        data: {
          ...store.getBootstrapData(),
          activityLogs: store.listActivityLogs(500),
        },
      });
    }
  );

  // Global error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      logger.logError({
        level: 'warn',
        route: req.originalUrl,
        method: req.method,
        message: 'Payload JSON tidak valid atau korup.',
      });
      res.status(400).json({ error: 'Format data JSON tidak valid.' });
      return;
    }

    if (
      err instanceof ValidationError ||
      err instanceof NotFoundError ||
      err instanceof ConflictError
    ) {
      logger.logError({
        level: 'warn',
        route: req.originalUrl,
        method: req.method,
        message: err.message,
      });
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    if (err instanceof AiServiceError) {
      logger.logError({
        level: err.statusCode >= 500 ? 'error' : 'warn',
        route: req.originalUrl,
        method: req.method,
        message: err.message,
      });
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    const message = err instanceof Error ? err.message : 'Terjadi kesalahan internal server.';
    const stack = err instanceof Error ? err.stack : '';
    const logId = logger.logError({
      level: 'error',
      route: req.originalUrl,
      method: req.method,
      message,
      stack,
    });

    res.status(500).json({
      error: 'Terjadi kesalahan internal pada server.',
      errorId: logId,
    });
  });

  return app;
}
