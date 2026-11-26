export type LetterUrgency = 'Biasa' | 'Penting' | 'Segera' | 'Rahasia';

export type IncomingStatus =
  | 'Menunggu Disposisi'
  | 'Didisposisikan'
  | 'Diproses'
  | 'Selesai';

export type OutgoingStatus =
  | 'Draf'
  | 'Menunggu TTD'
  | 'Terkirim'
  | 'Diarsipkan';

export type DispositionStatus =
  | 'Belum Ditindaklanjuti'
  | 'Sedang Diproses'
  | 'Selesai';

export type StaffRole = 'admin' | 'kepala_sekolah' | 'staf';

export interface Disposition {
  id: string;
  incomingLetterId: string;
  targetUnit: string;
  targetStaffName: string;
  instruction: string;
  deadlineDate: string;
  status: DispositionStatus;
  completionNote: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncomingLetter {
  id: string;
  agendaNumber: string;
  sequenceNumber: number;
  agendaYear: number;
  letterNumber: string;
  letterDate: string;
  receivedDate: string;
  sender: string;
  subject: string;
  classificationCode: string;
  urgency: LetterUrgency;
  status: IncomingStatus;
  attachmentUrl: string;
  attachmentName: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  dispositions: Disposition[];
}

export interface OutgoingLetter {
  id: string;
  sequenceNumber: number;
  letterYear: number;
  fullLetterNumber: string;
  isManualNumber: boolean;
  classificationCode: string;
  letterDate: string;
  recipient: string;
  subject: string;
  drafterName: string;
  status: OutgoingStatus;
  attachmentUrl: string;
  attachmentName: string;
  bodyText: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassificationCode {
  code: string;
  name: string;
  description: string;
}

export interface ClassificationSchemaError {
  rowNumber: number;
  field: 'header' | 'code' | 'name' | 'description' | 'row' | 'file';
  code: string;
  message: string;
}

export interface ClassificationRowPreview {
  rowNumber: number;
  code: string;
  name: string;
  description: string;
  status: 'valid' | 'duplicate' | 'invalid';
  errorMessage?: string;
}

export interface ClassificationValidationSummary {
  schemaValid: boolean;
  requiredColumns: string[];
  optionalColumns: string[];
  detectedHeaders: string[];
  headerMatched: {
    code: boolean;
    name: boolean;
    description: boolean;
  };
  totalRowsScanned: number;
  validCount: number;
  invalidCount: number;
  duplicateOverrides: number;
  errors: ClassificationSchemaError[];
  rowPreviews: ClassificationRowPreview[];
}

export interface ClassificationImportResult {
  mode: 'merge' | 'replace';
  totalProcessed: number;
  inserted: number;
  updated: number;
  totalClassifications: number;
  items: ClassificationCode[];
  validation?: ClassificationValidationSummary;
}

export interface ClassificationXlsxDryRunResult {
  valid: boolean;
  items: ClassificationCode[];
  validation: ClassificationValidationSummary;
}

export interface YearCounter {
  year: number;
  incomingLastSeq: number;
  outgoingLastSeq: number;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  jabatan: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
}

export const DEFAULT_LOGIN_PORTAL_COPY = {
  loginHeadline: 'Sistem Informasi Manajemen Persuratan Sekolah',
  loginDescription:
    'Portal administrasi tata usaha untuk pencatatan surat masuk, penomoran otomatis surat keluar, lembar disposisi pimpinan, serta pengarsipan agenda resmi.',
  loginFormTitle: 'Masuk ke Portal E-Surat',
  loginFormSubtitle:
    'Gunakan akun staf Tata Usaha, Kepala Sekolah, atau unit penerima disposisi.',
};

export interface PublicBranding {
  schoolName: string;
  parentAgency: string;
  districtGov: string;
  address: string;
  logoUrl: string;
  loginHeadline: string;
  loginDescription: string;
  loginFormTitle: string;
  loginFormSubtitle: string;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  database: string;
  timestamp: string;
  uptimeSeconds: number;
}

export type AppMenuKey =
  | 'dashboard'
  | 'incoming'
  | 'outgoing'
  | 'dispositions'
  | 'regulations'
  | 'guide'
  | 'settings';

export interface MenuMetadataConfig {
  label: string;
  title: string;
  description: string;
}

export type AppMenuConfigs = Record<AppMenuKey, MenuMetadataConfig>;

export const DEFAULT_MENU_CONFIGS: AppMenuConfigs = {
  dashboard: {
    label: 'Dasbor',
    title: 'Dasbor Persuratan',
    description:
      'Pantau antrean surat masuk prioritas, progres disposisi unit sekolah, dan penerbitan nomor surat keluar.',
  },
  incoming: {
    label: 'Surat Masuk',
    title: 'Buku Agenda Surat Masuk',
    description:
      'Kelola pencatatan surat masuk, pencarian cepat, lembar disposisi, serta cetak buku agenda resmi.',
  },
  outgoing: {
    label: 'Surat Keluar',
    title: 'Buku Agenda Surat Keluar',
    description:
      'Terbitkan nomor surat keluar otomatis, susun naskah surat dinas, dan ekspor agenda ke PDF atau CSV.',
  },
  dispositions: {
    label: 'Disposisi',
    title: 'Disposisi & Tindak Lanjut',
    description:
      'Pantau dan perbarui tindak lanjut instruksi disposisi pimpinan oleh masing-masing unit kerja sekolah.',
  },
  regulations: {
    label: 'Referensi Peraturan',
    title: 'Referensi Peraturan Persuratan',
    description:
      'Simpan dan baca dokumen PDF peraturan perundang-undangan, tata naskah dinas, dan pedoman resmi persuratan.',
  },
  guide: {
    label: 'Panduan Aplikasi',
    title: 'Panduan Penggunaan Aplikasi',
    description:
      'Dokumen panduan penggunaan aplikasi E-Surat dalam format PDF resmi yang dapat dibaca langsung dan diunduh.',
  },
  settings: {
    label: 'Pengaturan',
    title: 'Pengaturan & Monitoring',
    description:
      'Kelola profil dan logo sekolah, tema aplikasi, kode klasifikasi, keterangan menu, akun pengguna, serta log aktivitas.',
  },
};

export function normalizeMenuConfigs(
  raw?: Partial<Record<AppMenuKey, Partial<MenuMetadataConfig>>> | null
): AppMenuConfigs {
  const keys: AppMenuKey[] = [
    'dashboard',
    'incoming',
    'outgoing',
    'dispositions',
    'regulations',
    'guide',
    'settings',
  ];
  const result = {} as AppMenuConfigs;
  for (const key of keys) {
    const def = DEFAULT_MENU_CONFIGS[key];
    const entry = raw && typeof raw === 'object' ? raw[key] : undefined;
    result[key] = {
      label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label : def.label,
      title: typeof entry?.title === 'string' && entry.title.trim() ? entry.title : def.title,
      description: typeof entry?.description === 'string' ? entry.description : def.description,
    };
  }
  return result;
}

export interface SchoolSettings {
  schoolName: string;
  parentAgency: string;
  districtGov: string;
  address: string;
  postalCode: string;
  phone: string;
  email: string;
  website: string;
  npsn: string;
  schoolCode: string;
  principalName: string;
  principalNip: string;
  tuHeadName: string;
  tuHeadNip: string;
  outgoingFormatPattern: string;
  logoUrl: string;
  kopImageUrl: string;
  themeId: string;
  autoInitNewYearCounter: boolean;
  menuConfigs: AppMenuConfigs;
  loginHeadline: string;
  loginDescription: string;
  loginFormTitle: string;
  loginFormSubtitle: string;
}

export interface ErrorLogEntry {
  id: string;
  level: 'error' | 'warn';
  route: string;
  method: string;
  message: string;
  stack: string;
  createdAt: string;
}

export type ActivityAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type ActivityEntityType = 'incoming' | 'outgoing';

export interface ActivityLogEntry {
  id: string;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  actorRole: string;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;
  referenceNumber: string;
  subject: string;
  details: string;
  createdAt: string;
}

export type SecurityAlertSeverity = 'medium' | 'high' | 'critical';

export type SecurityAlertCategory =
  | 'BRUTE_FORCE'
  | 'AUTH_PROBE'
  | 'PRIVILEGE_ESCALATION'
  | 'INJECTION_ATTEMPT'
  | 'PATH_TRAVERSAL'
  | 'MALICIOUS_UPLOAD'
  | 'INTEGRITY_ALERT';

export interface SecurityAlertEntry {
  id: string;
  severity: SecurityAlertSeverity;
  category: SecurityAlertCategory;
  title: string;
  message: string;
  ipAddress: string;
  route: string;
  method: string;
  actorUsername: string;
  userAgent: string;
  isRead: boolean;
  resolvedBy: string;
  resolvedAt: string;
  createdAt: string;
}

export interface DatabaseStorageStatus {
  journalMode: string;
  synchronousMode: string;
  integrityStatus: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  lastCheckpointAt: string;
  lastAutoBackupAt: string;
  autoBackupCount: number;
  incomingCount: number;
  outgoingCount: number;
  dispositionCount: number;
  userCount: number;
  uploadedFileCount: number;
  uploadedFilesBytes: number;
  unreadSecurityAlerts: number;
}

export interface DatabaseSnapshotSummary {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  reason: string;
  incomingCount: number;
  outgoingCount: number;
  regulationCount: number;
}

export type StaffCategory = 'Guru' | 'Karyawan';

export const STAFF_CATEGORY_OPTIONS: StaffCategory[] = ['Guru', 'Karyawan'];

export interface DispositionRecipient {
  id: string;
  name: string;
  nip: string;
  category: StaffCategory;
  unit: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BackupRestoreResult {
  mode: 'merge' | 'replace';
  restoredIncoming: number;
  restoredOutgoing: number;
  restoredDispositions: number;
  restoredRegulations: number;
  restoredClassifications: number;
  restoredCounters: number;
  restoredUploadedFiles: number;
  restoredRecipients?: number;
  settingsUpdated: boolean;
  safetySnapshotFile: string;
}

export interface LetterDraftRecord {
  draftKey: string;
  payload: Record<string, unknown>;
  updatedAt: string;
}

export type RegulationCategory =
  | 'Tata Naskah Dinas'
  | 'Klasifikasi Arsip'
  | 'Kearsipan & Retensi'
  | 'Pedoman Sekolah'
  | 'Lainnya';

export const REGULATION_CATEGORIES: RegulationCategory[] = [
  'Tata Naskah Dinas',
  'Klasifikasi Arsip',
  'Kearsipan & Retensi',
  'Pedoman Sekolah',
  'Lainnya',
];

export interface LetterRegulation {
  id: string;
  title: string;
  regulationNumber: string;
  year: number;
  category: RegulationCategory;
  issuingBody: string;
  summary: string;
  fileUrl: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapData {
  incoming: IncomingLetter[];
  outgoing: OutgoingLetter[];
  classifications: ClassificationCode[];
  regulations: LetterRegulation[];
  dispositionRecipients: DispositionRecipient[];
  settings: SchoolSettings;
  counters: YearCounter[];
}

export const STAFF_UNITS: string[] = [
  'Wakil Kepala Sekolah Bidang Kurikulum',
  'Wakil Kepala Sekolah Bidang Kesiswaan',
  'Wakil Kepala Sekolah Bidang Sarana & Prasarana',
  'Wakil Kepala Sekolah Bidang Humas',
  'Bagian Tata Usaha',
  'Bendahara BOS / Keuangan',
  'Koordinator Bimbingan Konseling (BK)',
  'Kepala Perpustakaan',
  'Pengelola Laboratorium IPA / TIK',
  'Tim Pengembang Sekolah',
];

export const URGENCY_OPTIONS: LetterUrgency[] = [
  'Biasa',
  'Penting',
  'Segera',
  'Rahasia',
];

export const INCOMING_STATUS_OPTIONS: IncomingStatus[] = [
  'Menunggu Disposisi',
  'Didisposisikan',
  'Diproses',
  'Selesai',
];

export const OUTGOING_STATUS_OPTIONS: OutgoingStatus[] = [
  'Draf',
  'Menunggu TTD',
  'Terkirim',
  'Diarsipkan',
];

export const DISPOSITION_STATUS_OPTIONS: DispositionStatus[] = [
  'Belum Ditindaklanjuti',
  'Sedang Diproses',
  'Selesai',
];

export type AiDraftTone =
  | 'surat_dinas'
  | 'undangan'
  | 'permohonan'
  | 'pemberitahuan'
  | 'sempurnakan';

export interface AiIncomingAnalysisResult {
  letterNumber: string;
  letterDate: string;
  receivedDate: string;
  sender: string;
  subject: string;
  classificationCode: string;
  urgency: LetterUrgency;
  notes: string;
  summary: string;
  confidenceNote: string;
}

export interface AiOutgoingDraftResult {
  subject: string;
  bodyText: string;
  notes: string;
  toneUsed: string;
}

export interface AiLetterInsightResult {
  summary: string;
  keyPoints: string[];
  recommendedUnit: string;
  recommendedInstruction: string;
  recommendedDeadlineDays: number;
  urgencyAssessment: string;
  suggestedReplySubject: string;
  reviewNotes: string[];
}

export interface AiArchiveQueryResult {
  answer: string;
  highlights: string[];
  referencedNumbers: string[];
}

export interface BloggerSourceFileSummary {
  path: string;
  sizeBytes: number;
}

export interface BloggerExportPackage {
  generatedAt: string;
  schoolName: string;
  appOrigin: string;
  sourceFileCount: number;
  sourceFiles: BloggerSourceFileSummary[];
  htmlBundle: string;
  xmlTheme: string;
  iframeSnippet: string;
  guideText: string;
  bundleStats: {
    jsBytes: number;
    cssBytes: number;
    htmlBytes: number;
    xmlBytes: number;
  };
}

export interface SpreadsheetExportDataset {
  exportedAt: string;
  service?: string;
  data: BootstrapData & {
    activityLogs?: ActivityLogEntry[];
  };
}
