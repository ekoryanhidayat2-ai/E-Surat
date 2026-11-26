export type IncomingColumnKey =
  | 'agendaNumber'
  | 'receivedDate'
  | 'originLetter'
  | 'senderSubject'
  | 'urgency'
  | 'status'
  | 'dispositions'
  | 'actions';

export type OutgoingColumnKey =
  | 'sequenceNumber'
  | 'fullLetterNumber'
  | 'letterDate'
  | 'recipientSubject'
  | 'drafterName'
  | 'status'
  | 'actions';

export interface TableColumnDef<K extends string = string> {
  key: K;
  label: string;
  description: string;
  mobileDefaultVisible: boolean;
  desktopDefaultVisible: boolean;
  locked?: boolean;
}

export const INCOMING_COLUMNS_STORAGE_KEY = 'esurat_cols_incoming_v1';
export const OUTGOING_COLUMNS_STORAGE_KEY = 'esurat_cols_outgoing_v1';

export const INCOMING_TABLE_COLUMNS: TableColumnDef<IncomingColumnKey>[] = [
  {
    key: 'agendaNumber',
    label: 'No. Agenda',
    description: 'Nomor urut agenda surat masuk tahunan',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
  },
  {
    key: 'receivedDate',
    label: 'Tgl Terima',
    description: 'Tanggal berkas diterima di sekolah',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'originLetter',
    label: 'No. & Tgl Surat Asal',
    description: 'Nomor dan tanggal dari instansi pengirim',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'senderSubject',
    label: 'Pengirim & Perihal',
    description: 'Kolom utama pengirim, subjek, dan klasifikasi',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
    locked: true,
  },
  {
    key: 'urgency',
    label: 'Sifat Surat',
    description: 'Tingkat urgensi (Biasa, Penting, Segera, Rahasia)',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'status',
    label: 'Status',
    description: 'Status disposisi dan penyelesaian surat',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
  },
  {
    key: 'dispositions',
    label: 'Disposisi',
    description: 'Jumlah unit kerja penerima disposisi',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'actions',
    label: 'Aksi',
    description: 'Tombol cepat Preview, Edit, dan Cetak',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
  },
];

export const OUTGOING_TABLE_COLUMNS: TableColumnDef<OutgoingColumnKey>[] = [
  {
    key: 'sequenceNumber',
    label: 'No. Urut',
    description: 'Nomor urut registrasi tahunan',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'fullLetterNumber',
    label: 'Nomor Surat Keluar',
    description: 'Nomor resmi terbitan sekolah',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
  },
  {
    key: 'letterDate',
    label: 'Tgl Surat',
    description: 'Tanggal penerbitan surat keluar',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'recipientSubject',
    label: 'Tujuan & Perihal',
    description: 'Kolom utama penerima, subjek, dan klasifikasi',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
    locked: true,
  },
  {
    key: 'drafterName',
    label: 'Konseptor',
    description: 'Nama petugas penyusun naskah surat',
    mobileDefaultVisible: false,
    desktopDefaultVisible: true,
  },
  {
    key: 'status',
    label: 'Status',
    description: 'Status naskah (Draf, Menunggu TTD, Terkirim)',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
  },
  {
    key: 'actions',
    label: 'Aksi',
    description: 'Tombol cepat Preview, Edit, dan Cetak',
    mobileDefaultVisible: true,
    desktopDefaultVisible: true,
  },
];

export function detectViewportMode(): 'mobile' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

export function getDefaultColumnVisibility<K extends string>(
  columns: TableColumnDef<K>[],
  mode: 'mobile' | 'desktop'
): Record<K, boolean> {
  const result = {} as Record<K, boolean>;
  for (const col of columns) {
    result[col.key] = col.locked
      ? true
      : mode === 'mobile'
        ? col.mobileDefaultVisible
        : col.desktopDefaultVisible;
  }
  return result;
}

export function normalizeColumnVisibility<K extends string>(
  columns: TableColumnDef<K>[],
  saved: Partial<Record<string, unknown>> | null | undefined,
  fallbackMode: 'mobile' | 'desktop'
): Record<K, boolean> {
  const defaults = getDefaultColumnVisibility(columns, fallbackMode);
  if (!saved || typeof saved !== 'object') {
    return defaults;
  }
  const normalized = { ...defaults };
  for (const col of columns) {
    if (col.locked) {
      normalized[col.key] = true;
      continue;
    }
    const raw = saved[col.key];
    if (typeof raw === 'boolean') {
      normalized[col.key] = raw;
    }
  }
  return normalized;
}

export function countVisibleColumns<K extends string>(
  columns: TableColumnDef<K>[],
  visibility: Record<K, boolean>
): number {
  let count = 0;
  for (const col of columns) {
    if (col.locked || visibility[col.key]) {
      count += 1;
    }
  }
  return count;
}

export function loadColumnVisibility<K extends string>(
  storageKey: string,
  columns: TableColumnDef<K>[]
): Record<K, boolean> {
  const fallbackMode = detectViewportMode();
  if (typeof window === 'undefined') {
    return getDefaultColumnVisibility(columns, fallbackMode);
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return getDefaultColumnVisibility(columns, fallbackMode);
    }
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    return normalizeColumnVisibility(columns, parsed, fallbackMode);
  } catch {
    return getDefaultColumnVisibility(columns, fallbackMode);
  }
}

export function saveColumnVisibility<K extends string>(
  storageKey: string,
  visibility: Record<K, boolean>
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(visibility));
  } catch {
    // Abaikan apabila localStorage tidak tersedia
  }
}
