import { ArrowUpRight, CalendarRange, Clock, FilePlus2, HelpCircle, Inbox, Send, Sparkles } from 'lucide-react';
import type {
  AuthUser,
  ClassificationCode,
  IncomingLetter,
  OutgoingLetter,
} from '../types.ts';
import { formatDateId } from '../lib/format.ts';
import type { ActiveYearSelection } from '../lib/yearUtils.ts';

interface DashboardViewProps {
  currentUser: AuthUser;
  incoming: IncomingLetter[];
  outgoing: OutgoingLetter[];
  classifications: ClassificationCode[];
  selectedYear?: ActiveYearSelection;
  availableYears?: number[];
  onChangeYear?: (year: ActiveYearSelection) => void;
  menuDescription?: string;
  canEditMenuDescription?: boolean;
  onEditMenuDescription?: () => void;
  onSelectIncoming: (letter: IncomingLetter) => void;
  onSelectOutgoing: (letter: OutgoingLetter) => void;
  onNavigate: (
    tab: 'incoming' | 'outgoing' | 'dispositions',
    preset?: {
      incomingStatus?: 'Semua' | 'Menunggu Disposisi';
      outgoingClass?: string;
      dispositionStatus?: 'Semua' | 'Belum Ditindaklanjuti';
    }
  ) => void;
  onOpenNewLetter: (type: 'incoming' | 'outgoing') => void;
  onOpenMonthlyReport?: () => void;
  onOpenGuide?: () => void;
  onOpenAiAssistant?: () => void;
}

export function DashboardView({
  currentUser,
  incoming,
  outgoing,
  classifications,
  selectedYear = 'all',
  availableYears = [],
  onChangeYear,
  menuDescription,
  canEditMenuDescription = false,
  onEditMenuDescription,
  onSelectIncoming,
  onSelectOutgoing,
  onNavigate,
  onOpenNewLetter,
  onOpenMonthlyReport,
  onOpenGuide,
  onOpenAiAssistant,
}: DashboardViewProps) {
  const now = new Date();
  const isSpecificYear = typeof selectedYear === 'number';
  const targetYear = isSpecificYear ? selectedYear : now.getFullYear();
  const currentMonthPrefix = `${targetYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayFormatted = formatDateId(now.toISOString().slice(0, 10), true);

  const scopedIncoming = isSpecificYear
    ? incoming.filter(
        (l) => (l.agendaYear || Number(l.receivedDate.slice(0, 4))) === selectedYear
      )
    : incoming;
  const scopedOutgoing = isSpecificYear
    ? outgoing.filter(
        (l) => (l.letterYear || Number(l.letterDate.slice(0, 4))) === selectedYear
      )
    : outgoing;

  const incomingThisMonth = scopedIncoming.filter((l) =>
    l.receivedDate.startsWith(currentMonthPrefix)
  ).length;
  const outgoingThisMonth = scopedOutgoing.filter((l) =>
    l.letterDate.startsWith(currentMonthPrefix)
  ).length;
  const awaitingDisposition = scopedIncoming.filter(
    (l) => l.status === 'Menunggu Disposisi'
  );
  const urgentIncoming = scopedIncoming.filter(
    (l) => (l.urgency === 'Segera' || l.urgency === 'Penting') && l.status !== 'Selesai'
  );
  const activeDispositionsCount = scopedIncoming.reduce(
    (acc, l) => acc + l.dispositions.filter((d) => d.status !== 'Selesai').length,
    0
  );
  const incomingPending = scopedIncoming.filter((l) => l.status !== 'Selesai').length;
  const incomingCompleted = scopedIncoming.length - incomingPending;
  const outgoingWaiting = scopedOutgoing.filter(
    (l) => l.status === 'Draf' || l.status === 'Menunggu TTD'
  ).length;
  const outgoingPublished = scopedOutgoing.length - outgoingWaiting;
  const allDispositions = scopedIncoming.flatMap((l) => l.dispositions);
  const unstartedDispositionsCount = allDispositions.filter(
    (d) => d.status === 'Belum Ditindaklanjuti'
  ).length;
  const inProgressDispositionsCount = allDispositions.filter(
    (d) => d.status === 'Sedang Diproses'
  ).length;
  const completedDispositionsCount = allDispositions.filter(
    (d) => d.status === 'Selesai'
  ).length;

  const totalStatVolume = scopedIncoming.length + scopedOutgoing.length + activeDispositionsCount;
  const maxStatValue = Math.max(
    1,
    scopedIncoming.length,
    scopedOutgoing.length,
    activeDispositionsCount
  );

  const summaryMetrics = [
    {
      key: 'incoming' as const,
      label: 'Surat Masuk',
      shortLabel: 'Surat Masuk',
      count: scopedIncoming.length,
      detailText: `${incomingCompleted} selesai · ${incomingPending} dalam proses`,
      targetTab: 'incoming' as const,
      barClass: 'bg-blue-600 dark:bg-blue-400',
      sharePct: totalStatVolume > 0 ? Math.round((scopedIncoming.length / totalStatVolume) * 100) : 0,
      relativePct: Math.round((scopedIncoming.length / maxStatValue) * 100),
    },
    {
      key: 'outgoing' as const,
      label: 'Surat Keluar',
      shortLabel: 'Surat Keluar',
      count: scopedOutgoing.length,
      detailText: `${outgoingPublished} terbit/arsip · ${outgoingWaiting} draf/TTD`,
      targetTab: 'outgoing' as const,
      barClass: 'bg-emerald-600 dark:bg-emerald-400',
      sharePct: totalStatVolume > 0 ? Math.round((scopedOutgoing.length / totalStatVolume) * 100) : 0,
      relativePct: Math.round((scopedOutgoing.length / maxStatValue) * 100),
    },
    {
      key: 'dispositions' as const,
      label: 'Disposisi Aktif (Belum Selesai)',
      shortLabel: 'Disposisi Aktif',
      count: activeDispositionsCount,
      detailText:
        activeDispositionsCount > 0
          ? `${unstartedDispositionsCount} belum mulai · ${inProgressDispositionsCount} diproses`
          : `${completedDispositionsCount} riwayat disposisi selesai`,
      targetTab: 'dispositions' as const,
      barClass: 'bg-amber-600 dark:bg-amber-400',
      sharePct:
        totalStatVolume > 0 ? Math.round((activeDispositionsCount / totalStatVolume) * 100) : 0,
      relativePct: Math.round((activeDispositionsCount / maxStatValue) * 100),
    },
  ];

  const priorityQueue = [...scopedIncoming]
    .filter((l) => l.status !== 'Selesai')
    .sort((a, b) => {
      const rank = (u: string) =>
        u === 'Segera' ? 0 : u === 'Penting' ? 1 : u === 'Rahasia' ? 2 : 3;
      const diff = rank(a.urgency) - rank(b.urgency);
      if (diff !== 0) return diff;
      return b.receivedDate.localeCompare(a.receivedDate);
    })
    .slice(0, 6);

  const recentOutgoing = scopedOutgoing.slice(0, 5);

  const classificationStats = classifications
    .map((c) => {
      const inCount = scopedIncoming.filter((l) => l.classificationCode === c.code).length;
      const outCount = scopedOutgoing.filter((l) => l.classificationCode === c.code).length;
      return {
        ...c,
        total: inCount + outCount,
        inCount,
        outCount,
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  const maxClassTotal = Math.max(1, ...classificationStats.map((c) => c.total));

  const urgencyTextClass = (urgency: string) => {
    if (urgency === 'Segera') return 'text-rose-700 dark:text-rose-400 font-semibold';
    if (urgency === 'Penting') return 'text-amber-700 dark:text-amber-400 font-semibold';
    if (urgency === 'Rahasia') return 'text-[var(--theme-text)] font-semibold';
    return 'text-[var(--theme-text-muted)]';
  };

  const statusTextClass = (status: string) => {
    if (status === 'Selesai' || status === 'Terkirim') {
      return 'text-emerald-700 dark:text-emerald-400 font-medium';
    }
    if (status === 'Menunggu Disposisi' || status === 'Menunggu TTD') {
      return 'text-amber-700 dark:text-amber-400 font-medium';
    }
    if (status === 'Didisposisikan' || status === 'Diproses' || status === 'Diarsipkan') {
      return 'text-blue-700 dark:text-sky-400 font-medium';
    }
    return 'text-[var(--theme-text-muted)] font-medium';
  };

  return (
    <div className="space-y-6">
      {/* Executive Welcome Strip */}
      <section className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl px-6 py-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-[var(--theme-text-muted)] font-mono tabular-nums">
            {todayFormatted} · {currentUser.jabatan} ·{' '}
            {isSpecificYear ? `Tahun Agenda ${selectedYear}` : 'Semua Tahun'}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--theme-text)] font-display text-balance">
            Selamat bertugas, {currentUser.displayName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-[var(--theme-text-secondary)] max-w-2xl leading-relaxed">
              {menuDescription ||
                'Pantau antrean surat masuk prioritas, progres disposisi unit sekolah, dan penerbitan nomor surat keluar.'}
            </p>
            {canEditMenuDescription && onEditMenuDescription && (
              <button
                type="button"
                onClick={onEditMenuDescription}
                className="text-[11px] font-medium text-[var(--theme-accent-text)] hover:underline whitespace-nowrap shrink-0"
              >
                Edit Keterangan Menu
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onChangeYear && availableYears.length > 0 && (
            <select
              value={selectedYear === 'all' ? 'all' : String(selectedYear)}
              onChange={(e) =>
                onChangeYear(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              aria-label="Pilih tahun ringkasan dasbor"
              className="px-3 py-2 text-xs font-medium font-mono tabular-nums border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-[var(--theme-accent)] shrink-0"
            >
              <option value="all">Semua Tahun</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Tahun {yr}
                </option>
              ))}
            </select>
          )}
          {onOpenAiAssistant && (
            <button
              type="button"
              onClick={onOpenAiAssistant}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-accent)]/40 bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] rounded-lg hover:bg-[var(--theme-surface-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Asisten AI
            </button>
          )}
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] rounded-lg hover:bg-[var(--theme-surface-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
              Panduan
            </button>
          )}
          {currentUser.role === 'admin' && onOpenMonthlyReport && (
            <button
              type="button"
              onClick={onOpenMonthlyReport}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] rounded-lg hover:bg-[var(--theme-surface-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <CalendarRange className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
              Laporan Bulanan
            </button>
          )}
          {currentUser.role !== 'staf' && (
            <>
              <button
                type="button"
                onClick={() => onOpenNewLetter('incoming')}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] rounded-lg hover:bg-[var(--theme-surface-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Inbox className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                Catat Surat Masuk
              </button>
              <button
                type="button"
                onClick={() => onOpenNewLetter('outgoing')}
                className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Buat Surat Keluar
              </button>
            </>
          )}
        </div>
      </section>

      {/* KPI Strip — 4-column interactive metric cards */}
      <section aria-label="Ringkasan Persuratan" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('incoming', { incomingStatus: 'Semua' })}
          className="text-left p-5 bg-[var(--theme-surface)] border border-[var(--theme-border)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-hover)]/45 hover:-translate-y-0.5 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] group"
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-medium text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text)] transition-colors">
              Surat Masuk
            </span>
            <span className="w-8 h-8 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center">
              <Inbox className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold font-mono tabular-nums text-[var(--theme-text)]">
              {scopedIncoming.length}
            </span>
            <span className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums">
              {incomingThisMonth} {isSpecificYear && targetYear !== now.getFullYear() ? `di bln ini (${targetYear})` : 'bulan ini'}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('outgoing', { outgoingClass: 'Semua' })}
          className="text-left p-5 bg-[var(--theme-surface)] border border-[var(--theme-border)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-hover)]/45 hover:-translate-y-0.5 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] group"
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-medium text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text)] transition-colors">
              Surat Keluar
            </span>
            <span className="w-8 h-8 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center">
              <Send className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold font-mono tabular-nums text-[var(--theme-text)]">
              {scopedOutgoing.length}
            </span>
            <span className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums">
              {outgoingThisMonth} {isSpecificYear && targetYear !== now.getFullYear() ? `di bln ini (${targetYear})` : 'bulan ini'}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('incoming', { incomingStatus: 'Menunggu Disposisi' })}
          className="text-left p-5 bg-[var(--theme-surface)] border border-[var(--theme-border)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-hover)]/45 hover:-translate-y-0.5 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] group"
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-medium text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text)] transition-colors">
              Menunggu Disposisi
            </span>
            <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold font-mono tabular-nums text-[var(--theme-text)]">
              {awaitingDisposition.length}
            </span>
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              {urgentIncoming.length} prioritas segera/penting
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('dispositions', { dispositionStatus: 'Belum Ditindaklanjuti' })}
          className="text-left p-5 bg-[var(--theme-surface)] border border-[var(--theme-border)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-hover)]/45 hover:-translate-y-0.5 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] group"
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-medium text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text)] transition-colors">
              Disposisi Berjalan
            </span>
            <span className="w-8 h-8 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold font-mono tabular-nums text-[var(--theme-text)]">
              {activeDispositionsCount}
            </span>
            <span className="text-xs text-[var(--theme-text-muted)]">
              unit menindaklanjuti
            </span>
          </div>
        </button>
      </section>

      {/* Kartu Ringkasan Statistik — Angka Ringkas & Visual Bar */}
      <section
        aria-label="Kartu Ringkasan Statistik"
        className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[var(--theme-border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--theme-text)]">
              Ringkasan Statistik Persuratan
            </h2>
            <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
              Perbandingan jumlah surat masuk, surat keluar, dan disposisi aktif yang belum selesai
            </p>
          </div>
          <div className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums shrink-0">
            Total beban terpantau:{' '}
            <span className="font-semibold text-[var(--theme-text)]">{totalStatVolume}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Kolom Kiri: Angka Ringkas & Bilah Proporsi Gabungan */}
          <div className="lg:col-span-5 space-y-5">
            <div className="grid grid-cols-3 gap-4">
              {summaryMetrics.map((metric) => (
                <button
                  key={metric.key}
                  type="button"
                  onClick={() => onNavigate(metric.targetTab)}
                  className="text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] rounded-lg p-2 -m-2 hover:bg-[var(--theme-surface-hover)] transition-colors"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--theme-text-muted)]">
                    <span
                      className={`w-2 h-2 rounded-xs shrink-0 ${metric.barClass}`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{metric.shortLabel}</span>
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold font-mono tabular-nums text-[var(--theme-text)] group-hover:text-[var(--theme-accent-text)] transition-colors">
                      {metric.count}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-[var(--theme-text-muted)]">
                      {metric.sharePct}%
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--theme-text-muted)]">
                <span>Proporsi Gabungan</span>
                <span className="font-mono tabular-nums">
                  {totalStatVolume === 0
                    ? 'Belum ada data'
                    : `${scopedIncoming.length}M · ${scopedOutgoing.length}K · ${activeDispositionsCount}D`}
                </span>
              </div>
              <div
                className="h-3 w-full bg-[var(--theme-surface-hover)] rounded-sm overflow-hidden flex gap-px"
                role="img"
                aria-label={`Distribusi statistik: ${scopedIncoming.length} surat masuk, ${scopedOutgoing.length} surat keluar, ${activeDispositionsCount} disposisi aktif belum selesai`}
              >
                {totalStatVolume > 0 &&
                  summaryMetrics.map((metric) =>
                    metric.count > 0 ? (
                      <div
                        key={metric.key}
                        className={`h-full ${metric.barClass}`}
                        style={{ width: `${(metric.count / totalStatVolume) * 100}%` }}
                        title={`${metric.label}: ${metric.count} (${metric.sharePct}%)`}
                      />
                    ) : null
                  )}
              </div>
            </div>
          </div>

          {/* Kolom Kanan: Visual Bar Perbandingan Detail */}
          <div className="lg:col-span-7 space-y-4">
            {summaryMetrics.map((metric) => (
              <button
                key={metric.key}
                type="button"
                onClick={() => onNavigate(metric.targetTab)}
                className="w-full text-left block group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] rounded-lg p-2 -m-2 hover:bg-[var(--theme-surface-hover)] transition-colors"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-xs shrink-0 ${metric.barClass}`}
                      aria-hidden="true"
                    />
                    <span className="font-semibold text-[var(--theme-text)] group-hover:text-[var(--theme-accent-text)] transition-colors whitespace-nowrap">
                      {metric.label}
                    </span>
                    <span className="text-[var(--theme-text-muted)] hidden sm:inline truncate">
                      · {metric.detailText}
                    </span>
                  </div>
                  <div className="font-mono tabular-nums shrink-0 text-[var(--theme-text)] font-semibold">
                    {metric.count}{' '}
                    <span className="font-normal text-[var(--theme-text-muted)]">
                      ({metric.sharePct}%)
                    </span>
                  </div>
                </div>
                <div className="h-2.5 w-full bg-[var(--theme-surface-hover)] rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${metric.barClass} rounded-sm transition-all duration-300 ease-out`}
                    style={{
                      width: metric.count === 0 ? '0%' : `${Math.max(4, metric.relativePct)}%`,
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Main Split */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <section className="xl:col-span-2 border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--theme-text)]">
                Antrean Surat Masuk Aktif
              </h2>
              <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                Diurutkan berdasarkan sifat urgensi dan tanggal terima terbaru
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {currentUser.role !== 'staf' && (
                <button
                  type="button"
                  onClick={() => onOpenNewLetter('incoming')}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-text)] border border-[var(--theme-border-strong)] rounded-lg hover:bg-[var(--theme-surface-hover)] transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  Catat Masuk
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('incoming')}
                className="px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                Lihat Semua
              </button>
            </div>
          </div>

          {priorityQueue.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-[var(--theme-text)]">
                Seluruh surat masuk telah selesai ditindaklanjuti.
              </p>
              <p className="text-xs text-[var(--theme-text-muted)] mt-1">
                Catat surat masuk baru apabila terdapat berkas dinas yang diterima hari ini.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--theme-border)]">
              {priorityQueue.map((letter) => (
                <button
                  key={letter.id}
                  type="button"
                  onClick={() => onSelectIncoming(letter)}
                  className="w-full text-left px-6 py-4 hover:bg-[var(--theme-surface-hover)] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-muted)]">
                      <span className="font-mono tabular-nums font-semibold text-[var(--theme-text)]">
                        {letter.agendaNumber}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{letter.letterNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span className={urgencyTextClass(letter.urgency)}>{letter.urgency}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Diterima {formatDateId(letter.receivedDate)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[var(--theme-text)] truncate">
                      {letter.subject}
                    </p>
                    <p className="text-xs text-[var(--theme-text-muted)] truncate">
                      Dari: {letter.sender}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs whitespace-nowrap ${statusTextClass(letter.status)}`}>
                      {letter.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-5 py-4 border-b border-[var(--theme-border)] flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--theme-text)]">
                Surat Keluar Terbaru
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('outgoing')}
                className="text-xs font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                Buku Keluar
              </button>
            </div>
            {recentOutgoing.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--theme-text-muted)]">
                Belum ada arsip surat keluar tercatat.
              </div>
            ) : (
              <div className="divide-y divide-[var(--theme-border)]">
                {recentOutgoing.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectOutgoing(item)}
                    className="w-full text-left px-5 py-3.5 hover:bg-[var(--theme-surface-hover)] transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono tabular-nums font-semibold text-[var(--theme-text)] truncate">
                        {item.fullLetterNumber}
                      </span>
                      <span className={`shrink-0 ${statusTextClass(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[var(--theme-text)] line-clamp-1">
                      {item.subject}
                    </p>
                    <p className="text-xs text-[var(--theme-text-muted)] truncate">
                      Kepada: {item.recipient} · {formatDateId(item.letterDate)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--theme-text)]">
                Volume per Klasifikasi
              </h2>
              <span className="text-xs text-[var(--theme-text-muted)]">Masuk & Keluar</span>
            </div>
            {classificationStats.length === 0 ? (
              <p className="text-xs text-[var(--theme-text-muted)]">Belum ada data klasifikasi.</p>
            ) : (
              <div className="space-y-2.5">
                {classificationStats.map((cls) => {
                  const pct = Math.round((cls.total / maxClassTotal) * 100);
                  return (
                    <button
                      key={cls.code}
                      type="button"
                      onClick={() =>
                        cls.outCount > 0
                          ? onNavigate('outgoing', { outgoingClass: cls.code })
                          : onNavigate('incoming', { incomingStatus: 'Semua' })
                      }
                      className="w-full text-left space-y-1.5 rounded-lg p-1.5 -mx-1.5 hover:bg-[var(--theme-surface-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] group"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--theme-text-secondary)] font-medium truncate pr-2 group-hover:text-[var(--theme-accent-text)] transition-colors">
                          <span className="font-mono text-[var(--theme-text)]">{cls.code}</span> — {cls.name}
                        </span>
                        <span className="font-mono tabular-nums text-[var(--theme-text-muted)] shrink-0">
                          {cls.inCount}M / {cls.outCount}K
                        </span>
                      </div>
                      <div className="h-2 w-full bg-[var(--theme-surface-hover)] rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-[var(--theme-accent)] transition-all duration-300 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
