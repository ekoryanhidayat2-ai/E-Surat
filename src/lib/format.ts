import type { IncomingLetter, OutgoingLetter } from '../types.ts';

const BULAN_PENDEK = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const BULAN_PANJANG = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const ROMAN_MONTHS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

export function toRomanMonth(month1To12: number): string {
  if (month1To12 < 1 || month1To12 > 12) return 'I';
  return ROMAN_MONTHS[month1To12 - 1];
}

export function formatDateId(dateIso: string, longMonth = false): string {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso || '-';
  const [y, m, d] = dateIso.split('-').map(Number);
  const monthArr = longMonth ? BULAN_PANJANG : BULAN_PENDEK;
  const monthLabel = monthArr[(m || 1) - 1] || BULAN_PENDEK[0];
  return `${String(d).padStart(2, '0')} ${monthLabel} ${y}`;
}

export function formatOutgoingPreview(
  pattern: string,
  classificationCode: string,
  nextSeq: number,
  schoolCode: string,
  letterDateIso: string
): string {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(letterDateIso)
    ? letterDateIso
    : new Date().toISOString().slice(0, 10);
  const [yearStr, monthStr] = validDate.split('-');
  const paddedSeq = String(Math.max(1, nextSeq)).padStart(3, '0');
  const romanMonth = toRomanMonth(Number(monthStr) || 1);

  return pattern
    .replaceAll('{kode}', classificationCode || '421.3')
    .replaceAll('{urut}', paddedSeq)
    .replaceAll('{sekolah}', schoolCode || 'SMPN2-GR')
    .replaceAll('{bulan}', romanMonth)
    .replaceAll('{tahun}', yearStr);
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function triggerCsvDownload(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob([`\uFEFF${csvLines.join('\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportIncomingCsv(letters: IncomingLetter[]): void {
  const today = new Date().toISOString().slice(0, 10);
  triggerCsvDownload(
    `agenda-surat-masuk-smpn2-girimulyo-${today}.csv`,
    [
      'No. Agenda',
      'Tanggal Terima',
      'Nomor Surat Asal',
      'Tanggal Surat',
      'Pengirim / Instansi',
      'Kode Klasifikasi',
      'Perihal',
      'Sifat',
      'Status',
      'Jumlah Disposisi',
      'Catatan',
    ],
    letters.map((l) => [
      l.agendaNumber,
      l.receivedDate,
      l.letterNumber,
      l.letterDate,
      l.sender,
      l.classificationCode,
      l.subject,
      l.urgency,
      l.status,
      l.dispositions.length,
      l.notes,
    ])
  );
}

export function exportOutgoingCsv(letters: OutgoingLetter[]): void {
  const today = new Date().toISOString().slice(0, 10);
  triggerCsvDownload(
    `agenda-surat-keluar-smpn2-girimulyo-${today}.csv`,
    [
      'No. Urut',
      'Nomor Surat Keluar',
      'Tanggal Surat',
      'Kode Klasifikasi',
      'Tujuan / Penerima',
      'Perihal',
      'Konseptor / Unit',
      'Status',
      'Catatan',
    ],
    letters.map((l) => [
      l.sequenceNumber || 'Manual',
      l.fullLetterNumber,
      l.letterDate,
      l.classificationCode,
      l.recipient,
      l.subject,
      l.drafterName,
      l.status,
      l.notes,
    ])
  );
}
