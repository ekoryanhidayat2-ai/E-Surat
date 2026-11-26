import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ConflictError,
  NotFoundError,
  PersuratanDatabase,
  ValidationError,
  formatOutgoingLetterNumber,
} from '../server/db.ts';
import { AppLogger } from '../server/logger.ts';
import { createApiApp } from '../server/app.ts';
import {
  detectFullMonthYm,
  filterLettersByDateRange,
  getDefaultMonthDateRange,
  getMonthDateRangeFromYm,
  getPreviousMonthDateRange,
  normalizeDateRange,
} from '../src/lib/reportUtils.ts';
import {
  INCOMING_TABLE_COLUMNS,
  OUTGOING_TABLE_COLUMNS,
  countVisibleColumns,
  getDefaultColumnVisibility,
  normalizeColumnVisibility,
} from '../src/lib/tableColumns.ts';
import {
  DEFAULT_MENU_CONFIGS,
  normalizeMenuConfigs,
  type IncomingLetter,
  type OutgoingLetter,
} from '../src/types.ts';
import {
  collectAvailableYears,
  evaluateFiscalYearReadiness,
  getDefaultDateForYear,
  isValidWorkYear,
  replaceDateYear,
  UPCOMING_YEAR_WARNING_DAYS,
} from '../src/lib/yearUtils.ts';
import { APP_THEMES, DEFAULT_THEME_ID, getThemeById } from '../src/lib/themes.ts';
import { buildZipArchive } from '../server/zip.ts';
import { sanitizePublicOrigin } from '../server/bloggerExport.ts';
import {
  SPREADSHEET_SECTION_DEFINITIONS,
  buildSpreadsheetWorksheets,
  extractSpreadsheetId,
} from '../src/lib/spreadsheetBuilder.ts';
import writeXlsxFile from 'write-excel-file/node';
import {
  SAMPLE_CLASSIFICATION_TEMPLATE_ROWS,
  parseClassificationRows,
  parseCsvRows,
  validateClassificationItemsSchema,
} from '../src/lib/classificationParser.ts';
import { APP_GUIDE_METADATA, buildLiveGuideSummary } from '../src/lib/appGuideContent.ts';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'esurat-test-'));
}

describe('PersuratanDatabase — Logika Inti, Autentikasi & Kasus Gagal', () => {
  let tempDir: string;
  let store: PersuratanDatabase;

  before(() => {
    tempDir = createTempDir();
    store = new PersuratanDatabase(path.join(tempDir, 'test.db'), false);
    store.updateSettings({
      schoolName: 'SMP Negeri 2 Girimulyo',
      schoolCode: 'SMPN2-GR',
      outgoingFormatPattern: '{kode}/{urut}/{sekolah}/{bulan}/{tahun}',
      logoUrl: '/uploads/logo_sekolah.png',
    });
    store.upsertClassification({
      code: '421.3',
      name: 'Pendidikan Menengah Pertama',
      description: 'Urusan SMP',
    });
  });

  after(() => {
    store.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('menghasilkan format nomor surat keluar standar dinas dengan bulan Romawi', () => {
    const formatted = formatOutgoingLetterNumber(
      '{kode}/{urut}/{sekolah}/{bulan}/{tahun}',
      '421.3',
      7,
      'SMPN2-GR',
      '2026-11-17'
    );
    assert.equal(formatted, '421.3/007/SMPN2-GR/XI/2026');
  });

  it('menyimpan logoUrl sekolah serta gambar kop surat di branding/pengaturan', () => {
    const branding = store.getPublicBranding();
    assert.equal(branding.logoUrl, '/uploads/logo_sekolah.png');
    assert.equal(branding.schoolName, 'SMP Negeri 2 Girimulyo');

    const updated = store.updateSettings({
      kopImageUrl: '/uploads/kop_sekolah_resmi.png',
      loginHeadline: 'E-Surat Resmi SMPN 2 Girimulyo',
      loginDescription: 'Layanan digital administrasi persuratan sekolah terintegrasi.',
      loginFormTitle: 'Login Staf & Pimpinan',
      loginFormSubtitle: 'Masukkan username dan kata sandi resmi Tata Usaha.',
      menuConfigs: {
        ...store.getSettings().menuConfigs,
        incoming: {
          label: 'Agenda Masuk',
          title: 'Daftar Surat Masuk Sekolah',
          description: 'Keterangan menu surat masuk yang telah diperbarui oleh admin.',
        },
      },
    });
    assert.equal(updated.kopImageUrl, '/uploads/kop_sekolah_resmi.png');
    assert.equal(updated.loginHeadline, 'E-Surat Resmi SMPN 2 Girimulyo');
    assert.equal(
      store.getPublicBranding().loginDescription,
      'Layanan digital administrasi persuratan sekolah terintegrasi.'
    );
    assert.equal(store.getPublicBranding().loginFormTitle, 'Login Staf & Pimpinan');
    assert.equal(
      store.getPublicBranding().loginFormSubtitle,
      'Masukkan username dan kata sandi resmi Tata Usaha.'
    );
    assert.equal(updated.menuConfigs.incoming.label, 'Agenda Masuk');
    assert.equal(
      store.getSettings().menuConfigs.incoming.description,
      'Keterangan menu surat masuk yang telah diperbarui oleh admin.'
    );
    assert.equal(store.getSettings().kopImageUrl, '/uploads/kop_sekolah_resmi.png');

    const resetKop = store.updateSettings({ kopImageUrl: '' });
    assert.equal(resetKop.kopImageUrl, '');
    assert.equal(store.getSettings().kopImageUrl, '');
  });

  it('mengautentikasi akun admin bawaan dan menolak kata sandi yang salah', () => {
    const ok = store.authenticateUser('admin', 'sperogir1234');
    assert.equal(ok.user.role, 'admin');
    assert.equal(ok.user.displayName, 'Eko Ryan Hidayat');
    assert.equal(ok.user.jabatan, 'Staf Tata Usaha');
    assert.ok(ok.token.length > 20);

    const sessionUser = store.getSessionUser(ok.token);
    assert.equal(sessionUser?.username, 'admin');

    assert.throws(() => {
      store.authenticateUser('admin', 'sandi_salah');
    }, ValidationError);
  });

  it('mencatat surat masuk dengan nomor agenda otomatis berurutan dan memperbarui status melalui disposisi', () => {
    const first = store.createIncomingLetter({
      letterNumber: '005/120/Disdikpora/2026',
      letterDate: '2026-11-10',
      receivedDate: '2026-11-11',
      sender: 'Disdikpora Kulon Progo',
      subject: 'Undangan Rapat Kepala Sekolah',
      classificationCode: '005',
      urgency: 'Segera',
      createdBy: 'Staf TU',
    });

    assert.equal(first.agendaNumber, 'AGD-2026-001');
    assert.equal(first.status, 'Menunggu Disposisi');

    const withDisp = store.addDisposition(first.id, {
      targetUnit: 'Wakil Kepala Sekolah Bidang Kurikulum',
      targetStaffName: 'Siti Aminah, S.Pd.',
      instruction: 'Hadiri rapat dan laporkan hasilnya.',
      deadlineDate: '2026-11-12',
      createdBy: 'Kepala Sekolah',
    });

    assert.equal(withDisp.status, 'Didisposisikan');
    assert.equal(withDisp.dispositions.length, 1);

    const dispId = withDisp.dispositions[0].id;
    const completed = store.updateDisposition(first.id, dispId, {
      status: 'Selesai',
      completionNote: 'Rapat telah dihadiri dan notulen tersimpan.',
    });

    assert.equal(completed.status, 'Selesai');
    assert.equal(completed.dispositions[0].status, 'Selesai');
  });

  it('menerbitkan nomor surat keluar otomatis secara atomik per tahun serta menyimpan hasil edit naskah', () => {
    const out1 = store.createOutgoingLetter({
      classificationCode: '421.3',
      letterDate: '2026-11-17',
      recipient: 'Orang Tua Siswa Kelas VIII',
      subject: 'Pemberitahuan Study Tour Edukatif',
      drafterName: 'Waka Kesiswaan',
      status: 'Draf',
      bodyText: 'Dengan hormat,\n\nKami sampaikan informasi kegiatan pembelajaran luar kelas.',
      createdBy: 'Staf TU',
    });

    const out2 = store.createOutgoingLetter({
      classificationCode: '421.3',
      letterDate: '2026-12-02',
      recipient: 'Kepala Disdikpora Kulon Progo',
      subject: 'Laporan Semester Ganjil',
      drafterName: 'Tata Usaha',
      status: 'Menunggu TTD',
      createdBy: 'Staf TU',
    });

    assert.equal(out1.fullLetterNumber, '421.3/001/SMPN2-GR/XI/2026');
    assert.match(out1.bodyText, /pembelajaran luar kelas/);
    assert.equal(out2.fullLetterNumber, '421.3/002/SMPN2-GR/XII/2026');

    const editedOut = store.updateOutgoingLetter(out1.id, {
      bodyText: 'Dengan hormat,\n\nIsi naskah surat telah diperbarui untuk dicetak.',
      status: 'Menunggu TTD',
    });
    assert.match(editedOut.bodyText, /diperbarui untuk dicetak/);
    assert.equal(editedOut.status, 'Menunggu TTD');
  });

  it('MENOLAK kasus gagal: nomor surat keluar manual yang duplikat (ConflictError)', () => {
    assert.throws(() => {
      store.createOutgoingLetter({
        classificationCode: '421.3',
        letterDate: '2026-11-18',
        recipient: 'Komite Sekolah',
        subject: 'Duplikasi Nomor',
        drafterName: 'Tata Usaha',
        isManualNumber: true,
        fullLetterNumber: '421.3/001/SMPN2-GR/XI/2026',
        createdBy: 'Staf TU',
      });
    }, ConflictError);
  });

  it('MENOLAK kasus gagal: tanggal tidak valid, perihal kosong, dan sifat tidak dikenal (ValidationError)', () => {
    assert.throws(() => {
      store.createIncomingLetter({
        letterNumber: '123/ABC',
        letterDate: '17-11-2026',
        receivedDate: '2026-11-17',
        sender: 'Instansi A',
        subject: 'Perihal',
        classificationCode: '005',
      });
    }, ValidationError);

    assert.throws(() => {
      store.createIncomingLetter({
        letterNumber: '123/ABC',
        letterDate: '2026-11-17',
        receivedDate: '2026-11-17',
        sender: 'Instansi A',
        subject: '   ',
        classificationCode: '005',
      });
    }, ValidationError);

    assert.throws(() => {
      store.createIncomingLetter({
        letterNumber: '123/ABC',
        letterDate: '2026-11-17',
        receivedDate: '2026-11-17',
        sender: 'Instansi A',
        subject: 'Uji sifat',
        classificationCode: '005',
        urgency: 'SuperKilat',
      });
    }, ValidationError);
  });

  it('MENOLAK kasus gagal: mengakses atau menghapus ID surat yang tidak ada (NotFoundError)', () => {
    assert.throws(() => {
      store.getIncomingLetter('in_tidak_ada');
    }, NotFoundError);

    assert.throws(() => {
      store.deleteOutgoingLetter('out_tidak_ada');
    }, NotFoundError);
  });

  it('memperbarui kata sandi pengguna, memvalidasi kata sandi lama, serta menolak sandi terlalu pendek', () => {
    const tempUser = store.createUser({
      username: 'guru_test',
      password: 'password123',
      displayName: 'Guru Uji',
      jabatan: 'Guru Mapel',
      role: 'staf',
    });

    const loginBefore = store.authenticateUser('guru_test', 'password123');
    assert.equal(store.getSessionUser(loginBefore.token)?.username, 'guru_test');

    // Gagal jika sandi baru < 6 karakter
    assert.throws(() => {
      store.updateUserPassword(tempUser.id, '123');
    }, ValidationError);

    // Berhasil memperbarui sandi oleh Admin & mencabut sesi lama
    store.updateUserPassword(tempUser.id, 'sandiBaru456', true);
    assert.equal(store.getSessionUser(loginBefore.token), null);

    // Sandi lama ditolak, sandi baru diterima
    assert.throws(() => {
      store.authenticateUser('guru_test', 'password123');
    }, ValidationError);
    const loginAfter = store.authenticateUser('guru_test', 'sandiBaru456');
    assert.equal(loginAfter.user.id, tempUser.id);

    // Ganti sandi sendiri gagal jika sandi saat ini salah
    assert.throws(() => {
      store.changeOwnPassword(tempUser.id, 'salahBanget', 'sandiPribadi789');
    }, ValidationError);

    // Ganti sandi sendiri berhasil jika sandi saat ini cocok
    store.changeOwnPassword(tempUser.id, 'sandiBaru456', 'sandiPribadi789');
    const loginOwn = store.authenticateUser('guru_test', 'sandiPribadi789');
    assert.equal(loginOwn.user.username, 'guru_test');

    // Hapus akun berhasil & menolak hapus diri sendiri atau admin terakhir
    assert.throws(() => {
      store.deleteUser('usr_admin_tu', 'usr_admin_tu');
    }, ValidationError);

    store.deleteUser(tempUser.id, 'usr_admin_tu');
    assert.throws(() => {
      store.authenticateUser('guru_test', 'sandiPribadi789');
    }, ValidationError);

    // Tidak bisa menghapus admin terakhir
    const tempAdminRequester = store.createUser({
      username: 'kepsek_checker',
      password: 'password123',
      displayName: 'Checker',
      jabatan: 'Pengawas',
      role: 'staf',
    });
    assert.throws(() => {
      store.deleteUser('usr_admin_tu', tempAdminRequester.id);
    }, ValidationError);
    store.deleteUser(tempAdminRequester.id, 'usr_admin_tu');
  });
});

describe('Express API, Autentikasi & Monitoring — Integrasi HTTP', () => {
  let tempDir: string;
  let store: PersuratanDatabase;
  let logger: AppLogger;
  let baseUrl: string;
  let server: ReturnType<ReturnType<typeof createApiApp>['listen']>;
  let adminToken = '';

  before(async () => {
    tempDir = createTempDir();
    store = new PersuratanDatabase(path.join(tempDir, 'api.db'), true);
    logger = new AppLogger(path.join(tempDir, 'logs'));
    logger.attachDatabase(store.db);

    const app = createApiApp({
      store,
      logger,
      uploadDir: path.join(tempDir, 'uploads'),
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/health dan /api/public/school-branding dapat diakses tanpa login', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; database: string };
    assert.equal(body.ok, true);
    assert.equal(body.database, 'sqlite-connected');

    const brandRes = await fetch(`${baseUrl}/api/public/school-branding`);
    assert.equal(brandRes.status, 200);
    const brandBody = (await brandRes.json()) as {
      schoolName: string;
      loginHeadline: string;
      loginFormTitle: string;
    };
    assert.equal(brandBody.schoolName, 'SMP Negeri 2 Girimulyo');
    assert.equal(brandBody.loginHeadline, 'Sistem Informasi Manajemen Persuratan Sekolah');
    assert.equal(brandBody.loginFormTitle, 'Masuk ke Portal E-Surat');
  });

  it('MENOLAK akses /api/bootstrap tanpa login (401) dan mengizinkan setelah login', async () => {
    const unauth = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(unauth.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'sperogir1234' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { token: string; user: { role: string } };
    assert.equal(loginData.user.role, 'admin');
    adminToken = loginData.token;

    const authed = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(authed.status, 200);
  });

  it('POST /api/uploads menolak format file berbahaya (.exe) dan mencatat log ke monitoring', async () => {
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'malware.exe',
        mimeType: 'application/x-msdownload',
        dataBase64: Buffer.from('test').toString('base64'),
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /Format berkas/);

    const logsRes = await fetch(`${baseUrl}/api/monitoring/errors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(logsRes.status, 200);
    const logsBody = (await logsRes.json()) as { errors: Array<{ route: string }> };
    assert.ok(logsBody.errors.some((e) => e.route === '/api/uploads'));
  });

  it('DELETE /api/incoming/:id mengembalikan 404 jika surat tidak ditemukan', async () => {
    const res = await fetch(`${baseUrl}/api/incoming/tidak-ada-123`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 404);
  });

  it('mengelola pembaruan kata sandi dan penghapusan akun pengguna melalui API', async () => {
    // 1. Admin membuat akun staf sementara
    const createRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: 'staf_baru_uji',
        password: 'awalPassword1',
        displayName: 'Staf Baru Uji',
        jabatan: 'Staf Perpustakaan',
        role: 'staf',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdUser = (await createRes.json()) as { id: string; username: string };

    // 2. Admin memperbarui kata sandi staf tersebut
    const patchPassRes = await fetch(`${baseUrl}/api/users/${createdUser.id}/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ newPassword: 'resetPassword2' }),
    });
    assert.equal(patchPassRes.status, 204);

    // 3. Staf login menggunakan kata sandi baru dari admin
    const staffLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staf_baru_uji', password: 'resetPassword2' }),
    });
    assert.equal(staffLoginRes.status, 200);
    const staffAuth = (await staffLoginRes.json()) as { token: string };

    // 4. Staf gagal ubah sandi sendiri jika sandi saat ini salah (400)
    const badOwnPassRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffAuth.token}`,
      },
      body: JSON.stringify({ currentPassword: 'salah', newPassword: 'sandiSendiri3' }),
    });
    assert.equal(badOwnPassRes.status, 400);

    // 5. Staf berhasil ubah sandi sendiri (204)
    const goodOwnPassRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffAuth.token}`,
      },
      body: JSON.stringify({
        currentPassword: 'resetPassword2',
        newPassword: 'sandiSendiri3',
      }),
    });
    assert.equal(goodOwnPassRes.status, 204);

    // 6. Admin ditolak jika mencoba menghapus dirinya sendiri (400)
    const selfDeleteRes = await fetch(`${baseUrl}/api/users/usr_admin_tu`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(selfDeleteRes.status, 400);

    // 7. Admin berhasil menghapus akun staf uji (204) dan login staf ditolak
    const deleteRes = await fetch(`${baseUrl}/api/users/${createdUser.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteRes.status, 204);

    const afterDeleteLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staf_baru_uji', password: 'sandiSendiri3' }),
    });
    assert.equal(afterDeleteLogin.status, 401);
  });

  it('mencatat log aktivitas pengguna saat membuat, mengedit, dan menghapus surat melalui API', async () => {
    // 1. Buat surat masuk
    const createInRes = await fetch(`${baseUrl}/api/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        letterNumber: '005/999/Test/2026',
        letterDate: '2026-11-16',
        receivedDate: '2026-11-17',
        sender: 'Dinas Arsip Daerah',
        subject: 'Surat Uji Pelacakan Aktivitas',
        classificationCode: '005',
        urgency: 'Biasa',
      }),
    });
    assert.equal(createInRes.status, 201);
    const createdIn = (await createInRes.json()) as { id: string; agendaNumber: string };

    // 2. Edit surat masuk
    const patchInRes = await fetch(`${baseUrl}/api/incoming/${createdIn.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ subject: 'Surat Uji Pelacakan Aktivitas (Diedit)' }),
    });
    assert.equal(patchInRes.status, 200);

    // 3. Hapus surat masuk
    const delInRes = await fetch(`${baseUrl}/api/incoming/${createdIn.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delInRes.status, 204);

    // 4. Verifikasi ketiga aktivitas tercatat berurutan terbaru di atas
    const actRes = await fetch(`${baseUrl}/api/monitoring/activity?limit=20`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(actRes.status, 200);
    const actBody = (await actRes.json()) as {
      activities: Array<{
        actorUsername: string;
        action: string;
        entityType: string;
        entityId: string;
        referenceNumber: string;
        subject: string;
      }>;
    };

    const related = actBody.activities.filter((a) => a.entityId === createdIn.id);
    assert.equal(related.length, 3);
    assert.equal(related[0].action, 'DELETE');
    assert.equal(related[0].actorUsername, 'admin');
    assert.equal(related[0].referenceNumber, createdIn.agendaNumber);
    assert.equal(related[1].action, 'UPDATE');
    assert.equal(related[1].subject, 'Surat Uji Pelacakan Aktivitas (Diedit)');
    assert.equal(related[2].action, 'CREATE');
  });

  it('MEMBATASI akses pengaturan profil, klasifikasi, nomor urut, akun pengguna, log aktivitas, dan monitoring hanya untuk admin (403 untuk non-admin)', async () => {
    const kepsekLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kepsek', password: 'kepsek2026' }),
    });
    assert.equal(kepsekLogin.status, 200);
    const { token: kepsekToken } = (await kepsekLogin.json()) as { token: string };

    const stafLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staf_kurikulum', password: 'staf2026' }),
    });
    assert.equal(stafLogin.status, 200);
    const { token: stafToken } = (await stafLogin.json()) as { token: string };

    for (const token of [kepsekToken, stafToken]) {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      assert.equal(
        (await fetch(`${baseUrl}/api/settings`, { method: 'PUT', headers, body: JSON.stringify({ schoolName: 'Uji' }) })).status,
        403
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/classifications`, { method: 'POST', headers, body: JSON.stringify({ code: '999', name: 'Uji' }) })).status,
        403
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/classifications/005`, { method: 'DELETE', headers })).status,
        403
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/counters/2026`, { method: 'PUT', headers, body: JSON.stringify({ incomingLastSeq: 99, outgoingLastSeq: 99 }) })).status,
        403
      );
      assert.equal((await fetch(`${baseUrl}/api/users`, { headers })).status, 403);
      assert.equal(
        (await fetch(`${baseUrl}/api/users`, { method: 'POST', headers, body: JSON.stringify({ username: 'x', password: 'password1', displayName: 'X', jabatan: 'X', role: 'staf' }) })).status,
        403
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/users/usr_staf`, { method: 'PATCH', headers, body: JSON.stringify({ isActive: false }) })).status,
        403
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/users/usr_staf`, { method: 'DELETE', headers })).status,
        403
      );
      assert.equal((await fetch(`${baseUrl}/api/monitoring/activity`, { headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/monitoring/activity`, { method: 'DELETE', headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/monitoring/errors`, { headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/monitoring/errors`, { method: 'DELETE', headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/security/alerts`, { headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/monitoring/storage`, { headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/monitoring/checkpoint`, { method: 'POST', headers })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/monitoring/backup`, { headers })).status, 403);
    }

    // Admin tetap memiliki akses penuh (200)
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    assert.equal((await fetch(`${baseUrl}/api/users`, { headers: adminHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/monitoring/activity`, { headers: adminHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/monitoring/errors`, { headers: adminHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/security/alerts`, { headers: adminHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/monitoring/storage`, { headers: adminHeaders })).status, 200);
  });

  it('mencegah penimpaan data usang (409 Conflict) serta mendukung checkpoint WAL dan unduh cadangan JSON untuk Admin', async () => {
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 1. Buat surat masuk baru lalu uji pembaruan berturut-turut dengan expectedUpdatedAt
    const createRes = await fetch(`${baseUrl}/api/incoming`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        letterNumber: '421/OPT/2026',
        letterDate: '2026-11-18',
        receivedDate: '2026-11-18',
        sender: 'Dinas Pendidikan',
        subject: 'Uji Konsistensi Data Terakhir',
        classificationCode: '421.3',
        urgency: 'Biasa',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string; updatedAt: string };

    // Simpan perubahan pertama dengan updatedAt awal -> sukses (200)
    await new Promise((r) => setTimeout(r, 15));
    const firstUpdate = await fetch(`${baseUrl}/api/incoming/${created.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({
        subject: 'Uji Konsistensi Data Terakhir (Revisi 1)',
        expectedUpdatedAt: created.updatedAt,
      }),
    });
    assert.equal(firstUpdate.status, 200);

    // Percobaan simpan lagi memakai updatedAt lama yang sudah usang -> ditolak 409 Conflict
    const staleUpdate = await fetch(`${baseUrl}/api/incoming/${created.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({
        subject: 'Revisi Usang',
        expectedUpdatedAt: created.updatedAt,
      }),
    });
    assert.equal(staleUpdate.status, 409);

    // 2. Uji checkpoint WAL & status integritas database
    const cpRes = await fetch(`${baseUrl}/api/monitoring/checkpoint`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.equal(cpRes.status, 200);
    const cpBody = (await cpRes.json()) as {
      journalMode: string;
      synchronousMode: string;
      integrityStatus: string;
    };
    assert.equal(cpBody.journalMode, 'WAL');
    assert.equal(cpBody.synchronousMode, 'FULL');
    assert.equal(cpBody.integrityStatus.toLowerCase(), 'ok');

    // 3. Uji unduh cadangan JSON
    const backupRes = await fetch(`${baseUrl}/api/monitoring/backup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(backupRes.status, 200);
    const backupJson = (await backupRes.json()) as { data: { incoming: Array<{ id: string }> } };
    assert.ok(backupJson.data.incoming.some((i) => i.id === created.id));
  });

  it('mendeteksi dan memblokir upaya pembobolan (SQLi, token palsu, unggahan spoofed, brute-force) lalu mengirim notifikasi ke Admin', async () => {
    // 1. Upaya SQL Injection pada login
    const sqliRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: "admin' OR '1'='1", password: 'x' }),
    });
    assert.equal(sqliRes.status, 403);

    // 2. Upaya akses dengan token sesi palsu
    const forgedRes = await fetch(`${baseUrl}/api/incoming`, {
      headers: { Authorization: 'Bearer token_palsu_123456' },
    });
    assert.equal(forgedRes.status, 401);

    // 3. Upaya unggah berkas PNG palsu (header teks biasa diklaim image/png)
    const spoofedUploadRes = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'palsu.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('<?php system($_GET["cmd"]); ?>').toString('base64'),
      }),
    });
    assert.equal(spoofedUploadRes.status, 400);

    // 4. Upaya brute-force 5x gagal login pada akun target -> terkunci 429
    for (let i = 0; i < 4; i++) {
      const attempt = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'akun_sasaran_bf', password: `salah_${i}` }),
      });
      assert.equal(attempt.status, 401);
    }
    const lockedAttempt = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'akun_sasaran_bf', password: 'salah_5' }),
    });
    assert.equal(lockedAttempt.status, 429);

    // 5. Admin memeriksa daftar notifikasi keamanan & menandai semua dibaca
    const alertsRes = await fetch(`${baseUrl}/api/security/alerts?limit=50`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(alertsRes.status, 200);
    const alertsBody = (await alertsRes.json()) as {
      unreadCount: number;
      alerts: Array<{ category: string; isRead: boolean }>;
    };

    assert.ok(alertsBody.unreadCount >= 4);
    assert.ok(alertsBody.alerts.some((a) => a.category === 'INJECTION_ATTEMPT'));
    assert.ok(alertsBody.alerts.some((a) => a.category === 'AUTH_PROBE'));
    assert.ok(alertsBody.alerts.some((a) => a.category === 'MALICIOUS_UPLOAD'));
    assert.ok(alertsBody.alerts.some((a) => a.category === 'BRUTE_FORCE'));
    assert.ok(alertsBody.alerts.some((a) => a.category === 'PRIVILEGE_ESCALATION'));

    const readAllRes = await fetch(`${baseUrl}/api/security/alerts/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(readAllRes.status, 200);

    const afterReadRes = await fetch(`${baseUrl}/api/security/alerts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const afterReadBody = (await afterReadRes.json()) as { unreadCount: number };
    assert.equal(afterReadBody.unreadCount, 0);
  });

  it('memperbarui keterangan portal login oleh Admin dan menampilkannya langsung di endpoint publik tanpa login', async () => {
    const updateRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        loginHeadline: 'Portal Persuratan Digital SMPN 2 Girimulyo',
        loginDescription: 'Keterangan khusus portal login yang diperbarui oleh Admin TU.',
        loginFormTitle: 'Masuk Aplikasi Tata Usaha',
        loginFormSubtitle: 'Silakan masuk menggunakan akun resmi yang diberikan Admin.',
      }),
    });
    assert.equal(updateRes.status, 200);

    const publicRes = await fetch(`${baseUrl}/api/public/school-branding`);
    assert.equal(publicRes.status, 200);
    const publicBody = (await publicRes.json()) as {
      loginHeadline: string;
      loginDescription: string;
      loginFormTitle: string;
      loginFormSubtitle: string;
    };
    assert.equal(publicBody.loginHeadline, 'Portal Persuratan Digital SMPN 2 Girimulyo');
    assert.equal(
      publicBody.loginDescription,
      'Keterangan khusus portal login yang diperbarui oleh Admin TU.'
    );
    assert.equal(publicBody.loginFormTitle, 'Masuk Aplikasi Tata Usaha');
    assert.equal(
      publicBody.loginFormSubtitle,
      'Silakan masuk menggunakan akun resmi yang diberikan Admin.'
    );
  });

  it('menyimpan, memperbarui, membaca, dan menghapus referensi peraturan PDF serta membatasi unggahan hanya untuk Admin', async () => {
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 1. Upload berkas PDF sah dengan magic bytes %PDF-
    const samplePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        fileName: 'permendagri_1_2023.pdf',
        mimeType: 'application/pdf',
        dataBase64: samplePdf.toString('base64'),
      }),
    });
    assert.equal(uploadRes.status, 201);
    const uploaded = (await uploadRes.json()) as {
      attachmentUrl: string;
      attachmentName: string;
      sizeBytes: number;
    };
    assert.ok(uploaded.attachmentUrl.startsWith('/uploads/'));
    assert.ok(uploaded.attachmentUrl.endsWith('.pdf'));

    // 2. Tolak pembuatan peraturan jika berkas bukan PDF
    const invalidRegRes = await fetch(`${baseUrl}/api/regulations`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Peraturan Palsu',
        regulationNumber: 'No. 1/2023',
        year: 2023,
        category: 'Tata Naskah Dinas',
        fileUrl: '/uploads/gambar.png',
        fileName: 'gambar.png',
        fileSizeBytes: 100,
      }),
    });
    assert.equal(invalidRegRes.status, 400);

    // 3. Admin menyimpan referensi peraturan PDF
    const createRegRes = await fetch(`${baseUrl}/api/regulations`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Permendagri Nomor 1 Tahun 2023 tentang Tata Naskah Dinas di Lingkungan Pemda',
        regulationNumber: 'Permendagri No. 1 Tahun 2023',
        year: 2023,
        category: 'Tata Naskah Dinas',
        issuingBody: 'Kementerian Dalam Negeri RI',
        summary: 'Pedoman resmi format kop surat, penomoran, dan tata naskah dinas.',
        fileUrl: uploaded.attachmentUrl,
        fileName: uploaded.attachmentName,
        fileSizeBytes: uploaded.sizeBytes,
      }),
    });
    assert.equal(createRegRes.status, 201);
    const createdReg = (await createRegRes.json()) as {
      id: string;
      title: string;
      fileUrl: string;
      updatedAt: string;
    };
    assert.equal(createdReg.fileUrl, uploaded.attachmentUrl);

    // 4. Staf dapat membaca daftar peraturan (200) namun ditolak saat mencoba mengubah/menghapus (403)
    const stafLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staf_kurikulum', password: 'staf2026' }),
    });
    assert.equal(stafLogin.status, 200);
    const { token: stafToken } = (await stafLogin.json()) as { token: string };

    const stafListRes = await fetch(`${baseUrl}/api/regulations`, {
      headers: { Authorization: `Bearer ${stafToken}` },
    });
    assert.equal(stafListRes.status, 200);
    const stafListBody = (await stafListRes.json()) as { items: Array<{ id: string }> };
    assert.ok(stafListBody.items.some((r) => r.id === createdReg.id));

    const stafDeleteRes = await fetch(`${baseUrl}/api/regulations/${createdReg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${stafToken}` },
    });
    assert.equal(stafDeleteRes.status, 403);

    // 5. File PDF dapat diakses langsung dari /uploads
    const pdfFetchRes = await fetch(`${baseUrl}${createdReg.fileUrl}`);
    assert.equal(pdfFetchRes.status, 200);

    // 6. Admin memperbarui ringkasan lalu menghapus referensi peraturan
    const patchRegRes = await fetch(`${baseUrl}/api/regulations/${createdReg.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({
        summary: 'Ringkasan telah diperbarui untuk acuan Tata Usaha sekolah.',
        expectedUpdatedAt: createdReg.updatedAt,
      }),
    });
    assert.equal(patchRegRes.status, 200);

    const delRegRes = await fetch(`${baseUrl}/api/regulations/${createdReg.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    assert.equal(delRegRes.status, 204);
  });

  it('mempertahankan data terakhir saat restart/update tanpa menimpa atau seed ulang, serta mendukung snapshot & pemulihan (merge/replace)', async () => {
    // A. Uji persistensi disk nyata antar-restart / update aplikasi
    const restartDir = createTempDir();
    const restartDbPath = path.join(restartDir, 'persuratan.db');
    try {
      const storeV1 = new PersuratanDatabase(restartDbPath, true);
      // Hapus data contoh awal agar menguji skenario user menghapus demo data sebelum update
      storeV1.deleteIncomingLetter('in_seed_001');
      const savedIn = storeV1.createIncomingLetter({
        letterNumber: '800/099/DISDIK/2026',
        letterDate: '2026-11-18',
        receivedDate: '2026-11-18',
        sender: 'Dinas Pendidikan Kab. Kulon Progo',
        subject: 'Surat Sebelum Update Aplikasi',
        classificationCode: '421.3',
        urgency: 'Penting',
        createdBy: 'Admin TU',
      });
      const savedReg = storeV1.createRegulation({
        title: 'Pedoman Kearsipan Terbaru Sebelum Update',
        regulationNumber: 'Perka ANRI No. 5/2021',
        year: 2021,
        category: 'Kearsipan & Retensi',
        issuingBody: 'ANRI',
        summary: 'Data peraturan yang harus bertahan setelah update.',
        fileUrl: '/uploads/perka_anri_5_2021.pdf',
        fileName: 'perka_anri_5_2021.pdf',
        fileSizeBytes: 2048,
      });
      storeV1.db.close();

      // Simulasi aplikasi di-update / restart dan membuka kembali DB yang sama dengan autoSeed=true
      const storeV2 = new PersuratanDatabase(restartDbPath, true);
      try {
        const afterIncoming = storeV2.listIncomingLetters();
        const afterRegs = storeV2.listRegulations();

        assert.ok(afterIncoming.some((i) => i.id === savedIn.id && i.subject === 'Surat Sebelum Update Aplikasi'));
        assert.equal(
          afterIncoming.some((i) => i.id === 'in_seed_001'),
          false,
          'Data contoh yang sudah dihapus tidak boleh muncul ulang setelah update'
        );
        assert.ok(afterRegs.some((r) => r.id === savedReg.id));

        const snapshotsOnRestart = storeV2.listSnapshots();
        assert.ok(snapshotsOnRestart.length >= 1);
        assert.ok(fs.existsSync(path.join(restartDir, 'backups', snapshotsOnRestart[0].fileName)));
      } finally {
        storeV2.db.close();
      }
    } finally {
      fs.rmSync(restartDir, { recursive: true, force: true });
    }

    // B. Uji endpoint HTTP snapshot & pemulihan (merge vs replace) serta kontrol akses Admin
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    const stafLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staf_kurikulum', password: 'staf2026' }),
    });
    assert.equal(stafLogin.status, 200);
    const { token: stafToken } = (await stafLogin.json()) as { token: string };

    const stafBackupForbidden = await fetch(`${baseUrl}/api/monitoring/backups`, {
      headers: { Authorization: `Bearer ${stafToken}` },
    });
    assert.equal(stafBackupForbidden.status, 403);

    // 1. Buat surat A lalu ambil snapshot manual
    const letterARes = await fetch(`${baseUrl}/api/incoming`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        letterNumber: '421.3/BACKUP-A/2026',
        letterDate: '2026-11-18',
        receivedDate: '2026-11-18',
        sender: 'SMPN 1 Girimulyo',
        subject: 'Surat Sebelum Snapshot',
        classificationCode: '421.3',
        urgency: 'Biasa',
        createdBy: 'Admin TU',
      }),
    });
    assert.equal(letterARes.status, 201);
    const letterA = (await letterARes.json()) as { id: string; subject: string };

    const snapRes = await fetch(`${baseUrl}/api/monitoring/backups`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(snapRes.status, 201);
    const snapBody = (await snapRes.json()) as {
      fileName: string;
      snapshots: Array<{ fileName: string }>;
      storage: { autoBackupCount: number };
    };
    assert.ok(snapBody.fileName.endsWith('.json'));
    assert.ok(snapBody.storage.autoBackupCount >= 1);

    // 2. Tambah surat B setelah snapshot dibuat
    const letterBRes = await fetch(`${baseUrl}/api/incoming`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        letterNumber: '421.3/BARU-B/2026',
        letterDate: '2026-11-19',
        receivedDate: '2026-11-19',
        sender: 'Kemenag Kulon Progo',
        subject: 'Surat Baru Setelah Snapshot',
        classificationCode: '421.3',
        urgency: 'Biasa',
        createdBy: 'Admin TU',
      }),
    });
    assert.equal(letterBRes.status, 201);
    const letterB = (await letterBRes.json()) as { id: string };

    // 3. Pemulihan mode MERGE harus tetap mempertahankan Surat B yang lebih baru
    const mergeRestoreRes = await fetch(`${baseUrl}/api/monitoring/restore`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        mode: 'merge',
        snapshotFileName: snapBody.fileName,
      }),
    });
    assert.equal(mergeRestoreRes.status, 200);
    const afterMergeBoot = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const afterMergeData = (await afterMergeBoot.json()) as {
      incoming: Array<{ id: string }>;
    };
    assert.ok(afterMergeData.incoming.some((i) => i.id === letterA.id));
    assert.ok(
      afterMergeData.incoming.some((i) => i.id === letterB.id),
      'Mode merge wajib mempertahankan data terbaru yang sudah diinput setelah snapshot'
    );

    // 4. Pemulihan mode REPLACE mengembalikan tepat ke isi snapshot (Surat B terhapus, Surat A tetap ada)
    const replaceRestoreRes = await fetch(`${baseUrl}/api/monitoring/restore`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        mode: 'replace',
        snapshotFileName: snapBody.fileName,
      }),
    });
    assert.equal(replaceRestoreRes.status, 200);
    const afterReplaceBoot = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const afterReplaceData = (await afterReplaceBoot.json()) as {
      incoming: Array<{ id: string }>;
    };
    assert.ok(afterReplaceData.incoming.some((i) => i.id === letterA.id));
    assert.equal(afterReplaceData.incoming.some((i) => i.id === letterB.id), false);
  });

  it('mengunggah gambar kop sekolah utuh, menyimpannya di pengaturan admin, dan dapat direset ke kop standar', async () => {
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 1x1 PNG valid (minimal PNG header + IHDR + IDAT + IEND)
    const tinyPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        fileName: 'kop_smpn2_girimulyo.png',
        mimeType: 'image/png',
        dataBase64: tinyPngBase64,
      }),
    });
    assert.equal(uploadRes.status, 201);
    const uploaded = (await uploadRes.json()) as { attachmentUrl: string };
    assert.ok(uploaded.attachmentUrl.startsWith('/uploads/'));

    const saveRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ kopImageUrl: uploaded.attachmentUrl }),
    });
    assert.equal(saveRes.status, 200);
    const savedSettings = (await saveRes.json()) as { kopImageUrl: string };
    assert.equal(savedSettings.kopImageUrl, uploaded.attachmentUrl);

    const bootRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(bootRes.status, 200);
    const bootData = (await bootRes.json()) as { settings: { kopImageUrl: string } };
    assert.equal(bootData.settings.kopImageUrl, uploaded.attachmentUrl);

    // Non-admin tetap ditolak (403)
    const stafLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staf_kurikulum', password: 'staf2026' }),
    });
    const { token: stafToken } = (await stafLogin.json()) as { token: string };
    const stafPutRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stafToken}`,
      },
      body: JSON.stringify({ kopImageUrl: '' }),
    });
    assert.equal(stafPutRes.status, 403);

    // Reset kembali ke kop teks standar
    const resetRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ kopImageUrl: '' }),
    });
    assert.equal(resetRes.status, 200);
    const resetSettings = (await resetRes.json()) as { kopImageUrl: string };
    assert.equal(resetSettings.kopImageUrl, '');
  });

  it('menyimpan otomatis berkas unggahan (PDF/gambar), draf formulir, dan tema tampilan ke database SQLite serta memulihkannya saat file disk hilang', async () => {
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 1. Unggah berkas PDF valid -> tersimpan langsung di SQLite uploaded_files
    const samplePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'ascii');
    const uploadPdfRes = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        fileName: 'sk_pembagian_tugas.pdf',
        mimeType: 'application/pdf',
        dataBase64: `data:application/pdf;base64,${samplePdfBytes.toString('base64')}`,
      }),
    });
    assert.equal(uploadPdfRes.status, 201);
    const uploadedPdf = (await uploadPdfRes.json()) as {
      attachmentUrl: string;
      attachmentName: string;
      sizeBytes: number;
    };
    const fileKey = path.basename(uploadedPdf.attachmentUrl);
    const inDb = store.getUploadedFile(fileKey);
    assert.ok(inDb, 'Berkas PDF wajib tersimpan di tabel uploaded_files SQLite');
    assert.equal(inDb.sizeBytes, samplePdfBytes.byteLength);

    // 2. Hapus berkas fisik dari folder uploads/ -> GET /uploads/:fileKey tetap sukses dari SQLite dan memulihkan cache disk
    const diskPath = path.join(tempDir, 'uploads', fileKey);
    assert.ok(fs.existsSync(diskPath));
    fs.unlinkSync(diskPath);
    assert.equal(fs.existsSync(diskPath), false);

    const fetchFromDbFallback = await fetch(`${baseUrl}${uploadedPdf.attachmentUrl}`);
    assert.equal(fetchFromDbFallback.status, 200);
    const servedBuf = Buffer.from(await fetchFromDbFallback.arrayBuffer());
    assert.deepEqual(servedBuf, samplePdfBytes);
    assert.ok(fs.existsSync(diskPath), 'Cache disk uploads/ wajib ikut terpulihkan dari SQLite');

    // 3. Verifikasi metrik storageStatus menampilkan jumlah berkas tersimpan di DB
    const storage = store.getStorageStatus();
    assert.ok(storage.uploadedFileCount >= 1);
    assert.ok(storage.uploadedFilesBytes >= samplePdfBytes.byteLength);

    // 4. Draf formulir surat tersimpan otomatis di SQLite per pengguna
    const draftRes = await fetch(`${baseUrl}/api/drafts/esurat_draft_incoming_v1`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        payload: {
          sender: 'Balai Dikmen Kulon Progo',
          subject: 'Undangan Sosialisasi Kurikulum',
          attachmentUrl: uploadedPdf.attachmentUrl,
        },
      }),
    });
    assert.equal(draftRes.status, 200);

    const getDraftRes = await fetch(`${baseUrl}/api/drafts/esurat_draft_incoming_v1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getDraftRes.status, 200);
    const draftData = (await getDraftRes.json()) as {
      draft: { draftKey: string; payload: { sender: string; attachmentUrl: string } } | null;
    };
    assert.equal(draftData.draft?.payload.sender, 'Balai Dikmen Kulon Progo');
    assert.equal(draftData.draft?.payload.attachmentUrl, uploadedPdf.attachmentUrl);

    const delDraftRes = await fetch(`${baseUrl}/api/drafts/esurat_draft_incoming_v1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delDraftRes.status, 204);

    // 5. Pilihan tema aplikasi ikut tersimpan permanen di database
    const themePutRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ themeId: 'zamrud-pendidik' }),
    });
    assert.equal(themePutRes.status, 200);
    const updatedSettings = (await themePutRes.json()) as { themeId: string };
    assert.equal(updatedSettings.themeId, 'zamrud-pendidik');

    const bootAfterTheme = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const bootJson = (await bootAfterTheme.json()) as { settings: { themeId: string } };
    assert.equal(bootJson.settings.themeId, 'zamrud-pendidik');
  });

  it('memvalidasi otorisasi, peran, dan input pada endpoint AI (/api/ai/*) tanpa respons palsu', async () => {
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 1. Menolak akses tanpa login (401)
    const unauthAi = await fetch(`${baseUrl}/api/ai/archive-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Ringkas surat masuk' }),
    });
    assert.equal(unauthAi.status, 401);

    // 2. Validasi input kosong pada endpoint AI (400)
    const emptyQuery = await fetch(`${baseUrl}/api/ai/archive-assistant`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ question: '   ' }),
    });
    assert.equal(emptyQuery.status, 400);

    const emptyIncomingAi = await fetch(`${baseUrl}/api/ai/analyze-incoming`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(emptyIncomingAi.status, 400);

    const emptyDraftAi = await fetch(`${baseUrl}/api/ai/draft-outgoing`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(emptyDraftAi.status, 400);

    const missingLetterAi = await fetch(`${baseUrl}/api/ai/summarize-letter`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ kind: 'incoming', letterId: 'tidak-ada-999' }),
    });
    assert.equal(missingLetterAi.status, 404);

    // 3. Jika GEMINI_API_KEY belum tersedia di lingkungan uji, server wajib mengembalikan 503 (tanpa data palsu)
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const noKeyRes = await fetch(`${baseUrl}/api/ai/archive-assistant`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ question: 'Surat apa yang belum didisposisikan?' }),
      });
      assert.equal(noKeyRes.status, 503);
      const errBody = (await noKeyRes.json()) as { error: string };
      assert.match(errBody.error, /GEMINI_API_KEY|Settings > Secrets/i);
    } finally {
      if (prevKey !== undefined) {
        process.env.GEMINI_API_KEY = prevKey;
      }
    }
  });
});

describe('Laporan Bulanan Surat Masuk & Keluar — Utilitas Rentang Tanggal', () => {
  it('menghitung rentang tanggal bulan kabisat, non-kabisat, bulan ini, dan bulan lalu secara akurat', () => {
    const febLeap = getMonthDateRangeFromYm('2024-02');
    assert.deepEqual(febLeap, {
      startDate: '2024-02-01',
      endDate: '2024-02-29',
      yearMonth: '2024-02',
    });

    const febNormal = getMonthDateRangeFromYm('2026-02');
    assert.deepEqual(febNormal, {
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      yearMonth: '2026-02',
    });

    assert.equal(getMonthDateRangeFromYm('invalid'), null);
    assert.equal(detectFullMonthYm('2026-02-01', '2026-02-28'), '2026-02');
    assert.equal(detectFullMonthYm('2026-02-05', '2026-02-28'), '');

    const janRef = new Date(2026, 0, 15); // Jan 2026
    assert.equal(getDefaultMonthDateRange(janRef).yearMonth, '2026-01');
    assert.deepEqual(getPreviousMonthDateRange(janRef), {
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      yearMonth: '2025-12',
    });
  });

  it('menormalisasi rentang tanggal terbalik serta menyaring surat masuk & keluar secara inklusif', () => {
    const norm = normalizeDateRange('2026-11-20', '2026-11-01');
    assert.deepEqual(norm, {
      startDate: '2026-11-01',
      endDate: '2026-11-20',
      isSwapped: true,
      isValid: true,
    });

    const sampleIncoming: IncomingLetter[] = [
      {
        id: 'in1',
        agendaNumber: 'AGD-2026-001',
        sequenceNumber: 1,
        agendaYear: 2026,
        letterNumber: '001/A',
        letterDate: '2026-10-30',
        receivedDate: '2026-11-01',
        sender: 'Dinas A',
        subject: 'Awal Rentang',
        classificationCode: '005',
        urgency: 'Biasa',
        status: 'Selesai',
        attachmentUrl: '',
        attachmentName: '',
        notes: '',
        dispositions: [
          {
            id: 'd1',
            incomingLetterId: 'in1',
            targetUnit: 'Tata Usaha',
            targetStaffName: 'Staf',
            instruction: 'Arsip',
            deadlineDate: '2026-11-05',
            status: 'Selesai',
            completionNote: '',
            createdBy: 'Kepsek',
            createdAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-01T00:00:00Z',
          },
        ],
        createdBy: 'Admin',
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'in2',
        agendaNumber: 'AGD-2026-002',
        sequenceNumber: 2,
        agendaYear: 2026,
        letterNumber: '002/B',
        letterDate: '2026-11-14',
        receivedDate: '2026-11-15',
        sender: 'Dinas B',
        subject: 'Akhir Rentang',
        classificationCode: '421.3',
        urgency: 'Penting',
        status: 'Menunggu Disposisi',
        attachmentUrl: '',
        attachmentName: '',
        notes: '',
        dispositions: [],
        createdBy: 'Admin',
        createdAt: '2026-11-15T00:00:00Z',
        updatedAt: '2026-11-15T00:00:00Z',
      },
      {
        id: 'in3',
        agendaNumber: 'AGD-2026-003',
        sequenceNumber: 3,
        agendaYear: 2026,
        letterNumber: '003/C',
        letterDate: '2026-11-16',
        receivedDate: '2026-11-16',
        sender: 'Dinas C',
        subject: 'Di Luar Rentang',
        classificationCode: '421.3',
        urgency: 'Biasa',
        status: 'Menunggu Disposisi',
        attachmentUrl: '',
        attachmentName: '',
        notes: '',
        dispositions: [],
        createdBy: 'Admin',
        createdAt: '2026-11-16T00:00:00Z',
        updatedAt: '2026-11-16T00:00:00Z',
      },
    ];

    const sampleOutgoing: OutgoingLetter[] = [
      {
        id: 'out1',
        sequenceNumber: 2,
        letterYear: 2026,
        classificationCode: '421.3',
        fullLetterNumber: '421.3/002/SMPN2-GR/XI/2026',
        letterDate: '2026-11-10',
        recipient: 'Orang Tua',
        subject: 'Dalam Rentang',
        drafterName: 'TU',
        status: 'Terkirim',
        attachmentUrl: '',
        attachmentName: '',
        bodyText: '',
        notes: '',
        isManualNumber: false,
        createdBy: 'Admin',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      {
        id: 'out2',
        sequenceNumber: 3,
        letterYear: 2026,
        classificationCode: '421.3',
        fullLetterNumber: '421.3/003/SMPN2-GR/XI/2026',
        letterDate: '2026-11-28',
        recipient: 'Komite',
        subject: 'Di Luar Rentang',
        drafterName: 'TU',
        status: 'Draf',
        attachmentUrl: '',
        attachmentName: '',
        bodyText: '',
        notes: '',
        isManualNumber: false,
        createdBy: 'Admin',
        createdAt: '2026-11-28T00:00:00Z',
        updatedAt: '2026-11-28T00:00:00Z',
      },
    ];

    const res = filterLettersByDateRange(
      sampleIncoming,
      sampleOutgoing,
      '2026-11-15',
      '2026-11-01'
    );
    assert.equal(res.startDate, '2026-11-01');
    assert.equal(res.endDate, '2026-11-15');
    assert.deepEqual(
      res.incoming.map((l) => l.id),
      ['in1', 'in2']
    );
    assert.deepEqual(
      res.outgoing.map((l) => l.id),
      ['out1']
    );
    assert.equal(res.summary.incomingTotal, 2);
    assert.equal(res.summary.incomingCompleted, 1);
    assert.equal(res.summary.incomingPending, 1);
    assert.equal(res.summary.dispositionTotal, 1);
    assert.equal(res.summary.outgoingTotal, 1);
    assert.equal(res.summary.outgoingSent, 1);

    const emptyRes = filterLettersByDateRange(
      sampleIncoming,
      sampleOutgoing,
      '2025-01-01',
      '2025-01-31'
    );
    assert.equal(emptyRes.summary.incomingTotal, 0);
    assert.equal(emptyRes.summary.outgoingTotal, 0);
  });
});

describe('Pengaturan Kolom Tabel Surat (Mobile & Desktop)', () => {
  it('menyediakan preset ringkas mobile dan tampilan lengkap desktop untuk tabel surat masuk & keluar', () => {
    const incomingMobile = getDefaultColumnVisibility(INCOMING_TABLE_COLUMNS, 'mobile');
    assert.equal(incomingMobile.agendaNumber, true);
    assert.equal(incomingMobile.senderSubject, true);
    assert.equal(incomingMobile.status, true);
    assert.equal(incomingMobile.actions, true);
    assert.equal(incomingMobile.receivedDate, false);
    assert.equal(incomingMobile.originLetter, false);
    assert.equal(incomingMobile.urgency, false);
    assert.equal(incomingMobile.dispositions, false);
    assert.equal(countVisibleColumns(INCOMING_TABLE_COLUMNS, incomingMobile), 4);

    const incomingDesktop = getDefaultColumnVisibility(INCOMING_TABLE_COLUMNS, 'desktop');
    assert.equal(
      countVisibleColumns(INCOMING_TABLE_COLUMNS, incomingDesktop),
      INCOMING_TABLE_COLUMNS.length
    );

    const outgoingMobile = getDefaultColumnVisibility(OUTGOING_TABLE_COLUMNS, 'mobile');
    assert.equal(outgoingMobile.fullLetterNumber, true);
    assert.equal(outgoingMobile.recipientSubject, true);
    assert.equal(outgoingMobile.status, true);
    assert.equal(outgoingMobile.actions, true);
    assert.equal(outgoingMobile.sequenceNumber, false);
    assert.equal(outgoingMobile.letterDate, false);
    assert.equal(outgoingMobile.drafterName, false);
    assert.equal(countVisibleColumns(OUTGOING_TABLE_COLUMNS, outgoingMobile), 4);
  });

  it('mempertahankan kolom utama terkunci tetap tampil meski ada upaya menonaktifkannya', () => {
    const normalizedIn = normalizeColumnVisibility(
      INCOMING_TABLE_COLUMNS,
      { senderSubject: false, receivedDate: true, status: false },
      'mobile'
    );
    assert.equal(normalizedIn.senderSubject, true);
    assert.equal(normalizedIn.receivedDate, true);
    assert.equal(normalizedIn.status, false);

    const normalizedOut = normalizeColumnVisibility(
      OUTGOING_TABLE_COLUMNS,
      { recipientSubject: false, drafterName: true },
      'mobile'
    );
    assert.equal(normalizedOut.recipientSubject, true);
    assert.equal(normalizedOut.drafterName, true);
  });
});

describe('Normalisasi Konfigurasi Menu Aplikasi', () => {
  it('mengisi kunci menu yang hilang atau kosong dengan nilai default agar UI tidak crash', () => {
    const empty = normalizeMenuConfigs(undefined);
    assert.deepEqual(empty, DEFAULT_MENU_CONFIGS);

    const partial = normalizeMenuConfigs({
      dashboard: { label: 'Beranda Sekolah', title: 'Ringkasan', description: '' },
      incoming: { label: '   ', title: '', description: 'Keterangan khusus' },
    });
    assert.equal(partial.dashboard.label, 'Beranda Sekolah');
    assert.equal(partial.dashboard.title, 'Ringkasan');
    assert.equal(partial.dashboard.description, '');
    assert.equal(partial.incoming.label, DEFAULT_MENU_CONFIGS.incoming.label);
    assert.equal(partial.incoming.title, DEFAULT_MENU_CONFIGS.incoming.title);
    assert.equal(partial.incoming.description, 'Keterangan khusus');
    assert.deepEqual(partial.outgoing, DEFAULT_MENU_CONFIGS.outgoing);
    assert.deepEqual(partial.dispositions, DEFAULT_MENU_CONFIGS.dispositions);
    assert.deepEqual(partial.regulations, DEFAULT_MENU_CONFIGS.regulations);
    assert.deepEqual(partial.guide, DEFAULT_MENU_CONFIGS.guide);
    assert.deepEqual(partial.settings, DEFAULT_MENU_CONFIGS.settings);
  });
});

describe('Direktori Guru & Karyawan Penerima Disposisi — CRUD, RBAC & Backup', () => {
  let tempDir: string;
  let store: PersuratanDatabase;
  let logger: AppLogger;
  let baseUrl: string;
  let server: ReturnType<ReturnType<typeof createApiApp>['listen']>;
  let adminToken = '';
  let kepsekToken = '';
  let stafToken = '';

  before(async () => {
    tempDir = createTempDir();
    store = new PersuratanDatabase(path.join(tempDir, 'recipients.db'), true);
    logger = new AppLogger(path.join(tempDir, 'logs'));
    logger.attachDatabase(store.db);

    const app = createApiApp({
      store,
      logger,
      uploadDir: path.join(tempDir, 'uploads'),
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    const login = async (username: string, password: string) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(res.status, 200);
      return ((await res.json()) as { token: string }).token;
    };

    adminToken = await login('admin', 'sperogir1234');
    kepsekToken = await login('kepsek', 'kepsek2026');
    stafToken = await login('staf_kurikulum', 'staf2026');
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('menyediakan data awal Guru & Karyawan di /api/bootstrap serta mendukung tambah, ubah, filter aktif, dan hapus sesuai hak akses', async () => {
    const bootRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(bootRes.status, 200);
    const boot = (await bootRes.json()) as {
      dispositionRecipients: Array<{ id: string; name: string; category: string }>;
    };
    assert.ok(Array.isArray(boot.dispositionRecipients));
    assert.ok(boot.dispositionRecipients.length >= 4);

    // Staf tidak boleh menambah guru/karyawan baru (403)
    const stafCreateRes = await fetch(`${baseUrl}/api/disposition-recipients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stafToken}`,
      },
      body: JSON.stringify({
        name: 'Tidak Diizinkan',
        category: 'Guru',
      }),
    });
    assert.equal(stafCreateRes.status, 403);

    // Kepala sekolah dapat menambah Guru baru inline saat disposisi (201)
    const kepsekCreateRes = await fetch(`${baseUrl}/api/disposition-recipients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${kepsekToken}`,
      },
      body: JSON.stringify({
        name: 'Siti Nurjanah, S.Pd.',
        category: 'Guru',
        nip: '19840112 201101 2 009',
        unit: 'Koordinator Bimbingan Konseling (BK)',
      }),
    });
    assert.equal(kepsekCreateRes.status, 201);
    const createdGuru = (await kepsekCreateRes.json()) as {
      id: string;
      name: string;
      category: string;
      isActive: boolean;
    };
    assert.equal(createdGuru.name, 'Siti Nurjanah, S.Pd.');
    assert.equal(createdGuru.category, 'Guru');
    assert.equal(createdGuru.isActive, true);

    // Penolakan nama duplikat case-insensitive (409)
    const dupRes = await fetch(`${baseUrl}/api/disposition-recipients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'siti nurjanah, s.pd.',
        category: 'Guru',
      }),
    });
    assert.equal(dupRes.status, 409);

    // Admin menambah Karyawan baru & menonaktifkan sementara
    const adminCreateRes = await fetch(`${baseUrl}/api/disposition-recipients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Budi Santoso',
        category: 'Karyawan',
        unit: 'Bagian Tata Usaha',
      }),
    });
    assert.equal(adminCreateRes.status, 201);
    const createdStaff = (await adminCreateRes.json()) as { id: string; name: string };

    const deactivateRes = await fetch(`${baseUrl}/api/disposition-recipients/${createdStaff.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactivateRes.status, 200);

    const activeListRes = await fetch(`${baseUrl}/api/disposition-recipients?activeOnly=1`, {
      headers: { Authorization: `Bearer ${stafToken}` },
    });
    assert.equal(activeListRes.status, 200);
    const activeList = (await activeListRes.json()) as { items: Array<{ id: string }> };
    assert.ok(activeList.items.some((r) => r.id === createdGuru.id));
    assert.ok(!activeList.items.some((r) => r.id === createdStaff.id));

    // Kepala sekolah tidak diizinkan menghapus permanen (403); Admin diizinkan (204)
    const kepsekDelRes = await fetch(`${baseUrl}/api/disposition-recipients/${createdStaff.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${kepsekToken}` },
    });
    assert.equal(kepsekDelRes.status, 403);

    const adminDelRes = await fetch(`${baseUrl}/api/disposition-recipients/${createdStaff.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminDelRes.status, 204);
  });

  it('menyertakan direktori Guru & Karyawan dalam ekspor cadangan dan pemulihan JSON', () => {
    const added = store.createDispositionRecipient({
      name: 'Dewi Lestari, S.Pd.',
      category: 'Guru',
      unit: 'Kepala Perpustakaan',
      nip: '19880710 201502 2 001',
    });

    const backup = store.exportFullBackup();
    store.deleteDispositionRecipient(added.id);
    assert.ok(!store.listDispositionRecipients().some((r) => r.id === added.id));

    const restoreResult = store.restoreFromBackup(backup, 'replace');
    assert.ok((restoreResult.restoredRecipients ?? 0) >= 1);
    const restored = store.listDispositionRecipients().find((r) => r.id === added.id);
    assert.ok(restored);
    assert.equal(restored.name, 'Dewi Lestari, S.Pd.');
    assert.equal(restored.category, 'Guru');
  });

  it('helper yearUtils menangani pemilihan tahun, daftar tahun tersedia, dan tanggal aman kabisat', () => {
    assert.equal(isValidWorkYear(2025), true);
    assert.equal(isValidWorkYear(1999), false);
    assert.equal(isValidWorkYear(2101), false);

    // 29 Feb 2024 pindah ke 2025 (bukan kabisat) aman menjadi 2025-02-28
    assert.equal(replaceDateYear('2024-02-29', 2025), '2025-02-28');
    assert.equal(replaceDateYear('2025-05-12', 2027), '2027-05-12');
    assert.equal(getDefaultDateForYear(2025, new Date(2024, 1, 29)), '2025-02-28');

    const years = collectAvailableYears({
      baseYear: 2026,
      counters: [{ year: 2024, incomingLastSeq: 3, outgoingLastSeq: 5 }],
      customYears: [2029],
      activeYear: 2023,
    });
    assert.deepEqual(years, [2029, 2027, 2026, 2025, 2024, 2023]);
  });

  it('mengelola penghitung nomor urut lintas tahun dan menerbitkan surat sesuai tahun yang dipilih', async () => {
    // Atur penghitung tahun 2024 (melanjutkan buku agenda lama) dan tolak tahun invalid
    const invalidYearRes = await fetch(`${baseUrl}/api/counters/1995`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ incomingLastSeq: 10, outgoingLastSeq: 20 }),
    });
    assert.equal(invalidYearRes.status, 400);

    const set2024Res = await fetch(`${baseUrl}/api/counters/2024`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ incomingLastSeq: 14, outgoingLastSeq: 29 }),
    });
    assert.equal(set2024Res.status, 200);
    const updated2024 = (await set2024Res.json()) as {
      year: number;
      incomingLastSeq: number;
      outgoingLastSeq: number;
    };
    assert.equal(updated2024.year, 2024);
    assert.equal(updated2024.incomingLastSeq, 14);
    assert.equal(updated2024.outgoingLastSeq, 29);

    // Catat surat masuk pada tahun 2024 -> harus menjadi AGD-2024-015 tanpa mengganggu counter 2026
    const in2024Res = await fetch(`${baseUrl}/api/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        letterNumber: '421.3/099/Disdikpora/2024',
        letterDate: '2024-08-10',
        receivedDate: '2024-08-12',
        sender: 'Dinas Pendidikan Kulon Progo',
        subject: 'Arsip Tahun 2024',
        classificationCode: '421.3',
        urgency: 'Biasa',
        status: 'Selesai',
      }),
    });
    assert.equal(in2024Res.status, 201);
    const createdIn2024 = (await in2024Res.json()) as IncomingLetter;
    assert.equal(createdIn2024.agendaYear, 2024);
    assert.equal(createdIn2024.agendaNumber, 'AGD-2024-015');

    // Catat surat keluar pada tahun 2024 -> harus menggunakan urut 030 dan tahun 2024
    const out2024Res = await fetch(`${baseUrl}/api/outgoing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        classificationCode: '421.3',
        letterDate: '2024-09-05',
        recipient: 'Orang Tua / Wali Murid',
        subject: 'Edaran Kegiatan Tahun 2024',
        drafterName: 'Bagian Tata Usaha',
        status: 'Diarsipkan',
        isManualNumber: false,
      }),
    });
    assert.equal(out2024Res.status, 201);
    const createdOut2024 = (await out2024Res.json()) as OutgoingLetter;
    assert.equal(createdOut2024.letterYear, 2024);
    assert.equal(createdOut2024.sequenceNumber, 30);
    assert.ok(createdOut2024.fullLetterNumber.includes('/030/'));
    assert.ok(createdOut2024.fullLetterNumber.endsWith('/2024'));
  });

  it('mengevaluasi kesiapan tahun anggaran baru (notifikasi mendekat & status siap)', () => {
    // Pertengahan tahun (> 45 hari menuju 1 Jan 2027): belum perlu peringatan
    const midYear = evaluateFiscalYearReadiness(
      [{ year: 2026, incomingLastSeq: 12, outgoingLastSeq: 8 }],
      new Date(2026, 5, 15)
    );
    assert.equal(midYear.shouldNotify, false);
    assert.equal(midYear.reason, 'ready');
    assert.ok(midYear.daysUntilNewYear > UPCOMING_YEAR_WARNING_DAYS);

    // Mendekati tahun baru (23 Nov 2026 -> 39 hari menuju 1 Jan 2027) tanpa counter 2027 -> muncul notifikasi
    const approaching = evaluateFiscalYearReadiness(
      [{ year: 2026, incomingLastSeq: 12, outgoingLastSeq: 8 }],
      new Date(2026, 10, 23)
    );
    assert.equal(approaching.shouldNotify, true);
    assert.equal(approaching.reason, 'upcoming_uninitialized');
    assert.equal(approaching.targetYear, 2027);
    assert.equal(approaching.daysUntilNewYear, 39);

    // Setelah counter 2027 diinisialisasi -> notifikasi selesai / siap
    const prepared = evaluateFiscalYearReadiness(
      [
        { year: 2027, incomingLastSeq: 0, outgoingLastSeq: 0 },
        { year: 2026, incomingLastSeq: 12, outgoingLastSeq: 8 },
      ],
      new Date(2026, 10, 23)
    );
    assert.equal(prepared.shouldNotify, false);
    assert.equal(prepared.reason, 'ready');
    assert.equal(prepared.hasNextYearCounter, true);

    // Memasuki 1 Jan 2027 tanpa counter 2027 -> peringatan tahun berjalan belum diinisialisasi
    const uninitCurrent = evaluateFiscalYearReadiness(
      [{ year: 2026, incomingLastSeq: 12, outgoingLastSeq: 8 }],
      new Date(2027, 0, 1)
    );
    assert.equal(uninitCurrent.shouldNotify, true);
    assert.equal(uninitCurrent.reason, 'current_uninitialized');
    assert.equal(uninitCurrent.targetYear, 2027);
  });

  it('menginisialisasi penghitung tahun baru secara otomatis, idempoten, aman RBAC, dan menyimpan opsi auto-rollover', async () => {
    // Non-admin ditolak (403) dan tahun di luar rentang ditolak (400)
    const kepsekInitRes = await fetch(`${baseUrl}/api/counters/2027/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kepsekToken}` },
    });
    assert.equal(kepsekInitRes.status, 403);

    const invalidInitRes = await fetch(`${baseUrl}/api/counters/1995/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(invalidInitRes.status, 400);

    // Admin inisialisasi tahun 2027 -> 201 mulai 0/0 (nomor berikutnya #001)
    const init2027Res = await fetch(`${baseUrl}/api/counters/2027/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(init2027Res.status, 201);
    const init2027 = (await init2027Res.json()) as {
      counter: { year: number; incomingLastSeq: number; outgoingLastSeq: number };
      alreadyInitialized: boolean;
    };
    assert.equal(init2027.alreadyInitialized, false);
    assert.deepEqual(init2027.counter, {
      year: 2027,
      incomingLastSeq: 0,
      outgoingLastSeq: 0,
    });

    // Pastikan surat pertama di tahun 2027 mendapat nomor urut #001
    const first2027InRes = await fetch(`${baseUrl}/api/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        letterNumber: '421.3/001/Disdikpora/2027',
        letterDate: '2027-01-04',
        receivedDate: '2027-01-04',
        sender: 'Dinas Pendidikan Kulon Progo',
        subject: 'Surat Awal Tahun Anggaran 2027',
        classificationCode: '421.3',
        urgency: 'Biasa',
        status: 'Menunggu Disposisi',
      }),
    });
    assert.equal(first2027InRes.status, 201);
    const first2027In = (await first2027InRes.json()) as IncomingLetter;
    assert.equal(first2027In.agendaNumber, 'AGD-2027-001');

    // Inisialisasi ulang tidak boleh menimpa penghitung 2027 yang sudah berjalan (idempoten 200)
    const reinit2027Res = await fetch(`${baseUrl}/api/counters/2027/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(reinit2027Res.status, 200);
    const reinit2027 = (await reinit2027Res.json()) as {
      counter: { year: number; incomingLastSeq: number; outgoingLastSeq: number };
      alreadyInitialized: boolean;
    };
    assert.equal(reinit2027.alreadyInitialized, true);
    assert.equal(reinit2027.counter.incomingLastSeq, 1);

    // Pengaturan opsi autoInitNewYearCounter tersimpan permanen
    const disableAutoRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ autoInitNewYearCounter: false }),
    });
    assert.equal(disableAutoRes.status, 200);
    const disabledSettings = (await disableAutoRes.json()) as {
      autoInitNewYearCounter: boolean;
    };
    assert.equal(disabledSettings.autoInitNewYearCounter, false);
    assert.equal(store.getSettings().autoInitNewYearCounter, false);

    // Kembalikan ke true
    const enableAutoRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ autoInitNewYearCounter: true }),
    });
    assert.equal(enableAutoRes.status, 200);
    assert.equal(store.getSettings().autoInitNewYearCounter, true);
  });

  it('menyediakan koleksi tema Fresh & Elegan beserta palet warna valid dan fallback aman', () => {
    assert.equal(APP_THEMES.length, 16);
    const ids = new Set(APP_THEMES.map((t) => t.id));
    assert.equal(ids.size, APP_THEMES.length);

    const freshThemes = APP_THEMES.filter((t) => t.category === 'Fresh & Elegan');
    assert.ok(freshThemes.length >= 6);
    assert.ok(freshThemes.some((t) => t.mode === 'light'));
    assert.ok(freshThemes.some((t) => t.mode === 'dark'));

    for (const theme of APP_THEMES) {
      assert.ok(['light', 'dark'].includes(theme.mode));
      assert.equal(theme.swatches.length, 3);
      for (const hex of theme.swatches) {
        assert.match(hex, /^#[0-9A-Fa-f]{6}$/);
      }
    }

    assert.equal(getThemeById('tidak-ada').id, DEFAULT_THEME_ID);
    assert.equal(getThemeById('safir-porselen').category, 'Fresh & Elegan');
  });

  it('mengekspor paket Blogger (XML tema, HTML mandiri, iframe) & arsip ZIP kode sumber hanya untuk Admin', async () => {
    // 1. Uji helper ZIP & sanitasi URL origin
    const zipSample = buildZipArchive([
      { name: 'hello.txt', content: 'Halo SMPN 2 Girimulyo' },
      { name: 'nested/info.json', content: JSON.stringify({ ok: true }) },
    ]);
    assert.equal(zipSample.subarray(0, 4).toString('hex'), '504b0304');
    assert.ok(zipSample.includes(Buffer.from('hello.txt')));
    assert.equal(sanitizePublicOrigin('javascript:alert(1)', 'https://contoh.sch.id'), 'https://contoh.sch.id');
    assert.equal(sanitizePublicOrigin('https://esurat.smpn2girimulyo.sch.id/abc', 'https://fallback.id'), 'https://esurat.smpn2girimulyo.sch.id');

    // 2. Non-admin & tanpa login ditolak
    assert.equal((await fetch(`${baseUrl}/api/export/blogger/preview`)).status, 401);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/export/blogger/preview`, {
          headers: { Authorization: `Bearer ${kepsekToken}` },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/export/blogger/source-zip`, {
          headers: { Authorization: `Bearer ${kepsekToken}` },
        })
      ).status,
      403
    );

    // 3. Admin dapat meninjau paket Blogger lengkap
    const previewRes = await fetch(
      `${baseUrl}/api/export/blogger/preview?origin=${encodeURIComponent('https://esurat-sekolah.run.app')}`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(previewRes.status, 200);
    const previewBody = (await previewRes.json()) as {
      sourceFileCount: number;
      sourceFiles: Array<{ path: string; sizeBytes: number }>;
      xmlTheme: string;
      htmlBundle: string;
      iframeSnippet: string;
      bundleStats: { htmlBytes: number; xmlBytes: number; jsBytes: number };
    };

    assert.ok(previewBody.sourceFileCount >= 10);
    assert.ok(previewBody.sourceFiles.some((f) => f.path === 'src/App.tsx'));
    assert.ok(previewBody.sourceFiles.some((f) => f.path === 'server/app.ts'));
    assert.equal(previewBody.sourceFiles.some((f) => f.path === '.env'), false);

    assert.ok(previewBody.xmlTheme.startsWith('<?xml version="1.0"'));
    assert.ok(previewBody.xmlTheme.includes('<b:skin><![CDATA['));
    assert.ok(previewBody.xmlTheme.includes('<b:section id=\'main-esurat-blogger-host\''));
    assert.ok(previewBody.htmlBundle.includes('<!doctype html>'));
    assert.ok(previewBody.htmlBundle.includes('__ESURAT_BLOGGER_MODE__'));
    const seedMatch = previewBody.htmlBundle.match(/var INITIAL_SEED = (\{[\s\S]*?\});\n/);
    assert.ok(seedMatch?.[1], 'INITIAL_SEED harus ada di bundle HTML Blogger');
    assert.equal(seedMatch[1].includes('passwordHash'), false);
    assert.equal(seedMatch[1].includes('scrypt'), false);
    assert.ok(previewBody.iframeSnippet.includes('https://esurat-sekolah.run.app'));
    assert.ok(previewBody.bundleStats.jsBytes > 100_000);

    // 4. Admin dapat mengunduh arsip ZIP lengkap kode sumber + file Blogger
    const zipRes = await fetch(`${baseUrl}/api/export/blogger/source-zip`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(zipRes.status, 200);
    assert.ok((zipRes.headers.get('content-type') || '').includes('application/zip'));
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipBuf.subarray(0, 4).toString('hex'), '504b0304');
    assert.ok(zipBuf.includes(Buffer.from('blogger/esurat-blogger-theme.xml')));
    assert.ok(zipBuf.includes(Buffer.from('blogger/esurat-blogger-standalone.html')));
  });

  it('menyediakan endpoint data ekspor Google Spreadsheet khusus Admin & menyusun lembar kerja per tahun', async () => {
    // 1. Uji parser URL / ID Google Spreadsheet
    assert.equal(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
    );
    assert.equal(
      extractSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
    );
    assert.equal(extractSpreadsheetId('javascript:alert(1)'), null);
    assert.equal(extractSpreadsheetId('pendek'), null);

    // 2. Uji proteksi RBAC endpoint /api/export/spreadsheet-data
    assert.equal((await fetch(`${baseUrl}/api/export/spreadsheet-data`)).status, 401);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/export/spreadsheet-data`, {
          headers: { Authorization: `Bearer ${kepsekToken}` },
        })
      ).status,
      403
    );

    const exportRes = await fetch(`${baseUrl}/api/export/spreadsheet-data`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(exportRes.status, 200);
    const dataset = (await exportRes.json()) as Parameters<typeof buildSpreadsheetWorksheets>[0];
    assert.equal(JSON.stringify(dataset).includes('passwordHash'), false);

    // 3. Susun seluruh lembar kerja database
    const allKeys = SPREADSHEET_SECTION_DEFINITIONS.map((d) => d.key);
    const worksheetsAll = buildSpreadsheetWorksheets(dataset, {
      selectedKeys: allKeys,
      yearFilter: 'all',
    });
    assert.equal(worksheetsAll.length, SPREADSHEET_SECTION_DEFINITIONS.length);
    const incomingSheet = worksheetsAll.find((w) => w.key === 'incoming');
    assert.ok(incomingSheet && incomingSheet.rows.length >= 2);
    assert.equal(incomingSheet.rows[0]?.[1], 'Nomor Agenda');

    const emptyYearSheets = buildSpreadsheetWorksheets(dataset, {
      selectedKeys: ['incoming', 'outgoing'],
      yearFilter: 2099,
    });
    assert.equal(emptyYearSheets.length, 2);
    assert.equal(emptyYearSheets[0]?.dataRowCount, 0);
    assert.equal(emptyYearSheets[1]?.dataRowCount, 0);
  });

  it('mem-parsing baris Excel/CSV kode klasifikasi tata naskah dinas serta mendeteksi peringatan & duplikat', () => {
    assert.ok(SAMPLE_CLASSIFICATION_TEMPLATE_ROWS.length >= 9);

    const csvText = [
      'Kode Klasifikasi;Nama Klasifikasi;Keterangan',
      '421.3;Pendidikan Menengah Pertama;Urusan KBM SMP',
      ';Baris Tanpa Kode;Harus dilewati',
      'KODE_TERLALU_PANJANG_MELEBIHI_24_KARAKTER;Nama Uji;Ket',
      '421.3;Pendidikan SMP (Revisi);Keterangan terbaru menggantikan duplikat',
      '800;Kepegawaian;Surat tugas dan cuti pegawai',
    ].join('\n');

    const rows = parseCsvRows(csvText);
    const parsed = parseClassificationRows(rows);
    assert.equal(parsed.items.length, 2);
    assert.equal(parsed.duplicateOverrides, 1);
    assert.equal(parsed.warnings.length, 2);
    assert.equal(parsed.items[0]?.code, '421.3');
    assert.equal(parsed.items[0]?.name, 'Pendidikan SMP (Revisi)');
    assert.equal(parsed.items[1]?.code, '800');

    const emptyParsed = parseClassificationRows([]);
    assert.equal(emptyParsed.items.length, 0);
    assert.equal(emptyParsed.warnings.length, 1);
  });

  it('mengimpor kode klasifikasi secara atomik (merge & replace), menolak payload cacat, dan membatasi akses hanya untuk Admin', async () => {
    // 1. Proteksi RBAC
    assert.equal(
      (
        await fetch(`${baseUrl}/api/classifications/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'merge', items: SAMPLE_CLASSIFICATION_TEMPLATE_ROWS }),
        })
      ).status,
      401
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/classifications/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${kepsekToken}`,
          },
          body: JSON.stringify({ mode: 'merge', items: SAMPLE_CLASSIFICATION_TEMPLATE_ROWS }),
        })
      ).status,
      403
    );

    // 2. Uji rollback atomik: jika salah satu baris tidak valid, seluruh batch ditolak (400) dan kode uji tidak masuk
    const rollbackRes = await fetch(`${baseUrl}/api/classifications/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        mode: 'merge',
        items: [
          { code: '991.ROLLBACK', name: 'Harus Ter-rollback', description: 'Uji atomik' },
          { code: '992.INVALID', name: '', description: 'Nama kosong tidak sah' },
        ],
      }),
    });
    assert.equal(rollbackRes.status, 400);
    assert.equal(
      store.listClassifications().some((c) => c.code === '991.ROLLBACK'),
      false
    );

    // 3. Impor mode merge berhasil (200)
    const mergeRes = await fetch(`${baseUrl}/api/classifications/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        mode: 'merge',
        items: [
          { code: '421.3', name: 'Pendidikan SMP (Excel)', description: 'Diperbarui dari Excel' },
          { code: '700', name: 'Pengawasan & Evaluasi', description: 'Kode baru dari Excel' },
        ],
      }),
    });
    assert.equal(mergeRes.status, 200);
    const mergeBody = (await mergeRes.json()) as {
      inserted: number;
      updated: number;
      totalClassifications: number;
    };
    assert.ok(mergeBody.inserted >= 1);
    assert.ok(mergeBody.updated >= 1);
    assert.ok(store.listClassifications().some((c) => c.code === '700'));

    // 4. Impor mode replace mengganti daftar menjadi tepat item yang dikirim
    const replaceItems = [
      { code: '400.3', name: 'Pendidikan Dasar', description: 'Acuan Permendagri' },
      { code: '800', name: 'Kepegawaian', description: 'Data SDM' },
    ];
    const replaceRes = await fetch(`${baseUrl}/api/classifications/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ mode: 'replace', items: replaceItems }),
    });
    assert.equal(replaceRes.status, 200);
    const replaceBody = (await replaceRes.json()) as { totalClassifications: number };
    assert.equal(replaceBody.totalClassifications, 2);
    assert.equal(store.listClassifications().length, 2);
  });

  it('menyusun ringkasan panduan aplikasi dinamis yang otomatis sinkron dengan tema, klasifikasi, penerima, dan tahun aktif', () => {
    const summary = buildLiveGuideSummary({
      settings: store.getSettings(),
      classifications: [
        { code: '400.3', name: 'Pendidikan Dasar', description: '' },
        { code: '800', name: 'Kepegawaian', description: '' },
      ],
      dispositionRecipients: store.listDispositionRecipients(),
      counters: [
        { year: 2027, incomingLastSeq: 0, outgoingLastSeq: 0 },
        { year: 2026, incomingLastSeq: 12, outgoingLastSeq: 8 },
      ],
      activeYear: 2027,
      activeThemeId: 'safir-porselen',
    });

    assert.equal(summary.version, APP_GUIDE_METADATA.version);
    assert.equal(summary.totalThemes, 16);
    assert.ok(summary.activeThemeName.includes('Porselen & Safir Segar'));
    assert.equal(summary.classificationsCount, 2);
    assert.ok(summary.recipientsCount >= 1);
    assert.deepEqual(summary.counterYears, [2027, 2026]);
    assert.equal(summary.yearScopeLabel, 'Tahun 2027');
    assert.ok(summary.changelog.length >= 5);
  });

  it('menyaring noise WebSocket Vite HMR, mengizinkan stack client-error wajar & backup restore, serta memverifikasi shim Blogger', async () => {
    // 1. Client-error Vite HMR WebSocket diabaikan tanpa mencemari error_logs
    const ignoredRes = await fetch(`${baseUrl}/api/monitoring/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'WebSocket closed without opened.',
        route: '/',
        stack: 'Error: WebSocket closed without opened.\n at WebSocket.<anonymous> (https://example.com/@vite/client:234:30)',
      }),
    });
    assert.equal(ignoredRes.status, 200);
    const ignoredBody = (await ignoredRes.json()) as { logged: boolean; ignored?: boolean };
    assert.equal(ignoredBody.logged, false);
    assert.equal(ignoredBody.ignored, true);

    // 2. Stack trace JS asli dengan path relatif (../) dan kata onerror= tetap dicatat tanpa diblokir WAF (201)
    const validErrRes = await fetch(`${baseUrl}/api/monitoring/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'TypeError: Cannot read properties of undefined',
        route: '/surat-keluar',
        stack: 'TypeError: fail\n at Object.onerror=null (../src/components/LetterFormModal.tsx:120:5)',
      }),
    });
    assert.equal(validErrRes.status, 201);
    const validErrBody = (await validErrRes.json()) as { logged: boolean; id: string };
    assert.equal(validErrBody.logged, true);
    assert.ok(validErrBody.id);

    // 3. Pemulihan cadangan yang memuat URL/stack relatif pada backupPayload tidak memicu false positive WAF
    const backupRes = await fetch(`${baseUrl}/api/monitoring/backup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(backupRes.status, 200);
    const backupJson = (await backupRes.json()) as { data: Record<string, unknown> };
    const restoreRes = await fetch(`${baseUrl}/api/monitoring/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        mode: 'merge',
        backupPayload: {
          ...backupJson,
          errorLogs: [
            {
              id: 'err_test_path',
              level: 'error',
              route: '/app',
              method: 'CLIENT',
              message: 'Historical stack',
              stack: 'at ../components/Test.tsx:12',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      }),
    });
    assert.equal(restoreRes.status, 200);

    // 4. Pratinjau Blogger memiliki dukungan placeholder huruf kecil, RBAC, upload non-ganda, dan endpoint regulations/drafts
    const blogRes = await fetch(`${baseUrl}/api/export/blogger/preview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(blogRes.status, 200);
    const blogPkg = (await blogRes.json()) as { htmlBundle: string };
    assert.ok(blogPkg.htmlBundle.includes(".replaceAll('{kode}'"));
    assert.ok(blogPkg.htmlBundle.includes(".replaceAll('{urut}'"));
    assert.ok(blogPkg.htmlBundle.includes("rawB64.indexOf('data:') === 0"));
    assert.ok(blogPkg.htmlBundle.includes("pathname === '/api/regulations'"));
    assert.ok(blogPkg.htmlBundle.includes("pathname.indexOf('/api/drafts/') === 0"));
    assert.ok(blogPkg.htmlBundle.includes("if (user.role === 'staf')"));
  });

  it('memvalidasi skema ketat Excel (.xlsx) & mengimpor data klasifikasi surat secara massal via POST /api/classifications/import-xlsx', async () => {
    // 1. Validasi skema menolak header yang tidak cocok dan format kode tidak sah
    const wrongHeaderParsed = parseClassificationRows([
      ['NIP', 'Nama Guru', 'Unit'],
      ['19800101', 'Budi Santoso', 'Kurikulum'],
    ]);
    assert.equal(wrongHeaderParsed.schemaValid, false);
    assert.equal(wrongHeaderParsed.validation.headerMatched.code, false);
    assert.equal(wrongHeaderParsed.errors[0]?.code, 'MISSING_REQUIRED_COLUMNS');

    const badFormatParsed = parseClassificationRows([
      ['Kode', 'Nama Klasifikasi', 'Keterangan'],
      ['421 3', 'Ada Spasi', 'Tidak valid'],
      ['421.3', '=SUM(A1)', 'Formula injection'],
    ]);
    assert.equal(badFormatParsed.schemaValid, false);
    assert.equal(badFormatParsed.errors.length, 2);
    assert.equal(badFormatParsed.validation.invalidCount, 2);

    const invalidItemsCheck = validateClassificationItemsSchema(
      [{ code: '421.3', name: 'Valid', extraField: 'illegal' }],
      'merge'
    );
    assert.equal(invalidItemsCheck.valid, false);
    assert.equal(invalidItemsCheck.errors[0]?.code, 'UNEXPECTED_FIELDS');

    // 2. Bangun berkas .xlsx asli (valid dan invalid) menggunakan write-excel-file/node
    const validWorkbookBuffer = await writeXlsxFile(
      [
        [
          { value: 'Kode', type: String },
          { value: 'Nama Klasifikasi', type: String },
          { value: 'Keterangan', type: String },
        ],
        [
          { value: '421.3', type: String },
          { value: 'Pendidikan Menengah Pertama (XLSX)', type: String },
          { value: 'Diimpor dari berkas .xlsx resmi', type: String },
        ],
        [
          { value: '426.1', type: String },
          { value: 'Ekstrakurikuler & Pramuka', type: String },
          { value: 'Kegiatan pengembangan minat bakat siswa', type: String },
        ],
      ],
      { sheet: 'Klasifikasi' }
    ).toBuffer();

    const invalidSchemaWorkbookBuffer = await writeXlsxFile(
      [
        [
          { value: 'Kode', type: String },
          { value: 'Nama Klasifikasi', type: String },
          { value: 'Keterangan', type: String },
        ],
        [
          { value: 'KODE SPASI', type: String },
          { value: 'Harus Gagal Skema', type: String },
          { value: 'Mengandung spasi terlarang', type: String },
        ],
      ],
      { sheet: 'Klasifikasi' }
    ).toBuffer();

    // 3. RBAC: tanpa login (401) dan non-admin (403) ditolak
    assert.equal(
      (
        await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: 'klasifikasi.xlsx',
            dataBase64: validWorkbookBuffer.toString('base64'),
          }),
        })
      ).status,
      401
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${kepsekToken}`,
          },
          body: JSON.stringify({
            fileName: 'klasifikasi.xlsx',
            dataBase64: validWorkbookBuffer.toString('base64'),
          }),
        })
      ).status,
      403
    );

    // 4. Berkas .xlsx palsu (magic bytes bukan ZIP/OOXML) ditolak (400)
    const spoofedRes = await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'palsu.xlsx',
        dataBase64: Buffer.from('bukan-file-excel-ooxml').toString('base64'),
      }),
    });
    assert.equal(spoofedRes.status, 400);

    // 5. Dry-run berkas .xlsx invalid melaporkan valid: false, dan commit ditolak 400 tanpa mengubah DB
    const beforeCount = store.listClassifications().length;
    const invalidDryRunRes = await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'invalid-skema.xlsx',
        dataBase64: invalidSchemaWorkbookBuffer.toString('base64'),
        dryRun: true,
      }),
    });
    assert.equal(invalidDryRunRes.status, 200);
    const invalidDryRun = (await invalidDryRunRes.json()) as {
      valid: boolean;
      validation: { errors: Array<{ code: string }> };
    };
    assert.equal(invalidDryRun.valid, false);
    assert.equal(invalidDryRun.validation.errors[0]?.code, 'INVALID_CODE_FORMAT');

    const invalidCommitRes = await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'invalid-skema.xlsx',
        dataBase64: invalidSchemaWorkbookBuffer.toString('base64'),
        mode: 'merge',
        dryRun: false,
      }),
    });
    assert.equal(invalidCommitRes.status, 400);
    assert.equal(store.listClassifications().length, beforeCount);

    // 6. Dry-run berkas .xlsx valid lulus validasi skema, lalu commit menyimpan ke SQLite
    const validDryRunRes = await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'valid-skema.xlsx',
        dataBase64: validWorkbookBuffer.toString('base64'),
        dryRun: true,
      }),
    });
    assert.equal(validDryRunRes.status, 200);
    const validDryRun = (await validDryRunRes.json()) as {
      valid: boolean;
      items: Array<{ code: string }>;
      validation: { headerMatched: { code: boolean; name: boolean; description: boolean } };
    };
    assert.equal(validDryRun.valid, true);
    assert.equal(validDryRun.items.length, 2);
    assert.equal(validDryRun.validation.headerMatched.code, true);
    assert.equal(validDryRun.validation.headerMatched.name, true);
    assert.equal(validDryRun.validation.headerMatched.description, true);

    const validCommitRes = await fetch(`${baseUrl}/api/classifications/import-xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fileName: 'valid-skema.xlsx',
        dataBase64: validWorkbookBuffer.toString('base64'),
        mode: 'merge',
        dryRun: false,
      }),
    });
    assert.equal(validCommitRes.status, 200);
    const validCommit = (await validCommitRes.json()) as {
      totalProcessed: number;
      items: Array<{ code: string; name: string }>;
    };
    assert.equal(validCommit.totalProcessed, 2);
    assert.ok(store.listClassifications().some((c) => c.code === '426.1'));
    assert.equal(
      store.listClassifications().find((c) => c.code === '421.3')?.name,
      'Pendidikan Menengah Pertama (XLSX)'
    );
  });
});


