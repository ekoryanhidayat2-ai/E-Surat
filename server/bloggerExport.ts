import fs from 'node:fs';
import path from 'node:path';
import type { PersuratanDatabase } from './db.ts';
import { buildZipArchive, type ZipEntryInput } from './zip.ts';

export interface SourceFileSummary {
  path: string;
  sizeBytes: number;
}

export interface BloggerExportPackage {
  generatedAt: string;
  schoolName: string;
  appOrigin: string;
  sourceFileCount: number;
  sourceFiles: SourceFileSummary[];
  htmlBundle: string;
  xmlTheme: string;
  iframeSnippet: string;
  guideText: string;
  bundleStats: {
    jsBytes: number;
    cssBytes: number;
    htmlBytes: number;
    xmlBytes: number;
  };
}

const ALLOWED_ROOT_FILES = [
  'index.html',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'server.ts',
  '.env.example',
  'metadata.json',
  'firebase-applet-config.json',
];

const ALLOWED_SOURCE_DIRS = ['src', 'server', 'tests'];

const ALLOWED_SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.json',
  '.md',
  '.svg',
]);

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

function escapeXmlCdata(content: string): string {
  return content.replaceAll(']]>', ']]]]><![CDATA[>');
}

export function sanitizePublicOrigin(rawOrigin: string | undefined, fallbackOrigin: string): string {
  const candidate = String(rawOrigin || '').trim();
  if (!candidate) return fallbackOrigin;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallbackOrigin;
    }
    return parsed.origin;
  } catch {
    return fallbackOrigin;
  }
}

function collectSourceFiles(workspaceRoot: string): { entries: ZipEntryInput[]; summaries: SourceFileSummary[] } {
  const resolvedRoot = path.resolve(workspaceRoot);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  const entries: ZipEntryInput[] = [];
  const summaries: SourceFileSummary[] = [];

  const pushFile = (absPath: string, relPath: string) => {
    const normalizedAbs = path.resolve(absPath);
    if (!normalizedAbs.startsWith(rootPrefix)) return;
    if (!fs.existsSync(normalizedAbs)) return;
    const stat = fs.statSync(normalizedAbs);
    if (!stat.isFile()) return;
    const content = fs.readFileSync(normalizedAbs);
    entries.push({ name: relPath, content });
    summaries.push({ path: relPath, sizeBytes: content.length });
  };

  for (const fileName of ALLOWED_ROOT_FILES) {
    pushFile(path.join(resolvedRoot, fileName), fileName);
  }

  const walkDir = (dirAbs: string, dirRel: string) => {
    if (!fs.existsSync(dirAbs)) return;
    const items = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      if (
        item.name.startsWith('.') ||
        item.name === 'node_modules' ||
        item.name === 'dist' ||
        item.name === 'data' ||
        item.name === 'uploads'
      ) {
        continue;
      }
      const nextAbs = path.join(dirAbs, item.name);
      const nextRel = `${dirRel}/${item.name}`;
      if (item.isDirectory()) {
        walkDir(nextAbs, nextRel);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (ALLOWED_SOURCE_EXT.has(ext)) {
          pushFile(nextAbs, nextRel);
        }
      }
    }
  };

  for (const dirName of ALLOWED_SOURCE_DIRS) {
    walkDir(path.join(resolvedRoot, dirName), dirName);
  }

  return { entries, summaries };
}

async function loadCompiledClientAssets(workspaceRoot: string): Promise<{ css: string; js: string }> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const distAssetsDir = path.join(resolvedRoot, 'dist', 'assets');

  let css = '';
  if (fs.existsSync(distAssetsDir)) {
    const cssFiles = fs
      .readdirSync(distAssetsDir)
      .filter((name) => name.endsWith('.css'))
      .sort();
    for (const cssFile of cssFiles) {
      css += fs.readFileSync(path.join(distAssetsDir, cssFile), 'utf8') + '\n';
    }
  }

  if (!css.trim()) {
    const fallbackCssPath = path.join(resolvedRoot, 'src', 'index.css');
    if (fs.existsSync(fallbackCssPath)) {
      css = fs.readFileSync(fallbackCssPath, 'utf8');
    }
  }

  // Bundel satu file IIFE mandiri menggunakan esbuild agar semua modul (termasuk jsPDF) berjalan di Blogger tanpa request chunk eksternal
  let js = '';
  try {
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      entryPoints: [path.join(resolvedRoot, 'src', 'main.tsx')],
      bundle: true,
      write: false,
      format: 'iife',
      minify: true,
      target: ['es2020'],
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.env.MODE': '"production"',
      },
      plugins: [
        {
          name: 'ignore-css-imports',
          setup(build) {
            build.onResolve({ filter: /\.css$/ }, () => ({
              path: 'ignored-css',
              namespace: 'ignore-css',
            }));
            build.onLoad({ filter: /.*/, namespace: 'ignore-css' }, () => ({
              contents: '',
              loader: 'js',
            }));
          },
        },
      ],
    });
    js = result.outputFiles?.[0]?.text || '';
  } catch {
    if (fs.existsSync(distAssetsDir)) {
      const jsFile = fs
        .readdirSync(distAssetsDir)
        .find((name) => name.startsWith('index-') && name.endsWith('.js'));
      if (jsFile) {
        js = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');
      }
    }
  }

  return { css, js };
}

function buildBloggerRuntimeShimScript(store: PersuratanDatabase, defaultOrigin: string): string {
  const settings = store.getSettings();
  // Hanya mengekspor data non-rahasia (tanpa passwordHash, tanpa token sesi server, tanpa API key)
  const sanitizedSeed = {
    settings,
    classifications: store.listClassifications(),
    dispositionRecipients: store.listDispositionRecipients(),
    counters: store.listCounters(),
    incoming: store.listIncomingLetters(),
    outgoing: store.listOutgoingLetters(),
    regulations: store.listRegulations(),
  };

  const seedJson = JSON.stringify(sanitizedSeed)
    .replace(/<\/script/gi, '<\\/script')
    .replaceAll(']]>', ']]]]><![CDATA[>');

  return `(function(){
  if (typeof window === 'undefined') return;
  window.__ESURAT_BLOGGER_MODE__ = true;
  window.__ESURAT_API_BASE__ = window.__ESURAT_API_BASE__ || '';
  var STORAGE_DB_KEY = 'esurat_blogger_db_v1';
  var DRAFTS_KEY = 'esurat_blogger_drafts_v1';
  var SESSION_KEY = 'esurat_blogger_session_v1';
  var DEFAULT_SERVER_ORIGIN = ${JSON.stringify(defaultOrigin)};
  var INITIAL_SEED = ${seedJson};

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function normalizeDbShape(parsed) {
    var base = clone(INITIAL_SEED);
    if (!parsed || typeof parsed !== 'object') return base;
    if (!parsed.settings || typeof parsed.settings !== 'object') parsed.settings = base.settings;
    if (!Array.isArray(parsed.incoming)) parsed.incoming = base.incoming || [];
    if (!Array.isArray(parsed.outgoing)) parsed.outgoing = base.outgoing || [];
    if (!Array.isArray(parsed.classifications)) parsed.classifications = base.classifications || [];
    if (!Array.isArray(parsed.regulations)) parsed.regulations = base.regulations || [];
    if (!Array.isArray(parsed.dispositionRecipients)) parsed.dispositionRecipients = base.dispositionRecipients || [];
    if (!Array.isArray(parsed.counters)) parsed.counters = base.counters || [];
    return parsed;
  }

  function loadDb() {
    try {
      var raw = window.localStorage.getItem(STORAGE_DB_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.settings) return normalizeDbShape(parsed);
      }
    } catch (e) {}
    var fresh = normalizeDbShape(clone(INITIAL_SEED));
    saveDb(fresh);
    return fresh;
  }

  function saveDb(db) {
    try { window.localStorage.setItem(STORAGE_DB_KEY, JSON.stringify(db)); } catch (e) {}
  }

  function loadDrafts() {
    try {
      var raw = window.localStorage.getItem(DRAFTS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {};
  }

  function saveDrafts(map) {
    try { window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function jsonResponse(payload, status) {
    return new Response(status === 204 ? null : JSON.stringify(payload), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function nowIso() { return new Date().toISOString(); }
  function genId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }

  function nextCounter(db, year, type) {
    if (!Array.isArray(db.counters)) db.counters = [];
    var row = db.counters.find(function(c){ return Number(c.year) === Number(year); });
    if (!row) {
      row = { year: Number(year), incomingLastSeq: 0, outgoingLastSeq: 0 };
      db.counters.push(row);
    }
    if (type === 'incoming') {
      row.incomingLastSeq = Number(row.incomingLastSeq || 0) + 1;
      return row.incomingLastSeq;
    }
    row.outgoingLastSeq = Number(row.outgoingLastSeq || 0) + 1;
    return row.outgoingLastSeq;
  }

  function formatOutgoing(pattern, code, seq, schoolCode, dateStr) {
    var year = Number(String(dateStr || '').slice(0, 4)) || new Date().getFullYear();
    var month = Number(String(dateStr || '').slice(5, 7)) || (new Date().getMonth() + 1);
    var romans = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    var pad3 = String(Math.max(1, Number(seq) || 1)).padStart(3, '0');
    var romanMonth = romans[Math.max(0, Math.min(11, month - 1))];
    var clsCode = code || '421.3';
    var schCode = schoolCode || 'SMPN2-GR';
    return String(pattern || '{kode}/{urut}/{sekolah}/{bulan}/{tahun}')
      .replaceAll('{kode}', clsCode)
      .replaceAll('{urut}', pad3)
      .replaceAll('{sekolah}', schCode)
      .replaceAll('{bulan}', romanMonth)
      .replaceAll('{tahun}', String(year))
      .replaceAll('{KODE}', clsCode)
      .replaceAll('{NO_URUT}', pad3)
      .replaceAll('{KODE_SEKOLAH}', schCode)
      .replaceAll('{BULAN_ROMAWI}', romanMonth)
      .replaceAll('{TAHUN}', String(year));
  }

  function getCurrentUser() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY) || window.localStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function setCurrentUser(user) {
    try {
      if (!user) {
        window.sessionStorage.removeItem(SESSION_KEY);
        window.localStorage.removeItem(SESSION_KEY);
      } else {
        var json = JSON.stringify(user);
        window.sessionStorage.setItem(SESSION_KEY, json);
        window.localStorage.setItem(SESSION_KEY, json);
      }
    } catch (e) {}
  }

  var DEMO_USERS = {
    admin: { id: 'usr_blogger_admin', username: 'admin', displayName: 'Administrator TU (Blogger)', jabatan: 'Koordinator Tata Usaha', role: 'admin', isActive: true, createdAt: nowIso() },
    kepsek: { id: 'usr_blogger_kepsek', username: 'kepsek', displayName: 'Kepala Sekolah', jabatan: 'Kepala Sekolah', role: 'kepala_sekolah', isActive: true, createdAt: nowIso() },
    staf_kurikulum: { id: 'usr_blogger_staf', username: 'staf_kurikulum', displayName: 'Staf Kurikulum', jabatan: 'Wakil Kepala Sekolah Bidang Kurikulum', role: 'staf', isActive: true, createdAt: nowIso() }
  };

  var nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (window.__ESURAT_API_BASE__) {
      return nativeFetch(input, init);
    }
    var pathname = urlStr.split('?')[0];
    if (pathname.indexOf('/api/') !== 0) {
      return nativeFetch(input, init);
    }

    var method = (init && init.method ? String(init.method) : 'GET').toUpperCase();
    var body = {};
    if (init && typeof init.body === 'string' && init.body.trim()) {
      try { body = JSON.parse(init.body); } catch (e) { body = {}; }
    }
    var db = loadDb();
    var user = getCurrentUser();

    if (pathname === '/api/public/school-branding' && method === 'GET') {
      var s = db.settings;
      return jsonResponse({
        schoolName: s.schoolName,
        parentAgency: s.parentAgency,
        districtGov: s.districtGov,
        address: (s.address + ' ' + (s.postalCode || '')).trim(),
        logoUrl: s.logoUrl || '',
        loginHeadline: s.loginHeadline,
        loginDescription: s.loginDescription,
        loginFormTitle: s.loginFormTitle,
        loginFormSubtitle: s.loginFormSubtitle
      });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      var uname = String(body.username || '').trim().toLowerCase();
      var pass = String(body.password || '');
      var matched = DEMO_USERS[uname];
      var expected = uname === 'admin' ? ['sperogir1234', 'admin2026', 'blogger2026'] : uname === 'kepsek' ? ['kepsek2026'] : ['staf2026'];
      if (!matched || expected.indexOf(pass) === -1) {
        return jsonResponse({ error: 'Nama pengguna atau kata sandi Blogger mode lokal tidak cocok. Gunakan admin / sperogir1234 atau admin2026.' }, 401);
      }
      setCurrentUser(matched);
      return jsonResponse({ token: 'blogger_local_token_' + matched.role, user: matched });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      setCurrentUser(null);
      return jsonResponse({}, 204);
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!user) return jsonResponse({ error: 'Belum masuk sesi Blogger.' }, 401);
      return jsonResponse({ user: user });
    }

    if (!user) {
      return jsonResponse({ error: 'Sesi login diperlukan.' }, 401);
    }

    if (pathname === '/api/auth/change-password' && method === 'POST') {
      return jsonResponse({ error: 'Ubah kata sandi akun membutuhkan mode Server Live Node.js agar terenkripsi di database SQLite.' }, 400);
    }

    if (pathname === '/api/bootstrap' && method === 'GET') {
      return jsonResponse({
        incoming: db.incoming || [],
        outgoing: db.outgoing || [],
        classifications: db.classifications || [],
        regulations: db.regulations || [],
        dispositionRecipients: db.dispositionRecipients || [],
        settings: db.settings,
        counters: db.counters || []
      });
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengubah pengaturan.' }, 403);
      db.settings = Object.assign({}, db.settings, body);
      saveDb(db);
      return jsonResponse(db.settings);
    }

    if (pathname.indexOf('/api/drafts/') === 0) {
      var dKey = decodeURIComponent(pathname.slice('/api/drafts/'.length));
      var draftsMap = loadDrafts();
      var fullDraftKey = String(user.id || user.username || 'user') + ':' + dKey;
      if (method === 'GET') {
        return jsonResponse({ draft: draftsMap[fullDraftKey] || null });
      }
      if (method === 'PUT') {
        var draftRec = {
          userId: String(user.id || 'blogger'),
          draftKey: dKey,
          payload: body && body.payload !== undefined ? body.payload : body,
          updatedAt: nowIso()
        };
        draftsMap[fullDraftKey] = draftRec;
        saveDrafts(draftsMap);
        return jsonResponse({ draft: draftRec });
      }
      if (method === 'DELETE') {
        delete draftsMap[fullDraftKey];
        saveDrafts(draftsMap);
        return jsonResponse({}, 204);
      }
    }

    if (pathname === '/api/incoming' && method === 'GET') {
      return jsonResponse({ items: db.incoming || [] });
    }

    if (pathname === '/api/incoming' && method === 'POST') {
      if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf hanya dapat membaca dan memperbarui progres disposisi.' }, 403);
      var yrIn = Number(String(body.receivedDate || '').slice(0, 4)) || new Date().getFullYear();
      var seqIn = nextCounter(db, yrIn, 'incoming');
      var itemIn = Object.assign({
        id: genId('in'),
        agendaYear: yrIn,
        agendaNumber: 'AGD-' + yrIn + '-' + String(seqIn).padStart(3, '0'),
        dispositions: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      }, body);
      db.incoming.unshift(itemIn);
      saveDb(db);
      return jsonResponse(itemIn, 201);
    }

    if (pathname.indexOf('/api/incoming/') === 0) {
      var partsIn = pathname.slice('/api/incoming/'.length).split('/');
      var inId = decodeURIComponent(partsIn[0] || '');
      var idxIn = db.incoming.findIndex(function(l){ return l.id === inId; });
      if (idxIn === -1) return jsonResponse({ error: 'Surat masuk tidak ditemukan.' }, 404);

      if (partsIn.length === 1 && method === 'PATCH') {
        if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf tidak memiliki izin mengubah data surat masuk.' }, 403);
        db.incoming[idxIn] = Object.assign({}, db.incoming[idxIn], body, { updatedAt: nowIso() });
        saveDb(db);
        return jsonResponse(db.incoming[idxIn]);
      }
      if (partsIn.length === 1 && method === 'DELETE') {
        if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat menghapus surat masuk.' }, 403);
        db.incoming.splice(idxIn, 1);
        saveDb(db);
        return jsonResponse({}, 204);
      }
      if (partsIn[1] === 'dispositions' && partsIn.length === 2 && method === 'POST') {
        if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf tidak memiliki izin membuat disposisi baru.' }, 403);
        var disp = Object.assign({
          id: genId('dsp'),
          status: 'Belum Ditindaklanjuti',
          completionNote: '',
          createdAt: nowIso(),
          updatedAt: nowIso()
        }, body);
        db.incoming[idxIn].dispositions = db.incoming[idxIn].dispositions || [];
        db.incoming[idxIn].dispositions.unshift(disp);
        db.incoming[idxIn].status = 'Didisposisikan';
        saveDb(db);
        return jsonResponse(db.incoming[idxIn], 201);
      }
      if (partsIn[1] === 'dispositions' && partsIn[2] && method === 'PATCH') {
        var dId = decodeURIComponent(partsIn[2]);
        var disps = db.incoming[idxIn].dispositions || [];
        var dIdx = disps.findIndex(function(d){ return d.id === dId; });
        if (dIdx === -1) return jsonResponse({ error: 'Disposisi tidak ditemukan.' }, 404);
        disps[dIdx] = Object.assign({}, disps[dIdx], body, { updatedAt: nowIso() });
        saveDb(db);
        return jsonResponse(db.incoming[idxIn]);
      }
    }

    if (pathname === '/api/outgoing' && method === 'GET') {
      return jsonResponse({ items: db.outgoing || [] });
    }

    if (pathname === '/api/outgoing' && method === 'POST') {
      if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf tidak memiliki izin membuat surat keluar.' }, 403);
      var yrOut = Number(String(body.letterDate || '').slice(0, 4)) || new Date().getFullYear();
      var seqOut = body.isManualNumber ? 0 : nextCounter(db, yrOut, 'outgoing');
      var fullNo = body.isManualNumber
        ? String(body.fullLetterNumber || '')
        : formatOutgoing(db.settings.outgoingFormatPattern, body.classificationCode, seqOut, db.settings.schoolCode, body.letterDate);
      var itemOut = Object.assign({
        id: genId('out'),
        letterYear: yrOut,
        sequenceNumber: seqOut,
        fullLetterNumber: fullNo,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }, body);
      db.outgoing.unshift(itemOut);
      saveDb(db);
      return jsonResponse(itemOut, 201);
    }

    if (pathname.indexOf('/api/outgoing/') === 0) {
      var outId = decodeURIComponent(pathname.slice('/api/outgoing/'.length));
      var idxOut = db.outgoing.findIndex(function(l){ return l.id === outId; });
      if (idxOut === -1) return jsonResponse({ error: 'Surat keluar tidak ditemukan.' }, 404);
      if (method === 'PATCH') {
        if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf tidak memiliki izin mengubah surat keluar.' }, 403);
        db.outgoing[idxOut] = Object.assign({}, db.outgoing[idxOut], body, { updatedAt: nowIso() });
        saveDb(db);
        return jsonResponse(db.outgoing[idxOut]);
      }
      if (method === 'DELETE') {
        if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat menghapus surat keluar.' }, 403);
        db.outgoing.splice(idxOut, 1);
        saveDb(db);
        return jsonResponse({}, 204);
      }
    }

    if (pathname === '/api/classifications' && method === 'POST') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengubah klasifikasi.' }, 403);
      var existCls = db.classifications.findIndex(function(c){ return c.code === body.code; });
      if (existCls >= 0) db.classifications[existCls] = body;
      else db.classifications.push(body);
      saveDb(db);
      return jsonResponse(body);
    }

    if (pathname === '/api/classifications/import' && method === 'POST') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengimpor klasifikasi.' }, 403);
      var incomingItems = Array.isArray(body.items) ? body.items : [];
      if (incomingItems.length === 0) {
        return jsonResponse({ error: 'Daftar kode klasifikasi tidak boleh kosong.' }, 400);
      }
      if (incomingItems.length > 1000) {
        return jsonResponse({ error: 'Maksimal 1.000 baris kode klasifikasi per sekali impor.' }, 400);
      }
      var impMode = body.mode === 'replace' ? 'replace' : 'merge';
      var schemaErr = '';
      var validatedBatch = [];
      for (var ci = 0; ci < incomingItems.length; ci++) {
        var rawItem = incomingItems[ci];
        if (!rawItem || typeof rawItem !== 'object') {
          schemaErr = 'Baris ke-' + (ci + 1) + ' tidak sesuai skema.';
          break;
        }
        var cCode = String(rawItem.code || '').replace(/\\s+/g, ' ').trim();
        var cName = String(rawItem.name || '').replace(/\\s+/g, ' ').trim();
        var cDesc = String(rawItem.description || '').replace(/\\s+/g, ' ').trim();
        if (!cCode || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/.test(cCode)) {
          schemaErr = 'Kode klasifikasi baris ke-' + (ci + 1) + ' tidak valid (maks. 24 karakter, tanpa spasi).';
          break;
        }
        if (!cName || cName.length < 2 || cName.length > 120) {
          schemaErr = 'Nama klasifikasi baris ke-' + (ci + 1) + ' wajib 2-120 karakter.';
          break;
        }
        if (cDesc.length > 240) {
          schemaErr = 'Keterangan klasifikasi baris ke-' + (ci + 1) + ' maksimal 240 karakter.';
          break;
        }
        validatedBatch.push({ code: cCode, name: cName, description: cDesc });
      }
      if (schemaErr) {
        return jsonResponse({ error: schemaErr }, 400);
      }
      var prevList = impMode === 'replace' ? [] : (db.classifications || []).slice();
      var inserted = 0;
      var updated = 0;
      validatedBatch.forEach(function(item) {
        var idx = prevList.findIndex(function(c){ return c.code === item.code; });
        if (idx >= 0) {
          prevList[idx] = item;
          updated += 1;
        } else {
          prevList.push(item);
          inserted += 1;
        }
      });
      prevList.sort(function(a, b){ return String(a.code).localeCompare(String(b.code)); });
      db.classifications = prevList;
      saveDb(db);
      return jsonResponse({
        mode: impMode,
        totalProcessed: inserted + updated,
        inserted: inserted,
        updated: updated,
        totalClassifications: prevList.length,
        items: prevList
      });
    }

    if (pathname.indexOf('/api/classifications/') === 0 && method === 'DELETE') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat menghapus klasifikasi.' }, 403);
      var clsCode = decodeURIComponent(pathname.slice('/api/classifications/'.length));
      db.classifications = db.classifications.filter(function(c){ return c.code !== clsCode; });
      saveDb(db);
      return jsonResponse({}, 204);
    }

    if (pathname === '/api/disposition-recipients' && method === 'GET') {
      var activeOnly = urlStr.indexOf('activeOnly=1') !== -1 || urlStr.indexOf('activeOnly=true') !== -1;
      var recList = db.dispositionRecipients || [];
      return jsonResponse({ items: activeOnly ? recList.filter(function(r){ return r.isActive; }) : recList });
    }

    if (pathname === '/api/disposition-recipients' && method === 'POST') {
      if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf tidak memiliki izin menambah penerima disposisi.' }, 403);
      var rec = Object.assign({ id: genId('rec'), isActive: true, createdAt: nowIso(), updatedAt: nowIso() }, body);
      db.dispositionRecipients.push(rec);
      saveDb(db);
      return jsonResponse(rec, 201);
    }

    if (pathname.indexOf('/api/disposition-recipients/') === 0) {
      var recId = decodeURIComponent(pathname.slice('/api/disposition-recipients/'.length));
      var rIdx = db.dispositionRecipients.findIndex(function(r){ return r.id === recId; });
      if (rIdx === -1) return jsonResponse({ error: 'Data penerima tidak ditemukan.' }, 404);
      if (method === 'PATCH') {
        if (user.role === 'staf') return jsonResponse({ error: 'Peran Staf tidak memiliki izin mengubah penerima disposisi.' }, 403);
        db.dispositionRecipients[rIdx] = Object.assign({}, db.dispositionRecipients[rIdx], body, { updatedAt: nowIso() });
        saveDb(db);
        return jsonResponse(db.dispositionRecipients[rIdx]);
      }
      if (method === 'DELETE') {
        if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat menghapus data penerima.' }, 403);
        db.dispositionRecipients.splice(rIdx, 1);
        saveDb(db);
        return jsonResponse({}, 204);
      }
    }

    if (pathname === '/api/regulations' && method === 'GET') {
      return jsonResponse({ items: db.regulations || [] });
    }

    if (pathname === '/api/regulations' && method === 'POST') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengunggah peraturan.' }, 403);
      var newReg = Object.assign({
        id: genId('reg'),
        uploadedBy: user.displayName || 'Admin Tata Usaha',
        createdAt: nowIso(),
        updatedAt: nowIso()
      }, body);
      db.regulations = db.regulations || [];
      db.regulations.unshift(newReg);
      saveDb(db);
      return jsonResponse(newReg, 201);
    }

    if (pathname.indexOf('/api/regulations/') === 0) {
      var regId = decodeURIComponent(pathname.slice('/api/regulations/'.length));
      var regList = db.regulations || [];
      var regIdx = regList.findIndex(function(r){ return r.id === regId; });
      if (regIdx === -1) return jsonResponse({ error: 'Dokumen peraturan tidak ditemukan.' }, 404);
      if (method === 'PATCH') {
        if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengubah peraturan.' }, 403);
        regList[regIdx] = Object.assign({}, regList[regIdx], body, { updatedAt: nowIso() });
        db.regulations = regList;
        saveDb(db);
        return jsonResponse(regList[regIdx]);
      }
      if (method === 'DELETE') {
        if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat menghapus peraturan.' }, 403);
        regList.splice(regIdx, 1);
        db.regulations = regList;
        saveDb(db);
        return jsonResponse({}, 204);
      }
    }

    if (pathname.indexOf('/api/counters/') === 0) {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengelola penghitung tahunan.' }, 403);
      var cParts = pathname.slice('/api/counters/'.length).split('/');
      var cYear = Number(cParts[0]);
      var existingC = db.counters.find(function(c){ return Number(c.year) === cYear; });
      if (cParts[1] === 'init' && method === 'POST') {
        if (existingC) return jsonResponse({ counter: existingC, alreadyInitialized: true }, 200);
        var createdC = { year: cYear, incomingLastSeq: 0, outgoingLastSeq: 0 };
        db.counters.push(createdC);
        saveDb(db);
        return jsonResponse({ counter: createdC, alreadyInitialized: false }, 201);
      }
      if (method === 'PUT') {
        if (existingC) {
          existingC.incomingLastSeq = Number(body.incomingLastSeq || 0);
          existingC.outgoingLastSeq = Number(body.outgoingLastSeq || 0);
        } else {
          existingC = { year: cYear, incomingLastSeq: Number(body.incomingLastSeq || 0), outgoingLastSeq: Number(body.outgoingLastSeq || 0) };
          db.counters.push(existingC);
        }
        saveDb(db);
        return jsonResponse(existingC);
      }
    }

    if (pathname === '/api/uploads' && method === 'POST') {
      var rawB64 = String(body.dataBase64 || '');
      var finalUrl = rawB64.indexOf('data:') === 0
        ? rawB64
        : 'data:' + (body.mimeType || 'application/octet-stream') + ';base64,' + rawB64;
      var payloadB64 = rawB64.indexOf(',') !== -1 ? rawB64.split(',')[1] || '' : rawB64;
      return jsonResponse({
        attachmentUrl: finalUrl,
        attachmentName: body.fileName || 'lampiran',
        sizeBytes: Math.round((payloadB64.length * 3) / 4)
      }, 201);
    }

    if (pathname.indexOf('/api/ai/') === 0) {
      return jsonResponse({
        error: 'Fitur AI membutuhkan koneksi ke server Node.js aktif (' + DEFAULT_SERVER_ORIGIN + '). Untuk menggunakan AI di Blogger, gunakan mode Embed Server Live atau atur window.__ESURAT_API_BASE__.'
      }, 503);
    }

    if (pathname === '/api/monitoring/backup' && method === 'GET') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengunduh cadangan database.' }, 403);
      return jsonResponse({ exportedAt: nowIso(), source: 'blogger-localStorage', data: db });
    }

    if (pathname === '/api/monitoring/storage' && method === 'GET') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat melihat status penyimpanan.' }, 403);
      return jsonResponse({
        journalMode: 'localStorage',
        synchronousMode: 'SYNC',
        dbSizeBytes: JSON.stringify(db).length,
        walSizeBytes: 0,
        lastCheckpointAt: nowIso(),
        lastAutoBackupAt: '',
        autoBackupCount: 0,
        integrityStatus: 'ok',
        incomingCount: (db.incoming || []).length,
        outgoingCount: (db.outgoing || []).length,
        regulationCount: (db.regulations || []).length,
        uploadedFileCount: 0,
        uploadedFilesBytes: 0
      });
    }

    if (pathname === '/api/monitoring/client-error' && method === 'POST') {
      return jsonResponse({ logged: true, id: genId('err') }, 201);
    }

    if (pathname === '/api/export/spreadsheet-data' && method === 'GET') {
      if (user.role !== 'admin') return jsonResponse({ error: 'Hanya Admin yang dapat mengekspor database.' }, 403);
      return jsonResponse({
        exportedAt: nowIso(),
        source: 'blogger-localStorage',
        data: Object.assign({ activityLogs: [] }, db)
      });
    }

    if (pathname === '/api/health') {
      return jsonResponse({ ok: true, service: 'e-surat-blogger-standalone', database: 'localStorage', timestamp: nowIso(), uptimeSeconds: 0 });
    }

    return jsonResponse({ items: [], users: [DEMO_USERS.admin, DEMO_USERS.kepsek, DEMO_USERS.staf_kurikulum], activities: [], errors: [], alerts: [], unreadCount: 0, snapshots: [], draft: null });
  };
})();`;
}

export async function generateBloggerExportPackage(options: {
  workspaceRoot: string;
  store: PersuratanDatabase;
  appOrigin: string;
}): Promise<BloggerExportPackage> {
  const { workspaceRoot, store, appOrigin } = options;
  const settings = store.getSettings();
  const safeOrigin = sanitizePublicOrigin(appOrigin, 'https://localhost:3000');
  const { entries: sourceEntries, summaries } = collectSourceFiles(workspaceRoot);
  const { css, js } = await loadCompiledClientAssets(workspaceRoot);
  const shimJs = buildBloggerRuntimeShimScript(store, safeOrigin);
  const safeInlineCss = css.replace(/<\/style/gi, '<\\/style');
  const safeShimJs = escapeInlineScript(shimJs);
  const safeAppJs = escapeInlineScript(js);

  const safeTitle = escapeHtmlAttr(`E-Surat ${settings.schoolName}`);
  const safeDesc = escapeHtmlAttr(
    `Aplikasi Manajemen Persuratan Sekolah - ${settings.schoolName}`
  );

  // 1. HTML Mandiri Tunggal (cocok untuk Halaman/Postingan HTML Blogger atau dihosting sebagai HTML statis)
  const htmlBundle = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
${safeInlineCss}
  </style>
</head>
<body class="bg-[var(--theme-canvas)] text-[var(--theme-text)] antialiased">
  <div id="root"></div>
  <script>
${safeShimJs}
  </script>
  <script>
${safeAppJs}
  </script>
</body>
</html>`;

  // 2. Template XML Tema Blogger Lengkap (siap unggah di Blogger -> Tema -> Pulihkan)
  const xmlTheme = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:css='false' b:defaultwidgetversion='2' b:js='false' b:layoutsVersion='3' lang='id' xmlns='http://www.w3.org/1999/xhtml' xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta charset='UTF-8'/>
  <meta content='width=device-width, initial-scale=1.0' name='viewport'/>
  <title>${safeTitle}</title>
  <meta content='${safeDesc}' name='description'/>
  <link href='https://fonts.googleapis.com' rel='preconnect'/>
  <link crossorigin='' href='https://fonts.gstatic.com' rel='preconnect'/>
  <link href='https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&amp;family=Plus+Jakarta+Sans:wght@500;600;700&amp;family=Public+Sans:wght@400;500;600&amp;display=swap' rel='stylesheet'/>
  <b:skin><![CDATA[
/* E-Surat Blogger Theme - ${escapeXmlCdata(settings.schoolName)} */
${escapeXmlCdata(css)}
  ]]></b:skin>
</head>
<body class='bg-[var(--theme-canvas)] text-[var(--theme-text)] antialiased'>
  <div style='display:none'>
    <b:section id='main-esurat-blogger-host' maxwidgets='1' showaddelement='no'/>
  </div>
  <div id='root'></div>
  <script>
//<![CDATA[
${escapeXmlCdata(safeShimJs)}
//]]>
  </script>
  <script>
//<![CDATA[
${escapeXmlCdata(safeAppJs)}
//]]>
  </script>
</body>
</html>`;

  // 3. Kode Embed Iframe Responsif (terhubung langsung ke Server Live SQLite & Gemini AI)
  const iframeSnippet = `<!-- Kode Embed Halaman Blogger (Terhubung Penuh ke Server Live: Database SQLite & Asisten AI) -->
<!-- Cara pasang: Blogger > Halaman > Halaman Baru > ubah ke "Tampilan HTML" > tempel kode ini -->
<div id="esurat-blogger-frame-wrap" style="width:100%;max-width:100%;margin:0 auto;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;background:#f5f7fb;box-shadow:0 4px 18px rgba(15,23,42,0.08);">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#102a43;color:#ffffff;font-family:'Public Sans',sans-serif;font-size:13px;">
    <strong>${safeTitle}</strong>
    <a href="${escapeHtmlAttr(safeOrigin)}" target="_blank" rel="noopener noreferrer" style="color:#bfdbfe;text-decoration:none;font-weight:600;font-size:12px;">Buka Layar Penuh &#8599;</a>
  </div>
  <iframe
    src="${escapeHtmlAttr(safeOrigin)}"
    title="${safeTitle}"
    style="width:100%;height:86vh;min-height:680px;border:0;display:block;"
    loading="lazy"
    allow="clipboard-write"
  ></iframe>
</div>`;

  // 4. Panduan Penerapan di Blogger
  const guideText = `PANDUAN PENERAPAN E-SURAT (${settings.schoolName}) KE BLOGGER
Dibuat pada: ${new Date().toISOString()}

PILIHAN 1 — TEMPLATE TEMA XML BLOGGER (TAMPILAN PENUH SATU BLOG)
1. Buka Dasbor Blogger (https://www.blogger.com) dan pilih blog Anda (atau buat blog khusus persuratan sekolah).
2. Masuk ke menu "Tema" (Theme) di bilah kiri.
3. Klik panah di samping tombol "Sesuaikan" -> pilih "Pulihkan" (Restore) -> klik "Upload".
4. Pilih berkas: blogger/esurat-blogger-theme.xml dari arsip ZIP ini.
5. Buka alamat blog Anda. Aplikasi E-Surat tampil penuh layar dan menyimpan data di browser (localStorage).
   Akun login lokal bawaan:
   - Admin: admin / sperogir1234 (atau admin2026)
   - Kepala Sekolah: kepsek / kepsek2026
   - Staf: staf_kurikulum / staf2026

PILIHAN 2 — EMBED HALAMAN / POSTINGAN BLOGGER (TERHUBUNG KE SERVER LIVE + AI + SQLITE)
1. Jika blog sudah memiliki tema berita/profil sekolah dan Anda ingin memasang E-Surat di satu halaman khusus:
2. Buka menu "Halaman" (Pages) -> "Halaman Baru".
3. Ganti mode editor dari "Tampilan Menulis" ke "Tampilan HTML" (ikon </>).
4. Tempel isi berkas: blogger/esurat-blogger-iframe.html (URL server aktif: ${safeOrigin}).
5. Publikasikan halaman. Semua fitur database SQLite, unggah PDF/gambar, multi-pengguna, dan Asisten AI berjalan penuh.

PILIHAN 3 — KODE SUMBER LENGKAP & BUILD ULANG
Seluruh kode sumber aplikasi (src/, server/, tests/, package.json, vite.config.ts, server.ts) ikut disertakan dalam arsip ZIP ini sehingga dapat disesuaikan dan dijalankan di server Node.js/Cloud Run/VPS maupun di-build ulang dengan "npm run build".
`;

  void sourceEntries;

  return {
    generatedAt: new Date().toISOString(),
    schoolName: settings.schoolName,
    appOrigin: safeOrigin,
    sourceFileCount: summaries.length,
    sourceFiles: summaries,
    htmlBundle,
    xmlTheme,
    iframeSnippet,
    guideText,
    bundleStats: {
      jsBytes: Buffer.byteLength(js, 'utf8'),
      cssBytes: Buffer.byteLength(css, 'utf8'),
      htmlBytes: Buffer.byteLength(htmlBundle, 'utf8'),
      xmlBytes: Buffer.byteLength(xmlTheme, 'utf8'),
    },
  };
}

export async function generateBloggerSourceZipBuffer(options: {
  workspaceRoot: string;
  store: PersuratanDatabase;
  appOrigin: string;
}): Promise<{ fileName: string; buffer: Buffer; pkg: BloggerExportPackage }> {
  const pkg = await generateBloggerExportPackage(options);
  const { entries: sourceEntries } = collectSourceFiles(options.workspaceRoot);

  const zipEntries: ZipEntryInput[] = [
    ...sourceEntries,
    { name: 'blogger/esurat-blogger-theme.xml', content: pkg.xmlTheme },
    { name: 'blogger/esurat-blogger-standalone.html', content: pkg.htmlBundle },
    { name: 'blogger/esurat-blogger-iframe.html', content: pkg.iframeSnippet },
    { name: 'blogger/PANDUAN-BLOGGER.txt', content: pkg.guideText },
  ];

  const dateTag = new Date().toISOString().slice(0, 10);
  return {
    fileName: `esurat-blogger-full-source-${dateTag}.zip`,
    buffer: buildZipArchive(zipEntries),
    pkg,
  };
}
