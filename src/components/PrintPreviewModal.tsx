import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, FilePenLine, FileText, Printer, X } from 'lucide-react';
import type {
  IncomingLetter,
  OutgoingLetter,
  SchoolSettings,
} from '../types.ts';
import { STAFF_UNITS } from '../types.ts';
import { formatDateId } from '../lib/format.ts';
import {
  exportDispositionPdf,
  exportIncomingAgendaPdf,
  exportIncomingLetterPdf,
  exportMonthlyReportPdf,
  exportOutgoingAgendaPdf,
  exportOutgoingLetterPdf,
  getStoredPdfOrientation,
  savePdfOrientation,
  type PdfOrientation,
} from '../lib/pdfExport.ts';
import {
  detectFullMonthYm,
  filterLettersByDateRange,
  getDefaultMonthDateRange,
  getMonthDateRange,
  getMonthDateRangeFromYm,
  getPreviousMonthDateRange,
  normalizeDateRange,
  type ReportScope,
} from '../lib/reportUtils.ts';
import { collectAvailableYears } from '../lib/yearUtils.ts';
import { AttachmentPreviewBox } from './AttachmentPreviewBox.tsx';

export type PrintDocumentTarget =
  | { kind: 'incoming_letter'; letter: IncomingLetter }
  | { kind: 'outgoing_letter'; letter: OutgoingLetter }
  | { kind: 'disposition'; letter: IncomingLetter }
  | { kind: 'incoming_agenda'; letters: IncomingLetter[]; periodLabel: string }
  | { kind: 'outgoing_agenda'; letters: OutgoingLetter[]; periodLabel: string }
  | {
      kind: 'monthly_report';
      incomingLetters: IncomingLetter[];
      outgoingLetters: OutgoingLetter[];
      initialStartDate?: string;
      initialEndDate?: string;
    };

interface PrintPreviewModalProps {
  target: PrintDocumentTarget;
  settings: SchoolSettings;
  canEdit?: boolean;
  isAdmin?: boolean;
  onEditLetter?: (
    letterTarget:
      | { kind: 'incoming'; letter: IncomingLetter }
      | { kind: 'outgoing'; letter: OutgoingLetter }
  ) => void;
  onNotify?: (message: string, tone?: 'success' | 'error') => void;
  onClose: () => void;
}

type SinglePreviewTab = 'document' | 'disposition' | 'attachment';

export function PrintPreviewModal({
  target,
  settings,
  canEdit = false,
  isAdmin = false,
  onEditLetter,
  onNotify,
  onClose,
}: PrintPreviewModalProps) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [orientation, setOrientation] = useState<PdfOrientation>(() =>
    getStoredPdfOrientation()
  );
  const [activeView, setActiveView] = useState<SinglePreviewTab>(
    target.kind === 'disposition' ? 'disposition' : 'document'
  );
  const [reportStartDate, setReportStartDate] = useState<string>(() =>
    target.kind === 'monthly_report' && target.initialStartDate
      ? target.initialStartDate
      : getDefaultMonthDateRange().startDate
  );
  const [reportEndDate, setReportEndDate] = useState<string>(() =>
    target.kind === 'monthly_report' && target.initialEndDate
      ? target.initialEndDate
      : getDefaultMonthDateRange().endDate
  );
  const [reportScope, setReportScope] = useState<ReportScope>('both');

  const handleChangeOrientation = (next: PdfOrientation) => {
    setOrientation(next);
    savePdfOrientation(next);
  };

  useEffect(() => {
    setActiveView(target.kind === 'disposition' ? 'disposition' : 'document');
    if (target.kind === 'monthly_report') {
      const defaults = getDefaultMonthDateRange();
      setReportStartDate(target.initialStartDate || defaults.startDate);
      setReportEndDate(target.initialEndDate || defaults.endDate);
      setReportScope('both');
    }
  }, [target]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const normalizedReportRange = useMemo(
    () => normalizeDateRange(reportStartDate, reportEndDate),
    [reportStartDate, reportEndDate]
  );

  const selectedMonthYm = useMemo(
    () => detectFullMonthYm(normalizedReportRange.startDate, normalizedReportRange.endDate),
    [normalizedReportRange.startDate, normalizedReportRange.endDate]
  );

  const reportActiveYear = useMemo(() => {
    const parsed = Number(normalizedReportRange.startDate.slice(0, 4));
    return parsed >= 2000 && parsed <= 2100 ? parsed : new Date().getFullYear();
  }, [normalizedReportRange.startDate]);

  const reportActiveMonth = useMemo(() => {
    const parsed = Number(normalizedReportRange.startDate.slice(5, 7));
    return parsed >= 1 && parsed <= 12 ? parsed : new Date().getMonth() + 1;
  }, [normalizedReportRange.startDate]);

  const reportAvailableYears = useMemo(() => {
    if (target.kind !== 'monthly_report') return [];
    return collectAvailableYears({
      incoming: target.incomingLetters,
      outgoing: target.outgoingLetters,
      activeYear: reportActiveYear,
    });
  }, [target, reportActiveYear]);

  const monthlyReportData = useMemo(() => {
    if (target.kind !== 'monthly_report') return null;
    return filterLettersByDateRange(
      target.incomingLetters,
      target.outgoingLetters,
      normalizedReportRange.startDate,
      normalizedReportRange.endDate
    );
  }, [target, normalizedReportRange.startDate, normalizedReportRange.endDate]);

  const todayLong = formatDateId(new Date().toISOString().slice(0, 10), true);

  const isSingleIncoming =
    target.kind === 'incoming_letter' || target.kind === 'disposition';
  const isSingleOutgoing = target.kind === 'outgoing_letter';
  const singleLetter =
    isSingleIncoming || isSingleOutgoing ? target.letter : null;

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      if (target.kind === 'disposition' || (target.kind === 'incoming_letter' && activeView === 'disposition')) {
        await exportDispositionPdf(target.letter, settings, orientation);
      } else if (target.kind === 'incoming_letter') {
        await exportIncomingLetterPdf(target.letter, settings, orientation);
      } else if (target.kind === 'outgoing_letter') {
        await exportOutgoingLetterPdf(target.letter, settings, orientation);
      } else if (target.kind === 'incoming_agenda') {
        await exportIncomingAgendaPdf(target.letters, settings, target.periodLabel, orientation);
      } else if (target.kind === 'outgoing_agenda') {
        await exportOutgoingAgendaPdf(target.letters, settings, target.periodLabel, orientation);
      } else if (target.kind === 'monthly_report') {
        await exportMonthlyReportPdf({
          incomingLetters: target.incomingLetters,
          outgoingLetters: target.outgoingLetters,
          settings,
          startDate: normalizedReportRange.startDate,
          endDate: normalizedReportRange.endDate,
          scope: reportScope,
          orientation,
        });
      }
      onNotify?.('Dokumen PDF berhasil diunduh.');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Gagal membuat berkas PDF dokumen.',
        'error'
      );
    } finally {
      setDownloadingPdf(false);
    }
  };

  const renderIncomingLetterSheet = (letter: IncomingLetter) => (
    <div className="mt-6 space-y-5 text-xs">
      <div className="text-center">
        <h1 className="text-base font-bold uppercase tracking-wide underline underline-offset-4">
          KARTU KENDALI &amp; PRATINJAU SURAT MASUK
        </h1>
      </div>

      <table className="w-full border-collapse border border-black text-xs">
        <tbody>
          <tr>
            <td className="border border-black p-2.5 w-48 font-semibold bg-slate-50">
              Nomor Agenda Sekolah
            </td>
            <td className="border border-black p-2.5 font-mono font-semibold">
              {letter.agendaNumber}
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Nomor Surat Asal
            </td>
            <td className="border border-black p-2.5 font-mono">
              {letter.letterNumber}
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Tanggal Surat / Diterima
            </td>
            <td className="border border-black p-2.5 font-mono">
              {formatDateId(letter.letterDate, true)} · Diterima:{' '}
              {formatDateId(letter.receivedDate, true)}
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Asal / Pengirim Surat
            </td>
            <td className="border border-black p-2.5 font-medium">
              {letter.sender}
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Perihal Surat
            </td>
            <td className="border border-black p-2.5 font-semibold leading-relaxed">
              {letter.subject}
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Klasifikasi, Sifat &amp; Status
            </td>
            <td className="border border-black p-2.5">
              Kode <span className="font-mono">{letter.classificationCode}</span> · Sifat:{' '}
              <strong>{letter.urgency}</strong> · Status: <strong>{letter.status}</strong>
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Lampiran Digital
            </td>
            <td className="border border-black p-2.5">
              {letter.attachmentName || letter.attachmentUrl || '-'}
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 font-semibold bg-slate-50">
              Catatan Arsip
            </td>
            <td className="border border-black p-2.5 leading-relaxed">
              {letter.notes || '-'}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="space-y-2">
        <div className="font-bold text-xs uppercase tracking-wide">
          Riwayat Disposisi Pimpinan ({letter.dispositions.length})
        </div>
        {letter.dispositions.length > 0 ? (
          <table className="w-full border-collapse border border-black text-[11px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-black p-2 text-left">Unit / Tujuan</th>
                <th className="border border-black p-2 text-left">Instruksi Disposisi</th>
                <th className="border border-black p-2 text-left">Batas Waktu</th>
                <th className="border border-black p-2 text-left">Status &amp; Laporan</th>
              </tr>
            </thead>
            <tbody>
              {letter.dispositions.map((d) => (
                <tr key={d.id}>
                  <td className="border border-black p-2 align-top">
                    <div className="font-semibold">{d.targetUnit}</div>
                    {d.targetStaffName && <div>({d.targetStaffName})</div>}
                  </td>
                  <td className="border border-black p-2 align-top">{d.instruction}</td>
                  <td className="border border-black p-2 font-mono whitespace-nowrap align-top">
                    {d.deadlineDate ? formatDateId(d.deadlineDate) : '-'}
                  </td>
                  <td className="border border-black p-2 align-top">
                    <div className="font-semibold">{d.status}</div>
                    {d.completionNote && <div className="mt-0.5">{d.completionNote}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[11px] text-slate-600 italic">
            Belum ada disposisi yang dicatat untuk surat ini.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 pt-6 text-[11px]">
        <div>
          <div>Mengetahui,</div>
          <div>Kepala {settings.schoolName}</div>
          <div className="mt-14 font-semibold underline">{settings.principalName}</div>
          <div>NIP. {settings.principalNip || '-'}</div>
        </div>
        <div className="pl-12">
          <div>Girimulyo, {todayLong}</div>
          <div>Bagian Tata Usaha</div>
          <div className="mt-14 font-semibold underline">{settings.tuHeadName}</div>
          <div>NIP. {settings.tuHeadNip || '-'}</div>
        </div>
      </div>
    </div>
  );

  const renderDispositionSheet = (letter: IncomingLetter) => (
    <div className="mt-6 space-y-5 text-xs">
      <div className="text-center">
        <h1 className="text-base font-bold uppercase tracking-wide underline underline-offset-4">
          LEMBAR DISPOSISI
        </h1>
      </div>

      <table className="w-full border-collapse border border-black text-xs">
        <tbody>
          <tr>
            <td className="border border-black p-2 w-1/2 align-top">
              <div className="text-[11px] text-slate-700">Surat Dari:</div>
              <div className="font-semibold mt-0.5">{letter.sender}</div>
            </td>
            <td className="border border-black p-2 w-1/2 align-top">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-slate-700">Diterima Tanggal:</div>
                  <div className="font-mono font-semibold mt-0.5">
                    {formatDateId(letter.receivedDate, true)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-700">Nomor Agenda:</div>
                  <div className="font-mono font-semibold mt-0.5">
                    {letter.agendaNumber}
                  </div>
                </div>
              </div>
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2 align-top">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-slate-700">Nomor Surat:</div>
                  <div className="font-mono font-semibold mt-0.5">
                    {letter.letterNumber}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-700">Tanggal Surat:</div>
                  <div className="font-mono font-semibold mt-0.5">
                    {formatDateId(letter.letterDate, true)}
                  </div>
                </div>
              </div>
            </td>
            <td className="border border-black p-2 align-top">
              <div className="text-[11px] text-slate-700">Sifat Surat:</div>
              <div className="flex flex-wrap gap-4 mt-1 font-medium">
                {(['Biasa', 'Penting', 'Segera', 'Rahasia'] as const).map((u) => (
                  <span key={u}>
                    [{letter.urgency === u ? '✓' : ' '}] {u}
                  </span>
                ))}
              </div>
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black p-2.5 align-top">
              <div className="text-[11px] text-slate-700">Perihal:</div>
              <div className="font-semibold mt-0.5 leading-relaxed">
                {letter.subject}
              </div>
            </td>
          </tr>
          <tr>
            <td className="border border-black p-2.5 align-top">
              <div className="font-semibold mb-1.5">Diteruskan Kepada Yth.:</div>
              <div className="space-y-1">
                {STAFF_UNITS.slice(0, 7).map((unit) => {
                  const checked = letter.dispositions.some((d) => d.targetUnit === unit);
                  return (
                    <div key={unit} className="flex items-start gap-1.5">
                      <span className="font-mono">[{checked ? '✓' : ' '}]</span>
                      <span>{unit}</span>
                    </div>
                  );
                })}
              </div>
            </td>
            <td className="border border-black p-2.5 align-top">
              <div className="font-semibold mb-1.5">Catatan / Isi Disposisi Pimpinan:</div>
              {letter.dispositions.length > 0 ? (
                <div className="space-y-2">
                  {letter.dispositions.map((d, idx) => (
                    <div
                      key={d.id}
                      className="pb-1.5 border-b border-dotted border-slate-400 last:border-none"
                    >
                      <div className="font-medium">
                        {idx + 1}. {d.targetUnit}
                        {d.targetStaffName ? ` (${d.targetStaffName})` : ''}
                      </div>
                      <div className="mt-0.5">{d.instruction}</div>
                      {d.deadlineDate && (
                        <div className="text-[11px] text-slate-700 mt-0.5">
                          Batas tindak lanjut: {formatDateId(d.deadlineDate, true)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-28" />
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 pt-4">
        <div className="text-[11px]">
          <div>Dicatat oleh Tata Usaha</div>
          <div className="mt-14 font-semibold underline">{settings.tuHeadName}</div>
          <div>NIP. {settings.tuHeadNip || '-'}</div>
        </div>
        <div className="text-[11px] pl-12">
          <div>Girimulyo, {todayLong}</div>
          <div>Kepala {settings.schoolName}</div>
          <div className="mt-14 font-semibold underline">{settings.principalName}</div>
          <div>NIP. {settings.principalNip || '-'}</div>
        </div>
      </div>
    </div>
  );

  const renderOutgoingLetterSheet = (letter: OutgoingLetter) => {
    const fallbackBody = [
      'Dengan hormat,',
      '',
      `Sehubungan dengan ${letter.subject}, bersama surat ini kami sampaikan pemberitahuan resmi dari ${settings.schoolName} untuk dapat ditindaklanjuti sebagaimana mestinya.`,
      letter.notes ? `Keterangan tambahan: ${letter.notes}` : '',
      '',
      'Demikian surat ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.',
    ]
      .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
      .join('\n');

    const bodyParagraphs = ((letter.bodyText || '').trim() || fallbackBody).split('\n');

    return (
      <div className="mt-6 space-y-6 text-[13px] leading-relaxed">
        <div className="text-right text-xs">
          Girimulyo, {formatDateId(letter.letterDate, true)}
        </div>

        <table className="text-xs border-collapse">
          <tbody>
            <tr>
              <td className="pr-4 py-0.5 align-top w-20">Nomor</td>
              <td className="pr-2 py-0.5 align-top">:</td>
              <td className="py-0.5 font-mono font-semibold">{letter.fullLetterNumber}</td>
            </tr>
            <tr>
              <td className="pr-4 py-0.5 align-top">Lampiran</td>
              <td className="pr-2 py-0.5 align-top">:</td>
              <td className="py-0.5">
                {letter.attachmentName ? `1 berkas (${letter.attachmentName})` : '-'}
              </td>
            </tr>
            <tr>
              <td className="pr-4 py-0.5 align-top">Hal</td>
              <td className="pr-2 py-0.5 align-top">:</td>
              <td className="py-0.5 font-semibold">{letter.subject}</td>
            </tr>
          </tbody>
        </table>

        <div className="text-xs space-y-0.5 pt-2">
          <div>Kepada Yth.</div>
          <div className="font-semibold">{letter.recipient}</div>
          <div>di Tempat</div>
        </div>

        <div className="space-y-3 pt-2 text-[13px]">
          {bodyParagraphs.map((para, idx) =>
            para.trim() ? (
              <p key={idx} className="whitespace-pre-wrap">
                {para}
              </p>
            ) : (
              <div key={idx} className="h-1" />
            )
          )}
        </div>

        <div className="grid grid-cols-2 pt-8 text-xs">
          <div className="text-[11px] text-slate-600 self-end">
            <div>Konseptor: {letter.drafterName}</div>
            <div>Status: {letter.status}</div>
          </div>
          <div className="pl-12">
            <div>Kepala {settings.schoolName}</div>
            <div className="mt-16 font-semibold underline">{settings.principalName}</div>
            <div>NIP. {settings.principalNip || '-'}</div>
          </div>
        </div>
      </div>
    );
  };

  const sheetWidthClass = orientation === 'landscape' ? 'max-w-6xl' : 'max-w-4xl';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 overflow-y-auto p-4 sm:p-8 print:p-0 print:bg-white print:static">
      <style>{`@media print { @page { size: A4 ${orientation}; margin: 14mm 15mm; } }`}</style>
      <div className={`${sheetWidthClass} mx-auto mb-4 bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl px-5 py-3 space-y-3 no-print shadow-lg transition-all`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            <span className="font-semibold text-[var(--theme-text)]">
              Pratinjau Dokumen Resmi (A4 {orientation === 'landscape' ? 'Landscape' : 'Portrait'})
            </span>
            <span className="text-[var(--theme-text-muted)] ml-2">
              {target.kind === 'outgoing_letter'
                ? 'Naskah Surat Keluar'
                : target.kind === 'incoming_letter'
                  ? 'Surat Masuk & Disposisi'
                  : target.kind === 'disposition'
                    ? 'Lembar Disposisi Resmi'
                    : target.kind === 'monthly_report'
                      ? 'Laporan Bulanan Surat Masuk & Keluar'
                      : 'Buku Agenda Resmi'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Orientasi cetak dan PDF"
              className="inline-flex items-center p-0.5 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg"
            >
              <button
                type="button"
                onClick={() => handleChangeOrientation('portrait')}
                aria-pressed={orientation === 'portrait'}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  orientation === 'portrait'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Portrait
              </button>
              <button
                type="button"
                onClick={() => handleChangeOrientation('landscape')}
                aria-pressed={orientation === 'landscape'}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  orientation === 'landscape'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Landscape
              </button>
            </div>
            {canEdit && singleLetter && onEditLetter && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (isSingleIncoming) {
                    onEditLetter({ kind: 'incoming', letter: target.letter });
                  } else if (isSingleOutgoing) {
                    onEditLetter({ kind: 'outgoing', letter: target.letter });
                  }
                }}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <FilePenLine className="w-3.5 h-3.5" />
                Edit Surat
              </button>
            )}
            <button
              type="button"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
              className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Membuat PDF...' : 'Unduh PDF'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Cetak
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Tutup
            </button>
          </div>
        </div>

        {(isSingleIncoming || isSingleOutgoing) && singleLetter && (
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setActiveView('document')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeView === 'document'
                  ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                  : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
              }`}
            >
              {isSingleIncoming ? 'Kartu Surat Masuk' : 'Naskah Surat Keluar'}
            </button>
            {isSingleIncoming && (
              <button
                type="button"
                onClick={() => setActiveView('disposition')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeView === 'disposition'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Lembar Disposisi
              </button>
            )}
            {singleLetter.attachmentUrl && (
              <button
                type="button"
                onClick={() => setActiveView('attachment')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeView === 'attachment'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Lampiran Berkas
              </button>
            )}
          </div>
        )}

        {target.kind === 'monthly_report' && isAdmin && monthlyReportData && (
          <div className="pt-3 border-t border-[var(--theme-border)] space-y-2.5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="space-y-1 text-[11px]">
                  <span className="font-medium text-[var(--theme-text-muted)] flex items-center gap-1">
                    <CalendarRange className="w-3 h-3" />
                    Tahun Laporan
                  </span>
                  <select
                    value={String(reportActiveYear)}
                    onChange={(e) => {
                      const nextYear = Number(e.target.value);
                      if (
                        normalizedReportRange.startDate.endsWith('-01-01') &&
                        normalizedReportRange.endDate.endsWith('-12-31')
                      ) {
                        setReportStartDate(`${nextYear}-01-01`);
                        setReportEndDate(`${nextYear}-12-31`);
                      } else {
                        const range = getMonthDateRange(nextYear, reportActiveMonth);
                        setReportStartDate(range.startDate);
                        setReportEndDate(range.endDate);
                      }
                    }}
                    aria-label="Pilih tahun laporan"
                    className="px-2.5 py-1.5 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    {reportAvailableYears.map((yr) => (
                      <option key={yr} value={String(yr)}>
                        Tahun {yr}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-[11px]">
                  <span className="block font-medium text-[var(--theme-text-muted)]">
                    Pilih Bulan
                  </span>
                  <input
                    type="month"
                    value={selectedMonthYm}
                    onChange={(e) => {
                      const range = getMonthDateRangeFromYm(e.target.value);
                      if (range) {
                        setReportStartDate(range.startDate);
                        setReportEndDate(range.endDate);
                      }
                    }}
                    aria-label="Pilih bulan laporan"
                    className="px-2.5 py-1.5 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-[11px]">
                  <span className="block font-medium text-[var(--theme-text-muted)]">
                    Dari Tanggal
                  </span>
                  <input
                    type="date"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                    aria-label="Tanggal mulai laporan"
                    className="px-2.5 py-1.5 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-[11px]">
                  <span className="block font-medium text-[var(--theme-text-muted)]">
                    Sampai Tanggal
                  </span>
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                    aria-label="Tanggal akhir laporan"
                    className="px-2.5 py-1.5 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const curr = getDefaultMonthDateRange();
                      setReportStartDate(curr.startDate);
                      setReportEndDate(curr.endDate);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap shrink-0"
                  >
                    Bulan Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const prev = getPreviousMonthDateRange();
                      setReportStartDate(prev.startDate);
                      setReportEndDate(prev.endDate);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap shrink-0"
                  >
                    Bulan Lalu
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReportStartDate(`${reportActiveYear}-01-01`);
                      setReportEndDate(`${reportActiveYear}-12-31`);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap shrink-0"
                  >
                    1 Tahun ({reportActiveYear})
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div
                  role="group"
                  aria-label="Cakupan jenis surat laporan"
                  className="inline-flex items-center p-0.5 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg"
                >
                  {(
                    [
                      { id: 'both', label: 'Masuk & Keluar' },
                      { id: 'incoming', label: 'Surat Masuk' },
                      { id: 'outgoing', label: 'Surat Keluar' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setReportScope(opt.id)}
                      aria-pressed={reportScope === opt.id}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        reportScope === opt.id
                          ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="text-xs font-mono tabular-nums text-[var(--theme-text-secondary)] whitespace-nowrap">
                  {monthlyReportData.summary.incomingTotal} Masuk ·{' '}
                  {monthlyReportData.summary.outgoingTotal} Keluar
                </div>
              </div>
            </div>

            {normalizedReportRange.isSwapped && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Rentang tanggal otomatis disesuaikan berurutan dari{' '}
                <span className="font-mono">{formatDateId(normalizedReportRange.startDate, true)}</span>{' '}
                sampai{' '}
                <span className="font-mono">{formatDateId(normalizedReportRange.endDate, true)}</span>.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Inline Attachment View (Screen only when tab "Lampiran Berkas" selected) */}
      {singleLetter && activeView === 'attachment' ? (
        <div className={`${sheetWidthClass} mx-auto bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl p-6 shadow-sm no-print transition-all`}>
          <h2 className="text-sm font-semibold text-[var(--theme-text)] mb-3">
            Pratinjau Lampiran Digital —{' '}
            {isSingleIncoming
              ? (singleLetter as IncomingLetter).agendaNumber
              : (singleLetter as OutgoingLetter).fullLetterNumber}
          </h2>
          <AttachmentPreviewBox
            url={singleLetter.attachmentUrl}
            name={singleLetter.attachmentName}
          />
        </div>
      ) : (
        /* Printable Sheet */
        <div className={`print-only-sheet ${sheetWidthClass} mx-auto bg-white text-black border border-slate-300 p-8 sm:p-10 shadow-sm print:border-none print:shadow-none print:p-0 print:max-w-none transition-all`}>
          {/* Kop Surat Resmi */}
          {settings.kopImageUrl ? (
            <header className="mb-1">
              <img
                src={settings.kopImageUrl}
                alt={`Kop Surat ${settings.schoolName}`}
                className="w-full max-h-44 object-contain mx-auto block"
                referrerPolicy="no-referrer"
              />
            </header>
          ) : (
            <header className="pb-3 border-b-[3px] border-double border-black text-center leading-tight">
              <div className="text-xs font-semibold uppercase tracking-wide">
                {settings.districtGov}
              </div>
              <div className="text-sm font-semibold uppercase tracking-wide">
                {settings.parentAgency}
              </div>
              <div className="text-xl font-bold uppercase tracking-wider mt-0.5">
                {settings.schoolName}
              </div>
              <div className="text-[11px] mt-1">
                Alamat: {settings.address} {settings.postalCode} · Telp. {settings.phone}
              </div>
              <div className="text-[11px]">
                Laman: {settings.website} · Pos-el: {settings.email} · NPSN: {settings.npsn}
              </div>
            </header>
          )}

          {isSingleIncoming &&
            (activeView === 'disposition'
              ? renderDispositionSheet(target.letter)
              : renderIncomingLetterSheet(target.letter))}

          {isSingleOutgoing && renderOutgoingLetterSheet(target.letter)}

          {(target.kind === 'incoming_agenda' || target.kind === 'outgoing_agenda') && (
            <div className="mt-6 space-y-4 text-xs">
              <div className="text-center">
                <h1 className="text-sm font-bold uppercase tracking-wide">
                  {target.kind === 'incoming_agenda'
                    ? 'BUKU AGENDA SURAT MASUK'
                    : 'BUKU AGENDA SURAT KELUAR'}
                </h1>
                <p className="text-[11px] mt-0.5">
                  {target.periodLabel} · Dicetak tanggal {todayLong}
                </p>
              </div>

              {target.kind === 'incoming_agenda' ? (
                <table className="w-full border-collapse border border-black text-[11px]">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-black p-1.5 text-left">No. Agenda</th>
                      <th className="border border-black p-1.5 text-left">Tgl Terima</th>
                      <th className="border border-black p-1.5 text-left">Nomor &amp; Tgl Surat</th>
                      <th className="border border-black p-1.5 text-left">Pengirim</th>
                      <th className="border border-black p-1.5 text-left">Perihal</th>
                      <th className="border border-black p-1.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {target.letters.map((l) => (
                      <tr key={l.id}>
                        <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                          {l.agendaNumber}
                        </td>
                        <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                          {formatDateId(l.receivedDate)}
                        </td>
                        <td className="border border-black p-1.5 font-mono align-top">
                          <div>{l.letterNumber}</div>
                          <div className="text-[10px]">{formatDateId(l.letterDate)}</div>
                        </td>
                        <td className="border border-black p-1.5 align-top">{l.sender}</td>
                        <td className="border border-black p-1.5 align-top">{l.subject}</td>
                        <td className="border border-black p-1.5 whitespace-nowrap align-top">
                          {l.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse border border-black text-[11px]">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-black p-1.5 text-left">No. Urut</th>
                      <th className="border border-black p-1.5 text-left">Nomor Surat Keluar</th>
                      <th className="border border-black p-1.5 text-left">Tgl Surat</th>
                      <th className="border border-black p-1.5 text-left">Tujuan</th>
                      <th className="border border-black p-1.5 text-left">Perihal</th>
                      <th className="border border-black p-1.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {target.letters.map((l) => (
                      <tr key={l.id}>
                        <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                          {l.sequenceNumber > 0
                            ? String(l.sequenceNumber).padStart(3, '0')
                            : 'Manual'}
                        </td>
                        <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                          {l.fullLetterNumber}
                        </td>
                        <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                          {formatDateId(l.letterDate)}
                        </td>
                        <td className="border border-black p-1.5 align-top">{l.recipient}</td>
                        <td className="border border-black p-1.5 align-top">{l.subject}</td>
                        <td className="border border-black p-1.5 whitespace-nowrap align-top">
                          {l.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="grid grid-cols-2 pt-6 text-[11px]">
                <div>
                  <div>Mengetahui,</div>
                  <div>Kepala {settings.schoolName}</div>
                  <div className="mt-14 font-semibold underline">{settings.principalName}</div>
                  <div>NIP. {settings.principalNip || '-'}</div>
                </div>
                <div className="pl-12">
                  <div>Girimulyo, {todayLong}</div>
                  <div>Bagian Tata Usaha</div>
                  <div className="mt-14 font-semibold underline">{settings.tuHeadName}</div>
                  <div>NIP. {settings.tuHeadNip || '-'}</div>
                </div>
              </div>
            </div>
          )}
          {target.kind === 'monthly_report' && monthlyReportData && (
            <div className="mt-6 space-y-5 text-xs">
              <div className="text-center">
                <h1 className="text-sm font-bold uppercase tracking-wide">
                  {reportScope === 'incoming'
                    ? 'LAPORAN BULANAN SURAT MASUK'
                    : reportScope === 'outgoing'
                      ? 'LAPORAN BULANAN SURAT KELUAR'
                      : 'LAPORAN BULANAN SURAT MASUK DAN SURAT KELUAR'}
                </h1>
                <p className="text-[11px] mt-0.5">
                  Periode: {formatDateId(monthlyReportData.startDate, true)} s.d.{' '}
                  {formatDateId(monthlyReportData.endDate, true)} · Dicetak tanggal {todayLong}
                </p>
              </div>

              {/* Ringkasan Rekapitulasi */}
              <table className="w-full border-collapse border border-black text-[11px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-black p-1.5 text-left w-36">Jenis Naskah</th>
                    <th className="border border-black p-1.5 text-left w-28">Jumlah</th>
                    <th className="border border-black p-1.5 text-left">
                      Rincian Status pada Rentang Tanggal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(reportScope === 'both' || reportScope === 'incoming') && (
                    <tr>
                      <td className="border border-black p-1.5 font-semibold">Surat Masuk</td>
                      <td className="border border-black p-1.5 font-mono font-semibold">
                        {monthlyReportData.summary.incomingTotal} surat
                      </td>
                      <td className="border border-black p-1.5">
                        Selesai: {monthlyReportData.summary.incomingCompleted} · Didisposisikan:{' '}
                        {monthlyReportData.summary.incomingDisposed} · Menunggu:{' '}
                        {monthlyReportData.summary.incomingPending} (
                        {monthlyReportData.summary.dispositionTotal} catatan disposisi)
                      </td>
                    </tr>
                  )}
                  {(reportScope === 'both' || reportScope === 'outgoing') && (
                    <tr>
                      <td className="border border-black p-1.5 font-semibold">Surat Keluar</td>
                      <td className="border border-black p-1.5 font-mono font-semibold">
                        {monthlyReportData.summary.outgoingTotal} surat
                      </td>
                      <td className="border border-black p-1.5">
                        Terkirim: {monthlyReportData.summary.outgoingSent} · Diarsipkan:{' '}
                        {monthlyReportData.summary.outgoingArchived} · Draf/Menunggu TTD:{' '}
                        {monthlyReportData.summary.outgoingWaiting}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {(reportScope === 'both' || reportScope === 'incoming') && (
                <div className="space-y-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide">
                    A. Daftar Surat Masuk ({monthlyReportData.incoming.length} berkas)
                  </h2>
                  <table className="w-full border-collapse border border-black text-[11px]">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-black p-1.5 text-center w-8">No</th>
                        <th className="border border-black p-1.5 text-left">No. Agenda</th>
                        <th className="border border-black p-1.5 text-left">Tgl Terima</th>
                        <th className="border border-black p-1.5 text-left">Nomor &amp; Tgl Surat</th>
                        <th className="border border-black p-1.5 text-left">Pengirim</th>
                        <th className="border border-black p-1.5 text-left">Perihal</th>
                        <th className="border border-black p-1.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyReportData.incoming.length > 0 ? (
                        monthlyReportData.incoming.map((l, idx) => (
                          <tr key={l.id}>
                            <td className="border border-black p-1.5 text-center font-mono align-top">
                              {idx + 1}
                            </td>
                            <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                              {l.agendaNumber}
                            </td>
                            <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                              {formatDateId(l.receivedDate)}
                            </td>
                            <td className="border border-black p-1.5 font-mono align-top">
                              <div>{l.letterNumber}</div>
                              <div className="text-[10px]">{formatDateId(l.letterDate)}</div>
                            </td>
                            <td className="border border-black p-1.5 align-top">{l.sender}</td>
                            <td className="border border-black p-1.5 align-top">{l.subject}</td>
                            <td className="border border-black p-1.5 whitespace-nowrap align-top">
                              {l.status}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={7}
                            className="border border-black p-3 text-center italic text-slate-600"
                          >
                            Tidak ada data surat masuk pada rentang tanggal ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {(reportScope === 'both' || reportScope === 'outgoing') && (
                <div className="space-y-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide">
                    {reportScope === 'both' ? 'B.' : 'A.'} Daftar Surat Keluar (
                    {monthlyReportData.outgoing.length} berkas)
                  </h2>
                  <table className="w-full border-collapse border border-black text-[11px]">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-black p-1.5 text-center w-8">No</th>
                        <th className="border border-black p-1.5 text-left">No. Urut</th>
                        <th className="border border-black p-1.5 text-left">Nomor Surat Keluar</th>
                        <th className="border border-black p-1.5 text-left">Tgl Surat</th>
                        <th className="border border-black p-1.5 text-left">Tujuan</th>
                        <th className="border border-black p-1.5 text-left">Perihal</th>
                        <th className="border border-black p-1.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyReportData.outgoing.length > 0 ? (
                        monthlyReportData.outgoing.map((l, idx) => (
                          <tr key={l.id}>
                            <td className="border border-black p-1.5 text-center font-mono align-top">
                              {idx + 1}
                            </td>
                            <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                              {l.sequenceNumber > 0
                                ? String(l.sequenceNumber).padStart(3, '0')
                                : 'Manual'}
                            </td>
                            <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                              {l.fullLetterNumber}
                            </td>
                            <td className="border border-black p-1.5 font-mono whitespace-nowrap align-top">
                              {formatDateId(l.letterDate)}
                            </td>
                            <td className="border border-black p-1.5 align-top">{l.recipient}</td>
                            <td className="border border-black p-1.5 align-top">{l.subject}</td>
                            <td className="border border-black p-1.5 whitespace-nowrap align-top">
                              {l.status}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={7}
                            className="border border-black p-3 text-center italic text-slate-600"
                          >
                            Tidak ada data surat keluar pada rentang tanggal ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-2 pt-6 text-[11px]">
                <div>
                  <div>Mengetahui,</div>
                  <div>Kepala {settings.schoolName}</div>
                  <div className="mt-14 font-semibold underline">{settings.principalName}</div>
                  <div>NIP. {settings.principalNip || '-'}</div>
                </div>
                <div className="pl-12">
                  <div>Girimulyo, {todayLong}</div>
                  <div>Bagian Tata Usaha</div>
                  <div className="mt-14 font-semibold underline">{settings.tuHeadName}</div>
                  <div>NIP. {settings.tuHeadNip || '-'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
