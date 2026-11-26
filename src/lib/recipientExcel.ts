import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile, { type Sheet } from 'write-excel-file/browser';
import type { DispositionRecipient } from '../types.ts';
import {
  RECIPIENT_SCHEMA_SPEC,
  parseRecipientRows,
  SAMPLE_RECIPIENT_TEMPLATE_ROWS,
  type ParsedRecipientImport,
} from './recipientParser.ts';

function buildRecipientWorkbookSheets(
  rows: Array<{ name: string; category: string; nip?: string; unit?: string }>
): Sheet<Blob>[] {
  const headerStyle = {
    fontWeight: 'bold' as const,
    color: '#FFFFFF',
    backgroundColor: '#102A43',
    alignVertical: 'center' as const,
  };

  const dataSheetRows = [
    [
      { value: 'Nama Lengkap', type: String, ...headerStyle },
      { value: 'Kategori', type: String, ...headerStyle },
      { value: 'NIP / NUPTK', type: String, ...headerStyle },
      { value: 'Unit / Jabatan', type: String, ...headerStyle },
    ],
    ...rows.map((item) => [
      { value: item.name, type: String },
      { value: item.category, type: String },
      { value: item.nip || '', type: String },
      { value: item.unit || '', type: String },
    ]),
  ];

  const guideSheetRows = [
    [
      { value: 'Kolom', type: String, ...headerStyle },
      { value: 'Wajib', type: String, ...headerStyle },
      { value: 'Batas Karakter', type: String, ...headerStyle },
      { value: 'Panduan Pengisian Direktori Guru & Karyawan', type: String, ...headerStyle },
    ],
    [
      { value: 'Nama Lengkap', type: String, fontWeight: 'bold' as const },
      { value: 'Ya', type: String },
      { value: 'Maks. 120', type: String },
      { value: 'Nama lengkap beserta gelar akademik (mis. Drs. H. Ahmad Fauzi, M.Pd. atau Siti Aminah, S.Pd.).', type: String },
    ],
    [
      { value: 'Kategori', type: String, fontWeight: 'bold' as const },
      { value: 'Ya', type: String },
      { value: 'Pilihan', type: String },
      { value: 'Wajib diisi tepat dengan teks "Guru" atau "Karyawan".', type: String },
    ],
    [
      { value: 'NIP / NUPTK', type: String, fontWeight: 'bold' as const },
      { value: 'Opsional', type: String },
      { value: 'Maks. 40', type: String },
      { value: 'Nomor Induk Pegawai atau NUPTK. Format teks agar angka nol di depan tidak terpotong.', type: String },
    ],
    [
      { value: 'Unit / Jabatan', type: String, fontWeight: 'bold' as const },
      { value: 'Opsional', type: String },
      { value: 'Maks. 120', type: String },
      { value: 'Jabatan atau unit tugas sekolah (mis. Waka Kurikulum, Bagian Tata Usaha, Guru Mapel).', type: String },
    ],
    [
      { value: 'Catatan Impor', type: String, fontWeight: 'bold' as const },
      { value: '-', type: String },
      { value: 'Maks. 1.000 baris', type: String },
      { value: 'Simpan sebagai .xlsx lalu unggah melalui tombol "Unggah Excel" pada tab Guru & Karyawan di menu Pengaturan Admin.', type: String },
    ],
  ];

  return [
    {
      sheet: RECIPIENT_SCHEMA_SPEC.sheetName,
      stickyRowsCount: 1,
      columns: [{ width: 36 }, { width: 18 }, { width: 28 }, { width: 44 }],
      data: dataSheetRows,
    },
    {
      sheet: 'Petunjuk Pengisian',
      stickyRowsCount: 1,
      columns: [{ width: 22 }, { width: 14 }, { width: 20 }, { width: 72 }],
      data: guideSheetRows,
    },
  ];
}

export async function downloadRecipientExcelTemplate(
  schoolName?: string
): Promise<string> {
  const safeSlug = String(schoolName || 'sekolah')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const fileName = `template-guru-karyawan-${safeSlug || 'sekolah'}.xlsx`;
  const sheets = buildRecipientWorkbookSheets(SAMPLE_RECIPIENT_TEMPLATE_ROWS);
  await writeXlsxFile(sheets).toFile(fileName);
  return fileName;
}

export async function exportRecipientsToExcel(
  items: DispositionRecipient[],
  schoolName?: string
): Promise<string> {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeSlug = String(schoolName || 'sekolah')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const fileName = `direktori-guru-karyawan-${safeSlug || 'sekolah'}-${dateStamp}.xlsx`;
  const rowsToExport = items.length > 0 ? items : SAMPLE_RECIPIENT_TEMPLATE_ROWS;
  const sheets = buildRecipientWorkbookSheets(rowsToExport);
  await writeXlsxFile(sheets).toFile(fileName);
  return fileName;
}

export async function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca isi berkas Excel (.xlsx).'));
    reader.readAsDataURL(file);
  });
}

async function assertXlsxZipHeader(file: File): Promise<void> {
  const slice = file.slice(0, 4);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error(
      'Struktur berkas tidak cocok dengan format Excel OpenXML (.xlsx) yang sah.'
    );
  }
}

export async function readRecipientImportFile(
  file: File
): Promise<ParsedRecipientImport> {
  if (file.size === 0) {
    throw new Error('Berkas kosong (0 byte).');
  }
  if (file.size > RECIPIENT_SCHEMA_SPEC.maxFileBytes) {
    throw new Error('Ukuran berkas Excel maksimal 5 MB.');
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xls')) {
    throw new Error(
      'Format .xls lama tidak didukung. Simpan berkas sebagai Excel (.xlsx) terlebih dahulu.'
    );
  }
  if (!lowerName.endsWith('.xlsx')) {
    throw new Error('Format berkas wajib menggunakan ekstensi Excel (.xlsx).');
  }

  await assertXlsxZipHeader(file);

  let rawRows: unknown[][];
  try {
    rawRows = (await readSheet(file, RECIPIENT_SCHEMA_SPEC.sheetName)) as unknown[][];
  } catch {
    try {
      rawRows = (await readSheet(file, 1)) as unknown[][];
    } catch {
      throw new Error(
        'Berkas .xlsx tidak dapat dibaca atau rusak. Pastikan dibuat menggunakan Excel (.xlsx) yang standar.'
      );
    }
  }

  return parseRecipientRows(rawRows);
}
