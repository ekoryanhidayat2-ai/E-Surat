import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile, { type Sheet } from 'write-excel-file/browser';
import type { ClassificationCode } from '../types.ts';
import {
  CLASSIFICATION_SCHEMA_SPEC,
  parseClassificationRows,
  parseCsvRows,
  SAMPLE_CLASSIFICATION_TEMPLATE_ROWS,
  type ParsedClassificationImport,
} from './classificationParser.ts';

function buildClassificationWorkbookSheets(rows: ClassificationCode[]): Sheet<Blob>[] {
  const headerStyle = {
    fontWeight: 'bold' as const,
    color: '#FFFFFF',
    backgroundColor: '#102A43',
    alignVertical: 'center' as const,
  };

  const dataSheetRows = [
    [
      { value: 'Kode', type: String, ...headerStyle },
      { value: 'Nama Klasifikasi', type: String, ...headerStyle },
      { value: 'Keterangan', type: String, ...headerStyle },
    ],
    ...rows.map((item) => [
      { value: item.code, type: String },
      { value: item.name, type: String },
      { value: item.description || '', type: String },
    ]),
  ];

  const guideSheetRows = [
    [
      { value: 'Kolom', type: String, ...headerStyle },
      { value: 'Wajib', type: String, ...headerStyle },
      { value: 'Batas Karakter', type: String, ...headerStyle },
      { value: 'Panduan Pengisian Kode Klasifikasi Tata Naskah Dinas', type: String, ...headerStyle },
    ],
    [
      { value: 'Kode', type: String, fontWeight: 'bold' as const },
      { value: 'Ya', type: String },
      { value: 'Maks. 24', type: String },
      { value: 'Isi dengan kode klasifikasi resmi tanpa spasi (mis. 421.3, 424, 800, 900). Format teks agar angka nol di depan tidak hilang.', type: String },
    ],
    [
      { value: 'Nama Klasifikasi', type: String, fontWeight: 'bold' as const },
      { value: 'Ya', type: String },
      { value: '2–120 karakter', type: String },
      { value: 'Nama kategori atau urusan tata naskah dinas (mis. Pendidikan Menengah / SMP).', type: String },
    ],
    [
      { value: 'Keterangan', type: String, fontWeight: 'bold' as const },
      { value: 'Opsional', type: String },
      { value: 'Maks. 240', type: String },
      { value: 'Penjelasan ringkas cakupan surat atau arsip pada kode klasifikasi tersebut.', type: String },
    ],
    [
      { value: 'Catatan Impor', type: String, fontWeight: 'bold' as const },
      { value: '-', type: String },
      { value: 'Maks. 1.000 baris', type: String },
      { value: 'Simpan sebagai .xlsx lalu unggah melalui kotak "Unggah Berkas Excel (.xlsx)" pada tab Klasifikasi & Nomor Urut di menu Pengaturan Admin.', type: String },
    ],
  ];

  return [
    {
      sheet: 'Klasifikasi',
      stickyRowsCount: 1,
      columns: [{ width: 20 }, { width: 42 }, { width: 58 }],
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

export async function downloadClassificationExcelTemplate(
  schoolName?: string
): Promise<string> {
  const safeSlug = String(schoolName || 'sekolah')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const fileName = `template-klasifikasi-tata-naskah-${safeSlug || 'sekolah'}.xlsx`;
  const sheets = buildClassificationWorkbookSheets(SAMPLE_CLASSIFICATION_TEMPLATE_ROWS);
  await writeXlsxFile(sheets).toFile(fileName);
  return fileName;
}

export async function exportClassificationsToExcel(
  items: ClassificationCode[],
  schoolName?: string
): Promise<string> {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeSlug = String(schoolName || 'sekolah')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const fileName = `kode-klasifikasi-${safeSlug || 'sekolah'}-${dateStamp}.xlsx`;
  const rowsToExport = items.length > 0 ? items : SAMPLE_CLASSIFICATION_TEMPLATE_ROWS;
  const sheets = buildClassificationWorkbookSheets(rowsToExport);
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

export async function readClassificationImportFile(
  file: File
): Promise<ParsedClassificationImport> {
  if (file.size === 0) {
    throw new Error('Berkas kosong (0 byte).');
  }
  if (file.size > CLASSIFICATION_SCHEMA_SPEC.maxFileBytes) {
    throw new Error('Ukuran berkas Excel maksimal 5 MB.');
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xls')) {
    throw new Error(
      'Format .xls lama tidak didukung. Simpan berkas sebagai Excel (.xlsx) terlebih dahulu.'
    );
  }

  if (lowerName.endsWith('.csv')) {
    const text = await file.text();
    return parseClassificationRows(parseCsvRows(text));
  }

  if (!lowerName.endsWith('.xlsx')) {
    throw new Error('Format berkas wajib menggunakan ekstensi Excel (.xlsx).');
  }

  await assertXlsxZipHeader(file);

  let rawRows: unknown[][];
  try {
    rawRows = (await readSheet(file, 'Klasifikasi')) as unknown[][];
  } catch {
    try {
      rawRows = (await readSheet(file, 1)) as unknown[][];
    } catch {
      throw new Error(
        'Berkas .xlsx tidak dapat dibaca atau rusak. Pastikan dibuat menggunakan Excel (.xlsx) yang standar.'
      );
    }
  }

  return parseClassificationRows(rawRows);
}
