import { ExternalLink, FileText, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';

interface AttachmentPreviewBoxProps {
  url: string;
  name?: string;
  compact?: boolean;
}

function detectAttachmentKind(url: string, name?: string): 'image' | 'pdf' | 'external' {
  const lower = `${url} ${name || ''}`.toLowerCase();
  if (
    lower.includes('.png') ||
    lower.includes('.jpg') ||
    lower.includes('.jpeg') ||
    lower.includes('.webp') ||
    lower.includes('.svg') ||
    lower.startsWith('data:image/')
  ) {
    return 'image';
  }
  if (lower.includes('.pdf') || lower.startsWith('data:application/pdf')) {
    return 'pdf';
  }
  return 'external';
}

export function AttachmentPreviewBox({ url, name, compact = false }: AttachmentPreviewBoxProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const kind = detectAttachmentKind(url, name);

  useEffect(() => {
    setImgFailed(false);
  }, [url]);

  if (!url) {
    return (
      <div className="border border-dashed border-[var(--theme-border-strong)] rounded-lg p-6 text-center text-xs text-[var(--theme-text-muted)]">
        Belum ada berkas lampiran digital yang diunggah untuk surat ini.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--theme-text-secondary)] min-w-0">
          {kind === 'pdf' ? (
            <FileText className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0" />
          ) : (
            <Paperclip className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0" />
          )}
          <span className="truncate">{name || url}</span>
        </span>
        <a
          href={url}
          download={name || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="px-2.5 py-1 text-xs font-medium border border-[var(--theme-border-strong)] rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1 shrink-0"
        >
          Buka Tab Baru
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {kind === 'image' && !imgFailed && (
        <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-lg p-2 flex items-center justify-center overflow-hidden">
          <img
            src={url}
            alt={name || 'Pratinjau lampiran surat'}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`${compact ? 'max-h-72' : 'max-h-[68vh]'} w-auto max-w-full object-contain rounded`}
          />
        </div>
      )}

      {kind === 'pdf' && (
        <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-lg overflow-hidden">
          <iframe
            src={url}
            title={name || 'Pratinjau dokumen PDF'}
            className={`w-full ${compact ? 'h-80' : 'h-[70vh]'} bg-white`}
          />
        </div>
      )}

      {(kind === 'external' || imgFailed) && (
        <div className="border border-[var(--theme-border)] bg-[var(--theme-surface-subtle)] rounded-lg p-4 text-xs text-[var(--theme-text-secondary)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>
            Berkas berupa tautan eksternal atau format tidak dapat dipratinjau langsung di browser.
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 font-medium bg-[var(--theme-accent)] text-white rounded-md hover:bg-[var(--theme-accent-hover)] inline-flex items-center gap-1.5 shrink-0 w-fit"
          >
            Buka Tautan Berkas
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
