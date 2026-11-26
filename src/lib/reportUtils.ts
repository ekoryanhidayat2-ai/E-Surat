import type { IncomingLetter, OutgoingLetter } from '../types.ts';

export type ReportScope = 'both' | 'incoming' | 'outgoing';

export interface DateRangeResult {
  startDate: string;
  endDate: string;
  yearMonth: string;
}

export interface MonthlyReportSummary {
  incomingTotal: number;
  incomingPending: number;
  incomingDisposed: number;
  incomingCompleted: number;
  dispositionTotal: number;
  outgoingTotal: number;
  outgoingWaiting: number;
  outgoingSent: number;
  outgoingArchived: number;
}

export interface FilteredMonthlyLetters {
  startDate: string;
  endDate: string;
  incoming: IncomingLetter[];
  outgoing: OutgoingLetter[];
  summary: MonthlyReportSummary;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export function getMonthLastDay(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

export function getMonthDateRange(year: number, month1To12: number): DateRangeResult {
  const safeMonth = Math.min(12, Math.max(1, Math.trunc(month1To12)));
  const safeYear = Math.min(9999, Math.max(1970, Math.trunc(year)));
  const mm = String(safeMonth).padStart(2, '0');
  const lastDay = String(getMonthLastDay(safeYear, safeMonth)).padStart(2, '0');
  return {
    startDate: `${safeYear}-${mm}-01`,
    endDate: `${safeYear}-${mm}-${lastDay}`,
    yearMonth: `${safeYear}-${mm}`,
  };
}

export function getMonthDateRangeFromYm(ym: string): DateRangeResult | null {
  if (!YEAR_MONTH_RE.test(ym)) return null;
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return getMonthDateRange(year, month);
}

export function getDefaultMonthDateRange(baseDate: Date = new Date()): DateRangeResult {
  return getMonthDateRange(baseDate.getFullYear(), baseDate.getMonth() + 1);
}

export function getPreviousMonthDateRange(baseDate: Date = new Date()): DateRangeResult {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  if (month === 1) {
    return getMonthDateRange(year - 1, 12);
  }
  return getMonthDateRange(year, month - 1);
}

export function detectFullMonthYm(startDate: string, endDate: string): string {
  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) return '';
  const ym = startDate.slice(0, 7);
  if (endDate.slice(0, 7) !== ym) return '';
  const range = getMonthDateRangeFromYm(ym);
  if (!range) return '';
  return range.startDate === startDate && range.endDate === endDate ? ym : '';
}

export function normalizeDateRange(
  startDate: string,
  endDate: string
): { startDate: string; endDate: string; isSwapped: boolean; isValid: boolean } {
  const validStart = ISO_DATE_RE.test(startDate);
  const validEnd = ISO_DATE_RE.test(endDate);
  if (!validStart && !validEnd) {
    const fallback = getDefaultMonthDateRange();
    return {
      startDate: fallback.startDate,
      endDate: fallback.endDate,
      isSwapped: false,
      isValid: false,
    };
  }
  if (!validStart && validEnd) {
    return { startDate: endDate, endDate, isSwapped: false, isValid: true };
  }
  if (validStart && !validEnd) {
    return { startDate, endDate: startDate, isSwapped: false, isValid: true };
  }
  if (startDate > endDate) {
    return { startDate: endDate, endDate: startDate, isSwapped: true, isValid: true };
  }
  return { startDate, endDate, isSwapped: false, isValid: true };
}

export function filterLettersByDateRange(
  incomingLetters: IncomingLetter[],
  outgoingLetters: OutgoingLetter[],
  startDate: string,
  endDate: string
): FilteredMonthlyLetters {
  const norm = normalizeDateRange(startDate, endDate);

  const incoming = incomingLetters
    .filter(
      (l) =>
        ISO_DATE_RE.test(l.receivedDate) &&
        l.receivedDate >= norm.startDate &&
        l.receivedDate <= norm.endDate
    )
    .sort((a, b) => {
      const dateCmp = a.receivedDate.localeCompare(b.receivedDate);
      if (dateCmp !== 0) return dateCmp;
      return a.agendaNumber.localeCompare(b.agendaNumber);
    });

  const outgoing = outgoingLetters
    .filter(
      (l) =>
        ISO_DATE_RE.test(l.letterDate) &&
        l.letterDate >= norm.startDate &&
        l.letterDate <= norm.endDate
    )
    .sort((a, b) => {
      const dateCmp = a.letterDate.localeCompare(b.letterDate);
      if (dateCmp !== 0) return dateCmp;
      return a.sequenceNumber - b.sequenceNumber;
    });

  const incomingPending = incoming.filter((l) => l.status === 'Menunggu Disposisi').length;
  const incomingDisposed = incoming.filter((l) => l.status === 'Didisposisikan').length;
  const incomingCompleted = incoming.filter((l) => l.status === 'Selesai').length;
  const dispositionTotal = incoming.reduce((acc, l) => acc + l.dispositions.length, 0);

  const outgoingWaiting = outgoing.filter(
    (l) => l.status === 'Draf' || l.status === 'Menunggu TTD'
  ).length;
  const outgoingSent = outgoing.filter((l) => l.status === 'Terkirim').length;
  const outgoingArchived = outgoing.filter((l) => l.status === 'Diarsipkan').length;

  return {
    startDate: norm.startDate,
    endDate: norm.endDate,
    incoming,
    outgoing,
    summary: {
      incomingTotal: incoming.length,
      incomingPending,
      incomingDisposed,
      incomingCompleted,
      dispositionTotal,
      outgoingTotal: outgoing.length,
      outgoingWaiting,
      outgoingSent,
      outgoingArchived,
    },
  };
}
