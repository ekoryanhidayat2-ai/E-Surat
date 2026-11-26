import type {
  ActivityLogEntry,
  AiArchiveQueryResult,
  AiDraftTone,
  AiIncomingAnalysisResult,
  AiLetterInsightResult,
  AiOutgoingDraftResult,
  AuthUser,
  BackupRestoreResult,
  BloggerExportPackage,
  BootstrapData,
  ClassificationCode,
  ClassificationImportResult,
  ClassificationXlsxDryRunResult,
  DatabaseSnapshotSummary,
  DatabaseStorageStatus,
  DispositionRecipient,
  DispositionStatus,
  ErrorLogEntry,
  HealthStatus,
  IncomingLetter,
  IncomingStatus,
  LetterDraftRecord,
  LetterRegulation,
  LetterUrgency,
  OutgoingLetter,
  OutgoingStatus,
  PublicBranding,
  RegulationCategory,
  SchoolSettings,
  SecurityAlertEntry,
  SpreadsheetExportDataset,
  StaffCategory,
  StaffRole,
  YearCounter,
} from '../types.ts';

const TOKEN_STORAGE_KEY = 'esurat_auth_token';

export function getStoredToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Abaikan jika sessionStorage tidak tersedia
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  let jsonParseFailed = false;
  try {
    data = await res.json();
  } catch {
    jsonParseFailed = true;
  }

  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (!res.ok) {
    const message =
      typeof record.error === 'string'
        ? record.error
        : `Permintaan gagal dengan status ${res.status}`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (jsonParseFailed || data === null) {
    throw new Error('Respons server bukan format JSON yang valid.');
  }
  return data as T;
}

export const api = {
  getPublicBranding: () => requestJson<PublicBranding>('/api/public/school-branding'),

  login: async (username: string, password: string) => {
    const res = await requestJson<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setStoredToken(res.token);
    return res.user;
  },

  logout: async () => {
    try {
      await requestJson<void>('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken('');
    }
  },

  getMe: () => requestJson<{ user: AuthUser }>('/api/auth/me'),

  getBootstrap: () => requestJson<BootstrapData>('/api/bootstrap'),

  getHealth: () => requestJson<HealthStatus>('/api/health'),

  getErrorLogs: (limit = 50) =>
    requestJson<{ errors: ErrorLogEntry[] }>(`/api/monitoring/errors?limit=${limit}`),

  clearErrorLogs: () => requestJson<void>('/api/monitoring/errors', { method: 'DELETE' }),

  getActivityLogs: (limit = 150) =>
    requestJson<{ activities: ActivityLogEntry[] }>(`/api/monitoring/activity?limit=${limit}`),

  clearActivityLogs: () => requestJson<void>('/api/monitoring/activity', { method: 'DELETE' }),

  getSecurityAlerts: (limit = 80) =>
    requestJson<{
      alerts: SecurityAlertEntry[];
      unreadCount: number;
      storage: DatabaseStorageStatus;
    }>(`/api/security/alerts?limit=${limit}`),

  markSecurityAlertRead: (id: string) =>
    requestJson<SecurityAlertEntry>(`/api/security/alerts/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    }),

  markAllSecurityAlertsRead: () =>
    requestJson<{ updatedCount: number }>('/api/security/alerts/read-all', {
      method: 'POST',
    }),

  clearReadSecurityAlerts: () =>
    requestJson<void>('/api/security/alerts', { method: 'DELETE' }),

  getStorageStatus: () => requestJson<DatabaseStorageStatus>('/api/monitoring/storage'),

  checkpointDatabase: () =>
    requestJson<DatabaseStorageStatus>('/api/monitoring/checkpoint', { method: 'POST' }),

  downloadDatabaseBackup: async () => {
    const token = getStoredToken();
    const res = await fetch('/api/monitoring/backup', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Gagal mengunduh cadangan (${res.status}).`);
    }
    return res.blob();
  },

  listSnapshots: () =>
    requestJson<{ snapshots: DatabaseSnapshotSummary[]; storage: DatabaseStorageStatus }>(
      '/api/monitoring/backups'
    ),

  createSnapshot: () =>
    requestJson<{
      fileName: string;
      snapshots: DatabaseSnapshotSummary[];
      storage: DatabaseStorageStatus;
    }>('/api/monitoring/backups', { method: 'POST' }),

  restoreBackup: (payload: {
    mode: 'merge' | 'replace';
    snapshotFileName?: string;
    backupPayload?: unknown;
  }) =>
    requestJson<{
      result: BackupRestoreResult;
      snapshots: DatabaseSnapshotSummary[];
      storage: DatabaseStorageStatus;
    }>('/api/monitoring/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reportClientError: (message: string, route = '/app', stack = '') =>
    requestJson<{ logged: boolean; id: string }>('/api/monitoring/client-error', {
      method: 'POST',
      body: JSON.stringify({ message, route, stack }),
    }),

  listUsers: () => requestJson<{ users: AuthUser[] }>('/api/users'),

  createUser: (payload: {
    username: string;
    password: string;
    displayName: string;
    jabatan: string;
    role: StaffRole;
  }) =>
    requestJson<AuthUser>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateUserStatus: (id: string, isActive: boolean) =>
    requestJson<AuthUser>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  updateUserPassword: (id: string, newPassword: string) =>
    requestJson<void>(`/api/users/${encodeURIComponent(id)}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    }),

  deleteUser: (id: string) =>
    requestJson<void>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  changeMyPassword: (currentPassword: string, newPassword: string) =>
    requestJson<void>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  uploadAttachment: (payload: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
  }) =>
    requestJson<{ attachmentUrl: string; attachmentName: string; sizeBytes: number }>(
      '/api/uploads',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createIncoming: (payload: {
    letterNumber: string;
    letterDate: string;
    receivedDate: string;
    sender: string;
    subject: string;
    classificationCode: string;
    urgency: LetterUrgency;
    status?: IncomingStatus;
    attachmentUrl?: string;
    attachmentName?: string;
    notes?: string;
    createdBy: string;
  }) =>
    requestJson<IncomingLetter>('/api/incoming', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateIncoming: (
    id: string,
    payload: Partial<{
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
      expectedUpdatedAt: string;
    }>
  ) =>
    requestJson<IncomingLetter>(`/api/incoming/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteIncoming: (id: string) =>
    requestJson<void>(`/api/incoming/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  addDisposition: (
    incomingId: string,
    payload: {
      targetUnit: string;
      targetStaffName?: string;
      instruction: string;
      deadlineDate?: string;
      createdBy: string;
    }
  ) =>
    requestJson<IncomingLetter>(
      `/api/incoming/${encodeURIComponent(incomingId)}/dispositions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateDisposition: (
    incomingId: string,
    dispId: string,
    payload: {
      status?: DispositionStatus;
      completionNote?: string;
    }
  ) =>
    requestJson<IncomingLetter>(
      `/api/incoming/${encodeURIComponent(incomingId)}/dispositions/${encodeURIComponent(dispId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  createOutgoing: (payload: {
    classificationCode: string;
    letterDate: string;
    recipient: string;
    subject: string;
    drafterName: string;
    status?: OutgoingStatus;
    isManualNumber?: boolean;
    fullLetterNumber?: string;
    attachmentUrl?: string;
    attachmentName?: string;
    bodyText?: string;
    notes?: string;
    createdBy: string;
  }) =>
    requestJson<OutgoingLetter>('/api/outgoing', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateOutgoing: (
    id: string,
    payload: Partial<{
      fullLetterNumber: string;
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
      expectedUpdatedAt: string;
    }>
  ) =>
    requestJson<OutgoingLetter>(`/api/outgoing/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteOutgoing: (id: string) =>
    requestJson<void>(`/api/outgoing/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  upsertClassification: (payload: ClassificationCode) =>
    requestJson<ClassificationCode>('/api/classifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importClassifications: (
    items: Array<{ code: string; name: string; description?: string }>,
    mode: 'merge' | 'replace' = 'merge'
  ) =>
    requestJson<ClassificationImportResult>('/api/classifications/import', {
      method: 'POST',
      body: JSON.stringify({ items, mode }),
    }),

  importClassificationsXlsx: (payload: {
    fileName: string;
    dataBase64: string;
    mode?: 'merge' | 'replace';
    dryRun?: boolean;
  }) =>
    requestJson<ClassificationImportResult | ClassificationXlsxDryRunResult>(
      '/api/classifications/import-xlsx',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteClassification: (code: string) =>
    requestJson<void>(`/api/classifications/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),

  listDispositionRecipients: (activeOnly = false) =>
    requestJson<{ items: DispositionRecipient[] }>(
      `/api/disposition-recipients${activeOnly ? '?activeOnly=1' : ''}`
    ),

  createDispositionRecipient: (payload: {
    name: string;
    nip?: string;
    category: StaffCategory;
    unit?: string;
    isActive?: boolean;
  }) =>
    requestJson<DispositionRecipient>('/api/disposition-recipients', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importDispositionRecipients: (
    items: Array<{ name: string; category: StaffCategory; nip: string; unit: string; isActive: boolean }>,
    mode: 'merge' | 'replace' = 'merge'
  ) =>
    requestJson<{
      mode: 'merge' | 'replace';
      totalProcessed: number;
      inserted: number;
      updated: number;
      totalRecipients: number;
      items: DispositionRecipient[];
    }>('/api/disposition-recipients/import', {
      method: 'POST',
      body: JSON.stringify({ items, mode }),
    }),

  importDispositionRecipientsXlsx: (payload: {
    fileName: string;
    dataBase64: string;
    mode?: 'merge' | 'replace';
    dryRun?: boolean;
  }) =>
    requestJson<{
      mode: 'merge' | 'replace';
      totalProcessed: number;
      inserted: number;
      updated: number;
      totalRecipients: number;
      items: DispositionRecipient[];
      validation?: import('./recipientParser.ts').RecipientValidationSummary;
      valid?: boolean;
      validationSummary?: import('./recipientParser.ts').RecipientValidationSummary;
    } | {
      valid: boolean;
      items: Array<{ name: string; category: StaffCategory; nip: string; unit: string; isActive: boolean }>;
      validation: import('./recipientParser.ts').RecipientValidationSummary;
    }>('/api/disposition-recipients/import-xlsx', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDispositionRecipient: (
    id: string,
    payload: Partial<{
      name: string;
      nip: string;
      category: StaffCategory;
      unit: string;
      isActive: boolean;
    }>
  ) =>
    requestJson<DispositionRecipient>(`/api/disposition-recipients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteDispositionRecipient: (id: string) =>
    requestJson<void>(`/api/disposition-recipients/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  updateSettings: (payload: Partial<SchoolSettings>) =>
    requestJson<SchoolSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  updateCounter: (year: number, incomingLastSeq: number, outgoingLastSeq: number) =>
    requestJson<YearCounter>(`/api/counters/${year}`, {
      method: 'PUT',
      body: JSON.stringify({ incomingLastSeq, outgoingLastSeq }),
    }),

  initCounter: (year: number) =>
    requestJson<{ counter: YearCounter; alreadyInitialized: boolean }>(
      `/api/counters/${year}/init`,
      { method: 'POST' }
    ),

  listRegulations: () => requestJson<{ items: LetterRegulation[] }>('/api/regulations'),

  createRegulation: (payload: {
    title: string;
    regulationNumber: string;
    year: number;
    category: RegulationCategory;
    issuingBody?: string;
    summary?: string;
    fileUrl: string;
    fileName: string;
    fileSizeBytes: number;
  }) =>
    requestJson<LetterRegulation>('/api/regulations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateRegulation: (
    id: string,
    payload: Partial<{
      title: string;
      regulationNumber: string;
      year: number;
      category: RegulationCategory;
      issuingBody: string;
      summary: string;
      fileUrl: string;
      fileName: string;
      fileSizeBytes: number;
      expectedUpdatedAt: string;
    }>
  ) =>
    requestJson<LetterRegulation>(`/api/regulations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteRegulation: (id: string) =>
    requestJson<void>(`/api/regulations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getDraft: (draftKey: string) =>
    requestJson<{ draft: LetterDraftRecord | null }>(`/api/drafts/${encodeURIComponent(draftKey)}`),

  saveDraft: (draftKey: string, payload: Record<string, unknown>) =>
    requestJson<{ draft: LetterDraftRecord }>(`/api/drafts/${encodeURIComponent(draftKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ payload }),
    }),

  deleteDraft: (draftKey: string) =>
    requestJson<void>(`/api/drafts/${encodeURIComponent(draftKey)}`, {
      method: 'DELETE',
    }),

  analyzeIncomingWithAi: (payload: { rawText?: string; attachmentUrl?: string }) =>
    requestJson<AiIncomingAnalysisResult>('/api/ai/analyze-incoming', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  draftOutgoingWithAi: (payload: {
    recipient: string;
    subject: string;
    classificationCode: string;
    letterDate: string;
    drafterName: string;
    existingBody?: string;
    notes?: string;
    tone: AiDraftTone;
  }) =>
    requestJson<AiOutgoingDraftResult>('/api/ai/draft-outgoing', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  summarizeLetterWithAi: (kind: 'incoming' | 'outgoing', letterId: string) =>
    requestJson<AiLetterInsightResult>('/api/ai/summarize-letter', {
      method: 'POST',
      body: JSON.stringify({ kind, letterId }),
    }),

  queryArchiveWithAi: (question: string) =>
    requestJson<AiArchiveQueryResult>('/api/ai/archive-assistant', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  getBloggerExportPreview: (origin?: string) => {
    const query = origin ? `?origin=${encodeURIComponent(origin)}` : '';
    return requestJson<BloggerExportPackage>(`/api/export/blogger/preview${query}`);
  },

  downloadBloggerSourceZip: async (origin?: string) => {
    const token = getStoredToken();
    const query = origin ? `?origin=${encodeURIComponent(origin)}` : '';
    const res = await fetch(`/api/export/blogger/source-zip${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Gagal mengunduh arsip kode sumber (${res.status}).`);
    }
    return res.blob();
  },

  getSpreadsheetExportData: () =>
    requestJson<SpreadsheetExportDataset>('/api/export/spreadsheet-data'),
};
