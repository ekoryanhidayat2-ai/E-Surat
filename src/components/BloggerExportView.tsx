import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { BloggerExportPackage } from '../types.ts';

interface BloggerExportViewProps {
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

type ExportFormatTab = 'xml' | 'html' | 'iframe' | 'source';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BloggerExportView({ onNotify }: BloggerExportViewProps) {
  const defaultOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000';

  const [serverOriginInput, setServerOriginInput] = useState(defaultOrigin);
  const [pkg, setPkg] = useState<BloggerExportPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [activeFormat, setActiveFormat] = useState<ExportFormatTab>('xml');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showFullInlineCode, setShowFullInlineCode] = useState(false);

  const loadPackage = useCallback(
    async (originValue: string) => {
      setLoading(true);
      try {
        const res = await api.getBloggerExportPreview(originValue);
        setPkg(res);
      } catch (err) {
        onNotify(
          err instanceof Error ? err.message : 'Gagal menyiapkan paket ekspor Blogger.',
          'error'
        );
      } finally {
        setLoading(false);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    void loadPackage(defaultOrigin);
  }, [defaultOrigin, loadPackage]);

  const handleCopyCode = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      onNotify(`${label} berhasil disalin ke papan klip.`);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2500);
    } catch {
      onNotify('Gagal menyalin otomatis. Gunakan tombol Unduh Berkas.', 'error');
    }
  };

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      const blob = await api.downloadBloggerSourceZip(serverOriginInput);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `esurat-blogger-full-source-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify('Arsip lengkap kode sumber & template Blogger (.zip) berhasil diunduh.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal mengunduh arsip kode sumber.',
        'error'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const currentCodeString =
    activeFormat === 'xml'
      ? pkg?.xmlTheme || ''
      : activeFormat === 'html'
        ? pkg?.htmlBundle || ''
        : activeFormat === 'iframe'
          ? pkg?.iframeSnippet || ''
          : '';

  const isLargeCode = currentCodeString.length > 24000;
  const displayedCode =
    isLargeCode && !showFullInlineCode
      ? `${currentCodeString.slice(0, 5200)}\n\n/* ... (${formatBytes(
          currentCodeString.length
        )} total — seluruh CSS tema, komponen React, PDF generator & bridge Blogger telah terpasang. Gunakan tombol "Salin Seluruh Kode" atau "Unduh Berkas" untuk hasil utuh) ... */\n\n${currentCodeString.slice(
          -1400
        )}`
      : currentCodeString;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header Summary Card */}
      <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[var(--theme-accent-tint)] text-[var(--theme-accent-text)] flex items-center justify-center shrink-0">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--theme-text)] font-display">
                Ekspor Seluruh Kode Aplikasi untuk Blogger
              </h2>
              <p className="text-xs text-[var(--theme-text-muted)] mt-1 max-w-2xl leading-relaxed">
                Kemasi seluruh antarmuka, tema, generator PDF, dan kode sumber E-Surat ke dalam
                format <strong className="text-[var(--theme-text)]">Tema XML Blogger</strong>,{' '}
                <strong className="text-[var(--theme-text)]">HTML Mandiri Tunggal</strong>,{' '}
                <strong className="text-[var(--theme-text)]">Embed Server Live</strong>, serta arsip{' '}
                <strong className="text-[var(--theme-text)]">.ZIP Kode Sumber Lengkap</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadPackage(serverOriginInput)}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Perbarui Paket
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadZip()}
              disabled={downloadingZip || loading}
              className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileArchive className="w-3.5 h-3.5" />
              {downloadingZip ? 'Mengemas ZIP...' : 'Unduh Semua Kode (.ZIP)'}
            </button>
          </div>
        </div>

        {/* Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-lg bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)]">
            <div className="text-[11px] font-medium text-[var(--theme-text-muted)]">
              Berkas Kode Sumber
            </div>
            <div className="text-lg font-bold text-[var(--theme-text)] font-mono tabular-nums mt-0.5">
              {pkg ? pkg.sourceFileCount : '—'} File
            </div>
          </div>
          <div className="p-3.5 rounded-lg bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)]">
            <div className="text-[11px] font-medium text-[var(--theme-text-muted)]">
              Tema XML Blogger
            </div>
            <div className="text-lg font-bold text-[var(--theme-text)] font-mono tabular-nums mt-0.5">
              {pkg ? formatBytes(pkg.bundleStats.xmlBytes) : '—'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)]">
            <div className="text-[11px] font-medium text-[var(--theme-text-muted)]">
              HTML Mandiri Tunggal
            </div>
            <div className="text-lg font-bold text-[var(--theme-text)] font-mono tabular-nums mt-0.5">
              {pkg ? formatBytes(pkg.bundleStats.htmlBytes) : '—'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)]">
            <div className="text-[11px] font-medium text-[var(--theme-text-muted)]">
              Komponen &amp; CSS Terbundel
            </div>
            <div className="text-lg font-bold text-[var(--theme-accent-text)] font-mono tabular-nums mt-0.5">
              {pkg ? formatBytes(pkg.bundleStats.jsBytes + pkg.bundleStats.cssBytes) : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Format Tabs */}
      <div
        role="tablist"
        aria-label="Pilih format ekspor Blogger"
        className="flex flex-wrap items-center gap-1 p-1 bg-[var(--theme-surface-hover)] border border-[var(--theme-border)] rounded-lg w-fit"
      >
        {(
          [
            { id: 'xml', label: 'Tema XML Blogger (Layar Penuh)' },
            { id: 'html', label: 'HTML Mandiri (Halaman / Gadget)' },
            { id: 'iframe', label: 'Embed Server Live (Iframe + AI)' },
            { id: 'source', label: `Semua File Sumber (${pkg?.sourceFileCount ?? 0})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeFormat === tab.id}
            onClick={() => {
              setActiveFormat(tab.id);
              setShowFullInlineCode(false);
            }}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeFormat === tab.id
                ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && !pkg ? (
        <div className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl p-10 text-center space-y-3">
          <RefreshCw className="w-6 h-6 text-[var(--theme-accent-text)] animate-spin mx-auto" />
          <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
            Sedang mengemas kode sumber, CSS tema, dan template XML Blogger...
          </p>
        </div>
      ) : pkg ? (
        <>
          {activeFormat !== 'source' ? (
            <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[var(--theme-text)] flex items-center gap-2">
                    {activeFormat === 'xml' ? (
                      <Globe className="w-4 h-4 text-[var(--theme-accent-text)]" />
                    ) : (
                      <FileCode2 className="w-4 h-4 text-[var(--theme-accent-text)]" />
                    )}
                    {activeFormat === 'xml' && 'Template XML Tema Blogger (esurat-blogger-theme.xml)'}
                    {activeFormat === 'html' &&
                      'Kode HTML Mandiri Tunggal (esurat-blogger-standalone.html)'}
                    {activeFormat === 'iframe' &&
                      'Kode Embed Halaman Blogger Terhubung Server (esurat-blogger-iframe.html)'}
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] leading-relaxed">
                    {activeFormat === 'xml' &&
                      'Buka Dasbor Blogger > Tema > panah di samping Sesuaikan > Pulihkan > Upload berkas .xml ini agar seluruh blog menjadi aplikasi E-Surat layar penuh (penyimpanan lokal browser).'}
                    {activeFormat === 'html' &&
                      'Buka Blogger > Halaman Baru > ubah ke Tampilan HTML (< / >), lalu tempel kode atau unduh berkas .html ini. Berjalan mandiri tanpa server menggunakan localStorage.'}
                    {activeFormat === 'iframe' &&
                      'Pasang di Halaman Blogger agar tetap terhubung langsung ke database SQLite, unggahan PDF, dan Asisten AI pada server aktif.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyCode(
                        activeFormat,
                        currentCodeString,
                        activeFormat === 'xml'
                          ? 'Kode Template XML Blogger'
                          : activeFormat === 'html'
                            ? 'Kode HTML Mandiri'
                            : 'Kode Embed Iframe'
                      )
                    }
                    className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {copiedKey === activeFormat ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedKey === activeFormat ? 'Kode Tersalin' : 'Salin Seluruh Kode'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeFormat === 'xml') {
                        downloadTextFile(
                          'esurat-blogger-theme.xml',
                          pkg.xmlTheme,
                          'application/xml;charset=utf-8'
                        );
                      } else if (activeFormat === 'html') {
                        downloadTextFile(
                          'esurat-blogger-standalone.html',
                          pkg.htmlBundle,
                          'text/html;charset=utf-8'
                        );
                      } else {
                        downloadTextFile(
                          'esurat-blogger-iframe.html',
                          pkg.iframeSnippet,
                          'text/html;charset=utf-8'
                        );
                      }
                      onNotify('Berkas siap pasang untuk Blogger berhasil diunduh.');
                    }}
                    className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Unduh {activeFormat === 'xml' ? '.XML' : '.HTML'}
                  </button>
                </div>
              </div>

              {activeFormat === 'iframe' && (
                <div className="px-6 py-4 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-end gap-3">
                  <label className="flex-1 space-y-1 text-xs">
                    <span className="font-medium text-[var(--theme-text-secondary)]">
                      URL Server Aktif Aplikasi E-Surat
                    </span>
                    <input
                      type="url"
                      value={serverOriginInput}
                      onChange={(e) => setServerOriginInput(e.target.value)}
                      placeholder="https://alamat-server-esurat.anda"
                      className="w-full px-3 py-2 text-xs font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadPackage(serverOriginInput)}
                    disabled={loading}
                    className="px-4 py-2 text-xs font-medium border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] rounded-lg whitespace-nowrap shrink-0"
                  >
                    Terapkan URL ke Kode
                  </button>
                </div>
              )}

              {(activeFormat === 'xml' || activeFormat === 'html') && (
                <div className="px-6 py-3 bg-[var(--theme-surface-subtle)] border-b border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--theme-text-secondary)]">
                  <span>
                    Mode Mandiri Blogger menyertakan salinan data awal &amp; akun login lokal{' '}
                    <strong className="font-mono text-[var(--theme-text)]">admin / admin2026</strong>{' '}
                    (tanpa hash/rahasia server).
                  </span>
                  {isLargeCode && (
                    <button
                      type="button"
                      onClick={() => setShowFullInlineCode((v) => !v)}
                      className="text-xs font-medium text-[var(--theme-accent-text)] hover:underline whitespace-nowrap"
                    >
                      {showFullInlineCode
                        ? 'Ringkas Pratinjau Kode'
                        : 'Tampilkan Seluruh Baris Kode'}
                    </button>
                  )}
                </div>
              )}

              <div className="p-4 bg-[var(--theme-canvas)]">
                <textarea
                  readOnly
                  aria-label="Pratinjau kode ekspor Blogger"
                  value={displayedCode}
                  rows={18}
                  className="w-full p-4 text-xs font-mono leading-relaxed bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-lg focus:outline-none resize-y"
                />
              </div>
            </section>
          ) : (
            <section className="border border-[var(--theme-border)] bg-[var(--theme-surface)] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-6 py-4 border-b border-[var(--theme-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                    Inventaris Seluruh Kode Sumber Aplikasi ({pkg.sourceFileCount} Berkas)
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    Arsip <strong className="font-mono">.ZIP</strong> memuat seluruh kode frontend
                    (React/TypeScript/CSS), backend (Express/SQLite), unit test, plus folder{' '}
                    <strong className="font-mono">blogger/</strong> berisi file siap unggah ke Blogger.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownloadZip()}
                  disabled={downloadingZip}
                  className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <FileArchive className="w-3.5 h-3.5" />
                  {downloadingZip ? 'Mengemas ZIP...' : 'Unduh Paket ZIP Lengkap'}
                </button>
              </div>

              <div className="max-h-[460px] overflow-y-auto divide-y divide-[var(--theme-border)]">
                {pkg.sourceFiles.map((file) => (
                  <div
                    key={file.path}
                    className="px-6 py-2.5 flex items-center justify-between gap-4 text-xs hover:bg-[var(--theme-surface-subtle)]"
                  >
                    <span className="font-mono text-[var(--theme-text)] truncate">{file.path}</span>
                    <span className="font-mono tabular-nums text-[var(--theme-text-muted)] shrink-0">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
