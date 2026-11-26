import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileText, RefreshCw, Sparkles } from 'lucide-react';
import type {
  ClassificationCode,
  DispositionRecipient,
  SchoolSettings,
  YearCounter,
} from '../types.ts';
import type { ThemeId } from '../lib/themes.ts';
import { buildLiveGuideSummary } from '../lib/appGuideContent.ts';
import { buildApplicationGuidePdf, exportApplicationGuidePdf } from '../lib/pdfExport.ts';

interface GuideViewProps {
  settings: SchoolSettings;
  classifications?: ClassificationCode[];
  dispositionRecipients?: DispositionRecipient[];
  counters?: YearCounter[];
  activeYear?: number | 'all';
  activeThemeId?: ThemeId;
}

export function GuideView({
  settings,
  classifications = [],
  dispositionRecipients = [],
  counters = [],
  activeYear = 'all',
  activeThemeId,
}: GuideViewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('panduan-aplikasi-esurat.pdf');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

  const liveSummary = useMemo(
    () =>
      buildLiveGuideSummary({
        settings,
        classifications,
        dispositionRecipients,
        counters,
        activeYear,
        activeThemeId,
      }),
    [settings, classifications, dispositionRecipients, counters, activeYear, activeThemeId]
  );

  const generatePdf = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { blob, fileName: generatedName } = await buildApplicationGuidePdf(settings, {
        classifications,
        dispositionRecipients,
        counters,
        activeYear,
        activeThemeId,
      });
      const nextUrl = URL.createObjectURL(blob);
      setFileName(generatedName);
      setPdfUrl(nextUrl);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyiapkan dokumen PDF panduan aplikasi.'
      );
    } finally {
      setLoading(false);
    }
  }, [settings, classifications, dispositionRecipients, counters, activeYear, activeThemeId]);

  useEffect(() => {
    void generatePdf();
  }, [generatePdf]);

  useEffect(() => {
    const currentUrl = pdfUrl;
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [pdfUrl]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      await exportApplicationGuidePdf(settings, {
        classifications,
        dispositionRecipients,
        counters,
        activeYear,
        activeThemeId,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Live Auto-Sync Summary Strip */}
      <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--theme-text)]">
                Panduan Tersinkronisasi Otomatis · Versi {liveSummary.version}
              </div>
              <div className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">
                {liveSummary.totalThemes} Tema ({liveSummary.activeThemeName}) ·{' '}
                {liveSummary.classificationsCount} Klasifikasi ·{' '}
                {liveSummary.activeRecipientsCount} Penerima Disposisi Aktif ·{' '}
                {liveSummary.yearScopeLabel}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setChangelogOpen((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-center"
          >
            {changelogOpen ? 'Tutup Catatan Pembaruan' : 'Lihat Pembaruan Terbaru'}
            {changelogOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {changelogOpen && (
          <ul className="pt-3 border-t border-[var(--theme-border)] space-y-1.5 text-xs text-[var(--theme-text-secondary)] list-disc list-inside">
            {liveSummary.changelog.map((item, idx) => (
              <li key={idx} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col">
        {/* PDF Toolbar */}
        <div className="px-5 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-[var(--theme-text-muted)]">
                Dokumen PDF A4 · v{liveSummary.version} · {fileName}
              </div>
              <h1 className="text-base font-semibold text-[var(--theme-text)] font-display truncate">
                Panduan Penggunaan Aplikasi E-Surat Sekolah
              </h1>
              <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                {settings.schoolName} · Otomatis diperbarui mengikuti fitur &amp; konfigurasi terkini
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void generatePdf()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Muat Ulang PDF
            </button>

            {pdfUrl ? (
              <a
                href={pdfUrl}
                download={fileName}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh PDF Panduan
              </a>
            ) : (
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={downloading}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {downloading ? 'Menyiapkan PDF...' : 'Unduh PDF Panduan'}
              </button>
            )}
          </div>
        </div>

        {/* Embedded PDF Reader */}
        <div className="bg-[var(--theme-canvas)] h-[calc(100vh-19rem)] min-h-[540px] flex flex-col">
          {loading && !pdfUrl ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <RefreshCw className="w-6 h-6 text-[var(--theme-accent-text)] animate-spin" />
              <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
                Menyiapkan dokumen PDF panduan aplikasi...
              </p>
            </div>
          ) : errorMsg ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                {errorMsg}
              </p>
              <button
                type="button"
                onClick={() => void generatePdf()}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg"
              >
                Coba Lagi
              </button>
            </div>
          ) : pdfUrl ? (
            <object
              data={pdfUrl}
              type="application/pdf"
              aria-label="Dokumen PDF Panduan Penggunaan Aplikasi E-Surat"
              className="w-full h-full flex-1"
            >
              <iframe
                src={pdfUrl}
                title="Panduan Penggunaan Aplikasi E-Surat (PDF)"
                className="w-full h-full border-0"
              />
              <div className="p-8 text-center space-y-3 bg-[var(--theme-surface)] h-full flex flex-col items-center justify-center">
                <FileText className="w-8 h-8 text-[var(--theme-text-muted)]" />
                <p className="text-xs text-[var(--theme-text-secondary)] max-w-md">
                  Peramban Anda tidak mendukung pratinjau PDF secara langsung di halaman ini. Silakan unduh dokumen PDF panduan menggunakan tombol di bawah.
                </p>
                <a
                  href={pdfUrl}
                  download={fileName}
                  className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh PDF Panduan
                </a>
              </div>
            </object>
          ) : null}
        </div>
      </section>
    </div>
  );
}
