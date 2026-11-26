import type {
  IncomingLetter,
  LetterRegulation,
  OutgoingLetter,
  YearCounter,
} from '../types.ts';

export type ActiveYearSelection = 'all' | number;

export const YEAR_MIN = 2000;
export const YEAR_MAX = 2100;
export const ACTIVE_YEAR_STORAGE_KEY = 'esurat_active_year_v1';
export const CUSTOM_YEARS_STORAGE_KEY = 'esurat_custom_years_v1';

export function isValidWorkYear(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= YEAR_MIN &&
    value <= YEAR_MAX
  );
}

export function getStoredActiveYear(
  fallbackYear: number = new Date().getFullYear()
): ActiveYearSelection {
  try {
    const raw = window.localStorage.getItem(ACTIVE_YEAR_STORAGE_KEY);
    if (!raw) return fallbackYear;
    if (raw === 'all') return 'all';
    const parsed = Number(raw);
    return isValidWorkYear(parsed) ? parsed : fallbackYear;
  } catch {
    return fallbackYear;
  }
}

export function saveActiveYear(selection: ActiveYearSelection): void {
  try {
    window.localStorage.setItem(
      ACTIVE_YEAR_STORAGE_KEY,
      selection === 'all' ? 'all' : String(selection)
    );
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }
}

export function getStoredCustomYears(): number[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_YEARS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.map((item) => Number(item)).filter((y) => isValidWorkYear(y)))
    ).sort((a, b) => b - a);
  } catch {
    return [];
  }
}

export function saveStoredCustomYears(years: number[]): void {
  try {
    const cleaned = Array.from(
      new Set(years.filter((y) => isValidWorkYear(y)))
    ).sort((a, b) => b - a);
    window.localStorage.setItem(CUSTOM_YEARS_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }
}

export function getDefaultDateForYear(
  targetYear: number,
  referenceDate: Date = new Date()
): string {
  const safeYear = isValidWorkYear(targetYear)
    ? targetYear
    : referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;
  const maxDay = new Date(Date.UTC(safeYear, month, 0)).getUTCDate();
  const day = Math.min(referenceDate.getDate(), maxDay);
  return `${safeYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function replaceDateYear(isoDate: string, targetYear: number): string {
  if (!isValidWorkYear(targetYear)) return isoDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return getDefaultDateForYear(targetYear);
  }
  const [, mStr, dStr] = isoDate.split('-');
  const month = Math.min(12, Math.max(1, Number(mStr) || 1));
  const maxDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Number(dStr) || 1), maxDay);
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function extractYearFromIsoDate(isoDate: string | undefined): number | null {
  if (!isoDate || isoDate.length < 4) return null;
  const year = Number(isoDate.slice(0, 4));
  return isValidWorkYear(year) ? year : null;
}

export function collectAvailableYears(params: {
  counters?: YearCounter[];
  incoming?: IncomingLetter[];
  outgoing?: OutgoingLetter[];
  regulations?: LetterRegulation[];
  customYears?: number[];
  activeYear?: ActiveYearSelection;
  baseYear?: number;
}): number[] {
  const baseYear = isValidWorkYear(params.baseYear)
    ? params.baseYear
    : new Date().getFullYear();
  const set = new Set<number>([baseYear - 1, baseYear, baseYear + 1]);

  for (const c of params.counters ?? []) {
    if (isValidWorkYear(c.year)) set.add(c.year);
  }
  for (const l of params.incoming ?? []) {
    if (isValidWorkYear(l.agendaYear)) set.add(l.agendaYear);
    const parsed = extractYearFromIsoDate(l.receivedDate);
    if (parsed !== null) set.add(parsed);
  }
  for (const l of params.outgoing ?? []) {
    if (isValidWorkYear(l.letterYear)) set.add(l.letterYear);
    const parsed = extractYearFromIsoDate(l.letterDate);
    if (parsed !== null) set.add(parsed);
  }
  for (const r of params.regulations ?? []) {
    if (isValidWorkYear(r.year)) set.add(r.year);
  }
  for (const y of params.customYears ?? []) {
    if (isValidWorkYear(y)) set.add(y);
  }
  if (isValidWorkYear(params.activeYear)) {
    set.add(params.activeYear);
  }

  return Array.from(set).sort((a, b) => b - a);
}

export const UPCOMING_YEAR_WARNING_DAYS = 45;
export const FISCAL_WARNING_DISMISSED_KEY = 'esurat_dismissed_fiscal_year_v1';

export type FiscalYearAlertReason =
  | 'current_uninitialized'
  | 'upcoming_uninitialized'
  | 'ready';

export interface FiscalYearReadiness {
  shouldNotify: boolean;
  reason: FiscalYearAlertReason;
  currentYear: number;
  nextYear: number;
  targetYear: number;
  daysUntilNewYear: number;
  hasCurrentYearCounter: boolean;
  hasNextYearCounter: boolean;
  targetCounter: YearCounter | null;
}

export function evaluateFiscalYearReadiness(
  counters: YearCounter[],
  referenceDate: Date = new Date()
): FiscalYearReadiness {
  const currentYear = referenceDate.getFullYear();
  const nextYear = currentYear + 1;
  const todayUtc = Date.UTC(
    currentYear,
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const janNextUtc = Date.UTC(nextYear, 0, 1);
  const daysUntilNewYear = Math.max(0, Math.round((janNextUtc - todayUtc) / 86_400_000));

  const currentCounter = counters.find((c) => c.year === currentYear) ?? null;
  const nextCounter = counters.find((c) => c.year === nextYear) ?? null;
  const hasCurrentYearCounter = Boolean(currentCounter);
  const hasNextYearCounter = Boolean(nextCounter);

  if (!hasCurrentYearCounter) {
    return {
      shouldNotify: true,
      reason: 'current_uninitialized',
      currentYear,
      nextYear,
      targetYear: currentYear,
      daysUntilNewYear,
      hasCurrentYearCounter,
      hasNextYearCounter,
      targetCounter: null,
    };
  }

  if (daysUntilNewYear <= UPCOMING_YEAR_WARNING_DAYS && !hasNextYearCounter) {
    return {
      shouldNotify: true,
      reason: 'upcoming_uninitialized',
      currentYear,
      nextYear,
      targetYear: nextYear,
      daysUntilNewYear,
      hasCurrentYearCounter,
      hasNextYearCounter,
      targetCounter: null,
    };
  }

  return {
    shouldNotify: false,
    reason: 'ready',
    currentYear,
    nextYear,
    targetYear: nextYear,
    daysUntilNewYear,
    hasCurrentYearCounter,
    hasNextYearCounter,
    targetCounter: nextCounter,
  };
}

export function getDismissedFiscalWarningYear(): number | null {
  try {
    const raw = window.localStorage.getItem(FISCAL_WARNING_DISMISSED_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return isValidWorkYear(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function dismissFiscalWarningYear(year: number | null): void {
  try {
    if (year === null) {
      window.localStorage.removeItem(FISCAL_WARNING_DISMISSED_KEY);
    } else if (isValidWorkYear(year)) {
      window.localStorage.setItem(FISCAL_WARNING_DISMISSED_KEY, String(year));
    }
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }
}

