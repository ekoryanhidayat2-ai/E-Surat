import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  REGULATION_CATEGORIES,
  type LetterRegulation,
  type RegulationCategory,
  type StaffRole,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { formatDateId } from '../lib/format.ts';

interface RegulationsViewProps {
  regulations: LetterRegulation[];
  role: StaffRole;
  onCreateRegulation: (payload: {
    title: string;
    regulationNumber: string;
    year: number;
    category: RegulationCategory;
    issuingBody: string;
    summary: string;
    fileUrl: string;
    fileName: string;
    fileSizeBytes: number;
  }) => Promise<void>;
  onUpdateRegulation: (
    id: string,
    payload: {
      title: string;
      regulationNumber: string;
      year: number;
      category: RegulationCategory;
      issuingBody: string;
      summary: string;
      fileUrl: string;
      fileName: string;
      fileSizeBytes: number;
      expectedUpdatedAt?: string;
    }
  ) => Promise<void>;
  onDeleteRegulation: (id: string) => Promise<void>;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return 'PDF';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function RegulationsView({
  regulations,
  role,
  onCreateRegulation,
  onUpdateRegulation,
  onDeleteRegulation,
}: RegulationsViewProps) {
  const isAdmin = role === 'admin';

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | RegulationCategory>('ALL');
  const [yearFilter, setYearFilter] = useState<'ALL' | number>('ALL');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LetterRegulation | null>(null);
  const [title, setTitle] = useState('');
  const [regulationNumber, setRegulationNumber] = useState('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [category, setCategory] = useState<RegulationCategory>('Tata Naskah Dinas');
  const [issuingBody, setIssuingBody] = useState('');
  const [summary, setSummary] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSizeBytes, setFileSizeBytes] = useState(0);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [previewTarget, setPreviewTarget] = useState<LetterRegulation | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewTarget) setPreviewTarget(null);
        else if (formOpen) setFormOpen(false);
        return;
      }
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
  }, [formOpen, previewTarget]);

  const availableYears = useMemo(() => {
    const set = new Set<number>();
    for (const r of regulations) {
      if (r.year) set.add(r.year);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [regulations]);

  const filteredRegulations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return regulations.filter((item) => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) {
        return false;
      }
      if (yearFilter !== 'ALL' && item.year !== yearFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.regulationNumber.toLowerCase().includes(q) ||
        item.issuingBody.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.fileName.toLowerCase().includes(q) ||
        String(item.year).includes(q)
      );
    });
  }, [regulations, searchQuery, categoryFilter, yearFilter]);

  const openCreateModal = () => {
    setEditing(null);
    setTitle('');
    setRegulationNumber('');
    setYear(new Date().getFullYear());
    setCategory('Tata Naskah Dinas');
    setIssuingBody('');
    setSummary('');
    setFileUrl('');
    setFileName('');
    setFileSizeBytes(0);
    setFormError('');
    setFormOpen(true);
  };

  const openEditModal = (item: LetterRegulation) => {
    setEditing(item);
    setTitle(item.title);
    setRegulationNumber(item.regulationNumber);
    setYear(item.year);
    setCategory(item.category);
    setIssuingBody(item.issuingBody);
    setSummary(item.summary);
    setFileUrl(item.fileUrl);
    setFileName(item.fileName);
    setFileSizeBytes(item.fileSizeBytes);
    setFormError('');
    setFormOpen(true);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError('');

    const isPdfMime = file.type === 'application/pdf';
    const isPdfExt = file.name.toLowerCase().endsWith('.pdf');
    if (!isPdfMime && !isPdfExt) {
      setFormError('Hanya berkas dokumen PDF (.pdf) yang diperbolehkan untuk referensi peraturan.');
      e.target.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setFormError('Ukuran berkas PDF maksimal 10 MB.');
      e.target.value = '';
      return;
    }

    setUploadingPdf(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca berkas PDF.'));
        reader.readAsDataURL(file);
      });

      const uploaded = await api.uploadAttachment({
        fileName: file.name,
        mimeType: 'application/pdf',
        dataBase64,
      });

      setFileUrl(uploaded.attachmentUrl);
      setFileName(uploaded.attachmentName);
      setFileSizeBytes(uploaded.sizeBytes || file.size);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal mengunggah berkas PDF.');
    } finally {
      setUploadingPdf(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!fileUrl || !fileName) {
      setFormError('Silakan unggah dokumen PDF peraturan terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        regulationNumber: regulationNumber.trim(),
        year: Number(year),
        category,
        issuingBody: issuingBody.trim(),
        summary: summary.trim(),
        fileUrl,
        fileName,
        fileSizeBytes,
      };
      if (editing) {
        await onUpdateRegulation(editing.id, {
          ...payload,
          expectedUpdatedAt: editing.updatedAt,
        });
      } else {
        await onCreateRegulation(payload);
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan referensi peraturan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeleteRegulation(id);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar: Search, Filter & Admin Upload CTA */}
      <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Cari referensi peraturan"
              placeholder="Cari judul, nomor peraturan, atau instansi..."
              className="w-full pl-9 pr-8 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/25 focus:border-[var(--theme-accent)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Bersihkan pencarian peraturan"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Filter kategori peraturan"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | RegulationCategory)}
            className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
          >
            <option value="ALL">Semua Kategori ({regulations.length})</option>
            {REGULATION_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {availableYears.length > 0 && (
            <select
              aria-label="Filter tahun peraturan"
              value={yearFilter === 'ALL' ? 'ALL' : String(yearFilter)}
              onChange={(e) =>
                setYearFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
              }
              className="px-3 py-2 text-xs font-medium font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="ALL">Semua Tahun</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Tahun {yr}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <span className="text-xs text-[var(--theme-text-muted)] font-mono tabular-nums">
            Menampilkan <strong className="text-[var(--theme-text)]">{filteredRegulations.length}</strong> dokumen
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Unggah Peraturan (PDF)
            </button>
          )}
        </div>
      </div>

      {/* Regulations List */}
      {filteredRegulations.length === 0 ? (
        <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)] flex items-center justify-center mx-auto text-[var(--theme-text-muted)]">
            <BookOpen className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--theme-text)]">
              {regulations.length === 0
                ? 'Belum ada dokumen peraturan persuratan yang disimpan'
                : 'Tidak ada peraturan yang sesuai dengan pencarian'}
            </h3>
            <p className="text-xs text-[var(--theme-text-muted)] max-w-md mx-auto">
              {regulations.length === 0
                ? isAdmin
                  ? 'Unggah dokumen PDF peraturan tata naskah dinas, pedoman klasifikasi arsip, atau aturan persuratan sekolah sebagai referensi seluruh pengguna.'
                  : 'Admin Tata Usaha belum mengunggah dokumen PDF peraturan persuratan.'
                : 'Coba ubah kata kunci pencarian atau reset filter untuk melihat semua dokumen.'}
            </p>
          </div>
          {regulations.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('ALL');
                  setYearFilter('ALL');
                }}
                className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap"
              >
                Reset Filter
              </button>
            </div>
          )}
          {isAdmin && regulations.length === 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={openCreateModal}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                Unggah PDF Peraturan Pertama
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredRegulations.map((item) => (
            <article
              key={item.id}
              className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-[var(--theme-border-strong)] transition-colors"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-muted)]">
                    <span className="font-medium text-[var(--theme-text-secondary)]">
                      {item.category}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-[var(--theme-accent-text)]">
                      {item.regulationNumber}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Tahun {item.year}
                    </span>
                  </div>

                  <h3 className="text-base font-semibold text-[var(--theme-text)] leading-snug">
                    {item.title}
                  </h3>

                  {item.summary && (
                    <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed whitespace-pre-line max-w-3xl">
                      {item.summary}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-[var(--theme-text-muted)]">
                    {item.issuingBody && (
                      <span>
                        Penerbit: <strong className="text-[var(--theme-text-secondary)]">{item.issuingBody}</strong>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 font-mono text-[var(--theme-text-secondary)]">
                      <FileText className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                      {item.fileName} ({formatFileSize(item.fileSizeBytes)})
                    </span>
                    <span>
                      Diunggah oleh {item.uploadedBy} pada {formatDateId(item.createdAt.slice(0, 10))}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 lg:pt-1">
                  <button
                    type="button"
                    onClick={() => setPreviewTarget(item)}
                    className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Baca PDF
                  </button>

                  <a
                    href={item.fileUrl}
                    download={item.fileName}
                    className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Unduh
                  </a>

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="px-3 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <FilePenLine className="w-3.5 h-3.5" />
                        Edit
                      </button>

                      {confirmDeleteId === item.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={deletingId === item.id}
                            onClick={() => void handleConfirmDelete(item.id)}
                            className="px-3 py-2 text-xs font-medium bg-rose-700 text-white rounded-lg hover:bg-rose-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            {deletingId === item.id ? 'Menghapus...' : 'Ya, Hapus'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] whitespace-nowrap shrink-0"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          aria-label={`Hapus ${item.title}`}
                          className="p-2 text-xs border border-[var(--theme-border-strong)] rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Upload / Edit Modal (Admin Only) */}
      {formOpen && isAdmin && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFormOpen(false);
          }}
        >
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-2xl bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-[var(--theme-border)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-text)]">
                  {editing ? 'Edit Referensi Peraturan' : 'Unggah Referensi Peraturan (PDF)'}
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                  Simpan dokumen peraturan tata naskah dinas atau pedoman persuratan dalam format PDF.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label="Tutup form peraturan"
                className="p-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <div className="border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-3.5 py-2.5 rounded-lg text-xs">
                  {formError}
                </div>
              )}

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Judul Peraturan <span className="text-rose-600">*</span>
                </span>
                <input
                  type="text"
                  required
                  maxLength={220}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Peraturan Menteri Dalam Negeri No. 1 Tahun 2023 tentang Tata Naskah Dinas"
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="space-y-1 text-xs sm:col-span-2">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Nomor Peraturan <span className="text-rose-600">*</span>
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={regulationNumber}
                    onChange={(e) => setRegulationNumber(e.target.value)}
                    placeholder="Contoh: Permendagri No. 1 Tahun 2023"
                    className="w-full px-3 py-2 text-sm font-mono border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Tahun <span className="text-rose-600">*</span>
                  </span>
                  <input
                    type="number"
                    required
                    min={1945}
                    max={2100}
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Kategori Peraturan <span className="text-rose-600">*</span>
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as RegulationCategory)}
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  >
                    {REGULATION_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--theme-text-secondary)]">
                    Instansi Penerbit
                  </span>
                  <input
                    type="text"
                    maxLength={160}
                    value={issuingBody}
                    onChange={(e) => setIssuingBody(e.target.value)}
                    placeholder="Contoh: Kementerian Dalam Negeri RI / Pemkab Kulon Progo"
                    className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                </label>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Ringkasan / Poin Penting Peraturan
                </span>
                <textarea
                  rows={3}
                  maxLength={600}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Catat poin utama peraturan terkait format kop surat, penomoran, atau masa retensi arsip..."
                  className="w-full px-3 py-2 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </label>

              {/* PDF Upload Dropzone / Picker */}
              <div className="space-y-1.5 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">
                  Berkas Dokumen PDF Peraturan <span className="text-rose-600">*</span>
                </span>
                <div className="border border-dashed border-[var(--theme-border-strong)] bg-[var(--theme-surface-subtle)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[var(--theme-surface)] border border-[var(--theme-border)] flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div className="min-w-0">
                      {fileUrl ? (
                        <>
                          <div className="text-xs font-semibold text-[var(--theme-text)] truncate">
                            {fileName}
                          </div>
                          <div className="text-[11px] text-[var(--theme-text-muted)]">
                            Siap disimpan ({formatFileSize(fileSizeBytes)})
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-medium text-[var(--theme-text)]">
                            Belum ada berkas PDF dipilih
                          </div>
                          <div className="text-[11px] text-[var(--theme-text-muted)]">
                            Format wajib PDF (.pdf), ukuran maksimal 10 MB.
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <label className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-center">
                    <Upload className="w-3.5 h-3.5" />
                    {uploadingPdf ? 'Mengunggah...' : fileUrl ? 'Ganti PDF' : 'Pilih Berkas PDF'}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => void handlePdfUpload(e)}
                      disabled={uploadingPdf}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-[var(--theme-surface-subtle)] border-t border-[var(--theme-border)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || uploadingPdf}
                className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
              >
                {submitting
                  ? 'Menyimpan...'
                  : editing
                    ? 'Simpan Perubahan'
                    : 'Simpan Referensi PDF'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Built-in PDF Viewer Modal */}
      {previewTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewTarget(null);
          }}
        >
          <div className="w-full max-w-5xl h-[88vh] bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-xl overflow-hidden shadow-2xl flex flex-col">
            <div className="px-5 py-3.5 border-b border-[var(--theme-border)] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-[var(--theme-accent-text)] font-semibold">
                  {previewTarget.regulationNumber} ({previewTarget.year})
                </div>
                <h2 className="text-sm font-semibold text-[var(--theme-text)] truncate">
                  {previewTarget.title}
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewTarget.fileUrl}
                  download={previewTarget.fileName}
                  className="px-3.5 py-2 text-xs font-medium bg-[var(--theme-accent)] text-white rounded-lg hover:bg-[var(--theme-accent-hover)] inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh PDF
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewTarget(null)}
                  aria-label="Tutup pembaca PDF"
                  className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] rounded-lg border border-[var(--theme-border)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-[var(--theme-canvas)]">
              <iframe
                src={previewTarget.fileUrl}
                title={previewTarget.title}
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
