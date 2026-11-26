# Panduan Deploy — E-Surat SMP Negeri 2 Girimulyo

Aplikasi ini dibangun sebagai aplikasi full-stack Node.js (Express + React/Vite + SQLite bawaan Node 22).

---

## 1. Daftar Environment Variable

Atur variabel berikut di panel konfigurasi layanan hosting Anda (jangan pernah menyalin `.env` ke Git):

| Variabel | Wajib | Nilai Default | Keterangan |
| :--- | :---: | :--- | :--- |
| `PORT` | Ya | `3000` | Port HTTP yang didengarkan oleh server Express (`0.0.0.0`). |
| `NODE_ENV` | Ya | `production` | Mengaktifkan penyajian bundel statis hasil `npm run build` di folder `dist/`. |
| `APP_URL` | Disarankan | `http://localhost:3000` | URL publik aplikasi (contoh: `https://surat.smpn2girimulyo.sch.id`). |
| `DB_PATH` | Ya (Prod) | `./data/persuratan.db` | Path absolut ke volume disk persisten untuk menyimpan database SQLite. |
| `UPLOAD_DIR` | Ya (Prod) | `./data/uploads` | Path absolut di volume disk persisten untuk berkas lampiran PDF/gambar. |
| `LOG_DIR` | Disarankan | `./data/logs` | Direktori tempat menyimpan `error.log`. |
| `ALERT_WEBHOOK_URL` | Opsional | *(kosong)* | URL webhook Slack / Discord / Telegram relay untuk menerima notifikasi otomatis jika terjadi error server (`500`). |
| `GEMINI_API_KEY` | Opsional | *(kosong)* | Tidak diperlukan saat ini; hanya dicadangkan bila fitur AI ditambahkan nanti. |

---

## 2. Langkah Deploy ke Layanan Hosting (Railway / Render / VPS)

### Opsi A: Railway atau Render (Paling Praktis dengan Persistent Disk)

1. **Siapkan Repositori**: Pastikan kode sudah di-push ke GitHub/GitLab tanpa folder `data/` dan tanpa file `.env`.
2. **Pasang Persistent Volume (PENTING)**:
   - Di dashboard layanan (Railway Volume atau Render Disk), buat volume persisten dengan mount path `/app/data`.
   - Langkah ini wajib agar database SQLite (`persuratan.db`) dan berkas lampiran (`uploads/`) tidak hilang saat container di-restart atau di-deploy ulang.
3. **Atur Build & Start Command**:
   - **Runtime**: Node.js `22.x`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start` (menjalankan `node server.ts`)
4. **Isi Environment Variables**:
   ```env
   NODE_ENV=production
   PORT=3000
   DB_PATH=/app/data/persuratan.db
   UPLOAD_DIR=/app/data/uploads
   LOG_DIR=/app/data/logs
   APP_URL=https://domain-aplikasi-anda.up.railway.app
   ```
5. **Verifikasi Pasca-Deploy**:
   Buka `https://domain-aplikasi-anda/api/health` dan pastikan respons JSON menunjukkan `"ok": true` serta `"database": "sqlite-connected"`.

---

### Opsi B: Server Sekolah / VPS Ubuntu (PM2 + Nginx)

1. **Instalasi Node.js 22 LTS**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v   # Pastikan v22.x
   ```
2. **Kloning & Build Aplikasi**:
   ```bash
   git clone <url-repo> /var/www/esurat-smpn2gr
   cd /var/www/esurat-smpn2gr
   npm install
   npm run build
   ```
3. **Buat file `.env` produksi**:
   ```bash
   cp .env.example .env
   nano .env
   # Ubah NODE_ENV=production, APP_URL, DB_PATH, UPLOAD_DIR, LOG_DIR
   ```
4. **Jalankan dengan PM2 agar otomatis hidup saat server restart**:
   ```bash
   sudo npm install -g pm2
   pm2 start server.ts --name esurat-smpn2gr --interpreter node
   pm2 save
   pm2 startup
   ```
5. **Reverse Proxy Nginx + HTTPS (Certbot)**:
   Arahkan domain `surat.smpn2girimulyo.sch.id` ke `http://127.0.0.1:3000` via Nginx, lalu aktifkan SSL gratis menggunakan `sudo certbot --nginx`.

---

## 3. Strategi Pencadangan (Backup) Rutin

Karena seluruh data tersimpan di SQLite (`persuratan.db`) dan folder `uploads/`, buat cron harian di server untuk mencadangkan keduanya:
```bash
# Contoh cron harian pukul 23:00 WIB
0 23 * * * sqlite3 /app/data/persuratan.db ".backup '/app/backups/persuratan-$(date +\%F).db'"
```
