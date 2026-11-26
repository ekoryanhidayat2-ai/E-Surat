# Panduan Monitoring & Pencatatan Error — E-Surat SMP Negeri 2 Girimulyo

Aplikasi ini dilengkapi pencatatan error otomatis di sisi server beserta dukungan notifikasi webhook agar gangguan operasional Tata Usaha dapat segera diketahui dan ditangani.

---

## 1. Mekanisme Pencatat Error (`AppLogger`)

Setiap kesalahan (*warning* validasi 4xx maupun *error* tak terduga 500) dicatat melalui `server/logger.ts` ke tiga saluran secara bersamaan:

1. **File Log Terstruktur (`data/logs/error.log`)**:
   Ditulis dalam format **JSON Lines** (satu objek JSON per baris) sehingga mudah difilter dengan `jq` atau `grep`.
2. **Tabel Database SQLite (`error_logs`)**:
   Menyimpan `id`, `level`, `route`, `method`, `message`, `stack`, dan `created_at` agar mudah diaudit melalui API monitoring.
3. **Notifikasi Webhook Otomatis (`ALERT_WEBHOOK_URL`)**:
   Jika `ALERT_WEBHOOK_URL` diisi pada `.env` (misalnya Incoming Webhook Slack, Discord, atau bridge Telegram/WhatsApp), setiap error level `error` (status `500` atau kegagalan startup) langsung mengirimkan pesan peringatan ke kanal tim IT sekolah.

---

## 2. Cara Mengecek Kesehatan Aplikasi & Log Error

### A. Cek Status Kesehatan Server & Database
Panggil endpoint `/api/health` melalui browser atau terminal:
```bash
curl -s http://localhost:3000/api/health
```
Contoh respons normal:
```json
{
  "ok": true,
  "service": "e-surat-smpn2-girimulyo",
  "database": "sqlite-connected",
  "timestamp": "2026-11-18T03:45:00.000Z",
  "uptimeSeconds": 142
}
```
Jika database bermasalah, endpoint akan mengembalikan status HTTP `503` dan mencatat detail error ke log.

### B. Cek Riwayat Error Terbaru via Endpoint API
```bash
curl -s "http://localhost:3000/api/monitoring/errors?limit=20"
```
Menampilkan 20 catatan error/peringatan terakhir dari tabel `error_logs` SQLite lengkap dengan rute API dan waktu kejadian.

### C. Cek File Log Langsung di Server
Untuk memantau log secara *real-time* di VPS/server:
```bash
tail -f data/logs/error.log
```
Atau menyaring hanya error kritis (`level: "error"`):
```bash
grep '"level":"error"' data/logs/error.log
```

### D. Mengaktifkan Notifikasi Error ke Slack / Discord / Telegram
1. Buat URL Incoming Webhook di layanan pesan pilihan Anda.
2. Tambahkan URL tersebut ke environment variable server:
   ```env
   ALERT_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
   ```
3. Restart server (`npm start`). Setiap error internal akan langsung memicu notifikasi bertajuk `[E-Surat SMPN 2 Girimulyo] ERROR pada ...`.
