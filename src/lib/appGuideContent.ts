import { APP_THEMES, DEFAULT_THEME_ID, getThemeById, type ThemeId } from './themes.ts';
import type {
  ClassificationCode,
  DispositionRecipient,
  SchoolSettings,
  YearCounter,
} from '../types.ts';

export const APP_GUIDE_METADATA = {
  version: '2.5.0',
  releaseLabel: 'Pembaruan Terpadu · Ekspor Spreadsheet, Excel Klasifikasi & Tema Fresh',
  changelog: [
    'Panduan aplikasi otomatis tersinkronisasi dengan daftar tema, klasifikasi, penerima disposisi, dan tahun aktif aplikasi.',
    'Ekspor database langsung ke Google Spreadsheet (buat baru / perbarui) dari menu Pengaturan Admin.',
    'Template Excel (.xlsx) dan fitur impor massal Kode Klasifikasi Tata Naskah Dinas di tab Klasifikasi & Nomor Urut.',
    'Ekspor kode lengkap & template tema Blogger dipindahkan ke dalam menu Pengaturan khusus Admin.',
    'Manajemen Direktori Guru & Karyawan penerima disposisi, pergantian tahun agenda, serta inisialisasi otomatis penghitung tahun anggaran baru.',
    'Koleksi 16 tema antarmuka termasuk seri Fresh & Elegan (Mode Terang & Mode Gelap) eksklusif untuk Admin.',
  ],
};

export interface AppGuideContext {
  settings: SchoolSettings;
  classifications?: ClassificationCode[];
  dispositionRecipients?: DispositionRecipient[];
  counters?: YearCounter[];
  activeYear?: number | 'all';
  activeThemeId?: ThemeId;
}

export function buildLiveGuideSummary(ctx: AppGuideContext) {
  const lightCount = APP_THEMES.filter((t) => t.mode === 'light').length;
  const darkCount = APP_THEMES.filter((t) => t.mode === 'dark').length;
  const freshCount = APP_THEMES.filter((t) => t.category === 'Fresh & Elegan').length;
  const activeTheme = getThemeById(
    (ctx.activeThemeId || ctx.settings.themeId || DEFAULT_THEME_ID) as ThemeId
  );

  const classificationsCount = ctx.classifications?.length ?? 0;
  const recipientsCount = ctx.dispositionRecipients?.length ?? 0;
  const activeRecipientsCount =
    ctx.dispositionRecipients?.filter((r) => r.isActive).length ?? 0;
  const counterYears = (ctx.counters ?? [])
    .map((c) => c.year)
    .sort((a, b) => b - a);
  const yearScopeLabel =
    ctx.activeYear === 'all' || ctx.activeYear === undefined
      ? 'Semua Tahun'
      : `Tahun ${ctx.activeYear}`;

  return {
    version: APP_GUIDE_METADATA.version,
    releaseLabel: APP_GUIDE_METADATA.releaseLabel,
    totalThemes: APP_THEMES.length,
    lightThemesCount: lightCount,
    darkThemesCount: darkCount,
    freshThemesCount: freshCount,
    activeThemeName: `${activeTheme.name} (${activeTheme.mode === 'dark' ? 'Gelap' : 'Terang'})`,
    classificationsCount,
    recipientsCount,
    activeRecipientsCount,
    counterYears,
    yearScopeLabel,
    autoInitNewYear: ctx.settings.autoInitNewYearCounter ?? true,
    outgoingPattern: ctx.settings.outgoingFormatPattern,
    changelog: APP_GUIDE_METADATA.changelog,
  };
}
