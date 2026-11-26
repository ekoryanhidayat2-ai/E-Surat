import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  CalendarRange,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Paperclip,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import type {
  ClassificationCode,
  OutgoingLetter,
  OutgoingStatus,
  SchoolSettings,
  StaffRole,
} from '../types.ts';
import { OUTGOING_STATUS_OPTIONS } from '../types.ts';
import { exportOutgoingCsv, formatDateId } from '../lib/format.ts';
import {
  exportOutgoingAgendaPdf,
  getStoredPdfOrientation,
  savePdfOrientation,
  type PdfOrientation,
} from '../lib/pdfExport.ts';
import { HighlightText } from './HighlightText.tsx';
import {
  getDefaultColumnVisibility,
  loadColumnVisibility,
  OUTGOING_COLUMNS_STORAGE_KEY,
  OUTGOING_TABLE_COLUMNS,
  saveColumnVisibility,
  type OutgoingColumnKey,
} from '../lib/tableColumns.ts';
import { TableColumnSelector } from './TableColumnSelector.tsx';
import {
  collectAvailableYears,
  type ActiveYearSelection,
} from '../lib/yearUtils.ts';

interface OutgoingLettersViewProps {
  letters: OutgoingLetter[];
  classifications: ClassificationCode[];
  settings: SchoolSettings;
  role: StaffRole;
  selectedYear?: ActiveYearSelection;
  availableYears?: number[];
  onChangeYear?: (year: ActiveYearSelection) => void;
  presetFilter?: { classificationCode: string; nonce: number } | null;
  onSelectLetter: (letter: OutgoingLetter) => void;
  onPreviewLetter: (letter: OutgoingLetter) => void;
  onEditLetter: (letter: OutgoingLetter) => void;
  onOpenNew: () => void;
  onPrintAgenda: (filteredLetters: OutgoingLetter[], periodLabel: string) => void;
  onOpenMonthlyReport?: () => void;
  onNotify?: (message: string, tone?: 'success' | 'error') => void;
}

export function OutgoingLettersView({
  letters,
  classifications,
  settings,
  role,
  selectedYear,
  availableYears,
  onChangeYear,
  presetFilter = null,
  onSelectLetter,
  onPreviewLetter,
  onEditLetter,
  onOpenNew,
  onPrintAgenda,
  onOpenMonthlyReport,
  onNotify,
}: OutgoingLettersViewProps) {
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'semua' | 'subjek' | 'penerima' | 'nomor'>('semua');
  const [statusFilter, setStatusFilter] = useState<'Semua' | OutgoingStatus>('Semua');
  const [classFilter, setClassFilter] = useState<string>(
    presetFilter?.classificationCode ?? 'Semua'
  );
  const [internalYear, setInternalYear] = useState<ActiveYearSelection>('all');
  const [monthFilter, setMonthFilter] = useState<string>('Semua');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfOrientation, setPdfOrientation] = useState<PdfOrientation>(() =>
    getStoredPdfOrientation()
  );
  const [colVis, setColVis] = useState<Record<OutgoingColumnKey, boolean>>(() =>
    loadColumnVisibility(OUTGOING_COLUMNS_STORAGE_KEY, OUTGOING_TABLE_COLUMNS)
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeYearFilter: ActiveYearSelection =
    selectedYear !== undefined ? selectedYear : internalYear;
  const handleYearChange = (next: ActiveYearSelection) => {
    if (onChangeYear) onChangeYear(next);
    else setInternalYear(next);
  };

  const handleToggleColumn = (key: OutgoingColumnKey) => {
    setColVis((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveColumnVisibility(OUTGOING_COLUMNS_STORAGE_KEY, next);
      return next;
    });
  };

  const handleApplyColumnPreset = (mode: 'mobile' | 'desktop') => {
    const next = getDefaultColumnVisibility(OUTGOING_TABLE_COLUMNS, mode);
    setColVis(next);
    saveColumnVisibility(OUTGOING_COLUMNS_STORAGE_KEY, next);
    onNotify?.(
      mode === 'mobile'
        ? 'Tampilan kolom ringkas untuk layar kecil diterapkan.'
        : 'Seluruh kolom tabel surat keluar ditampilkan.'
    );
  };

  useEffect(() => {
    if (presetFilter) {
      setClassFilter(presetFilter.classificationCode);
    }
  }, [presetFilter]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (!isTyping && e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const computedYears = useMemo(() => {
    if (availableYears && availableYears.length > 0) return availableYears;
    return collectAvailableYears({ outgoing: letters, activeYear: activeYearFilter });
  }, [availableYears, letters, activeYearFilter]);

  useEffect(() => {
    if (
      typeof activeYearFilter === 'number' &&
      monthFilter !== 'Semua' &&
      !monthFilter.startsWith(`${activeYearFilter}-`)
    ) {
      setMonthFilter('Semua');
    }
  }, [activeYearFilter, monthFilter]);

  const yearScopedLetters = useMemo(() => {
    if (typeof activeYearFilter !== 'number') return letters;
    return letters.filter(
      (l) => (l.letterYear || Number(l.letterDate.slice(0, 4))) === activeYearFilter
    );
  }, [letters, activeYearFilter]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const l of yearScopedLetters) {
      if (l.letterDate.length >= 7) {
        set.add(l.letterDate.slice(0, 7));
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [yearScopedLetters]);

  const clsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classifications) map.set(c.code, c.name);
    return map;
  }, [classifications]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return yearScopedLetters.filter((l) => {
      if (statusFilter !== 'Semua' && l.status !== statusFilter) return false;
      if (classFilter !== 'Semua' && l.classificationCode !== classFilter) return false;
      if (monthFilter !== 'Semua' && !l.letterDate.startsWith(monthFilter)) return false;
      if (!q) return true;
      if (searchScope === 'subjek') {
        return l.subject.toLowerCase().includes(q);
      }
      if (searchScope === 'penerima') {
        return l.recipient.toLowerCase().includes(q);
      }
      if (searchScope === 'nomor') {
        return l.fullLetterNumber.toLowerCase().includes(q);
      }
      const clsName = clsMap.get(l.classificationCode)?.toLowerCase() || '';
      return (
        l.fullLetterNumber.toLowerCase().includes(q) ||
        l.recipient.toLowerCase().includes(q) ||
        l.subject.toLowerCase().includes(q) ||
        l.drafterName.toLowerCase().includes(q) ||
        l.notes.toLowerCase().includes(q) ||
        l.classificationCode.toLowerCase().includes(q) ||
        clsName.includes(q)
      );
    });
  }, [yearScopedLetters, query, searchScope, statusFilter, classFilter, monthFilter, clsMap]);

  const periodLabel =
    monthFilter !== 'Semua'
      ? `Periode ${monthFilter}`
      : typeof activeYearFilter === 'number'
        ? `Tahun ${activeYearFilter}`
        : 'Semua Periode';

  const handleDownloadPdf = async () => {
    setExportingPdf(true);
    try {
      await exportOutgoingAgendaPdf(filtered, settings, periodLabel, pdfOrientation);
      onNotify?.('Agenda surat keluar PDF berhasil diunduh.');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Gagal membuat berkas PDF agenda surat keluar.',
        'error'
      );
    } finally {
      setExportingPdf(false);
    }
  };

  const statusTextColor = (status: OutgoingStatus) => {
    switch (status) {
      case 'Terkirim':
        return 'text-emerald-700 dark:text-emerald-400 font-medium';
      case 'Menunggu TTD':
        return 'text-amber-700 dark:text-amber-400 font-medium';
      case 'Diarsipkan':
        return 'text-blue-700 dark:text-sky-400 font-medium';
      default:
        return 'text-[var(--theme-text-muted)] font-medium';
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-4 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-1 flex-col sm:flex-row gap-2 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Pencarian cepat surat keluar"
                placeholder={
                  searchScope === 'subjek'
                    ? 'Ketik kata kunci perihal / subjek surat...'
                    : searchScope === 'penerima'
                      ? 'Ketik nama penerima atau tujuan surat...'
                      : searchScope === 'nomor'
                        ? 'Ketik nomor surat keluar...'
                        : 'Cari cepat subjek/perihal, penerima, atau nomor surat...'
                }
                className="w-full pl-9 pr-8 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/25 focus:border-[var(--theme-accent)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Bersihkan kata kunci pencarian"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={searchScope}
              onChange={(e) =>
                setSearchScope(e.target.value as 'semua' | 'subjek' | 'penerima' | 'nomor')
              }
              aria-label="Fokus kolom pencarian"
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface-subtle)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)] shrink-0"
            >
              <option value="semua">Semua Bidang</option>
              <option value="subjek">Subjek / Perihal</option>
              <option value="penerima">Penerima / Tujuan</option>
              <option value="nomor">Nomor Surat</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter kode klasifikasi"
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="Semua">Semua Klasifikasi</option>
              {classifications.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>

            <select
              value={activeYearFilter === 'all' ? 'all' : String(activeYearFilter)}
              onChange={(e) =>
                handleYearChange(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              aria-label="Filter tahun surat keluar"
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] font-mono tabular-nums focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="all">Semua Tahun</option>
              {computedYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Tahun {yr}
                </option>
              ))}
            </select>

            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              aria-label="Filter periode surat"
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] font-mono tabular-nums focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="Semua">Semua Bulan</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  Periode {m}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => exportOutgoingCsv(filtered)}
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>

            <select
              value={pdfOrientation}
              onChange={(e) => {
                const next = e.target.value as PdfOrientation;
                setPdfOrientation(next);
                savePdfOrientation(next);
              }}
              aria-label="Orientasi cetak PDF"
              className="px-2.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)] shrink-0"
            >
              <option value="portrait">PDF: Portrait</option>
              <option value="landscape">PDF: Landscape</option>
            </select>

            <button
              type="button"
              disabled={exportingPdf || filtered.length === 0}
              onClick={handleDownloadPdf}
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              {exportingPdf ? 'Membuat PDF...' : 'Unduh PDF'}
            </button>

            <button
              type="button"
              onClick={() => onPrintAgenda(filtered, periodLabel)}
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Cetak
            </button>

            {role === 'admin' && onOpenMonthlyReport && (
              <button
                type="button"
                onClick={onOpenMonthlyReport}
                className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <CalendarRange className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                Laporan Bulanan
              </button>
            )}

            {role !== 'staf' && (
              <button
                type="button"
                onClick={onOpenNew}
                className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Buat Surat Keluar
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-[var(--theme-border)]">
          <div className="flex items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg overflow-x-auto">
            {(['Semua', ...OUTGOING_STATUS_OPTIONS] as const).map((st) => {
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                      : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                  }`}
                >
                  {st}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
            <span className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums">
              {filtered.length}/{yearScopedLetters.length} surat
            </span>
            <TableColumnSelector
              columns={OUTGOING_TABLE_COLUMNS}
              visibility={colVis}
              onToggleColumn={handleToggleColumn}
              onApplyPreset={handleApplyColumnPreset}
              tableLabel="Surat Keluar"
            />
          </div>
        </div>
      </div>

      <div className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="p-12 text-center space-y-3"
          >
            <p className="text-sm font-medium text-[var(--theme-text)]">
              {typeof activeYearFilter === 'number' && yearScopedLetters.length === 0
                ? `Belum ada surat keluar tercatat pada Tahun ${activeYearFilter}.`
                : 'Tidak ada surat keluar yang sesuai dengan filter.'}
            </p>
            <p className="text-xs text-[var(--theme-text-muted)] max-w-md mx-auto">
              Buat nomor surat keluar baru secara otomatis atau reset filter untuk melihat arsip surat keluar sekolah.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('Semua');
                  setClassFilter('Semua');
                  setMonthFilter('Semua');
                }}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
              >
                Reset Filter
              </button>
              {typeof activeYearFilter === 'number' && letters.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleYearChange('all')}
                  className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
                >
                  Tampilkan Semua Tahun
                </button>
              )}
              {role !== 'staf' && (
                <button
                  type="button"
                  onClick={onOpenNew}
                  className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)]"
                >
                  Buat Surat Keluar
                </button>
              )}
            </div>
          </motion.div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] text-[11px] font-semibold text-[var(--theme-text-muted)] tracking-wide">
                  {colVis.sequenceNumber && (
                    <th className="py-3 px-2.5 sm:px-4 whitespace-nowrap">No. Urut</th>
                  )}
                  {colVis.fullLetterNumber && (
                    <th className="py-3 px-2.5 sm:px-4 whitespace-nowrap">Nomor Surat Keluar</th>
                  )}
                  {colVis.letterDate && (
                    <th className="py-3 px-2.5 sm:px-4 whitespace-nowrap">Tgl Surat</th>
                  )}
                  <th className="py-3 px-2.5 sm:px-4">Tujuan &amp; Perihal</th>
                  {colVis.drafterName && (
                    <th className="py-3 px-2.5 sm:px-4 whitespace-nowrap">Konseptor</th>
                  )}
                  {colVis.status && (
                    <th className="py-3 px-2.5 sm:px-4 whitespace-nowrap">Status</th>
                  )}
                  {colVis.actions && (
                    <th className="py-3 px-2.5 sm:px-4 text-right whitespace-nowrap">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--theme-border)] text-sm">
                {filtered.map((letter, idx) => (
                  <motion.tr
                    key={letter.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.18,
                      delay: Math.min(idx, 10) * 0.02,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    whileHover={{
                      y: -1,
                      transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] },
                    }}
                    whileTap={{
                      scale: 0.998,
                      transition: { duration: 0.08 },
                    }}
                    onClick={() => onSelectLetter(letter)}
                    className="group hover:bg-[var(--theme-surface-hover)] cursor-pointer transition-colors duration-150"
                  >
                    {colVis.sequenceNumber && (
                      <td className="py-3 px-2.5 sm:px-4 font-mono tabular-nums text-xs text-[var(--theme-text-secondary)] whitespace-nowrap align-top">
                        {letter.sequenceNumber > 0
                          ? String(letter.sequenceNumber).padStart(3, '0')
                          : 'Manual'}
                      </td>
                    )}
                    {colVis.fullLetterNumber && (
                      <td className="py-3 px-2.5 sm:px-4 font-mono tabular-nums text-xs font-semibold text-[var(--theme-text)] group-hover:text-[var(--theme-accent-text)] transition-colors whitespace-nowrap align-top">
                        <HighlightText
                          text={letter.fullLetterNumber}
                          query={searchScope === 'semua' || searchScope === 'nomor' ? query : ''}
                        />
                      </td>
                    )}
                    {colVis.letterDate && (
                      <td className="py-3 px-2.5 sm:px-4 font-mono tabular-nums text-xs text-[var(--theme-text-secondary)] whitespace-nowrap align-top">
                        {formatDateId(letter.letterDate)}
                      </td>
                    )}
                    <td className="py-3 px-2.5 sm:px-4 align-top min-w-[170px] sm:min-w-[220px] max-w-md">
                      {!colVis.fullLetterNumber && (
                        <div className="font-mono tabular-nums text-[11px] font-semibold text-[var(--theme-accent-text)] mb-0.5">
                          <HighlightText
                            text={letter.fullLetterNumber}
                            query={searchScope === 'semua' || searchScope === 'nomor' ? query : ''}
                          />
                        </div>
                      )}
                      <div className="text-xs font-medium text-[var(--theme-text)] line-clamp-1">
                        <HighlightText
                          text={letter.recipient}
                          query={searchScope === 'semua' || searchScope === 'penerima' ? query : ''}
                        />
                      </div>
                      <div className="text-xs text-[var(--theme-text-secondary)] line-clamp-2 mt-0.5">
                        <HighlightText
                          text={letter.subject}
                          query={searchScope === 'semua' || searchScope === 'subjek' ? query : ''}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--theme-text-muted)] mt-1">
                        <span className="font-mono">{letter.classificationCode}</span>
                        {clsMap.get(letter.classificationCode) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[160px] sm:max-w-none">
                              {clsMap.get(letter.classificationCode)}
                            </span>
                          </>
                        )}
                        {!colVis.letterDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatDateId(letter.letterDate)}
                            </span>
                          </>
                        )}
                        {!colVis.sequenceNumber && letter.sequenceNumber > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              #{String(letter.sequenceNumber).padStart(3, '0')}
                            </span>
                          </>
                        )}
                        {!colVis.drafterName && letter.drafterName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[120px]">{letter.drafterName}</span>
                          </>
                        )}
                        {letter.attachmentUrl && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-[var(--theme-accent-text)]">
                              <Paperclip className="w-3 h-3" />
                              Lampiran
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    {colVis.drafterName && (
                      <td className="py-3 px-2.5 sm:px-4 text-xs text-[var(--theme-text-secondary)] whitespace-nowrap align-top">
                        {letter.drafterName}
                      </td>
                    )}
                    {colVis.status && (
                      <td className={`py-3 px-2.5 sm:px-4 text-xs whitespace-nowrap align-top ${statusTextColor(letter.status)}`}>
                        {letter.status}
                      </td>
                    )}
                    {colVis.actions && (
                      <td
                        className="py-2.5 px-2.5 sm:px-4 text-right whitespace-nowrap align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Preview & Cetak Surat Keluar"
                            onClick={() => onPreviewLetter(letter)}
                            className="min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 px-2 py-1 text-xs font-medium border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-hover)] transition-all duration-150 active:scale-95 rounded-md inline-flex items-center justify-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">Preview</span>
                          </button>
                          {role !== 'staf' && (
                            <button
                              type="button"
                              title="Edit Surat Keluar"
                              onClick={() => onEditLetter(letter)}
                              className="min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 px-2 py-1 text-xs font-medium border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-hover)] transition-all duration-150 active:scale-95 rounded-md inline-flex items-center justify-center gap-1"
                            >
                              <FilePenLine className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Edit</span>
                            </button>
                          )}
                          <button
                            type="button"
                            title="Cetak & Unduh PDF Surat Keluar"
                            onClick={() => onPreviewLetter(letter)}
                            className="hidden sm:inline-flex p-1.5 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface-hover)] transition-all duration-150 active:scale-95 rounded-md"
                            aria-label={`Cetak surat ${letter.fullLetterNumber}`}
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
