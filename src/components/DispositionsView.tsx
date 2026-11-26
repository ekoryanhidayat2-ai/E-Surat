import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type {
  Disposition,
  DispositionRecipient,
  DispositionStatus,
  IncomingLetter,
} from '../types.ts';
import { DISPOSITION_STATUS_OPTIONS, STAFF_UNITS } from '../types.ts';
import { formatDateId } from '../lib/format.ts';
import {
  collectAvailableYears,
  type ActiveYearSelection,
} from '../lib/yearUtils.ts';

interface DispositionsViewProps {
  incomingLetters: IncomingLetter[];
  dispositionRecipients?: DispositionRecipient[];
  selectedYear?: ActiveYearSelection;
  availableYears?: number[];
  onChangeYear?: (year: ActiveYearSelection) => void;
  presetFilter?: { status: 'Semua' | DispositionStatus; nonce: number } | null;
  onSelectIncoming: (letter: IncomingLetter) => void;
  onUpdateDisposition: (
    incomingId: string,
    dispId: string,
    payload: { status: DispositionStatus; completionNote: string }
  ) => Promise<void>;
}

interface FlatDispositionItem {
  disposition: Disposition;
  letter: IncomingLetter;
}

export function DispositionsView({
  incomingLetters,
  dispositionRecipients = [],
  selectedYear,
  availableYears,
  onChangeYear,
  presetFilter = null,
  onSelectIncoming,
  onUpdateDisposition,
}: DispositionsViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Semua' | DispositionStatus>(
    presetFilter?.status ?? 'Semua'
  );
  const [internalYear, setInternalYear] = useState<ActiveYearSelection>('all');
  const [unitFilter, setUnitFilter] = useState<string>('Semua');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeYearFilter: ActiveYearSelection =
    selectedYear !== undefined ? selectedYear : internalYear;
  const handleYearChange = (next: ActiveYearSelection) => {
    if (onChangeYear) onChangeYear(next);
    else setInternalYear(next);
  };

  const computedYears = useMemo(() => {
    if (availableYears && availableYears.length > 0) return availableYears;
    return collectAvailableYears({ incoming: incomingLetters, activeYear: activeYearFilter });
  }, [availableYears, incomingLetters, activeYearFilter]);

  useEffect(() => {
    if (presetFilter) {
      setStatusFilter(presetFilter.status);
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

  const items = useMemo<FlatDispositionItem[]>(() => {
    const all: FlatDispositionItem[] = [];
    for (const letter of incomingLetters) {
      for (const disposition of letter.dispositions) {
        all.push({ disposition, letter });
      }
    }
    return all.sort((a, b) =>
      b.disposition.createdAt.localeCompare(a.disposition.createdAt)
    );
  }, [incomingLetters]);

  const unitOptions = useMemo(() => {
    const set = new Set<string>(STAFF_UNITS);
    for (const r of dispositionRecipients) {
      if (r.unit.trim()) set.add(r.unit.trim());
    }
    for (const item of items) {
      if (item.disposition.targetUnit.trim()) set.add(item.disposition.targetUnit.trim());
    }
    return Array.from(set);
  }, [dispositionRecipients, items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(({ disposition, letter }) => {
      if (
        typeof activeYearFilter === 'number' &&
        (letter.agendaYear || Number(letter.receivedDate.slice(0, 4))) !== activeYearFilter
      ) {
        return false;
      }
      if (statusFilter !== 'Semua' && disposition.status !== statusFilter) return false;
      if (unitFilter !== 'Semua' && disposition.targetUnit !== unitFilter) return false;
      if (!q) return true;
      return (
        disposition.targetUnit.toLowerCase().includes(q) ||
        disposition.targetStaffName.toLowerCase().includes(q) ||
        disposition.instruction.toLowerCase().includes(q) ||
        letter.subject.toLowerCase().includes(q) ||
        letter.agendaNumber.toLowerCase().includes(q)
      );
    });
  }, [items, activeYearFilter, query, statusFilter, unitFilter]);

  const handleAdvanceStatus = async (
    item: FlatDispositionItem,
    nextStatus: DispositionStatus
  ) => {
    setBusyId(item.disposition.id);
    try {
      await onUpdateDisposition(item.letter.id, item.disposition.id, {
        status: nextStatus,
        completionNote:
          editingNoteId === item.disposition.id
            ? noteDraft
            : item.disposition.completionNote,
      });
      if (editingNoteId === item.disposition.id) {
        setEditingNoteId(null);
      }
    } finally {
      setBusyId(null);
    }
  };

  const statusTextClass = (status: DispositionStatus) => {
    if (status === 'Selesai') return 'text-emerald-700 dark:text-emerald-400 font-semibold';
    if (status === 'Sedang Diproses') return 'text-amber-700 dark:text-amber-400 font-semibold';
    return 'text-rose-700 dark:text-rose-400 font-semibold';
  };

  return (
    <div className="space-y-4">
      <div className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-4 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Cari disposisi"
              placeholder="Cari unit tujuan, staf, instruksi, atau perihal surat..."
              className="w-full pl-9 pr-8 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/25 focus:border-[var(--theme-accent)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Bersihkan pencarian disposisi"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeYearFilter === 'all' ? 'all' : String(activeYearFilter)}
              onChange={(e) =>
                handleYearChange(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              aria-label="Filter tahun disposisi"
              className="px-3 py-2 text-xs font-medium font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="all">Semua Tahun</option>
              {computedYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Tahun {yr}
                </option>
              ))}
            </select>

            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              aria-label="Filter unit tujuan disposisi"
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="Semua">Semua Unit Tujuan</option>
              {unitOptions.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--theme-border)]">
          <div className="flex items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg overflow-x-auto">
            {(['Semua', ...DISPOSITION_STATUS_OPTIONS] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <span className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums">
            {filtered.length} disposisi tercatat
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-12 text-center space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--theme-text)]">
              Belum ada disposisi yang cocok dengan filter ini.
            </p>
            <p className="text-xs text-[var(--theme-text-muted)]">
              Buka salah satu Surat Masuk untuk memberikan instruksi disposisi kepada unit terkait.
            </p>
          </div>
          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('Semua');
                  setUnitFilter('Semua');
                }}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
              >
                Reset Filter
              </button>
              {typeof activeYearFilter === 'number' && (
                <button
                  type="button"
                  onClick={() => handleYearChange('all')}
                  className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                >
                  Tampilkan Semua Tahun
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl divide-y divide-[var(--theme-border)] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          {filtered.map(({ disposition, letter }) => {
            const isEditingNote = editingNoteId === disposition.id;
            const isBusy = busyId === disposition.id;
            return (
              <div key={disposition.id} className="p-5 space-y-3">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-muted)]">
                      <button
                        type="button"
                        onClick={() => onSelectIncoming(letter)}
                        className="font-mono tabular-nums font-semibold text-[var(--theme-accent-text)] hover:underline"
                      >
                        {letter.agendaNumber}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-[var(--theme-text)]">
                        {disposition.targetUnit}
                      </span>
                      {disposition.targetStaffName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{disposition.targetStaffName}</span>
                        </>
                      )}
                      {disposition.deadlineDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Batas: {formatDateId(disposition.deadlineDate)}
                          </span>
                        </>
                      )}
                    </div>

                    <p className="text-sm font-medium text-[var(--theme-text)]">
                      {disposition.instruction}
                    </p>
                    <p className="text-xs text-[var(--theme-text-muted)]">
                      Surat: {letter.subject} ({letter.sender})
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs whitespace-nowrap ${statusTextClass(disposition.status)}`}>
                      {disposition.status}
                    </span>
                  </div>
                </div>

                {disposition.completionNote && !isEditingNote && (
                  <div className="bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)] rounded-md px-3 py-2 text-xs text-[var(--theme-text-secondary)]">
                    <span className="font-medium text-[var(--theme-text)]">Catatan Tindak Lanjut: </span>
                    {disposition.completionNote}
                  </div>
                )}

                {isEditingNote ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Tuliskan hasil tindak lanjut atau laporan singkat..."
                      className="flex-1 px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleAdvanceStatus({ disposition, letter }, disposition.status)}
                        className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
                      >
                        Simpan Catatan
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNoteId(null)}
                        className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {disposition.status !== 'Sedang Diproses' && disposition.status !== 'Selesai' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleAdvanceStatus({ disposition, letter }, 'Sedang Diproses')}
                        className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50"
                      >
                        Tandai Sedang Diproses
                      </button>
                    )}
                    {disposition.status !== 'Selesai' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleAdvanceStatus({ disposition, letter }, 'Selesai')}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Tandai Selesai
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNoteId(disposition.id);
                        setNoteDraft(disposition.completionNote);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] underline underline-offset-4"
                    >
                      {disposition.completionNote ? 'Ubah Catatan' : 'Tambah Catatan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectIncoming(letter)}
                      className="px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-text)] hover:underline underline-offset-4 ml-auto"
                    >
                      Buka Detail Surat
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
