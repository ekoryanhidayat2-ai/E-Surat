import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileDown,
  FilePenLine,
  FileSpreadsheet,
  History,
  ImagePlus,
  KeyRound,
  Lock,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_LOGIN_PORTAL_COPY,
  DEFAULT_MENU_CONFIGS,
  normalizeMenuConfigs,
  STAFF_CATEGORY_OPTIONS,
  STAFF_UNITS,
  type ActivityAction,
  type ActivityLogEntry,
  type AppMenuConfigs,
  type AppMenuKey,
  type AuthUser,
  type ClassificationCode,
  type DatabaseSnapshotSummary,
  type DatabaseStorageStatus,
  type DispositionRecipient,
  type ErrorLogEntry,
  type HealthStatus,
  type SchoolSettings,
  type SecurityAlertCategory,
  type SecurityAlertEntry,
  type SecurityAlertSeverity,
  type StaffCategory,
  type StaffRole,
  type YearCounter,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { formatOutgoingPreview } from '../lib/format.ts';
import {
  APP_THEMES,
  DEFAULT_THEME_ID,
  getThemeById,
  type ThemeCategory,
  type ThemeId,
} from '../lib/themes.ts';
import { evaluateFiscalYearReadiness } from '../lib/yearUtils.ts';
import {
  downloadClassificationExcelTemplate,
  exportClassificationsToExcel,
  readClassificationImportFile,
  readFileAsBase64,
} from '../lib/classificationExcel.ts';
import {
  CLASSIFICATION_SCHEMA_SPEC,
  type ParsedClassificationImport,
} from '../lib/classificationParser.ts';
import {
  downloadRecipientExcelTemplate,
  exportRecipientsToExcel,
  readRecipientImportFile,
} from '../lib/recipientExcel.ts';
import {
  RECIPIENT_SCHEMA_SPEC,
  type ParsedRecipientImport,
} from '../lib/recipientParser.ts';
import { SchoolCrest } from './SchoolCrest.tsx';
import { BloggerExportView } from './BloggerExportView.tsx';
import { SpreadsheetExportView } from './SpreadsheetExportView.tsx';

export type SettingsTab =
  | 'profil'
  | 'tema'
  | 'klasifikasi'
  | 'penerima'
  | 'menu'
  | 'pengguna'
  | 'aktivitas'
  | 'keamanan'
  | 'spreadsheet'
  | 'blogger'
  | 'monitoring';

interface SettingsViewProps {
  currentUser: AuthUser;
  settings: SchoolSettings;
  classifications: ClassificationCode[];
  dispositionRecipients?: DispositionRecipient[];
  counters: YearCounter[];
  activeThemeId: ThemeId;
  unreadSecurityAlerts?: number;
  requestedTab?: { tab: SettingsTab; nonce: number } | null;
  onSecurityAlertsUpdated?: () => void;
  onDataRestored?: () => Promise<void> | void;
  onSelectTheme: (themeId: ThemeId) => void;
  onSaveSettings: (updated: Partial<SchoolSettings>) => Promise<void>;
  onQuietSyncSettings?: (updated: Partial<SchoolSettings>) => Promise<void>;
  onUpsertClassification: (item: ClassificationCode) => Promise<void>;
  onDeleteClassification: (code: string) => Promise<void>;
  onCreateRecipient?: (payload: {
    name: string;
    nip?: string;
    category: StaffCategory;
    unit?: string;
  }) => Promise<DispositionRecipient>;
  onUpdateRecipient?: (
    id: string,
    payload: Partial<{
      name: string;
      nip: string;
      category: StaffCategory;
      unit: string;
      isActive: boolean;
    }>
  ) => Promise<void>;
  onDeleteRecipient?: (id: string) => Promise<void>;
  activeYear?: number;
  availableYears?: number[];
  onUpdateCounter: (year: number, incomingLastSeq: number, outgoingLastSeq: number) => Promise<void>;
  onInitCounter?: (year: number, switchToYear?: boolean) => Promise<void>;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export function SettingsView({
  currentUser,
  settings,
  classifications,
  dispositionRecipients = [],
  counters,
  activeThemeId,
  unreadSecurityAlerts = 0,
  requestedTab = null,
  onSecurityAlertsUpdated,
  onDataRestored,
  onSelectTheme,
  onSaveSettings,
  onQuietSyncSettings,
  onUpsertClassification,
  onDeleteClassification,
  onCreateRecipient,
  onUpdateRecipient,
  onDeleteRecipient,
  activeYear,
  availableYears = [],
  onUpdateCounter,
  onInitCounter,
  onNotify,
}: SettingsViewProps) {
  const [subTab, setSubTab] = useState<SettingsTab>(requestedTab?.tab ?? 'profil');
  const [form, setForm] = useState<SchoolSettings>(settings);
  const [menuForm, setMenuForm] = useState<AppMenuConfigs>(() =>
    normalizeMenuConfigs(settings.menuConfigs)
  );
  const [loginPortalForm, setLoginPortalForm] = useState({
    loginHeadline: settings.loginHeadline ?? DEFAULT_LOGIN_PORTAL_COPY.loginHeadline,
    loginDescription: settings.loginDescription ?? DEFAULT_LOGIN_PORTAL_COPY.loginDescription,
    loginFormTitle: settings.loginFormTitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormTitle,
    loginFormSubtitle: settings.loginFormSubtitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormSubtitle,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingMenuConfigs, setSavingMenuConfigs] = useState(false);
  const [profilAutoSaveState, setProfilAutoSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [menuAutoSaveState, setMenuAutoSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploadingLogoTarget, setUploadingLogoTarget] = useState<
    'logoUrl' | 'kopImageUrl' | null
  >(null);

  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [savingClass, setSavingClass] = useState(false);
  const [downloadingClassTemplate, setDownloadingClassTemplate] = useState(false);
  const [exportingClassExcel, setExportingClassExcel] = useState(false);
  const [parsedClassImport, setParsedClassImport] = useState<ParsedClassificationImport | null>(
    null
  );
  const [importClassFileName, setImportClassFileName] = useState('');
  const [importClassBase64, setImportClassBase64] = useState('');
  const [importClassIsXlsx, setImportClassIsXlsx] = useState(false);
  const [serverSchemaVerified, setServerSchemaVerified] = useState(false);
  const [validatingClassFile, setValidatingClassFile] = useState(false);
  const [isDraggingClassFile, setIsDraggingClassFile] = useState(false);
  const [importClassMode, setImportClassMode] = useState<'merge' | 'replace'>('merge');
  const [importingClassifications, setImportingClassifications] = useState(false);

  const [downloadingRecipientTemplate, setDownloadingRecipientTemplate] = useState(false);
  const [exportingRecipientExcel, setExportingRecipientExcel] = useState(false);
  const [parsedRecipientImport, setParsedRecipientImport] = useState<ParsedRecipientImport | null>(null);
  const [importRecipientFileName, setImportRecipientFileName] = useState('');
  const [importRecipientBase64, setImportRecipientBase64] = useState('');
  const [importRecipientIsXlsx, setImportRecipientIsXlsx] = useState(false);
  const [serverRecipientSchemaVerified, setServerRecipientSchemaVerified] = useState(false);
  const [validatingRecipientFile, setValidatingRecipientFile] = useState(false);
  const [isDraggingRecipientFile, setIsDraggingRecipientFile] = useState(false);
  const [importRecipientMode, setImportRecipientMode] = useState<'merge' | 'replace'>('merge');
  const [importingRecipients, setImportingRecipients] = useState(false);

  // Direktori Guru & Karyawan penerima disposisi state
  const [recName, setRecName] = useState('');
  const [recCategory, setRecCategory] = useState<StaffCategory>('Guru');
  const [recNip, setRecNip] = useState('');
  const [recUnit, setRecUnit] = useState('');
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [recSearch, setRecSearch] = useState('');
  const [recCategoryFilter, setRecCategoryFilter] = useState<'Semua' | StaffCategory>('Semua');
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [editRecName, setEditRecName] = useState('');
  const [editRecCategory, setEditRecCategory] = useState<StaffCategory>('Guru');
  const [editRecNip, setEditRecNip] = useState('');
  const [editRecUnit, setEditRecUnit] = useState('');
  const [confirmDeleteRecId, setConfirmDeleteRecId] = useState<string | null>(null);
  const [busyRecId, setBusyRecId] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [selectedCounterYear, setSelectedCounterYear] = useState<number>(() =>
    activeYear && activeYear >= 2000 && activeYear <= 2100 ? activeYear : currentYear
  );
  const [customCounterYearInput, setCustomCounterYearInput] = useState('');
  const activeCounter = counters.find((c) => c.year === selectedCounterYear) ?? {
    year: selectedCounterYear,
    incomingLastSeq: 0,
    outgoingLastSeq: 0,
  };
  const [inCounter, setInCounter] = useState(activeCounter.incomingLastSeq);
  const [outCounter, setOutCounter] = useState(activeCounter.outgoingLastSeq);
  const [savingCounter, setSavingCounter] = useState(false);
  const [initializingFiscalYear, setInitializingFiscalYear] = useState(false);
  const [savingAutoInit, setSavingAutoInit] = useState(false);
  const fiscalReadiness = evaluateFiscalYearReadiness(counters);

  // User Management state (Admin) & Self-service password state
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newJabatan, setNewJabatan] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('staf');
  const [creatingUser, setCreatingUser] = useState(false);

  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newOwnPassword, setNewOwnPassword] = useState('');
  const [confirmOwnPassword, setConfirmOwnPassword] = useState('');
  const [savingOwnPassword, setSavingOwnPassword] = useState(false);

  const [editingPasswordUserId, setEditingPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [savingUserPassword, setSavingUserPassword] = useState(false);

  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // Monitoring & Error Log state
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [expandedStackId, setExpandedStackId] = useState<string | null>(null);

  // Activity Log state
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activitySearch, setActivitySearch] = useState('');
  const [activityActionFilter, setActivityActionFilter] = useState<'ALL' | ActivityAction>('ALL');
  const [activityEntityFilter, setActivityEntityFilter] = useState<'ALL' | 'incoming' | 'outgoing'>('ALL');

  // Security & Storage state (Admin Only)
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlertEntry[]>([]);
  const [securityUnreadCount, setSecurityUnreadCount] = useState(0);
  const [storageStatus, setStorageStatus] = useState<DatabaseStorageStatus | null>(null);
  const [snapshots, setSnapshots] = useState<DatabaseSnapshotSummary[]>([]);
  const [loadingSecurity, setLoadingSecurity] = useState(false);
  const [runningCheckpoint, setRunningCheckpoint] = useState(false);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [confirmRestoreSnapshot, setConfirmRestoreSnapshot] = useState<string | null>(null);
  const [securityFilter, setSecurityFilter] = useState<'all' | 'unread'>('all');
  const [themeModeFilter, setThemeModeFilter] = useState<'all' | 'light' | 'dark'>('all');
  const [themeCategoryFilter, setThemeCategoryFilter] = useState<'all' | ThemeCategory>('all');

  const serializeProfilSettings = useCallback((s: SchoolSettings) =>
    JSON.stringify({
      schoolName: s.schoolName,
      parentAgency: s.parentAgency,
      districtGov: s.districtGov,
      address: s.address,
      postalCode: s.postalCode,
      phone: s.phone,
      email: s.email,
      website: s.website,
      npsn: s.npsn,
      schoolCode: s.schoolCode,
      principalName: s.principalName,
      principalNip: s.principalNip,
      tuHeadName: s.tuHeadName,
      tuHeadNip: s.tuHeadNip,
      outgoingFormatPattern: s.outgoingFormatPattern,
      logoUrl: s.logoUrl,
      kopImageUrl: s.kopImageUrl,
      autoInitNewYearCounter: s.autoInitNewYearCounter ?? true,
    }), []);

  const serializeMenuAndPortal = useCallback(
    (
      mc: AppMenuConfigs,
      lp: {
        loginHeadline: string;
        loginDescription: string;
        loginFormTitle: string;
        loginFormSubtitle: string;
      }
    ) => JSON.stringify({ menuConfigs: mc, ...lp }),
    []
  );

  const lastSyncedProfilSigRef = useRef<string>(serializeProfilSettings(settings));
  const lastSyncedMenuSigRef = useRef<string>(
    serializeMenuAndPortal(normalizeMenuConfigs(settings.menuConfigs), {
      loginHeadline: settings.loginHeadline ?? DEFAULT_LOGIN_PORTAL_COPY.loginHeadline,
      loginDescription: settings.loginDescription ?? DEFAULT_LOGIN_PORTAL_COPY.loginDescription,
      loginFormTitle: settings.loginFormTitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormTitle,
      loginFormSubtitle: settings.loginFormSubtitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormSubtitle,
    })
  );

  useEffect(() => {
    const incomingProfilSig = serializeProfilSettings(settings);
    if (incomingProfilSig !== lastSyncedProfilSigRef.current) {
      lastSyncedProfilSigRef.current = incomingProfilSig;
      setForm(settings);
    }
    const incomingMenu = normalizeMenuConfigs(settings.menuConfigs);
    const incomingLogin = {
      loginHeadline: settings.loginHeadline ?? DEFAULT_LOGIN_PORTAL_COPY.loginHeadline,
      loginDescription: settings.loginDescription ?? DEFAULT_LOGIN_PORTAL_COPY.loginDescription,
      loginFormTitle: settings.loginFormTitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormTitle,
      loginFormSubtitle: settings.loginFormSubtitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormSubtitle,
    };
    const incomingMenuSig = serializeMenuAndPortal(incomingMenu, incomingLogin);
    if (incomingMenuSig !== lastSyncedMenuSigRef.current) {
      lastSyncedMenuSigRef.current = incomingMenuSig;
      setMenuForm(incomingMenu);
      setLoginPortalForm(incomingLogin);
    }
  }, [settings, serializeProfilSettings, serializeMenuAndPortal]);

  useEffect(() => {
    if (requestedTab) {
      setSubTab(requestedTab.tab);
    }
  }, [requestedTab]);

  useEffect(() => {
    const matched = counters.find((c) => c.year === selectedCounterYear);
    setInCounter(matched?.incomingLastSeq ?? 0);
    setOutCounter(matched?.outgoingLastSeq ?? 0);
  }, [selectedCounterYear, counters]);

  const loadMonitoring = useCallback(async () => {
    setLoadingMonitoring(true);
    try {
      const [h, l] = await Promise.all([api.getHealth(), api.getErrorLogs(80)]);
      setHealth(h);
      setLogs(l.errors);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memuat status monitoring.',
        'error'
      );
    } finally {
      setLoadingMonitoring(false);
    }
  }, [onNotify]);

  const loadActivities = useCallback(async () => {
    setLoadingActivities(true);
    try {
      const res = await api.getActivityLogs(150);
      setActivities(res.activities);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memuat log aktivitas pengguna.',
        'error'
      );
    } finally {
      setLoadingActivities(false);
    }
  }, [onNotify]);

  const loadSecurityData = useCallback(async () => {
    setLoadingSecurity(true);
    try {
      const [res, backupRes] = await Promise.all([
        api.getSecurityAlerts(80),
        api.listSnapshots(),
      ]);
      setSecurityAlerts(res.alerts);
      setSecurityUnreadCount(res.unreadCount);
      setStorageStatus(backupRes.storage ?? res.storage);
      setSnapshots(backupRes.snapshots);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memuat notifikasi keamanan & status data.',
        'error'
      );
    } finally {
      setLoadingSecurity(false);
    }
  }, [onNotify]);

  const loadUsers = useCallback(async () => {
    if (currentUser.role !== 'admin') return;
    setLoadingUsers(true);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memuat daftar akun pengguna.',
        'error'
      );
    } finally {
      setLoadingUsers(false);
    }
  }, [currentUser.role, onNotify]);

  const isAdmin = currentUser.role === 'admin';


  useEffect(() => {
    if (
      !isAdmin &&
      (subTab === 'tema' ||
        subTab === 'klasifikasi' ||
        subTab === 'penerima' ||
        subTab === 'menu' ||
        subTab === 'aktivitas' ||
        subTab === 'keamanan' ||
        subTab === 'spreadsheet' ||
        subTab === 'blogger' ||
        subTab === 'monitoring')
    ) {
      setSubTab('profil');
    }
  }, [isAdmin, subTab]);

  useEffect(() => {
    if (!isAdmin) return;
    if (subTab === 'monitoring') {
      void loadMonitoring();
    } else if (subTab === 'aktivitas') {
      void loadActivities();
    } else if (subTab === 'pengguna') {
      void loadUsers();
    } else if (subTab === 'keamanan') {
      void loadSecurityData();
    }
  }, [subTab, isAdmin, loadMonitoring, loadActivities, loadUsers, loadSecurityData]);

  useEffect(() => {
    if (currentUser.role !== 'admin' || !onQuietSyncSettings) return;
    const currentSig = serializeProfilSettings(form);
    if (currentSig === lastSyncedProfilSigRef.current) return;
    const isValid = Boolean(
      form.schoolName.trim() &&
        form.parentAgency.trim() &&
        form.districtGov.trim() &&
        form.address.trim() &&
        form.schoolCode.trim() &&
        form.principalName.trim() &&
        form.tuHeadName.trim() &&
        form.outgoingFormatPattern.trim()
    );
    if (!isValid) return;

    setProfilAutoSaveState('saving');
    const timer = window.setTimeout(() => {
      const payload: Partial<SchoolSettings> = {
        schoolName: form.schoolName,
        parentAgency: form.parentAgency,
        districtGov: form.districtGov,
        address: form.address,
        postalCode: form.postalCode,
        phone: form.phone,
        email: form.email,
        website: form.website,
        npsn: form.npsn,
        schoolCode: form.schoolCode,
        principalName: form.principalName,
        principalNip: form.principalNip,
        tuHeadName: form.tuHeadName,
        tuHeadNip: form.tuHeadNip,
        outgoingFormatPattern: form.outgoingFormatPattern,
        logoUrl: form.logoUrl,
        kopImageUrl: form.kopImageUrl,
        autoInitNewYearCounter: form.autoInitNewYearCounter ?? true,
      };
      lastSyncedProfilSigRef.current = currentSig;
      void onQuietSyncSettings(payload)
        .then(() => {
          setProfilAutoSaveState('saved');
        })
        .catch(() => {
          setProfilAutoSaveState('idle');
        });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [currentUser.role, form, onQuietSyncSettings, serializeProfilSettings]);

  useEffect(() => {
    if (currentUser.role !== 'admin' || !onQuietSyncSettings) return;
    const currentSig = serializeMenuAndPortal(menuForm, loginPortalForm);
    if (currentSig === lastSyncedMenuSigRef.current) return;
    const menuValid = Object.values(menuForm).every(
      (item) => item && item.label.trim() && item.title.trim()
    );
    const loginValid = Boolean(
      loginPortalForm.loginHeadline.trim() && loginPortalForm.loginFormTitle.trim()
    );
    if (!menuValid || !loginValid) return;

    setMenuAutoSaveState('saving');
    const timer = window.setTimeout(() => {
      lastSyncedMenuSigRef.current = currentSig;
      void onQuietSyncSettings({
        menuConfigs: menuForm,
        loginHeadline: loginPortalForm.loginHeadline,
        loginDescription: loginPortalForm.loginDescription,
        loginFormTitle: loginPortalForm.loginFormTitle,
        loginFormSubtitle: loginPortalForm.loginFormSubtitle,
      })
        .then(() => {
          setMenuAutoSaveState('saved');
        })
        .catch(() => {
          setMenuAutoSaveState('idle');
        });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [currentUser.role, menuForm, loginPortalForm, onQuietSyncSettings, serializeMenuAndPortal]);

  const handleSubmitSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSettings(true);
    try {
      const profilePayload: Partial<SchoolSettings> = {
        schoolName: form.schoolName,
        parentAgency: form.parentAgency,
        districtGov: form.districtGov,
        address: form.address,
        postalCode: form.postalCode,
        phone: form.phone,
        email: form.email,
        website: form.website,
        npsn: form.npsn,
        schoolCode: form.schoolCode,
        principalName: form.principalName,
        principalNip: form.principalNip,
        tuHeadName: form.tuHeadName,
        tuHeadNip: form.tuHeadNip,
        outgoingFormatPattern: form.outgoingFormatPattern,
        logoUrl: form.logoUrl,
        kopImageUrl: form.kopImageUrl,
        autoInitNewYearCounter: form.autoInitNewYearCounter ?? true,
      };
      lastSyncedProfilSigRef.current = serializeProfilSettings(form);
      await onSaveSettings(profilePayload);
      setProfilAutoSaveState('saved');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveMenuConfigs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingMenuConfigs(true);
    try {
      lastSyncedMenuSigRef.current = serializeMenuAndPortal(menuForm, loginPortalForm);
      await onSaveSettings({
        menuConfigs: menuForm,
        loginHeadline: loginPortalForm.loginHeadline,
        loginDescription: loginPortalForm.loginDescription,
        loginFormTitle: loginPortalForm.loginFormTitle,
        loginFormSubtitle: loginPortalForm.loginFormSubtitle,
      });
      setMenuAutoSaveState('saved');
    } finally {
      setSavingMenuConfigs(false);
    }
  };

  const handleResetMenuConfigs = async () => {
    if (!isAdmin) return;
    const resetCopy: AppMenuConfigs = {
      dashboard: { ...DEFAULT_MENU_CONFIGS.dashboard },
      incoming: { ...DEFAULT_MENU_CONFIGS.incoming },
      outgoing: { ...DEFAULT_MENU_CONFIGS.outgoing },
      dispositions: { ...DEFAULT_MENU_CONFIGS.dispositions },
      regulations: { ...DEFAULT_MENU_CONFIGS.regulations },
      guide: { ...DEFAULT_MENU_CONFIGS.guide },
      settings: { ...DEFAULT_MENU_CONFIGS.settings },
    };
    const resetLogin = { ...DEFAULT_LOGIN_PORTAL_COPY };
    lastSyncedMenuSigRef.current = serializeMenuAndPortal(resetCopy, resetLogin);
    setMenuForm(resetCopy);
    setLoginPortalForm(resetLogin);
    setSavingMenuConfigs(true);
    try {
      await onSaveSettings({
        menuConfigs: resetCopy,
        ...resetLogin,
      });
      setMenuAutoSaveState('saved');
    } finally {
      setSavingMenuConfigs(false);
    }
  };

  const handleLogoUpload = async (
    targetField: 'logoUrl' | 'kopImageUrl',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const inferredMime =
      file.type ||
      (ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'svg'
            ? 'image/svg+xml'
            : ext === 'jpg' || ext === 'jpeg'
              ? 'image/jpeg'
              : '');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(inferredMime)) {
      onNotify('Format gambar harus PNG, JPG, WEBP, atau SVG.', 'error');
      e.target.value = '';
      return;
    }
    const maxBytes = targetField === 'kopImageUrl' ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      onNotify(
        targetField === 'kopImageUrl'
          ? 'Ukuran gambar kop sekolah maksimal 4 MB.'
          : 'Ukuran gambar maksimal 2 MB.',
        'error'
      );
      e.target.value = '';
      return;
    }

    setUploadingLogoTarget(targetField);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
        reader.readAsDataURL(file);
      });
      const uploaded = await api.uploadAttachment({
        fileName: file.name,
        mimeType: inferredMime,
        dataBase64,
      });
      const nextForm = { ...form, [targetField]: uploaded.attachmentUrl };
      lastSyncedProfilSigRef.current = serializeProfilSettings(nextForm);
      setForm(nextForm);
      await onSaveSettings({ [targetField]: uploaded.attachmentUrl });
      setProfilAutoSaveState('saved');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal mengunggah gambar.', 'error');
    } finally {
      setUploadingLogoTarget(null);
      e.target.value = '';
    }
  };

  const handleResetLogo = async (targetField: 'logoUrl' | 'kopImageUrl') => {
    if (!isAdmin) return;
    const nextForm = { ...form, [targetField]: '' };
    lastSyncedProfilSigRef.current = serializeProfilSettings(nextForm);
    setForm(nextForm);
    await onSaveSettings({ [targetField]: '' });
    setProfilAutoSaveState('saved');
  };

  const handleAddClassification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSavingClass(true);
    try {
      await onUpsertClassification({
        code: newCode.trim(),
        name: newName.trim(),
        description: newDesc.trim(),
      });
      setNewCode('');
      setNewName('');
      setNewDesc('');
    } finally {
      setSavingClass(false);
    }
  };

  const handleDownloadClassTemplate = async () => {
    setDownloadingClassTemplate(true);
    try {
      await downloadClassificationExcelTemplate(form.schoolName);
      onNotify('Template Excel kode klasifikasi berhasil diunduh.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal membuat template Excel klasifikasi.',
        'error'
      );
    } finally {
      setDownloadingClassTemplate(false);
    }
  };

  const handleExportClassExcel = async () => {
    if (classifications.length === 0) {
      onNotify('Belum ada kode klasifikasi untuk diekspor.', 'error');
      return;
    }
    setExportingClassExcel(true);
    try {
      await exportClassificationsToExcel(classifications, form.schoolName);
      onNotify(`${classifications.length} kode klasifikasi berhasil diekspor ke Excel.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengekspor kode klasifikasi ke Excel.',
        'error'
      );
    } finally {
      setExportingClassExcel(false);
    }
  };

  const processSelectedClassFile = async (file: File) => {
    if (!isAdmin) return;
    setValidatingClassFile(true);
    setServerSchemaVerified(false);
    setImportClassBase64('');
    setImportClassIsXlsx(false);

    try {
      const parsed = await readClassificationImportFile(file);
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
      const isBloggerMode = Boolean(
        (window as unknown as { __ESURAT_BLOGGER_MODE__?: boolean }).__ESURAT_BLOGGER_MODE__
      );

      let finalParsed = parsed;
      let base64Payload = '';
      let verifiedOnServer = false;

      if (isXlsx && !isBloggerMode) {
        base64Payload = await readFileAsBase64(file);
        const dryRunRes = await api.importClassificationsXlsx({
          fileName: file.name,
          dataBase64: base64Payload,
          dryRun: true,
        });
        if ('validation' in dryRunRes && dryRunRes.validation) {
          verifiedOnServer = true;
          const v = dryRunRes.validation;
          finalParsed = {
            items: 'items' in dryRunRes ? dryRunRes.items : parsed.items,
            warnings: v.errors.map((errItem) => ({
              rowNumber: errItem.rowNumber,
              reason: errItem.message,
            })),
            errors: v.errors,
            schemaValid: v.schemaValid,
            validation: v,
            duplicateOverrides: v.duplicateOverrides,
            totalRowsScanned: v.totalRowsScanned,
          };
        }
      }

      setImportClassFileName(file.name);
      setImportClassBase64(base64Payload);
      setImportClassIsXlsx(isXlsx);
      setServerSchemaVerified(verifiedOnServer);
      setImportClassMode('merge');
      setParsedClassImport(finalParsed);

      if (!finalParsed.schemaValid || finalParsed.errors.length > 0) {
        onNotify(
          `Validasi skema menemukan ${finalParsed.errors.length} ketidaksesuaian pada berkas. Periksa detail sebelum menyimpan.`,
          'error'
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal membaca berkas Excel klasifikasi.',
        'error'
      );
    } finally {
      setValidatingClassFile(false);
    }
  };

  const handleClassFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await processSelectedClassFile(file);
  };

  const handleClassFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingClassFile(false);
    if (!isAdmin || validatingClassFile) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processSelectedClassFile(file);
  };

  const handleConfirmClassImport = async () => {
    if (
      !parsedClassImport ||
      !isAdmin ||
      !parsedClassImport.schemaValid ||
      parsedClassImport.errors.length > 0 ||
      parsedClassImport.items.length === 0
    ) {
      onNotify(
        'Data belum lolos validasi skema. Perbaiki kesalahan pada berkas sebelum disimpan ke database.',
        'error'
      );
      return;
    }

    setImportingClassifications(true);
    try {
      const isBloggerMode = Boolean(
        (window as unknown as { __ESURAT_BLOGGER_MODE__?: boolean }).__ESURAT_BLOGGER_MODE__
      );
      const result =
        importClassIsXlsx && importClassBase64 && !isBloggerMode
          ? ((await api.importClassificationsXlsx({
              fileName: importClassFileName,
              dataBase64: importClassBase64,
              mode: importClassMode,
              dryRun: false,
            })) as import('../types.ts').ClassificationImportResult)
          : await api.importClassifications(parsedClassImport.items, importClassMode);
      await onDataRestored?.();
      setParsedClassImport(null);
      setImportClassFileName('');
      setImportClassBase64('');
      setImportClassIsXlsx(false);
      setServerSchemaVerified(false);
      onNotify(
        `Impor klasifikasi tervalidasi selesai: ${result.inserted} kode baru, ${result.updated} diperbarui (total ${result.totalClassifications} kode).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengimpor kode klasifikasi.',
        'error'
      );
    } finally {
      setImportingClassifications(false);
    }
  };

  const handleDownloadRecipientTemplate = async () => {
    setDownloadingRecipientTemplate(true);
    try {
      await downloadRecipientExcelTemplate(form.schoolName);
      onNotify('Template Excel Guru & Karyawan berhasil diunduh.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal membuat template Excel Guru & Karyawan.',
        'error'
      );
    } finally {
      setDownloadingRecipientTemplate(false);
    }
  };

  const handleExportRecipientExcel = async () => {
    if (dispositionRecipients.length === 0) {
      onNotify('Belum ada data guru atau karyawan untuk diekspor.', 'error');
      return;
    }
    setExportingRecipientExcel(true);
    try {
      await exportRecipientsToExcel(dispositionRecipients, form.schoolName);
      onNotify(`${dispositionRecipients.length} data guru & karyawan berhasil diekspor ke Excel.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengekspor data guru & karyawan ke Excel.',
        'error'
      );
    } finally {
      setExportingRecipientExcel(false);
    }
  };

  const processSelectedRecipientFile = async (file: File) => {
    if (!isAdmin) return;
    setValidatingRecipientFile(true);
    setServerRecipientSchemaVerified(false);
    setImportRecipientBase64('');
    setImportRecipientIsXlsx(false);

    try {
      const parsed = await readRecipientImportFile(file);
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
      const isBloggerMode = Boolean(
        (window as unknown as { __ESURAT_BLOGGER_MODE__?: boolean }).__ESURAT_BLOGGER_MODE__
      );

      let finalParsed = parsed;
      let base64Payload = '';
      let verifiedOnServer = false;

      if (isXlsx && !isBloggerMode) {
        base64Payload = await readFileAsBase64(file);
        const dryRunRes = await api.importDispositionRecipientsXlsx({
          fileName: file.name,
          dataBase64: base64Payload,
          dryRun: true,
        });
        if ('validation' in dryRunRes && dryRunRes.validation) {
          verifiedOnServer = true;
          const v = dryRunRes.validation;
          finalParsed = {
            items: 'items' in dryRunRes ? dryRunRes.items : parsed.items,
            warnings: v.errors.map((errItem: any) => ({
              rowNumber: errItem.rowNumber,
              reason: errItem.message,
            })),
            errors: v.errors,
            schemaValid: v.schemaValid,
            validation: v,
            duplicateOverrides: v.duplicateOverrides,
            totalRowsScanned: v.totalRowsScanned,
          };
        }
      }

      setImportRecipientFileName(file.name);
      setImportRecipientBase64(base64Payload);
      setImportRecipientIsXlsx(isXlsx);
      setServerRecipientSchemaVerified(verifiedOnServer);
      setImportRecipientMode('merge');
      setParsedRecipientImport(finalParsed);

      if (!finalParsed.schemaValid || finalParsed.errors.length > 0) {
        onNotify(
          `Validasi skema menemukan ${finalParsed.errors.length} ketidaksesuaian pada berkas. Periksa detail sebelum menyimpan.`,
          'error'
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal membaca berkas Excel guru & karyawan.',
        'error'
      );
    } finally {
      setValidatingRecipientFile(false);
    }
  };

  const handleRecipientFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await processSelectedRecipientFile(file);
  };

  const handleRecipientFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRecipientFile(false);
    if (!isAdmin || validatingRecipientFile) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processSelectedRecipientFile(file);
  };

  const handleConfirmRecipientImport = async () => {
    if (
      !parsedRecipientImport ||
      !isAdmin ||
      !parsedRecipientImport.schemaValid ||
      parsedRecipientImport.errors.length > 0 ||
      parsedRecipientImport.items.length === 0
    ) {
      onNotify(
        'Data belum lolos validasi skema. Perbaiki kesalahan pada berkas sebelum disimpan ke database.',
        'error'
      );
      return;
    }

    setImportingRecipients(true);
    try {
      const isBloggerMode = Boolean(
        (window as unknown as { __ESURAT_BLOGGER_MODE__?: boolean }).__ESURAT_BLOGGER_MODE__
      );
      const result =
        importRecipientIsXlsx && importRecipientBase64 && !isBloggerMode
          ? await api.importDispositionRecipientsXlsx({
              fileName: importRecipientFileName,
              dataBase64: importRecipientBase64,
              mode: importRecipientMode,
              dryRun: false,
            })
          : await api.importDispositionRecipients(parsedRecipientImport.items, importRecipientMode);
      await onDataRestored?.();
      setParsedRecipientImport(null);
      setImportRecipientFileName('');
      setImportRecipientBase64('');
      setImportRecipientIsXlsx(false);
      setServerRecipientSchemaVerified(false);
      const ins = 'inserted' in result ? result.inserted : 0;
      const upd = 'updated' in result ? result.updated : 0;
      const tot = 'totalRecipients' in result ? result.totalRecipients : parsedRecipientImport.items.length;
      onNotify(
        `Impor guru & karyawan tervalidasi selesai: ${ins} baru, ${upd} diperbarui (total ${tot} penerima).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengimpor data guru & karyawan.',
        'error'
      );
    } finally {
      setImportingRecipients(false);
    }
  };

  const handleAddRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateRecipient || !recName.trim()) return;
    setSavingRecipient(true);
    try {
      await onCreateRecipient({
        name: recName.trim(),
        category: recCategory,
        nip: recNip.trim(),
        unit: recUnit.trim(),
      });
      setRecName('');
      setRecNip('');
      setRecUnit('');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal menambahkan data guru atau karyawan.',
        'error'
      );
    } finally {
      setSavingRecipient(false);
    }
  };

  const handleSaveEditRecipient = async (id: string) => {
    if (!onUpdateRecipient || !editRecName.trim()) return;
    setBusyRecId(id);
    try {
      await onUpdateRecipient(id, {
        name: editRecName.trim(),
        category: editRecCategory,
        nip: editRecNip.trim(),
        unit: editRecUnit.trim(),
      });
      setEditingRecId(null);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal menyimpan perubahan guru atau karyawan.',
        'error'
      );
    } finally {
      setBusyRecId(null);
    }
  };

  const handleToggleRecipientActive = async (rec: DispositionRecipient) => {
    if (!onUpdateRecipient) return;
    setBusyRecId(rec.id);
    try {
      await onUpdateRecipient(rec.id, { isActive: !rec.isActive });
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengubah status aktif penerima.',
        'error'
      );
    } finally {
      setBusyRecId(null);
    }
  };

  const handleRemoveRecipient = async (id: string) => {
    if (!onDeleteRecipient) return;
    setBusyRecId(id);
    try {
      await onDeleteRecipient(id);
      setConfirmDeleteRecId(null);
    } finally {
      setBusyRecId(null);
    }
  };

  const availableCounterYears = Array.from(
    new Set([
      currentYear - 1,
      currentYear,
      currentYear + 1,
      selectedCounterYear,
      ...counters.map((c) => c.year),
    ])
  )
    .filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100)
    .sort((a, b) => b - a);

  const handleSelectCustomCounterYear = () => {
    const parsed = Number(customCounterYearInput.trim());
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      onNotify('Masukkan tahun antara 2000 sampai 2100.', 'error');
      return;
    }
    setSelectedCounterYear(parsed);
    setCustomCounterYearInput('');
  };

  const handleSaveCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCounter(true);
    try {
      await onUpdateCounter(selectedCounterYear, Number(inCounter), Number(outCounter));
    } finally {
      setSavingCounter(false);
    }
  };

  const handleQuickInitYear = async (targetYear: number) => {
    if (!onInitCounter) return;
    setInitializingFiscalYear(true);
    try {
      await onInitCounter(targetYear, false);
      setSelectedCounterYear(targetYear);
    } finally {
      setInitializingFiscalYear(false);
    }
  };

  const handleToggleAutoInitNewYear = async (enabled: boolean) => {
    if (!isAdmin) return;
    const nextForm: SchoolSettings = { ...form, autoInitNewYearCounter: enabled };
    lastSyncedProfilSigRef.current = serializeProfilSettings(nextForm);
    setForm(nextForm);
    setSavingAutoInit(true);
    try {
      await onSaveSettings({ autoInitNewYearCounter: enabled });
    } catch {
      const reverted: SchoolSettings = { ...form, autoInitNewYearCounter: !enabled };
      lastSyncedProfilSigRef.current = serializeProfilSettings(reverted);
      setForm(reverted);
    } finally {
      setSavingAutoInit(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    try {
      await api.createUser({
        username: newUsername,
        password: newPassword,
        displayName: newDisplayName,
        jabatan: newJabatan,
        role: newRole,
      });
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewJabatan('');
      setNewRole('staf');
      onNotify('Akun staf baru berhasil dibuat.');
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal membuat akun pengguna.', 'error');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUser = async (u: AuthUser) => {
    try {
      await api.updateUserStatus(u.id, !u.isActive);
      onNotify(`Status akun ${u.username} berhasil diperbarui.`);
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal mengubah status akun.', 'error');
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newOwnPassword.length < 6) {
      onNotify('Kata sandi baru minimal 6 karakter.', 'error');
      return;
    }
    if (newOwnPassword !== confirmOwnPassword) {
      onNotify('Konfirmasi kata sandi baru tidak cocok.', 'error');
      return;
    }
    setSavingOwnPassword(true);
    try {
      await api.changeMyPassword(currentPasswordInput, newOwnPassword);
      setCurrentPasswordInput('');
      setNewOwnPassword('');
      setConfirmOwnPassword('');
      onNotify('Kata sandi akun Anda berhasil diperbarui.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memperbarui kata sandi Anda.',
        'error'
      );
    } finally {
      setSavingOwnPassword(false);
    }
  };

  const handleSaveUserPassword = async (e: React.FormEvent, targetUser: AuthUser) => {
    e.preventDefault();
    if (resetPasswordValue.length < 6) {
      onNotify('Kata sandi baru minimal 6 karakter.', 'error');
      return;
    }
    setSavingUserPassword(true);
    try {
      await api.updateUserPassword(targetUser.id, resetPasswordValue);
      setEditingPasswordUserId(null);
      setResetPasswordValue('');
      onNotify(`Kata sandi akun ${targetUser.username} berhasil diperbarui.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memperbarui kata sandi pengguna.',
        'error'
      );
    } finally {
      setSavingUserPassword(false);
    }
  };

  const handleDeleteUser = async (targetUser: AuthUser) => {
    setDeletingUserId(targetUser.id);
    try {
      await api.deleteUser(targetUser.id);
      setConfirmDeleteUserId(null);
      if (editingPasswordUserId === targetUser.id) {
        setEditingPasswordUserId(null);
        setResetPasswordValue('');
      }
      onNotify(`Akun ${targetUser.username} berhasil dihapus.`);
      await loadUsers();
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal menghapus akun pengguna.',
        'error'
      );
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleClearLogs = async () => {
    try {
      await api.clearErrorLogs();
      onNotify('Riwayat log error telah dibersihkan.');
      await loadMonitoring();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal membersihkan log.', 'error');
    }
  };

  const previewLetterNo = formatOutgoingPreview(
    form.outgoingFormatPattern,
    classifications[0]?.code || '421.3',
    outCounter + 1,
    form.schoolCode,
    `${selectedCounterYear}-${new Date().toISOString().slice(5, 10)}`
  );

  const filteredLogs = logs.filter((l) =>
    logLevelFilter === 'all' ? true : l.level === logLevelFilter
  );

  const exportLogsJson = () => {
    const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-monitoring-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredActivities = activities.filter((act) => {
    if (activityActionFilter !== 'ALL' && act.action !== activityActionFilter) {
      return false;
    }
    if (activityEntityFilter !== 'ALL' && act.entityType !== activityEntityFilter) {
      return false;
    }
    const q = activitySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      act.actorDisplayName.toLowerCase().includes(q) ||
      act.actorUsername.toLowerCase().includes(q) ||
      act.referenceNumber.toLowerCase().includes(q) ||
      act.subject.toLowerCase().includes(q) ||
      act.details.toLowerCase().includes(q)
    );
  });

  const exportActivitiesCsv = () => {
    const escapeCsv = (val: string) => `"${String(val || '').replaceAll('"', '""')}"`;
    const headers = ['Waktu', 'Pengguna', 'Username', 'Peran', 'Aksi', 'Jenis Surat', 'Nomor Surat / Agenda', 'Perihal', 'Keterangan'];
    const rows = filteredActivities.map((a) => [
      new Date(a.createdAt).toLocaleString('id-ID'),
      a.actorDisplayName,
      a.actorUsername,
      a.actorRole,
      a.action === 'CREATE' ? 'Membuat' : a.action === 'UPDATE' ? 'Mengedit' : 'Menghapus',
      a.entityType === 'incoming' ? 'Surat Masuk' : 'Surat Keluar',
      a.referenceNumber,
      a.subject,
      a.details,
    ]);
    const csv = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-aktivitas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const actionLabel = (action: ActivityAction) => {
    if (action === 'CREATE') return 'Membuat';
    if (action === 'UPDATE') return 'Mengedit';
    return 'Menghapus';
  };

  const actionTextClass = (action: ActivityAction) => {
    if (action === 'CREATE') return 'text-emerald-700 dark:text-emerald-400 font-semibold';
    if (action === 'UPDATE') return 'text-blue-700 dark:text-sky-400 font-semibold';
    return 'text-rose-700 dark:text-rose-400 font-semibold';
  };

  const roleLabel = (roleValue: string) => {
    if (roleValue === 'admin') return 'Admin TU';
    if (roleValue === 'kepala_sekolah') return 'Kepala Sekolah';
    if (roleValue === 'staf') return 'Staf / Guru';
    return 'Operator';
  };

  const handleMarkAlertRead = async (id: string) => {
    try {
      await api.markSecurityAlertRead(id);
      await loadSecurityData();
      onSecurityAlertsUpdated?.();
      onNotify('Notifikasi keamanan ditandai sudah ditinjau.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal menandai notifikasi keamanan.',
        'error'
      );
    }
  };

  const handleMarkAllAlertsRead = async () => {
    try {
      await api.markAllSecurityAlertsRead();
      await loadSecurityData();
      onSecurityAlertsUpdated?.();
      onNotify('Semua notifikasi keamanan telah ditandai dibaca.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memperbarui notifikasi keamanan.',
        'error'
      );
    }
  };

  const handleClearReadAlerts = async () => {
    try {
      await api.clearReadSecurityAlerts();
      await loadSecurityData();
      onSecurityAlertsUpdated?.();
      onNotify('Catatan keamanan yang sudah ditinjau telah dibersihkan.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal membersihkan catatan keamanan.',
        'error'
      );
    }
  };

  const handleRunCheckpoint = async () => {
    setRunningCheckpoint(true);
    try {
      const nextStatus = await api.checkpointDatabase();
      setStorageStatus(nextStatus);
      onNotify('Sinkronisasi WAL database ke disk berhasil dijalankan.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal menjalankan checkpoint database.',
        'error'
      );
    } finally {
      setRunningCheckpoint(false);
    }
  };

  const handleDownloadBackup = async () => {
    setDownloadingBackup(true);
    try {
      const blob = await api.downloadDatabaseBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cadangan-esurat-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify('Cadangan database JSON berhasil diunduh.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengunduh cadangan database.',
        'error'
      );
    } finally {
      setDownloadingBackup(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setCreatingSnapshot(true);
    try {
      const res = await api.createSnapshot();
      setSnapshots(res.snapshots);
      setStorageStatus(res.storage);
      onNotify(`Snapshot otomatis "${res.fileName}" berhasil disimpan di server.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal membuat snapshot database.',
        'error'
      );
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleRestoreSnapshot = async (fileName: string) => {
    setRestoringBackup(true);
    try {
      const res = await api.restoreBackup({
        mode: restoreMode,
        snapshotFileName: fileName,
      });
      setSnapshots(res.snapshots);
      setStorageStatus(res.storage);
      setConfirmRestoreSnapshot(null);
      await onDataRestored?.();
      onNotify(
        `Pemulihan (${restoreMode === 'merge' ? 'Gabung Data Terbaru' : 'Ganti Penuh'}) berhasil: ${res.result.restoredIncoming} surat masuk, ${res.result.restoredOutgoing} surat keluar, ${res.result.restoredRegulations} peraturan.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memulihkan data dari snapshot.',
        'error'
      );
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleRestoreFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRestoringBackup(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const res = await api.restoreBackup({
        mode: restoreMode,
        backupPayload: parsed,
      });
      setSnapshots(res.snapshots);
      setStorageStatus(res.storage);
      await onDataRestored?.();
      onNotify(
        `Berkas cadangan "${file.name}" berhasil dipulihkan (${res.result.restoredIncoming} surat masuk, ${res.result.restoredOutgoing} surat keluar).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Berkas JSON cadangan tidak valid atau gagal dipulihkan.',
        'error'
      );
    } finally {
      setRestoringBackup(false);
    }
  };

  const snapshotReasonLabel = (reason: DatabaseSnapshotSummary['reason']) => {
    if (reason === 'startup') return 'Otomatis Saat Startup / Update';
    if (reason === 'pre-restore') return 'Pengaman Sebelum Pemulihan';
    return 'Snapshot Manual Admin';
  };

  const severityLabel = (sev: SecurityAlertSeverity) => {
    if (sev === 'critical') return 'Kritis';
    if (sev === 'high') return 'Tinggi';
    return 'Sedang';
  };

  const severityTextClass = (sev: SecurityAlertSeverity) => {
    if (sev === 'critical') return 'text-rose-700 dark:text-rose-400 font-semibold';
    if (sev === 'high') return 'text-amber-700 dark:text-amber-400 font-semibold';
    return 'text-[var(--theme-text-secondary)] font-semibold';
  };

  const categoryLabel = (cat: SecurityAlertCategory) => {
    if (cat === 'BRUTE_FORCE') return 'Brute-Force Login';
    if (cat === 'AUTH_PROBE') return 'Probing Sesi / Token';
    if (cat === 'PRIVILEGE_ESCALATION') return 'Akses Terbatas Admin';
    if (cat === 'INJECTION_ATTEMPT') return 'Injeksi SQL / XSS';
    if (cat === 'PATH_TRAVERSAL') return 'Path Traversal / Scan';
    if (cat === 'MALICIOUS_UPLOAD') return 'Unggahan Berbahaya';
    return 'Integritas Data';
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const filteredSecurityAlerts = securityAlerts.filter((item) =>
    securityFilter === 'unread' ? !item.isRead : true
  );

  const activeTheme = getThemeById(activeThemeId);
  const badgeAlerts = subTab === 'keamanan' ? securityUnreadCount : unreadSecurityAlerts;

  const availableTabs: Array<{ id: SettingsTab; label: string }> = isAdmin
    ? [
        { id: 'profil', label: 'Profil & Logo Sekolah' },
        { id: 'menu', label: 'Menu & Portal Login' },
        { id: 'tema', label: 'Tampilan & Tema' },
        { id: 'klasifikasi', label: 'Klasifikasi & Nomor Urut' },
        { id: 'penerima', label: 'Guru & Karyawan' },
        { id: 'pengguna', label: 'Akun & Kata Sandi' },
        { id: 'aktivitas', label: 'Log Aktivitas' },
        {
          id: 'keamanan',
          label: badgeAlerts > 0 ? `Keamanan & Data (${badgeAlerts})` : 'Keamanan & Data',
        },
        { id: 'spreadsheet', label: 'Ekspor Google Spreadsheet' },
        { id: 'blogger', label: 'Ekspor Blogger' },
        { id: 'monitoring', label: 'Monitoring & Log Sistem' },
      ]
    : [
        { id: 'profil', label: 'Profil Sekolah' },
        { id: 'pengguna', label: 'Kata Sandi Akun' },
      ];

  const filteredRecipients = dispositionRecipients.filter((rec) => {
    if (recCategoryFilter !== 'Semua' && rec.category !== recCategoryFilter) return false;
    const q = recSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      rec.name.toLowerCase().includes(q) ||
      rec.unit.toLowerCase().includes(q) ||
      rec.nip.toLowerCase().includes(q)
    );
  });

  const allRecipientUnits = Array.from(
    new Set([
      ...STAFF_UNITS,
      ...dispositionRecipients.map((r) => r.unit.trim()).filter(Boolean),
    ])
  );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Segmented Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg w-fit">
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === tab.id
                ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Profil & Logo Sekolah */}
      {subTab === 'profil' && (
        <div className="space-y-6">
          {/* Logo Portal & Logo Kop Surat Resmi hanya dapat dilihat dan dikelola oleh Admin */}
          {isAdmin && (
            <>
              {/* Logo Sekolah Section */}
              <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-xl p-2 flex items-center justify-center shrink-0">
                      <SchoolCrest
                        className="w-full h-full"
                        logoUrl={form.logoUrl}
                        alt={`Logo ${form.schoolName}`}
                      />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-[var(--theme-text)]">
                        Logo Portal &amp; Aplikasi Sekolah
                      </h2>
                      <p className="text-xs text-[var(--theme-text-muted)] mt-0.5 max-w-md">
                        Logo utama ini ditampilkan pada layar login dan bilah navigasi aplikasi. Format PNG, JPG, WEBP, atau SVG maks. 2 MB.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <label className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap">
                      <ImagePlus className="w-3.5 h-3.5" />
                      {uploadingLogoTarget === 'logoUrl' ? 'Mengunggah...' : 'Ganti Logo Portal'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(e) => void handleLogoUpload('logoUrl', e)}
                        disabled={uploadingLogoTarget !== null}
                        className="hidden"
                      />
                    </label>
                    {form.logoUrl && (
                      <button
                        type="button"
                        onClick={() => void handleResetLogo('logoUrl')}
                        className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Logo Bawaan
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Kop Sekolah Lengkap (Upload Gambar Utuh) */}
              <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--theme-text)]">
                      Kop Sekolah Lengkap (Upload Gambar)
                    </h2>
                    <p className="text-xs text-[var(--theme-text-muted)] mt-0.5 max-w-2xl">
                      Unggah gambar kop surat sekolah utuh (sudah mencakup logo, nama instansi, alamat, dan garis kop) untuk langsung digunakan pada semua pratinjau cetak A4 dan ekspor PDF. Format PNG, JPG, WEBP, atau SVG (maks. 4 MB).
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <label className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                      <ImagePlus className="w-3.5 h-3.5" />
                      {uploadingLogoTarget === 'kopImageUrl'
                        ? 'Mengunggah...'
                        : form.kopImageUrl
                          ? 'Ganti Gambar Kop'
                          : 'Unggah Gambar Kop'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(e) => void handleLogoUpload('kopImageUrl', e)}
                        disabled={uploadingLogoTarget !== null}
                        className="hidden"
                      />
                    </label>
                    {form.kopImageUrl && (
                      <button
                        type="button"
                        onClick={() => void handleResetLogo('kopImageUrl')}
                        className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Gunakan Kop Teks Standar
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-6 bg-[var(--theme-surface-subtle)]">
                  {form.kopImageUrl ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-[var(--theme-text-secondary)]">
                        Kop Sekolah Aktif (Dari Upload Gambar)
                      </div>
                      <div className="bg-white border border-[var(--theme-border-strong)] rounded-lg p-4 flex items-center justify-center">
                        <img
                          src={form.kopImageUrl}
                          alt={`Pratinjau Kop Sekolah ${form.schoolName}`}
                          className="w-full max-h-40 object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] px-4 py-5 text-center">
                      <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
                        Belum ada gambar Kop Sekolah khusus yang diunggah.
                      </p>
                      <p className="text-[11px] text-[var(--theme-text-muted)] mt-1">
                        Saat ini dokumen cetak dan PDF memakai Kop Teks Standar (tanpa logo) dari identitas sekolah di bawah.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Profil & Kop Surat */}
          <form
            onSubmit={handleSubmitSettings}
            className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  Profil Sekolah & Kop Surat Resmi
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Identitas ini otomatis dicetak pada Kop Surat Lembar Disposisi, Buku Agenda, dan PDF.
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  {profilAutoSaveState !== 'idle' && (
                    <span className="text-[11px] text-[var(--theme-text-muted)]">
                      {profilAutoSaveState === 'saving'
                        ? 'Menyimpan otomatis...'
                        : 'Tersimpan otomatis di database'}
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingSettings ? 'Menyimpan...' : 'Simpan Profil'}
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[var(--theme-text-muted)]">
                  Hanya Admin yang dapat mengedit atau memperbarui profil.
                </span>
              )}
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Nama Sekolah</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.schoolName}
                  onChange={(e) => setForm({ ...form, schoolName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">NPSN</span>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={form.npsn}
                  onChange={(e) => setForm({ ...form, npsn: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Pemerintah Daerah</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.districtGov}
                  onChange={(e) => setForm({ ...form, districtGov: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Dinas / Instansi Induk</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.parentAgency}
                  onChange={(e) => setForm({ ...form, parentAgency: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs md:col-span-2">
                <span className="font-medium text-[var(--theme-text-secondary)]">Alamat Lengkap Sekolah</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Telepon & Kode Pos</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    disabled={!isAdmin}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="Telepon"
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                  <input
                    type="text"
                    disabled={!isAdmin}
                    value={form.postalCode}
                    onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                    placeholder="Kode Pos"
                    className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </div>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Email & Website</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="email"
                    disabled={!isAdmin}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="Email"
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                  <input
                    type="text"
                    disabled={!isAdmin}
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder="Website"
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </div>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Nama Kepala Sekolah</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.principalName}
                  onChange={(e) => setForm({ ...form, principalName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">NIP Kepala Sekolah</span>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={form.principalNip}
                  onChange={(e) => setForm({ ...form, principalNip: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Nama Bagian Tata Usaha</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.tuHeadName}
                  onChange={(e) => setForm({ ...form, tuHeadName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">NIP Bagian Tata Usaha</span>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={form.tuHeadNip}
                  onChange={(e) => setForm({ ...form, tuHeadNip: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Kode Singkatan Sekolah</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.schoolCode}
                  onChange={(e) => setForm({ ...form, schoolCode: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Pola Format Nomor Surat Keluar</span>
                <input
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={form.outgoingFormatPattern}
                  onChange={(e) =>
                    setForm({ ...form, outgoingFormatPattern: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] disabled:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <span className="block text-[11px] text-[var(--theme-text-muted)] mt-1">
                  Pratinjau: <strong className="font-mono text-[var(--theme-text)]">{previewLetterNo}</strong>
                </span>
              </label>
            </div>
          </form>
        </div>
      )}

      {/* Tab: Keterangan Semua Menu Aplikasi (Admin Only) */}
      {isAdmin && subTab === 'menu' && (
        <form
          onSubmit={handleSaveMenuConfigs}
          className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                <FilePenLine className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  Keterangan Portal Login &amp; Menu Aplikasi
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Sesuaikan keterangan pada halaman Portal Login serta nama navigasi, judul halaman, dan deskripsi untuk seluruh menu utama aplikasi.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {menuAutoSaveState !== 'idle' && (
                <span className="text-[11px] text-[var(--theme-text-muted)] mr-1">
                  {menuAutoSaveState === 'saving'
                    ? 'Menyimpan otomatis...'
                    : 'Tersimpan otomatis di database'}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleResetMenuConfigs()}
                disabled={savingMenuConfigs}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Kembalikan Bawaan
              </button>
              <button
                type="submit"
                disabled={savingMenuConfigs}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                {savingMenuConfigs ? 'Menyimpan...' : 'Simpan Semua'}
              </button>
            </div>
          </div>

          <div className="divide-y divide-[var(--theme-border)]">
            {/* Portal Login Copy Section */}
            <div className="p-6 space-y-4 bg-[var(--theme-surface-subtle)]/50">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                    Halaman Portal Login
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Teks sambutan dan panduan singkat yang tampil di layar masuk sebelum pengguna login.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-[var(--theme-text-muted)]">
                  portal_login
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Judul Utama Portal Login (Panel Kiri)
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={160}
                    value={loginPortalForm.loginHeadline}
                    onChange={(e) =>
                      setLoginPortalForm((prev) => ({ ...prev, loginHeadline: e.target.value }))
                    }
                    placeholder="Contoh: Sistem Informasi Manajemen Persuratan Sekolah"
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Judul Kotak Masuk (Panel Kanan)
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={loginPortalForm.loginFormTitle}
                    onChange={(e) =>
                      setLoginPortalForm((prev) => ({ ...prev, loginFormTitle: e.target.value }))
                    }
                    placeholder="Contoh: Masuk ke Portal E-Surat"
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Keterangan Portal Login (Panel Kiri)
                  </span>
                  <textarea
                    rows={3}
                    maxLength={400}
                    value={loginPortalForm.loginDescription}
                    onChange={(e) =>
                      setLoginPortalForm((prev) => ({
                        ...prev,
                        loginDescription: e.target.value,
                      }))
                    }
                    placeholder="Tuliskan keterangan singkat portal persuratan..."
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Keterangan Kotak Masuk (Panel Kanan)
                  </span>
                  <textarea
                    rows={3}
                    maxLength={240}
                    value={loginPortalForm.loginFormSubtitle}
                    onChange={(e) =>
                      setLoginPortalForm((prev) => ({
                        ...prev,
                        loginFormSubtitle: e.target.value,
                      }))
                    }
                    placeholder="Tuliskan petunjuk singkat akun pengguna..."
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>
              </div>
            </div>
            {(
              [
                { key: 'dashboard', heading: 'Menu 1 — Dasbor' },
                { key: 'incoming', heading: 'Menu 2 — Surat Masuk' },
                { key: 'outgoing', heading: 'Menu 3 — Surat Keluar' },
                { key: 'dispositions', heading: 'Menu 4 — Disposisi' },
                { key: 'regulations', heading: 'Menu 5 — Referensi Peraturan' },
                { key: 'guide', heading: 'Menu 6 — Panduan Aplikasi' },
                { key: 'settings', heading: 'Menu 7 — Pengaturan' },
              ] as Array<{ key: AppMenuKey; heading: string }>
            ).map(({ key, heading }) => {
              const item = menuForm[key] ?? DEFAULT_MENU_CONFIGS[key];
              return (
                <div key={key} className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--theme-text)]">{heading}</h3>
                    <span className="text-[11px] font-mono text-[var(--theme-text-muted)]">
                      {key}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 text-xs">
                      <span className="font-medium text-[var(--theme-text-secondary)]">
                        Label Sidebar
                      </span>
                      <input
                        type="text"
                        required
                        value={item.label}
                        onChange={(e) =>
                          setMenuForm((prev) => ({
                            ...prev,
                            [key]: { ...item, label: e.target.value },
                          }))
                        }
                        className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="font-medium text-[var(--theme-text-secondary)]">
                        Judul Header Halaman
                      </span>
                      <input
                        type="text"
                        required
                        value={item.title}
                        onChange={(e) =>
                          setMenuForm((prev) => ({
                            ...prev,
                            [key]: { ...item, title: e.target.value },
                          }))
                        }
                        className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                      />
                    </label>
                    <label className="space-y-1 text-xs md:col-span-2">
                      <span className="font-medium text-[var(--theme-text-secondary)]">
                        Keterangan / Deskripsi Menu
                      </span>
                      <textarea
                        rows={2}
                        value={item.description}
                        onChange={(e) =>
                          setMenuForm((prev) => ({
                            ...prev,
                            [key]: { ...item, description: e.target.value },
                          }))
                        }
                        placeholder="Tuliskan keterangan singkat fungsi menu ini..."
                        className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </form>
      )}

      {/* Tab 2: Tampilan & Tema (Admin Only) */}
      {isAdmin && subTab === 'tema' && (
        <div className="space-y-6">
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-5 border-b border-[var(--theme-border)] space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                    <Palette className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--theme-text)]">
                      Koleksi Tema Tampilan E-Surat
                    </h2>
                    <p className="text-xs text-[var(--theme-text-muted)] mt-0.5 leading-relaxed">
                      Tema aktif:{' '}
                      <strong className="text-[var(--theme-text)]">{activeTheme.name}</strong> ·{' '}
                      {activeTheme.category} ·{' '}
                      {activeTheme.mode === 'dark' ? 'Mode Gelap' : 'Mode Terang'}. Pilihan Admin tersimpan sebagai tampilan resmi sekolah tanpa mengubah format cetakan resmi A4/PDF.
                    </p>
                  </div>
                </div>

                {activeThemeId !== DEFAULT_THEME_ID && (
                  <button
                    type="button"
                    onClick={() => onSelectTheme(DEFAULT_THEME_ID)}
                    className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start lg:self-center"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Kembalikan Bawaan
                  </button>
                )}
              </div>

              {/* Filter Bar: Mode & Kategori */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div
                  role="group"
                  aria-label="Filter kategori tema"
                  className="inline-flex flex-wrap items-center gap-1 p-0.5 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg"
                >
                  {(
                    [
                      { id: 'all', label: 'Semua Gaya' },
                      { id: 'Fresh & Elegan', label: 'Fresh & Elegan' },
                      { id: 'Modern Eksekutif', label: 'Modern Eksekutif' },
                      { id: 'Klasik Dinas', label: 'Klasik Dinas' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setThemeCategoryFilter(cat.id)}
                      aria-pressed={themeCategoryFilter === cat.id}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        themeCategoryFilter === cat.id
                          ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div
                  role="group"
                  aria-label="Filter mode pencahayaan tema"
                  className="inline-flex items-center p-0.5 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg"
                >
                  {(
                    [
                      { id: 'all', label: `Semua (${APP_THEMES.length})` },
                      {
                        id: 'light',
                        label: `Terang (${APP_THEMES.filter((t) => t.mode === 'light').length})`,
                      },
                      {
                        id: 'dark',
                        label: `Gelap (${APP_THEMES.filter((t) => t.mode === 'dark').length})`,
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setThemeModeFilter(opt.id)}
                      aria-pressed={themeModeFilter === opt.id}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        themeModeFilter === opt.id
                          ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Active Theme Showcase Bar */}
            <div className="px-6 py-4 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
                  {activeTheme.swatches.map((hex, i) => (
                    <span
                      key={`${activeTheme.id}-sw-${i}`}
                      className="w-5 h-5 rounded-sm border border-[var(--theme-border-strong)]"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--theme-text)] truncate">
                    Pratinjau Palet Aktif: {activeTheme.name}
                  </div>
                  <div className="text-[11px] text-[var(--theme-text-muted)] truncate">
                    {activeTheme.subtitle}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono tabular-nums">
                <span className="px-2.5 py-1 rounded-md bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] font-semibold">
                  Aksen Utama
                </span>
                <span className="px-2.5 py-1 rounded-md bg-[var(--theme-surface)] border border-[var(--theme-border-strong)] text-[var(--theme-text-secondary)]">
                  Permukaan
                </span>
              </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {APP_THEMES.filter((t) => {
                const matchMode = themeModeFilter === 'all' ? true : t.mode === themeModeFilter;
                const matchCat =
                  themeCategoryFilter === 'all' ? true : t.category === themeCategoryFilter;
                return matchMode && matchCat;
              }).map((theme) => {
                const isSelected = theme.id === activeThemeId;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => onSelectTheme(theme.id)}
                    aria-pressed={isSelected}
                    className={`group text-left rounded-xl border transition-all duration-150 overflow-hidden flex flex-col hover:-translate-y-0.5 ${
                      isSelected
                        ? 'border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)]/25 bg-[var(--theme-surface)] shadow-sm'
                        : 'border-[var(--theme-border)] hover:border-[var(--theme-border-strong)] bg-[var(--theme-surface)]'
                    }`}
                  >
                    {/* Live miniature dashboard preview scoped with data-theme */}
                    <div
                      data-theme={theme.id}
                      className="w-full h-34 p-2.5 bg-[var(--theme-canvas)] border-b border-[var(--theme-border)] flex gap-2 select-none"
                    >
                      {/* Mini Sidebar */}
                      <div className="w-14 rounded-md bg-[var(--theme-surface)] border border-[var(--theme-border)] p-1.5 flex flex-col gap-1.5 shrink-0">
                        <div className="w-full h-3 rounded-xs bg-[var(--theme-hero-panel)]" />
                        <div className="w-full h-2 rounded-xs bg-[var(--theme-accent)]" />
                        <div className="w-4/5 h-1.5 rounded-xs bg-[var(--theme-border-strong)]" />
                        <div className="w-3/4 h-1.5 rounded-xs bg-[var(--theme-border)]" />
                        <div className="mt-auto w-full h-2 rounded-xs bg-[var(--theme-surface-hover)]" />
                      </div>

                      {/* Mini Main Area */}
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {/* Mini Topbar */}
                        <div className="h-5 rounded-md bg-[var(--theme-surface)] border border-[var(--theme-border)] px-2 flex items-center justify-between">
                          <div className="w-16 h-1.5 rounded-xs bg-[var(--theme-text)] opacity-80" />
                          <div className="w-10 h-2.5 rounded-xs bg-[var(--theme-accent)]" />
                        </div>

                        {/* Mini KPI + Table Card */}
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="h-7 rounded-md bg-[var(--theme-surface)] border border-[var(--theme-border)] p-1 flex flex-col justify-between">
                            <div className="w-6 h-1 rounded-xs bg-[var(--theme-text-muted)] opacity-60" />
                            <div className="w-5 h-1.5 rounded-xs bg-[var(--theme-text)] opacity-85" />
                          </div>
                          <div className="h-7 rounded-md bg-[var(--theme-surface)] border border-[var(--theme-border)] p-1 flex flex-col justify-between">
                            <div className="w-6 h-1 rounded-xs bg-[var(--theme-text-muted)] opacity-60" />
                            <div className="w-5 h-1.5 rounded-xs bg-[var(--theme-accent-text)]" />
                          </div>
                          <div className="h-7 rounded-md bg-[var(--theme-accent-tint)] border border-[var(--theme-border)] p-1 flex flex-col justify-between">
                            <div className="w-6 h-1 rounded-xs bg-[var(--theme-accent-text)] opacity-85" />
                            <div className="w-5 h-1.5 rounded-xs bg-[var(--theme-text)] opacity-85" />
                          </div>
                        </div>

                        <div className="flex-1 rounded-md bg-[var(--theme-surface)] border border-[var(--theme-border)] p-1.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="w-2/3 h-1.5 rounded-xs bg-[var(--theme-text)] opacity-75" />
                            <div className="w-6 h-1.5 rounded-xs bg-[var(--theme-accent-text)] opacity-85" />
                          </div>
                          <div className="w-1/2 h-1.5 rounded-xs bg-[var(--theme-text-muted)] opacity-55" />
                        </div>
                      </div>
                    </div>

                    {/* Card Details */}
                    <div className="p-4 flex-1 flex flex-col justify-between gap-2.5">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[var(--theme-text)] font-display">
                            {theme.name}
                          </span>
                          {isSelected && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--theme-accent-text)] shrink-0">
                              <Check className="w-3.5 h-3.5" />
                              Aktif
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--theme-text-muted)] mt-1 leading-relaxed">
                          {theme.subtitle}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-[var(--theme-border)] text-[11px] text-[var(--theme-text-muted)]">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {theme.mode === 'dark' ? (
                            <Moon className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                          ) : (
                            <Sun className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          )}
                          <span>{theme.mode === 'dark' ? 'Gelap' : 'Terang'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{theme.category}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 shrink-0">
                          <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                            {theme.swatches.map((hex, i) => (
                              <span
                                key={`${theme.id}-dot-${i}`}
                                className="w-2.5 h-2.5 rounded-xs border border-[var(--theme-border-strong)]"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </span>
                          <span className="text-[var(--theme-accent-text)] font-medium group-hover:underline whitespace-nowrap">
                            {isSelected ? 'Digunakan' : 'Terapkan'}
                          </span>
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: Klasifikasi & Nomor Urut (Admin Only) */}
      {isAdmin && subTab === 'klasifikasi' && (
        <div className="space-y-6">
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] shrink-0">
                  <CalendarRange className="w-4 h-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h2 className="text-base font-semibold text-[var(--theme-text)]">
                      Kesiapan Tahun Anggaran Baru {fiscalReadiness.nextYear}
                    </h2>
                    <span className="text-xs font-mono tabular-nums text-[var(--theme-accent-text)] font-semibold">
                      · H-{fiscalReadiness.daysUntilNewYear} menuju 1 Jan {fiscalReadiness.nextYear}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--theme-text-muted)] leading-relaxed">
                    {fiscalReadiness.hasNextYearCounter ? (
                      <>
                        Penghitung nomor urut Tahun {fiscalReadiness.nextYear} sudah siap digunakan
                        (Masuk #{String(fiscalReadiness.targetCounter?.incomingLastSeq ?? 0).padStart(3, '0')} · Keluar #
                        {String(fiscalReadiness.targetCounter?.outgoingLastSeq ?? 0).padStart(3, '0')}).
                      </>
                    ) : (
                      <>
                        Penghitung nomor urut Tahun {fiscalReadiness.nextYear} belum diinisialisasi. Anda dapat menyiapkannya otomatis sekarang agar penomoran tahun baru dimulai dari #001.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {fiscalReadiness.hasNextYearCounter ? (
                  <button
                    type="button"
                    onClick={() => setSelectedCounterYear(fiscalReadiness.nextYear)}
                    className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-accent)]/40 bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] rounded-lg hover:opacity-90 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Tahun {fiscalReadiness.nextYear} Siap · Kelola
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={initializingFiscalYear || !onInitCounter}
                    onClick={() => void handleQuickInitYear(fiscalReadiness.nextYear)}
                    className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 whitespace-nowrap"
                  >
                    {initializingFiscalYear
                      ? 'Menginisialisasi...'
                      : `Inisialisasi Otomatis Tahun ${fiscalReadiness.nextYear} (Mulai #001)`}
                  </button>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="inline-flex items-start sm:items-center gap-2.5 text-xs text-[var(--theme-text)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={savingAutoInit}
                  checked={form.autoInitNewYearCounter ?? true}
                  onChange={(e) => void handleToggleAutoInitNewYear(e.target.checked)}
                  className="mt-0.5 sm:mt-0 w-4 h-4 rounded border-[var(--theme-border-strong)] accent-[var(--theme-accent)]"
                />
                <span>
                  <span className="font-medium">
                    Inisialisasi otomatis penghitung saat pergantian tahun baru (1 Januari)
                  </span>
                  <span className="block text-[11px] text-[var(--theme-text-muted)]">
                    Saat memasuki tahun kalender baru, sistem otomatis menyiapkan penghitung surat masuk &amp; keluar mulai #001 bila belum dibuat manual.
                  </span>
                </span>
              </label>
              {savingAutoInit && (
                <span className="text-[11px] text-[var(--theme-text-muted)] shrink-0">
                  Menyimpan...
                </span>
              )}
            </div>
          </section>

          <form
            onSubmit={handleSaveCounter}
            className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  Penghitung Nomor Urut Tahun {selectedCounterYear}
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Pilih atau buka tahun buku tertentu untuk menyesuaikan nomor urut terakhir surat masuk dan surat keluar.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  value={String(selectedCounterYear)}
                  onChange={(e) => setSelectedCounterYear(Number(e.target.value))}
                  aria-label="Pilih tahun penghitung nomor urut"
                  className="px-3 py-2 text-xs font-medium font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                >
                  {availableCounterYears.map((yr) => (
                    <option key={yr} value={String(yr)}>
                      Tahun {yr}
                    </option>
                  ))}
                </select>
                <div className="inline-flex items-center gap-1.5">
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={customCounterYearInput}
                    onChange={(e) => setCustomCounterYearInput(e.target.value)}
                    placeholder="Tahun lain..."
                    aria-label="Masukkan tahun buku lainnya"
                    className="w-28 px-2.5 py-2 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                  <button
                    type="button"
                    onClick={handleSelectCustomCounterYear}
                    className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                  >
                    Buka Tahun
                  </button>
                </div>
                {isAdmin && (
                  <button
                    type="submit"
                    disabled={savingCounter}
                    className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {savingCounter ? 'Menyimpan...' : `Simpan Tahun ${selectedCounterYear}`}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Nomor Urut Terakhir Surat Masuk ({selectedCounterYear})
                </span>
                <input
                  type="number"
                  min={0}
                  disabled={!isAdmin}
                  value={inCounter}
                  onChange={(e) => setInCounter(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Nomor Urut Terakhir Surat Keluar ({selectedCounterYear})
                </span>
                <input
                  type="number"
                  min={0}
                  disabled={!isAdmin}
                  value={outCounter}
                  onChange={(e) => setOutCounter(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] disabled:bg-[var(--theme-surface-subtle)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
            </div>

            {counters.length > 0 && (
              <div className="pt-3 border-t border-[var(--theme-border)] space-y-2">
                <div className="text-[11px] font-medium text-[var(--theme-text-muted)]">
                  Riwayat Penghitung Tahun Tersimpan (klik untuk memilih):
                </div>
                <div className="flex flex-wrap gap-2">
                  {counters.map((c) => {
                    const isSelected = c.year === selectedCounterYear;
                    return (
                      <button
                        key={c.year}
                        type="button"
                        onClick={() => setSelectedCounterYear(c.year)}
                        className={`px-3 py-1.5 text-xs font-mono tabular-nums rounded-lg border transition-colors whitespace-nowrap ${
                          isSelected
                            ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] font-semibold'
                            : 'border-[var(--theme-border-strong)] bg-[var(--theme-surface-subtle)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]'
                        }`}
                      >
                        {c.year} · Masuk #{String(c.incomingLastSeq).padStart(3, '0')} · Keluar #
                        {String(c.outgoingLastSeq).padStart(3, '0')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </form>

          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  Kode Klasifikasi Tata Naskah Dinas
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Digunakan untuk pengelompokan arsip dan penomoran otomatis surat keluar ({classifications.length} kode aktif).
                </p>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleDownloadClassTemplate()}
                    disabled={downloadingClassTemplate}
                    className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloadingClassTemplate ? 'Menyiapkan...' : 'Template Excel (.xlsx)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportClassExcel()}
                    disabled={exportingClassExcel || classifications.length === 0}
                    className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    {exportingClassExcel ? 'Mengekspor...' : 'Ekspor Excel'}
                  </button>
                  <label className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {validatingClassFile ? 'Memvalidasi...' : 'Unggah Excel (.xlsx)'}
                    <input
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                      disabled={validatingClassFile}
                      onChange={handleClassFileSelected}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="px-6 py-4 bg-[var(--theme-surface-subtle)]/70 border-b border-[var(--theme-border)]">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!validatingClassFile) setIsDraggingClassFile(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingClassFile(false);
                  }}
                  onDrop={(e) => void handleClassFileDrop(e)}
                  className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
                    isDraggingClassFile
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)]/40'
                      : 'border-[var(--theme-border-strong)] bg-[var(--theme-surface)]'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2.5 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] shrink-0">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-semibold text-[var(--theme-text)]">
                          Unggah Berkas Excel (.xlsx) — Impor Massal &amp; Validasi Skema
                        </div>
                        <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                          Seret berkas <span className="font-mono font-medium text-[var(--theme-text-secondary)]">.xlsx</span> ke kotak ini atau pilih berkas. Sistem akan memvalidasi header kolom, format kode, panjang karakter, dan duplikasi sebelum menyimpan ke database.
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--theme-text-secondary)] pt-0.5">
                          <span>
                            Kolom Wajib: <strong className="font-mono">Kode</strong> (maks. {CLASSIFICATION_SCHEMA_SPEC.codeMaxLength}, tanpa spasi) &amp; <strong className="font-mono">Nama Klasifikasi</strong> ({CLASSIFICATION_SCHEMA_SPEC.nameMinLength}–{CLASSIFICATION_SCHEMA_SPEC.nameMaxLength} kar.)
                          </span>
                          <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                          <span>
                            Opsional: <strong className="font-mono">Keterangan</strong> (maks. {CLASSIFICATION_SCHEMA_SPEC.descriptionMaxLength} kar.)
                          </span>
                          <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                          <span>Maks. {CLASSIFICATION_SCHEMA_SPEC.maxRows.toLocaleString('id-ID')} baris / 5 MB</span>
                        </div>
                      </div>
                    </div>
                    <label className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      {validatingClassFile ? 'Memeriksa Skema...' : 'Pilih Berkas .xlsx'}
                      <input
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                        disabled={validatingClassFile}
                        onChange={handleClassFileSelected}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {isAdmin && (
              <form
                onSubmit={handleAddClassification}
                className="p-4 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] grid grid-cols-1 sm:grid-cols-4 gap-2"
              >
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="Kode (misal: 424)"
                  className="px-3 py-2 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nama Klasifikasi"
                  className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Keterangan singkat (opsional)"
                  className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <button
                  type="submit"
                  disabled={savingClass}
                  className="px-3 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah / Perbarui
                </button>
              </form>
            )}

            <div className="divide-y divide-[var(--theme-border)]">
              {classifications.map((cls) => (
                <div
                  key={cls.code}
                  className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-[var(--theme-surface-hover)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[var(--theme-text)]">
                        {cls.code}
                      </span>
                      <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                      <span className="font-medium text-[var(--theme-text-secondary)]">{cls.name}</span>
                    </div>
                    {cls.description && (
                      <p className="text-xs text-[var(--theme-text-muted)] mt-0.5 truncate">
                        {cls.description}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onDeleteClassification(cls.code)}
                      title={`Hapus kode ${cls.code}`}
                      className="p-1.5 text-[var(--theme-text-muted)] hover:text-rose-700 dark:hover:text-rose-400 rounded transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Tab 3b: Direktori Guru & Karyawan Penerima Disposisi (Admin Only) */}
      {isAdmin && subTab === 'penerima' && (
        <div className="space-y-6">
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  Daftar Guru &amp; Karyawan Penerima Disposisi
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Nama guru dan karyawan di bawah ini muncul pada pilihan penerima saat menerbitkan lembar disposisi surat masuk ({dispositionRecipients.length} data aktif).
                </p>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleDownloadRecipientTemplate()}
                    disabled={downloadingRecipientTemplate}
                    className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloadingRecipientTemplate ? 'Menyiapkan...' : 'Template Excel (.xlsx)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportRecipientExcel()}
                    disabled={exportingRecipientExcel || dispositionRecipients.length === 0}
                    className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    {exportingRecipientExcel ? 'Mengekspor...' : 'Ekspor Excel'}
                  </button>
                  <label className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {validatingRecipientFile ? 'Memvalidasi...' : 'Unggah Excel (.xlsx)'}
                    <input
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                      disabled={validatingRecipientFile}
                      onChange={handleRecipientFileSelected}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="px-6 py-4 bg-[var(--theme-surface-subtle)]/70 border-b border-[var(--theme-border)]">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!validatingRecipientFile) setIsDraggingRecipientFile(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingRecipientFile(false);
                  }}
                  onDrop={(e) => void handleRecipientFileDrop(e)}
                  className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
                    isDraggingRecipientFile
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)]/40'
                      : 'border-[var(--theme-border-strong)] bg-[var(--theme-surface)]'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2.5 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] shrink-0">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-semibold text-[var(--theme-text)]">
                          Unggah Berkas Excel (.xlsx) — Impor Guru &amp; Karyawan Massal &amp; Validasi Skema
                        </div>
                        <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                          Seret berkas <span className="font-mono font-medium text-[var(--theme-text-secondary)]">.xlsx</span> ke kotak ini atau pilih berkas. Sistem akan memvalidasi kolom wajib Nama Lengkap &amp; Kategori (Guru / Karyawan) sebelum disimpan.
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--theme-text-secondary)] pt-0.5">
                          <span>
                            Kolom Wajib: <strong className="font-mono">Nama Lengkap</strong> &amp; <strong className="font-mono">Kategori</strong> (Guru / Karyawan)
                          </span>
                          <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                          <span>
                            Opsional: NIP / NUPTK &amp; Unit / Jabatan
                          </span>
                          <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                          <span>Maks. {RECIPIENT_SCHEMA_SPEC.maxRows.toLocaleString('id')} baris / 5 MB</span>
                        </div>
                      </div>
                    </div>
                    <label className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      {validatingRecipientFile ? 'Memeriksa Skema...' : 'Pilih Berkas .xlsx'}
                      <input
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                        disabled={validatingRecipientFile}
                        onChange={handleRecipientFileSelected}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}


            <form
              onSubmit={handleAddRecipient}
              className="p-5 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] space-y-3"
            >
              <div className="text-xs font-semibold text-[var(--theme-text)]">
                Tambah Nama Guru atau Karyawan Baru
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Nama Lengkap &amp; Gelar *
                  </span>
                  <input
                    type="text"
                    required
                    value={recName}
                    onChange={(e) => setRecName(e.target.value)}
                    placeholder="Contoh: Siti Aminah, S.Pd."
                    className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">Kategori *</span>
                  <select
                    value={recCategory}
                    onChange={(e) => setRecCategory(e.target.value as StaffCategory)}
                    className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    {STAFF_CATEGORY_OPTIONS.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Unit / Jabatan (Opsional)
                  </span>
                  <input
                    type="text"
                    value={recUnit}
                    onChange={(e) => setRecUnit(e.target.value)}
                    list="settings-recipient-units"
                    placeholder="Pilih atau ketik unit..."
                    className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    NIP / NUPTK (Opsional)
                  </span>
                  <input
                    type="text"
                    value={recNip}
                    onChange={(e) => setRecNip(e.target.value)}
                    placeholder="Contoh: 19820415 201001 2 012"
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>
              </div>

              <datalist id="settings-recipient-units">
                {allRecipientUnits.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingRecipient || !recName.trim()}
                  className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {savingRecipient ? 'Menyimpan...' : 'Tambah ke Daftar Penerima'}
                </button>
              </div>
            </form>

            {/* Filter Bar */}
            <div className="px-6 py-3.5 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={recSearch}
                  onChange={(e) => setRecSearch(e.target.value)}
                  placeholder="Cari nama guru, karyawan, NIP, atau unit..."
                  aria-label="Cari guru atau karyawan penerima disposisi"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </div>

              <div
                role="group"
                aria-label="Filter kategori guru dan karyawan"
                className="inline-flex items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg self-start sm:self-auto"
              >
                {(['Semua', ...STAFF_CATEGORY_OPTIONS] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setRecCategoryFilter(cat)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      recCategoryFilter === cat
                        ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                        : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredRecipients.length === 0 ? (
              <div className="p-10 text-center space-y-1.5">
                <p className="text-sm font-medium text-[var(--theme-text)]">
                  Belum ada data guru atau karyawan yang sesuai.
                </p>
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Gunakan formulir di atas untuk menambahkan nama guru atau karyawan penerima disposisi.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--theme-border)]">
                {filteredRecipients.map((rec) => {
                  const isEditing = editingRecId === rec.id;
                  const isBusy = busyRecId === rec.id;
                  const isConfirmingDel = confirmDeleteRecId === rec.id;

                  return (
                    <div
                      key={rec.id}
                      className="px-6 py-4 hover:bg-[var(--theme-surface-hover)]/60 transition-colors"
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                            <input
                              type="text"
                              value={editRecName}
                              onChange={(e) => setEditRecName(e.target.value)}
                              placeholder="Nama lengkap *"
                              className="px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                            />
                            <select
                              value={editRecCategory}
                              onChange={(e) => setEditRecCategory(e.target.value as StaffCategory)}
                              className="px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                            >
                              {STAFF_CATEGORY_OPTIONS.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={editRecUnit}
                              onChange={(e) => setEditRecUnit(e.target.value)}
                              list="settings-recipient-units"
                              placeholder="Unit / Jabatan"
                              className="px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                            />
                            <input
                              type="text"
                              value={editRecNip}
                              onChange={(e) => setEditRecNip(e.target.value)}
                              placeholder="NIP (opsional)"
                              className="px-3 py-1.5 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingRecId(null)}
                              className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              disabled={isBusy || !editRecName.trim()}
                              onClick={() => void handleSaveEditRecipient(rec.id)}
                              className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
                            >
                              {isBusy ? 'Menyimpan...' : 'Simpan Perubahan'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--theme-text)]">
                              <span className={rec.isActive ? '' : 'line-through opacity-60'}>
                                {rec.name}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-muted)]">
                              <span className="font-semibold text-[var(--theme-accent-text)]">
                                {rec.category}
                              </span>
                              {rec.unit && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-[var(--theme-text-secondary)]">{rec.unit}</span>
                                </>
                              )}
                              {rec.nip && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">NIP {rec.nip}</span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  rec.isActive
                                    ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                    : 'text-amber-700 dark:text-amber-400 font-medium'
                                }
                              >
                                {rec.isActive ? 'Aktif' : 'Nonaktif'}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setEditingRecId(rec.id);
                                setEditRecName(rec.name);
                                setEditRecCategory(rec.category);
                                setEditRecNip(rec.nip);
                                setEditRecUnit(rec.unit);
                                setConfirmDeleteRecId(null);
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                            >
                              Ubah
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleRecipientActive(rec)}
                              className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                            >
                              {rec.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>

                            {isConfirmingDel ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleRemoveRecipient(rec.id)}
                                  className="px-2.5 py-1.5 text-xs font-medium bg-rose-700 text-white rounded-md hover:bg-rose-800 whitespace-nowrap"
                                >
                                  Ya, Hapus
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteRecId(null)}
                                  className="px-2 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] whitespace-nowrap"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteRecId(rec.id)}
                                title={`Hapus ${rec.name}`}
                                className="p-1.5 text-[var(--theme-text-muted)] hover:text-rose-700 dark:hover:text-rose-400 rounded transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab 4: Akun & Kata Sandi */}
      {subTab === 'pengguna' && (
        <div className="space-y-6">
          {/* Ubah Kata Sandi Sendiri (Semua Peran) */}
          <form
            onSubmit={handleChangeOwnPassword}
            className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  Ubah Kata Sandi Saya
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Perbarui kata sandi untuk akun aktif{' '}
                  <span className="font-mono font-medium text-[var(--theme-text)]">
                    {currentUser.username}
                  </span>{' '}
                  ({currentUser.displayName}).
                </p>
              </div>
              <KeyRound className="w-5 h-5 text-[var(--theme-text-muted)] shrink-0" />
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Kata Sandi Saat Ini</span>
                <input
                  type="password"
                  required
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                  placeholder="Masukkan sandi saat ini"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Kata Sandi Baru</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newOwnPassword}
                  onChange={(e) => setNewOwnPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Konfirmasi Kata Sandi Baru</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmOwnPassword}
                  onChange={(e) => setConfirmOwnPassword(e.target.value)}
                  placeholder="Ulangi kata sandi baru"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
            </div>

            <div className="px-6 py-3.5 bg-[var(--theme-surface-subtle)] border-t border-[var(--theme-border)] flex justify-end">
              <button
                type="submit"
                disabled={savingOwnPassword}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                {savingOwnPassword ? 'Menyimpan...' : 'Perbarui Kata Sandi Saya'}
              </button>
            </div>
          </form>

          {/* Manajemen Akun Staf & Pimpinan (Admin TU Only) */}
          {isAdmin && (
            <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">
                    Manajemen Akun Staf & Pimpinan
                  </h2>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Tambahkan akun baru, perbarui kata sandi staf, nonaktifkan akses, atau hapus akun yang tidak lagi digunakan.
                  </p>
                </div>
                <ShieldCheck className="w-5 h-5 text-[var(--theme-text-muted)] shrink-0" />
              </div>

              <form
                onSubmit={handleCreateUser}
                className="p-5 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5"
              >
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Username (tanpa spasi)"
                  className="px-3 py-2 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Sandi (min 6 char)"
                  className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <input
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Nama Lengkap & Gelar"
                  className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <input
                  type="text"
                  required
                  value={newJabatan}
                  onChange={(e) => setNewJabatan(e.target.value)}
                  placeholder="Jabatan"
                  className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as StaffRole)}
                  className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                >
                  <option value="staf">Staf / Guru</option>
                  <option value="kepala_sekolah">Kepala Sekolah</option>
                  <option value="admin">Admin TU</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-3 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {creatingUser ? 'Membuat...' : 'Tambah Akun'}
                </button>
              </form>

              {loadingUsers ? (
                <div className="p-8 text-center text-xs text-[var(--theme-text-muted)]">
                  Memuat daftar akun pengguna...
                </div>
              ) : (
                <div className="divide-y divide-[var(--theme-border)]">
                  {users.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    const isEditingPassword = editingPasswordUserId === u.id;
                    const isConfirmingDelete = confirmDeleteUserId === u.id;
                    const isDeleting = deletingUserId === u.id;

                    return (
                      <div key={u.id} className="px-6 py-4 space-y-3">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-[var(--theme-text)]">
                                {u.displayName}
                              </span>
                              <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                              <span className="font-mono text-[var(--theme-text-secondary)]">{u.username}</span>
                              <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                              <span className="text-[var(--theme-text-secondary)]">{u.jabatan}</span>
                              {isSelf && (
                                <>
                                  <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                                  <span className="text-[var(--theme-accent-text)] font-medium">
                                    Akun Anda
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                              Peran:{' '}
                              {u.role === 'admin'
                                ? 'Admin Tata Usaha'
                                : u.role === 'kepala_sekolah'
                                  ? 'Kepala Sekolah'
                                  : 'Guru / Penerima Disposisi'}{' '}
                              · Status:{' '}
                              <span
                                className={
                                  u.isActive
                                    ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                    : 'text-rose-700 dark:text-rose-400 font-medium'
                                }
                              >
                                {u.isActive ? 'Aktif' : 'Nonaktif'}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteUserId(null);
                                if (isEditingPassword) {
                                  setEditingPasswordUserId(null);
                                  setResetPasswordValue('');
                                } else {
                                  setEditingPasswordUserId(u.id);
                                  setResetPasswordValue('');
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              Ubah Sandi
                            </button>

                            {!isSelf && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleUser(u)}
                                  className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                                >
                                  {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                                </button>

                                {isConfirmingDelete ? (
                                  <div className="flex items-center gap-1.5 pl-1">
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => handleDeleteUser(u)}
                                      className="px-3 py-1.5 text-xs font-medium bg-rose-700 text-white rounded-lg hover:bg-rose-800 disabled:opacity-50 whitespace-nowrap"
                                    >
                                      {isDeleting ? 'Menghapus...' : 'Ya, Hapus'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => setConfirmDeleteUserId(null)}
                                      className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                                    >
                                      Batal
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingPasswordUserId(null);
                                      setResetPasswordValue('');
                                      setConfirmDeleteUserId(u.id);
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1.5 whitespace-nowrap"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Hapus
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {isEditingPassword && (
                          <form
                            onSubmit={(e) => handleSaveUserPassword(e, u)}
                            className="p-3.5 bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)] rounded-lg flex flex-col sm:flex-row sm:items-center gap-2.5"
                          >
                            <span className="text-xs font-medium text-[var(--theme-text-secondary)] shrink-0">
                              Sandi baru untuk <span className="font-mono">{u.username}</span>:
                            </span>
                            <input
                              type="password"
                              required
                              minLength={6}
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              placeholder="Minimal 6 karakter"
                              className="flex-1 px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                            />
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="submit"
                                disabled={savingUserPassword}
                                className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 whitespace-nowrap"
                              >
                                {savingUserPassword ? 'Menyimpan...' : 'Simpan Sandi'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPasswordUserId(null);
                                  setResetPasswordValue('');
                                }}
                                className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                              >
                                Batal
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Tab 5: Log Aktivitas Pengguna (Admin Only) */}
      {isAdmin && subTab === 'aktivitas' && (
        <div className="space-y-5">
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">
                    Log Aktivitas Pengguna
                  </h2>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Melacak siapa yang membuat, mengedit, atau menghapus surat masuk dan surat keluar terakhir.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void loadActivities()}
                  disabled={loadingActivities}
                  className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingActivities ? 'animate-spin' : ''}`} />
                  Muat Ulang
                </button>
                <button
                  type="button"
                  onClick={exportActivitiesCsv}
                  disabled={filteredActivities.length === 0}
                  className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Unduh CSV
                </button>
              </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="px-6 py-3.5 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 min-w-0 max-w-md">
                <Search className="w-3.5 h-3.5 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  placeholder="Cari nama pengguna, nomor surat, atau perihal..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg">
                  {(
                    [
                      { id: 'ALL', label: 'Semua Aksi' },
                      { id: 'CREATE', label: 'Membuat' },
                      { id: 'UPDATE', label: 'Mengedit' },
                      { id: 'DELETE', label: 'Menghapus' },
                    ] as const
                  ).map((act) => (
                    <button
                      key={act.id}
                      type="button"
                      onClick={() => setActivityActionFilter(act.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        activityActionFilter === act.id
                          ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                      }`}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Filter jenis surat"
                  value={activityEntityFilter}
                  onChange={(e) =>
                    setActivityEntityFilter(e.target.value as 'ALL' | 'incoming' | 'outgoing')
                  }
                  className="px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                >
                  <option value="ALL">Semua Jenis Surat</option>
                  <option value="incoming">Surat Masuk</option>
                  <option value="outgoing">Surat Keluar</option>
                </select>
              </div>
            </div>

            {loadingActivities && activities.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--theme-text-muted)]">
                Memuat riwayat aktivitas pengguna...
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="p-10 text-center space-y-1">
                <p className="text-sm font-medium text-[var(--theme-text)]">
                  Belum ada catatan aktivitas yang sesuai.
                </p>
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Setiap pembuatan, pengeditan, maupun penghapusan surat masuk dan surat keluar akan otomatis tercatat pada tabel ini.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] text-xs font-semibold text-[var(--theme-text-muted)]">
                        <th className="py-3 px-4 whitespace-nowrap">Waktu</th>
                        <th className="py-3 px-4 whitespace-nowrap">Pengguna</th>
                        <th className="py-3 px-4 whitespace-nowrap">Aksi</th>
                        <th className="py-3 px-4 whitespace-nowrap">Surat &amp; Nomor</th>
                        <th className="py-3 px-4">Perihal &amp; Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--theme-border)] text-xs">
                      {filteredActivities.map((act) => (
                        <tr
                          key={act.id}
                          className="hover:bg-[var(--theme-surface-hover)] transition-colors align-top"
                        >
                          <td className="py-3 px-4 font-mono tabular-nums text-[var(--theme-text-muted)] whitespace-nowrap">
                            <div>{new Date(act.createdAt).toLocaleDateString('id-ID')}</div>
                            <div className="text-[11px]">
                              {new Date(act.createdAt).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-semibold text-[var(--theme-text)]">
                              {act.actorDisplayName}
                            </div>
                            <div className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                              {act.actorUsername ? `@${act.actorUsername} · ` : ''}
                              {roleLabel(act.actorRole)}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={actionTextClass(act.action)}>
                              {actionLabel(act.action)}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-medium text-[var(--theme-text-secondary)]">
                              {act.entityType === 'incoming' ? 'Surat Masuk' : 'Surat Keluar'}
                            </div>
                            <div className="font-mono tabular-nums text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                              {act.referenceNumber || act.entityId}
                            </div>
                          </td>
                          <td className="py-3 px-4 min-w-[240px]">
                            <div className="font-medium text-[var(--theme-text)] line-clamp-1">
                              {act.subject || '—'}
                            </div>
                            {act.details && (
                              <div className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                                {act.details}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-3 border-t border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--theme-text-muted)] font-mono tabular-nums">
                  <span>
                    Menampilkan {filteredActivities.length} dari {activities.length} catatan aktivitas
                  </span>
                  <span>Urutan: Terbaru di atas</span>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* Tab 6: Keamanan Berlapis, Notifikasi Pembobolan & Stabilitas Data (Admin Only) */}
      {isAdmin && subTab === 'keamanan' && (
        <div className="space-y-6">
          {/* Stabilitas Penyimpanan & Integritas Database */}
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">
                    Stabilitas Penyimpanan &amp; Integritas Data
                  </h2>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Database SQLite menggunakan mode WAL dengan sinkronisasi penuh ke disk agar selalu konsisten sesuai data terakhir.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleRunCheckpoint()}
                  disabled={runningCheckpoint}
                  className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${runningCheckpoint ? 'animate-spin' : ''}`} />
                  {runningCheckpoint ? 'Menyinkronkan...' : 'Checkpoint WAL ke Disk'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateSnapshot()}
                  disabled={creatingSnapshot}
                  className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  {creatingSnapshot ? 'Menyimpan...' : 'Buat Snapshot Sekarang'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadBackup()}
                  disabled={downloadingBackup}
                  className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  {downloadingBackup ? 'Menyiapkan...' : 'Unduh Cadangan JSON'}
                </button>
              </div>
            </div>

            {storageStatus ? (
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div className="p-3.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] space-y-1">
                  <div className="text-[var(--theme-text-muted)]">Mode Jurnal &amp; Sinkronisasi</div>
                  <div className="text-sm font-semibold font-mono text-[var(--theme-text)]">
                    {storageStatus.journalMode} / {storageStatus.synchronousMode}
                  </div>
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Integritas: {storageStatus.integrityStatus}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] space-y-1">
                  <div className="text-[var(--theme-text-muted)]">Ukuran Berkas Database</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-[var(--theme-text)]">
                    {formatBytes(storageStatus.dbSizeBytes)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[var(--theme-text-muted)]">
                    WAL tertunda: {formatBytes(storageStatus.walSizeBytes)}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] space-y-1">
                  <div className="text-[var(--theme-text-muted)]">Total Arsip &amp; Berkas Tersimpan</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-[var(--theme-text)]">
                    {storageStatus.incomingCount + storageStatus.outgoingCount} Surat · {storageStatus.uploadedFileCount} Berkas DB
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[var(--theme-text-muted)]">
                    {storageStatus.incomingCount} Masuk · {storageStatus.outgoingCount} Keluar · {formatBytes(storageStatus.uploadedFilesBytes)} unggahan
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] space-y-1">
                  <div className="text-[var(--theme-text-muted)]">Snapshot Otomatis Server</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-[var(--theme-text)]">
                    {storageStatus.autoBackupCount} Snapshot Tersimpan
                  </div>
                  <div className="text-[11px] text-[var(--theme-text-muted)]">
                    {storageStatus.lastAutoBackupAt
                      ? `Terakhir ${new Date(storageStatus.lastAutoBackupAt).toLocaleString('id-ID')}`
                      : `Checkpoint ${new Date(storageStatus.lastCheckpointAt).toLocaleTimeString('id-ID')}`}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-xs text-[var(--theme-text-muted)]">
                Memuat status penyimpanan database...
              </div>
            )}

            {/* Perlindungan Update Aplikasi & Pemulihan Data */}
            <div className="px-6 py-5 border-t border-[var(--theme-border)] space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                    Perlindungan Data Saat Update &amp; Pemulihan Cadangan
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Setiap pembaruan atau restart server otomatis menggabungkan jurnal WAL ke berkas database utama, tidak menimpa data yang sudah diinput, dan menyimpan snapshot pengaman di server.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    aria-label="Mode pemulihan data"
                    value={restoreMode}
                    onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'replace')}
                    className="px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/20"
                  >
                    <option value="merge">Mode Gabung (Pertahankan Data Terbaru)</option>
                    <option value="replace">Mode Ganti Penuh (Sesuai Cadangan)</option>
                  </select>

                  <label className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {restoringBackup ? 'Memulihkan...' : 'Pulihkan dari Berkas JSON'}
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={restoringBackup}
                      onChange={(e) => void handleRestoreFromFile(e)}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              {snapshots.length === 0 ? (
                <div className="p-4 rounded-lg border border-dashed border-[var(--theme-border)] text-xs text-[var(--theme-text-muted)]">
                  Belum ada snapshot otomatis tersimpan. Klik &ldquo;Buat Snapshot Sekarang&rdquo; untuk membuat titik pemulihan pertama.
                </div>
              ) : (
                <div className="border border-[var(--theme-border)] rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] text-[var(--theme-text-muted)]">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Waktu Snapshot</th>
                          <th className="px-4 py-2.5 font-medium">Keterangan</th>
                          <th className="px-4 py-2.5 font-medium">Isi Arsip</th>
                          <th className="px-4 py-2.5 font-medium">Ukuran</th>
                          <th className="px-4 py-2.5 font-medium text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--theme-border)]">
                        {snapshots.map((snap) => {
                          const isConfirming = confirmRestoreSnapshot === snap.fileName;
                          return (
                            <tr key={snap.fileName} className="hover:bg-[var(--theme-surface-subtle)]/70">
                              <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--theme-text)] whitespace-nowrap">
                                {new Date(snap.createdAt).toLocaleString('id-ID')}
                              </td>
                              <td className="px-4 py-2.5 text-[var(--theme-text-secondary)]">
                                <div className="font-medium text-[var(--theme-text)]">
                                  {snapshotReasonLabel(snap.reason)}
                                </div>
                                <div className="text-[11px] font-mono text-[var(--theme-text-muted)]">
                                  {snap.fileName}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--theme-text-muted)] whitespace-nowrap">
                                {snap.incomingCount} Masuk · {snap.outgoingCount} Keluar · {snap.regulationCount} Peraturan
                              </td>
                              <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--theme-text-muted)] whitespace-nowrap">
                                {formatBytes(snap.sizeBytes)}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                {isConfirming ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      disabled={restoringBackup}
                                      onClick={() => void handleRestoreSnapshot(snap.fileName)}
                                      className="px-2.5 py-1 text-[11px] font-medium bg-[var(--theme-accent)] text-white rounded hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 whitespace-nowrap"
                                    >
                                      {restoringBackup ? 'Memproses...' : 'Ya, Pulihkan'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={restoringBackup}
                                      onClick={() => setConfirmRestoreSnapshot(null)}
                                      className="px-2.5 py-1 text-[11px] font-medium border border-[var(--theme-border-strong)] rounded text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                                    >
                                      Batal
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={restoringBackup}
                                    onClick={() => setConfirmRestoreSnapshot(snap.fileName)}
                                    className="px-2.5 py-1 text-[11px] font-medium border border-[var(--theme-border-strong)] rounded text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 whitespace-nowrap"
                                  >
                                    Pulihkan
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--theme-text)]">
                    Lapis 1: Autentikasi &amp; Sesi SHA-256
                  </div>
                  <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                    Kata sandi di-hash dengan scrypt dan token sesi disimpan dalam hash SHA-256 dengan penguncian otomatis 5x gagal login.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--theme-text)]">
                    Lapis 2: WAF &amp; Validasi Magic-Byte
                  </div>
                  <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                    Deteksi injeksi SQL/XSS, traversal direktori, eskalasi hak akses, serta pemeriksaan tanda tangan biner berkas unggahan.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--theme-text)]">
                    Lapis 3: Transaksi Atomik &amp; Persistensi WAL
                  </div>
                  <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                    Penulisan transaksi IMMEDIATE langsung di-flush ke disk, di-snapshot otomatis saat startup/update, serta menjaga draf form lokal.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Notifikasi & Log Upaya Pembobolan */}
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">
                    Notifikasi Upaya Pembobolan &amp; Keamanan
                  </h2>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Setiap percobaan brute-force, injeksi, akses tanpa izin, atau unggahan mencurigakan langsung tercatat dan memicu peringatan ke Admin.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void loadSecurityData()}
                  disabled={loadingSecurity}
                  className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingSecurity ? 'animate-spin' : ''}`} />
                  Muat Ulang
                </button>
                {securityUnreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleMarkAllAlertsRead()}
                    className="px-3 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Tandai Semua Dibaca
                  </button>
                )}
                {securityAlerts.some((a) => a.isRead) && (
                  <button
                    type="button"
                    onClick={() => void handleClearReadAlerts()}
                    className="px-3 py-2 text-xs font-medium border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Bersihkan Ditinjau
                  </button>
                )}
              </div>
            </div>

            <div className="px-6 py-3 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg">
                {(
                  [
                    { id: 'all', label: `Semua (${securityAlerts.length})` },
                    { id: 'unread', label: `Belum Ditinjau (${securityUnreadCount})` },
                  ] as const
                ).map((flt) => (
                  <button
                    key={flt.id}
                    type="button"
                    onClick={() => setSecurityFilter(flt.id)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      securityFilter === flt.id
                        ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                        : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                    }`}
                  >
                    {flt.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[var(--theme-text-muted)]">
                Menampilkan {filteredSecurityAlerts.length} peringatan keamanan
              </span>
            </div>

            {loadingSecurity && securityAlerts.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--theme-text-muted)]">
                Memeriksa catatan peringatan keamanan...
              </div>
            ) : filteredSecurityAlerts.length === 0 ? (
              <div className="p-10 text-center space-y-1">
                <p className="text-sm font-medium text-[var(--theme-text)]">
                  {securityFilter === 'unread'
                    ? 'Tidak ada peringatan keamanan yang belum ditinjau.'
                    : 'Belum ada insiden atau percobaan pembobolan yang terdeteksi.'}
                </p>
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Sistem keamanan aktif memantau setiap permintaan API, proses login, dan unggahan berkas.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--theme-border)]">
                {filteredSecurityAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`px-6 py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4 ${
                      !alert.isRead ? 'bg-rose-50/40 dark:bg-rose-950/15' : ''
                    }`}
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={severityTextClass(alert.severity)}>
                          {severityLabel(alert.severity)}
                        </span>
                        <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                        <span className="font-medium text-[var(--theme-text-secondary)]">
                          {categoryLabel(alert.category)}
                        </span>
                        <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                        <span className="font-mono tabular-nums text-[var(--theme-text-muted)]">
                          IP {alert.ipAddress}
                        </span>
                        {alert.actorUsername && (
                          <>
                            <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                            <span className="font-mono text-[var(--theme-text-secondary)]">
                              @{alert.actorUsername}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                        <span className="font-mono tabular-nums text-[var(--theme-text-muted)]">
                          {new Date(alert.createdAt).toLocaleString('id-ID')}
                        </span>
                      </div>

                      <div className="text-sm font-semibold text-[var(--theme-text)]">
                        {alert.title}
                      </div>
                      <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed">
                        {alert.message}
                      </p>
                      <div className="text-[11px] font-mono text-[var(--theme-text-muted)]">
                        {alert.method} {alert.route}
                        {alert.isRead && alert.resolvedBy
                          ? ` · Ditinjau oleh ${alert.resolvedBy} (${new Date(alert.resolvedAt).toLocaleString('id-ID')})`
                          : ''}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {!alert.isRead ? (
                        <button
                          type="button"
                          onClick={() => void handleMarkAlertRead(alert.id)}
                          className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Tandai Ditinjau
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap">
                          Sudah Ditinjau
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab 7: Monitoring & Log Sistem (Admin Only) */}
      {isAdmin && subTab === 'monitoring' && (
        <div className="space-y-5">
          {/* Health Summary Strip */}
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">
                    Kesehatan Server & Database
                  </h2>
                  {health ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-secondary)] mt-1">
                      <span
                        className={
                          health.ok
                            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                            : 'text-rose-700 dark:text-rose-400 font-semibold'
                        }
                      >
                        {health.ok ? 'Operasional Normal' : 'Gangguan Terdeteksi'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{health.database}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Uptime {health.uptimeSeconds} detik
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--theme-text-muted)] mt-1">
                      Memeriksa status layanan...
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void loadMonitoring()}
                  disabled={loadingMonitoring}
                  className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingMonitoring ? 'animate-spin' : ''}`} />
                  Periksa Ulang
                </button>
                <button
                  type="button"
                  onClick={exportLogsJson}
                  disabled={filteredLogs.length === 0}
                  className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Unduh JSON
                </button>
                {isAdmin && logs.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearLogs}
                    className="px-3 py-2 text-xs font-medium border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Bersihkan Log
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Error Log Table */}
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                  Catatan Error & Peringatan Validasi
                </h3>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Menampilkan {filteredLogs.length} catatan terbaru dari SQLite error_logs
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg">
                {(
                  [
                    { id: 'all', label: 'Semua' },
                    { id: 'error', label: 'Error (5xx)' },
                    { id: 'warn', label: 'Peringatan (4xx)' },
                  ] as const
                ).map((lvl) => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setLogLevelFilter(lvl.id)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      logLevelFilter === lvl.id
                        ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                        : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="p-10 text-center space-y-1">
                <p className="text-sm font-medium text-[var(--theme-text)]">
                  Tidak ada catatan error pada kategori ini.
                </p>
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Setiap kegagalan API atau validasi server akan otomatis tercatat di sini serta di data/logs/error.log.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--theme-border)]">
                {filteredLogs.map((entry) => {
                  const isOpen = expandedStackId === entry.id;
                  return (
                    <div key={entry.id} className="px-6 py-3.5 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`font-mono font-semibold uppercase ${
                              entry.level === 'error'
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {entry.level}
                          </span>
                          <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                          <span className="font-mono text-[var(--theme-text)]">
                            {entry.method} {entry.route}
                          </span>
                          <span aria-hidden="true" className="text-[var(--theme-text-muted)]">·</span>
                          <span className="font-mono tabular-nums text-[var(--theme-text-muted)]">
                            {new Date(entry.createdAt).toLocaleString('id-ID')}
                          </span>
                        </div>
                        {entry.stack && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedStackId(isOpen ? null : entry.id)
                            }
                            className="text-xs text-[var(--theme-accent-text)] hover:underline shrink-0 text-left"
                          >
                            {isOpen ? 'Tutup Stack' : 'Lihat Detail Stack'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-[var(--theme-text-secondary)]">{entry.message}</p>
                      {isOpen && entry.stack && (
                        <pre className="text-[11px] font-mono bg-slate-950 text-slate-100 p-3 rounded-lg border border-[var(--theme-border)] overflow-x-auto">
                          {entry.stack}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab: Ekspor Database ke Google Spreadsheet (Admin Only) */}
      {isAdmin && subTab === 'spreadsheet' && (
        <SpreadsheetExportView
          schoolName={settings.schoolName}
          availableYears={availableYears}
          activeYear={activeYear}
          onNotify={onNotify}
        />
      )}

      {/* Tab: Ekspor Kode & Template Blogger (Admin Only) */}
      {isAdmin && subTab === 'blogger' && <BloggerExportView onNotify={onNotify} />}

      {/* Modal Preview & Validasi Skema Impor Kode Klasifikasi Excel (Admin Only) */}
      {isAdmin && parsedClassImport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="class-import-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="class-import-modal-title"
                    className="text-base font-semibold text-[var(--theme-text)]"
                  >
                    Validasi Skema &amp; Pratinjau Impor Excel Klasifikasi
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Berkas:{' '}
                    <span className="font-mono text-[var(--theme-text-secondary)]">
                      {importClassFileName}
                    </span>{' '}
                    · Dipindai:{' '}
                    <span className="font-semibold text-[var(--theme-text)]">
                      {parsedClassImport.totalRowsScanned}
                    </span>{' '}
                    baris · Valid:{' '}
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {parsedClassImport.items.length}
                    </span>
                    {parsedClassImport.validation.invalidCount > 0 && (
                      <>
                        {' '}
                        · Gagal:{' '}
                        <span className="font-semibold text-rose-700 dark:text-rose-400">
                          {parsedClassImport.validation.invalidCount}
                        </span>
                      </>
                    )}
                    {parsedClassImport.duplicateOverrides > 0 && (
                      <> · {parsedClassImport.duplicateOverrides} duplikat digabung</>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!importingClassifications) {
                    setParsedClassImport(null);
                    setImportClassFileName('');
                    setImportClassBase64('');
                    setImportClassIsXlsx(false);
                    setServerSchemaVerified(false);
                  }
                }}
                aria-label="Tutup pratinjau impor"
                className="p-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-lg hover:bg-[var(--theme-surface-hover)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Banner Hasil Validasi Skema */}
              {parsedClassImport.schemaValid && parsedClassImport.errors.length === 0 ? (
                <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30 text-xs text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        Validasi Skema Lolos — {parsedClassImport.items.length} kode siap disimpan ke database
                      </div>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        Seluruh kolom wajib dan format nilai tiap baris memenuhi skema klasifikasi tata naskah dinas.
                      </p>
                    </div>
                  </div>
                  {serverSchemaVerified && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/15 text-emerald-800 dark:text-emerald-200 font-medium text-[11px] shrink-0">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Terverifikasi Server
                    </span>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/80 dark:bg-rose-950/30 text-xs text-rose-900 dark:text-rose-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        Validasi Skema Gagal ({parsedClassImport.errors.length} ketidaksesuaian) — Penyimpanan Diblokir
                      </div>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        Perbaiki kolom atau baris yang bermasalah pada berkas Excel (.xlsx), lalu unggah ulang sebelum menyimpan ke database.
                      </p>
                    </div>
                  </div>
                  <ul className="list-disc pl-6 space-y-0.5 text-[11px]">
                    {parsedClassImport.errors.slice(0, 10).map((errItem, idx) => (
                      <li key={`${errItem.code}-${idx}`}>
                        <span className="font-mono font-semibold">
                          Baris {errItem.rowNumber} ({errItem.field})
                        </span>
                        : {errItem.message}
                      </li>
                    ))}
                  </ul>
                  {parsedClassImport.errors.length > 10 && (
                    <div className="text-[11px] pl-6 font-medium">
                      ...dan {parsedClassImport.errors.length - 10} kesalahan skema lainnya.
                    </div>
                  )}
                </div>
              )}

              {/* Kecocokan Kolom Header */}
              <div className="p-3.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] space-y-2">
                <div className="text-xs font-semibold text-[var(--theme-text)]">
                  Pemeriksaan Struktur Kolom Skema
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                    {parsedClassImport.validation.headerMatched.code ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="text-[var(--theme-text)]">
                      Kolom <strong className="font-mono">Kode</strong> (Wajib)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                    {parsedClassImport.validation.headerMatched.name ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="text-[var(--theme-text)]">
                      Kolom <strong className="font-mono">Nama Klasifikasi</strong> (Wajib)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                    {parsedClassImport.validation.headerMatched.description ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className="text-[var(--theme-text)]">
                      Kolom <strong className="font-mono">Keterangan</strong> (Opsional)
                    </span>
                  </div>
                </div>
                {parsedClassImport.validation.detectedHeaders.length > 0 && (
                  <div className="text-[11px] text-[var(--theme-text-muted)]">
                    Header terbaca di berkas:{' '}
                    <span className="font-mono text-[var(--theme-text-secondary)]">
                      {parsedClassImport.validation.detectedHeaders.join(' | ')}
                    </span>
                  </div>
                )}
              </div>

              {parsedClassImport.duplicateOverrides > 0 && (
                <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Ditemukan {parsedClassImport.duplicateOverrides} kode duplikat di dalam berkas; baris yang lebih bawah otomatis menggantikan baris sebelumnya.
                  </span>
                </div>
              )}

              {parsedClassImport.schemaValid && parsedClassImport.errors.length === 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[var(--theme-text)]">
                    Mode Penerapan ke Database
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setImportClassMode('merge')}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        importClassMode === 'merge'
                          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)]/50'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] hover:bg-[var(--theme-surface-hover)]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[var(--theme-text)]">
                        Gabung &amp; Perbarui (Direkomendasikan)
                      </div>
                      <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                        Menambahkan kode baru dan memperbarui kode yang sudah ada tanpa menghapus daftar lama.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportClassMode('replace')}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        importClassMode === 'replace'
                          ? 'border-rose-500 bg-rose-50/60 dark:bg-rose-950/30'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] hover:bg-[var(--theme-surface-hover)]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[var(--theme-text)]">
                        Ganti Semua Daftar Klasifikasi
                      </div>
                      <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                        Menghapus seluruh daftar lama lalu menggantinya hanya dengan {parsedClassImport.items.length} kode dari berkas ini.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {parsedClassImport.validation.rowPreviews.length > 0 && (
                <div className="border border-[var(--theme-border)] rounded-xl overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[var(--theme-surface-subtle)] text-[var(--theme-text-secondary)] sticky top-0 border-b border-[var(--theme-border)]">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold w-16">Baris</th>
                          <th className="px-3 py-2.5 font-semibold w-28">Kode</th>
                          <th className="px-3 py-2.5 font-semibold">Nama Klasifikasi</th>
                          <th className="px-3 py-2.5 font-semibold">Keterangan</th>
                          <th className="px-3 py-2.5 font-semibold w-44">Status Skema</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--theme-border)]">
                        {parsedClassImport.validation.rowPreviews.slice(0, 120).map((row) => (
                          <tr
                            key={`${row.rowNumber}-${row.code}`}
                            className={
                              row.status === 'invalid'
                                ? 'bg-rose-50/50 dark:bg-rose-950/20'
                                : 'hover:bg-[var(--theme-surface-hover)]'
                            }
                          >
                            <td className="px-3 py-2 font-mono tabular-nums text-[var(--theme-text-muted)]">
                              #{row.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold text-[var(--theme-text)] whitespace-nowrap">
                              {row.code}
                            </td>
                            <td className="px-3 py-2 font-medium text-[var(--theme-text-secondary)]">
                              {row.name}
                            </td>
                            <td className="px-3 py-2 text-[var(--theme-text-muted)]">
                              {row.description || '—'}
                            </td>
                            <td className="px-3 py-2">
                              {row.status === 'valid' && (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  Valid
                                </span>
                              )}
                              {row.status === 'duplicate' && (
                                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  Duplikat (Timpa)
                                </span>
                              )}
                              {row.status === 'invalid' && (
                                <span className="inline-flex items-start gap-1 text-rose-700 dark:text-rose-400 font-medium">
                                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>{row.errorMessage || 'Tidak sesuai skema'}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedClassImport.validation.rowPreviews.length > 120 && (
                    <div className="px-3.5 py-2 text-[11px] text-[var(--theme-text-muted)] bg-[var(--theme-surface-subtle)] border-t border-[var(--theme-border)]">
                      Menampilkan 120 dari {parsedClassImport.validation.rowPreviews.length} baris yang dipindai.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] flex flex-wrap items-center justify-between gap-2.5">
              <label className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                {validatingClassFile ? 'Memvalidasi...' : 'Unggah Ulang Berkas .xlsx'}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                  disabled={validatingClassFile || importingClassifications}
                  onChange={handleClassFileSelected}
                  className="sr-only"
                />
              </label>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={importingClassifications}
                  onClick={() => {
                    setParsedClassImport(null);
                    setImportClassFileName('');
                    setImportClassBase64('');
                    setImportClassIsXlsx(false);
                    setServerSchemaVerified(false);
                  }}
                  className="px-4 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={
                    importingClassifications ||
                    validatingClassFile ||
                    !parsedClassImport.schemaValid ||
                    parsedClassImport.errors.length > 0 ||
                    parsedClassImport.items.length === 0
                  }
                  onClick={() => void handleConfirmClassImport()}
                  className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  {importingClassifications
                    ? 'Menyimpan ke Database...'
                    : `Konfirmasi & Simpan (${parsedClassImport.items.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal Preview & Validasi Skema Impor Guru & Karyawan Excel (Admin Only) */}
      {isAdmin && parsedRecipientImport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recipient-import-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="recipient-import-modal-title"
                    className="text-base font-semibold text-[var(--theme-text)]"
                  >
                    Validasi Skema &amp; Pratinjau Impor Guru &amp; Karyawan Excel
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Berkas:{' '}
                    <span className="font-mono text-[var(--theme-text-secondary)]">
                      {importRecipientFileName}
                    </span>{' '}
                    · Dipindai:{' '}
                    <span className="font-semibold text-[var(--theme-text)]">
                      {parsedRecipientImport.totalRowsScanned}
                    </span>{' '}
                    baris · Valid:{' '}
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {parsedRecipientImport.items.length}
                    </span>
                    {parsedRecipientImport.validation.invalidCount > 0 && (
                      <>
                        {' '}
                        · Gagal:{' '}
                        <span className="font-semibold text-rose-700 dark:text-rose-400">
                          {parsedRecipientImport.validation.invalidCount}
                        </span>
                      </>
                    )}
                    {parsedRecipientImport.duplicateOverrides > 0 && (
                      <> · {parsedRecipientImport.duplicateOverrides} duplikat digabung</>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!importingRecipients) {
                    setParsedRecipientImport(null);
                    setImportRecipientFileName('');
                    setImportRecipientBase64('');
                    setImportRecipientIsXlsx(false);
                    setServerRecipientSchemaVerified(false);
                  }
                }}
                aria-label="Tutup pratinjau impor"
                className="p-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-lg hover:bg-[var(--theme-surface-hover)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {parsedRecipientImport.schemaValid && parsedRecipientImport.errors.length === 0 ? (
                <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30 text-xs text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        Validasi Skema Lolos — {parsedRecipientImport.items.length} guru &amp; karyawan siap disimpan ke database
                      </div>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        Seluruh kolom wajib (Nama Lengkap &amp; Kategori) dan format nilai tiap baris memenuhi skema direktori disposisi.
                      </p>
                    </div>
                  </div>
                  {serverRecipientSchemaVerified && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/15 text-emerald-800 dark:text-emerald-200 font-medium text-[11px] shrink-0">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Terverifikasi Server
                    </span>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/80 dark:bg-rose-950/30 text-xs text-rose-900 dark:text-rose-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        Validasi Skema Gagal ({parsedRecipientImport.errors.length} ketidaksesuaian) — Penyimpanan Diblokir
                      </div>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        Perbaiki kolom Nama Lengkap atau Kategori (Guru / Karyawan) yang bermasalah pada berkas Excel (.xlsx), lalu unggah ulang.
                      </p>
                    </div>
                  </div>
                  <ul className="list-disc pl-6 space-y-0.5 text-[11px]">
                    {parsedRecipientImport.errors.slice(0, 10).map((errItem, idx) => (
                      <li key={`${errItem.code}-${idx}`}>
                        <span className="font-mono font-semibold">
                          Baris {errItem.rowNumber} ({errItem.field})
                        </span>
                        : {errItem.message}
                      </li>
                    ))}
                  </ul>
                  {parsedRecipientImport.errors.length > 10 && (
                    <div className="text-[11px] pl-6 font-medium">
                      ...dan {parsedRecipientImport.errors.length - 10} kesalahan skema lainnya.
                    </div>
                  )}
                </div>
              )}

              <div className="p-3.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] space-y-2">
                <div className="text-xs font-semibold text-[var(--theme-text)]">
                  Pemeriksaan Struktur Kolom Skema
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                    {parsedRecipientImport.validation.headerMatched.name ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="text-[var(--theme-text)]">
                      Kolom <strong className="font-mono">Nama Lengkap</strong> (Wajib)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                    {parsedRecipientImport.validation.headerMatched.category ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="text-[var(--theme-text)]">
                      Kolom <strong className="font-mono">Kategori</strong> (Wajib: Guru / Karyawan)
                    </span>
                  </div>
                </div>
              </div>

              {parsedRecipientImport.duplicateOverrides > 0 && (
                <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Ditemukan {parsedRecipientImport.duplicateOverrides} nama duplikat di dalam berkas; baris yang lebih bawah otomatis menggantikan baris sebelumnya.
                  </span>
                </div>
              )}

              {parsedRecipientImport.schemaValid && parsedRecipientImport.errors.length === 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[var(--theme-text)]">
                    Mode Penerapan ke Database
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setImportRecipientMode('merge')}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        importRecipientMode === 'merge'
                          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)]/50'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] hover:bg-[var(--theme-surface-hover)]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[var(--theme-text)]">
                        Gabung &amp; Perbarui (Direkomendasikan)
                      </div>
                      <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                        Menambahkan guru/karyawan baru dan memperbarui yang sudah ada tanpa menghapus direktori lama.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportRecipientMode('replace')}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        importRecipientMode === 'replace'
                          ? 'border-rose-500 bg-rose-50/60 dark:bg-rose-950/30'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] hover:bg-[var(--theme-surface-hover)]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[var(--theme-text)]">
                        Ganti Semua Direktori Guru &amp; Karyawan
                      </div>
                      <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                        Menghapus seluruh daftar lama lalu menggantinya hanya dengan {parsedRecipientImport.items.length} guru/karyawan dari berkas ini.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {parsedRecipientImport.validation.rowPreviews.length > 0 && (
                <div className="border border-[var(--theme-border)] rounded-xl overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[var(--theme-surface-subtle)] text-[var(--theme-text-secondary)] sticky top-0 border-b border-[var(--theme-border)]">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold w-16">Baris</th>
                          <th className="px-3 py-2.5 font-semibold">Nama Lengkap &amp; Gelar</th>
                          <th className="px-3 py-2.5 font-semibold w-28">Kategori</th>
                          <th className="px-3 py-2.5 font-semibold w-36">NIP / NUPTK</th>
                          <th className="px-3 py-2.5 font-semibold">Unit / Jabatan</th>
                          <th className="px-3 py-2.5 font-semibold w-36">Status Skema</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--theme-border)]">
                        {parsedRecipientImport.validation.rowPreviews.slice(0, 120).map((row) => (
                          <tr
                            key={`${row.rowNumber}-${row.name}`}
                            className={
                              row.status === 'invalid'
                                ? 'bg-rose-50/50 dark:bg-rose-950/20'
                                : 'hover:bg-[var(--theme-surface-hover)]'
                            }
                          >
                            <td className="px-3 py-2 font-mono tabular-nums text-[var(--theme-text-muted)]">
                              #{row.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-medium text-[var(--theme-text)]">
                              {row.name}
                            </td>
                            <td className="px-3 py-2 font-semibold text-[var(--theme-accent-text)] whitespace-nowrap">
                              {row.category}
                            </td>
                            <td className="px-3 py-2 font-mono tabular-nums text-[var(--theme-text-muted)] whitespace-nowrap">
                              {row.nip || '—'}
                            </td>
                            <td className="px-3 py-2 text-[var(--theme-text-secondary)]">
                              {row.unit || '—'}
                            </td>
                            <td className="px-3 py-2">
                              {row.status === 'valid' && (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  Valid
                                </span>
                              )}
                              {row.status === 'duplicate' && (
                                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  Duplikat (Timpa)
                                </span>
                              )}
                              {row.status === 'invalid' && (
                                <span className="inline-flex items-start gap-1 text-rose-700 dark:text-rose-400 font-medium">
                                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>{row.errorMessage || 'Tidak sesuai skema'}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedRecipientImport.validation.rowPreviews.length > 120 && (
                    <div className="px-3.5 py-2 text-[11px] text-[var(--theme-text-muted)] bg-[var(--theme-surface-subtle)] border-t border-[var(--theme-border)]">
                      Menampilkan 120 dari {parsedRecipientImport.validation.rowPreviews.length} baris yang dipindai.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] flex flex-wrap items-center justify-between gap-2.5">
              <label className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                {validatingRecipientFile ? 'Memvalidasi...' : 'Unggah Ulang Berkas .xlsx'}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                  disabled={validatingRecipientFile || importingRecipients}
                  onChange={handleRecipientFileSelected}
                  className="sr-only"
                />
              </label>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={importingRecipients}
                  onClick={() => {
                    setParsedRecipientImport(null);
                    setImportRecipientFileName('');
                    setImportRecipientBase64('');
                    setImportRecipientIsXlsx(false);
                    setServerRecipientSchemaVerified(false);
                  }}
                  className="px-4 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={
                    importingRecipients ||
                    validatingRecipientFile ||
                    !parsedRecipientImport.schemaValid ||
                    parsedRecipientImport.errors.length > 0 ||
                    parsedRecipientImport.items.length === 0
                  }
                  onClick={() => void handleConfirmRecipientImport()}
                  className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  {importingRecipients
                    ? 'Menyimpan ke Database...'
                    : `Konfirmasi & Simpan (${parsedRecipientImport.items.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
