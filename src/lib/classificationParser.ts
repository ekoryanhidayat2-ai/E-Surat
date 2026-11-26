import type {
  ClassificationCode,
  ClassificationRowPreview,
  ClassificationSchemaError,
  ClassificationValidationSummary,
} from '../types.ts';

export interface ClassificationRowWarning {
  rowNumber: number;
  reason: string;
}

export interface ParsedClassificationImport {
  items: ClassificationCode[];
  warnings: ClassificationRowWarning[];
  errors: ClassificationSchemaError[];
  schemaValid: boolean;
  validation: ClassificationValidationSummary;
  duplicateOverrides: number;
  totalRowsScanned: number;
}

export const CLASSIFICATION_SCHEMA_SPEC = {
  sheetName: 'Klasifikasi',
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 1000,
  codeMaxLength: 24,
  nameMinLength: 2,
  nameMaxLength: 120,
  descriptionMaxLength: 240,
  codePattern: /^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/,
  requiredColumns: ['Kode', 'Nama Klasifikasi'],
  optionalColumns: ['Keterangan'],
} as const;

const CODE_HEADER_ALIASES = new Set([
  'kode',
  'kode klasifikasi',
  'code',
  'classification code',
  'kd klasifikasi',
]);

const NAME_HEADER_ALIASES = new Set([
  'nama',
  'nama klasifikasi',
  'name',
  'uraian',
  'judul',
  'klasifikasi',
]);

const DESC_HEADER_ALIASES = new Set([
  'keterangan',
  'deskripsi',
  'description',
  'catatan',
  'uraian singkat',
]);

export const SAMPLE_CLASSIFICATION_TEMPLATE_ROWS: ClassificationCode[] = [
  {
    code: '400.3',
    name: 'Pendidikan Dasar & Menengah',
    description: 'Kebijakan pendidikan dasar dan menengah secara umum',
  },
  {
    code: '420',
    name: 'Pendidikan & Pembinaan Sekolah',
    description: 'Administrasi umum penyelenggaraan pendidikan sekolah',
  },
  {
    code: '421.3',
    name: 'Pendidikan Menengah / SMP',
    description: 'Kegiatan belajar mengajar, peserta didik, dan rapor',
  },
  {
    code: '422',
    name: 'Administrasi Sekolah & Kesiswaan',
    description: 'Penerimaan murid baru, mutasi siswa, dan absensi',
  },
  {
    code: '423',
    name: 'Kurikulum & Metode Pembelajaran',
    description: 'Jadwal pelajaran, perangkat ajar, dan asesmen sekolah',
  },
  {
    code: '424',
    name: 'Tenaga Pendidik & Kependidikan',
    description: 'Penugasan guru, pegawai TU, dan pembinaan kepegawaian',
  },
  {
    code: '425',
    name: 'Sarana & Prasarana Pendidikan',
    description: 'Pengadaan, pemeliharaan inventaris, gedung, dan laboratorium',
  },
  {
    code: '800',
    name: 'Kepegawaian Umum',
    description: 'Surat tugas, cuti, kenaikan pangkat, dan SK pegawai',
  },
  {
    code: '900',
    name: 'Keuangan & BOS Sekolah',
    description: 'Pengelolaan RKAS, dana BOS, dan pertanggungjawaban keuangan',
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

export function validateClassificationCodeField(
  rawValue: unknown,
  rowNumber: number
): { ok: true; value: string } | { ok: false; error: ClassificationSchemaError } {
  if (rawValue instanceof Date || typeof rawValue === 'boolean') {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'code',
        code: 'INVALID_CODE_TYPE',
        message: 'Kolom Kode harus berupa teks atau angka klasifikasi, bukan tanggal/boolean.',
      },
    };
  }
  const code = normalizeCellText(rawValue);
  if (!code) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'code',
        code: 'REQUIRED_CODE',
        message: 'Kode klasifikasi kosong.',
      },
    };
  }
  if (hasControlChars(code)) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'code',
        code: 'INVALID_CODE_CHARS',
        message: `Kode "${code.slice(0, 16)}" mengandung karakter kontrol tidak valid.`,
      },
    };
  }
  if (code.length > CLASSIFICATION_SCHEMA_SPEC.codeMaxLength) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'code',
        code: 'CODE_TOO_LONG',
        message: `Kode "${code.slice(0, 16)}..." melebihi batas ${CLASSIFICATION_SCHEMA_SPEC.codeMaxLength} karakter.`,
      },
    };
  }
  if (!CLASSIFICATION_SCHEMA_SPEC.codePattern.test(code)) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'code',
        code: 'INVALID_CODE_FORMAT',
        message: `Format kode "${code}" tidak valid. Gunakan huruf/angka tanpa spasi (boleh titik, garis miring, atau tanda hubung).`,
      },
    };
  }
  return { ok: true, value: code };
}

export function validateClassificationNameField(
  rawValue: unknown,
  codeLabel: string,
  rowNumber: number
): { ok: true; value: string } | { ok: false; error: ClassificationSchemaError } {
  if (rawValue instanceof Date || typeof rawValue === 'boolean') {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'name',
        code: 'INVALID_NAME_TYPE',
        message: `Nama klasifikasi kode "${codeLabel || '-'}" harus berupa teks, bukan tanggal/boolean.`,
      },
    };
  }
  const name = normalizeCellText(rawValue);
  if (!name) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'name',
        code: 'REQUIRED_NAME',
        message: `Nama klasifikasi untuk kode "${codeLabel || '-'}" kosong.`,
      },
    };
  }
  if (hasControlChars(name) || hasFormulaPrefix(name)) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'name',
        code: 'INVALID_NAME_FORMAT',
        message: `Nama klasifikasi kode "${codeLabel}" diawali simbol formula atau karakter kontrol terlarang.`,
      },
    };
  }
  if (name.length < CLASSIFICATION_SCHEMA_SPEC.nameMinLength) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'name',
        code: 'NAME_TOO_SHORT',
        message: `Nama klasifikasi kode "${codeLabel}" minimal ${CLASSIFICATION_SCHEMA_SPEC.nameMinLength} karakter.`,
      },
    };
  }
  if (name.length > CLASSIFICATION_SCHEMA_SPEC.nameMaxLength) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'name',
        code: 'NAME_TOO_LONG',
        message: `Nama klasifikasi kode "${codeLabel}" melebihi ${CLASSIFICATION_SCHEMA_SPEC.nameMaxLength} karakter.`,
      },
    };
  }
  return { ok: true, value: name };
}

export function validateClassificationDescriptionField(
  rawValue: unknown,
  codeLabel: string,
  rowNumber: number
): { ok: true; value: string } | { ok: false; error: ClassificationSchemaError } {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { ok: true, value: '' };
  }
  if (typeof rawValue === 'boolean') {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'description',
        code: 'INVALID_DESCRIPTION_TYPE',
        message: `Keterangan kode "${codeLabel}" harus berupa teks.`,
      },
    };
  }
  const description = normalizeCellText(rawValue);
  if (hasControlChars(description) || hasFormulaPrefix(description)) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'description',
        code: 'INVALID_DESCRIPTION_FORMAT',
        message: `Keterangan kode "${codeLabel}" mengandung awalan formula atau karakter kontrol terlarang.`,
      },
    };
  }
  if (description.length > CLASSIFICATION_SCHEMA_SPEC.descriptionMaxLength) {
    return {
      ok: false,
      error: {
        rowNumber,
        field: 'description',
        code: 'DESCRIPTION_TOO_LONG',
        message: `Keterangan kode "${codeLabel}" melebihi batas ${CLASSIFICATION_SCHEMA_SPEC.descriptionMaxLength} karakter (${description.length}/${CLASSIFICATION_SCHEMA_SPEC.descriptionMaxLength}).`,
      },
    };
  }
  return { ok: true, value: description };
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const clean = text.replace(/^\uFEFF/, '');
  // Deteksi pemisah kolom (; atau ,) pada baris pertama di luar tanda kutip
  let commaCount = 0;
  let semiCount = 0;
  for (let i = 0; i < clean.length && clean[i] !== '\n'; i += 1) {
    if (clean[i] === ',') commaCount += 1;
    else if (clean[i] === ';') semiCount += 1;
  }
  const delimiter = semiCount > commaCount ? ';' : ',';

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    const next = clean[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows;
}

export function parseClassificationRows(rawRows: unknown[][]): ParsedClassificationImport {
  const warnings: ClassificationRowWarning[] = [];
  const errors: ClassificationSchemaError[] = [];
  const rowPreviews: ClassificationRowPreview[] = [];
  const deduped = new Map<string, ClassificationCode>();
  let duplicateOverrides = 0;

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    const emptyErr: ClassificationSchemaError = {
      rowNumber: 1,
      field: 'file',
      code: 'EMPTY_FILE',
      message: 'Berkas kosong tanpa data.',
    };
    errors.push(emptyErr);
    warnings.push({ rowNumber: 1, reason: emptyErr.message });
    const validation: ClassificationValidationSummary = {
      schemaValid: false,
      requiredColumns: [...CLASSIFICATION_SCHEMA_SPEC.requiredColumns],
      optionalColumns: [...CLASSIFICATION_SCHEMA_SPEC.optionalColumns],
      detectedHeaders: [],
      headerMatched: { code: false, name: false, description: false },
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

  // Temukan baris pertama yang tidak kosong sebagai baris header skema
  let headerRowIndex = -1;
  for (let r = 0; r < rawRows.length; r += 1) {
    const row = Array.isArray(rawRows[r]) ? rawRows[r] : [];
    if (row.some((cell) => normalizeCellText(cell).length > 0)) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex < 0) {
    const emptyErr: ClassificationSchemaError = {
      rowNumber: 1,
      field: 'file',
      code: 'EMPTY_WORKSHEET',
      message: 'Lembar kerja Excel tidak memiliki baris data atau header.',
    };
    errors.push(emptyErr);
    warnings.push({ rowNumber: 1, reason: emptyErr.message });
    const validation: ClassificationValidationSummary = {
      schemaValid: false,
      requiredColumns: [...CLASSIFICATION_SCHEMA_SPEC.requiredColumns],
      optionalColumns: [...CLASSIFICATION_SCHEMA_SPEC.optionalColumns],
      detectedHeaders: [],
      headerMatched: { code: false, name: false, description: false },
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

  const detectedCodeIdx = tokens.findIndex((t) => CODE_HEADER_ALIASES.has(t));
  const detectedNameIdx = tokens.findIndex((t) => NAME_HEADER_ALIASES.has(t));
  const detectedDescIdx = tokens.findIndex((t) => DESC_HEADER_ALIASES.has(t));

  const headerMatched = {
    code: detectedCodeIdx >= 0,
    name: detectedNameIdx >= 0,
    description: detectedDescIdx >= 0,
  };

  if (!headerMatched.code || !headerMatched.name) {
    const missingCols: string[] = [];
    if (!headerMatched.code) missingCols.push('Kode');
    if (!headerMatched.name) missingCols.push('Nama Klasifikasi');

    const headerMsg = `Skema header tidak sesuai pada baris ${headerRowIndex + 1}: kolom wajib ${missingCols.join(' dan ')} tidak ditemukan (header terbaca: ${detectedHeaders.length > 0 ? detectedHeaders.join(', ') : 'kosong'}).`;
    errors.push({
      rowNumber: headerRowIndex + 1,
      field: 'header',
      code: 'MISSING_REQUIRED_COLUMNS',
      message: headerMsg,
    });
    warnings.push({ rowNumber: headerRowIndex + 1, reason: headerMsg });

    const validation: ClassificationValidationSummary = {
      schemaValid: false,
      requiredColumns: [...CLASSIFICATION_SCHEMA_SPEC.requiredColumns],
      optionalColumns: [...CLASSIFICATION_SCHEMA_SPEC.optionalColumns],
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

  if (detectedCodeIdx === detectedNameIdx) {
    const dupHeaderMsg = `Kolom Kode dan Nama Klasifikasi menunjuk pada kolom yang sama (baris ${headerRowIndex + 1}).`;
    errors.push({
      rowNumber: headerRowIndex + 1,
      field: 'header',
      code: 'AMBIGUOUS_HEADER_COLUMNS',
      message: dupHeaderMsg,
    });
    warnings.push({ rowNumber: headerRowIndex + 1, reason: dupHeaderMsg });
  }

  const codeCol = detectedCodeIdx;
  const nameCol = detectedNameIdx;
  const descCol = detectedDescIdx >= 0 ? detectedDescIdx : -1;

  let totalRowsScanned = 0;
  let invalidCount = 0;

  for (let i = headerRowIndex + 1; i < rawRows.length; i += 1) {
    const row = Array.isArray(rawRows[i]) ? rawRows[i] : [];
    const excelRowNum = i + 1;

    const rawCodeCell = row[codeCol];
    const rawNameCell = row[nameCol];
    const rawDescCell = descCol >= 0 ? row[descCol] : '';

    const rawCodeText = normalizeCellText(rawCodeCell);
    const rawNameText = normalizeCellText(rawNameCell);
    const rawDescText = normalizeCellText(rawDescCell);

    if (!rawCodeText && !rawNameText && !rawDescText) {
      continue;
    }

    totalRowsScanned += 1;
    if (totalRowsScanned > CLASSIFICATION_SCHEMA_SPEC.maxRows) {
      const limitMsg = `Jumlah baris data melebihi batas maksimal ${CLASSIFICATION_SCHEMA_SPEC.maxRows} baris per unggahan.`;
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

    const codeCheck = validateClassificationCodeField(rawCodeCell, excelRowNum);
    if (!codeCheck.ok) {
      const err = (codeCheck as { ok: false; error: ClassificationSchemaError }).error;
      errors.push(err);
      warnings.push({ rowNumber: excelRowNum, reason: err.message });
      invalidCount += 1;
      rowPreviews.push({
        rowNumber: excelRowNum,
        code: rawCodeText || '—',
        name: rawNameText || '—',
        description: rawDescText,
        status: 'invalid',
        errorMessage: err.message,
      });
      continue;
    }

    const nameCheck = validateClassificationNameField(rawNameCell, codeCheck.value, excelRowNum);
    if (!nameCheck.ok) {
      const err = (nameCheck as { ok: false; error: ClassificationSchemaError }).error;
      errors.push(err);
      warnings.push({ rowNumber: excelRowNum, reason: err.message });
      invalidCount += 1;
      rowPreviews.push({
        rowNumber: excelRowNum,
        code: codeCheck.value,
        name: rawNameText || '—',
        description: rawDescText,
        status: 'invalid',
        errorMessage: err.message,
      });
      continue;
    }

    const descCheck = validateClassificationDescriptionField(
      rawDescCell,
      codeCheck.value,
      excelRowNum
    );
    if (!descCheck.ok) {
      const err = (descCheck as { ok: false; error: ClassificationSchemaError }).error;
      errors.push(err);
      warnings.push({ rowNumber: excelRowNum, reason: err.message });
      invalidCount += 1;
      rowPreviews.push({
        rowNumber: excelRowNum,
        code: codeCheck.value,
        name: nameCheck.value,
        description: rawDescText,
        status: 'invalid',
        errorMessage: err.message,
      });
      continue;
    }

    const isDup = deduped.has(codeCheck.value);
    if (isDup) {
      duplicateOverrides += 1;
    }

    deduped.set(codeCheck.value, {
      code: codeCheck.value,
      name: nameCheck.value,
      description: descCheck.value,
    });

    rowPreviews.push({
      rowNumber: excelRowNum,
      code: codeCheck.value,
      name: nameCheck.value,
      description: descCheck.value,
      status: isDup ? 'duplicate' : 'valid',
      errorMessage: isDup
        ? `Duplikat kode "${codeCheck.value}" — baris ini menggantikan definisi baris sebelumnya.`
        : undefined,
    });
  }

  const items = Array.from(deduped.values());
  if (totalRowsScanned === 0) {
    const noDataMsg = 'Header ditemukan, namun tidak ada baris data kode klasifikasi di bawahnya.';
    errors.push({
      rowNumber: headerRowIndex + 2,
      field: 'row',
      code: 'NO_DATA_ROWS',
      message: noDataMsg,
    });
    warnings.push({ rowNumber: headerRowIndex + 2, reason: noDataMsg });
  }

  const schemaValid = errors.length === 0 && items.length > 0;
  const validation: ClassificationValidationSummary = {
    schemaValid,
    requiredColumns: [...CLASSIFICATION_SCHEMA_SPEC.requiredColumns],
    optionalColumns: [...CLASSIFICATION_SCHEMA_SPEC.optionalColumns],
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

export function validateClassificationItemsSchema(
  rawItems: unknown,
  rawMode: unknown = 'merge'
): {
  valid: boolean;
  mode: 'merge' | 'replace';
  items: ClassificationCode[];
  errors: ClassificationSchemaError[];
  duplicateOverrides: number;
} {
  const errors: ClassificationSchemaError[] = [];
  if (rawMode !== undefined && rawMode !== 'merge' && rawMode !== 'replace') {
    errors.push({
      rowNumber: 0,
      field: 'row',
      code: 'INVALID_IMPORT_MODE',
      message: 'Mode impor harus bernilai "merge" atau "replace".',
    });
  }
  const mode: 'merge' | 'replace' = rawMode === 'replace' ? 'replace' : 'merge';

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    errors.push({
      rowNumber: 1,
      field: 'row',
      code: 'EMPTY_ITEMS',
      message: 'Daftar kode klasifikasi yang diimpor tidak boleh kosong.',
    });
    return { valid: false, mode, items: [], errors, duplicateOverrides: 0 };
  }

  if (rawItems.length > CLASSIFICATION_SCHEMA_SPEC.maxRows) {
    errors.push({
      rowNumber: CLASSIFICATION_SCHEMA_SPEC.maxRows + 1,
      field: 'row',
      code: 'MAX_ROWS_EXCEEDED',
      message: `Maksimal ${CLASSIFICATION_SCHEMA_SPEC.maxRows} baris kode klasifikasi per sekali impor.`,
    });
    return { valid: false, mode, items: [], errors, duplicateOverrides: 0 };
  }

  const allowedKeys = new Set(['code', 'name', 'description']);
  const deduped = new Map<string, ClassificationCode>();
  let duplicateOverrides = 0;

  rawItems.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({
        rowNumber,
        field: 'row',
        code: 'INVALID_ROW_OBJECT',
        message: `Baris ke-${rowNumber} harus berupa objek skema klasifikasi yang valid.`,
      });
      return;
    }

    const record = raw as Record<string, unknown>;
    const unexpectedKeys = Object.keys(record).filter((k) => !allowedKeys.has(k));
    if (unexpectedKeys.length > 0) {
      errors.push({
        rowNumber,
        field: 'row',
        code: 'UNEXPECTED_FIELDS',
        message: `Baris ke-${rowNumber} memiliki properti di luar skema: ${unexpectedKeys.join(', ')}.`,
      });
      return;
    }

    const codeCheck = validateClassificationCodeField(record.code, rowNumber);
    if (!codeCheck.ok) {
      errors.push((codeCheck as { ok: false; error: ClassificationSchemaError }).error);
      return;
    }

    const nameCheck = validateClassificationNameField(record.name, codeCheck.value, rowNumber);
    if (!nameCheck.ok) {
      errors.push((nameCheck as { ok: false; error: ClassificationSchemaError }).error);
      return;
    }

    const descCheck = validateClassificationDescriptionField(
      record.description,
      codeCheck.value,
      rowNumber
    );
    if (!descCheck.ok) {
      errors.push((descCheck as { ok: false; error: ClassificationSchemaError }).error);
      return;
    }

    if (deduped.has(codeCheck.value)) {
      duplicateOverrides += 1;
    }

    deduped.set(codeCheck.value, {
      code: codeCheck.value,
      name: nameCheck.value,
      description: descCheck.value,
    });
  });

  const items = Array.from(deduped.values());
  return {
    valid: errors.length === 0 && items.length > 0,
    mode,
    items,
    errors,
    duplicateOverrides,
  };
}
