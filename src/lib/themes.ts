export type ThemeId =
  | 'navy-dinasti'
  | 'safir-porselen'
  | 'giok-embun'
  | 'langit-nordik'
  | 'koral-mutiara'
  | 'teal-korporat'
  | 'perak-monolit'
  | 'zamrud-pendidik'
  | 'indigo-arsip'
  | 'batu-hangat'
  | 'tengah-malam-giok'
  | 'beludru-indigo'
  | 'antrasit-kaca'
  | 'malam-eksekutif'
  | 'obsidian-zamrud'
  | 'malam-lembayung';

export type ThemeCategory = 'Fresh & Elegan' | 'Modern Eksekutif' | 'Klasik Dinas';

export interface AppTheme {
  id: ThemeId;
  name: string;
  subtitle: string;
  category: ThemeCategory;
  mode: 'light' | 'dark';
  swatches: [string, string, string];
}

export const DEFAULT_THEME_ID: ThemeId = 'navy-dinasti';
const THEME_STORAGE_KEY = 'esurat_theme_id';

export const APP_THEMES: AppTheme[] = [
  {
    id: 'navy-dinasti',
    name: 'Navy Dinas (Bawaan)',
    subtitle: 'Biru tua resmi instansi pendidikan dengan kanvas putih bersih berstruktur.',
    category: 'Klasik Dinas',
    mode: 'light',
    swatches: ['#F5F7FB', '#FFFFFF', '#102A43'],
  },
  {
    id: 'safir-porselen',
    name: 'Porselen & Safir Segar',
    subtitle: 'Kanvas porselen sejuk dengan aksen biru safir cerah yang modern dan berwibawa.',
    category: 'Fresh & Elegan',
    mode: 'light',
    swatches: ['#F4F7FC', '#FFFFFF', '#1E40AF'],
  },
  {
    id: 'giok-embun',
    name: 'Embun Pagi & Giok',
    subtitle: 'Nuansa embun botani lembut dengan aksen giok segar yang tenang dan kontemporer.',
    category: 'Fresh & Elegan',
    mode: 'light',
    swatches: ['#F3F8F6', '#FFFFFF', '#0D7A66'],
  },
  {
    id: 'langit-nordik',
    name: 'Nordik & Biru Cerah',
    subtitle: 'Estetika Skandinavia ultra-bersih dengan biru laut cerah untuk keterbacaan optimal.',
    category: 'Fresh & Elegan',
    mode: 'light',
    swatches: ['#F4F8FB', '#FFFFFF', '#0369A1'],
  },
  {
    id: 'koral-mutiara',
    name: 'Mutiara & Rosewood',
    subtitle: 'Kanvas mutiara halus dengan aksen rosewood elegan yang hangat namun tetap profesional.',
    category: 'Fresh & Elegan',
    mode: 'light',
    swatches: ['#FAF7F6', '#FFFFFF', '#9F2B47'],
  },
  {
    id: 'teal-korporat',
    name: 'Teal Eksekutif',
    subtitle: 'Nuansa teal oseanik kontemporer dengan kontras bersih untuk kerja harian.',
    category: 'Modern Eksekutif',
    mode: 'light',
    swatches: ['#F4F8F9', '#FFFFFF', '#0F5C6E'],
  },
  {
    id: 'perak-monolit',
    name: 'Perak & Kobalt',
    subtitle: 'Minimalis abu-perak presisi dengan aksen biru kobalt berkarakter modern.',
    category: 'Modern Eksekutif',
    mode: 'light',
    swatches: ['#F6F7FA', '#FFFFFF', '#1D4ED8'],
  },
  {
    id: 'zamrud-pendidik',
    name: 'Zamrud Akademik',
    subtitle: 'Hijau zamrud tenang yang sejuk dan nyaman untuk ruang tata usaha sekolah.',
    category: 'Klasik Dinas',
    mode: 'light',
    swatches: ['#F4F8F6', '#FFFFFF', '#0F4C3A'],
  },
  {
    id: 'indigo-arsip',
    name: 'Indigo Modern',
    subtitle: 'Nuansa indigo eksekutif kontemporer dengan keterbacaan tabel yang tajam.',
    category: 'Modern Eksekutif',
    mode: 'light',
    swatches: ['#F6F7FB', '#FFFFFF', '#27306B'],
  },
  {
    id: 'batu-hangat',
    name: 'Grafit & Kertas Hangat',
    subtitle: 'Editorial minimalis bernuansa kertas arsip dan tinta grafit netral.',
    category: 'Klasik Dinas',
    mode: 'light',
    swatches: ['#F7F6F3', '#FFFFFF', '#292524'],
  },
  {
    id: 'tengah-malam-giok',
    name: 'Tengah Malam & Giok',
    subtitle: 'Mode gelap laut dalam berkelas dengan aksen giok-teal cerah tanpa silau layar.',
    category: 'Fresh & Elegan',
    mode: 'dark',
    swatches: ['#071116', '#0E1B22', '#0F766E'],
  },
  {
    id: 'beludru-indigo',
    name: 'Beludru Malam & Indigo',
    subtitle: 'Mode gelap obsidian beludru dengan aksen indigo halus yang mewah dan fokus.',
    category: 'Fresh & Elegan',
    mode: 'dark',
    swatches: ['#0A0D18', '#12172A', '#4338CA'],
  },
  {
    id: 'antrasit-kaca',
    name: 'Karbon & Safir',
    subtitle: 'Mode gelap antrasit presisi dengan aksen biru safir yang tegas dan elegan.',
    category: 'Modern Eksekutif',
    mode: 'dark',
    swatches: ['#0B0E14', '#121722', '#2563EB'],
  },
  {
    id: 'malam-eksekutif',
    name: 'Malam Eksekutif',
    subtitle: 'Mode gelap biru tengah malam yang nyaman di mata saat bekerja malam.',
    category: 'Klasik Dinas',
    mode: 'dark',
    swatches: ['#0B1120', '#111A2E', '#1D4ED8'],
  },
  {
    id: 'obsidian-zamrud',
    name: 'Obsidian Zamrud',
    subtitle: 'Mode gelap grafit-giok berkarakter modern dan minim silau layar.',
    category: 'Modern Eksekutif',
    mode: 'dark',
    swatches: ['#0A100F', '#101B19', '#047857'],
  },
  {
    id: 'malam-lembayung',
    name: 'Grafit & Amber',
    subtitle: 'Mode gelap batu bara hangat dengan aksen tembaga-amber yang tenang.',
    category: 'Modern Eksekutif',
    mode: 'dark',
    swatches: ['#0E1014', '#16181F', '#B45309'],
  },
];

export function getThemeById(id: string | null | undefined): AppTheme {
  return APP_THEMES.find((t) => t.id === id) ?? APP_THEMES[0];
}

export function getStoredThemeId(): ThemeId {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return getThemeById(raw).id;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Abaikan jika localStorage diblokir
  }
}

export function applyThemeToDocument(id: ThemeId): AppTheme {
  const theme = getThemeById(id);
  const root = document.documentElement;
  root.classList.toggle('dark', theme.mode === 'dark');
  root.setAttribute('data-theme', theme.id);
  return theme;
}
