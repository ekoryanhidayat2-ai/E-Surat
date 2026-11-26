import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Bell,
  BookOpen,
  CalendarRange,
  Check,
  CheckCircle2,
  ClipboardList,
  FilePenLine,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Send,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  DEFAULT_LOGIN_PORTAL_COPY,
  DEFAULT_MENU_CONFIGS,
  normalizeMenuConfigs,
  type AppMenuKey,
  type AuthUser,
  type BootstrapData,
  type ClassificationCode,
  type DispositionRecipient,
  type DispositionStatus,
  type IncomingLetter,
  type IncomingStatus,
  type LetterUrgency,
  type OutgoingLetter,
  type OutgoingStatus,
  type PublicBranding,
  type RegulationCategory,
  type SchoolSettings,
  type SecurityAlertEntry,
  type StaffCategory,
} from './types.ts';
import { api } from './lib/api.ts';
import { getMonthDateRange } from './lib/reportUtils.ts';
import {
  applyThemeToDocument,
  getStoredThemeId,
  saveThemeId,
  type ThemeId,
} from './lib/themes.ts';
import {
  collectAvailableYears,
  dismissFiscalWarningYear,
  evaluateFiscalYearReadiness,
  getDismissedFiscalWarningYear,
  getStoredActiveYear,
  getStoredCustomYears,
  isValidWorkYear,
  saveActiveYear,
  saveStoredCustomYears,
  YEAR_MAX,
  YEAR_MIN,
  type ActiveYearSelection,
} from './lib/yearUtils.ts';
import { SchoolCrest } from './components/SchoolCrest.tsx';
import { LoginView } from './components/LoginView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { IncomingLettersView } from './components/IncomingLettersView.tsx';
import { OutgoingLettersView } from './components/OutgoingLettersView.tsx';
import { DispositionsView } from './components/DispositionsView.tsx';
import { RegulationsView } from './components/RegulationsView.tsx';
import { GuideView } from './components/GuideView.tsx';
import { SettingsView, type SettingsTab } from './components/SettingsView.tsx';
import { LetterFormModal, type LetterFormMode } from './components/LetterFormModal.tsx';
import { LetterDetailDrawer, type DetailTarget } from './components/LetterDetailDrawer.tsx';
import { PrintPreviewModal, type PrintDocumentTarget } from './components/PrintPreviewModal.tsx';
import { AiArchiveAssistantModal } from './components/AiArchiveAssistantModal.tsx';

type ActiveTab =
  | 'dashboard'
  | 'incoming'
  | 'outgoing'
  | 'dispositions'
  | 'regulations'
  | 'guide'
  | 'settings';

interface ToastMessage {
  id: string;
  text: string;
  tone: 'success' | 'error';
}

const DEFAULT_BRANDING: PublicBranding = {
  schoolName: 'SMP Negeri 2 Girimulyo',
  parentAgency: 'Dinas Pendidikan Pemuda dan Olahraga',
  districtGov: 'SMP Negeri 2 Girimulyo',
  address: 'Jetis, Pendoworejo, Kapanewon Girimulyo, Kab. Kulon Progo, DIY 55674',
  logoUrl: '',
  ...DEFAULT_LOGIN_PORTAL_COPY,
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [branding, setBranding] = useState<PublicBranding>(DEFAULT_BRANDING);

  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [formMode, setFormMode] = useState<LetterFormMode | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [printTarget, setPrintTarget] = useState<PrintDocumentTarget | null>(null);
  const [editingMenuKey, setEditingMenuKey] = useState<AppMenuKey | null>(null);
  const [menuDraftLabel, setMenuDraftLabel] = useState('');
  const [menuDraftTitle, setMenuDraftTitle] = useState('');
  const [menuDraftDesc, setMenuDraftDesc] = useState('');
  const [savingMenuEdit, setSavingMenuEdit] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [themeId, setThemeId] = useState<ThemeId>(() => getStoredThemeId());
  const [selectedYear, setSelectedYear] = useState<ActiveYearSelection>(() =>
    getStoredActiveYear()
  );
  const [customYears, setCustomYears] = useState<number[]>(() => getStoredCustomYears());
  const [customYearEditorOpen, setCustomYearEditorOpen] = useState(false);
  const [customYearInput, setCustomYearInput] = useState('');
  const [dismissedFiscalYear, setDismissedFiscalYear] = useState<number | null>(() =>
    getDismissedFiscalWarningYear()
  );
  const [initializingYear, setInitializingYear] = useState(false);

  // Notifikasi keamanan Admin
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlertEntry[]>([]);
  const [unreadSecurityCount, setUnreadSecurityCount] = useState(0);
  const [securityPopoverOpen, setSecurityPopoverOpen] = useState(false);
  const securityPopoverRef = useRef<HTMLDivElement>(null);
  const [presetIncomingFilter, setPresetIncomingFilter] = useState<{
    status: 'Semua' | IncomingStatus;
    nonce: number;
  } | null>(null);
  const [presetOutgoingFilter, setPresetOutgoingFilter] = useState<{
    classificationCode: string;
    nonce: number;
  } | null>(null);
  const [presetDispositionFilter, setPresetDispositionFilter] = useState<{
    status: 'Semua' | DispositionStatus;
    nonce: number;
  } | null>(null);
  const [requestedSettingsTab, setRequestedSettingsTab] = useState<{
    tab: SettingsTab;
    nonce: number;
  } | null>(null);
  const lastAlertIdRef = useRef<string | null>(null);

  const pushToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getBootstrap();
      setData(next);
      setBranding({
        schoolName: next.settings.schoolName,
        parentAgency: next.settings.parentAgency,
        districtGov: next.settings.districtGov,
        address: `${next.settings.address} ${next.settings.postalCode}`.trim(),
        logoUrl: next.settings.logoUrl,
        loginHeadline: next.settings.loginHeadline,
        loginDescription: next.settings.loginDescription,
        loginFormTitle: next.settings.loginFormTitle,
        loginFormSubtitle: next.settings.loginFormSubtitle,
      });
      if (next.settings.themeId) {
        const applied = applyThemeToDocument(next.settings.themeId as ThemeId);
        saveThemeId(applied.id);
        setThemeId(applied.id);
      }
      setLoadError('');
      setDetailTarget((prev) => {
        if (!prev) return null;
        if (prev.kind === 'incoming') {
          const updated = next.incoming.find((l) => l.id === prev.letter.id);
          return updated ? { kind: 'incoming', letter: updated } : null;
        }
        const updated = next.outgoing.find((l) => l.id === prev.letter.id);
        return updated ? { kind: 'outgoing', letter: updated } : null;
      });
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 401) {
        setCurrentUser(null);
        setData(null);
      } else {
        setLoadError(
          err instanceof Error ? err.message : 'Gagal memuat data persuratan dari server.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initSession = async () => {
      try {
        const b = await api.getPublicBranding();
        if (active) setBranding(b);
      } catch {
        // Gunakan branding default
      }

      try {
        const res = await api.getMe();
        if (active) {
          setCurrentUser(res.user);
        }
      } catch {
        if (active) {
          setCurrentUser(null);
        }
      } finally {
        if (active) setAuthChecked(true);
      }
    };
    void initSession();
    return () => {
      active = false;
    };
  }, []);

  const refreshSecurityAlerts = useCallback(
    async (notifyOnNew = false) => {
      if (!currentUser || currentUser.role !== 'admin') return;
      try {
        const res = await api.getSecurityAlerts(25);
        setSecurityAlerts(res.alerts);
        setUnreadSecurityCount(res.unreadCount);
        const newestUnread = res.alerts.find((a) => !a.isRead);
        if (newestUnread) {
          if (
            notifyOnNew &&
            lastAlertIdRef.current !== null &&
            newestUnread.id !== lastAlertIdRef.current
          ) {
            pushToast(`Peringatan Keamanan: ${newestUnread.title}`, 'error');
          }
          lastAlertIdRef.current = newestUnread.id;
        } else {
          lastAlertIdRef.current = '';
        }
      } catch {
        // Abaikan kegagalan polling latar belakang sementara
      }
    },
    [currentUser, pushToast]
  );

  useEffect(() => {
    if (currentUser) {
      void refreshData();
      if (currentUser.role === 'admin') {
        void refreshSecurityAlerts(false);
      } else {
        setSecurityAlerts([]);
        setUnreadSecurityCount(0);
      }
    }
  }, [currentUser, refreshData, refreshSecurityAlerts]);

  // Sinkronisasi data terbaru saat jendela kembali aktif + polling keamanan Admin setiap 15 detik
  useEffect(() => {
    if (!currentUser) return;

    const handleFocusSync = () => {
      void refreshData();
      if (currentUser.role === 'admin') {
        void refreshSecurityAlerts(true);
      }
    };

    window.addEventListener('focus', handleFocusSync);
    const pollTimer =
      currentUser.role === 'admin'
        ? window.setInterval(() => {
            void refreshSecurityAlerts(true);
          }, 15000)
        : null;

    return () => {
      window.removeEventListener('focus', handleFocusSync);
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [currentUser, refreshData, refreshSecurityAlerts]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMenuKey) setEditingMenuKey(null);
        else if (securityPopoverOpen) setSecurityPopoverOpen(false);
        else if (mobileMenuOpen) setMobileMenuOpen(false);
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (
        securityPopoverOpen &&
        securityPopoverRef.current &&
        !securityPopoverRef.current.contains(e.target as Node)
      ) {
        setSecurityPopoverOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [editingMenuKey, securityPopoverOpen, mobileMenuOpen]);

  const handleLoginSuccess = (user: AuthUser) => {
    lastAlertIdRef.current = null;
    setCurrentUser(user);
    setActiveTab('dashboard');
    pushToast(`Selamat datang, ${user.displayName}.`);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Tetap bersihkan sesi lokal meskipun permintaan logout ke server gagal
    } finally {
      setCurrentUser(null);
      setData(null);
      setSecurityAlerts([]);
      setUnreadSecurityCount(0);
      setSecurityPopoverOpen(false);
      setDetailTarget(null);
      setFormMode(null);
      setPrintTarget(null);
    }
  };

  const handleSelectTheme = useCallback(
    (nextThemeId: ThemeId) => {
      if (currentUser?.role !== 'admin') {
        pushToast('Pengaturan tampilan & tema hanya dapat diubah oleh Admin.', 'error');
        return;
      }
      const applied = applyThemeToDocument(nextThemeId);
      saveThemeId(applied.id);
      setThemeId(applied.id);
      pushToast(`Tema "${applied.name}" diterapkan.`);
      void api
        .updateSettings({ themeId: applied.id })
        .then((saved) => {
          setData((prev) => (prev ? { ...prev, settings: saved } : prev));
        })
        .catch(() => {
          // Abaikan error sementara bila koneksi sedang terganggu; tema lokal tetap aktif
        });
    },
    [currentUser?.role, pushToast]
  );

  const availableYears = useMemo(
    () =>
      collectAvailableYears({
        counters: data?.counters,
        incoming: data?.incoming,
        outgoing: data?.outgoing,
        regulations: data?.regulations,
        customYears,
        activeYear: selectedYear,
      }),
    [data, customYears, selectedYear]
  );

  const fiscalYearReadiness = useMemo(
    () => evaluateFiscalYearReadiness(data?.counters ?? []),
    [data?.counters]
  );

  const handleChangeYear = useCallback((next: ActiveYearSelection) => {
    setSelectedYear(next);
    saveActiveYear(next);
    if (typeof next === 'number' && isValidWorkYear(next)) {
      setCustomYears((prev) => {
        if (prev.includes(next)) return prev;
        const updated = [next, ...prev].sort((a, b) => b - a);
        saveStoredCustomYears(updated);
        return updated;
      });
    }
  }, []);

  const handleApplyCustomYear = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const parsed = Number(customYearInput.trim());
      if (!isValidWorkYear(parsed)) {
        pushToast(`Masukkan tahun antara ${YEAR_MIN} sampai ${YEAR_MAX}.`, 'error');
        return;
      }
      handleChangeYear(parsed);
      setCustomYearInput('');
      setCustomYearEditorOpen(false);
      pushToast(`Tahun agenda beralih ke ${parsed}.`);
    },
    [customYearInput, handleChangeYear, pushToast]
  );

  const handleQuietSyncSettings = useCallback(async (updated: Partial<SchoolSettings>) => {
    const saved = await api.updateSettings(updated);
    setData((prev) => (prev ? { ...prev, settings: saved } : prev));
    setBranding({
      schoolName: saved.schoolName,
      parentAgency: saved.parentAgency,
      districtGov: saved.districtGov,
      address: `${saved.address} ${saved.postalCode}`.trim(),
      logoUrl: saved.logoUrl,
      loginHeadline: saved.loginHeadline,
      loginDescription: saved.loginDescription,
      loginFormTitle: saved.loginFormTitle,
      loginFormSubtitle: saved.loginFormSubtitle,
    });
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[var(--theme-canvas)] flex items-center justify-center">
        <div className="text-xs font-medium text-[var(--theme-text-muted)]">
          Memeriksa sesi pengguna...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginView branding={branding} onLoginSuccess={handleLoginSuccess} />;
  }

  const role = currentUser.role;
  const operatorName = currentUser.displayName;

  const handleSaveIncoming = async (
    payload: {
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
      expectedUpdatedAt?: string;
    },
    editingId?: string
  ): Promise<IncomingLetter> => {
    let saved: IncomingLetter;
    if (editingId) {
      saved = await api.updateIncoming(editingId, payload);
      pushToast('Perubahan surat masuk berhasil disimpan.');
    } else {
      saved = await api.createIncoming(payload);
      pushToast(`Surat masuk dicatat dengan nomor agenda ${saved.agendaNumber}.`);
    }
    await refreshData();
    return saved;
  };

  const handleSaveOutgoing = async (
    payload: {
      classificationCode: string;
      letterDate: string;
      recipient: string;
      subject: string;
      drafterName: string;
      status: OutgoingStatus;
      isManualNumber: boolean;
      fullLetterNumber: string;
      attachmentUrl: string;
      attachmentName: string;
      bodyText: string;
      notes: string;
      createdBy: string;
      expectedUpdatedAt?: string;
    },
    editingId?: string
  ): Promise<OutgoingLetter> => {
    let saved: OutgoingLetter;
    if (editingId) {
      saved = await api.updateOutgoing(editingId, payload);
      pushToast('Perubahan surat keluar berhasil disimpan.');
    } else {
      saved = await api.createOutgoing(payload);
      pushToast(`Surat keluar diterbitkan dengan nomor ${saved.fullLetterNumber}.`);
    }
    await refreshData();
    return saved;
  };

  const handleUpdateIncomingStatus = async (id: string, status: IncomingStatus) => {
    try {
      await api.updateIncoming(id, { status });
      await refreshData();
      pushToast(`Status surat diperbarui menjadi "${status}".`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal memperbarui status.', 'error');
    }
  };

  const handleUpdateOutgoingStatus = async (id: string, status: OutgoingStatus) => {
    try {
      await api.updateOutgoing(id, { status });
      await refreshData();
      pushToast(`Status surat keluar diperbarui menjadi "${status}".`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal memperbarui status.', 'error');
    }
  };

  const handleAddDisposition = async (
    incomingId: string,
    payload: {
      targetUnit: string;
      targetStaffName: string;
      instruction: string;
      deadlineDate: string;
      createdBy: string;
    }
  ) => {
    await api.addDisposition(incomingId, payload);
    await refreshData();
    pushToast(`Disposisi diteruskan ke ${payload.targetUnit}.`);
  };

  const handleUpdateDisposition = async (
    incomingId: string,
    dispId: string,
    payload: { status: DispositionStatus; completionNote: string }
  ) => {
    try {
      await api.updateDisposition(incomingId, dispId, payload);
      await refreshData();
      pushToast('Progres disposisi berhasil diperbarui.');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal memperbarui disposisi.', 'error');
    }
  };

  const handleDeleteCurrentDetail = async () => {
    if (!detailTarget) return;
    if (detailTarget.kind === 'incoming') {
      await api.deleteIncoming(detailTarget.letter.id);
      pushToast('Arsip surat masuk telah dihapus.');
    } else {
      await api.deleteOutgoing(detailTarget.letter.id);
      pushToast('Arsip surat keluar telah dihapus.');
    }
    await refreshData();
  };

  const handleSaveSettings = async (updated: Partial<SchoolSettings>) => {
    try {
      await api.updateSettings(updated);
      await refreshData();
      pushToast('Profil dan pengaturan sekolah berhasil disimpan.');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.', 'error');
    }
  };

  const handleUpsertClassification = async (item: ClassificationCode) => {
    try {
      await api.upsertClassification(item);
      await refreshData();
      pushToast(`Kode klasifikasi ${item.code} berhasil disimpan.`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal menyimpan kode klasifikasi.', 'error');
    }
  };

  const handleDeleteClassification = async (code: string) => {
    try {
      await api.deleteClassification(code);
      await refreshData();
      pushToast(`Kode klasifikasi ${code} dihapus.`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal menghapus kode klasifikasi.', 'error');
    }
  };

  const handleCreateRecipient = async (payload: {
    name: string;
    nip?: string;
    category: StaffCategory;
    unit?: string;
  }): Promise<DispositionRecipient> => {
    const created = await api.createDispositionRecipient(payload);
    await refreshData();
    pushToast(`${created.category} "${created.name}" berhasil ditambahkan ke daftar penerima disposisi.`);
    return created;
  };

  const handleUpdateRecipient = async (
    id: string,
    payload: Partial<{
      name: string;
      nip: string;
      category: StaffCategory;
      unit: string;
      isActive: boolean;
    }>
  ) => {
    const updated = await api.updateDispositionRecipient(id, payload);
    await refreshData();
    pushToast(`Data ${updated.category} "${updated.name}" berhasil diperbarui.`);
  };

  const handleDeleteRecipient = async (id: string) => {
    try {
      await api.deleteDispositionRecipient(id);
      await refreshData();
      pushToast('Data penerima disposisi dihapus dari direktori.');
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Gagal menghapus data guru/karyawan.',
        'error'
      );
    }
  };

  const handleUpdateCounter = async (
    year: number,
    incomingLastSeq: number,
    outgoingLastSeq: number
  ) => {
    try {
      await api.updateCounter(year, incomingLastSeq, outgoingLastSeq);
      await refreshData();
      pushToast(`Penghitung nomor urut tahun ${year} diperbarui.`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal memperbarui penghitung.', 'error');
    }
  };

  const handleInitYearCounter = async (year: number, switchToYear = false) => {
    setInitializingYear(true);
    try {
      const result = await api.initCounter(year);
      dismissFiscalWarningYear(null);
      setDismissedFiscalYear(null);
      await refreshData();
      if (switchToYear) {
        handleChangeYear(year);
      }
      if (result.alreadyInitialized) {
        pushToast(
          `Penghitung nomor urut Tahun ${year} sudah tersedia (Masuk #${String(
            result.counter.incomingLastSeq
          ).padStart(3, '0')}, Keluar #${String(result.counter.outgoingLastSeq).padStart(3, '0')}).`
        );
      } else {
        pushToast(
          `Penghitung nomor urut Tahun ${year} otomatis diinisialisasi mulai #001${
            switchToYear ? ` dan ruang kerja beralih ke Tahun ${year}` : ''
          }.`
        );
      }
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : `Gagal menginisialisasi penghitung Tahun ${year}.`,
        'error'
      );
    } finally {
      setInitializingYear(false);
    }
  };

  const handleCreateRegulation = async (payload: {
    title: string;
    regulationNumber: string;
    year: number;
    category: RegulationCategory;
    issuingBody: string;
    summary: string;
    fileUrl: string;
    fileName: string;
    fileSizeBytes: number;
  }) => {
    await api.createRegulation(payload);
    await refreshData();
    pushToast('Referensi peraturan PDF berhasil disimpan.');
  };

  const handleUpdateRegulation = async (
    id: string,
    payload: {
      title: string;
      regulationNumber: string;
      year: number;
      category: RegulationCategory;
      issuingBody: string;
      summary: string;
      fileUrl: string;
      fileName: string;
      fileSizeBytes: number;
      expectedUpdatedAt?: string;
    }
  ) => {
    await api.updateRegulation(id, payload);
    await refreshData();
    pushToast('Perubahan referensi peraturan berhasil disimpan.');
  };

  const handleDeleteRegulation = async (id: string) => {
    try {
      await api.deleteRegulation(id);
      await refreshData();
      pushToast('Referensi peraturan berhasil dihapus.');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Gagal menghapus referensi peraturan.', 'error');
    }
  };

  const menuConfigs = normalizeMenuConfigs(data?.settings.menuConfigs);

  const openMenuEditor = (key: AppMenuKey) => {
    const current = menuConfigs[key] ?? DEFAULT_MENU_CONFIGS[key];
    setEditingMenuKey(key);
    setMenuDraftLabel(current.label);
    setMenuDraftTitle(current.title);
    setMenuDraftDesc(current.description);
  };

  const handleSaveSingleMenuConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMenuKey || !data) return;
    setSavingMenuEdit(true);
    try {
      const updatedConfigs = {
        ...menuConfigs,
        [editingMenuKey]: {
          label: menuDraftLabel.trim(),
          title: menuDraftTitle.trim(),
          description: menuDraftDesc.trim(),
        },
      };
      await api.updateSettings({ menuConfigs: updatedConfigs });
      await refreshData();
      setEditingMenuKey(null);
      pushToast('Keterangan menu berhasil diperbarui.');
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Gagal menyimpan keterangan menu.',
        'error'
      );
    } finally {
      setSavingMenuEdit(false);
    }
  };

  const tabMetadata: Record<ActiveTab, { title: string; breadcrumb: string; description: string }> = {
    dashboard: {
      title: menuConfigs.dashboard.title,
      breadcrumb: 'Beranda / Ringkasan',
      description: menuConfigs.dashboard.description,
    },
    incoming: {
      title: menuConfigs.incoming.title,
      breadcrumb: 'Persuratan / Surat Masuk',
      description: menuConfigs.incoming.description,
    },
    outgoing: {
      title: menuConfigs.outgoing.title,
      breadcrumb: 'Persuratan / Surat Keluar',
      description: menuConfigs.outgoing.description,
    },
    dispositions: {
      title: menuConfigs.dispositions.title,
      breadcrumb: 'Persuratan / Disposisi',
      description: menuConfigs.dispositions.description,
    },
    regulations: {
      title: (menuConfigs.regulations ?? DEFAULT_MENU_CONFIGS.regulations).title,
      breadcrumb: 'Referensi / Peraturan Persuratan',
      description: (menuConfigs.regulations ?? DEFAULT_MENU_CONFIGS.regulations).description,
    },
    guide: {
      title: (menuConfigs.guide ?? DEFAULT_MENU_CONFIGS.guide).title,
      breadcrumb: 'Bantuan / Panduan Penggunaan',
      description: (menuConfigs.guide ?? DEFAULT_MENU_CONFIGS.guide).description,
    },
    settings: {
      title:
        role === 'admin' || menuConfigs.settings.title !== DEFAULT_MENU_CONFIGS.settings.title
          ? menuConfigs.settings.title
          : 'Profil Sekolah & Kata Sandi',
      breadcrumb: role === 'admin' ? 'Administrasi / Pengaturan' : 'Pengaturan / Profil & Akun',
      description: menuConfigs.settings.description,
    },
  };

  type NavItem = {
    id: ActiveTab;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
    group: 'main' | 'system';
  };

  const yearFilteredIncomingCount = data
    ? typeof selectedYear === 'number'
      ? data.incoming.filter(
          (l) => (l.agendaYear || Number(l.receivedDate.slice(0, 4))) === selectedYear
        ).length
      : data.incoming.length
    : undefined;

  const yearFilteredOutgoingCount = data
    ? typeof selectedYear === 'number'
      ? data.outgoing.filter(
          (l) => (l.letterYear || Number(l.letterDate.slice(0, 4))) === selectedYear
        ).length
      : data.outgoing.length
    : undefined;

  const yearFilteredDispositionsCount = data
    ? (typeof selectedYear === 'number'
        ? data.incoming.filter(
            (l) => (l.agendaYear || Number(l.receivedDate.slice(0, 4))) === selectedYear
          )
        : data.incoming
      ).reduce(
        (acc, l) =>
          acc +
          (Array.isArray(l.dispositions) ? l.dispositions : []).filter(
            (d) => d.status !== 'Selesai'
          ).length,
        0
      )
    : undefined;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: menuConfigs.dashboard.label, icon: LayoutDashboard, group: 'main' },
    {
      id: 'incoming',
      label: menuConfigs.incoming.label,
      icon: Inbox,
      count: yearFilteredIncomingCount,
      group: 'main',
    },
    {
      id: 'outgoing',
      label: menuConfigs.outgoing.label,
      icon: Send,
      count: yearFilteredOutgoingCount,
      group: 'main',
    },
    {
      id: 'dispositions',
      label: menuConfigs.dispositions.label,
      icon: ClipboardList,
      count: yearFilteredDispositionsCount,
      group: 'main',
    },
    {
      id: 'regulations',
      label: (menuConfigs.regulations ?? DEFAULT_MENU_CONFIGS.regulations).label,
      icon: BookOpen,
      count: data?.regulations.length,
      group: 'system',
    },
    {
      id: 'guide',
      label: (menuConfigs.guide ?? DEFAULT_MENU_CONFIGS.guide).label,
      icon: HelpCircle,
      group: 'system',
    },
    { id: 'settings', label: menuConfigs.settings.label, icon: Settings, group: 'system' },
  ];

  const primaryCtaAction = () => {
    if (activeTab === 'outgoing') {
      setFormMode({ kind: 'outgoing' });
    } else {
      setFormMode({ kind: 'incoming' });
    }
  };

  const renderSidebarButton = (item: NavItem) => {
    const Icon = item.icon;
    const active = activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          setActiveTab(item.id);
          setMobileMenuOpen(false);
        }}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
          active
            ? 'bg-[var(--theme-accent)] text-white font-medium shadow-xs'
            : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]'
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </span>
        {typeof item.count === 'number' && (
          <span
            className={`text-xs font-mono tabular-nums shrink-0 ${
              active ? 'text-white/80' : 'text-[var(--theme-text-muted)]'
            }`}
          >
            {item.count}
          </span>
        )}
      </button>
    );
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-[var(--theme-border)] flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)] shrink-0">
          <SchoolCrest
            className="w-7 h-7"
            logoUrl={data?.settings.logoUrl ?? branding.logoUrl}
            alt={`Logo ${branding.schoolName}`}
          />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--theme-text)] truncate font-display">
            E-Surat Sekolah
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)] truncate">
            {data?.settings.schoolName ?? branding.schoolName}
          </div>
        </div>
      </div>

      {/* Global Active Year Switcher */}
      <div className="px-3.5 py-3 border-b border-[var(--theme-border)] bg-[var(--theme-surface-subtle)]/70 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--theme-text-muted)]">
            <CalendarRange className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
            Tahun Agenda
          </span>
          <button
            type="button"
            onClick={() => setCustomYearEditorOpen((v) => !v)}
            className="text-[11px] font-medium text-[var(--theme-accent-text)] hover:underline whitespace-nowrap"
          >
            {customYearEditorOpen ? 'Tutup' : '+ Pilih Tahun'}
          </button>
        </div>

        <select
          value={selectedYear === 'all' ? 'all' : String(selectedYear)}
          onChange={(e) =>
            handleChangeYear(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
          aria-label="Pilih tahun aktif aplikasi"
          className="w-full px-2.5 py-1.5 text-xs font-medium font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
        >
          <option value="all">Semua Tahun</option>
          {availableYears.map((yr) => (
            <option key={yr} value={String(yr)}>
              Tahun {yr}
            </option>
          ))}
        </select>

        {customYearEditorOpen && (
          <form onSubmit={handleApplyCustomYear} className="flex items-center gap-1.5">
            <input
              type="number"
              min={YEAR_MIN}
              max={YEAR_MAX}
              required
              value={customYearInput}
              onChange={(e) => setCustomYearInput(e.target.value)}
              placeholder={`Contoh: ${new Date().getFullYear() - 2}`}
              aria-label="Masukkan tahun agenda kustom"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] whitespace-nowrap shrink-0"
            >
              Pilih
            </button>
          </form>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-4 overflow-y-auto" aria-label="Navigasi utama">
        <div className="space-y-1">
          <div className="px-3.5 pb-1 text-[11px] font-medium text-[var(--theme-text-muted)]">
            Persuratan
          </div>
          {navItems.filter((i) => i.group === 'main').map(renderSidebarButton)}
        </div>

        <div className="pt-3 border-t border-[var(--theme-border)] space-y-1">
          <div className="px-3.5 pb-1 text-[11px] font-medium text-[var(--theme-text-muted)]">
            Referensi &amp; Sistem
          </div>
          {navItems.filter((i) => i.group === 'system').map(renderSidebarButton)}
        </div>
      </nav>

      {/* Signed-in user profile & Logout */}
      <div className="p-4 border-t border-[var(--theme-border)] space-y-3 bg-[var(--theme-surface-subtle)]">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--theme-text)] truncate">
            {currentUser.displayName}
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)] truncate mt-0.5">
            {currentUser.jabatan}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="w-full px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          Keluar Aplikasi
        </button>
      </div>
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[var(--theme-canvas)] text-[var(--theme-text)] flex transition-colors">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] no-print">
        <div className="sticky top-0 h-screen">{renderSidebarContent()}</div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            key="mobile-sidebar-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi utama"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs lg:hidden no-print"
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileMenuOpen(false);
            }}
          >
            <motion.aside
              key="mobile-sidebar-drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-64 h-full bg-[var(--theme-surface)] border-r border-[var(--theme-border)] shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Tutup menu"
                className="absolute right-3 top-3 p-1.5 rounded-md text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface-hover)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              {renderSidebarContent()}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: 3 zones clean */}
        <header className="bg-[var(--theme-surface)]/95 backdrop-blur-xs border-b border-[var(--theme-border)] px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka navigasi"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden p-2 -ml-2 rounded-md text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface-hover)] transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold text-[var(--theme-text)] whitespace-nowrap shrink-0 font-display">
              {tabMetadata[activeTab].title}
            </span>
          </div>

          <div className="hidden md:flex items-center text-xs text-[var(--theme-text-muted)] whitespace-nowrap shrink-0">
            <span>{tabMetadata[activeTab].breadcrumb}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            {role === 'admin' && (
              <div className="relative" ref={securityPopoverRef}>
                <button
                  type="button"
                  onClick={() => setSecurityPopoverOpen((prev) => !prev)}
                  aria-label="Notifikasi keamanan aplikasi"
                  aria-expanded={securityPopoverOpen}
                  aria-haspopup="true"
                  className={`px-3 py-2 text-xs font-medium border rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    unreadSecurityCount > 0
                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 hover:bg-rose-100/70 dark:hover:bg-rose-950/60'
                      : 'border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]'
                  }`}
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Keamanan</span>
                  {unreadSecurityCount > 0 && (
                    <span className="font-mono tabular-nums font-bold">
                      ({unreadSecurityCount})
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {securityPopoverOpen && (
                    <motion.div
                      key="security-alert-popover"
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      style={{ transformOrigin: 'top right' }}
                      className="absolute right-0 mt-2 w-80 sm:w-96 bg-[var(--theme-surface)] border border-[var(--theme-border-strong)] rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-[var(--theme-border)] flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-[var(--theme-text)]">
                            Notifikasi Keamanan Admin
                          </div>
                          <div className="text-[11px] text-[var(--theme-text-muted)]">
                            {unreadSecurityCount > 0
                              ? `${unreadSecurityCount} peringatan belum ditinjau`
                              : 'Tidak ada peringatan aktif'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSecurityPopoverOpen(false)}
                          aria-label="Tutup notifikasi"
                          className="p-1 rounded-md text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface-hover)] transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="max-h-72 overflow-y-auto divide-y divide-[var(--theme-border)]">
                        {securityAlerts.slice(0, 5).length === 0 ? (
                          <div className="p-5 text-center text-xs text-[var(--theme-text-muted)]">
                            Belum ada percobaan pembobolan yang terdeteksi.
                          </div>
                        ) : (
                          securityAlerts.slice(0, 5).map((item) => (
                            <div
                              key={item.id}
                              className={`px-4 py-3 space-y-1 text-xs ${
                                !item.isRead ? 'bg-rose-50/40 dark:bg-rose-950/15' : ''
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-[var(--theme-text)] truncate">
                                  {item.title}
                                </span>
                                <span className="text-[10px] font-mono tabular-nums text-[var(--theme-text-muted)] shrink-0">
                                  {new Date(item.createdAt).toLocaleTimeString('id-ID', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <p className="text-[11px] text-[var(--theme-text-secondary)] line-clamp-2">
                                {item.message}
                              </p>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="px-4 py-2.5 border-t border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] flex items-center justify-between gap-2">
                        {unreadSecurityCount > 0 ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.markAllSecurityAlertsRead();
                                await refreshSecurityAlerts(false);
                                pushToast('Semua notifikasi keamanan ditandai dibaca.');
                              } catch (err) {
                                pushToast(
                                  err instanceof Error
                                    ? err.message
                                    : 'Gagal menandai notifikasi keamanan.',
                                  'error'
                                );
                              }
                            }}
                            className="text-[11px] font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] inline-flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Tandai Dibaca
                          </button>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSecurityPopoverOpen(false);
                            setActiveTab('settings');
                            setRequestedSettingsTab({ tab: 'keamanan', nonce: Date.now() });
                          }}
                          className="text-xs font-semibold text-[var(--theme-accent-text)] hover:underline whitespace-nowrap"
                        >
                          Buka Pusat Keamanan &amp; Data
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {role !== 'staf' && (
              <button
                type="button"
                onClick={primaryCtaAction}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {activeTab === 'outgoing' ? 'Buat Surat Keluar' : 'Catat Surat'}
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto no-print">
          {loading && !data ? (
            <div className="space-y-4">
              <div className="h-24 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl animate-pulse"
                  />
                ))}
              </div>
              <div className="h-80 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl animate-pulse" />
            </div>
          ) : loadError || !data ? (
            <div className="border border-rose-200 dark:border-rose-800/70 bg-[var(--theme-surface)] rounded-xl p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                Gagal terhubung ke server persuratan
              </p>
              <p className="text-xs text-[var(--theme-text-secondary)]">{loadError}</p>
              <button
                type="button"
                onClick={() => void refreshData()}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg"
              >
                Muat Ulang Data
              </button>
            </div>
          ) : (
            <>
              {role === 'admin' && unreadSecurityCount > 0 && (
                <div className="mb-4 px-4 py-3 rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/35 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <ShieldAlert className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-rose-900 dark:text-rose-200">
                        Peringatan Keamanan: {unreadSecurityCount} indikasi percobaan akses atau pembobolan belum ditinjau
                      </div>
                      {securityAlerts.find((a) => !a.isRead) && (
                        <p className="text-xs text-rose-800/90 dark:text-rose-300 mt-0.5 truncate">
                          Terbaru: {securityAlerts.find((a) => !a.isRead)?.title} —{' '}
                          {securityAlerts.find((a) => !a.isRead)?.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('settings');
                        setRequestedSettingsTab({ tab: 'keamanan', nonce: Date.now() });
                      }}
                      className="px-3 py-1.5 text-xs font-medium bg-rose-700 text-white rounded-lg hover:bg-rose-800 whitespace-nowrap"
                    >
                      Tinjau Keamanan
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.markAllSecurityAlertsRead();
                          await refreshSecurityAlerts(false);
                          pushToast('Peringatan keamanan ditandai sudah dibaca.');
                        } catch (err) {
                          pushToast(
                            err instanceof Error
                              ? err.message
                              : 'Gagal menandai peringatan keamanan.',
                            'error'
                          );
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-medium border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 rounded-lg hover:bg-rose-100/70 dark:hover:bg-rose-900/40 whitespace-nowrap"
                    >
                      Tandai Dibaca
                    </button>
                  </div>
                </div>
              )}

              {fiscalYearReadiness.shouldNotify &&
                dismissedFiscalYear !== fiscalYearReadiness.targetYear && (
                  <div
                    role="status"
                    className="mb-4 px-4 py-3.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/80 dark:bg-amber-950/30 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <CalendarRange className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-semibold text-amber-950 dark:text-amber-100 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>
                            {fiscalYearReadiness.reason === 'current_uninitialized'
                              ? `Penghitung Tahun Anggaran ${fiscalYearReadiness.targetYear} Belum Diinisialisasi`
                              : `Persiapan Tahun Anggaran Baru ${fiscalYearReadiness.targetYear}`}
                          </span>
                          {fiscalYearReadiness.reason === 'upcoming_uninitialized' && (
                            <span className="font-mono tabular-nums text-[11px] font-bold text-amber-800 dark:text-amber-300">
                              · H-{fiscalYearReadiness.daysUntilNewYear} menuju 1 Januari{' '}
                              {fiscalYearReadiness.targetYear}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
                          {fiscalYearReadiness.reason === 'current_uninitialized'
                            ? `Penghitung nomor urut surat masuk dan surat keluar Tahun ${fiscalYearReadiness.targetYear} belum terdaftar. Inisialisasi sekarang agar penomoran agenda dimulai rapi dari #001.`
                            : `Penghitung nomor urut surat masuk dan surat keluar untuk Tahun ${fiscalYearReadiness.targetYear} belum disiapkan. Inisialisasi otomatis sekarang untuk memulai #001 pada tahun baru tanpa mengganggu arsip Tahun ${fiscalYearReadiness.currentYear}.`}
                          {data.settings.autoInitNewYearCounter &&
                            fiscalYearReadiness.reason === 'upcoming_uninitialized' && (
                              <span className="block text-[11px] text-amber-800/85 dark:text-amber-300/85 mt-0.5">
                                Mode inisialisasi otomatis tanggal 1 Januari aktif — Anda juga dapat menyiapkannya lebih awal sekarang.
                              </span>
                            )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {role === 'admin' ? (
                        <>
                          <button
                            type="button"
                            disabled={initializingYear}
                            onClick={() =>
                              void handleInitYearCounter(fiscalYearReadiness.targetYear, false)
                            }
                            className="px-3.5 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 whitespace-nowrap"
                          >
                            {initializingYear
                              ? 'Memproses...'
                              : `Inisialisasi Otomatis Tahun ${fiscalYearReadiness.targetYear}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab('settings');
                              setRequestedSettingsTab({ tab: 'klasifikasi', nonce: Date.now() });
                            }}
                            className="px-3 py-1.5 text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 rounded-lg hover:bg-amber-100/70 dark:hover:bg-amber-900/40 whitespace-nowrap"
                          >
                            Pengaturan Tahun
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              dismissFiscalWarningYear(fiscalYearReadiness.targetYear);
                              setDismissedFiscalYear(fiscalYearReadiness.targetYear);
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:underline whitespace-nowrap"
                          >
                            Ingatkan Nanti
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] text-amber-800 dark:text-amber-300 whitespace-nowrap">
                            Hubungi Admin TU untuk inisialisasi awal
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              dismissFiscalWarningYear(fiscalYearReadiness.targetYear);
                              setDismissedFiscalYear(fiscalYearReadiness.targetYear);
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 rounded-lg hover:bg-amber-100/70 dark:hover:bg-amber-900/40 whitespace-nowrap"
                          >
                            Tutup Sementara
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

              {activeTab !== 'dashboard' && (tabMetadata[activeTab].description || role === 'admin') && (
                <div className="mb-4 px-4 py-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
                  <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed">
                    {tabMetadata[activeTab].description || 'Belum ada keterangan untuk menu ini.'}
                  </p>
                  {role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => openMenuEditor(activeTab as AppMenuKey)}
                      className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-center"
                    >
                      <FilePenLine className="w-3.5 h-3.5" />
                      Edit Keterangan Menu
                    </button>
                  )}
                </div>
              )}

              {activeTab === 'dashboard' && (
                <DashboardView
                  currentUser={currentUser}
                  incoming={data.incoming}
                  outgoing={data.outgoing}
                  classifications={data.classifications}
                  selectedYear={selectedYear}
                  availableYears={availableYears}
                  onChangeYear={handleChangeYear}
                  menuDescription={menuConfigs.dashboard.description}
                  canEditMenuDescription={role === 'admin'}
                  onEditMenuDescription={() => openMenuEditor('dashboard')}
                  onSelectIncoming={(letter) =>
                    setDetailTarget({ kind: 'incoming', letter })
                  }
                  onSelectOutgoing={(letter) =>
                    setDetailTarget({ kind: 'outgoing', letter })
                  }
                  onNavigate={(tab, preset) => {
                    const nonce = Date.now();
                    if (tab === 'incoming' && preset?.incomingStatus) {
                      setPresetIncomingFilter({ status: preset.incomingStatus, nonce });
                    }
                    if (tab === 'outgoing' && preset?.outgoingClass) {
                      setPresetOutgoingFilter({ classificationCode: preset.outgoingClass, nonce });
                    }
                    if (tab === 'dispositions' && preset?.dispositionStatus) {
                      setPresetDispositionFilter({ status: preset.dispositionStatus, nonce });
                    }
                    setActiveTab(tab);
                  }}
                  onOpenNewLetter={(kind) => setFormMode({ kind })}
                  onOpenGuide={() => setActiveTab('guide')}
                  onOpenAiAssistant={() => setAiAssistantOpen(true)}
                  onOpenMonthlyReport={() => {
                    const initialRange =
                      typeof selectedYear === 'number'
                        ? getMonthDateRange(selectedYear, new Date().getMonth() + 1)
                        : undefined;
                    setPrintTarget({
                      kind: 'monthly_report',
                      incomingLetters: data.incoming,
                      outgoingLetters: data.outgoing,
                      initialStartDate: initialRange?.startDate,
                      initialEndDate: initialRange?.endDate,
                    });
                  }}
                />
              )}

              {activeTab === 'incoming' && (
                <IncomingLettersView
                  letters={data.incoming}
                  classifications={data.classifications}
                  settings={data.settings}
                  role={role}
                  selectedYear={selectedYear}
                  availableYears={availableYears}
                  onChangeYear={handleChangeYear}
                  presetFilter={presetIncomingFilter}
                  onSelectLetter={(letter) =>
                    setDetailTarget({ kind: 'incoming', letter })
                  }
                  onPreviewLetter={(letter) =>
                    setPrintTarget({ kind: 'incoming_letter', letter })
                  }
                  onEditLetter={(letter) =>
                    setFormMode({ kind: 'incoming', editing: letter })
                  }
                  onOpenNew={() => setFormMode({ kind: 'incoming' })}
                  onPrintAgenda={(letters, periodLabel) =>
                    setPrintTarget({
                      kind: 'incoming_agenda',
                      letters,
                      periodLabel,
                    })
                  }
                  onOpenMonthlyReport={() => {
                    const initialRange =
                      typeof selectedYear === 'number'
                        ? getMonthDateRange(selectedYear, new Date().getMonth() + 1)
                        : undefined;
                    setPrintTarget({
                      kind: 'monthly_report',
                      incomingLetters: data.incoming,
                      outgoingLetters: data.outgoing,
                      initialStartDate: initialRange?.startDate,
                      initialEndDate: initialRange?.endDate,
                    });
                  }}
                  onNotify={pushToast}
                />
              )}

              {activeTab === 'outgoing' && (
                <OutgoingLettersView
                  letters={data.outgoing}
                  classifications={data.classifications}
                  settings={data.settings}
                  role={role}
                  selectedYear={selectedYear}
                  availableYears={availableYears}
                  onChangeYear={handleChangeYear}
                  presetFilter={presetOutgoingFilter}
                  onSelectLetter={(letter) =>
                    setDetailTarget({ kind: 'outgoing', letter })
                  }
                  onPreviewLetter={(letter) =>
                    setPrintTarget({ kind: 'outgoing_letter', letter })
                  }
                  onEditLetter={(letter) =>
                    setFormMode({ kind: 'outgoing', editing: letter })
                  }
                  onOpenNew={() => setFormMode({ kind: 'outgoing' })}
                  onPrintAgenda={(letters, periodLabel) =>
                    setPrintTarget({
                      kind: 'outgoing_agenda',
                      letters,
                      periodLabel,
                    })
                  }
                  onOpenMonthlyReport={() => {
                    const initialRange =
                      typeof selectedYear === 'number'
                        ? getMonthDateRange(selectedYear, new Date().getMonth() + 1)
                        : undefined;
                    setPrintTarget({
                      kind: 'monthly_report',
                      incomingLetters: data.incoming,
                      outgoingLetters: data.outgoing,
                      initialStartDate: initialRange?.startDate,
                      initialEndDate: initialRange?.endDate,
                    });
                  }}
                  onNotify={pushToast}
                />
              )}

              {activeTab === 'dispositions' && (
                <DispositionsView
                  incomingLetters={data.incoming}
                  dispositionRecipients={data.dispositionRecipients ?? []}
                  selectedYear={selectedYear}
                  availableYears={availableYears}
                  onChangeYear={handleChangeYear}
                  presetFilter={presetDispositionFilter}
                  onSelectIncoming={(letter) =>
                    setDetailTarget({ kind: 'incoming', letter })
                  }
                  onUpdateDisposition={handleUpdateDisposition}
                />
              )}

              {activeTab === 'regulations' && (
                <RegulationsView
                  regulations={data.regulations}
                  role={role}
                  onCreateRegulation={handleCreateRegulation}
                  onUpdateRegulation={handleUpdateRegulation}
                  onDeleteRegulation={handleDeleteRegulation}
                />
              )}

              {activeTab === 'guide' && (
                <GuideView
                  settings={data.settings}
                  classifications={data.classifications}
                  dispositionRecipients={data.dispositionRecipients ?? []}
                  counters={data.counters}
                  activeYear={selectedYear}
                  activeThemeId={themeId}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  currentUser={currentUser}
                  settings={data.settings}
                  classifications={data.classifications}
                  dispositionRecipients={data.dispositionRecipients ?? []}
                  counters={data.counters}
                  activeYear={typeof selectedYear === 'number' ? selectedYear : undefined}
                  availableYears={availableYears}
                  activeThemeId={themeId}
                  unreadSecurityAlerts={unreadSecurityCount}
                  requestedTab={requestedSettingsTab}
                  onSecurityAlertsUpdated={() => void refreshSecurityAlerts(false)}
                  onDataRestored={() => refreshData()}
                  onSelectTheme={handleSelectTheme}
                  onSaveSettings={handleSaveSettings}
                  onQuietSyncSettings={handleQuietSyncSettings}
                  onUpsertClassification={handleUpsertClassification}
                  onDeleteClassification={handleDeleteClassification}
                  onCreateRecipient={handleCreateRecipient}
                  onUpdateRecipient={handleUpdateRecipient}
                  onDeleteRecipient={handleDeleteRecipient}
                  onUpdateCounter={handleUpdateCounter}
                  onInitCounter={handleInitYearCounter}
                  onNotify={pushToast}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Modals & Drawers */}
      {formMode && data && (
        <LetterFormModal
          mode={formMode}
          classifications={data.classifications}
          settings={data.settings}
          counters={data.counters}
          activeYear={typeof selectedYear === 'number' ? selectedYear : undefined}
          availableYears={availableYears}
          operatorLabel={operatorName}
          onClose={() => setFormMode(null)}
          onSaveIncoming={handleSaveIncoming}
          onSaveOutgoing={handleSaveOutgoing}
          onOpenPreviewAfterSave={(saved) => {
            if (saved.kind === 'incoming') {
              setPrintTarget({ kind: 'incoming_letter', letter: saved.letter });
            } else {
              setPrintTarget({ kind: 'outgoing_letter', letter: saved.letter });
            }
          }}
        />
      )}

      {detailTarget && data && (
        <LetterDetailDrawer
          target={detailTarget}
          settings={data.settings}
          dispositionRecipients={data.dispositionRecipients ?? []}
          role={role}
          operatorLabel={operatorName}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            if (detailTarget.kind === 'incoming') {
              setFormMode({ kind: 'incoming', editing: detailTarget.letter });
            } else {
              setFormMode({ kind: 'outgoing', editing: detailTarget.letter });
            }
          }}
          onDelete={handleDeleteCurrentDetail}
          onUpdateIncomingStatus={handleUpdateIncomingStatus}
          onUpdateOutgoingStatus={handleUpdateOutgoingStatus}
          onAddDisposition={handleAddDisposition}
          onUpdateDisposition={handleUpdateDisposition}
          onCreateRecipient={handleCreateRecipient}
          onPrintDisposition={(letter) =>
            setPrintTarget({ kind: 'disposition', letter })
          }
          onPreviewLetter={(preview) => {
            if (preview.kind === 'incoming') {
              setPrintTarget({ kind: 'incoming_letter', letter: preview.letter });
            } else {
              setPrintTarget({ kind: 'outgoing_letter', letter: preview.letter });
            }
          }}
        />
      )}

      {printTarget && data && (
        <PrintPreviewModal
          target={printTarget}
          settings={data.settings}
          canEdit={role !== 'staf'}
          isAdmin={role === 'admin'}
          onEditLetter={(editTarget) => {
            if (editTarget.kind === 'incoming') {
              setFormMode({ kind: 'incoming', editing: editTarget.letter });
            } else {
              setFormMode({ kind: 'outgoing', editing: editTarget.letter });
            }
          }}
          onNotify={pushToast}
          onClose={() => setPrintTarget(null)}
        />
      )}

      {aiAssistantOpen && data && (
        <AiArchiveAssistantModal
          incoming={data.incoming}
          outgoing={data.outgoing}
          onClose={() => setAiAssistantOpen(false)}
          onSelectIncoming={(letter) => setDetailTarget({ kind: 'incoming', letter })}
          onSelectOutgoing={(letter) => setDetailTarget({ kind: 'outgoing', letter })}
        />
      )}

      {editingMenuKey && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingMenuKey(null);
          }}
        >
          <form
            onSubmit={handleSaveSingleMenuConfig}
            className="w-full max-w-lg bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-[var(--theme-border)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--theme-text)]">
                  Edit Keterangan Menu
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Perubahan nama, judul halaman, dan keterangan berlaku untuk semua pengguna.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMenuKey(null)}
                aria-label="Tutup editor keterangan menu"
                className="p-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Nama Menu (Bilah Samping)
                </span>
                <input
                  type="text"
                  required
                  maxLength={40}
                  value={menuDraftLabel}
                  onChange={(e) => setMenuDraftLabel(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Judul Halaman Menu
                </span>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={menuDraftTitle}
                  onChange={(e) => setMenuDraftTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Keterangan / Deskripsi Menu
                </span>
                <textarea
                  rows={3}
                  maxLength={300}
                  value={menuDraftDesc}
                  onChange={(e) => setMenuDraftDesc(e.target.value)}
                  placeholder="Tuliskan keterangan menu yang ditampilkan pada halaman..."
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
            </div>

            <div className="px-5 py-3.5 bg-[var(--theme-surface-subtle)] border-t border-[var(--theme-border)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMenuKey(null)}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingMenuEdit}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
              >
                {savingMenuEdit ? 'Menyimpan...' : 'Simpan Keterangan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm no-print" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-3 rounded-lg border text-xs font-medium shadow-md flex items-center justify-between gap-2.5 ${
                toast.tone === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950/90 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100'
                  : 'bg-[var(--theme-accent)] border-[var(--theme-accent-hover)] text-white'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {toast.tone === 'error' ? (
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-700 dark:text-rose-300" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>{toast.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                aria-label="Tutup notifikasi"
                className={`p-0.5 rounded shrink-0 ${
                  toast.tone === 'error'
                    ? 'text-rose-700 dark:text-rose-300 hover:bg-rose-200/50 dark:hover:bg-rose-900/50'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    </MotionConfig>
  );
}
