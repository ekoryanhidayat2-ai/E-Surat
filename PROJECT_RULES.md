# Aturan Proyek — E-Surat SMP Negeri 2 Girimulyo

Dokumen ini menjadi pedoman teknis bagi pengembang dan pengelola aplikasi manajemen persuratan **SMP Negeri 2 Girimulyo**.

## 1. Cara Menjalankan Proyek

Prasyarat sistem: **Node.js v22+** (dibutuhkan untuk dukungan native `node:sqlite` dan eksekusi TypeScript).

1. **Instalasi dependensi**:
   ```bash
   npm install
   ```
2. **Menyiapkan environment variable**:
   Salin `.env.example` menjadi `.env` lalu sesuaikan jika perlu:
   ```bash
   cp .env.example .env
   ```
3. **Menjalankan mode pengembangan (Development)**:
   ```bash
   npm run dev
   ```
   Aplikasi berjalan di `http://localhost:3000` (Express API + Vite HMR middleware).
4. **Menjalankan unit test & integrasi**:
   ```bash
   npm test
   ```
5. **Pemeriksaan tipe TypeScript (`lint`) & build produksi**:
   ```bash
   npm run lint
   npm run build
   NODE_ENV=production npm start
   ```

## 2. Struktur Folder

```text
/
├── server.ts                  # Entry point Express + Vite (dev) / static dist (prod)
├── server/
│   ├── app.ts                 # Routing REST API, upload lampiran, dan error middleware
│   ├── db.ts                  # Lapisan database SQLite (node:sqlite), validasi & transaksi
│   └── logger.ts              # Pencatat error ke file & SQLite + pengirim webhook
├── src/
│   ├── types.ts               # Definisi tipe TypeScript bersama (frontend & backend)
│   ├── index.css              # Konfigurasi Tailwind v4, tipografi, dan @media print A4
│   ├── lib/
│   │   ├── api.ts             # Klien HTTP terketik untuk memanggil /api/*
│   │   └── format.ts          # Format tanggal Indonesia, bulan Romawi, ekspor CSV
│   └── components/
│       ├── DashboardView.tsx       # Ringkasan KPI dan antrean prioritas
│       ├── IncomingLettersView.tsx # Buku agenda surat masuk + filter + ekspor
│       ├── OutgoingLettersView.tsx # Buku agenda surat keluar + filter + ekspor
│       ├── DispositionsView.tsx    # Pelacakan tindak lanjut disposisi antar unit
│       ├── SettingsView.tsx        # Profil/Kop Surat sekolah & kode klasifikasi
│       ├── LetterFormModal.tsx     # Modal catat/edit surat & generator nomor otomatis
│       ├── LetterDetailDrawer.tsx  # Panel detail surat, lampiran, dan disposisi
│       ├── PrintPreviewModal.tsx   # Pratinjau cetak A4 Lembar Disposisi & Buku Agenda
│       └── SchoolCrest.tsx         # Lambang vektor institusi untuk Kop Surat
├── tests/
│   └── persuratan.test.ts     # Unit test & API test (alur normal & kasus gagal)
├── data/                      # Data persisten lokal (diabaikan oleh Git)
│   ├── persuratan.db          # File database SQLite
│   ├── uploads/               # Lampiran PDF/gambar yang diunggah
│   └── logs/error.log         # Log error terstruktur format JSON Lines
├── PROJECT_RULES.md           # Dokumen aturan proyek ini
├── DEPLOY.md                  # Panduan deploy ke layanan hosting
└── MONITORING.md              # Panduan monitoring error dan notifikasi
```

## 3. Gaya Kode & Konvensi

- **TypeScript Erasable**: Kode backend (`server.ts`, `server/*.ts`, `src/types.ts`) wajib menggunakan sintaks TypeScript yang kompatibel dengan *Node 22 native type stripping* (hindari `enum`; gunakan union type seperti `'Biasa' | 'Penting'` beserta konstanta array `as const`).
- **Impor Eksplisit**: Gunakan ekstensi `.ts` pada impor modul internal server agar berjalan konsisten di `tsx` dan `node server.ts`.
- **Validasi Dua Lapis**: Validasi input dilakukan di UI formulir dan diwajibkan ulang di `server/db.ts` menggunakan helper `assertNonEmptyText`, `assertIsoDate`, serta transaksi `BEGIN IMMEDIATE` untuk mencegah bentrok nomor urut surat.
- **Keamanan Secret**: Jangan pernah menulis kredensial, token webhook, atau API key langsung di kode frontend (`src/`) maupun mengirim file `.env` atau `data/` ke repositori Git.
- **Desain UI & Aksesibilitas**:
  - Gunakan `Plus Jakarta Sans` untuk judul, `Public Sans` untuk isi/tabel, dan `JetBrains Mono` dengan kelas `tabular-nums` untuk seluruh nomor surat, nomor agenda, dan tanggal.
  - Gunakan tata letak datar berbingkai `1px solid` tanpa kartu bertumpuk dan tanpa kapsul warna-warni (`rounded-full`) untuk metadata statis.
