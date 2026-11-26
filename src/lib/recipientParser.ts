import type { DispositionRecipient, StaffCategory } from '../types.ts';

export interface RecipientSchemaError {
  rowNumber: number;
  field: 'header' | 'name' | 'category' | 'nip' | 'unit' | 'row' | 'file';
  code: string;
  message: string;
}

export interface RecipientRowPreview {
  rowNumber: number;
  name: string;
  category: StaffCategory;
  nip: string;
  unit: string;
  isActive: boolean;
  status: 'valid' | 'duplicate' | 'invalid';
  errorMessage?: string;
}

export interface RecipientValidationSummary {
  schemaValid: boolean;
  requiredColumns: string[];
  optionalColumns: string[];
  detectedHeaders: string[];
  headerMatched: {
    name: boolean;
    category: boolean;
    nip: boolean;
    unit: boolean;
  };
  totalRowsScanned: number;
  validCount: number;
  invalidCount: number;
  duplicateOverrides: number;
  errors: RecipientSchemaError[];
  rowPreviews: RecipientRowPreview[];
}

export interface ParsedRecipientImport {
  items: Array<{
    name: string;
    category: StaffCategory;
    nip: string;
    unit: string;
    isActive: boolean;
  }>;
  warnings: Array<{ rowNumber: number; reason: string }>;
  errors: RecipientSchemaError[];
  schemaValid: boolean;
  validation: RecipientValidationSummary;
  duplicateOverrides: number;
  totalRowsScanned: number;
}

export const RECIPIENT_SCHEMA_SPEC = {
  sheetName: 'Guru & Karyawan',
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 1000,
  nameMaxLength: 120,
  nipMaxLength: 40,
  unitMaxLength: 120,
  requiredColumns: ['Nama Lengkap', 'Kategori'],
  optionalColumns: ['NIP / NUPTK', 'Unit / Jabatan'],
} as const;

const NAME_ALIASES = new Set(['nama', 'nama lengkap', 'nama lengkap dan gelar', 'name', 'pegawai']);
const CATEGORY_ALIASES = new Set(['kategori', 'kategori pegawai', 'category', 'jenis']);
const NIP_ALIASES = new Set(['nip', 'nipp', 'nuptk', 'nip nuptk', 'nomor induk']);
const UNIT_ALIASES = new Set(['unit', 'jabatan', 'unit kerja', 'satuan tugas', 'bagian']);

export const SAMPLE_RECIPIENT_TEMPLATE_ROWS: Array<{
  name: string;
  category: StaffCategory;
  nip: string;
  unit: string;
  isActive: boolean;
}> = [
  {
    name: 'Drs. H. Ahmad Fauzi, M.Pd.',
    category: 'Guru',
    nip: '19681215 199403 1 005',
    unit: 'Wakil Kepala Sekolah Bidang Kurikulum',
    isActive: true,
  },
  {
    name: 'Siti Aminah, S.Pd.',
    category: 'Guru',
    nip: '19820415 201001 2 012',
    unit: 'Koordinator Bimbingan Konseling (BK)',
    isActive: true,
  },
  {
    name: 'Eko Prasetyo, S.Kom.',
    category: 'Guru',
    nip: '19880520 201402 1 003',
    unit: 'Pengelola Laboratorium TIK',
    isActive: true,
  },
  {
    name: 'Budi Santoso',
    category: 'Karyawan',
    nip: '19750810 200501 1 004',
    unit: 'Bagian Tata Usaha',
    isActive: true,
  },
  {
    name: 'Sri Lestari, A.Md.',
    category: 'Karyawan',
    nip: '19890312 201503 2 001',
    unit: 'Bendahara BOS / Keuangan',
    isActive: true,
  },
];

function normalizeCellText(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).replace(/\s+/g, ' ').trim();
}

function normalizeHeaderToken(val: unknown): string {
  return normalizeCellText(val)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0 && code < 32) || code === 127) {
      return true;
    }
  }
  return false;
}

function hasFormulaPrefix(text: string): boolean {
  return /^[=@]/.test(text);
}

export function parseRecipientRows(rawRows: unknown[][]): ParsedRecipientImport {
  const warnings: Array<{ rowNumber: number; reason: string }> = [];
  const errors: RecipientSchemaError[] = [];
  const rowPreviews: RecipientRowPreview[] = [];
  const deduped = new Map<string, {
    name: string;
    category: StaffCategory;
    nip: string;
    unit: string;
    isActive: boolean;
  }>();
  let duplicateOverrides = 0;

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    const emptyErr: RecipientSchemaError = {
      rowNumber: 1,
      field: 'file',
      code: 'EMPTY_FILE',
      message: 'Berkas Excel kosong tanpa data.',
    };
    errors.push(emptyErr);
    warnings.push({ rowNumber: 1, reason: emptyErr.message });
    const validation: RecipientValidationSummary = {
      schemaValid: false,
      requiredColumns: [...RECIPIENT_SCHEMA_SPEC.requiredColumns],
      optionalColumns: [...RECIPIENT_SCHEMA_SPEC.optionalColumns],
      detectedHeaders: [],
      headerMatched: { name: false, category: false, nip: false, unit: false },
      totalRowsScanned: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateOverrides: 0,
      errors,
      rowPreviews,
    };
    return {
      items: [],
      warnings,
      errors,
      schemaValid: false,
      validation,
      duplicateOverrides: 0,
      totalRowsScanned: 0,
    };
  }

  let headerRowIndex = -1;
  for (let r = 0; r < rawRows.length; r += 1) {
    const row = Array.isArray(rawRows[r]) ? rawRows[r] : [];
    if (row.some((cell) => normalizeCellText(cell).length > 0)) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex < 0) {
    const emptyErr: RecipientSchemaError = {
      rowNumber: 1,
      field: 'file',
      code: 'EMPTY_WORKSHEET',
      message: 'Lembar kerja Excel tidak memiliki baris data atau header.',
    };
    errors.push(emptyErr);
    warnings.push({ rowNumber: 1, reason: emptyErr.message });
    const validation: RecipientValidationSummary = {
      schemaValid: false,
      requiredColumns: [...RECIPIENT_SCHEMA_SPEC.requiredColumns],
      optionalColumns: [...RECIPIENT_SCHEMA_SPEC.optionalColumns],
      detectedHeaders: [],
      headerMatched: { name: false, category: false, nip: false, unit: false },
      totalRowsScanned: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateOverrides: 0,
      errors,
      rowPreviews,
    };
    return {
      items: [],
      warnings,
      errors,
      schemaValid: false,
      validation,
      duplicateOverrides: 0,
      totalRowsScanned: 0,
    };
  }

  const headerRow = rawRows[headerRowIndex] || [];
  const detectedHeaders = headerRow
    .map((cell) => normalizeCellText(cell))
    .filter((label) => label.length > 0);
  const tokens = headerRow.map(normalizeHeaderToken);

  const detectedNameIdx = tokens.findIndex((t) => NAME_ALIASES.has(t));
  const detectedCatIdx = tokens.findIndex((t) => CATEGORY_ALIASES.has(t));
  const detectedNipIdx = tokens.findIndex((t) => NIP_ALIASES.has(t));
  const detectedUnitIdx = tokens.findIndex((t) => UNIT_ALIASES.has(t));

  const headerMatched = {
    name: detectedNameIdx >= 0,
    category: detectedCatIdx >= 0,
    nip: detectedNipIdx >= 0,
    unit: detectedUnitIdx >= 0,
  };

  if (!headerMatched.name || !headerMatched.category) {
    const missing: string[] = [];
    if (!headerMatched.name) missing.push('Nama Lengkap');
    if (!headerMatched.category) missing.push('Kategori');

    const msg = `Skema header tidak sesuai pada baris ${headerRowIndex + 1}: kolom wajib ${missing.join(' dan ')} tidak ditemukan.`;
    errors.push({
      rowNumber: headerRowIndex + 1,
      field: 'header',
      code: 'MISSING_REQUIRED_COLUMNS',
      message: msg,
    });
    warnings.push({ rowNumber: headerRowIndex + 1, reason: msg });

    const validation: RecipientValidationSummary = {
      schemaValid: false,
      requiredColumns: [...RECIPIENT_SCHEMA_SPEC.requiredColumns],
      optionalColumns: [...RECIPIENT_SCHEMA_SPEC.optionalColumns],
      detectedHeaders,
      headerMatched,
      totalRowsScanned: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateOverrides: 0,
      errors,
      rowPreviews,
    };
    return {
      items: [],
      warnings,
      errors,
      schemaValid: false,
      validation,
      duplicateOverrides: 0,
      totalRowsScanned: 0,
    };
  }

  const nameCol = detectedNameIdx;
  const catCol = detectedCatIdx;
  const nipCol = detectedNipIdx >= 0 ? detectedNipIdx : -1;
  const unitCol = detectedUnitIdx >= 0 ? detectedUnitIdx : -1;

  let totalRowsScanned = 0;
  let invalidCount = 0;

  for (let i = headerRowIndex + 1; i < rawRows.length; i += 1) {
    const row = Array.isArray(rawRows[i]) ? rawRows[i] : [];
    const excelRowNum = i + 1;

    const rawNameCell = row[nameCol];
    const rawCatCell = row[catCol];
    const rawNipCell = nipCol >= 0 ? row[nipCol] : '';
    const rawUnitCell = unitCol >= 0 ? row[unitCol] : '';

    const nameText = normalizeCellText(rawNameCell);
    const catText = normalizeCellText(rawCatCell);
    const nipText = normalizeCellText(rawNipCell);
    const unitText = normalizeCellText(rawUnitCell);

    if (!nameText && !catText && !nipText && !unitText) {
      continue;
    }

    totalRowsScanned += 1;
    if (totalRowsScanned > RECIPIENT_SCHEMA_SPEC.maxRows) {
      const limitMsg = `Jumlah baris melebihi batas maksimal ${RECIPIENT_SCHEMA_SPEC.maxRows} baris per impor.`;
      if (!errors.some((e) => e.code === 'MAX_ROWS_EXCEEDED')) {
        errors.push({
          rowNumber: excelRowNum,
          field: 'row',
          code: 'MAX_ROWS_EXCEEDED',
          message: limitMsg,
        });
        warnings.push({ rowNumber: excelRowNum, reason: limitMsg });
      }
      invalidCount += 1;
      continue;
    }

    if (!nameText || nameText.length < 2 || nameText.length > RECIPIENT_SCHEMA_SPEC.nameMaxLength || hasControlChars(nameText) || hasFormulaPrefix(nameText)) {
      const err: RecipientSchemaError = {
        rowNumber: excelRowNum,
        field: 'name',
        code: 'INVALID_NAME',
        message: `Nama lengkap pada baris ${excelRowNum} kosong atau tidak valid (wajib 2-${RECIPIENT_SCHEMA_SPEC.nameMaxLength} karakter).`,
      };
      errors.push(err);
      warnings.push({ rowNumber: excelRowNum, reason: err.message });
      invalidCount += 1;
      rowPreviews.push({
        rowNumber: excelRowNum,
        name: nameText || '—',
        category: 'Guru',
        nip: nipText,
        unit: unitText,
        isActive: true,
        status: 'invalid',
        errorMessage: err.message,
      });
      continue;
    }

    const lowerCat = catText.toLowerCase();
    let category: StaffCategory = 'Guru';
    if (lowerCat.includes('karyawan') || lowerCat.includes('pegawai') || lowerCat.includes('tendik') || lowerCat.includes('staff')) {
      category = 'Karyawan';
    } else if (lowerCat.includes('guru') || lowerCat.includes('pendidik') || lowerCat.includes('pengajar')) {
      category = 'Guru';
    } else if (catText !== 'Guru' && catText !== 'Karyawan') {
      const err: RecipientSchemaError = {
        rowNumber: excelRowNum,
        field: 'category',
        code: 'INVALID_CATEGORY',
        message: `Kategori "${catText}" pada baris ${excelRowNum} tidak dikenal. Gunakan "Guru" atau "Karyawan".`,
      };
      errors.push(err);
      warnings.push({ rowNumber: excelRowNum, reason: err.message });
      invalidCount += 1;
      rowPreviews.push({
        rowNumber: excelRowNum,
        name: nameText,
        category: 'Guru',
        nip: nipText,
        unit: unitText,
        isActive: true,
        status: 'invalid',
        errorMessage: err.message,
      });
      continue;
    } else {
      category = catText as StaffCategory;
    }

    const nip = nipText.slice(0, RECIPIENT_SCHEMA_SPEC.nipMaxLength);
    const unit = unitText.slice(0, RECIPIENT_SCHEMA_SPEC.unitMaxLength);

    const mapKey = `${nameText.toLowerCase()}|${category}`;
    const isDup = deduped.has(mapKey);
    if (isDup) {
      duplicateOverrides += 1;
    }

    deduped.set(mapKey, {
      name: nameText,
      category,
      nip,
      unit,
      isActive: true,
    });

    rowPreviews.push({
      rowNumber: excelRowNum,
      name: nameText,
      category,
      nip,
      unit,
      isActive: true,
      status: isDup ? 'duplicate' : 'valid',
      errorMessage: isDup ? 'Nama duplikat, baris ini menimpa entri sebelumnya.' : undefined,
    });
  }

  const items = Array.from(deduped.values());
  const schemaValid = errors.length === 0 && items.length > 0;
  const validation: RecipientValidationSummary = {
    schemaValid,
    requiredColumns: [...RECIPIENT_SCHEMA_SPEC.requiredColumns],
    optionalColumns: [...RECIPIENT_SCHEMA_SPEC.optionalColumns],
    detectedHeaders,
    headerMatched,
    totalRowsScanned,
    validCount: items.length,
    invalidCount,
    duplicateOverrides,
    errors,
    rowPreviews,
  };

  return {
    items,
    warnings,
    errors,
    schemaValid,
    validation,
    duplicateOverrides,
    totalRowsScanned,
  };
}

export function validateRecipientItemsSchema(rawItems: unknown): {
  valid: boolean;
  items: Array<{ name: string; category: StaffCategory; nip: string; unit: string; isActive: boolean }>;
  errors: RecipientSchemaError[];
} {
  const errors: RecipientSchemaError[] = [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    errors.push({
      rowNumber: 1,
      field: 'row',
      code: 'EMPTY_ITEMS',
      message: 'Daftar penerima disposisi tidak boleh kosong.',
    });
    return { valid: false, items: [], errors };
  }

  const deduped = new Map<string, { name: string; category: StaffCategory; nip: string; unit: string; isActive: boolean }>();
  rawItems.forEach((raw, idx) => {
    const rowNum = idx + 1;
    if (!raw || typeof raw !== 'object') {
      errors.push({
        rowNumber: rowNum,
        field: 'row',
        code: 'INVALID_ROW',
        message: `Baris ke-${rowNum} tidak valid.`,
      });
      return;
    }
    const rec = raw as Record<string, unknown>;
    const name = normalizeCellText(rec.name);
    const cat = normalizeCellText(rec.category);
    const nip = normalizeCellText(rec.nip);
    const unit = normalizeCellText(rec.unit);
    const isActive = rec.isActive !== false;

    if (!name || name.length > RECIPIENT_SCHEMA_SPEC.nameMaxLength) {
      errors.push({
        rowNumber: rowNum,
        field: 'name',
        code: 'INVALID_NAME',
        message: `Nama pada baris ${rowNum} wajib diisi (maks. ${RECIPIENT_SCHEMA_SPEC.nameMaxLength} karakter).`,
      });
      return;
    }
    if (cat !== 'Guru' && cat !== 'Karyawan') {
      errors.push({
        rowNumber: rowNum,
        field: 'category',
        code: 'INVALID_CATEGORY',
        message: `Kategori pada baris ${rowNum} harus bernilai "Guru" atau "Karyawan".`,
      });
      return;
    }

    const key = `${name.toLowerCase()}|${cat}`;
    deduped.set(key, {
      name,
      category: cat as StaffCategory,
      nip: nip.slice(0, RECIPIENT_SCHEMA_SPEC.nipMaxLength),
      unit: unit.slice(0, RECIPIENT_SCHEMA_SPEC.unitMaxLength),
      isActive,
    });
  });

  const items = Array.from(deduped.values());
  return {
    valid: errors.length === 0 && items.length > 0,
    items,
    errors,
  };
}
