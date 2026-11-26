import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  LogOut,
  RefreshCw,
  Search,
  UploadCloud,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  clearGoogleSheetsAccessToken,
  exportDatabaseToGoogleSpreadsheet,
  getGoogleSheetsAccessToken,
  GoogleSheetsAuthError,
  googleSignInForSheets,
  googleSignOutForSheets,
  initGoogleSheetsAuth,
  inspectExistingSpreadsheet,
  type ExistingSpreadsheetInfo,
  type SpreadsheetExportResult,
} from '../lib/googleSheets.ts';
import {
  buildSpreadsheetWorksheets,
  extractSpreadsheetId,
  SPREADSHEET_SECTION_DEFINITIONS,
  type SpreadsheetSectionKey,
} from '../lib/spreadsheetBuilder.ts';
import type { SpreadsheetExportDataset } from '../types.ts';

interface SpreadsheetExportViewProps {
  schoolName: string;
  availableYears: number[];
  activeYear?: number;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export function SpreadsheetExportView({
  schoolName,
  availableYears,
  activeYear,
  onNotify,
}: SpreadsheetExportViewProps) {
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getGoogleSheetsAccessToken());
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [dataset, setDataset] = useState<SpreadsheetExportDataset | null>(null);
  const [loadingDataset, setLoadingDataset] = useState(true);

  const [exportMode, setExportMode] = useState<'create' | 'update'>('create');
  const [spreadsheetTitle, setSpreadsheetTitle] = useState(
    () => `Database E-Surat ${schoolName} (${new Date().toISOString().slice(0, 10)})`
  );
  const [existingSpreadsheetInput, setExistingSpreadsheetInput] = useState('');
  const [inspectingTarget, setInspectingTarget] = useState(false);
  const [inspectedTarget, setInspectedTarget] = useState<ExistingSpreadsheetInfo | null>(null);

  const [yearFilter, setYearFilter] = useState<'all' | number>(() =>
    typeof activeYear === 'number' ? activeYear : 'all'
  );
  const [selectedSections, setSelectedSections] = useState<SpreadsheetSectionKey[]>(() =>
    SPREADSHEET_SECTION_DEFINITIONS.map((d) => d.key)
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastResult, setLastResult] = useState<SpreadsheetExportResult | null>(null);

  useEffect(() => {
    const unsubscribe = initGoogleSheetsAuth(
      (user) => {
        setGoogleUser(user);
        setNeedsAuth(false);
      },
      (user) => {
        setGoogleUser(user);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const loadDatabaseSnapshot = useCallback(async () => {
    setLoadingDataset(true);
    try {
      const res = await api.getSpreadsheetExportData();
      setDataset(res);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memuat data database untuk ekspor.',
        'error'
      );
    } finally {
      setLoadingDataset(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadDatabaseSnapshot();
  }, [loadDatabaseSnapshot]);

  const worksheets = useMemo(() => {
    if (!dataset) return [];
    return buildSpreadsheetWorksheets(dataset, {
      selectedKeys: selectedSections,
      yearFilter,
    });
  }, [dataset, selectedSections, yearFilter]);

  const allSectionPreviews = useMemo(() => {
    if (!dataset) return [];
    return buildSpreadsheetWorksheets(dataset, {
      selectedKeys: SPREADSHEET_SECTION_DEFINITIONS.map((d) => d.key),
      yearFilter,
    });
  }, [dataset, yearFilter]);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignInForSheets();
      setGoogleUser(result.user);
      setNeedsAuth(false);
      onNotify(`Terhubung ke Google Sheets sebagai ${result.user.email || result.user.displayName}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal masuk dengan akun Google.',
        'error'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      await googleSignOutForSheets();
      setGoogleUser(null);
      setNeedsAuth(true);
      setInspectedTarget(null);
      onNotify('Koneksi akun Google Sheets telah diputus.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memutus koneksi Google.',
        'error'
      );
    }
  };

  const handleInspectExisting = async () => {
    const token = getGoogleSheetsAccessToken();
    if (!token) {
      setNeedsAuth(true);
      onNotify('Silakan masuk dengan Google terlebih dahulu.', 'error');
      return;
    }
    const parsedId = extractSpreadsheetId(existingSpreadsheetInput);
    if (!parsedId) {
      onNotify('Masukkan URL atau ID Google Spreadsheet yang valid.', 'error');
      return;
    }
    setInspectingTarget(true);
    try {
      const info = await inspectExistingSpreadsheet(token, parsedId);
      setInspectedTarget(info);
      onNotify(`Spreadsheet "${info.title}" ditemukan (${info.sheets.length} lembar).`);
    } catch (err) {
      setInspectedTarget(null);
      if (err instanceof GoogleSheetsAuthError) {
        setNeedsAuth(true);
      }
      onNotify(
        err instanceof Error ? err.message : 'Gagal memeriksa metadata spreadsheet.',
        'error'
      );
    } finally {
      setInspectingTarget(false);
    }
  };

  const toggleSection = (key: SpreadsheetSectionKey) => {
    setSelectedSections((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const handleRequestExport = async () => {
    const token = getGoogleSheetsAccessToken();
    if (!token) {
      setNeedsAuth(true);
      onNotify('Masuk dengan Google terlebih dahulu untuk mengekspor ke Google Sheets.', 'error');
      return;
    }
    if (selectedSections.length === 0) {
      onNotify('Pilih minimal satu tabel database untuk diekspor.', 'error');
      return;
    }
    if (exportMode === 'create' && !spreadsheetTitle.trim()) {
      onNotify('Judul Google Spreadsheet baru wajib diisi.', 'error');
      return;
    }
    if (exportMode === 'update') {
      const parsedId = extractSpreadsheetId(existingSpreadsheetInput);
      if (!parsedId) {
        onNotify('Masukkan URL atau ID Google Spreadsheet tujuan yang valid.', 'error');
        return;
      }
      if (!inspectedTarget || inspectedTarget.spreadsheetId !== parsedId) {
        setInspectingTarget(true);
        try {
          const info = await inspectExistingSpreadsheet(token, parsedId);
          setInspectedTarget(info);
        } catch (err) {
          if (err instanceof GoogleSheetsAuthError) {
            setNeedsAuth(true);
          }
          onNotify(
            err instanceof Error ? err.message : 'Tidak dapat mengakses spreadsheet tujuan.',
            'error'
          );
          setInspectingTarget(false);
          return;
        } finally {
          setInspectingTarget(false);
        }
      }
    }
    setConfirmOpen(true);
  };

  const handleConfirmExport = async () => {
    const token = getGoogleSheetsAccessToken();
    if (!token) {
      setConfirmOpen(false);
      setNeedsAuth(true);
      onNotify('Sesi Google Sheets tidak aktif. Silakan masuk kembali.', 'error');
      return;
    }

    setExporting(true);
    try {
      const latestDataset = await api.getSpreadsheetExportData();
      setDataset(latestDataset);
      const latestWorksheets = buildSpreadsheetWorksheets(latestDataset, {
        selectedKeys: selectedSections,
        yearFilter,
      });

      const targetId =
        exportMode === 'update' ? extractSpreadsheetId(existingSpreadsheetInput) ?? undefined : undefined;

      const res = await exportDatabaseToGoogleSpreadsheet({
        accessToken: token,
        mode: exportMode,
        title: spreadsheetTitle.trim(),
        existingSpreadsheetId: targetId,
        worksheets: latestWorksheets,
      });

      setLastResult(res);
      setConfirmOpen(false);
      onNotify(
        `Ekspor ke Google Spreadsheet "${res.title}" berhasil (${res.sheetCount} lembar, ${res.totalRowsExported} baris).`
      );
    } catch (err) {
      if (err instanceof GoogleSheetsAuthError) {
        clearGoogleSheetsAccessToken();
        setNeedsAuth(true);
        setConfirmOpen(false);
      }
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengekspor database ke Google Spreadsheet.',
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const totalSelectedRows = worksheets.reduce((sum, ws) => sum + ws.dataRowCount, 0);

  return (
    <div className="space-y-6">
      {/* Header & Google Connection Card */}
      <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--theme-text)] font-display">
                Ekspor Database ke Google Spreadsheet
              </h2>
              <p className="text-xs text-[var(--theme-text-muted)] mt-1 max-w-2xl leading-relaxed">
                Ekspor seluruh arsip surat masuk, surat keluar, disposisi, kode klasifikasi, direktori
                guru/karyawan, penghitung tahun, peraturan, dan log aktivitas langsung ke Google Sheets
                milik Admin.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadDatabaseSnapshot()}
              disabled={loadingDataset}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDataset ? 'animate-spin' : ''}`} />
              Segarkan Data DB
            </button>
          </div>
        </div>

        {/* Google Auth Status Bar */}
        <div className="p-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {needsAuth ? (
            <>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[var(--theme-text)]">
                  Hubungkan Akun Google untuk Google Sheets
                </div>
                <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                  Izin hanya digunakan untuk membuat dan mengisi Google Spreadsheet saat Anda menekan
                  tombol konfirmasi ekspor. Token disimpan sementara di memori browser selama sesi aktif.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                disabled={isLoggingIn}
                className="gsi-material-button shrink-0"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isLoggingIn ? 'Menghubungkan...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--theme-text)] truncate">
                    Terhubung ke Google Sheets
                  </div>
                  <div className="text-[11px] text-[var(--theme-text-muted)] truncate">
                    {googleUser?.displayName ? `${googleUser.displayName} · ` : ''}
                    {googleUser?.email || 'Akun Google aktif'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleGoogleDisconnect()}
                className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-center"
              >
                <LogOut className="w-3.5 h-3.5" />
                Putuskan Koneksi
              </button>
            </>
          )}
        </div>
      </section>

      {/* Export Configuration */}
      <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--theme-text)]">
              Konfigurasi Target &amp; Lembar Data
            </h3>
            <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
              Tentukan tujuan spreadsheet, cakupan tahun arsip, dan tabel database yang ingin diekspor.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-[var(--theme-text-muted)]" htmlFor="gs-year-scope">
              Cakupan Tahun:
            </label>
            <select
              id="gs-year-scope"
              value={yearFilter === 'all' ? 'all' : String(yearFilter)}
              onChange={(e) =>
                setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              className="px-3 py-1.5 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="all">Semua Tahun</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Tahun {yr}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Target Mode Selector */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setExportMode('create')}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  exportMode === 'create'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Buat Spreadsheet Baru
              </button>
              <button
                type="button"
                onClick={() => setExportMode('update')}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  exportMode === 'update'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Perbarui Spreadsheet yang Ada
              </button>
            </div>

            {exportMode === 'create' ? (
              <label className="block space-y-1.5 text-xs max-w-xl">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Judul Google Spreadsheet Baru
                </span>
                <input
                  type="text"
                  value={spreadsheetTitle}
                  onChange={(e) => setSpreadsheetTitle(e.target.value)}
                  maxLength={140}
                  placeholder="Contoh: Database E-Surat SMPN 2 Girimulyo 2026"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
            ) : (
              <div className="space-y-2.5 max-w-2xl">
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    URL atau ID Google Spreadsheet Tujuan
                  </span>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={existingSpreadsheetInput}
                      onChange={(e) => {
                        setExistingSpreadsheetInput(e.target.value);
                        setInspectedTarget(null);
                      }}
                      placeholder="https://docs.google.com/spreadsheets/d/1AbCdEf.../edit atau ID Spreadsheet"
                      className="flex-1 px-3 py-2 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleInspectExisting()}
                      disabled={inspectingTarget || needsAuth}
                      className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Search className="w-3.5 h-3.5" />
                      {inspectingTarget ? 'Memeriksa...' : 'Periksa Metadata'}
                    </button>
                  </div>
                </label>

                {inspectedTarget && (
                  <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-950/30 text-xs space-y-1">
                    <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                      Spreadsheet ditemukan: {inspectedTarget.title}
                    </div>
                    <div className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90">
                      Tab tersedia saat ini:{' '}
                      {inspectedTarget.sheets.map((s) => s.title).join(', ') || '—'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Table Selection Grid */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--theme-text)]">
                Pilih Lembar Kerja Database ({selectedSections.length} dari{' '}
                {SPREADSHEET_SECTION_DEFINITIONS.length} tabel)
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSections(SPREADSHEET_SECTION_DEFINITIONS.map((d) => d.key))
                  }
                  className="font-medium text-[var(--theme-accent-text)] hover:underline"
                >
                  Pilih Semua
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSections(['ringkasan', 'incoming', 'outgoing'])}
                  className="font-medium text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                >
                  Surat Pokok Saja
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {SPREADSHEET_SECTION_DEFINITIONS.map((def) => {
                const checked = selectedSections.includes(def.key);
                const preview = allSectionPreviews.find((p) => p.key === def.key);
                return (
                  <label
                    key={def.key}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-start gap-3 ${
                      checked
                        ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)]/35'
                        : 'border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] hover:bg-[var(--theme-surface-hover)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSection(def.key)}
                      className="mt-0.5 rounded border-[var(--theme-border-strong)] accent-[var(--theme-accent)]"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--theme-text)] truncate">
                          {def.label}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-[var(--theme-accent-text)] shrink-0">
                          {preview ? `${preview.dataRowCount} baris` : '—'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--theme-text-muted)] leading-snug">
                        {def.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Action Bar */}
          <div className="pt-4 border-t border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums">
              Total siap diekspor: {worksheets.length} lembar kerja · {totalSelectedRows} baris data
            </div>
            <button
              type="button"
              disabled={loadingDataset || exporting || selectedSections.length === 0}
              onClick={() => void handleRequestExport()}
              className="px-4 py-2.5 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <UploadCloud className="w-4 h-4" />
              Ekspor ke Google Spreadsheet
            </button>
          </div>
        </div>
      </section>

      {/* Latest Export Success Result */}
      {lastResult && (
        <section className="border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100 truncate">
                Berhasil Diekspor: {lastResult.title}
              </div>
              <div className="text-xs text-emerald-800 dark:text-emerald-300 font-mono tabular-nums">
                {lastResult.sheetCount} lembar kerja · {lastResult.totalRowsExported} baris ·{' '}
                {new Date(lastResult.exportedAt).toLocaleString('id')}
              </div>
            </div>
          </div>

          <a
            href={lastResult.spreadsheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-center"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Buka di Google Sheets
          </a>
        </section>
      )}

      {/* Mandatory Confirmation Modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-gs-export-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !exporting) setConfirmOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--theme-border)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <h3
                  id="confirm-gs-export-title"
                  className="text-sm font-semibold text-[var(--theme-text)]"
                >
                  Konfirmasi Ekspor ke Google Spreadsheet
                </h3>
              </div>
              <button
                type="button"
                disabled={exporting}
                onClick={() => setConfirmOpen(false)}
                aria-label="Tutup dialog konfirmasi"
                className="p-1 rounded-md text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-[var(--theme-text-secondary)] leading-relaxed">
                {exportMode === 'create' ? (
                  <>
                    Sistem akan <strong className="text-[var(--theme-text)]">membuat Google Spreadsheet baru</strong>{' '}
                    berjudul <strong className="text-[var(--theme-text)]">"{spreadsheetTitle.trim()}"</strong>{' '}
                    pada akun{' '}
                    <strong className="font-mono text-[var(--theme-text)]">
                      {googleUser?.email || 'Google Anda'}
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    Sistem akan <strong className="text-rose-700 dark:text-rose-400">memperbarui dan menimpa isi</strong>{' '}
                    tab lembar kerja yang dipilih pada spreadsheet{' '}
                    <strong className="text-[var(--theme-text)]">
                      "{inspectedTarget?.title || existingSpreadsheetInput}"
                    </strong>{' '}
                    pada akun{' '}
                    <strong className="font-mono text-[var(--theme-text)]">
                      {googleUser?.email || 'Google Anda'}
                    </strong>
                    .
                  </>
                )}
              </p>

              <div className="border border-[var(--theme-border)] rounded-lg overflow-hidden">
                <div className="px-3.5 py-2 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] font-semibold text-[var(--theme-text)]">
                  Ringkasan Lembar Kerja yang Akan Ditulis ({worksheets.length} Tab)
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-[var(--theme-border)]">
                  {worksheets.map((ws) => (
                    <div
                      key={ws.key}
                      className="px-3.5 py-2 flex items-center justify-between gap-3"
                    >
                      <span className="font-medium text-[var(--theme-text)]">{ws.sheetTitle}</span>
                      <span className="font-mono tabular-nums text-[var(--theme-text-muted)]">
                        {ws.dataRowCount} baris · {ws.columnCount} kolom
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-[var(--theme-surface-subtle)] border-t border-[var(--theme-border)] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={() => setConfirmOpen(false)}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleConfirmExport()}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {exporting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Mengekspor ke Google Sheets...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Konfirmasi &amp; Ekspor Sekarang
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
