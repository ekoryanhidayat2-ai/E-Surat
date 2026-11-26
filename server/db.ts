import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_LOGIN_PORTAL_COPY,
  DEFAULT_MENU_CONFIGS,
  REGULATION_CATEGORIES,
  STAFF_CATEGORY_OPTIONS,
  type ActivityAction,
  type ActivityEntityType,
  type ActivityLogEntry,
  type AppMenuConfigs,
  type AppMenuKey,
  type AuthUser,
  type BackupRestoreResult,
  type BootstrapData,
  type ClassificationCode,
  type DatabaseSnapshotSummary,
  type DatabaseStorageStatus,
  type Disposition,
  type DispositionRecipient,
  type DispositionStatus,
  type ErrorLogEntry,
  type IncomingLetter,
  type IncomingStatus,
  type LetterDraftRecord,
  type LetterRegulation,
  type LetterUrgency,
  type OutgoingLetter,
  type OutgoingStatus,
  type PublicBranding,
  type RegulationCategory,
  type SchoolSettings,
  type SecurityAlertCategory,
  type SecurityAlertEntry,
  type SecurityAlertSeverity,
  type StaffCategory,
  type StaffRole,
  type YearCounter,
} from '../src/types.ts';
import {
  CLASSIFICATION_SCHEMA_SPEC,
  validateClassificationItemsSchema,
} from '../src/lib/classificationParser.ts';
import { validateRecipientItemsSchema } from '../src/lib/recipientParser.ts';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ConflictError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

const VALID_URGENCIES = new Set<LetterUrgency>(['Biasa', 'Penting', 'Segera', 'Rahasia']);
const VALID_INCOMING_STATUS = new Set<IncomingStatus>([
  'Menunggu Disposisi',
  'Didisposisikan',
  'Diproses',
  'Selesai',
]);
const VALID_OUTGOING_STATUS = new Set<OutgoingStatus>([
  'Draf',
  'Menunggu TTD',
  'Terkirim',
  'Diarsipkan',
]);
const VALID_DISPOSITION_STATUS = new Set<DispositionStatus>([
  'Belum Ditindaklanjuti',
  'Sedang Diproses',
  'Selesai',
]);
const VALID_STAFF_CATEGORIES = new Set<StaffCategory>(STAFF_CATEGORY_OPTIONS);

const ROMAN_MONTHS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

export function toRomanMonth(month1To12: number): string {
  if (month1To12 < 1 || month1To12 > 12) return 'I';
  return ROMAN_MONTHS[month1To12 - 1];
}

export function formatOutgoingLetterNumber(
  pattern: string,
  classificationCode: string,
  sequenceNumber: number,
  schoolCode: string,
  letterDateIso: string
): string {
  const parsed = new Date(`${letterDateIso}T00:00:00`);
  const year = Number.isNaN(parsed.getTime()) ? new Date().getFullYear() : parsed.getFullYear();
  const month = Number.isNaN(parsed.getTime()) ? new Date().getMonth() + 1 : parsed.getMonth() + 1;
  const paddedSeq = String(sequenceNumber).padStart(3, '0');
  const romanMonth = toRomanMonth(month);

  return pattern
    .replaceAll('{kode}', classificationCode)
    .replaceAll('{urut}', paddedSeq)
    .replaceAll('{sekolah}', schoolCode)
    .replaceAll('{bulan}', romanMonth)
    .replaceAll('{tahun}', String(year));
}

function assertNonEmptyText(val: unknown, label: string, maxLen: number): string {
  if (typeof val !== 'string') {
    throw new ValidationError(`${label} wajib berupa teks.`);
  }
  const trimmed = val.trim();
  if (!trimmed) {
    throw new ValidationError(`${label} tidak boleh kosong.`);
  }
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${label} maksimal ${maxLen} karakter.`);
  }
  return trimmed;
}

function assertOptionalText(val: unknown, label: string, maxLen: number): string {
  if (val === undefined || val === null) return '';
  if (typeof val !== 'string') {
    throw new ValidationError(`${label} wajib berupa teks.`);
  }
  const trimmed = val.trim();
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${label} maksimal ${maxLen} karakter.`);
  }
  return trimmed;
}

function assertIsoDate(val: unknown, label: string): string {
  const s = assertNonEmptyText(val, label, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`${label} harus berformat YYYY-MM-DD.`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${label} bukan tanggal yang valid.`);
  }
  return s;
}

const MENU_KEYS: AppMenuKey[] = [
  'dashboard',
  'incoming',
  'outgoing',
  'dispositions',
  'regulations',
  'guide',
  'settings',
];

function cloneDefaultMenuConfigs(): AppMenuConfigs {
  return {
    dashboard: { ...DEFAULT_MENU_CONFIGS.dashboard },
    incoming: { ...DEFAULT_MENU_CONFIGS.incoming },
    outgoing: { ...DEFAULT_MENU_CONFIGS.outgoing },
    dispositions: { ...DEFAULT_MENU_CONFIGS.dispositions },
    regulations: { ...DEFAULT_MENU_CONFIGS.regulations },
    guide: { ...DEFAULT_MENU_CONFIGS.guide },
    settings: { ...DEFAULT_MENU_CONFIGS.settings },
  };
}

function parseMenuConfigs(rawJson: string | undefined): AppMenuConfigs {
  const base = cloneDefaultMenuConfigs();
  if (!rawJson) return base;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, Record<string, unknown>>;
    for (const key of MENU_KEYS) {
      const entry = parsed?.[key];
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.label === 'string' && entry.label.trim()) {
        base[key].label = entry.label.trim().slice(0, 40);
      }
      if (typeof entry.title === 'string' && entry.title.trim()) {
        base[key].title = entry.title.trim().slice(0, 80);
      }
      if (typeof entry.description === 'string') {
        base[key].description = entry.description.trim().slice(0, 300);
      }
    }
  } catch {
    return base;
  }
  return base;
}

function normalizeMenuConfigsInput(
  input: unknown,
  current: AppMenuConfigs
): AppMenuConfigs {
  if (!input || typeof input !== 'object') return current;
  const raw = input as Record<string, unknown>;
  const next = cloneDefaultMenuConfigs();
  for (const key of MENU_KEYS) {
    const candidate = raw[key];
    const fallback = current[key] ?? DEFAULT_MENU_CONFIGS[key];
    if (!candidate || typeof candidate !== 'object') {
      next[key] = { ...fallback };
      continue;
    }
    const obj = candidate as Record<string, unknown>;
    next[key] = {
      label: assertNonEmptyText(
        obj.label !== undefined ? obj.label : fallback.label,
        `Nama menu (${key})`,
        40
      ),
      title: assertNonEmptyText(
        obj.title !== undefined ? obj.title : fallback.title,
        `Judul halaman menu (${key})`,
        80
      ),
      description: assertOptionalText(
        obj.description !== undefined ? obj.description : fallback.description,
        `Keterangan menu (${key})`,
        300
      ),
    };
  }
  return next;
}

interface LoginPortalCopy {
  loginHeadline: string;
  loginDescription: string;
  loginFormTitle: string;
  loginFormSubtitle: string;
}

function parseLoginPortalCopy(rawJson: string | undefined): LoginPortalCopy {
  const base: LoginPortalCopy = { ...DEFAULT_LOGIN_PORTAL_COPY };
  if (!rawJson) return base;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (typeof parsed.loginHeadline === 'string' && parsed.loginHeadline.trim()) {
      base.loginHeadline = parsed.loginHeadline.trim().slice(0, 160);
    }
    if (typeof parsed.loginDescription === 'string') {
      base.loginDescription = parsed.loginDescription.trim().slice(0, 400);
    }
    if (typeof parsed.loginFormTitle === 'string' && parsed.loginFormTitle.trim()) {
      base.loginFormTitle = parsed.loginFormTitle.trim().slice(0, 100);
    }
    if (typeof parsed.loginFormSubtitle === 'string') {
      base.loginFormSubtitle = parsed.loginFormSubtitle.trim().slice(0, 240);
    }
  } catch {
    return base;
  }
  return base;
}

export class PersuratanDatabase {
  readonly db: DatabaseSync;
  readonly dbPath: string;
  private lastCheckpointAt: string;
  private lastAutoBackupAt = '';
  private integrityStatus = 'ok';

  constructor(dbPath: string, seedDemoData = true) {
    this.dbPath = dbPath;
    this.lastCheckpointAt = new Date().toISOString();
    const hadExistingDbFile = dbPath !== ':memory:' && fs.existsSync(dbPath);
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    // Konfigurasi ketahanan & stabilitas penyimpanan SQLite
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = FULL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA wal_autocheckpoint = 10;');
    this.db.exec('PRAGMA temp_store = MEMORY;');

    this.initSchema();
    if (hadExistingDbFile) {
      // Pastikan sisa WAL dari versi/sesi sebelumnya langsung menyatu ke berkas utama
      this.checkpointDatabase('TRUNCATE');
    }
    this.ensureDefaultConfig();
    if (seedDemoData) {
      this.seedIfEmpty();
    }
    this.ensureAutoCurrentYearCounter();
    this.verifyStartupIntegrity();
    if (hadExistingDbFile) {
      this.createAutoSnapshot('startup', true);
    }
  }

  private verifyStartupIntegrity(): void {
    try {
      const checkRow = this.db.prepare('PRAGMA quick_check').get() as
        | Record<string, string>
        | undefined;
      const result = checkRow ? Object.values(checkRow)[0] : 'ok';
      this.integrityStatus = result || 'ok';
      if (this.integrityStatus.toLowerCase() !== 'ok') {
        this.recordSecurityAlert({
          severity: 'critical',
          category: 'INTEGRITY_ALERT',
          title: 'Peringatan Integritas Database SQLite',
          message: `Pemeriksaan integritas startup mengembalikan status: ${this.integrityStatus}`,
          ipAddress: 'localhost',
          route: 'startup',
          method: 'PRAGMA',
        });
      }
    } catch (err) {
      this.integrityStatus = err instanceof Error ? err.message : 'check_failed';
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS school_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        school_name TEXT NOT NULL,
        parent_agency TEXT NOT NULL,
        district_gov TEXT NOT NULL,
        address TEXT NOT NULL,
        postal_code TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        website TEXT NOT NULL,
        npsn TEXT NOT NULL,
        school_code TEXT NOT NULL,
        principal_name TEXT NOT NULL,
        principal_nip TEXT NOT NULL,
        tu_head_name TEXT NOT NULL,
        tu_head_nip TEXT NOT NULL,
        outgoing_format_pattern TEXT NOT NULL,
        logo_url TEXT NOT NULL DEFAULT '',
        kop_image_url TEXT NOT NULL DEFAULT '',
        theme_id TEXT NOT NULL DEFAULT 'navy-dinasti',
        auto_init_new_year_counter INTEGER NOT NULL DEFAULT 1,
        menu_configs_json TEXT NOT NULL DEFAULT '',
        login_portal_json TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS classifications (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS year_counters (
        year INTEGER PRIMARY KEY,
        incoming_last_seq INTEGER NOT NULL DEFAULT 0,
        outgoing_last_seq INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS incoming_letters (
        id TEXT PRIMARY KEY,
        agenda_number TEXT NOT NULL UNIQUE,
        sequence_number INTEGER NOT NULL,
        agenda_year INTEGER NOT NULL,
        letter_number TEXT NOT NULL,
        letter_date TEXT NOT NULL,
        received_date TEXT NOT NULL,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        classification_code TEXT NOT NULL,
        urgency TEXT NOT NULL,
        status TEXT NOT NULL,
        attachment_url TEXT NOT NULL DEFAULT '',
        attachment_name TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispositions (
        id TEXT PRIMARY KEY,
        incoming_letter_id TEXT NOT NULL,
        target_unit TEXT NOT NULL,
        target_staff_name TEXT NOT NULL DEFAULT '',
        instruction TEXT NOT NULL,
        deadline_date TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        completion_note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (incoming_letter_id) REFERENCES incoming_letters(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS outgoing_letters (
        id TEXT PRIMARY KEY,
        sequence_number INTEGER NOT NULL,
        letter_year INTEGER NOT NULL,
        full_letter_number TEXT NOT NULL UNIQUE,
        is_manual_number INTEGER NOT NULL DEFAULT 0,
        classification_code TEXT NOT NULL,
        letter_date TEXT NOT NULL,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        drafter_name TEXT NOT NULL,
        status TEXT NOT NULL,
        attachment_url TEXT NOT NULL DEFAULT '',
        attachment_name TEXT NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS error_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        route TEXT NOT NULL,
        method TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        jabatan TEXT NOT NULL,
        role TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT NOT NULL DEFAULT '',
        actor_username TEXT NOT NULL DEFAULT '',
        actor_display_name TEXT NOT NULL,
        actor_role TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        reference_number TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_alerts (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        route TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        actor_username TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        resolved_by TEXT NOT NULL DEFAULT '',
        resolved_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS login_attempts (
        attempt_key TEXT PRIMARY KEY,
        fail_count INTEGER NOT NULL DEFAULT 0,
        first_fail_at TEXT NOT NULL,
        locked_until TEXT NOT NULL DEFAULT '',
        last_attempt_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS letter_regulations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        regulation_number TEXT NOT NULL,
        year INTEGER NOT NULL,
        category TEXT NOT NULL,
        issuing_body TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        file_url TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        uploaded_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_metadata (
        meta_key TEXT PRIMARY KEY,
        meta_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uploaded_files (
        file_key TEXT PRIMARY KEY,
        url_path TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_blob BLOB NOT NULL,
        uploaded_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_drafts (
        user_id TEXT NOT NULL,
        draft_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, draft_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS disposition_recipients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nip TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_alerts_read_created ON security_alerts(is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_letter_regulations_year_created ON letter_regulations(year DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_uploaded_files_created ON uploaded_files(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_disposition_recipients_cat_name ON disposition_recipients(category, name);
    `);

    // Migrasi aman untuk database lama yang belum memiliki kolom logo_url / theme_id / body_text / sesi metadata
    const cols = this.db
      .prepare('PRAGMA table_info(school_settings)')
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'logo_url')) {
      this.db.exec("ALTER TABLE school_settings ADD COLUMN logo_url TEXT NOT NULL DEFAULT '';");
    }
    if (!cols.some((c) => c.name === 'kop_image_url')) {
      this.db.exec("ALTER TABLE school_settings ADD COLUMN kop_image_url TEXT NOT NULL DEFAULT '';");
    }
    if (!cols.some((c) => c.name === 'theme_id')) {
      this.db.exec("ALTER TABLE school_settings ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'navy-dinasti';");
    }
    if (!cols.some((c) => c.name === 'auto_init_new_year_counter')) {
      this.db.exec("ALTER TABLE school_settings ADD COLUMN auto_init_new_year_counter INTEGER NOT NULL DEFAULT 1;");
    }
    if (!cols.some((c) => c.name === 'menu_configs_json')) {
      this.db.exec("ALTER TABLE school_settings ADD COLUMN menu_configs_json TEXT NOT NULL DEFAULT '';");
    }
    if (!cols.some((c) => c.name === 'login_portal_json')) {
      this.db.exec("ALTER TABLE school_settings ADD COLUMN login_portal_json TEXT NOT NULL DEFAULT '';");
    }

    const outCols = this.db
      .prepare('PRAGMA table_info(outgoing_letters)')
      .all() as Array<{ name: string }>;
    if (!outCols.some((c) => c.name === 'body_text')) {
      this.db.exec("ALTER TABLE outgoing_letters ADD COLUMN body_text TEXT NOT NULL DEFAULT '';");
    }

    const sessCols = this.db
      .prepare('PRAGMA table_info(sessions)')
      .all() as Array<{ name: string }>;
    if (!sessCols.some((c) => c.name === 'ip_address')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN ip_address TEXT NOT NULL DEFAULT '';");
    }
    if (!sessCols.some((c) => c.name === 'user_agent')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';");
    }
  }

  private ensureDefaultConfig(): void {
    const existingSettings = this.db
      .prepare('SELECT id FROM school_settings WHERE id = 1')
      .get();

    if (!existingSettings) {
      this.db
        .prepare(
          `INSERT INTO school_settings (
            id, school_name, parent_agency, district_gov, address, postal_code,
            phone, email, website, npsn, school_code, principal_name, principal_nip,
            tu_head_name, tu_head_nip, outgoing_format_pattern, logo_url,
            kop_image_url, theme_id, menu_configs_json, login_portal_json
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 'navy-dinasti', '', '')`
        )
        .run(
          'SMP Negeri 2 Girimulyo',
          'Dinas Pendidikan Pemuda dan Olahraga',
          'Pemerintah Kabupaten Kulon Progo',
          'Jetis, Pendoworejo, Kapanewon Girimulyo, Kab. Kulon Progo, DIY',
          '55674',
          '(0274) 774208',
          'tu@smpn2girimulyo.sch.id',
          'smpn2girimulyo.sch.id',
          '20402759',
          'SMPN2-GR',
          'Drs. Bambang Suryanto, M.Pd.',
          '19680514 199412 1 002',
          'Rina Wulandari, S.Pd.',
          '19790821 200902 2 004',
          '{kode}/{urut}/{sekolah}/{bulan}/{tahun}'
        );
    }

    const userCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }
    ).cnt;

    if (userCount === 0) {
      const now = new Date().toISOString();
      const insertUser = this.db.prepare(
        `INSERT INTO users (id, username, password_hash, display_name, jabatan, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      );
      insertUser.run(
        'usr_admin_tu',
        'admin',
        hashPassword('sperogir1234'),
        'Eko Ryan Hidayat',
        'Staf Tata Usaha',
        'admin',
        now
      );
      insertUser.run(
        'usr_kepsek',
        'kepsek',
        hashPassword('kepsek2026'),
        'Drs. Bambang Suryanto, M.Pd.',
        'Kepala Sekolah',
        'kepala_sekolah',
        now
      );
      insertUser.run(
        'usr_staf',
        'staf_kurikulum',
        hashPassword('staf2026'),
        'Agus Prasetyo, S.Pd.',
        'Waka Kesiswaan / Guru',
        'staf',
        now
      );
    } else {
      const legacyAdmin = this.db
        .prepare("SELECT id FROM users WHERE id = 'usr_admin_tu' AND LOWER(username) = 'tu_admin'")
        .get();
      const existingAdmin = this.db
        .prepare("SELECT id FROM users WHERE LOWER(username) = 'admin'")
        .get();
      if (legacyAdmin && !existingAdmin) {
        this.db
          .prepare("UPDATE users SET username = 'admin', password_hash = ? WHERE id = 'usr_admin_tu'")
          .run(hashPassword('sperogir1234'));
        this.db.prepare("DELETE FROM sessions WHERE user_id = 'usr_admin_tu'").run();
      }
      this.db
        .prepare(
          "UPDATE users SET display_name = 'Eko Ryan Hidayat', jabatan = 'Staf Tata Usaha' WHERE id = 'usr_admin_tu' AND (display_name = 'Rina Wulandari, S.Pd.' OR jabatan = 'Kepala Urusan Tata Usaha')"
        )
        .run();
      this.db
        .prepare(
          "UPDATE activity_logs SET actor_username = 'admin', actor_display_name = 'Eko Ryan Hidayat' WHERE actor_user_id = 'usr_admin_tu' AND (actor_display_name = 'Rina Wulandari, S.Pd.' OR actor_username = 'tu_admin')"
        )
        .run();
    }

    // Perbarui label unit lama "Kepala Urusan Tata Usaha" -> "Bagian Tata Usaha" pada data yang sudah ada
    this.db
      .prepare(
        "UPDATE outgoing_letters SET drafter_name = 'Bagian Tata Usaha' WHERE drafter_name = 'Kepala Urusan Tata Usaha'"
      )
      .run();
    this.db
      .prepare(
        "UPDATE dispositions SET target_unit = 'Bagian Tata Usaha' WHERE target_unit = 'Kepala Urusan Tata Usaha'"
      )
      .run();

    const classCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM classifications').get() as { cnt: number }
    ).cnt;

    if (classCount === 0) {
      const defaults: ClassificationCode[] = [
        { code: '005', name: 'Undangan Dinas', description: 'Undangan rapat, koordinasi, atau upacara resmi' },
        { code: '421.3', name: 'Pendidikan Menengah Pertama', description: 'Urusan pembelajaran, ujian, kelulusan, dan kesiswaan SMP' },
        { code: '422', name: 'Administrasi Sekolah', description: 'Tata laksana sekolah, kalender pendidikan, PPDB/SPMB' },
        { code: '423', name: 'Kurikulum & Asesmen', description: 'Perangkat ajar, ANBK, TKA, dan supervisi akademik' },
        { code: '800', name: 'Kepegawaian', description: 'SK pembagian tugas, cuti, mutasi, dan pembinaan ASN/PPPK' },
        { code: '900', name: 'Keuangan & BOS', description: 'RKAS, pelaporan dana BOS, dan pertanggungjawaban keuangan' },
      ];
      const stmt = this.db.prepare(
        'INSERT INTO classifications (code, name, description) VALUES (?, ?, ?)'
      );
      for (const item of defaults) {
        stmt.run(item.code, item.name, item.description);
      }
    }

    const staffSeedFlag = this.db
      .prepare("SELECT meta_value FROM app_metadata WHERE meta_key = 'initial_staff_directory_done'")
      .get() as { meta_value: string } | undefined;

    if (staffSeedFlag?.meta_value !== '1') {
      const recipientCount = (
        this.db.prepare('SELECT COUNT(*) AS cnt FROM disposition_recipients').get() as {
          cnt: number;
        }
      ).cnt;
      const now = new Date().toISOString();
      if (recipientCount === 0) {
        const starterRecipients: Array<{
          id: string;
          name: string;
          nip: string;
          category: StaffCategory;
          unit: string;
        }> = [
          {
            id: 'rec_seed_001',
            name: 'Agus Prasetyo, S.Pd.',
            nip: '',
            category: 'Guru',
            unit: 'Wakil Kepala Sekolah Bidang Kesiswaan',
          },
          {
            id: 'rec_seed_002',
            name: 'Rina Wulandari, S.Pd.',
            nip: '19790821 200902 2 004',
            category: 'Guru',
            unit: 'Wakil Kepala Sekolah Bidang Kurikulum',
          },
          {
            id: 'rec_seed_003',
            name: 'Eko Ryan Hidayat',
            nip: '',
            category: 'Karyawan',
            unit: 'Bagian Tata Usaha',
          },
          {
            id: 'rec_seed_004',
            name: 'Sri Handayani, S.E.',
            nip: '',
            category: 'Karyawan',
            unit: 'Bendahara BOS / Keuangan',
          },
        ];
        const stmt = this.db.prepare(
          `INSERT INTO disposition_recipients (
            id, name, nip, category, unit, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        );
        for (const r of starterRecipients) {
          stmt.run(r.id, r.name, r.nip, r.category, r.unit, now, now);
        }
      }
      this.db
        .prepare(
          `INSERT INTO app_metadata (meta_key, meta_value, updated_at)
           VALUES ('initial_staff_directory_done', '1', ?)
           ON CONFLICT(meta_key) DO UPDATE SET meta_value = '1', updated_at = excluded.updated_at`
        )
        .run(now);
    }
  }

  private seedIfEmpty(): void {
    const seedFlag = this.db
      .prepare("SELECT meta_value FROM app_metadata WHERE meta_key = 'initial_seed_done'")
      .get() as { meta_value: string } | undefined;

    if (seedFlag?.meta_value === '1') {
      return;
    }

    const incomingCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM incoming_letters').get() as { cnt: number }
    ).cnt;
    const outgoingCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM outgoing_letters').get() as { cnt: number }
    ).cnt;
    const regulationCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM letter_regulations').get() as { cnt: number }
    ).cnt;

    if (incomingCount === 0 && outgoingCount === 0 && regulationCount === 0) {
      const now = new Date().toISOString();
      const seedIncoming = [
        {
          id: 'in_seed_001',
          agendaNumber: 'AGD-2026-001',
          sequenceNumber: 1,
          agendaYear: 2026,
          letterNumber: '421.3/1184/Disdikpora/2026',
          letterDate: '2026-11-12',
          receivedDate: '2026-11-13',
          sender: 'Dinas Pendidikan Pemuda dan Olahraga Kab. Kulon Progo',
          subject: 'Undangan Rapat Koordinasi Persiapan Asesmen Akhir Semester Ganjil Tahun Ajaran 2026/2027',
          classificationCode: '005',
          urgency: 'Segera',
          status: 'Menunggu Disposisi',
          notes: 'Rapat dilaksanakan di Aula Adikarto Disdikpora Kulon Progo pukul 09.00 WIB.',
          createdBy: 'Staf Tata Usaha',
        },
        {
          id: 'in_seed_002',
          agendaNumber: 'AGD-2026-002',
          sequenceNumber: 2,
          agendaYear: 2026,
          letterNumber: '900/412/BPKAD-KP/XI/2026',
          letterDate: '2026-11-08',
          receivedDate: '2026-11-10',
          sender: 'Tim Manajemen BOS Kabupaten Kulon Progo',
          subject: 'Pemberitahuan Batas Akhir Pelaporan Realisasi Dana BOS Tahap II Tahun 2026',
          classificationCode: '900',
          urgency: 'Penting',
          status: 'Didisposisikan',
          notes: 'Melampirkan format rekonsiliasi ARKAS terbaru.',
          createdBy: 'Staf Tata Usaha',
        },
        {
          id: 'in_seed_003',
          agendaNumber: 'AGD-2026-003',
          sequenceNumber: 3,
          agendaYear: 2026,
          letterNumber: '440/089/PKM-GR1/XI/2026',
          letterDate: '2026-11-03',
          receivedDate: '2026-11-04',
          sender: 'UPTD Puskesmas Girimulyo I',
          subject: 'Jadwal Pelaksanaan Skrining Kesehatan Berkala & Pemberian Tablet Tambah Darah Siswa',
          classificationCode: '421.3',
          urgency: 'Biasa',
          status: 'Selesai',
          notes: 'Kegiatan telah terlaksana di aula sekolah pada 7 November 2026.',
          createdBy: 'Staf Tata Usaha',
        },
      ];

      const insertIn = this.db.prepare(`
        INSERT INTO incoming_letters (
          id, agenda_number, sequence_number, agenda_year, letter_number,
          letter_date, received_date, sender, subject, classification_code,
          urgency, status, attachment_url, attachment_name, notes, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?)
      `);

      for (const l of seedIncoming) {
        insertIn.run(
          l.id,
          l.agendaNumber,
          l.sequenceNumber,
          l.agendaYear,
          l.letterNumber,
          l.letterDate,
          l.receivedDate,
          l.sender,
          l.subject,
          l.classificationCode,
          l.urgency,
          l.status,
          l.notes,
          l.createdBy,
          now,
          now
        );
      }

      const insertDisp = this.db.prepare(`
        INSERT INTO dispositions (
          id, incoming_letter_id, target_unit, target_staff_name, instruction,
          deadline_date, status, completion_note, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertDisp.run(
        'disp_seed_001',
        'in_seed_002',
        'Bendahara BOS / Keuangan',
        'Sri Handayani, S.E.',
        'Segera siapkan dokumen rekonsiliasi ARKAS Tahap II dan laporkan sebelum tanggal 20 November.',
        '2026-11-20',
        'Sedang Diproses',
        'Rekap kuitansi belanja operasional sedang diverifikasi.',
        'Kepala Sekolah',
        now,
        now
      );

      insertDisp.run(
        'disp_seed_002',
        'in_seed_003',
        'Wakil Kepala Sekolah Bidang Kesiswaan',
        'Agus Prasetyo, S.Pd.',
        'Koordinasikan jadwal kelas VII–IX bersama Tim UKS.',
        '2026-11-06',
        'Selesai',
        'Seluruh siswa kelas VII–IX telah mengikuti skrining dengan tertib.',
        'Kepala Sekolah',
        now,
        now
      );

      const insertOut = this.db.prepare(`
        INSERT INTO outgoing_letters (
          id, sequence_number, letter_year, full_letter_number, is_manual_number,
          classification_code, letter_date, recipient, subject, drafter_name,
          status, attachment_url, attachment_name, body_text, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)
      `);

      insertOut.run(
        'out_seed_001',
        1,
        2026,
        '005/001/SMPN2-GR/XI/2026',
        '005',
        '2026-11-14',
        'Orang Tua / Wali Siswa Kelas IX SMP Negeri 2 Girimulyo',
        'Undangan Sosialisasi Persiapan Asesmen Akhir Semester & Pemetaan Lanjut SMA/SMK',
        'Wakil Kepala Sekolah Bidang Kurikulum',
        'Terkirim',
        'Dengan hormat,\n\nSehubungan dengan persiapan pelaksanaan Asesmen Akhir Semester Gasal Tahun Ajaran 2026/2027 serta pendampingan pemetaan jalur pendidikan lanjutan ke jenjang SMA/SMK, kami mengundang Bapak/Ibu Orang Tua/Wali Siswa Kelas IX untuk menghadiri pertemuan sosialisasi yang akan dilaksanakan pada:\n\nHari / Tanggal : Kamis, 19 November 2026\nWaktu          : Pukul 08.30 WIB s.d. selesai\nTempat         : Aula SMP Negeri 2 Girimulyo\n\nMengingat pentingnya informasi yang akan disampaikan, kami mohon kehadiran Bapak/Ibu tepat pada waktunya.\n\nAtas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.',
        'Disampaikan melalui surat edaran cetak dan grup wali kelas.',
        'Staf Tata Usaha',
        now,
        now
      );

      insertOut.run(
        'out_seed_002',
        2,
        2026,
        '800/002/SMPN2-GR/XI/2026',
        '800',
        '2026-11-16',
        'Kepala Dinas Pendidikan Pemuda dan Olahraga Kab. Kulon Progo',
        'Permohonan Surat Tugas Guru Pendamping Lomba Olimpiade Sains Nasional Tingkat Kabupaten',
        'Bagian Tata Usaha',
        'Menunggu TTD',
        'Dengan hormat,\n\nDalam rangka keikutsertaan peserta didik SMP Negeri 2 Girimulyo pada ajang Olimpiade Sains Nasional (OSN) Tingkat Kabupaten Kulon Progo Tahun 2026, bersama ini kami mengajukan permohonan penerbitan Surat Tugas bagi guru pembimbing dan pendamping kontingen sekolah.\n\nDemikian permohonan ini kami sampaikan. Atas perhatian dan perkenan Bapak/Ibu Kepala Dinas, kami ucapkan terima kasih.',
        'Menunggu tanda tangan Kepala Sekolah.',
        'Staf Tata Usaha',
        now,
        now
      );

      this.db
        .prepare(
          'INSERT OR REPLACE INTO year_counters (year, incoming_last_seq, outgoing_last_seq) VALUES (?, ?, ?)'
        )
        .run(2026, 3, 2);

      const insertActivity = this.db.prepare(`
        INSERT INTO activity_logs (
          id, actor_user_id, actor_username, actor_display_name, actor_role,
          action, entity_type, entity_id, reference_number, subject, details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const seedActivities = [
        {
          id: 'act_seed_001',
          actorUserId: 'usr_admin_tu',
          actorUsername: 'admin',
          actorDisplayName: 'Eko Ryan Hidayat',
          actorRole: 'admin',
          action: 'CREATE',
          entityType: 'incoming',
          entityId: 'in_seed_001',
          referenceNumber: 'AGD-2026-001',
          subject: 'Undangan Rapat Koordinasi Persiapan Asesmen Akhir Semester Ganjil Tahun Ajaran 2026/2027',
          details: 'Mencatat surat masuk baru dari Dinas Pendidikan Pemuda dan Olahraga Kab. Kulon Progo',
        },
        {
          id: 'act_seed_002',
          actorUserId: 'usr_admin_tu',
          actorUsername: 'admin',
          actorDisplayName: 'Eko Ryan Hidayat',
          actorRole: 'admin',
          action: 'CREATE',
          entityType: 'incoming',
          entityId: 'in_seed_002',
          referenceNumber: 'AGD-2026-002',
          subject: 'Pemberitahuan Batas Akhir Pelaporan Realisasi Dana BOS Tahap II Tahun 2026',
          details: 'Mencatat surat masuk baru dari Tim Manajemen BOS Kabupaten Kulon Progo',
        },
        {
          id: 'act_seed_003',
          actorUserId: 'usr_admin_tu',
          actorUsername: 'admin',
          actorDisplayName: 'Eko Ryan Hidayat',
          actorRole: 'admin',
          action: 'CREATE',
          entityType: 'incoming',
          entityId: 'in_seed_003',
          referenceNumber: 'AGD-2026-003',
          subject: 'Jadwal Pelaksanaan Skrining Kesehatan Berkala & Pemberian Tablet Tambah Darah Siswa',
          details: 'Mencatat surat masuk baru dari UPTD Puskesmas Girimulyo I',
        },
        {
          id: 'act_seed_004',
          actorUserId: 'usr_admin_tu',
          actorUsername: 'admin',
          actorDisplayName: 'Eko Ryan Hidayat',
          actorRole: 'admin',
          action: 'CREATE',
          entityType: 'outgoing',
          entityId: 'out_seed_001',
          referenceNumber: '005/001/SMPN2-GR/XI/2026',
          subject: 'Undangan Sosialisasi Persiapan Asesmen Akhir Semester & Pemetaan Lanjut SMA/SMK',
          details: 'Membuat surat keluar baru kepada Orang Tua / Wali Siswa Kelas IX SMP Negeri 2 Girimulyo',
        },
        {
          id: 'act_seed_005',
          actorUserId: 'usr_admin_tu',
          actorUsername: 'admin',
          actorDisplayName: 'Eko Ryan Hidayat',
          actorRole: 'admin',
          action: 'CREATE',
          entityType: 'outgoing',
          entityId: 'out_seed_002',
          referenceNumber: '800/002/SMPN2-GR/XI/2026',
          subject: 'Permohonan Surat Tugas Guru Pendamping Lomba Olimpiade Sains Nasional Tingkat Kabupaten',
          details: 'Membuat surat keluar baru kepada Kepala Dinas Pendidikan Pemuda dan Olahraga Kab. Kulon Progo',
        },
      ];
      for (const act of seedActivities) {
        insertActivity.run(
          act.id,
          act.actorUserId,
          act.actorUsername,
          act.actorDisplayName,
          act.actorRole,
          act.action,
          act.entityType,
          act.entityId,
          act.referenceNumber,
          act.subject,
          act.details,
          now
        );
      }
    }

    // Tandai bahwa inisialisasi awal telah selesai agar update/restart tidak menimpa data pengguna
    this.db
      .prepare(
        `INSERT INTO app_metadata (meta_key, meta_value, updated_at)
         VALUES ('initial_seed_done', '1', ?)
         ON CONFLICT(meta_key) DO NOTHING`
      )
      .run(new Date().toISOString());
  }

  getPublicBranding(): PublicBranding {
    const s = this.getSettings();
    return {
      schoolName: s.schoolName,
      parentAgency: s.parentAgency,
      districtGov: s.districtGov,
      address: `${s.address} ${s.postalCode}`.trim(),
      logoUrl: s.logoUrl,
      loginHeadline: s.loginHeadline,
      loginDescription: s.loginDescription,
      loginFormTitle: s.loginFormTitle,
      loginFormSubtitle: s.loginFormSubtitle,
    };
  }

  getSettings(): SchoolSettings {
    const row = this.db.prepare('SELECT * FROM school_settings WHERE id = 1').get() as Record<
      string,
      string | number
    >;
    const loginPortal = parseLoginPortalCopy(String(row.login_portal_json || ''));
    return {
      schoolName: String(row.school_name),
      parentAgency: String(row.parent_agency),
      districtGov: String(row.district_gov),
      address: String(row.address),
      postalCode: String(row.postal_code),
      phone: String(row.phone),
      email: String(row.email),
      website: String(row.website),
      npsn: String(row.npsn),
      schoolCode: String(row.school_code),
      principalName: String(row.principal_name),
      principalNip: String(row.principal_nip),
      tuHeadName: String(row.tu_head_name),
      tuHeadNip: String(row.tu_head_nip),
      outgoingFormatPattern: String(row.outgoing_format_pattern),
      logoUrl: String(row.logo_url || ''),
      kopImageUrl: String(row.kop_image_url || ''),
      themeId: String(row.theme_id || 'navy-dinasti'),
      autoInitNewYearCounter:
        row.auto_init_new_year_counter === undefined
          ? true
          : Boolean(Number(row.auto_init_new_year_counter)),
      menuConfigs: parseMenuConfigs(String(row.menu_configs_json || '')),
      loginHeadline: loginPortal.loginHeadline,
      loginDescription: loginPortal.loginDescription,
      loginFormTitle: loginPortal.loginFormTitle,
      loginFormSubtitle: loginPortal.loginFormSubtitle,
    };
  }

  updateSettings(input: Partial<SchoolSettings>): SchoolSettings {
    const current = this.getSettings();
    const merged: SchoolSettings = {
      schoolName: assertNonEmptyText(input.schoolName ?? current.schoolName, 'Nama sekolah', 120),
      parentAgency: assertNonEmptyText(input.parentAgency ?? current.parentAgency, 'Instansi induk', 140),
      districtGov: assertNonEmptyText(input.districtGov ?? current.districtGov, 'Pemerintah daerah', 140),
      address: assertNonEmptyText(input.address ?? current.address, 'Alamat sekolah', 240),
      postalCode: assertOptionalText(input.postalCode ?? current.postalCode, 'Kode pos', 12),
      phone: assertOptionalText(input.phone ?? current.phone, 'Telepon', 40),
      email: assertOptionalText(input.email ?? current.email, 'Email', 100),
      website: assertOptionalText(input.website ?? current.website, 'Website', 120),
      npsn: assertOptionalText(input.npsn ?? current.npsn, 'NPSN', 20),
      schoolCode: assertNonEmptyText(input.schoolCode ?? current.schoolCode, 'Kode singkatan sekolah', 24),
      principalName: assertNonEmptyText(input.principalName ?? current.principalName, 'Nama Kepala Sekolah', 120),
      principalNip: assertOptionalText(input.principalNip ?? current.principalNip, 'NIP Kepala Sekolah', 40),
      tuHeadName: assertNonEmptyText(input.tuHeadName ?? current.tuHeadName, 'Nama Kepala TU', 120),
      tuHeadNip: assertOptionalText(input.tuHeadNip ?? current.tuHeadNip, 'NIP Kepala TU', 40),
      outgoingFormatPattern: assertNonEmptyText(
        input.outgoingFormatPattern ?? current.outgoingFormatPattern,
        'Pola nomor surat',
        80
      ),
      logoUrl: assertOptionalText(input.logoUrl ?? current.logoUrl, 'URL logo sekolah', 500),
      kopImageUrl: assertOptionalText(
        input.kopImageUrl ?? current.kopImageUrl,
        'URL gambar kop surat sekolah',
        500
      ),
      themeId:
        assertOptionalText(input.themeId ?? current.themeId, 'Tema tampilan', 50) ||
        'navy-dinasti',
      autoInitNewYearCounter:
        typeof input.autoInitNewYearCounter === 'boolean'
          ? input.autoInitNewYearCounter
          : current.autoInitNewYearCounter,
      menuConfigs: normalizeMenuConfigsInput(input.menuConfigs, current.menuConfigs),
      loginHeadline: assertNonEmptyText(
        input.loginHeadline ?? current.loginHeadline,
        'Judul utama portal login',
        160
      ),
      loginDescription: assertOptionalText(
        input.loginDescription ?? current.loginDescription,
        'Keterangan portal login',
        400
      ),
      loginFormTitle: assertNonEmptyText(
        input.loginFormTitle ?? current.loginFormTitle,
        'Judul kotak login',
        100
      ),
      loginFormSubtitle: assertOptionalText(
        input.loginFormSubtitle ?? current.loginFormSubtitle,
        'Keterangan kotak login',
        240
      ),
    };

    const loginPortalJson = JSON.stringify({
      loginHeadline: merged.loginHeadline,
      loginDescription: merged.loginDescription,
      loginFormTitle: merged.loginFormTitle,
      loginFormSubtitle: merged.loginFormSubtitle,
    });

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `UPDATE school_settings SET
            school_name = ?, parent_agency = ?, district_gov = ?, address = ?,
            postal_code = ?, phone = ?, email = ?, website = ?, npsn = ?,
            school_code = ?, principal_name = ?, principal_nip = ?,
            tu_head_name = ?, tu_head_nip = ?, outgoing_format_pattern = ?,
            logo_url = ?, kop_image_url = ?, theme_id = ?, auto_init_new_year_counter = ?,
            menu_configs_json = ?, login_portal_json = ?
          WHERE id = 1`
        )
        .run(
          merged.schoolName,
          merged.parentAgency,
          merged.districtGov,
          merged.address,
          merged.postalCode,
          merged.phone,
          merged.email,
          merged.website,
          merged.npsn,
          merged.schoolCode,
          merged.principalName,
          merged.principalNip,
          merged.tuHeadName,
          merged.tuHeadNip,
          merged.outgoingFormatPattern,
          merged.logoUrl,
          merged.kopImageUrl,
          merged.themeId,
          merged.autoInitNewYearCounter ? 1 : 0,
          JSON.stringify(merged.menuConfigs),
          loginPortalJson
        );
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.flushWriteToDisk();
    return merged;
  }

  listClassifications(): ClassificationCode[] {
    const rows = this.db
      .prepare('SELECT code, name, description FROM classifications ORDER BY code ASC')
      .all() as Array<Record<string, string>>;
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
    }));
  }

  upsertClassification(input: { code: string; name: string; description?: string }): ClassificationCode {
    const code = assertNonEmptyText(input.code, 'Kode klasifikasi', CLASSIFICATION_SCHEMA_SPEC.codeMaxLength);
    if (!CLASSIFICATION_SCHEMA_SPEC.codePattern.test(code)) {
      throw new ValidationError(
        'Format kode klasifikasi tidak valid. Gunakan huruf/angka tanpa spasi (boleh titik, garis miring, atau tanda hubung).'
      );
    }
    const name = assertNonEmptyText(input.name, 'Nama klasifikasi', CLASSIFICATION_SCHEMA_SPEC.nameMaxLength);
    const description = assertOptionalText(
      input.description,
      'Deskripsi klasifikasi',
      CLASSIFICATION_SCHEMA_SPEC.descriptionMaxLength
    );
    this.db
      .prepare(
        `INSERT INTO classifications (code, name, description)
         VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`
      )
      .run(code, name, description);
    this.flushWriteToDisk();
    return { code, name, description };
  }

  deleteClassification(code: string): void {
    const result = this.db.prepare('DELETE FROM classifications WHERE code = ?').run(code);
    if (result.changes === 0) {
      throw new NotFoundError(`Kode klasifikasi "${code}" tidak ditemukan.`);
    }
    this.flushWriteToDisk();
  }

  importClassifications(
    rawItems: Array<{ code: string; name: string; description?: string }>,
    mode: 'merge' | 'replace' = 'merge'
  ): {
    mode: 'merge' | 'replace';
    totalProcessed: number;
    inserted: number;
    updated: number;
    totalClassifications: number;
    items: ClassificationCode[];
  } {
    const checked = validateClassificationItemsSchema(rawItems, mode);
    if (!checked.valid) {
      throw new ValidationError(
        checked.errors[0]?.message || 'Data kode klasifikasi tidak memenuhi skema yang valid.'
      );
    }

    const normalizedItems = checked.items;
    const effectiveMode = checked.mode;
    let inserted = 0;
    let updated = 0;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existingCodes = new Set<string>(
        (
          this.db.prepare('SELECT code FROM classifications').all() as Array<{ code: string }>
        ).map((r) => String(r.code))
      );

      if (effectiveMode === 'replace') {
        this.db.prepare('DELETE FROM classifications').run();
      }

      const stmt = this.db.prepare(
        `INSERT INTO classifications (code, name, description)
         VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`
      );

      for (const item of normalizedItems) {
        stmt.run(item.code, item.name, item.description);
        if (effectiveMode === 'merge' && existingCodes.has(item.code)) {
          updated += 1;
        } else {
          inserted += 1;
        }
      }

      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Abaikan jika sudah rollback
      }
      throw err;
    }

    this.flushWriteToDisk();
    const items = this.listClassifications();
    return {
      mode: effectiveMode,
      totalProcessed: normalizedItems.length,
      inserted,
      updated,
      totalClassifications: items.length,
      items,
    };
  }

  // --- Direktori Guru & Karyawan Penerima Disposisi ---
  private mapDispositionRecipientRow(
    row: Record<string, string | number>
  ): DispositionRecipient {
    const rawCat = String(row.category);
    const category: StaffCategory = VALID_STAFF_CATEGORIES.has(rawCat as StaffCategory)
      ? (rawCat as StaffCategory)
      : 'Guru';
    return {
      id: String(row.id),
      name: String(row.name),
      nip: String(row.nip || ''),
      category,
      unit: String(row.unit || ''),
      isActive: Boolean(row.is_active),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listDispositionRecipients(activeOnly = false): DispositionRecipient[] {
    const rows = activeOnly
      ? (this.db
          .prepare(
            'SELECT * FROM disposition_recipients WHERE is_active = 1 ORDER BY category ASC, name ASC'
          )
          .all() as Array<Record<string, string | number>>)
      : (this.db
          .prepare(
            'SELECT * FROM disposition_recipients ORDER BY is_active DESC, category ASC, name ASC'
          )
          .all() as Array<Record<string, string | number>>);
    return rows.map((r) => this.mapDispositionRecipientRow(r));
  }

  createDispositionRecipient(input: {
    name?: unknown;
    nip?: unknown;
    category?: unknown;
    unit?: unknown;
    isActive?: unknown;
  }): DispositionRecipient {
    const name = assertNonEmptyText(input.name, 'Nama guru atau karyawan', 120);
    const nip = assertOptionalText(input.nip, 'NIP', 40);
    const rawCategory =
      input.category === undefined || input.category === null || input.category === ''
        ? 'Guru'
        : String(input.category).trim();
    if (!VALID_STAFF_CATEGORIES.has(rawCategory as StaffCategory)) {
      throw new ValidationError('Kategori penerima harus Guru atau Karyawan.');
    }
    const category = rawCategory as StaffCategory;
    const unit = assertOptionalText(input.unit, 'Unit / Jabatan', 160);
    const isActive = input.isActive === undefined ? true : Boolean(input.isActive);

    const dup = this.db
      .prepare('SELECT id FROM disposition_recipients WHERE LOWER(name) = LOWER(?)')
      .get(name);
    if (dup) {
      throw new ConflictError(`Nama "${name}" sudah terdaftar pada daftar Guru & Karyawan.`);
    }

    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO disposition_recipients (
          id, name, nip, category, unit, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, name, nip, category, unit, isActive ? 1 : 0, now, now);

    const created = this.db
      .prepare('SELECT * FROM disposition_recipients WHERE id = ?')
      .get(id) as Record<string, string | number>;
    this.flushWriteToDisk();
    return this.mapDispositionRecipientRow(created);
  }

  updateDispositionRecipient(
    id: string,
    input: {
      name?: unknown;
      nip?: unknown;
      category?: unknown;
      unit?: unknown;
      isActive?: unknown;
    }
  ): DispositionRecipient {
    const existingRow = this.db
      .prepare('SELECT * FROM disposition_recipients WHERE id = ?')
      .get(id) as Record<string, string | number> | undefined;
    if (!existingRow) {
      throw new NotFoundError('Data guru atau karyawan tidak ditemukan.');
    }
    const current = this.mapDispositionRecipientRow(existingRow);

    const nextName =
      input.name !== undefined
        ? assertNonEmptyText(input.name, 'Nama guru atau karyawan', 120)
        : current.name;
    const nextNip =
      input.nip !== undefined ? assertOptionalText(input.nip, 'NIP', 40) : current.nip;
    let nextCategory = current.category;
    if (input.category !== undefined) {
      const rawCat = String(input.category).trim();
      if (!VALID_STAFF_CATEGORIES.has(rawCat as StaffCategory)) {
        throw new ValidationError('Kategori penerima harus Guru atau Karyawan.');
      }
      nextCategory = rawCat as StaffCategory;
    }
    const nextUnit =
      input.unit !== undefined
        ? assertOptionalText(input.unit, 'Unit / Jabatan', 160)
        : current.unit;
    const nextIsActive =
      input.isActive !== undefined ? Boolean(input.isActive) : current.isActive;

    const dup = this.db
      .prepare('SELECT id FROM disposition_recipients WHERE LOWER(name) = LOWER(?) AND id != ?')
      .get(nextName, id);
    if (dup) {
      throw new ConflictError(`Nama "${nextName}" sudah digunakan oleh data penerima lain.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE disposition_recipients
         SET name = ?, nip = ?, category = ?, unit = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nextName, nextNip, nextCategory, nextUnit, nextIsActive ? 1 : 0, now, id);

    const updated = this.db
      .prepare('SELECT * FROM disposition_recipients WHERE id = ?')
      .get(id) as Record<string, string | number>;
    this.flushWriteToDisk();
    return this.mapDispositionRecipientRow(updated);
  }

  deleteDispositionRecipient(id: string): void {
    const result = this.db.prepare('DELETE FROM disposition_recipients WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Data guru atau karyawan tidak ditemukan.');
    }
    this.flushWriteToDisk();
  }

  importDispositionRecipients(
    rawItems: unknown,
    mode: 'merge' | 'replace' = 'merge'
  ): {
    mode: 'merge' | 'replace';
    totalProcessed: number;
    inserted: number;
    updated: number;
    totalRecipients: number;
    items: DispositionRecipient[];
  } {
    const checked = validateRecipientItemsSchema(rawItems);
    if (!checked.valid) {
      throw new ValidationError(
        checked.errors[0]?.message || 'Data guru dan karyawan tidak memenuhi skema yang valid.'
      );
    }

    const normalizedItems = checked.items;
    let inserted = 0;
    let updated = 0;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (mode === 'replace') {
        this.db.prepare('DELETE FROM disposition_recipients').run();
      }

      const existingRows = this.db
        .prepare('SELECT id, name FROM disposition_recipients')
        .all() as Array<{ id: string; name: string }>;
      const existingMap = new Map<string, string>();
      existingRows.forEach((r) => existingMap.set(r.name.toLowerCase(), r.id));

      const now = new Date().toISOString();
      const insertStmt = this.db.prepare(
        `INSERT INTO disposition_recipients (
           id, name, nip, category, unit, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const updateStmt = this.db.prepare(
        `UPDATE disposition_recipients
         SET nip = ?, category = ?, unit = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      );

      for (const item of normalizedItems) {
        const lowerName = item.name.toLowerCase();
        const existingId = existingMap.get(lowerName);
        if (mode === 'merge' && existingId) {
          updateStmt.run(item.nip, item.category, item.unit, item.isActive ? 1 : 0, now, existingId);
          updated += 1;
        } else {
          const newId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          insertStmt.run(
            newId,
            item.name,
            item.nip,
            item.category,
            item.unit,
            item.isActive ? 1 : 0,
            now,
            now
          );
          existingMap.set(lowerName, newId);
          inserted += 1;
        }
      }

      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Abaikan
      }
      throw err;
    }

    this.flushWriteToDisk();
    const items = this.listDispositionRecipients();
    return {
      mode,
      totalProcessed: normalizedItems.length,
      inserted,
      updated,
      totalRecipients: items.length,
      items,
    };
  }

  // --- Referensi Peraturan Persuratan (PDF) ---
  private mapRegulationRow(row: Record<string, string | number>): LetterRegulation {
    return {
      id: String(row.id),
      title: String(row.title),
      regulationNumber: String(row.regulation_number),
      year: Number(row.year),
      category: String(row.category) as RegulationCategory,
      issuingBody: String(row.issuing_body),
      summary: String(row.summary),
      fileUrl: String(row.file_url),
      fileName: String(row.file_name),
      fileSizeBytes: Number(row.file_size_bytes),
      uploadedBy: String(row.uploaded_by),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listRegulations(): LetterRegulation[] {
    const rows = this.db
      .prepare('SELECT * FROM letter_regulations ORDER BY year DESC, created_at DESC, rowid DESC')
      .all() as Array<Record<string, string | number>>;
    return rows.map((r) => this.mapRegulationRow(r));
  }

  private assertValidPdfAttachment(
    fileUrlRaw: unknown,
    fileNameRaw: unknown
  ): { fileUrl: string; fileName: string } {
    const fileUrl = assertNonEmptyText(fileUrlRaw, 'Berkas PDF peraturan', 500);
    const fileName = assertNonEmptyText(fileNameRaw, 'Nama berkas PDF', 160);
    if (!fileUrl.startsWith('/uploads/') || fileUrl.includes('..')) {
      throw new ValidationError('URL berkas PDF peraturan tidak valid.');
    }
    if (!fileName.toLowerCase().endsWith('.pdf') && !fileUrl.toLowerCase().endsWith('.pdf')) {
      throw new ValidationError('Referensi peraturan hanya mendukung berkas berformat PDF (.pdf).');
    }
    return { fileUrl, fileName };
  }

  createRegulation(input: {
    title?: unknown;
    regulationNumber?: unknown;
    year?: unknown;
    category?: unknown;
    issuingBody?: unknown;
    summary?: unknown;
    fileUrl?: unknown;
    fileName?: unknown;
    fileSizeBytes?: unknown;
    uploadedBy?: unknown;
  }): LetterRegulation {
    const title = assertNonEmptyText(input.title, 'Judul peraturan', 220);
    const regulationNumber = assertNonEmptyText(input.regulationNumber, 'Nomor peraturan', 100);
    const yearNum = Number(input.year);
    if (!Number.isInteger(yearNum) || yearNum < 1945 || yearNum > 2100) {
      throw new ValidationError('Tahun peraturan harus berupa angka tahun yang valid (1945–2100).');
    }
    const category = String(input.category || '') as RegulationCategory;
    if (!REGULATION_CATEGORIES.includes(category)) {
      throw new ValidationError('Kategori peraturan tidak valid.');
    }
    const issuingBody = assertOptionalText(input.issuingBody, 'Instansi penerbit', 160);
    const summary = assertOptionalText(input.summary, 'Ringkasan / keterangan peraturan', 600);
    const { fileUrl, fileName } = this.assertValidPdfAttachment(input.fileUrl, input.fileName);
    const fileSizeBytes = Math.max(0, Math.floor(Number(input.fileSizeBytes) || 0));
    const uploadedBy =
      assertOptionalText(input.uploadedBy, 'Pengunggah', 100) || 'Admin Tata Usaha';

    const id = `reg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO letter_regulations (
            id, title, regulation_number, year, category, issuing_body, summary,
            file_url, file_name, file_size_bytes, uploaded_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          title,
          regulationNumber,
          yearNum,
          category,
          issuingBody,
          summary,
          fileUrl,
          fileName,
          fileSizeBytes,
          uploadedBy,
          now,
          now
        );
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const created = this.db.prepare('SELECT * FROM letter_regulations WHERE id = ?').get(id) as Record<
      string,
      string | number
    >;
    this.flushWriteToDisk();
    return this.mapRegulationRow(created);
  }

  updateRegulation(
    id: string,
    input: {
      title?: unknown;
      regulationNumber?: unknown;
      year?: unknown;
      category?: unknown;
      issuingBody?: unknown;
      summary?: unknown;
      fileUrl?: unknown;
      fileName?: unknown;
      fileSizeBytes?: unknown;
      expectedUpdatedAt?: unknown;
    }
  ): LetterRegulation {
    const existingRow = this.db
      .prepare('SELECT * FROM letter_regulations WHERE id = ?')
      .get(id) as Record<string, string | number> | undefined;
    if (!existingRow) {
      throw new NotFoundError('Referensi peraturan tidak ditemukan.');
    }
    const current = this.mapRegulationRow(existingRow);

    if (
      typeof input.expectedUpdatedAt === 'string' &&
      input.expectedUpdatedAt.trim() &&
      input.expectedUpdatedAt.trim() !== current.updatedAt
    ) {
      throw new ConflictError(
        'Data peraturan ini baru saja diperbarui oleh sesi lain. Muat ulang data sebelum menyimpan.'
      );
    }

    const title = assertNonEmptyText(input.title ?? current.title, 'Judul peraturan', 220);
    const regulationNumber = assertNonEmptyText(
      input.regulationNumber ?? current.regulationNumber,
      'Nomor peraturan',
      100
    );
    const yearNum = input.year !== undefined ? Number(input.year) : current.year;
    if (!Number.isInteger(yearNum) || yearNum < 1945 || yearNum > 2100) {
      throw new ValidationError('Tahun peraturan harus berupa angka tahun yang valid (1945–2100).');
    }
    const category = String(input.category ?? current.category) as RegulationCategory;
    if (!REGULATION_CATEGORIES.includes(category)) {
      throw new ValidationError('Kategori peraturan tidak valid.');
    }
    const issuingBody = assertOptionalText(
      input.issuingBody !== undefined ? input.issuingBody : current.issuingBody,
      'Instansi penerbit',
      160
    );
    const summary = assertOptionalText(
      input.summary !== undefined ? input.summary : current.summary,
      'Ringkasan / keterangan peraturan',
      600
    );
    const { fileUrl, fileName } = this.assertValidPdfAttachment(
      input.fileUrl ?? current.fileUrl,
      input.fileName ?? current.fileName
    );
    const fileSizeBytes =
      input.fileSizeBytes !== undefined
        ? Math.max(0, Math.floor(Number(input.fileSizeBytes) || 0))
        : current.fileSizeBytes;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `UPDATE letter_regulations SET
            title = ?, regulation_number = ?, year = ?, category = ?,
            issuing_body = ?, summary = ?, file_url = ?, file_name = ?,
            file_size_bytes = ?, updated_at = ?
          WHERE id = ?`
        )
        .run(
          title,
          regulationNumber,
          yearNum,
          category,
          issuingBody,
          summary,
          fileUrl,
          fileName,
          fileSizeBytes,
          now,
          id
        );
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const updated = this.db.prepare('SELECT * FROM letter_regulations WHERE id = ?').get(id) as Record<
      string,
      string | number
    >;
    this.flushWriteToDisk();
    return this.mapRegulationRow(updated);
  }

  deleteRegulation(id: string): LetterRegulation {
    const existingRow = this.db
      .prepare('SELECT * FROM letter_regulations WHERE id = ?')
      .get(id) as Record<string, string | number> | undefined;
    if (!existingRow) {
      throw new NotFoundError('Referensi peraturan tidak ditemukan.');
    }
    const removed = this.mapRegulationRow(existingRow);
    this.db.prepare('DELETE FROM letter_regulations WHERE id = ?').run(id);
    this.flushWriteToDisk();
    return removed;
  }

  private ensureAutoCurrentYearCounter(referenceYear: number = new Date().getFullYear()): void {
    const settingsRow = this.db
      .prepare('SELECT auto_init_new_year_counter FROM school_settings WHERE id = 1')
      .get() as { auto_init_new_year_counter?: number } | undefined;
    const autoEnabled =
      settingsRow?.auto_init_new_year_counter === undefined
        ? true
        : Boolean(Number(settingsRow.auto_init_new_year_counter));
    if (!autoEnabled || !Number.isInteger(referenceYear) || referenceYear < 2000 || referenceYear > 2100) {
      return;
    }
    const result = this.db
      .prepare(
        'INSERT OR IGNORE INTO year_counters (year, incoming_last_seq, outgoing_last_seq) VALUES (?, 0, 0)'
      )
      .run(referenceYear);
    if (result.changes > 0) {
      this.flushWriteToDisk();
    }
  }

  listCounters(): YearCounter[] {
    this.ensureAutoCurrentYearCounter();
    const rows = this.db
      .prepare('SELECT year, incoming_last_seq, outgoing_last_seq FROM year_counters ORDER BY year DESC')
      .all() as Array<Record<string, number>>;
    return rows.map((r) => ({
      year: r.year,
      incomingLastSeq: r.incoming_last_seq,
      outgoingLastSeq: r.outgoing_last_seq,
    }));
  }

  initializeYearCounter(year: number): { counter: YearCounter; alreadyInitialized: boolean } {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new ValidationError('Tahun penghitung tidak valid (harus 2000–2100).');
    }
    const existing = this.db
      .prepare('SELECT year, incoming_last_seq, outgoing_last_seq FROM year_counters WHERE year = ?')
      .get(year) as Record<string, number> | undefined;
    if (existing) {
      return {
        counter: {
          year: existing.year,
          incomingLastSeq: existing.incoming_last_seq,
          outgoingLastSeq: existing.outgoing_last_seq,
        },
        alreadyInitialized: true,
      };
    }
    this.db
      .prepare(
        'INSERT OR IGNORE INTO year_counters (year, incoming_last_seq, outgoing_last_seq) VALUES (?, 0, 0)'
      )
      .run(year);
    this.flushWriteToDisk();
    const inserted = this.db
      .prepare('SELECT year, incoming_last_seq, outgoing_last_seq FROM year_counters WHERE year = ?')
      .get(year) as Record<string, number>;
    return {
      counter: {
        year: inserted.year,
        incomingLastSeq: inserted.incoming_last_seq,
        outgoingLastSeq: inserted.outgoing_last_seq,
      },
      alreadyInitialized: false,
    };
  }

  updateCounter(year: number, incomingLastSeq: number, outgoingLastSeq: number): YearCounter {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new ValidationError('Tahun penghitung tidak valid.');
    }
    if (!Number.isInteger(incomingLastSeq) || incomingLastSeq < 0) {
      throw new ValidationError('Nomor urut terakhir surat masuk harus bilangan bulat >= 0.');
    }
    if (!Number.isInteger(outgoingLastSeq) || outgoingLastSeq < 0) {
      throw new ValidationError('Nomor urut terakhir surat keluar harus bilangan bulat >= 0.');
    }
    this.db
      .prepare(
        `INSERT INTO year_counters (year, incoming_last_seq, outgoing_last_seq)
         VALUES (?, ?, ?)
         ON CONFLICT(year) DO UPDATE SET
           incoming_last_seq = excluded.incoming_last_seq,
           outgoing_last_seq = excluded.outgoing_last_seq`
      )
      .run(year, incomingLastSeq, outgoingLastSeq);
    this.flushWriteToDisk();
    return { year, incomingLastSeq, outgoingLastSeq };
  }

  private getOrInitYearCounter(year: number): YearCounter {
    const row = this.db
      .prepare('SELECT year, incoming_last_seq, outgoing_last_seq FROM year_counters WHERE year = ?')
      .get(year) as Record<string, number> | undefined;
    if (row) {
      return {
        year: row.year,
        incomingLastSeq: row.incoming_last_seq,
        outgoingLastSeq: row.outgoing_last_seq,
      };
    }
    this.db
      .prepare('INSERT INTO year_counters (year, incoming_last_seq, outgoing_last_seq) VALUES (?, 0, 0)')
      .run(year);
    return { year, incomingLastSeq: 0, outgoingLastSeq: 0 };
  }

  private mapDispositionRow(r: Record<string, string>): Disposition {
    return {
      id: r.id,
      incomingLetterId: r.incoming_letter_id,
      targetUnit: r.target_unit,
      targetStaffName: r.target_staff_name,
      instruction: r.instruction,
      deadlineDate: r.deadline_date,
      status: r.status as DispositionStatus,
      completionNote: r.completion_note,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapIncomingRow(
    r: Record<string, string | number>,
    dispositions: Disposition[]
  ): IncomingLetter {
    return {
      id: String(r.id),
      agendaNumber: String(r.agenda_number),
      sequenceNumber: Number(r.sequence_number),
      agendaYear: Number(r.agenda_year),
      letterNumber: String(r.letter_number),
      letterDate: String(r.letter_date),
      receivedDate: String(r.received_date),
      sender: String(r.sender),
      subject: String(r.subject),
      classificationCode: String(r.classification_code),
      urgency: String(r.urgency) as LetterUrgency,
      status: String(r.status) as IncomingStatus,
      attachmentUrl: String(r.attachment_url),
      attachmentName: String(r.attachment_name),
      notes: String(r.notes),
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      dispositions,
    };
  }

  private mapOutgoingRow(r: Record<string, string | number>): OutgoingLetter {
    return {
      id: String(r.id),
      sequenceNumber: Number(r.sequence_number),
      letterYear: Number(r.letter_year),
      fullLetterNumber: String(r.full_letter_number),
      isManualNumber: Boolean(r.is_manual_number),
      classificationCode: String(r.classification_code),
      letterDate: String(r.letter_date),
      recipient: String(r.recipient),
      subject: String(r.subject),
      drafterName: String(r.drafter_name),
      status: String(r.status) as OutgoingStatus,
      attachmentUrl: String(r.attachment_url),
      attachmentName: String(r.attachment_name),
      bodyText: String(r.body_text || ''),
      notes: String(r.notes),
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  listIncomingLetters(): IncomingLetter[] {
    const letterRows = this.db
      .prepare('SELECT * FROM incoming_letters ORDER BY received_date DESC, sequence_number DESC')
      .all() as Array<Record<string, string | number>>;
    const dispRows = this.db
      .prepare('SELECT * FROM dispositions ORDER BY created_at DESC')
      .all() as Array<Record<string, string>>;

    const byLetter = new Map<string, Disposition[]>();
    for (const d of dispRows) {
      const mapped = this.mapDispositionRow(d);
      const list = byLetter.get(mapped.incomingLetterId) ?? [];
      list.push(mapped);
      byLetter.set(mapped.incomingLetterId, list);
    }

    return letterRows.map((row) =>
      this.mapIncomingRow(row, byLetter.get(String(row.id)) ?? [])
    );
  }

  getIncomingLetter(id: string): IncomingLetter {
    const row = this.db
      .prepare('SELECT * FROM incoming_letters WHERE id = ?')
      .get(id) as Record<string, string | number> | undefined;
    if (!row) {
      throw new NotFoundError(`Surat masuk dengan ID "${id}" tidak ditemukan.`);
    }
    const dispRows = this.db
      .prepare('SELECT * FROM dispositions WHERE incoming_letter_id = ? ORDER BY created_at DESC')
      .all(id) as Array<Record<string, string>>;
    return this.mapIncomingRow(row, dispRows.map((d) => this.mapDispositionRow(d)));
  }

  createIncomingLetter(
    input: Record<string, unknown>,
    actor?: Partial<AuthUser>
  ): IncomingLetter {
    const letterNumber = assertNonEmptyText(input.letterNumber, 'Nomor surat asal', 100);
    const letterDate = assertIsoDate(input.letterDate, 'Tanggal surat');
    const receivedDate = assertIsoDate(input.receivedDate, 'Tanggal diterima');
    const sender = assertNonEmptyText(input.sender, 'Pengirim / Instansi', 180);
    const subject = assertNonEmptyText(input.subject, 'Perihal surat', 400);
    const classificationCode = assertNonEmptyText(input.classificationCode, 'Kode klasifikasi', 24);
    const urgency = (input.urgency ?? 'Biasa') as LetterUrgency;
    if (!VALID_URGENCIES.has(urgency)) {
      throw new ValidationError('Sifat surat tidak valid.');
    }
    const status = (input.status ?? 'Menunggu Disposisi') as IncomingStatus;
    if (!VALID_INCOMING_STATUS.has(status)) {
      throw new ValidationError('Status surat masuk tidak valid.');
    }
    const attachmentUrl = assertOptionalText(input.attachmentUrl, 'Tautan lampiran', 500);
    const attachmentName = assertOptionalText(input.attachmentName, 'Nama lampiran', 160);
    const notes = assertOptionalText(input.notes, 'Catatan', 1000);
    const createdBy = assertNonEmptyText(
      input.createdBy ?? actor?.displayName ?? 'Staf Tata Usaha',
      'Nama pencatat',
      100
    );

    const agendaYear = Number(receivedDate.slice(0, 4));
    const id = `in_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    let agendaNumber = '';

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const counter = this.getOrInitYearCounter(agendaYear);
      const nextSeq = counter.incomingLastSeq + 1;
      agendaNumber = `AGD-${agendaYear}-${String(nextSeq).padStart(3, '0')}`;

      this.db
        .prepare('UPDATE year_counters SET incoming_last_seq = ? WHERE year = ?')
        .run(nextSeq, agendaYear);

      this.db
        .prepare(
          `INSERT INTO incoming_letters (
            id, agenda_number, sequence_number, agenda_year, letter_number,
            letter_date, received_date, sender, subject, classification_code,
            urgency, status, attachment_url, attachment_name, notes, created_by,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          agendaNumber,
          nextSeq,
          agendaYear,
          letterNumber,
          letterDate,
          receivedDate,
          sender,
          subject,
          classificationCode,
          urgency,
          status,
          attachmentUrl,
          attachmentName,
          notes,
          createdBy,
          now,
          now
        );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.recordActivity({
      actor: actor ?? { displayName: createdBy },
      action: 'CREATE',
      entityType: 'incoming',
      entityId: id,
      referenceNumber: agendaNumber,
      subject,
      details: `Mencatat surat masuk baru dari ${sender}`,
    });

    this.flushWriteToDisk();
    return this.getIncomingLetter(id);
  }

  updateIncomingLetter(
    id: string,
    input: Record<string, unknown>,
    actor?: Partial<AuthUser>
  ): IncomingLetter {
    const existing = this.getIncomingLetter(id);
    if (
      typeof input.expectedUpdatedAt === 'string' &&
      input.expectedUpdatedAt &&
      input.expectedUpdatedAt !== existing.updatedAt
    ) {
      throw new ConflictError(
        'Data surat masuk ini baru saja diperbarui oleh pengguna lain. Muat ulang data terbaru sebelum menyimpan.'
      );
    }

    const letterNumber =
      input.letterNumber !== undefined
        ? assertNonEmptyText(input.letterNumber, 'Nomor surat asal', 100)
        : existing.letterNumber;
    const letterDate =
      input.letterDate !== undefined
        ? assertIsoDate(input.letterDate, 'Tanggal surat')
        : existing.letterDate;
    const receivedDate =
      input.receivedDate !== undefined
        ? assertIsoDate(input.receivedDate, 'Tanggal diterima')
        : existing.receivedDate;
    const sender =
      input.sender !== undefined
        ? assertNonEmptyText(input.sender, 'Pengirim / Instansi', 180)
        : existing.sender;
    const subject =
      input.subject !== undefined
        ? assertNonEmptyText(input.subject, 'Perihal surat', 400)
        : existing.subject;
    const classificationCode =
      input.classificationCode !== undefined
        ? assertNonEmptyText(input.classificationCode, 'Kode klasifikasi', 24)
        : existing.classificationCode;
    const urgency = (input.urgency ?? existing.urgency) as LetterUrgency;
    if (!VALID_URGENCIES.has(urgency)) {
      throw new ValidationError('Sifat surat tidak valid.');
    }
    const status = (input.status ?? existing.status) as IncomingStatus;
    if (!VALID_INCOMING_STATUS.has(status)) {
      throw new ValidationError('Status surat masuk tidak valid.');
    }
    const attachmentUrl =
      input.attachmentUrl !== undefined
        ? assertOptionalText(input.attachmentUrl, 'Tautan lampiran', 500)
        : existing.attachmentUrl;
    const attachmentName =
      input.attachmentName !== undefined
        ? assertOptionalText(input.attachmentName, 'Nama lampiran', 160)
        : existing.attachmentName;
    const notes =
      input.notes !== undefined
        ? assertOptionalText(input.notes, 'Catatan', 1000)
        : existing.notes;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `UPDATE incoming_letters SET
            letter_number = ?, letter_date = ?, received_date = ?, sender = ?,
            subject = ?, classification_code = ?, urgency = ?, status = ?,
            attachment_url = ?, attachment_name = ?, notes = ?, updated_at = ?
          WHERE id = ?`
        )
        .run(
          letterNumber,
          letterDate,
          receivedDate,
          sender,
          subject,
          classificationCode,
          urgency,
          status,
          attachmentUrl,
          attachmentName,
          notes,
          now,
          id
        );

      const statusChanged = status !== existing.status;
      this.recordActivity({
        actor,
        action: 'UPDATE',
        entityType: 'incoming',
        entityId: id,
        referenceNumber: existing.agendaNumber,
        subject,
        details: statusChanged
          ? `Memperbarui status surat masuk: "${existing.status}" → "${status}"`
          : `Mengedit informasi surat masuk (${letterNumber})`,
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.flushWriteToDisk();
    return this.getIncomingLetter(id);
  }

  deleteIncomingLetter(id: string, actor?: Partial<AuthUser>): void {
    const existing = this.getIncomingLetter(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const res = this.db.prepare('DELETE FROM incoming_letters WHERE id = ?').run(id);
      if (res.changes === 0) {
        throw new NotFoundError(`Surat masuk dengan ID "${id}" tidak ditemukan.`);
      }
      this.recordActivity({
        actor,
        action: 'DELETE',
        entityType: 'incoming',
        entityId: id,
        referenceNumber: existing.agendaNumber,
        subject: existing.subject,
        details: `Menghapus arsip surat masuk ${existing.agendaNumber} (${existing.letterNumber})`,
      });
      this.db.exec('COMMIT');
      this.flushWriteToDisk();
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  addDisposition(incomingLetterId: string, input: Record<string, unknown>): IncomingLetter {
    this.getIncomingLetter(incomingLetterId);
    const targetUnit = assertNonEmptyText(input.targetUnit, 'Unit tujuan disposisi', 160);
    const targetStaffName = assertOptionalText(input.targetStaffName, 'Nama staf penerima', 120);
    const instruction = assertNonEmptyText(input.instruction, 'Isi instruksi disposisi', 800);
    const deadlineDate =
      input.deadlineDate && String(input.deadlineDate).trim() !== ''
        ? assertIsoDate(input.deadlineDate, 'Batas waktu tindak lanjut')
        : '';
    const createdBy = assertNonEmptyText(input.createdBy ?? 'Kepala Sekolah', 'Pemberi disposisi', 100);
    const dispId = `disp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO dispositions (
            id, incoming_letter_id, target_unit, target_staff_name, instruction,
            deadline_date, status, completion_note, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Belum Ditindaklanjuti', '', ?, ?, ?)`
        )
        .run(dispId, incomingLetterId, targetUnit, targetStaffName, instruction, deadlineDate, createdBy, now, now);

      this.db
        .prepare(
          `UPDATE incoming_letters
           SET status = CASE WHEN status = 'Menunggu Disposisi' THEN 'Didisposisikan' ELSE status END,
               updated_at = ?
           WHERE id = ?`
        )
        .run(now, incomingLetterId);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.flushWriteToDisk();
    return this.getIncomingLetter(incomingLetterId);
  }

  updateDisposition(
    incomingLetterId: string,
    dispositionId: string,
    input: Record<string, unknown>
  ): IncomingLetter {
    const letter = this.getIncomingLetter(incomingLetterId);
    const targetDisp = letter.dispositions.find((d) => d.id === dispositionId);
    if (!targetDisp) {
      throw new NotFoundError(`Disposisi "${dispositionId}" tidak ditemukan.`);
    }

    const status = (input.status ?? targetDisp.status) as DispositionStatus;
    if (!VALID_DISPOSITION_STATUS.has(status)) {
      throw new ValidationError('Status disposisi tidak valid.');
    }
    const completionNote =
      input.completionNote !== undefined
        ? assertOptionalText(input.completionNote, 'Catatan tindak lanjut', 800)
        : targetDisp.completionNote;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'UPDATE dispositions SET status = ?, completion_note = ?, updated_at = ? WHERE id = ?'
        )
        .run(status, completionNote, now, dispositionId);

      const allDisps = this.db
        .prepare('SELECT status FROM dispositions WHERE incoming_letter_id = ?')
        .all(incomingLetterId) as Array<{ status: string }>;

      let nextLetterStatus: IncomingStatus = letter.status;
      if (allDisps.length > 0 && allDisps.every((d) => d.status === 'Selesai')) {
        nextLetterStatus = 'Selesai';
      } else if (allDisps.some((d) => d.status === 'Sedang Diproses' || d.status === 'Selesai')) {
        nextLetterStatus = 'Diproses';
      }

      this.db
        .prepare('UPDATE incoming_letters SET status = ?, updated_at = ? WHERE id = ?')
        .run(nextLetterStatus, now, incomingLetterId);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.flushWriteToDisk();
    return this.getIncomingLetter(incomingLetterId);
  }

  listOutgoingLetters(): OutgoingLetter[] {
    const rows = this.db
      .prepare('SELECT * FROM outgoing_letters ORDER BY letter_date DESC, sequence_number DESC')
      .all() as Array<Record<string, string | number>>;
    return rows.map((r) => this.mapOutgoingRow(r));
  }

  getOutgoingLetter(id: string): OutgoingLetter {
    const row = this.db
      .prepare('SELECT * FROM outgoing_letters WHERE id = ?')
      .get(id) as Record<string, string | number> | undefined;
    if (!row) {
      throw new NotFoundError(`Surat keluar dengan ID "${id}" tidak ditemukan.`);
    }
    return this.mapOutgoingRow(row);
  }

  createOutgoingLetter(
    input: Record<string, unknown>,
    actor?: Partial<AuthUser>
  ): OutgoingLetter {
    const classificationCode = assertNonEmptyText(input.classificationCode, 'Kode klasifikasi', 24);
    const letterDate = assertIsoDate(input.letterDate, 'Tanggal surat');
    const recipient = assertNonEmptyText(input.recipient, 'Tujuan / Penerima', 180);
    const subject = assertNonEmptyText(input.subject, 'Perihal surat', 400);
    const drafterName = assertNonEmptyText(input.drafterName, 'Konseptor / Unit pembuat', 120);
    const status = (input.status ?? 'Draf') as OutgoingStatus;
    if (!VALID_OUTGOING_STATUS.has(status)) {
      throw new ValidationError('Status surat keluar tidak valid.');
    }
    const isManualNumber = Boolean(input.isManualNumber);
    const attachmentUrl = assertOptionalText(input.attachmentUrl, 'Tautan lampiran', 500);
    const attachmentName = assertOptionalText(input.attachmentName, 'Nama lampiran', 160);
    const bodyText = assertOptionalText(input.bodyText, 'Isi naskah surat', 8000);
    const notes = assertOptionalText(input.notes, 'Catatan', 1000);
    const createdBy = assertNonEmptyText(
      input.createdBy ?? actor?.displayName ?? 'Staf Tata Usaha',
      'Nama pencatat',
      100
    );

    const letterYear = Number(letterDate.slice(0, 4));
    const settings = this.getSettings();
    const id = `out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    let fullLetterNumber = '';

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const counter = this.getOrInitYearCounter(letterYear);
      let seqNumber = counter.outgoingLastSeq + 1;

      if (isManualNumber) {
        fullLetterNumber = assertNonEmptyText(input.fullLetterNumber, 'Nomor surat manual', 100);
      } else {
        fullLetterNumber = formatOutgoingLetterNumber(
          settings.outgoingFormatPattern,
          classificationCode,
          seqNumber,
          settings.schoolCode,
          letterDate
        );
      }

      const duplicate = this.db
        .prepare('SELECT id FROM outgoing_letters WHERE full_letter_number = ?')
        .get(fullLetterNumber);
      if (duplicate) {
        throw new ConflictError(
          `Nomor surat keluar "${fullLetterNumber}" sudah terdaftar. Gunakan nomor lain atau periksa penghitung.`
        );
      }

      if (!isManualNumber) {
        this.db
          .prepare('UPDATE year_counters SET outgoing_last_seq = ? WHERE year = ?')
          .run(seqNumber, letterYear);
      } else {
        seqNumber = 0;
      }

      this.db
        .prepare(
          `INSERT INTO outgoing_letters (
            id, sequence_number, letter_year, full_letter_number, is_manual_number,
            classification_code, letter_date, recipient, subject, drafter_name,
            status, attachment_url, attachment_name, body_text, notes, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          seqNumber,
          letterYear,
          fullLetterNumber,
          isManualNumber ? 1 : 0,
          classificationCode,
          letterDate,
          recipient,
          subject,
          drafterName,
          status,
          attachmentUrl,
          attachmentName,
          bodyText,
          notes,
          createdBy,
          now,
          now
        );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.recordActivity({
      actor: actor ?? { displayName: createdBy },
      action: 'CREATE',
      entityType: 'outgoing',
      entityId: id,
      referenceNumber: fullLetterNumber,
      subject,
      details: `Membuat surat keluar baru kepada ${recipient}`,
    });

    this.flushWriteToDisk();
    return this.getOutgoingLetter(id);
  }

  updateOutgoingLetter(
    id: string,
    input: Record<string, unknown>,
    actor?: Partial<AuthUser>
  ): OutgoingLetter {
    const existing = this.getOutgoingLetter(id);
    if (
      typeof input.expectedUpdatedAt === 'string' &&
      input.expectedUpdatedAt &&
      input.expectedUpdatedAt !== existing.updatedAt
    ) {
      throw new ConflictError(
        'Data surat keluar ini baru saja diperbarui oleh pengguna lain. Muat ulang data terbaru sebelum menyimpan.'
      );
    }

    const fullLetterNumber =
      input.fullLetterNumber !== undefined
        ? assertNonEmptyText(input.fullLetterNumber, 'Nomor surat keluar', 100)
        : existing.fullLetterNumber;

    if (fullLetterNumber !== existing.fullLetterNumber) {
      const dup = this.db
        .prepare('SELECT id FROM outgoing_letters WHERE full_letter_number = ? AND id != ?')
        .get(fullLetterNumber, id);
      if (dup) {
        throw new ConflictError(`Nomor surat keluar "${fullLetterNumber}" sudah digunakan surat lain.`);
      }
    }

    const classificationCode =
      input.classificationCode !== undefined
        ? assertNonEmptyText(input.classificationCode, 'Kode klasifikasi', 24)
        : existing.classificationCode;
    const letterDate =
      input.letterDate !== undefined
        ? assertIsoDate(input.letterDate, 'Tanggal surat')
        : existing.letterDate;
    const recipient =
      input.recipient !== undefined
        ? assertNonEmptyText(input.recipient, 'Tujuan / Penerima', 180)
        : existing.recipient;
    const subject =
      input.subject !== undefined
        ? assertNonEmptyText(input.subject, 'Perihal surat', 400)
        : existing.subject;
    const drafterName =
      input.drafterName !== undefined
        ? assertNonEmptyText(input.drafterName, 'Konseptor / Unit pembuat', 120)
        : existing.drafterName;
    const status = (input.status ?? existing.status) as OutgoingStatus;
    if (!VALID_OUTGOING_STATUS.has(status)) {
      throw new ValidationError('Status surat keluar tidak valid.');
    }
    const attachmentUrl =
      input.attachmentUrl !== undefined
        ? assertOptionalText(input.attachmentUrl, 'Tautan lampiran', 500)
        : existing.attachmentUrl;
    const attachmentName =
      input.attachmentName !== undefined
        ? assertOptionalText(input.attachmentName, 'Nama lampiran', 160)
        : existing.attachmentName;
    const bodyText =
      input.bodyText !== undefined
        ? assertOptionalText(input.bodyText, 'Isi naskah surat', 8000)
        : existing.bodyText;
    const notes =
      input.notes !== undefined
        ? assertOptionalText(input.notes, 'Catatan', 1000)
        : existing.notes;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `UPDATE outgoing_letters SET
            full_letter_number = ?, classification_code = ?, letter_date = ?,
            recipient = ?, subject = ?, drafter_name = ?, status = ?,
            attachment_url = ?, attachment_name = ?, body_text = ?, notes = ?, updated_at = ?
          WHERE id = ?`
        )
        .run(
          fullLetterNumber,
          classificationCode,
          letterDate,
          recipient,
          subject,
          drafterName,
          status,
          attachmentUrl,
          attachmentName,
          bodyText,
          notes,
          now,
          id
        );

      const statusChanged = status !== existing.status;
      this.recordActivity({
        actor,
        action: 'UPDATE',
        entityType: 'outgoing',
        entityId: id,
        referenceNumber: fullLetterNumber,
        subject,
        details: statusChanged
          ? `Memperbarui status surat keluar: "${existing.status}" → "${status}"`
          : `Mengedit informasi/naskah surat keluar (${fullLetterNumber})`,
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.flushWriteToDisk();
    return this.getOutgoingLetter(id);
  }

  deleteOutgoingLetter(id: string, actor?: Partial<AuthUser>): void {
    const existing = this.getOutgoingLetter(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const res = this.db.prepare('DELETE FROM outgoing_letters WHERE id = ?').run(id);
      if (res.changes === 0) {
        throw new NotFoundError(`Surat keluar dengan ID "${id}" tidak ditemukan.`);
      }
      this.recordActivity({
        actor,
        action: 'DELETE',
        entityType: 'outgoing',
        entityId: id,
        referenceNumber: existing.fullLetterNumber,
        subject: existing.subject,
        details: `Menghapus arsip surat keluar ${existing.fullLetterNumber}`,
      });
      this.db.exec('COMMIT');
      this.flushWriteToDisk();
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listErrorLogs(limit = 50): ErrorLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, string>>;
    return rows.map((r) => ({
      id: r.id,
      level: r.level as 'error' | 'warn',
      route: r.route,
      method: r.method,
      message: r.message,
      stack: r.stack,
      createdAt: r.created_at,
    }));
  }

  clearErrorLogs(): void {
    this.db.prepare('DELETE FROM error_logs').run();
    this.flushWriteToDisk();
  }

  recordActivity(entry: {
    actor?: Partial<AuthUser>;
    action: ActivityAction;
    entityType: ActivityEntityType;
    entityId: string;
    referenceNumber?: string;
    subject?: string;
    details?: string;
  }): ActivityLogEntry {
    const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const actorUserId = entry.actor?.id || '';
    const actorUsername = entry.actor?.username || '';
    const actorDisplayName = entry.actor?.displayName || 'Sistem / Operator';
    const actorRole = entry.actor?.role || '';
    const referenceNumber = entry.referenceNumber || '';
    const subject = entry.subject || '';
    const details = entry.details || '';

    this.db
      .prepare(
        `INSERT INTO activity_logs (
          id, actor_user_id, actor_username, actor_display_name, actor_role,
          action, entity_type, entity_id, reference_number, subject, details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        actorUserId,
        actorUsername,
        actorDisplayName,
        actorRole,
        entry.action,
        entry.entityType,
        entry.entityId,
        referenceNumber,
        subject,
        details,
        now
      );

    return {
      id,
      actorUserId,
      actorUsername,
      actorDisplayName,
      actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      referenceNumber,
      subject,
      details,
      createdAt: now,
    };
  }

  listActivityLogs(limit = 150): ActivityLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_logs ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Array<Record<string, string>>;
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      actorUsername: r.actor_username,
      actorDisplayName: r.actor_display_name,
      actorRole: r.actor_role,
      action: r.action as ActivityAction,
      entityType: r.entity_type as ActivityEntityType,
      entityId: r.entity_id,
      referenceNumber: r.reference_number,
      subject: r.subject,
      details: r.details,
      createdAt: r.created_at,
    }));
  }

  clearActivityLogs(): void {
    this.db.prepare('DELETE FROM activity_logs').run();
    this.flushWriteToDisk();
  }

  private mapUserRow(r: Record<string, string | number>): AuthUser {
    return {
      id: String(r.id),
      username: String(r.username),
      displayName: String(r.display_name),
      jabatan: String(r.jabatan),
      role: String(r.role) as StaffRole,
      isActive: Boolean(r.is_active),
      createdAt: String(r.created_at),
    };
  }

  authenticateUser(
    usernameInput: unknown,
    passwordInput: unknown,
    meta?: { ipAddress?: string; userAgent?: string }
  ): { token: string; user: AuthUser } {
    const username = assertNonEmptyText(usernameInput, 'Username', 60).toLowerCase();
    const password = assertNonEmptyText(passwordInput, 'Kata sandi', 120);

    const row = this.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = ?')
      .get(username) as Record<string, string | number> | undefined;

    if (!row || !verifyPassword(password, String(row.password_hash))) {
      throw new ValidationError('Username atau kata sandi salah.', 401);
    }
    if (!row.is_active) {
      throw new ValidationError('Akun pengguna sedang dinonaktifkan oleh Tata Usaha.', 403);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const ipAddress = (meta?.ipAddress || '').slice(0, 80);
    const userAgent = (meta?.userAgent || '').slice(0, 240);

    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
    this.db
      .prepare(
        'INSERT INTO sessions (token, user_id, ip_address, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(tokenHash, String(row.id), ipAddress, userAgent, now.toISOString(), expires.toISOString());

    this.flushWriteToDisk();

    return {
      token,
      user: this.mapUserRow(row),
    };
  }

  getSessionUser(token: string): AuthUser | null {
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const row = this.db
      .prepare(
        `SELECT u.*, s.expires_at, s.token AS stored_token
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? OR s.token = ?`
      )
      .get(tokenHash, token) as Record<string, string | number> | undefined;

    if (!row) return null;
    if (String(row.expires_at) < new Date().toISOString() || !row.is_active) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(String(row.stored_token));
      return null;
    }
    return this.mapUserRow(row);
  }

  deleteSession(token: string): void {
    if (!token) return;
    const tokenHash = hashSessionToken(token);
    this.db.prepare('DELETE FROM sessions WHERE token = ? OR token = ?').run(tokenHash, token);
    this.flushWriteToDisk();
  }

  listUsers(): AuthUser[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as Array<Record<string, string | number>>;
    return rows.map((r) => this.mapUserRow(r));
  }

  createUser(input: {
    username: unknown;
    password: unknown;
    displayName: unknown;
    jabatan: unknown;
    role: unknown;
  }): AuthUser {
    const username = assertNonEmptyText(input.username, 'Username', 50).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) {
      throw new ValidationError('Username hanya boleh berisi huruf kecil, angka, titik, atau garis bawah.');
    }
    const password = assertNonEmptyText(input.password, 'Kata sandi', 120);
    if (password.length < 6) {
      throw new ValidationError('Kata sandi minimal 6 karakter.');
    }
    const displayName = assertNonEmptyText(input.displayName, 'Nama lengkap', 120);
    const jabatan = assertNonEmptyText(input.jabatan, 'Jabatan', 120);
    const role = String(input.role || 'staf') as StaffRole;
    if (role !== 'admin' && role !== 'kepala_sekolah' && role !== 'staf') {
      throw new ValidationError('Peran pengguna tidak valid.');
    }

    const dup = this.db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(username);
    if (dup) {
      throw new ConflictError(`Username "${username}" sudah digunakan.`);
    }

    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, display_name, jabatan, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(id, username, hashPassword(password), displayName, jabatan, role, now);

    this.flushWriteToDisk();

    const created = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<
      string,
      string | number
    >;
    return this.mapUserRow(created);
  }

  updateUserStatus(id: string, isActive: boolean): AuthUser {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, string | number>
      | undefined;
    if (!existing) {
      throw new NotFoundError('Akun pengguna tidak ditemukan.');
    }
    this.db
      .prepare('UPDATE users SET is_active = ? WHERE id = ?')
      .run(isActive ? 1 : 0, id);
    if (!isActive) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    this.flushWriteToDisk();
    const updated = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<
      string,
      string | number
    >;
    return this.mapUserRow(updated);
  }

  updateUserPassword(id: string, newPasswordInput: unknown, revokeSessions = true): void {
    const existing = this.db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError('Akun pengguna tidak ditemukan.');
    }
    const newPassword = assertNonEmptyText(newPasswordInput, 'Kata sandi baru', 120);
    if (newPassword.length < 6) {
      throw new ValidationError('Kata sandi baru minimal 6 karakter.');
    }

    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(newPassword), id);

    if (revokeSessions) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    this.flushWriteToDisk();
  }

  changeOwnPassword(
    userId: string,
    currentPasswordInput: unknown,
    newPasswordInput: unknown
  ): void {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | Record<string, string | number>
      | undefined;
    if (!row) {
      throw new NotFoundError('Akun pengguna tidak ditemukan.');
    }
    const currentPassword = assertNonEmptyText(currentPasswordInput, 'Kata sandi saat ini', 120);
    if (!verifyPassword(currentPassword, String(row.password_hash))) {
      throw new ValidationError('Kata sandi saat ini tidak sesuai.', 400);
    }
    const newPassword = assertNonEmptyText(newPasswordInput, 'Kata sandi baru', 120);
    if (newPassword.length < 6) {
      throw new ValidationError('Kata sandi baru minimal 6 karakter.');
    }

    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(newPassword), userId);
    this.flushWriteToDisk();
  }

  deleteUser(id: string, requestingUserId: string): void {
    if (id === requestingUserId) {
      throw new ValidationError('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.');
    }
    const target = this.db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
      | { id: string; role: string }
      | undefined;
    if (!target) {
      throw new NotFoundError('Akun pengguna tidak ditemukan.');
    }
    if (target.role === 'admin') {
      const adminCount = (
        this.db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").get() as {
          cnt: number;
        }
      ).cnt;
      if (adminCount <= 1) {
        throw new ValidationError('Minimal harus tersisa satu akun Admin Tata Usaha.');
      }
    }

    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    this.flushWriteToDisk();
  }

  // --- Penyimpanan Berkas Unggahan (PDF & Gambar) Langsung di SQLite ---
  saveUploadedFile(input: {
    fileKey: string;
    originalName: string;
    mimeType: string;
    content: Buffer;
    uploadedBy?: string;
  }): {
    fileKey: string;
    urlPath: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  } {
    const safeKey = path.basename(input.fileKey);
    if (!safeKey || safeKey === '.' || safeKey === '..') {
      throw new ValidationError('Kunci berkas unggahan tidak valid.');
    }
    const urlPath = `/uploads/${safeKey}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO uploaded_files (
          file_key, url_path, original_name, mime_type, size_bytes, content_blob, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_key) DO UPDATE SET
          original_name = excluded.original_name,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          content_blob = excluded.content_blob,
          uploaded_by = excluded.uploaded_by`
      )
      .run(
        safeKey,
        urlPath,
        input.originalName.slice(0, 120),
        input.mimeType.slice(0, 80),
        input.content.byteLength,
        input.content,
        (input.uploadedBy || '').slice(0, 80),
        now
      );
    this.flushWriteToDisk();
    return {
      fileKey: safeKey,
      urlPath,
      originalName: input.originalName.slice(0, 120),
      mimeType: input.mimeType.slice(0, 80),
      sizeBytes: input.content.byteLength,
      createdAt: now,
    };
  }

  getUploadedFile(fileKey: string): {
    fileKey: string;
    urlPath: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    content: Buffer;
    uploadedBy: string;
    createdAt: string;
  } | null {
    const safeKey = path.basename(fileKey);
    if (!safeKey || safeKey !== fileKey) return null;
    const row = this.db
      .prepare('SELECT * FROM uploaded_files WHERE file_key = ?')
      .get(safeKey) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      fileKey: String(row.file_key),
      urlPath: String(row.url_path),
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      content: Buffer.from(row.content_blob as Uint8Array),
      uploadedBy: String(row.uploaded_by || ''),
      createdAt: String(row.created_at),
    };
  }

  listUploadedFilesForBackup(): Array<{
    fileKey: string;
    urlPath: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    dataBase64: string;
    uploadedBy: string;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM uploaded_files ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const buf = Buffer.from(row.content_blob as Uint8Array);
      return {
        fileKey: String(row.file_key),
        urlPath: String(row.url_path),
        originalName: String(row.original_name),
        mimeType: String(row.mime_type),
        sizeBytes: Number(row.size_bytes),
        dataBase64: buf.toString('base64'),
        uploadedBy: String(row.uploaded_by || ''),
        createdAt: String(row.created_at),
      };
    });
  }

  syncUploadsDirectory(uploadDir: string): void {
    fs.mkdirSync(uploadDir, { recursive: true });
    const inferMime = (name: string): string => {
      const ext = path.extname(name).toLowerCase();
      if (ext === '.pdf') return 'application/pdf';
      if (ext === '.png') return 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
      if (ext === '.webp') return 'image/webp';
      if (ext === '.svg') return 'image/svg+xml';
      return 'application/octet-stream';
    };

    // 1. Impor berkas lama di folder uploads/ yang belum masuk ke tabel SQLite uploaded_files
    const existingKeys = new Set(
      (
        this.db.prepare('SELECT file_key FROM uploaded_files').all() as Array<{ file_key: string }>
      ).map((r) => r.file_key)
    );
    const diskEntries = fs.readdirSync(uploadDir, { withFileTypes: true });
    let importedCount = 0;
    const insertStmt = this.db.prepare(
      `INSERT OR IGNORE INTO uploaded_files (
        file_key, url_path, original_name, mime_type, size_bytes, content_blob, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?)`
    );
    for (const entry of diskEntries) {
      if (!entry.isFile()) continue;
      if (existingKeys.has(entry.name)) continue;
      const fullPath = path.join(uploadDir, entry.name);
      try {
        const buf = fs.readFileSync(fullPath);
        if (buf.byteLength === 0) continue;
        const st = fs.statSync(fullPath);
        insertStmt.run(
          entry.name,
          `/uploads/${entry.name}`,
          entry.name,
          inferMime(entry.name),
          buf.byteLength,
          buf,
          st.mtime.toISOString()
        );
        importedCount += 1;
      } catch {
        // Abaikan berkas yang tidak dapat dibaca
      }
    }
    if (importedCount > 0) {
      this.flushWriteToDisk();
    }

    // 2. Pulihkan ke disk cache bila ada berkas di SQLite yang belum ada di folder uploads/
    const dbRows = this.db
      .prepare('SELECT file_key, content_blob FROM uploaded_files')
      .all() as Array<{ file_key: string; content_blob: Uint8Array }>;
    for (const row of dbRows) {
      const targetPath = path.join(uploadDir, row.file_key);
      if (!fs.existsSync(targetPath)) {
        try {
          fs.writeFileSync(targetPath, Buffer.from(row.content_blob));
        } catch {
          // Abaikan jika disk read-only; endpoint /uploads tetap bisa melayani dari SQLite
        }
      }
    }
  }

  // --- Draf Formulir Surat Otomatis per Pengguna di SQLite ---
  getUserDraft(userId: string, draftKey: string): LetterDraftRecord | null {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(draftKey)) {
      throw new ValidationError('Kunci draf tidak valid.');
    }
    const row = this.db
      .prepare('SELECT draft_key, payload_json, updated_at FROM user_drafts WHERE user_id = ? AND draft_key = ?')
      .get(userId, draftKey) as { draft_key: string; payload_json: string; updated_at: string } | undefined;
    if (!row) return null;
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      return {
        draftKey: row.draft_key,
        payload: payload && typeof payload === 'object' ? payload : {},
        updatedAt: row.updated_at,
      };
    } catch {
      return null;
    }
  }

  saveUserDraft(userId: string, draftKey: string, payloadInput: unknown): LetterDraftRecord {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(draftKey)) {
      throw new ValidationError('Kunci draf tidak valid.');
    }
    if (!payloadInput || typeof payloadInput !== 'object' || Array.isArray(payloadInput)) {
      throw new ValidationError('Isi draf formulir wajib berupa objek JSON.');
    }
    const payloadJson = JSON.stringify(payloadInput);
    if (payloadJson.length > 512 * 1024) {
      throw new ValidationError('Ukuran draf melebihi batas maksimal 512 KB.');
    }
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_drafts (user_id, draft_key, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, draft_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(userId, draftKey, payloadJson, updatedAt);
    this.flushWriteToDisk();
    return {
      draftKey,
      payload: payloadInput as Record<string, unknown>,
      updatedAt,
    };
  }

  deleteUserDraft(userId: string, draftKey: string): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(draftKey)) {
      throw new ValidationError('Kunci draf tidak valid.');
    }
    this.db
      .prepare('DELETE FROM user_drafts WHERE user_id = ? AND draft_key = ?')
      .run(userId, draftKey);
    this.flushWriteToDisk();
  }

  // --- Proteksi Brute-Force & Notifikasi Keamanan Admin ---
  private buildAttemptKeys(username: string, ipAddress: string): { userIpKey: string; ipKey: string } {
    const cleanIp = (ipAddress || 'unknown').trim().toLowerCase().slice(0, 80);
    const cleanUser = (username || '').trim().toLowerCase().slice(0, 60);
    return {
      userIpKey: `user:${cleanIp}:${cleanUser || '_anon'}`,
      ipKey: `ip:${cleanIp}`,
    };
  }

  checkLoginRateLimit(
    username: string,
    ipAddress: string
  ): { allowed: boolean; retryAfterSeconds: number } {
    const nowMs = Date.now();
    const { userIpKey, ipKey } = this.buildAttemptKeys(username, ipAddress);
    const rows = this.db
      .prepare('SELECT attempt_key, locked_until FROM login_attempts WHERE attempt_key IN (?, ?)')
      .all(userIpKey, ipKey) as Array<{ attempt_key: string; locked_until: string }>;

    let maxRetry = 0;
    for (const row of rows) {
      if (!row.locked_until) continue;
      const lockedMs = Date.parse(row.locked_until);
      if (!Number.isNaN(lockedMs) && lockedMs > nowMs) {
        const diffSec = Math.ceil((lockedMs - nowMs) / 1000);
        if (diffSec > maxRetry) maxRetry = diffSec;
      }
    }

    return {
      allowed: maxRetry === 0,
      retryAfterSeconds: maxRetry,
    };
  }

  recordFailedLogin(
    username: string,
    ipAddress: string
  ): { locked: boolean; retryAfterSeconds: number; attempts: number; ipAttempts: number } {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const windowMs = 10 * 60 * 1000;
    const lockoutMs = 15 * 60 * 1000;
    const { userIpKey, ipKey } = this.buildAttemptKeys(username, ipAddress);

    const upsertCounter = (key: string, threshold: number): { count: number; locked: boolean } => {
      const existing = this.db
        .prepare('SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE attempt_key = ?')
        .get(key) as
        | { fail_count: number; first_fail_at: string; locked_until: string }
        | undefined;

      let count = 1;
      let firstFailIso = nowIso;
      if (existing) {
        const firstMs = Date.parse(existing.first_fail_at);
        if (!Number.isNaN(firstMs) && nowMs - firstMs <= windowMs) {
          count = existing.fail_count + 1;
          firstFailIso = existing.first_fail_at;
        }
      }

      const locked = count >= threshold;
      const lockedUntil = locked ? new Date(nowMs + lockoutMs).toISOString() : '';

      this.db
        .prepare(
          `INSERT INTO login_attempts (attempt_key, fail_count, first_fail_at, locked_until, last_attempt_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(attempt_key) DO UPDATE SET
             fail_count = excluded.fail_count,
             first_fail_at = excluded.first_fail_at,
             locked_until = CASE
               WHEN excluded.locked_until != '' THEN excluded.locked_until
               ELSE login_attempts.locked_until
             END,
             last_attempt_at = excluded.last_attempt_at`
        )
        .run(key, count, firstFailIso, lockedUntil, nowIso);

      return { count, locked };
    };

    const userStats = upsertCounter(userIpKey, 5);
    const ipStats = upsertCounter(ipKey, 12);
    const isLocked = userStats.locked || ipStats.locked;

    return {
      locked: isLocked,
      retryAfterSeconds: isLocked ? Math.ceil(lockoutMs / 1000) : 0,
      attempts: userStats.count,
      ipAttempts: ipStats.count,
    };
  }

  clearFailedLogins(username: string, ipAddress: string): void {
    const { userIpKey, ipKey } = this.buildAttemptKeys(username, ipAddress);
    this.db.prepare('DELETE FROM login_attempts WHERE attempt_key IN (?, ?)').run(userIpKey, ipKey);
  }

  private mapSecurityAlertRow(r: Record<string, string | number>): SecurityAlertEntry {
    return {
      id: String(r.id),
      severity: String(r.severity) as SecurityAlertSeverity,
      category: String(r.category) as SecurityAlertCategory,
      title: String(r.title),
      message: String(r.message),
      ipAddress: String(r.ip_address),
      route: String(r.route),
      method: String(r.method),
      actorUsername: String(r.actor_username),
      userAgent: String(r.user_agent),
      isRead: Boolean(r.is_read),
      resolvedBy: String(r.resolved_by),
      resolvedAt: String(r.resolved_at),
      createdAt: String(r.created_at),
    };
  }

  recordSecurityAlert(input: {
    severity: SecurityAlertSeverity;
    category: SecurityAlertCategory;
    title: string;
    message: string;
    ipAddress?: string;
    route?: string;
    method?: string;
    actorUsername?: string;
    userAgent?: string;
  }): SecurityAlertEntry {
    const id = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const entry: SecurityAlertEntry = {
      id,
      severity: input.severity,
      category: input.category,
      title: input.title.slice(0, 160),
      message: input.message.slice(0, 800),
      ipAddress: (input.ipAddress || 'unknown').slice(0, 80),
      route: (input.route || '').slice(0, 200),
      method: (input.method || '').slice(0, 16),
      actorUsername: (input.actorUsername || '').slice(0, 80),
      userAgent: (input.userAgent || '').slice(0, 240),
      isRead: false,
      resolvedBy: '',
      resolvedAt: '',
      createdAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO security_alerts (
          id, severity, category, title, message, ip_address, route, method,
          actor_username, user_agent, is_read, resolved_by, resolved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?)`
      )
      .run(
        entry.id,
        entry.severity,
        entry.category,
        entry.title,
        entry.message,
        entry.ipAddress,
        entry.route,
        entry.method,
        entry.actorUsername,
        entry.userAgent,
        entry.createdAt
      );

    this.flushWriteToDisk();
    return entry;
  }

  listSecurityAlerts(limit = 80): { alerts: SecurityAlertEntry[]; unreadCount: number } {
    const rows = this.db
      .prepare('SELECT * FROM security_alerts ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Array<Record<string, string | number>>;
    const unreadRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM security_alerts WHERE is_read = 0')
      .get() as { cnt: number };

    return {
      alerts: rows.map((r) => this.mapSecurityAlertRow(r)),
      unreadCount: unreadRow.cnt,
    };
  }

  markSecurityAlertRead(id: string, resolvedBy: string): SecurityAlertEntry {
    const existing = this.db.prepare('SELECT * FROM security_alerts WHERE id = ?').get(id) as
      | Record<string, string | number>
      | undefined;
    if (!existing) {
      throw new NotFoundError('Notifikasi keamanan tidak ditemukan.');
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE security_alerts SET is_read = 1, resolved_by = ?, resolved_at = ? WHERE id = ?'
      )
      .run(resolvedBy, now, id);
    this.flushWriteToDisk();
    const updated = this.db.prepare('SELECT * FROM security_alerts WHERE id = ?').get(id) as Record<
      string,
      string | number
    >;
    return this.mapSecurityAlertRow(updated);
  }

  markAllSecurityAlertsRead(resolvedBy: string): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        'UPDATE security_alerts SET is_read = 1, resolved_by = ?, resolved_at = ? WHERE is_read = 0'
      )
      .run(resolvedBy, now);
    this.flushWriteToDisk();
    return Number(res.changes);
  }

  clearReadSecurityAlerts(): void {
    this.db.prepare('DELETE FROM security_alerts WHERE is_read = 1').run();
    this.flushWriteToDisk();
  }

  // --- Stabilitas Penyimpanan, Checkpoint WAL & Cadangan Otomatis ---
  private flushWriteToDisk(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
      this.lastCheckpointAt = new Date().toISOString();
    } catch {
      // Abaikan sementara jika ada pembaca bersamaan; timer berkala & shutdown akan melakukan checkpoint ulang
    }
  }

  private getBackupDir(): string | null {
    if (this.dbPath === ':memory:') return null;
    return path.join(path.dirname(this.dbPath), 'backups');
  }

  listSnapshots(): DatabaseSnapshotSummary[] {
    const backupDir = this.getBackupDir();
    if (!backupDir || !fs.existsSync(backupDir)) return [];
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();

    const results: DatabaseSnapshotSummary[] = [];
    for (const fileName of files) {
      try {
        const fullPath = path.join(backupDir, fileName);
        const st = fs.statSync(fullPath);
        const match = fileName.match(/^snapshot-(.+?)-([a-z-]+)\.json$/i);
        const reason = match ? match[2] : 'auto';
        let incomingCount = 0;
        let outgoingCount = 0;
        let regulationCount = 0;
        try {
          const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as {
            data?: {
              incoming?: unknown[];
              outgoing?: unknown[];
              regulations?: unknown[];
            };
          };
          if (Array.isArray(parsed.data?.incoming)) incomingCount = parsed.data.incoming.length;
          if (Array.isArray(parsed.data?.outgoing)) outgoingCount = parsed.data.outgoing.length;
          if (Array.isArray(parsed.data?.regulations)) {
            regulationCount = parsed.data.regulations.length;
          }
        } catch {
          // Abaikan bila berkas korup sebagian
        }
        results.push({
          fileName,
          createdAt: st.mtime.toISOString(),
          sizeBytes: st.size,
          reason,
          incomingCount,
          outgoingCount,
          regulationCount,
        });
      } catch {
        // Lewati berkas tidak terbaca
      }
    }
    return results;
  }

  createAutoSnapshot(
    reason: 'startup' | 'pre-restore' | 'manual' = 'manual',
    skipIfRecent = false
  ): string {
    const backupDir = this.getBackupDir();
    if (!backupDir) return '';
    fs.mkdirSync(backupDir, { recursive: true });

    const existing = this.listSnapshots();
    if (skipIfRecent && existing.length > 0) {
      const newestMs = Date.parse(existing[0].createdAt);
      if (!Number.isNaN(newestMs) && Date.now() - newestMs < 60 * 1000) {
        this.lastAutoBackupAt = existing[0].createdAt;
        return existing[0].fileName;
      }
    }

    this.checkpointDatabase('TRUNCATE');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `snapshot-${stamp}-${reason}.json`;
    const targetPath = path.join(backupDir, fileName);
    const snapshot = this.exportFullBackup();
    fs.writeFileSync(targetPath, JSON.stringify(snapshot, null, 2), 'utf8');

    // Simpan juga salinan biner SQLite terverifikasi setiap kali startup/pre-restore
    const dbBackupName = `persuratan-${stamp}-${reason}.db`;
    try {
      fs.copyFileSync(this.dbPath, path.join(backupDir, dbBackupName));
    } catch {
      // Abaikan bila OS menahan lock sementara; JSON snapshot tetap tersimpan
    }

    this.lastAutoBackupAt = new Date().toISOString();

    // Pertahankan maksimal 10 snapshot JSON dan 10 salinan .db terbaru
    const allJson = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const old of allJson.slice(10)) {
      try {
        fs.unlinkSync(path.join(backupDir, old));
      } catch {
        // Abaikan
      }
    }
    const allDb = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('persuratan-') && f.endsWith('.db'))
      .sort()
      .reverse();
    for (const oldDb of allDb.slice(10)) {
      try {
        fs.unlinkSync(path.join(backupDir, oldDb));
      } catch {
        // Abaikan
      }
    }

    return fileName;
  }

  readSnapshotPayload(fileName: string): Record<string, unknown> {
    const backupDir = this.getBackupDir();
    if (!backupDir) {
      throw new NotFoundError('Snapshot disk tidak tersedia pada database memori.');
    }
    const safeBase = path.basename(fileName);
    if (!safeBase || !safeBase.endsWith('.json') || safeBase.includes('..')) {
      throw new ValidationError('Nama berkas snapshot tidak valid.');
    }
    const fullPath = path.join(backupDir, safeBase);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError('Berkas snapshot tidak ditemukan.');
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  }

  checkpointDatabase(mode: 'PASSIVE' | 'TRUNCATE' = 'TRUNCATE'): DatabaseStorageStatus {
    try {
      this.db.exec(`PRAGMA wal_checkpoint(${mode});`);
      const checkRow = this.db.prepare('PRAGMA quick_check').get() as
        | Record<string, string>
        | undefined;
      this.integrityStatus = (checkRow ? Object.values(checkRow)[0] : 'ok') || 'ok';
      this.lastCheckpointAt = new Date().toISOString();
    } catch (err) {
      this.integrityStatus = err instanceof Error ? err.message : 'checkpoint_error';
    }
    return this.getStorageStatus();
  }

  getStorageStatus(): DatabaseStorageStatus {
    const journalRow = this.db.prepare('PRAGMA journal_mode').get() as
      | Record<string, string>
      | undefined;
    const syncRow = this.db.prepare('PRAGMA synchronous').get() as
      | Record<string, number>
      | undefined;

    const journalMode = journalRow ? String(Object.values(journalRow)[0]).toUpperCase() : 'WAL';
    const syncNum = syncRow ? Number(Object.values(syncRow)[0]) : 2;
    const synchronousMode =
      syncNum === 3 ? 'EXTRA' : syncNum === 2 ? 'FULL' : syncNum === 1 ? 'NORMAL' : 'OFF';

    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    if (this.dbPath !== ':memory:') {
      try {
        if (fs.existsSync(this.dbPath)) {
          dbSizeBytes = fs.statSync(this.dbPath).size;
        }
        const walPath = `${this.dbPath}-wal`;
        if (fs.existsSync(walPath)) {
          walSizeBytes = fs.statSync(walPath).size;
        }
      } catch {
        // Abaikan jika file stat tidak dapat dibaca
      }
    }

    const snapshots = this.listSnapshots();
    const lastAutoBackupAt =
      this.lastAutoBackupAt || (snapshots.length > 0 ? snapshots[0].createdAt : '');

    const incomingCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM incoming_letters').get() as { cnt: number }
    ).cnt;
    const outgoingCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM outgoing_letters').get() as { cnt: number }
    ).cnt;
    const dispositionCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM dispositions').get() as { cnt: number }
    ).cnt;
    const userCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }
    ).cnt;
    const uploadStats = this.db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS total_bytes FROM uploaded_files')
      .get() as { cnt: number; total_bytes: number };
    const unreadSecurityAlerts = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM security_alerts WHERE is_read = 0').get() as {
        cnt: number;
      }
    ).cnt;

    return {
      journalMode,
      synchronousMode,
      integrityStatus: this.integrityStatus,
      dbSizeBytes,
      walSizeBytes,
      lastCheckpointAt: this.lastCheckpointAt,
      lastAutoBackupAt,
      autoBackupCount: snapshots.length,
      incomingCount,
      outgoingCount,
      dispositionCount,
      userCount,
      uploadedFileCount: uploadStats.cnt,
      uploadedFilesBytes: uploadStats.total_bytes,
      unreadSecurityAlerts,
    };
  }

  exportFullBackup(): Record<string, unknown> {
    this.checkpointDatabase('PASSIVE');
    return {
      exportedAt: new Date().toISOString(),
      service: 'e-surat-smpn2-girimulyo',
      storageStatus: this.getStorageStatus(),
      data: {
        ...this.getBootstrapData(),
        activityLogs: this.listActivityLogs(300),
        uploadedFiles: this.listUploadedFilesForBackup(),
      },
    };
  }

  restoreFromBackup(
    rawPayload: unknown,
    mode: 'merge' | 'replace' = 'merge'
  ): BackupRestoreResult {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('Format berkas cadangan JSON tidak valid.');
    }
    const root = rawPayload as Record<string, unknown>;
    const payload =
      root.data && typeof root.data === 'object'
        ? (root.data as Record<string, unknown>)
        : root;

    if (!Array.isArray(payload.incoming) || !Array.isArray(payload.outgoing)) {
      throw new ValidationError(
        'Struktur berkas cadangan tidak sesuai (wajib memiliki data surat masuk & surat keluar).'
      );
    }

    const safetySnapshotFile = this.createAutoSnapshot('pre-restore', false);

    let restoredIncoming = 0;
    let restoredOutgoing = 0;
    let restoredDispositions = 0;
    let restoredRegulations = 0;
    let restoredClassifications = 0;
    let restoredCounters = 0;
    let restoredUploadedFiles = 0;
    let restoredRecipients = 0;
    let settingsUpdated = false;

    const incomingItems = payload.incoming as Array<Record<string, unknown>>;
    const outgoingItems = payload.outgoing as Array<Record<string, unknown>>;
    const classItems = Array.isArray(payload.classifications)
      ? (payload.classifications as Array<Record<string, unknown>>)
      : [];
    const regulationItems = Array.isArray(payload.regulations)
      ? (payload.regulations as Array<Record<string, unknown>>)
      : [];
    const recipientItems = Array.isArray(payload.dispositionRecipients)
      ? (payload.dispositionRecipients as Array<Record<string, unknown>>)
      : [];
    const hasRecipientList = Array.isArray(payload.dispositionRecipients);
    const counterItems = Array.isArray(payload.counters)
      ? (payload.counters as Array<Record<string, unknown>>)
      : [];
    const uploadedFileItems = Array.isArray(payload.uploadedFiles)
      ? (payload.uploadedFiles as Array<Record<string, unknown>>)
      : [];

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (mode === 'replace') {
        this.db.prepare('DELETE FROM dispositions').run();
        this.db.prepare('DELETE FROM incoming_letters').run();
        this.db.prepare('DELETE FROM outgoing_letters').run();
        this.db.prepare('DELETE FROM classifications').run();
        this.db.prepare('DELETE FROM letter_regulations').run();
        this.db.prepare('DELETE FROM year_counters').run();
        if (hasRecipientList) {
          this.db.prepare('DELETE FROM disposition_recipients').run();
        }
        if (uploadedFileItems.length > 0) {
          this.db.prepare('DELETE FROM uploaded_files').run();
        }
      }

      // 1. Klasifikasi
      const upsertClassStmt = this.db.prepare(
        `INSERT INTO classifications (code, name, description)
         VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           name = excluded.name,
           description = excluded.description`
      );
      for (const c of classItems) {
        if (!c || typeof c.code !== 'string' || typeof c.name !== 'string') continue;
        upsertClassStmt.run(
          c.code.trim(),
          c.name.trim(),
          typeof c.description === 'string' ? c.description : ''
        );
        restoredClassifications += 1;
      }

      // 2. Penghitung tahunan
      const upsertCounterStmt = this.db.prepare(
        mode === 'replace'
          ? `INSERT INTO year_counters (year, incoming_last_seq, outgoing_last_seq)
             VALUES (?, ?, ?)
             ON CONFLICT(year) DO UPDATE SET
               incoming_last_seq = excluded.incoming_last_seq,
               outgoing_last_seq = excluded.outgoing_last_seq`
          : `INSERT INTO year_counters (year, incoming_last_seq, outgoing_last_seq)
             VALUES (?, ?, ?)
             ON CONFLICT(year) DO UPDATE SET
               incoming_last_seq = MAX(year_counters.incoming_last_seq, excluded.incoming_last_seq),
               outgoing_last_seq = MAX(year_counters.outgoing_last_seq, excluded.outgoing_last_seq)`
      );
      for (const cnt of counterItems) {
        const y = Number(cnt?.year);
        if (!Number.isInteger(y)) continue;
        upsertCounterStmt.run(
          y,
          Math.max(0, Number(cnt.incomingLastSeq) || 0),
          Math.max(0, Number(cnt.outgoingLastSeq) || 0)
        );
        restoredCounters += 1;
      }

      // 3. Surat Masuk & Disposisi (pertahankan data yang updated_at lebih baru saat merge)
      const upsertIncomingStmt = this.db.prepare(
        `INSERT INTO incoming_letters (
          id, agenda_number, sequence_number, agenda_year, letter_number,
          letter_date, received_date, sender, subject, classification_code,
          urgency, status, attachment_url, attachment_name, notes, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agenda_number = excluded.agenda_number,
          sequence_number = excluded.sequence_number,
          agenda_year = excluded.agenda_year,
          letter_number = excluded.letter_number,
          letter_date = excluded.letter_date,
          received_date = excluded.received_date,
          sender = excluded.sender,
          subject = excluded.subject,
          classification_code = excluded.classification_code,
          urgency = excluded.urgency,
          status = excluded.status,
          attachment_url = excluded.attachment_url,
          attachment_name = excluded.attachment_name,
          notes = excluded.notes,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= incoming_letters.updated_at`
      );
      const upsertDispStmt = this.db.prepare(
        `INSERT INTO dispositions (
          id, incoming_letter_id, target_unit, target_staff_name, instruction,
          deadline_date, status, completion_note, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          target_unit = excluded.target_unit,
          target_staff_name = excluded.target_staff_name,
          instruction = excluded.instruction,
          deadline_date = excluded.deadline_date,
          status = excluded.status,
          completion_note = excluded.completion_note,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= dispositions.updated_at`
      );

      for (const item of incomingItems) {
        if (!item || typeof item.id !== 'string' || typeof item.agendaNumber !== 'string') continue;
        // Lewati jika nomor agenda sudah dipakai surat lain dalam mode merge
        if (mode === 'merge') {
          const dupAgenda = this.db
            .prepare('SELECT id FROM incoming_letters WHERE agenda_number = ? AND id != ?')
            .get(item.agendaNumber, item.id);
          if (dupAgenda) continue;
        }
        const now = new Date().toISOString();
        upsertIncomingStmt.run(
          item.id,
          item.agendaNumber,
          Number(item.sequenceNumber) || 1,
          Number(item.agendaYear) || new Date().getFullYear(),
          String(item.letterNumber || ''),
          String(item.letterDate || now.slice(0, 10)),
          String(item.receivedDate || now.slice(0, 10)),
          String(item.sender || ''),
          String(item.subject || ''),
          String(item.classificationCode || '005'),
          String(item.urgency || 'Biasa'),
          String(item.status || 'Menunggu Disposisi'),
          String(item.attachmentUrl || ''),
          String(item.attachmentName || ''),
          String(item.notes || ''),
          String(item.createdBy || 'Admin Tata Usaha'),
          String(item.createdAt || now),
          String(item.updatedAt || now)
        );
        restoredIncoming += 1;

        if (Array.isArray(item.dispositions)) {
          for (const d of item.dispositions as Array<Record<string, unknown>>) {
            if (!d || typeof d.id !== 'string') continue;
            upsertDispStmt.run(
              d.id,
              item.id,
              String(d.targetUnit || ''),
              String(d.targetStaffName || ''),
              String(d.instruction || ''),
              String(d.deadlineDate || ''),
              String(d.status || 'Belum Ditindaklanjuti'),
              String(d.completionNote || ''),
              String(d.createdBy || 'Kepala Sekolah'),
              String(d.createdAt || now),
              String(d.updatedAt || now)
            );
            restoredDispositions += 1;
          }
        }
      }

      // 4. Surat Keluar
      const upsertOutgoingStmt = this.db.prepare(
        `INSERT INTO outgoing_letters (
          id, sequence_number, letter_year, full_letter_number, is_manual_number,
          classification_code, letter_date, recipient, subject, drafter_name,
          status, attachment_url, attachment_name, body_text, notes, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sequence_number = excluded.sequence_number,
          letter_year = excluded.letter_year,
          full_letter_number = excluded.full_letter_number,
          is_manual_number = excluded.is_manual_number,
          classification_code = excluded.classification_code,
          letter_date = excluded.letter_date,
          recipient = excluded.recipient,
          subject = excluded.subject,
          drafter_name = excluded.drafter_name,
          status = excluded.status,
          attachment_url = excluded.attachment_url,
          attachment_name = excluded.attachment_name,
          body_text = excluded.body_text,
          notes = excluded.notes,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= outgoing_letters.updated_at`
      );

      for (const item of outgoingItems) {
        if (!item || typeof item.id !== 'string' || typeof item.fullLetterNumber !== 'string') {
          continue;
        }
        if (mode === 'merge') {
          const dupOut = this.db
            .prepare('SELECT id FROM outgoing_letters WHERE full_letter_number = ? AND id != ?')
            .get(item.fullLetterNumber, item.id);
          if (dupOut) continue;
        }
        const now = new Date().toISOString();
        upsertOutgoingStmt.run(
          item.id,
          Number(item.sequenceNumber) || 0,
          Number(item.letterYear) || new Date().getFullYear(),
          item.fullLetterNumber,
          item.isManualNumber ? 1 : 0,
          String(item.classificationCode || '421.3'),
          String(item.letterDate || now.slice(0, 10)),
          String(item.recipient || ''),
          String(item.subject || ''),
          String(item.drafterName || ''),
          String(item.status || 'Draf'),
          String(item.attachmentUrl || ''),
          String(item.attachmentName || ''),
          String(item.bodyText || ''),
          String(item.notes || ''),
          String(item.createdBy || 'Admin Tata Usaha'),
          String(item.createdAt || now),
          String(item.updatedAt || now)
        );
        restoredOutgoing += 1;
      }

      // 5. Referensi Peraturan PDF
      const upsertRegStmt = this.db.prepare(
        `INSERT INTO letter_regulations (
          id, title, regulation_number, year, category, issuing_body, summary,
          file_url, file_name, file_size_bytes, uploaded_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          regulation_number = excluded.regulation_number,
          year = excluded.year,
          category = excluded.category,
          issuing_body = excluded.issuing_body,
          summary = excluded.summary,
          file_url = excluded.file_url,
          file_name = excluded.file_name,
          file_size_bytes = excluded.file_size_bytes,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= letter_regulations.updated_at`
      );
      for (const reg of regulationItems) {
        if (!reg || typeof reg.id !== 'string' || typeof reg.fileUrl !== 'string') continue;
        const now = new Date().toISOString();
        upsertRegStmt.run(
          reg.id,
          String(reg.title || ''),
          String(reg.regulationNumber || ''),
          Number(reg.year) || new Date().getFullYear(),
          REGULATION_CATEGORIES.includes(String(reg.category) as RegulationCategory)
            ? String(reg.category)
            : 'Lainnya',
          String(reg.issuingBody || ''),
          String(reg.summary || ''),
          reg.fileUrl,
          String(reg.fileName || 'peraturan.pdf'),
          Math.max(0, Number(reg.fileSizeBytes) || 0),
          String(reg.uploadedBy || 'Admin Tata Usaha'),
          String(reg.createdAt || now),
          String(reg.updatedAt || now)
        );
        restoredRegulations += 1;
      }

      // 5b. Direktori Guru & Karyawan Penerima Disposisi
      const upsertRecipientStmt = this.db.prepare(
        `INSERT INTO disposition_recipients (
          id, name, nip, category, unit, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          nip = excluded.nip,
          category = excluded.category,
          unit = excluded.unit,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= disposition_recipients.updated_at`
      );
      for (const rec of recipientItems) {
        if (!rec || typeof rec.id !== 'string' || typeof rec.name !== 'string') continue;
        const cleanName = rec.name.trim();
        if (!cleanName) continue;
        if (mode === 'merge') {
          const dupRec = this.db
            .prepare('SELECT id FROM disposition_recipients WHERE LOWER(name) = LOWER(?) AND id != ?')
            .get(cleanName, rec.id);
          if (dupRec) continue;
        }
        const rawCat = String(rec.category || 'Guru').trim();
        const safeCat: StaffCategory = VALID_STAFF_CATEGORIES.has(rawCat as StaffCategory)
          ? (rawCat as StaffCategory)
          : 'Guru';
        const now = new Date().toISOString();
        upsertRecipientStmt.run(
          rec.id,
          cleanName.slice(0, 120),
          String(rec.nip || '').slice(0, 40),
          safeCat,
          String(rec.unit || '').slice(0, 160),
          rec.isActive === false ? 0 : 1,
          String(rec.createdAt || now),
          String(rec.updatedAt || now)
        );
        restoredRecipients += 1;
      }

      // 6. Berkas Unggahan Biner (PDF & Gambar)
      const upsertUploadStmt = this.db.prepare(
        `INSERT INTO uploaded_files (
          file_key, url_path, original_name, mime_type, size_bytes, content_blob, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_key) DO NOTHING`
      );
      for (const uf of uploadedFileItems) {
        if (!uf || typeof uf.fileKey !== 'string' || typeof uf.dataBase64 !== 'string') continue;
        const safeKey = path.basename(uf.fileKey);
        if (!safeKey || safeKey !== uf.fileKey) continue;
        try {
          const buf = Buffer.from(uf.dataBase64, 'base64');
          if (buf.byteLength === 0) continue;
          const now = new Date().toISOString();
          upsertUploadStmt.run(
            safeKey,
            typeof uf.urlPath === 'string' && uf.urlPath ? uf.urlPath : `/uploads/${safeKey}`,
            String(uf.originalName || safeKey).slice(0, 120),
            String(uf.mimeType || 'application/octet-stream').slice(0, 80),
            buf.byteLength,
            buf,
            String(uf.uploadedBy || '').slice(0, 80),
            String(uf.createdAt || now)
          );
          restoredUploadedFiles += 1;
        } catch {
          // Lewati berkas tidak valid
        }
      }

      // 7. Pengaturan Sekolah (hanya jika mode replace atau saat tersedia di cadangan)
      if (mode === 'replace' && payload.settings && typeof payload.settings === 'object') {
        const s = payload.settings as Partial<SchoolSettings>;
        const current = this.getSettings();
        const mergedSettings: SchoolSettings = {
          ...current,
          ...s,
          kopImageUrl: typeof s.kopImageUrl === 'string' ? s.kopImageUrl : current.kopImageUrl,
          themeId: typeof s.themeId === 'string' && s.themeId ? s.themeId : current.themeId,
          autoInitNewYearCounter:
            typeof s.autoInitNewYearCounter === 'boolean'
              ? s.autoInitNewYearCounter
              : current.autoInitNewYearCounter,
          menuConfigs: normalizeMenuConfigsInput(s.menuConfigs, current.menuConfigs),
        };
        const loginPortalJson = JSON.stringify({
          loginHeadline: mergedSettings.loginHeadline,
          loginDescription: mergedSettings.loginDescription,
          loginFormTitle: mergedSettings.loginFormTitle,
          loginFormSubtitle: mergedSettings.loginFormSubtitle,
        });
        this.db
          .prepare(
            `UPDATE school_settings SET
              school_name = ?, parent_agency = ?, district_gov = ?, address = ?,
              postal_code = ?, phone = ?, email = ?, website = ?, npsn = ?,
              school_code = ?, principal_name = ?, principal_nip = ?,
              tu_head_name = ?, tu_head_nip = ?, outgoing_format_pattern = ?,
              logo_url = ?, kop_image_url = ?, theme_id = ?, auto_init_new_year_counter = ?,
              menu_configs_json = ?, login_portal_json = ?
            WHERE id = 1`
          )
          .run(
            mergedSettings.schoolName,
            mergedSettings.parentAgency,
            mergedSettings.districtGov,
            mergedSettings.address,
            mergedSettings.postalCode,
            mergedSettings.phone,
            mergedSettings.email,
            mergedSettings.website,
            mergedSettings.npsn,
            mergedSettings.schoolCode,
            mergedSettings.principalName,
            mergedSettings.principalNip,
            mergedSettings.tuHeadName,
            mergedSettings.tuHeadNip,
            mergedSettings.outgoingFormatPattern,
            mergedSettings.logoUrl,
            mergedSettings.kopImageUrl,
            mergedSettings.themeId,
            mergedSettings.autoInitNewYearCounter ? 1 : 0,
            JSON.stringify(mergedSettings.menuConfigs),
            loginPortalJson
          );
        settingsUpdated = true;
      }

      this.db
        .prepare(
          `INSERT INTO app_metadata (meta_key, meta_value, updated_at)
           VALUES ('initial_seed_done', '1', ?)
           ON CONFLICT(meta_key) DO UPDATE SET meta_value = '1', updated_at = excluded.updated_at`
        )
        .run(new Date().toISOString());

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.checkpointDatabase('TRUNCATE');
    return {
      mode,
      restoredIncoming,
      restoredOutgoing,
      restoredDispositions,
      restoredRegulations,
      restoredClassifications,
      restoredCounters,
      restoredUploadedFiles,
      restoredRecipients,
      settingsUpdated,
      safetySnapshotFile,
    };
  }

  getBootstrapData(): BootstrapData {
    return {
      incoming: this.listIncomingLetters(),
      outgoing: this.listOutgoingLetters(),
      classifications: this.listClassifications(),
      regulations: this.listRegulations(),
      dispositionRecipients: this.listDispositionRecipients(),
      settings: this.getSettings(),
      counters: this.listCounters(),
    };
  }
}
