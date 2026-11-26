import { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import type {
  AiDraftTone,
  ClassificationCode,
  IncomingLetter,
  IncomingStatus,
  LetterUrgency,
  OutgoingLetter,
  OutgoingStatus,
  SchoolSettings,
  YearCounter,
} from '../types.ts';
import {
  INCOMING_STATUS_OPTIONS,
  OUTGOING_STATUS_OPTIONS,
  STAFF_UNITS,
  URGENCY_OPTIONS,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { formatOutgoingPreview } from '../lib/format.ts';
import {
  collectAvailableYears,
  getDefaultDateForYear,
  isValidWorkYear,
  replaceDateYear,
} from '../lib/yearUtils.ts';

const DRAFT_KEY_INCOMING = 'esurat_draft_incoming_v1';
const DRAFT_KEY_OUTGOING = 'esurat_draft_outgoing_v1';

interface LetterDraftPayload {
  classificationCode?: string;
  letterDate?: string;
  subject?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  bodyText?: string;
  notes?: string;
  letterNumber?: string;
  receivedDate?: string;
  sender?: string;
  urgency?: LetterUrgency;
  inStatus?: IncomingStatus;
  recipient?: string;
  drafterName?: string;
  outStatus?: OutgoingStatus;
  isManualNumber?: boolean;
  manualNumber?: string;
  savedAt?: string;
}

function readSavedDraft(key: string): LetterDraftPayload | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LetterDraftPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export type LetterFormMode =
  | { kind: 'incoming'; editing?: IncomingLetter }
  | { kind: 'outgoing'; editing?: OutgoingLetter };

interface LetterFormModalProps {
  mode: LetterFormMode;
  classifications: ClassificationCode[];
  settings: SchoolSettings;
  counters: YearCounter[];
  activeYear?: number;
  availableYears?: number[];
  operatorLabel: string;
  onClose: () => void;
  onSaveIncoming: (
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
  ) => Promise<IncomingLetter>;
  onSaveOutgoing: (
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
  ) => Promise<OutgoingLetter>;
  onOpenPreviewAfterSave?: (
    target:
      | { kind: 'incoming'; letter: IncomingLetter }
      | { kind: 'outgoing'; letter: OutgoingLetter }
  ) => void;
}

export function LetterFormModal({
  mode,
  classifications,
  settings,
  counters,
  activeYear,
  availableYears = [],
  operatorLabel,
  onClose,
  onSaveIncoming,
  onSaveOutgoing,
  onOpenPreviewAfterSave,
}: LetterFormModalProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultDateIso =
    activeYear && isValidWorkYear(activeYear)
      ? getDefaultDateForYear(activeYear)
      : todayIso;
  const defaultClassCode = classifications[0]?.code || '421.3';

  const isIncoming = mode.kind === 'incoming';
  const editingIn = mode.kind === 'incoming' ? mode.editing : undefined;
  const editingOut = mode.kind === 'outgoing' ? mode.editing : undefined;
  const isNewMode = !editingIn && !editingOut;
  const draftStorageKey = isIncoming ? DRAFT_KEY_INCOMING : DRAFT_KEY_OUTGOING;
  const initialDraftRef = useRef<LetterDraftPayload | null>(
    isNewMode ? readSavedDraft(draftStorageKey) : null
  );
  const initialDraft = initialDraftRef.current;

  // Shared fields
  const [classificationCode, setClassificationCode] = useState(
    editingIn?.classificationCode ||
      editingOut?.classificationCode ||
      initialDraft?.classificationCode ||
      defaultClassCode
  );
  const [letterDate, setLetterDate] = useState(
    editingIn?.letterDate || editingOut?.letterDate || initialDraft?.letterDate || defaultDateIso
  );
  const [subject, setSubject] = useState(
    editingIn?.subject || editingOut?.subject || initialDraft?.subject || ''
  );
  const [attachmentUrl, setAttachmentUrl] = useState(
    editingIn?.attachmentUrl || editingOut?.attachmentUrl || initialDraft?.attachmentUrl || ''
  );
  const [attachmentName, setAttachmentName] = useState(
    editingIn?.attachmentName || editingOut?.attachmentName || initialDraft?.attachmentName || ''
  );
  const [bodyText, setBodyText] = useState(editingOut?.bodyText || initialDraft?.bodyText || '');
  const [notes, setNotes] = useState(
    editingIn?.notes || editingOut?.notes || initialDraft?.notes || ''
  );

  // Incoming fields
  const [letterNumber, setLetterNumber] = useState(
    editingIn?.letterNumber || initialDraft?.letterNumber || ''
  );
  const [receivedDate, setReceivedDate] = useState(
    editingIn?.receivedDate || initialDraft?.receivedDate || defaultDateIso
  );
  const [sender, setSender] = useState(editingIn?.sender || initialDraft?.sender || '');
  const [urgency, setUrgency] = useState<LetterUrgency>(
    editingIn?.urgency || initialDraft?.urgency || 'Biasa'
  );
  const [inStatus, setInStatus] = useState<IncomingStatus>(
    editingIn?.status || initialDraft?.inStatus || 'Menunggu Disposisi'
  );

  // Outgoing fields
  const [recipient, setRecipient] = useState(editingOut?.recipient || initialDraft?.recipient || '');
  const [drafterName, setDrafterName] = useState(
    editingOut?.drafterName ||
      initialDraft?.drafterName ||
      STAFF_UNITS[4] ||
      'Bagian Tata Usaha'
  );
  const [outStatus, setOutStatus] = useState<OutgoingStatus>(
    editingOut?.status || initialDraft?.outStatus || 'Draf'
  );
  const [isManualNumber, setIsManualNumber] = useState(
    editingOut ? editingOut.isManualNumber : Boolean(initialDraft?.isManualNumber)
  );
  const [manualNumber, setManualNumber] = useState(
    editingOut?.fullLetterNumber || initialDraft?.manualNumber || ''
  );

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewAfterSave, setPreviewAfterSave] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [showAiRawText, setShowAiRawText] = useState(false);
  const [aiRawText, setAiRawText] = useState('');
  const [aiNotice, setAiNotice] = useState('');
  const [aiDraftTone, setAiDraftTone] = useState<AiDraftTone>('surat_dinas');
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(
    isNewMode && initialDraft?.savedAt ? initialDraft.savedAt : null
  );
  const [draftSyncState, setDraftSyncState] = useState<'idle' | 'saving' | 'saved'>(
    isNewMode && initialDraft?.savedAt ? 'saved' : 'idle'
  );
  const hasMountedRef = useRef(false);
  const skipNextDbSaveRef = useRef(false);
  const userTouchedRef = useRef(false);
  const pendingDraftSaveRef = useRef<LetterDraftPayload | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Pulihkan draf terbaru dari database SQLite (jika ada dari sesi/perangkat lain)
  useEffect(() => {
    if (!isNewMode) return;
    let active = true;
    void api
      .getDraft(draftStorageKey)
      .then((res) => {
        if (!active || !res.draft || userTouchedRef.current) return;
        const p = res.draft.payload as LetterDraftPayload;
        const serverMs = Date.parse(res.draft.updatedAt);
        const localMs = initialDraftRef.current?.savedAt
          ? Date.parse(initialDraftRef.current.savedAt)
          : 0;
        if (!Number.isNaN(localMs) && localMs > serverMs) {
          return;
        }
        skipNextDbSaveRef.current = true;
        if (typeof p.classificationCode === 'string' && p.classificationCode) {
          setClassificationCode(p.classificationCode);
        }
        if (typeof p.letterDate === 'string' && p.letterDate) setLetterDate(p.letterDate);
        if (typeof p.subject === 'string') setSubject(p.subject);
        if (typeof p.attachmentUrl === 'string') setAttachmentUrl(p.attachmentUrl);
        if (typeof p.attachmentName === 'string') setAttachmentName(p.attachmentName);
        if (typeof p.bodyText === 'string') setBodyText(p.bodyText);
        if (typeof p.notes === 'string') setNotes(p.notes);
        if (typeof p.letterNumber === 'string') setLetterNumber(p.letterNumber);
        if (typeof p.receivedDate === 'string' && p.receivedDate) {
          setReceivedDate(p.receivedDate);
        }
        if (typeof p.sender === 'string') setSender(p.sender);
        if (typeof p.urgency === 'string') setUrgency(p.urgency as LetterUrgency);
        if (typeof p.inStatus === 'string') setInStatus(p.inStatus as IncomingStatus);
        if (typeof p.recipient === 'string') setRecipient(p.recipient);
        if (typeof p.drafterName === 'string' && p.drafterName) setDrafterName(p.drafterName);
        if (typeof p.outStatus === 'string') setOutStatus(p.outStatus as OutgoingStatus);
        if (typeof p.isManualNumber === 'boolean') setIsManualNumber(p.isManualNumber);
        if (typeof p.manualNumber === 'string') setManualNumber(p.manualNumber);
        setRestoredDraftAt(res.draft.updatedAt);
        setDraftSyncState('saved');
      })
      .catch(() => {
        // Abaikan jika gagal memuat draf server; fallback localStorage tetap bekerja
      });
    return () => {
      active = false;
    };
  }, [isNewMode, draftStorageKey]);

  useEffect(() => {
    if (!isNewMode) return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (skipNextDbSaveRef.current) {
      skipNextDbSaveRef.current = false;
      return;
    }
    userTouchedRef.current = true;

    const hasMeaningfulContent = Boolean(
      subject.trim() ||
        notes.trim() ||
        attachmentUrl.trim() ||
        (isIncoming
          ? letterNumber.trim() || sender.trim()
          : recipient.trim() || bodyText.trim() || manualNumber.trim())
    );
    if (!hasMeaningfulContent) {
      pendingDraftSaveRef.current = null;
      setDraftSyncState('idle');
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // noop
      }
      const clearTimer = window.setTimeout(() => {
        void api.deleteDraft(draftStorageKey).catch(() => {});
      }, 300);
      return () => window.clearTimeout(clearTimer);
    }

    const payload: LetterDraftPayload = {
      classificationCode,
      letterDate,
      subject,
      attachmentUrl,
      attachmentName,
      bodyText,
      notes,
      letterNumber,
      receivedDate,
      sender,
      urgency,
      inStatus,
      recipient,
      drafterName,
      outStatus,
      isManualNumber,
      manualNumber,
      savedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
    } catch {
      // Abaikan jika storage penuh atau diblokir
    }

    pendingDraftSaveRef.current = payload;
    setDraftSyncState('saving');
    const saveTimer = window.setTimeout(() => {
      pendingDraftSaveRef.current = null;
      void api
        .saveDraft(draftStorageKey, payload as Record<string, unknown>)
        .then(() => {
          setDraftSyncState('saved');
        })
        .catch(() => {
          // Abaikan error jaringan sementara; localStorage tetap menyimpan draf
        });
    }, 450);

    return () => window.clearTimeout(saveTimer);
  }, [
    isNewMode,
    isIncoming,
    draftStorageKey,
    classificationCode,
    letterDate,
    subject,
    attachmentUrl,
    attachmentName,
    bodyText,
    notes,
    letterNumber,
    receivedDate,
    sender,
    urgency,
    inStatus,
    recipient,
    drafterName,
    outStatus,
    isManualNumber,
    manualNumber,
  ]);

  // Flush draf tertunda saat modal ditutup sebelum timer debounce selesai
  useEffect(() => {
    return () => {
      if (isNewMode && pendingDraftSaveRef.current) {
        void api
          .saveDraft(draftStorageKey, pendingDraftSaveRef.current as Record<string, unknown>)
          .catch(() => {});
      }
    };
  }, [isNewMode, draftStorageKey]);

  const handleClearDraft = () => {
    pendingDraftSaveRef.current = null;
    userTouchedRef.current = true;
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // noop
    }
    void api.deleteDraft(draftStorageKey).catch(() => {});
    skipNextDbSaveRef.current = true;
    setClassificationCode(defaultClassCode);
    setLetterDate(defaultDateIso);
    setSubject('');
    setAttachmentUrl('');
    setAttachmentName('');
    setBodyText('');
    setNotes('');
    setLetterNumber('');
    setReceivedDate(defaultDateIso);
    setSender('');
    setUrgency('Biasa');
    setInStatus('Menunggu Disposisi');
    setRecipient('');
    setDrafterName(STAFF_UNITS[4] || 'Bagian Tata Usaha');
    setOutStatus('Draf');
    setIsManualNumber(false);
    setManualNumber('');
    setRestoredDraftAt(null);
    setDraftSyncState('idle');
  };

  const targetYear =
    Number((letterDate || defaultDateIso).slice(0, 4)) || new Date().getFullYear();
  const incomingAgendaYear =
    Number((receivedDate || defaultDateIso).slice(0, 4)) || new Date().getFullYear();
  const inYearCounter = counters.find((c) => c.year === incomingAgendaYear);
  const nextInSeq = (inYearCounter?.incomingLastSeq ?? 0) + 1;
  const incomingPreviewAgenda = editingIn
    ? editingIn.agendaNumber
    : `AGD-${incomingAgendaYear}-${String(nextInSeq).padStart(3, '0')}`;

  const yearCounter = counters.find((c) => c.year === targetYear);
  const nextOutSeq = (yearCounter?.outgoingLastSeq ?? 0) + 1;
  const autoPreviewNumber = editingOut
    ? editingOut.fullLetterNumber
    : formatOutgoingPreview(
        settings.outgoingFormatPattern,
        classificationCode,
        nextOutSeq,
        settings.schoolCode,
        letterDate
      );

  const selectableYears = collectAvailableYears({
    counters,
    activeYear: isIncoming ? incomingAgendaYear : targetYear,
    customYears: availableYears,
  });

  const handleQuickSwitchFormYear = (nextYear: number) => {
    if (!isValidWorkYear(nextYear)) return;
    if (isIncoming) {
      setReceivedDate((prev) => replaceDateYear(prev || defaultDateIso, nextYear));
      setLetterDate((prev) => replaceDateYear(prev || defaultDateIso, nextYear));
    } else {
      setLetterDate((prev) => replaceDateYear(prev || defaultDateIso, nextYear));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');

    const ext = file.name.toLowerCase().split('.').pop() || '';
    const inferredMime =
      file.type ||
      (ext === 'pdf'
        ? 'application/pdf'
        : ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'jpg' || ext === 'jpeg'
              ? 'image/jpeg'
              : '');

    const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimes.includes(inferredMime)) {
      setErrorMsg('Format berkas lampiran harus PDF, PNG, JPG, atau WEBP.');
      e.target.value = '';
      return;
    }

    const isPdf = inferredMime === 'application/pdf';
    const maxBytes = isPdf ? 10 * 1024 * 1024 : 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      setErrorMsg(
        isPdf
          ? 'Ukuran berkas PDF lampiran maksimal 10 MB.'
          : 'Ukuran berkas gambar lampiran maksimal 4 MB.'
      );
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
        reader.readAsDataURL(file);
      });

      const uploaded = await api.uploadAttachment({
        fileName: file.name,
        mimeType: inferredMime,
        dataBase64,
      });
      setAttachmentUrl(uploaded.attachmentUrl);
      setAttachmentName(uploaded.attachmentName);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengunggah berkas.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleInsertTemplate = () => {
    const topik = subject.trim() || '[isi perihal surat]';
    setBodyText(
      `Dengan hormat,\n\nSehubungan dengan ${topik}, bersama ini kami dari ${settings.schoolName} menyampaikan informasi/permohonan sebagaimana dimaksud untuk dapat ditindaklanjuti sesuai ketentuan yang berlaku.\n\nDemikian surat ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.`
    );
  };

  const handleAiAnalyzeIncoming = async () => {
    setErrorMsg('');
    setAiNotice('');
    setAiAnalyzing(true);
    try {
      const combinedText = [aiRawText.trim(), subject.trim(), notes.trim()]
        .filter(Boolean)
        .join('\n');
      const extracted = await api.analyzeIncomingWithAi({
        attachmentUrl,
        rawText: combinedText,
      });
      if (extracted.letterNumber) setLetterNumber(extracted.letterNumber);
      if (extracted.letterDate) setLetterDate(extracted.letterDate);
      if (extracted.receivedDate) setReceivedDate(extracted.receivedDate);
      if (extracted.sender) setSender(extracted.sender);
      if (extracted.subject) setSubject(extracted.subject);
      if (extracted.classificationCode) setClassificationCode(extracted.classificationCode);
      if (extracted.urgency) setUrgency(extracted.urgency);
      if (extracted.notes) setNotes(extracted.notes);
      setAiNotice(
        [extracted.summary, extracted.confidenceNote].filter(Boolean).join(' — ')
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal menganalisis surat masuk dengan AI.'
      );
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleAiDraftOutgoing = async () => {
    setErrorMsg('');
    setAiNotice('');
    setAiDrafting(true);
    try {
      const drafted = await api.draftOutgoingWithAi({
        recipient,
        subject,
        classificationCode,
        letterDate,
        drafterName,
        existingBody: bodyText,
        notes,
        tone: aiDraftTone,
      });
      if (drafted.bodyText) setBodyText(drafted.bodyText);
      if (!subject.trim() && drafted.subject) setSubject(drafted.subject);
      if (drafted.notes) setAiNotice(drafted.notes);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal menyusun draf naskah surat dengan AI.'
      );
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      if (isIncoming) {
        const saved = await onSaveIncoming(
          {
            letterNumber,
            letterDate,
            receivedDate,
            sender,
            subject,
            classificationCode,
            urgency,
            status: inStatus,
            attachmentUrl,
            attachmentName,
            notes,
            createdBy: operatorLabel,
            expectedUpdatedAt: editingIn?.updatedAt,
          },
          editingIn?.id
        );
        if (isNewMode) {
          pendingDraftSaveRef.current = null;
          try {
            window.localStorage.removeItem(draftStorageKey);
          } catch {
            // noop
          }
          void api.deleteDraft(draftStorageKey).catch(() => {});
        }
        onClose();
        if (previewAfterSave && onOpenPreviewAfterSave) {
          onOpenPreviewAfterSave({ kind: 'incoming', letter: saved });
        }
      } else {
        const saved = await onSaveOutgoing(
          {
            classificationCode,
            letterDate,
            recipient,
            subject,
            drafterName,
            status: outStatus,
            isManualNumber: editingOut ? true : isManualNumber,
            fullLetterNumber: editingOut
              ? manualNumber
              : isManualNumber
                ? manualNumber
                : autoPreviewNumber,
            attachmentUrl,
            attachmentName,
            bodyText,
            notes,
            createdBy: operatorLabel,
            expectedUpdatedAt: editingOut?.updatedAt,
          },
          editingOut?.id
        );
        if (isNewMode) {
          pendingDraftSaveRef.current = null;
          try {
            window.localStorage.removeItem(draftStorageKey);
          } catch {
            // noop
          }
          void api.deleteDraft(draftStorageKey).catch(() => {});
        }
        onClose();
        if (previewAfterSave && onOpenPreviewAfterSave) {
          onOpenPreviewAfterSave({ kind: 'outgoing', letter: saved });
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan data surat.');
    } finally {
      setSubmitting(false);
      setPreviewAfterSave(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="letter-form-title"
    >
      <div className="bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-lg">
        <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-center justify-between">
          <div>
            <h2 id="letter-form-title" className="text-base font-semibold text-[var(--theme-text)]">
              {isIncoming
                ? editingIn
                  ? `Edit Surat Masuk (${editingIn.agendaNumber})`
                  : 'Catat Surat Masuk Baru'
                : editingOut
                  ? `Edit Surat Keluar (${editingOut.fullLetterNumber})`
                  : 'Buat Surat Keluar Baru'}
            </h2>
            <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
              {isIncoming
                ? 'Nomor agenda surat masuk akan dibuat otomatis secara berurutan.'
                : 'Nomor surat keluar mengikuti klasifikasi tata naskah dinas SMP Negeri 2 Girimulyo.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup formulir"
            className="p-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4">
          {isNewMode && restoredDraftAt && (
            <div className="border border-amber-300/80 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 px-3.5 py-2.5 rounded-md flex items-center justify-between gap-3 text-xs">
              <div className="text-amber-900 dark:text-amber-200">
                <span className="font-medium">Draf belum tersimpan dipulihkan otomatis</span>{' '}
                <span className="text-amber-700 dark:text-amber-300">
                  ({new Date(restoredDraftAt).toLocaleTimeString('id', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })})
                </span>
              </div>
              <button
                type="button"
                onClick={handleClearDraft}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-amber-400/70 dark:border-amber-700 rounded bg-white/80 dark:bg-slate-900/70 text-amber-900 dark:text-amber-200 hover:bg-white whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                Kosongkan Form
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-3.5 py-2.5 rounded-md text-xs">
              {errorMsg}
            </div>
          )}

          {aiNotice && (
            <div className="border border-[var(--theme-accent)]/35 bg-[var(--theme-accent-tint)] text-[var(--theme-text)] px-3.5 py-2.5 rounded-md text-xs leading-relaxed">
              <span className="font-semibold text-[var(--theme-accent-text)]">Catatan AI: </span>
              {aiNotice}
            </div>
          )}

          {isIncoming && (
            <div className="border border-[var(--theme-accent)]/30 bg-[var(--theme-accent-tint)]/60 rounded-lg p-3.5 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--theme-text)] inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--theme-accent-text)] shrink-0" />
                    <span>Ekstraksi Cerdas AI (PDF / Gambar / Teks)</span>
                  </div>
                  <p className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                    Unggah scan surat di kolom Lampiran Digital atau tempel teks surat, lalu biarkan AI mengisi kolom otomatis.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowAiRawText((v) => !v)}
                    className="px-2.5 py-1.5 text-[11px] font-medium border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
                  >
                    {showAiRawText ? 'Tutup Teks' : 'Tempel Teks'}
                  </button>
                  <button
                    type="button"
                    disabled={aiAnalyzing || uploading}
                    onClick={() => void handleAiAnalyzeIncoming()}
                    className="px-3 py-1.5 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                  >
                    {aiAnalyzing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {aiAnalyzing ? 'Menganalisis...' : 'Ekstrak Otomatis AI'}
                  </button>
                </div>
              </div>

              {showAiRawText && (
                <textarea
                  rows={3}
                  value={aiRawText}
                  onChange={(e) => setAiRawText(e.target.value)}
                  placeholder="Tempel isi surat atau teks pesan undangan/edaran di sini untuk diekstrak menjadi data surat masuk..."
                  className="w-full px-3 py-2 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              )}
            </div>
          )}

          {isIncoming && (
            <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <span className="text-[11px] font-medium text-[var(--theme-text-muted)] block">
                  {editingIn ? 'Nomor Agenda Tercatat' : `Pratinjau Nomor Agenda (Tahun ${incomingAgendaYear})`}
                </span>
                <div className="font-mono tabular-nums text-sm font-semibold text-[var(--theme-accent-text)] mt-0.5">
                  {incomingPreviewAgenda}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs shrink-0">
                <span className="text-[var(--theme-text-muted)] font-medium">Tahun Agenda:</span>
                <select
                  value={String(incomingAgendaYear)}
                  onChange={(e) => handleQuickSwitchFormYear(Number(e.target.value))}
                  aria-label="Pilih tahun agenda surat masuk"
                  className="px-2.5 py-1.5 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                >
                  {selectableYears.map((yr) => (
                    <option key={yr} value={String(yr)}>
                      {yr}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {!isIncoming && (
            <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-md p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--theme-text-secondary)]">
                  {editingOut
                    ? 'Nomor Surat Keluar'
                    : `Pratinjau Nomor Surat Otomatis (Tahun ${targetYear})`}
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--theme-text-muted)] font-medium">Tahun:</span>
                    <select
                      value={String(targetYear)}
                      onChange={(e) => handleQuickSwitchFormYear(Number(e.target.value))}
                      aria-label="Pilih tahun surat keluar"
                      className="px-2 py-1 text-xs font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                    >
                      {selectableYears.map((yr) => (
                        <option key={yr} value={String(yr)}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!editingOut && (
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--theme-text-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isManualNumber}
                        onChange={(e) => {
                          setIsManualNumber(e.target.checked);
                          if (e.target.checked && !manualNumber) {
                            setManualNumber(autoPreviewNumber);
                          }
                        }}
                        className="rounded border-[var(--theme-border-strong)] accent-[var(--theme-accent)]"
                      />
                      Gunakan nomor manual (susulan/sisipan)
                    </label>
                  )}
                </div>
              </div>

              {editingOut || isManualNumber ? (
                <input
                  type="text"
                  required
                  value={manualNumber}
                  onChange={(e) => setManualNumber(e.target.value)}
                  placeholder="Contoh: 421.3/045/SMPN2-GR/XI/2026"
                  className="w-full px-3 py-2 text-sm font-mono font-semibold border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              ) : (
                <div className="font-mono tabular-nums text-base font-semibold text-[var(--theme-accent-text)]">
                  {autoPreviewNumber}
                </div>
              )}
            </div>
          )}

          {isIncoming ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Nomor Surat Asal *</span>
                <input
                  type="text"
                  required
                  value={letterNumber}
                  onChange={(e) => setLetterNumber(e.target.value)}
                  placeholder="Contoh: 421.3/1184/Disdikpora/2026"
                  className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Pengirim / Instansi *</span>
                <input
                  type="text"
                  required
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  placeholder="Contoh: Disdikpora Kab. Kulon Progo"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Tanggal Surat *</span>
                <input
                  type="date"
                  required
                  value={letterDate}
                  onChange={(e) => setLetterDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Tanggal Diterima *</span>
                <input
                  type="date"
                  required
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Tujuan / Penerima *</span>
                <input
                  type="text"
                  required
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Contoh: Kepala Disdikpora Kab. Kulon Progo"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Tanggal Surat *</span>
                <input
                  type="date"
                  required
                  value={letterDate}
                  onChange={(e) => setLetterDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-[var(--theme-text-secondary)]">Kode Klasifikasi *</span>
              <select
                value={classificationCode}
                onChange={(e) => setClassificationCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
              >
                {classifications.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>

            {isIncoming ? (
              <>
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">Sifat Surat</span>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as LetterUrgency)}
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    {URGENCY_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">Status</span>
                  <select
                    value={inStatus}
                    onChange={(e) => setInStatus(e.target.value as IncomingStatus)}
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    {INCOMING_STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">Konseptor / Unit *</span>
                  <input
                    type="text"
                    required
                    list="staff-units-list"
                    value={drafterName}
                    onChange={(e) => setDrafterName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                  <datalist id="staff-units-list">
                    {STAFF_UNITS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">Status Surat</span>
                  <select
                    value={outStatus}
                    onChange={(e) => setOutStatus(e.target.value as OutgoingStatus)}
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    {OUTGOING_STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          <label className="block space-y-1 text-xs">
            <span className="font-medium text-[var(--theme-text-secondary)]">Perihal Surat *</span>
            <textarea
              required
              rows={2}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Tuliskan inti perihal surat secara singkat dan jelas..."
              className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
            />
          </label>

          {!isIncoming && (
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Isi Naskah Surat Resmi (Tampil saat Preview &amp; Cetak)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={aiDraftTone}
                    onChange={(e) => setAiDraftTone(e.target.value as AiDraftTone)}
                    aria-label="Jenis gaya naskah AI"
                    className="px-2 py-1 text-[11px] border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    <option value="surat_dinas">AI: Surat Dinas</option>
                    <option value="undangan">AI: Undangan Rapat</option>
                    <option value="permohonan">AI: Permohonan</option>
                    <option value="pemberitahuan">AI: Pemberitahuan</option>
                    <option value="sempurnakan">AI: Sempurnakan Draf</option>
                  </select>
                  <button
                    type="button"
                    disabled={aiDrafting}
                    onClick={() => void handleAiDraftOutgoing()}
                    className="px-2.5 py-1 text-[11px] font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-md inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                  >
                    {aiDrafting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {aiDrafting ? 'Menyusun...' : 'Susun Naskah AI'}
                  </button>
                  <button
                    type="button"
                    onClick={handleInsertTemplate}
                    className="text-xs font-medium text-[var(--theme-accent-text)] hover:underline whitespace-nowrap"
                  >
                    Templat Standar
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Tuliskan paragraf pembuka, isi, hari/tanggal acara, dan penutup surat keluar. Jika dikosongkan, pratinjau cetak akan menyusun naskah ringkas otomatis berdasarkan perihal."
                className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)] leading-relaxed"
              />
            </div>
          )}

          {/* Lampiran Berkas */}
          <div className="border border-[var(--theme-border)] rounded-md p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--theme-text-secondary)]">
                Lampiran Digital (PDF maks. 10 MB / Gambar maks. 4 MB atau Tautan Drive)
              </span>
              <label className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] cursor-pointer inline-flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                {uploading ? 'Mengunggah...' : 'Unggah Berkas'}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={attachmentUrl}
                onChange={(e) => setAttachmentUrl(e.target.value)}
                placeholder="Atau tempel URL Google Drive / berkas"
                className="w-full px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
              />
              <input
                type="text"
                value={attachmentName}
                onChange={(e) => setAttachmentName(e.target.value)}
                placeholder="Nama tampilan berkas (opsional)"
                className="w-full px-3 py-1.5 text-xs border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
              />
            </div>

            {attachmentUrl && (
              <div className="flex items-center justify-between text-xs text-[var(--theme-text-secondary)] bg-[var(--theme-surface-subtle)] px-3 py-2 rounded border border-[var(--theme-border)]">
                <span className="inline-flex items-center gap-1.5 truncate">
                  <Paperclip className="w-3.5 h-3.5 text-[var(--theme-accent-text)] shrink-0" />
                  <span className="truncate">{attachmentName || attachmentUrl}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAttachmentUrl('');
                    setAttachmentName('');
                  }}
                  className="text-rose-700 dark:text-rose-400 hover:underline ml-2 shrink-0"
                >
                  Hapus
                </button>
              </div>
            )}
          </div>

          <label className="block space-y-1 text-xs">
            <span className="font-medium text-[var(--theme-text-secondary)]">Catatan Tambahan</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan ruang penyimpanan fisik map/ordner atau keterangan tambahan..."
              className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-md bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
            />
          </label>

          <div className="pt-3 border-t border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-[var(--theme-text-muted)]">
              {isNewMode && draftSyncState === 'saving' && 'Menyimpan draf ke database...'}
              {isNewMode && draftSyncState === 'saved' && 'Draf tersimpan otomatis di database'}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
              >
                Batal
              </button>
              {onOpenPreviewAfterSave && (
                <button
                  type="submit"
                  disabled={submitting || uploading}
                  onClick={() => setPreviewAfterSave(true)}
                  className="px-4 py-2 text-xs font-medium border border-[var(--theme-accent)] text-[var(--theme-accent-text)] rounded-md hover:bg-[var(--theme-accent-tint)] disabled:opacity-50 whitespace-nowrap"
                >
                  {submitting && previewAfterSave ? 'Menyimpan...' : 'Simpan & Preview'}
                </button>
              )}
              <button
                type="submit"
                disabled={submitting || uploading}
                onClick={() => setPreviewAfterSave(false)}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] disabled:opacity-50 whitespace-nowrap"
              >
                {submitting && !previewAfterSave
                  ? 'Menyimpan...'
                  : editingIn || editingOut
                    ? 'Simpan Perubahan'
                    : 'Simpan Surat'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
