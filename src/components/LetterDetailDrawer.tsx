import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Eye,
  FilePenLine,
  FileText,
  Loader2,
  Plus,
  Printer,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AiLetterInsightResult,
  DispositionRecipient,
  DispositionStatus,
  IncomingLetter,
  IncomingStatus,
  OutgoingLetter,
  OutgoingStatus,
  SchoolSettings,
  StaffCategory,
  StaffRole,
} from '../types.ts';
import {
  INCOMING_STATUS_OPTIONS,
  OUTGOING_STATUS_OPTIONS,
  STAFF_CATEGORY_OPTIONS,
  STAFF_UNITS,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { formatDateId } from '../lib/format.ts';
import {
  exportDispositionPdf,
  exportIncomingLetterPdf,
  exportOutgoingLetterPdf,
  getStoredPdfOrientation,
  savePdfOrientation,
  type PdfOrientation,
} from '../lib/pdfExport.ts';
import { AttachmentPreviewBox } from './AttachmentPreviewBox.tsx';

export type DetailTarget =
  | { kind: 'incoming'; letter: IncomingLetter }
  | { kind: 'outgoing'; letter: OutgoingLetter };

interface LetterDetailDrawerProps {
  target: DetailTarget;
  settings: SchoolSettings;
  dispositionRecipients?: DispositionRecipient[];
  role: StaffRole;
  operatorLabel: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onUpdateIncomingStatus: (id: string, status: IncomingStatus) => Promise<void>;
  onUpdateOutgoingStatus: (id: string, status: OutgoingStatus) => Promise<void>;
  onAddDisposition: (
    incomingId: string,
    payload: {
      targetUnit: string;
      targetStaffName: string;
      instruction: string;
      deadlineDate: string;
      createdBy: string;
    }
  ) => Promise<void>;
  onUpdateDisposition: (
    incomingId: string,
    dispId: string,
    payload: { status: DispositionStatus; completionNote: string }
  ) => Promise<void>;
  onCreateRecipient?: (payload: {
    name: string;
    nip?: string;
    category: StaffCategory;
    unit?: string;
  }) => Promise<DispositionRecipient>;
  onPrintDisposition: (letter: IncomingLetter) => void;
  onPreviewLetter: (target: DetailTarget) => void;
}

export function LetterDetailDrawer({
  target,
  settings,
  dispositionRecipients = [],
  role,
  operatorLabel,
  onClose,
  onEdit,
  onDelete,
  onUpdateIncomingStatus,
  onUpdateOutgoingStatus,
  onAddDisposition,
  onUpdateDisposition,
  onCreateRecipient,
  onPrintDisposition,
  onPreviewLetter,
}: LetterDetailDrawerProps) {
  const [showDispForm, setShowDispForm] = useState(false);
  const [targetUnit, setTargetUnit] = useState(STAFF_UNITS[0]);
  const [selectedRecipientKey, setSelectedRecipientKey] = useState<string>('');
  const [targetStaffName, setTargetStaffName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [submittingDisp, setSubmittingDisp] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickCategory, setQuickCategory] = useState<StaffCategory>('Guru');
  const [quickNip, setQuickNip] = useState('');
  const [quickUnit, setQuickUnit] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [pdfOrientation, setPdfOrientation] = useState<PdfOrientation>(() =>
    getStoredPdfOrientation()
  );
  const [aiInsight, setAiInsight] = useState<AiLetterInsightResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const availableUnits = useMemo(() => {
    const set = new Set<string>(STAFF_UNITS);
    for (const r of dispositionRecipients) {
      if (r.unit.trim()) set.add(r.unit.trim());
    }
    if (targetUnit.trim()) set.add(targetUnit.trim());
    return Array.from(set);
  }, [dispositionRecipients, targetUnit]);

  const activeRecipients = useMemo(
    () =>
      dispositionRecipients
        .filter((r) => r.isActive)
        .sort((a, b) => a.name.localeCompare(b.name, 'id')),
    [dispositionRecipients]
  );
  const guruRecipients = useMemo(
    () => activeRecipients.filter((r) => r.category === 'Guru'),
    [activeRecipients]
  );
  const karyawanRecipients = useMemo(
    () => activeRecipients.filter((r) => r.category === 'Karyawan'),
    [activeRecipients]
  );

  useEffect(() => {
    setAiInsight(null);
    setAiError('');
    setAiLoading(false);
  }, [target.kind, target.letter.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleAnalyzeWithAi = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const res = await api.summarizeLetterWithAi(target.kind, target.letter.id);
      setAiInsight({
        summary: typeof res?.summary === 'string' ? res.summary : '',
        keyPoints: Array.isArray(res?.keyPoints)
          ? res.keyPoints.filter((p): p is string => typeof p === 'string')
          : [],
        recommendedUnit: typeof res?.recommendedUnit === 'string' ? res.recommendedUnit : STAFF_UNITS[0],
        recommendedInstruction:
          typeof res?.recommendedInstruction === 'string' ? res.recommendedInstruction : '',
        recommendedDeadlineDays:
          typeof res?.recommendedDeadlineDays === 'number' ? res.recommendedDeadlineDays : 3,
        urgencyAssessment: typeof res?.urgencyAssessment === 'string' ? res.urgencyAssessment : '',
        suggestedReplySubject:
          typeof res?.suggestedReplySubject === 'string' ? res.suggestedReplySubject : '',
        reviewNotes: Array.isArray(res?.reviewNotes)
          ? res.reviewNotes.filter((n): n is string => typeof n === 'string')
          : [],
      });
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'Gagal menganalisis surat menggunakan AI.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiDisposition = () => {
    if (!aiInsight || target.kind !== 'incoming') return;
    if (aiInsight.recommendedUnit.trim()) {
      setTargetUnit(aiInsight.recommendedUnit.trim());
    }
    setInstruction(aiInsight.recommendedInstruction);
    const days = Math.max(1, Math.min(30, aiInsight.recommendedDeadlineDays || 3));
    const targetDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    setDeadlineDate(targetDate);
    setShowDispForm(true);
  };

  const handleSelectRecipient = (nextKey: string) => {
    setSelectedRecipientKey(nextKey);
    if (!nextKey) {
      setTargetStaffName('');
      return;
    }
    if (nextKey === '__manual__') {
      return;
    }
    const found = activeRecipients.find((r) => r.id === nextKey);
    if (found) {
      setTargetStaffName(found.name);
      if (found.unit.trim()) {
        setTargetUnit(found.unit.trim());
      }
    }
  };

  const handleQuickCreateRecipient = async () => {
    if (!onCreateRecipient) return;
    const cleanName = quickName.trim();
    if (!cleanName) {
      setQuickError('Nama lengkap guru atau karyawan wajib diisi.');
      return;
    }
    setQuickError('');
    setQuickSaving(true);
    try {
      const created = await onCreateRecipient({
        name: cleanName,
        category: quickCategory,
        nip: quickNip.trim(),
        unit: quickUnit.trim() || targetUnit,
      });
      setSelectedRecipientKey(created.id);
      setTargetStaffName(created.name);
      if (created.unit.trim()) {
        setTargetUnit(created.unit.trim());
      }
      setQuickName('');
      setQuickNip('');
      setQuickUnit('');
      setQuickAddOpen(false);
    } catch (err) {
      setQuickError(
        err instanceof Error ? err.message : 'Gagal menambahkan guru atau karyawan.'
      );
    } finally {
      setQuickSaving(false);
    }
  };

  const handleSubmitDisp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (target.kind !== 'incoming') return;
    setErrorMsg('');
    setSubmittingDisp(true);
    try {
      await onAddDisposition(target.letter.id, {
        targetUnit,
        targetStaffName,
        instruction,
        deadlineDate,
        createdBy: operatorLabel,
      });
      setInstruction('');
      setSelectedRecipientKey('');
      setTargetStaffName('');
      setDeadlineDate('');
      setQuickAddOpen(false);
      setShowDispForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengirim disposisi.');
    } finally {
      setSubmittingDisp(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus surat.');
      setDeleting(false);
    }
  };

  const isIncoming = target.kind === 'incoming';
  const letter = target.letter;
  const dispositions =
    isIncoming && Array.isArray((letter as IncomingLetter).dispositions)
      ? (letter as IncomingLetter).dispositions
      : [];

  const handleExportPdf = async () => {
    setErrorMsg('');
    try {
      if (isIncoming) {
        await exportIncomingLetterPdf(letter as IncomingLetter, settings, pdfOrientation);
      } else {
        await exportOutgoingLetterPdf(letter as OutgoingLetter, settings, pdfOrientation);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengekspor dokumen PDF.');
    }
  };

  const handleExportDispositionPdf = async () => {
    if (!isIncoming) return;
    setErrorMsg('');
    try {
      await exportDispositionPdf(letter as IncomingLetter, settings, pdfOrientation);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengekspor PDF disposisi.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex justify-end no-print"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="w-full max-w-xl bg-[var(--theme-surface)] text-[var(--theme-text)] h-full border-l border-[var(--theme-border)] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--theme-text-muted)]">
              <span>{isIncoming ? 'Surat Masuk' : 'Surat Keluar'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums font-semibold text-[var(--theme-text)]">
                {isIncoming
                  ? (letter as IncomingLetter).agendaNumber
                  : (letter as OutgoingLetter).fullLetterNumber}
              </span>
            </div>
            <h2 className="text-base font-semibold text-[var(--theme-text)] mt-1">
              {letter.subject}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup panel detail"
            className="p-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-md shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-3.5 py-2.5 rounded-md text-xs">
              {errorMsg}
            </div>
          )}

          {/* Action toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPreviewLetter(target)}
              className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] inline-flex items-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview &amp; Cetak
            </button>

            <select
              value={pdfOrientation}
              onChange={(e) => {
                const next = e.target.value as PdfOrientation;
                setPdfOrientation(next);
                savePdfOrientation(next);
              }}
              aria-label="Orientasi cetak PDF"
              className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)] shrink-0"
            >
              <option value="portrait">PDF: Portrait</option>
              <option value="landscape">PDF: Landscape</option>
            </select>

            <button
              type="button"
              onClick={() => void handleExportPdf()}
              className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] text-[var(--theme-text-secondary)] rounded-lg hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              Unduh PDF
            </button>

            {isIncoming && (
              <>
                <button
                  type="button"
                  onClick={() => onPrintDisposition(letter as IncomingLetter)}
                  className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] text-[var(--theme-text-secondary)] rounded-lg hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Cetak Disposisi
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportDispositionPdf()}
                  className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] text-[var(--theme-text-secondary)] rounded-lg hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF Disposisi
                </button>
              </>
            )}

            {role !== 'staf' && (
              <button
                type="button"
                onClick={onEdit}
                className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5"
              >
                <FilePenLine className="w-3.5 h-3.5" />
                Edit Data
              </button>
            )}

            {role === 'admin' && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs font-medium border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1.5 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus
              </button>
            )}
          </div>

          {confirmDelete && (
            <div className="border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-rose-900 dark:text-rose-200 font-medium">
                Yakin ingin menghapus arsip surat ini secara permanen?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-surface)] border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="px-3 py-1.5 text-xs font-medium bg-rose-700 text-white rounded-md hover:bg-rose-800 disabled:opacity-50"
                >
                  {deleting ? 'Menghapus...' : 'Ya, Hapus'}
                </button>
              </div>
            </div>
          )}

          {/* Metadata Table */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 border-t border-b border-[var(--theme-border)] py-4 text-xs">
            {isIncoming ? (
              <>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Nomor Surat Asal</dt>
                  <dd className="font-mono tabular-nums font-medium text-[var(--theme-text)] mt-0.5">
                    {(letter as IncomingLetter).letterNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Pengirim / Instansi</dt>
                  <dd className="font-medium text-[var(--theme-text)] mt-0.5">
                    {(letter as IncomingLetter).sender}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Tanggal Surat</dt>
                  <dd className="font-mono tabular-nums text-[var(--theme-text-secondary)] mt-0.5">
                    {formatDateId((letter as IncomingLetter).letterDate, true)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Tanggal Diterima</dt>
                  <dd className="font-mono tabular-nums text-[var(--theme-text-secondary)] mt-0.5">
                    {formatDateId((letter as IncomingLetter).receivedDate, true)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Sifat & Klasifikasi</dt>
                  <dd className="text-[var(--theme-text-secondary)] mt-0.5">
                    {(letter as IncomingLetter).urgency} · Kode{' '}
                    <span className="font-mono">{letter.classificationCode}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Status Saat Ini</dt>
                  <dd className="mt-1">
                    {role !== 'staf' ? (
                      <select
                        value={(letter as IncomingLetter).status}
                        onChange={(e) =>
                          onUpdateIncomingStatus(
                            letter.id,
                            e.target.value as IncomingStatus
                          )
                        }
                        className="px-2.5 py-1 text-xs font-medium border border-[var(--theme-border-strong)] rounded bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                      >
                        {INCOMING_STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-block px-2.5 py-1 text-xs font-medium border border-[var(--theme-border)] rounded bg-[var(--theme-surface-subtle)] text-[var(--theme-text)]">
                        {(letter as IncomingLetter).status}
                      </span>
                    )}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Nomor Surat Keluar</dt>
                  <dd className="font-mono tabular-nums font-medium text-[var(--theme-text)] mt-0.5">
                    {(letter as OutgoingLetter).fullLetterNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Tujuan / Penerima</dt>
                  <dd className="font-medium text-[var(--theme-text)] mt-0.5">
                    {(letter as OutgoingLetter).recipient}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Tanggal Surat</dt>
                  <dd className="font-mono tabular-nums text-[var(--theme-text-secondary)] mt-0.5">
                    {formatDateId((letter as OutgoingLetter).letterDate, true)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Konseptor / Unit</dt>
                  <dd className="text-[var(--theme-text-secondary)] mt-0.5">
                    {(letter as OutgoingLetter).drafterName}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Kode Klasifikasi</dt>
                  <dd className="font-mono text-[var(--theme-text-secondary)] mt-0.5">
                    {letter.classificationCode}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--theme-text-muted)]">Status Surat</dt>
                  <dd className="mt-1">
                    {role !== 'staf' ? (
                      <select
                        value={(letter as OutgoingLetter).status}
                        onChange={(e) =>
                          onUpdateOutgoingStatus(
                            letter.id,
                            e.target.value as OutgoingStatus
                          )
                        }
                        className="px-2.5 py-1 text-xs font-medium border border-[var(--theme-border-strong)] rounded bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                      >
                        {OUTGOING_STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-block px-2.5 py-1 text-xs font-medium border border-[var(--theme-border)] rounded bg-[var(--theme-surface-subtle)] text-[var(--theme-text)]">
                        {(letter as OutgoingLetter).status}
                      </span>
                    )}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {/* Outgoing Letter Body Preview */}
          {!isIncoming && (letter as OutgoingLetter).bodyText && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-[var(--theme-text-secondary)]">Isi Naskah Surat</h3>
              <div className="text-xs text-[var(--theme-text-secondary)] leading-relaxed bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)] rounded-md p-3.5 whitespace-pre-wrap">
                {(letter as OutgoingLetter).bodyText}
              </div>
            </div>
          )}

          {/* Notes */}
          {letter.notes && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-[var(--theme-text-secondary)]">Catatan Arsip</h3>
              <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)] rounded-md p-3">
                {letter.notes}
              </p>
            </div>
          )}

          {/* Attachment with Inline Preview */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-[var(--theme-text-secondary)]">Lampiran Berkas</h3>
            <AttachmentPreviewBox
              url={letter.attachmentUrl}
              name={letter.attachmentName}
              compact
            />
          </div>

          {/* AI Letter Analysis & Disposition Recommendation */}
          <div className="border border-[var(--theme-accent)]/30 bg-[var(--theme-accent-tint)]/55 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0" />
                <div>
                  <h3 className="text-xs font-semibold text-[var(--theme-text)]">
                    Analisis &amp; Rekomendasi AI
                  </h3>
                  <p className="text-[11px] text-[var(--theme-text-muted)]">
                    {isIncoming
                      ? 'Ringkasan otomatis isi surat, prioritas, dan saran unit disposisi'
                      : 'Ringkasan eksekutif serta pemeriksaan tata naskah dinas'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={aiLoading}
                onClick={() => void handleAnalyzeWithAi()}
                className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {aiLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {aiLoading
                  ? 'Menganalisis...'
                  : aiInsight
                    ? 'Analisis Ulang'
                    : 'Analisis AI'}
              </button>
            </div>

            {aiError && (
              <div className="border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-3 py-2 rounded-md text-xs">
                {aiError}
              </div>
            )}

            {aiInsight && (
              <div className="space-y-3 pt-2 border-t border-[var(--theme-border)] text-xs">
                <p className="text-[var(--theme-text)] leading-relaxed">{aiInsight.summary}</p>

                {Array.isArray(aiInsight.keyPoints) && aiInsight.keyPoints.length > 0 && (
                  <ul className="space-y-1 text-[var(--theme-text-secondary)] list-disc pl-4">
                    {aiInsight.keyPoints.map((pt, idx) => (
                      <li key={`${idx}-${pt}`} className="leading-relaxed">
                        {pt}
                      </li>
                    ))}
                  </ul>
                )}

                {isIncoming && (
                  <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-md p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--theme-text)]">
                        Saran Disposisi: {aiInsight.recommendedUnit}
                      </span>
                      {aiInsight.urgencyAssessment && (
                        <span className="text-[11px] font-medium text-[var(--theme-accent-text)]">
                          {aiInsight.urgencyAssessment}
                        </span>
                      )}
                    </div>
                    <p className="text-[var(--theme-text-secondary)] leading-relaxed">
                      “{aiInsight.recommendedInstruction}”
                    </p>
                    {role !== 'staf' && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-[var(--theme-text-muted)]">
                          Estimasi batas waktu: +{aiInsight.recommendedDeadlineDays} hari kerja
                        </span>
                        <button
                          type="button"
                          onClick={handleApplyAiDisposition}
                          className="px-2.5 py-1 text-[11px] font-medium border border-[var(--theme-accent)] text-[var(--theme-accent-text)] rounded hover:bg-[var(--theme-accent-tint)] whitespace-nowrap"
                        >
                          Terapkan ke Form Disposisi
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {!isIncoming &&
                  Array.isArray(aiInsight.reviewNotes) &&
                  aiInsight.reviewNotes.length > 0 && (
                    <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-md p-3 space-y-1.5">
                      <div className="font-semibold text-[var(--theme-text)]">
                        Catatan Tata Naskah Dinas:
                      </div>
                      <ul className="space-y-1 text-[var(--theme-text-secondary)] list-disc pl-4">
                        {aiInsight.reviewNotes.map((note, idx) => (
                          <li key={`${idx}-${note}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Dispositions section for incoming */}
          {isIncoming && (
            <div className="space-y-3 pt-2 border-t border-[var(--theme-border)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                    Riwayat Disposisi ({dispositions.length})
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)]">
                    Instruksi pimpinan dan progres tindak lanjut unit terkait
                  </p>
                </div>
                {role !== 'staf' && !showDispForm && (
                  <button
                    type="button"
                    onClick={() => setShowDispForm(true)}
                    className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] inline-flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Tambah Disposisi
                  </button>
                )}
              </div>

              {showDispForm && (
                <form
                  onSubmit={handleSubmitDisp}
                  className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-md p-4 space-y-3"
                >
                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-[var(--theme-text-secondary)]">Diteruskan Kepada Unit *</span>
                    <select
                      value={targetUnit}
                      onChange={(e) => setTargetUnit(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                    >
                      {availableUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--theme-text-secondary)]">
                        Penerima Disposisi (Guru / Karyawan)
                      </span>
                      {role !== 'staf' && onCreateRecipient && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuickError('');
                            if (!quickAddOpen && !quickUnit) {
                              setQuickUnit(targetUnit);
                            }
                            setQuickAddOpen((prev) => !prev);
                          }}
                          className="text-[11px] font-medium text-[var(--theme-accent-text)] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <Plus className="w-3 h-3" />
                          {quickAddOpen ? 'Tutup Form Tambah' : 'Tambah Guru / Karyawan'}
                        </button>
                      )}
                    </div>

                    <select
                      aria-label="Pilih guru atau karyawan penerima disposisi"
                      value={selectedRecipientKey}
                      onChange={(e) => handleSelectRecipient(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                    >
                      <option value="">-- Tidak memilih nama khusus --</option>
                      {guruRecipients.length > 0 && (
                        <optgroup label="Guru">
                          {guruRecipients.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                              {person.unit ? ` · ${person.unit}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {karyawanRecipients.length > 0 && (
                        <optgroup label="Karyawan">
                          {karyawanRecipients.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                              {person.unit ? ` · ${person.unit}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="__manual__">-- Ketik Nama Manual Lainnya --</option>
                    </select>

                    {selectedRecipientKey === '__manual__' && (
                      <input
                        type="text"
                        value={targetStaffName}
                        onChange={(e) => setTargetStaffName(e.target.value)}
                        placeholder="Ketik nama guru atau karyawan..."
                        className="w-full px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                      />
                    )}

                    {quickAddOpen && (
                      <div className="border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] rounded-md p-3 space-y-2.5">
                        <div className="text-[11px] font-semibold text-[var(--theme-text)]">
                          Tambah Guru / Karyawan Baru ke Direktori Disposisi
                        </div>
                        {quickError && (
                          <div className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-2.5 py-1.5 rounded">
                            {quickError}
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={quickName}
                            onChange={(e) => setQuickName(e.target.value)}
                            placeholder="Nama lengkap & gelar *"
                            aria-label="Nama guru atau karyawan baru"
                            className="px-2.5 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                          />
                          <select
                            value={quickCategory}
                            onChange={(e) => setQuickCategory(e.target.value as StaffCategory)}
                            aria-label="Kategori guru atau karyawan"
                            className="px-2.5 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                          >
                            {STAFF_CATEGORY_OPTIONS.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={quickUnit}
                            onChange={(e) => setQuickUnit(e.target.value)}
                            list="drawer-unit-suggestions"
                            placeholder="Unit / Jabatan (opsional)"
                            aria-label="Unit atau jabatan"
                            className="px-2.5 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                          />
                          <input
                            type="text"
                            value={quickNip}
                            onChange={(e) => setQuickNip(e.target.value)}
                            placeholder="NIP (opsional)"
                            aria-label="NIP guru atau karyawan"
                            className="px-2.5 py-1.5 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                          />
                        </div>
                        <datalist id="drawer-unit-suggestions">
                          {availableUnits.map((u) => (
                            <option key={u} value={u} />
                          ))}
                        </datalist>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setQuickAddOpen(false)}
                            className="px-2.5 py-1 text-[11px] font-medium border border-[var(--theme-border-strong)] rounded text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            disabled={quickSaving}
                            onClick={() => void handleQuickCreateRecipient()}
                            className="px-3 py-1 text-[11px] font-medium bg-[var(--theme-accent)] text-white rounded hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
                          >
                            {quickSaving ? 'Menyimpan...' : 'Simpan & Pilih'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-[var(--theme-text-secondary)]">Batas Waktu</span>
                    <input
                      type="date"
                      value={deadlineDate}
                      onChange={(e) => setDeadlineDate(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                    />
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-[var(--theme-text-secondary)]">Isi Instruksi Disposisi *</span>
                    <textarea
                      required
                      rows={2}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="Contoh: Mohon segera ditindaklanjuti dan koordinasikan jadwal bersama wali kelas."
                      className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                    />
                  </label>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setQuickAddOpen(false);
                        setShowDispForm(false);
                      }}
                      className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={submittingDisp}
                      className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
                    >
                      {submittingDisp ? 'Mengirim...' : 'Simpan Disposisi'}
                    </button>
                  </div>
                </form>
              )}

              {dispositions.length === 0 ? (
                <p className="text-xs text-[var(--theme-text-muted)] py-2">
                  Surat ini belum memiliki lembar disposisi.
                </p>
              ) : (
                <div className="space-y-3">
                  {dispositions.map((d) => (
                    <div
                      key={d.id}
                      className="border border-[var(--theme-border)] rounded-md p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs">
                          <div className="font-semibold text-[var(--theme-text)]">
                            {d.targetUnit}
                            {d.targetStaffName ? ` · ${d.targetStaffName}` : ''}
                          </div>
                          <div className="text-[var(--theme-text-muted)] mt-0.5">
                            Oleh {d.createdBy}
                            {d.deadlineDate ? ` · Batas ${formatDateId(d.deadlineDate)}` : ''}
                          </div>
                        </div>
                        <span
                          className={`text-xs font-medium shrink-0 ${
                            d.status === 'Selesai'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : d.status === 'Sedang Diproses'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {d.status}
                        </span>
                      </div>

                      <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed">
                        {d.instruction}
                      </p>

                      {d.completionNote && (
                        <p className="text-xs text-[var(--theme-text-secondary)] bg-[var(--theme-surface-subtle)] px-2.5 py-1.5 rounded border border-[var(--theme-border)]">
                          Laporan: {d.completionNote}
                        </p>
                      )}

                      {d.status !== 'Selesai' && (
                        <div className="flex items-center gap-2 pt-1">
                          {d.status === 'Belum Ditindaklanjuti' && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateDisposition(letter.id, d.id, {
                                  status: 'Sedang Diproses',
                                  completionNote: d.completionNote,
                                })
                              }
                              className="px-2.5 py-1 text-[11px] font-medium border border-[var(--theme-border-strong)] rounded text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
                            >
                              Mulai Proses
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateDisposition(letter.id, d.id, {
                                status: 'Selesai',
                                completionNote: d.completionNote || 'Telah ditindaklanjuti.',
                              })
                            }
                            className="px-2.5 py-1 text-[11px] font-medium bg-emerald-700 text-white rounded hover:bg-emerald-800 inline-flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Tandai Selesai
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
