import type { SpreadsheetExportDataset } from '../types.ts';

export type SpreadsheetSectionKey =
  | 'ringkasan'
  | 'incoming'
  | 'outgoing'
  | 'dispositions'
  | 'classifications'
  | 'recipients'
  | 'counters'
  | 'regulations'
  | 'activities';

export interface SpreadsheetSectionDefinition {
  key: SpreadsheetSectionKey;
  sheetTitle: string;
  label: string;
  description: string;
}

export const SPREADSHEET_SECTION_DEFINITIONS: SpreadsheetSectionDefinition[] = [
  {
    key: 'ringkasan',
    sheetTitle: 'Ringkasan',
    label: 'Ringkasan & Profil Sekolah',
    description: 'Identitas sekolah, tahun cakupan, dan rekapitulasi jumlah arsip.',
  },
  {
    key: 'incoming',
    sheetTitle: 'Surat Masuk',
    label: 'Surat Masuk',
    description: 'Buku agenda surat masuk beserta nomor agenda, pengirim, dan status.',
  },
  {
    key: 'outgoing',
    sheetTitle: 'Surat Keluar',
    label: 'Surat Keluar',
    description: 'Buku agenda surat keluar beserta nomor resmi, tujuan, dan konseptor.',
  },
  {
    key: 'dispositions',
    sheetTitle: 'Disposisi',
    label: 'Lembar Disposisi',
    description: 'Daftar instruksi disposisi, penerima, batas waktu, dan progres.',
  },
  {
    key: 'classifications',
    sheetTitle: 'Klasifikasi',
    label: 'Kode Klasifikasi',
    description: 'Daftar kode klasifikasi persuratan resmi.',
  },
  {
    key: 'recipients',
    sheetTitle: 'Guru & Karyawan',
    label: 'Guru & Karyawan',
    description: 'Direktori guru dan karyawan penerima disposisi beserta NIP dan status.',
  },
  {
    key: 'counters',
    sheetTitle: 'Penghitung Tahun',
    label: 'Penghitung Nomor Urut',
    description: 'Penghitung nomor urut surat masuk dan keluar per tahun.',
  },
  {
    key: 'regulations',
    sheetTitle: 'Peraturan',
    label: 'Referensi Peraturan',
    description: 'Daftar regulasi dan pedoman tata naskah dinas.',
  },
  {
    key: 'activities',
    sheetTitle: 'Log Aktivitas',
    label: 'Log Aktivitas Pengguna',
    description: 'Riwayat pembuatan, perubahan, dan penghapusan data surat.',
  },
];

export interface BuiltWorksheetPayload {
  key: SpreadsheetSectionKey;
  sheetTitle: string;
  dataRowCount: number;
  columnCount: number;
  rows: string[][];
}

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,120})/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9_-]{20,120}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function asCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function buildSpreadsheetWorksheets(
  dataset: SpreadsheetExportDataset,
  options: {
    selectedKeys: SpreadsheetSectionKey[];
    yearFilter: 'all' | number;
  }
): BuiltWorksheetPayload[] {
  const { data, exportedAt } = dataset;
  const yearFilter = options.yearFilter;
  const selectedSet = new Set(options.selectedKeys);

  const incomingFiltered = data.incoming.filter((item) => {
    if (yearFilter === 'all') return true;
    const yr = item.agendaYear || Number(String(item.receivedDate || '').slice(0, 4));
    return yr === yearFilter;
  });

  const outgoingFiltered = data.outgoing.filter((item) => {
    if (yearFilter === 'all') return true;
    const yr = item.letterYear || Number(String(item.letterDate || '').slice(0, 4));
    return yr === yearFilter;
  });

  const dispositionsFiltered = incomingFiltered.flatMap((letter) =>
    (Array.isArray(letter.dispositions) ? letter.dispositions : []).map((disp) => ({
      letter,
      disp,
    }))
  );

  const countersFiltered = data.counters.filter((c) =>
    yearFilter === 'all' ? true : c.year === yearFilter
  );

  const activities = Array.isArray(data.activityLogs) ? data.activityLogs : [];
  const scopeLabel = yearFilter === 'all' ? 'Semua Tahun' : `Tahun ${yearFilter}`;

  const builders: Record<SpreadsheetSectionKey, () => string[][]> = {
    ringkasan: () => [
      ['Keterangan', 'Nilai', 'Catatan'],
      ['Nama Sekolah', asCellText(data.settings.schoolName), 'Profil Sekolah'],
      ['Instansi Pembina', asCellText(data.settings.parentAgency), 'Profil Sekolah'],
      ['Pemerintah Daerah / Unit', asCellText(data.settings.districtGov), 'Profil Sekolah'],
      ['Kode Sekolah', asCellText(data.settings.schoolCode), 'Penomoran Surat'],
      ['NPSN', asCellText(data.settings.npsn), 'Identitas Sekolah'],
      ['Alamat', `${asCellText(data.settings.address)} ${asCellText(data.settings.postalCode)}`.trim(), ''],
      ['Kepala Sekolah', asCellText(data.settings.principalName), asCellText(data.settings.principalNip)],
      ['Koordinator TU', asCellText(data.settings.tuHeadName), asCellText(data.settings.tuHeadNip)],
      ['Cakupan Tahun Ekspor', scopeLabel, 'Filter Ekspor'],
      ['Waktu Ekspor Database', exportedAt || new Date().toISOString(), 'ISO-8601 UTC'],
      ['Jumlah Surat Masuk', String(incomingFiltered.length), scopeLabel],
      ['Jumlah Surat Keluar', String(outgoingFiltered.length), scopeLabel],
      ['Jumlah Disposisi', String(dispositionsFiltered.length), scopeLabel],
      ['Jumlah Klasifikasi', String(data.classifications.length), 'Master Data'],
      ['Jumlah Guru & Karyawan', String(data.dispositionRecipients.length), 'Direktori Disposisi'],
      ['Jumlah Referensi Peraturan', String(data.regulations.length), 'Dokumen PDF'],
      ['Jumlah Log Aktivitas', String(activities.length), 'Riwayat Audit'],
    ],
    incoming: () => [
      [
        'ID',
        'Nomor Agenda',
        'Tahun Agenda',
        'Nomor Surat Asal',
        'Tanggal Surat',
        'Tanggal Diterima',
        'Pengirim',
        'Perihal',
        'Kode Klasifikasi',
        'Sifat',
        'Status',
        'Jumlah Disposisi',
        'Lampiran',
        'Catatan',
        'Dibuat Oleh',
        'Dibuat Pada',
        'Diperbarui Pada',
      ],
      ...incomingFiltered.map((item) => [
        asCellText(item.id),
        asCellText(item.agendaNumber),
        asCellText(item.agendaYear),
        asCellText(item.letterNumber),
        asCellText(item.letterDate),
        asCellText(item.receivedDate),
        asCellText(item.sender),
        asCellText(item.subject),
        asCellText(item.classificationCode),
        asCellText(item.urgency),
        asCellText(item.status),
        String(Array.isArray(item.dispositions) ? item.dispositions.length : 0),
        asCellText(item.attachmentName),
        asCellText(item.notes),
        asCellText(item.createdBy),
        asCellText(item.createdAt),
        asCellText(item.updatedAt),
      ]),
    ],
    outgoing: () => [
      [
        'ID',
        'Nomor Surat Lengkap',
        'Tahun Surat',
        'Nomor Urut',
        'Penomoran Manual',
        'Kode Klasifikasi',
        'Tanggal Surat',
        'Tujuan / Penerima',
        'Perihal',
        'Konseptor',
        'Status',
        'Lampiran',
        'Catatan',
        'Dibuat Oleh',
        'Dibuat Pada',
        'Diperbarui Pada',
      ],
      ...outgoingFiltered.map((item) => [
        asCellText(item.id),
        asCellText(item.fullLetterNumber),
        asCellText(item.letterYear),
        asCellText(item.sequenceNumber),
        item.isManualNumber ? 'Ya' : 'Tidak',
        asCellText(item.classificationCode),
        asCellText(item.letterDate),
        asCellText(item.recipient),
        asCellText(item.subject),
        asCellText(item.drafterName),
        asCellText(item.status),
        asCellText(item.attachmentName),
        asCellText(item.notes),
        asCellText(item.createdBy),
        asCellText(item.createdAt),
        asCellText(item.updatedAt),
      ]),
    ],
    dispositions: () => [
      [
        'ID Disposisi',
        'Nomor Agenda Surat',
        'Nomor Surat Asal',
        'Pengirim Surat',
        'Perihal Surat',
        'Unit Tujuan',
        'Nama Guru / Karyawan',
        'Instruksi',
        'Batas Waktu',
        'Status Disposisi',
        'Catatan Penyelesaian',
        'Dibuat Oleh',
        'Tanggal Disposisi',
        'Diperbarui Pada',
      ],
      ...dispositionsFiltered.map(({ letter, disp }) => [
        asCellText(disp.id),
        asCellText(letter.agendaNumber),
        asCellText(letter.letterNumber),
        asCellText(letter.sender),
        asCellText(letter.subject),
        asCellText(disp.targetUnit),
        asCellText(disp.targetStaffName),
        asCellText(disp.instruction),
        asCellText(disp.deadlineDate),
        asCellText(disp.status),
        asCellText(disp.completionNote),
        asCellText(disp.createdBy),
        asCellText(disp.createdAt),
        asCellText(disp.updatedAt),
      ]),
    ],
    classifications: () => [
      ['Kode Klasifikasi', 'Nama Klasifikasi', 'Keterangan'],
      ...data.classifications.map((c) => [
        asCellText(c.code),
        asCellText(c.name),
        asCellText(c.description),
      ]),
    ],
    recipients: () => [
      ['ID', 'Nama Lengkap', 'NIP', 'Kategori', 'Unit / Jabatan', 'Status Aktif', 'Diperbarui Pada'],
      ...data.dispositionRecipients.map((r) => [
        asCellText(r.id),
        asCellText(r.name),
        asCellText(r.nip),
        asCellText(r.category),
        asCellText(r.unit),
        r.isActive ? 'Aktif' : 'Nonaktif',
        asCellText(r.updatedAt),
      ]),
    ],
    counters: () => [
      ['Tahun', 'Nomor Urut Terakhir Surat Masuk', 'Nomor Urut Terakhir Surat Keluar'],
      ...countersFiltered.map((c) => [
        asCellText(c.year),
        asCellText(c.incomingLastSeq),
        asCellText(c.outgoingLastSeq),
      ]),
    ],
    regulations: () => [
      ['ID', 'Judul Peraturan', 'Nomor Peraturan', 'Tahun', 'Kategori', 'Penerbit', 'Ringkasan', 'Berkas PDF', 'Diunggah Oleh'],
      ...data.regulations.map((reg) => [
        asCellText(reg.id),
        asCellText(reg.title),
        asCellText(reg.regulationNumber),
        asCellText(reg.year),
        asCellText(reg.category),
        asCellText(reg.issuingBody),
        asCellText(reg.summary),
        asCellText(reg.fileName),
        asCellText(reg.uploadedBy),
      ]),
    ],
    activities: () => [
      ['ID', 'Waktu', 'Nama Pengguna', 'Username', 'Peran', 'Aksi', 'Jenis Surat', 'Nomor Referensi', 'Perihal', 'Keterangan'],
      ...activities.map((act) => [
        asCellText(act.id),
        asCellText(act.createdAt),
        asCellText(act.actorDisplayName),
        asCellText(act.actorUsername),
        asCellText(act.actorRole),
        asCellText(act.action),
        act.entityType === 'incoming' ? 'Surat Masuk' : 'Surat Keluar',
        asCellText(act.referenceNumber),
        asCellText(act.subject),
        asCellText(act.details),
      ]),
    ],
  };

  const result: BuiltWorksheetPayload[] = [];
  for (const def of SPREADSHEET_SECTION_DEFINITIONS) {
    if (!selectedSet.has(def.key)) continue;
    const rows = builders[def.key]();
    result.push({
      key: def.key,
      sheetTitle: def.sheetTitle,
      dataRowCount: Math.max(0, rows.length - 1),
      columnCount: rows[0]?.length ?? 1,
      rows,
    });
  }
  return result;
}
