import { useEffect, useRef, useState } from 'react';
import { Check, Columns3, Lock, Smartphone, Monitor, X } from 'lucide-react';
import { countVisibleColumns, type TableColumnDef } from '../lib/tableColumns.ts';

interface TableColumnSelectorProps<K extends string> {
  columns: TableColumnDef<K>[];
  visibility: Record<K, boolean>;
  onToggleColumn: (key: K) => void;
  onApplyPreset: (mode: 'mobile' | 'desktop') => void;
  tableLabel: string;
}

export function TableColumnSelector<K extends string>({
  columns,
  visibility,
  onToggleColumn,
  onApplyPreset,
  tableLabel,
}: TableColumnSelectorProps<K>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleCount = countVisibleColumns(columns, visibility);
  const totalCount = columns.length;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    const onPointerDown = (e: MouseEvent) => {
      // Hanya tutup popover desktop saat klik di luar kontainer; modal mobile ditangani backdrop
      if (
        window.innerWidth >= 640 &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const renderPanelBody = (isMobileSheet: boolean) => (
    <>
      <div className="px-4 py-3 border-b border-[var(--theme-border)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--theme-text)]">
            Tampilan Kolom {tableLabel}
          </div>
          <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5 leading-snug">
            Sembunyikan kolom tambahan agar tabel lebih ringkas dan nyaman di layar kecil.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Tutup pengaturan kolom"
          className={`${
            isMobileSheet ? 'min-w-[44px] min-h-[44px] -mr-2 -mt-1.5' : 'p-1'
          } flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-lg shrink-0`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Preset cepat Mobile vs Semua Kolom */}
      <div className="px-4 py-2.5 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onApplyPreset('mobile')}
          className="min-h-[40px] sm:min-h-[32px] px-2.5 py-1.5 text-[11px] font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
        >
          <Smartphone className="w-3.5 h-3.5 text-[var(--theme-accent-text)] shrink-0" />
          Ringkas Mobile
        </button>
        <button
          type="button"
          onClick={() => onApplyPreset('desktop')}
          className="min-h-[40px] sm:min-h-[32px] px-2.5 py-1.5 text-[11px] font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
        >
          <Monitor className="w-3.5 h-3.5 text-[var(--theme-accent-text)] shrink-0" />
          Semua Kolom
        </button>
      </div>

      {/* Daftar Kolom */}
      <div className="overflow-y-auto divide-y divide-[var(--theme-border)] max-h-[55vh] sm:max-h-72">
        {columns.map((col) => {
          const checked = col.locked ? true : Boolean(visibility[col.key]);
          return (
            <button
              key={col.key}
              type="button"
              role="switch"
              aria-checked={checked}
              disabled={col.locked}
              onClick={() => {
                if (!col.locked) onToggleColumn(col.key);
              }}
              className={`w-full px-4 ${
                isMobileSheet ? 'min-h-[52px] py-3' : 'py-2.5'
              } flex items-center justify-between gap-3 text-left transition-colors ${
                col.locked
                  ? 'bg-[var(--theme-surface-subtle)]/60 cursor-default'
                  : 'hover:bg-[var(--theme-surface-hover)] cursor-pointer'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--theme-text)]">
                  <span className="truncate">{col.label}</span>
                  {col.locked && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--theme-text-muted)]">
                      <Lock className="w-3 h-3" />
                      Utama
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--theme-text-muted)] truncate mt-0.5">
                  {col.description}
                </div>
              </div>

              <span
                aria-hidden="true"
                className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                  checked
                    ? col.locked
                      ? 'bg-[var(--theme-border-strong)] border-[var(--theme-border-strong)] text-[var(--theme-surface)]'
                      : 'bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white'
                    : 'bg-[var(--theme-surface)] border-[var(--theme-border-strong)] text-transparent'
                }`}
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              </span>
            </button>
          );
        })}
      </div>

      {isMobileSheet && (
        <div className="p-4 border-t border-[var(--theme-border)] bg-[var(--theme-surface)]">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium bg-[var(--theme-accent)] text-white rounded-xl hover:bg-[var(--theme-accent-hover)] transition-colors"
          >
            Selesai ({visibleCount} dari {totalCount} kolom tampil)
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Atur kolom tabel ${tableLabel}`}
        className={`min-h-[40px] sm:min-h-[34px] px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
          open
            ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)]'
            : 'border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]'
        }`}
      >
        <Columns3 className="w-3.5 h-3.5 text-[var(--theme-accent-text)] shrink-0" />
        <span>Kolom</span>
        <span className="font-mono tabular-nums text-[var(--theme-text-muted)]">
          ({visibleCount}/{totalCount})
        </span>
      </button>

      {/* Desktop / Tablet Popover */}
      {open && (
        <div
          role="dialog"
          aria-label={`Pengaturan kolom ${tableLabel}`}
          className="hidden sm:block absolute right-0 mt-2 w-80 bg-[var(--theme-surface)] border border-[var(--theme-border-strong)] rounded-xl shadow-xl z-40 overflow-hidden"
        >
          {renderPanelBody(false)}
        </div>
      )}

      {/* Mobile Bottom Sheet Drawer */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Pengaturan kolom ${tableLabel}`}
          className="sm:hidden fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-end justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full bg-[var(--theme-surface)] text-[var(--theme-text)] border-t border-[var(--theme-border)] rounded-t-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="pt-2.5 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-xs bg-[var(--theme-border-strong)]" />
            </div>
            {renderPanelBody(true)}
          </div>
        </div>
      )}
    </div>
  );
}
