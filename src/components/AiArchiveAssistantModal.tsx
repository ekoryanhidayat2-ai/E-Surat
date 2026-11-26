import { useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, Search, Sparkles, X } from 'lucide-react';
import type { AiArchiveQueryResult, IncomingLetter, OutgoingLetter } from '../types.ts';
import { api } from '../lib/api.ts';

interface AiArchiveAssistantModalProps {
  incoming: IncomingLetter[];
  outgoing: OutgoingLetter[];
  onClose: () => void;
  onSelectIncoming: (letter: IncomingLetter) => void;
  onSelectOutgoing: (letter: OutgoingLetter) => void;
}

const PRESET_QUESTIONS = [
  'Ringkas surat masuk yang mendesak atau belum didisposisikan saat ini.',
  'Bagaimana progres seluruh disposisi di tiap unit kerja dan apakah ada yang mendekati batas waktu?',
  'Buatkan rekap singkat surat masuk dan surat keluar bulan berjalan.',
  'Surat keluar apa saja yang masih berstatus Draf atau Menunggu TTD?',
];

export function AiArchiveAssistantModal({
  incoming = [],
  outgoing = [],
  onClose,
  onSelectIncoming,
  onSelectOutgoing,
}: AiArchiveAssistantModalProps) {
  const safeIncoming = Array.isArray(incoming) ? incoming : [];
  const safeOutgoing = Array.isArray(outgoing) ? outgoing : [];
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<AiArchiveQueryResult | null>(null);
  const [lastAsked, setLastAsked] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const runQuery = async (rawQuestion: string) => {
    const q = rawQuestion.trim();
    if (!q) return;
    setQuestion(q);
    setLastAsked(q);
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await api.queryArchiveWithAi(q);
      const highlights = Array.isArray(res?.highlights)
        ? res.highlights.filter((item): item is string => typeof item === 'string')
        : [];
      const referencedNumbers = Array.isArray(res?.referencedNumbers)
        ? res.referencedNumbers.filter((item): item is string => typeof item === 'string')
        : [];
      const answer = typeof res?.answer === 'string' ? res.answer : '';
      if (!answer && highlights.length === 0 && referencedNumbers.length === 0) {
        throw new Error('Respons analisis AI tidak lengkap. Silakan coba ulangi pertanyaan Anda.');
      }
      setResult({ answer, highlights, referencedNumbers });
    } catch (err) {
      setResult(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal meminta analisis AI terhadap arsip persuratan.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runQuery(question);
  };

  const resolveReference = (
    refCode: string
  ):
    | { kind: 'incoming'; letter: IncomingLetter; label: string }
    | { kind: 'outgoing'; letter: OutgoingLetter; label: string }
    | null => {
    const clean = refCode.trim().toLowerCase();
    if (!clean) return null;
    const matchedIn = safeIncoming.find(
      (l) =>
        l.agendaNumber.toLowerCase() === clean ||
        l.letterNumber.toLowerCase() === clean
    );
    if (matchedIn) {
      return {
        kind: 'incoming',
        letter: matchedIn,
        label: `${matchedIn.agendaNumber} · ${matchedIn.subject}`,
      };
    }
    const matchedOut = safeOutgoing.find(
      (l) => l.fullLetterNumber.toLowerCase() === clean
    );
    if (matchedOut) {
      return {
        kind: 'outgoing',
        letter: matchedOut,
        label: `${matchedOut.fullLetterNumber} · ${matchedOut.subject}`,
      };
    }
    return null;
  };

  const resultHighlights = Array.isArray(result?.highlights) ? result.highlights : [];
  const resultReferences = Array.isArray(result?.referencedNumbers)
    ? result.referencedNumbers
    : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-archive-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-[var(--theme-accent-text)] font-medium">
                Kecerdasan Arsip · {safeIncoming.length} Surat Masuk · {safeOutgoing.length} Surat Keluar
              </div>
              <h2
                id="ai-archive-modal-title"
                className="text-base font-semibold text-[var(--theme-text)] font-display"
              >
                Asisten AI Pencarian &amp; Rekap Arsip
              </h2>
              <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                Tanyakan status disposisi, cari surat tertentu dengan bahasa sehari-hari, atau susun ringkasan arsip sekolah.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup asisten AI"
            className="p-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-md shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Prompt Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block space-y-1.5 text-xs">
              <span className="font-medium text-[var(--theme-text-secondary)]">
                Pertanyaan atau Perintah Analisis Arsip
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Contoh: Surat dari Disdikpora bulan ini apa saja dan bagaimana tindak lanjutnya?"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/25 focus:border-[var(--theme-accent)]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !question.trim()}
                  className="px-4 py-2.5 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {loading ? 'Menganalisis...' : 'Tanyakan AI'}
                </button>
              </div>
            </label>

            {/* Preset Prompts */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--theme-text-muted)]">
                Pertanyaan Cepat:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PRESET_QUESTIONS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={loading}
                    onClick={() => void runQuery(preset)}
                    className="text-left px-3 py-2 text-xs border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] hover:bg-[var(--theme-surface-hover)] text-[var(--theme-text-secondary)] rounded-lg transition-colors disabled:opacity-50"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </form>

          {errorMsg && (
            <div className="border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-4 py-3 rounded-lg text-xs leading-relaxed">
              {errorMsg}
            </div>
          )}

          {loading && (
            <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--theme-accent-text)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>AI sedang membaca indeks arsip persuratan sekolah...</span>
              </div>
              <div className="h-3 w-3/4 bg-[var(--theme-border)] rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-[var(--theme-border)] rounded animate-pulse" />
            </div>
          )}

          {!loading && result && (
            <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-xl p-5 space-y-4">
              {lastAsked && (
                <div className="text-[11px] font-medium text-[var(--theme-text-muted)] pb-2 border-b border-[var(--theme-border)]">
                  Analisis untuk: <span className="text-[var(--theme-text)]">{lastAsked}</span>
                </div>
              )}

              <div className="text-sm text-[var(--theme-text)] leading-relaxed whitespace-pre-line">
                {result.answer}
              </div>

              {resultHighlights.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-[var(--theme-border)]">
                  <div className="text-xs font-semibold text-[var(--theme-text-secondary)]">
                    Temuan &amp; Tindak Lanjut Penting
                  </div>
                  <ul className="space-y-1.5 text-xs text-[var(--theme-text-secondary)] list-disc pl-4">
                    {resultHighlights.map((item, idx) => (
                      <li key={`${idx}-${item}`} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {resultReferences.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[var(--theme-border)]">
                  <div className="text-xs font-semibold text-[var(--theme-text-secondary)]">
                    Dokumen Terkait (Klik untuk Membuka Detail)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {resultReferences.map((refCode, idx) => {
                      const resolved = resolveReference(refCode);
                      if (!resolved) {
                        return (
                          <span
                            key={`${idx}-${refCode}`}
                            className="px-2.5 py-1.5 text-xs font-mono border border-[var(--theme-border)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text-muted)]"
                          >
                            {refCode}
                          </span>
                        );
                      }
                      return (
                        <button
                          key={`${idx}-${refCode}`}
                          type="button"
                          onClick={() => {
                            onClose();
                            if (resolved.kind === 'incoming') {
                              onSelectIncoming(resolved.letter);
                            } else {
                              onSelectOutgoing(resolved.letter);
                            }
                          }}
                          className="px-3 py-1.5 text-xs border border-[var(--theme-accent)]/40 bg-[var(--theme-surface)] hover:bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] rounded-lg transition-colors inline-flex items-center gap-1.5 text-left max-w-full"
                        >
                          <span className="truncate max-w-xs font-medium">{resolved.label}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
