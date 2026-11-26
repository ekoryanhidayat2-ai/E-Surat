import { GoogleGenAI, ThinkingLevel, Type, type Part } from '@google/genai';
import {
  STAFF_UNITS,
  URGENCY_OPTIONS,
  type AiArchiveQueryResult,
  type AiDraftTone,
  type AiIncomingAnalysisResult,
  type AiLetterInsightResult,
  type AiOutgoingDraftResult,
  type ClassificationCode,
  type IncomingLetter,
  type LetterUrgency,
  type OutgoingLetter,
  type SchoolSettings,
} from '../src/types.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';

const SUPPORTED_INLINE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export class AiServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'AiServiceError';
    this.statusCode = statusCode;
  }
}

export interface InlineAttachmentData {
  mimeType: string;
  content: Buffer;
  fileName?: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new AiServiceError(
      'Layanan AI belum aktif karena GEMINI_API_KEY belum tersedia. Periksa konfigurasi di panel Settings > Secrets.',
      503
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseApiErrorStatus(err: unknown): { status?: number; message: string } {
  if (!err || typeof err !== 'object') {
    return { message: String(err || 'Kesalahan tidak diketahui') };
  }
  const obj = err as Record<string, unknown>;
  const message = typeof obj.message === 'string' ? obj.message : String(err);
  const directStatus =
    typeof obj.status === 'number'
      ? obj.status
      : typeof obj.statusCode === 'number'
        ? obj.statusCode
        : typeof obj.code === 'number'
          ? obj.code
          : undefined;
  return { status: directStatus, message };
}

function mapGeminiError(err: unknown): AiServiceError {
  if (err instanceof AiServiceError) return err;
  const { status, message } = parseApiErrorStatus(err);
  const upper = message.toUpperCase();

  if (
    status === 403 ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    status === 400 && upper.includes('API KEY')
  ) {
    return new AiServiceError(
      'Kunci API Gemini tidak valid atau tidak memiliki izin akses. Silakan periksa kembali kunci API Anda di panel Settings > Secrets.',
      403
    );
  }
  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return new AiServiceError(
      'Kuota permintaan AI sementara tercapai (429). Silakan coba sesaat lagi atau periksa paket kunci API di panel Settings > Secrets.',
      429
    );
  }
  if (status === 404 || upper.includes('NOT_FOUND')) {
    return new AiServiceError(
      `Model AI (${GEMINI_MODEL}) tidak ditemukan atau belum tersedia pada endpoint saat ini.`,
      502
    );
  }
  return new AiServiceError(
    `Layanan AI mengalami gangguan sementara: ${message.slice(0, 180)}`,
    502
  );
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const { status, message } = parseApiErrorStatus(err);
      const upper = message.toUpperCase();
      const nonRetryable =
        err instanceof AiServiceError ||
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        upper.includes('PERMISSION_DENIED') ||
        upper.includes('API_KEY_INVALID');
      if (nonRetryable || i === attempts - 1) {
        throw mapGeminiError(err);
      }
      const delayMs = 450 * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw mapGeminiError(lastError);
}

function buildAttachmentPart(attachment?: InlineAttachmentData | null): Part | null {
  if (!attachment || !attachment.content || attachment.content.length === 0) {
    return null;
  }
  if (!SUPPORTED_INLINE_MIME.has(attachment.mimeType)) {
    return null;
  }
  return {
    inlineData: {
      mimeType: attachment.mimeType,
      data: attachment.content.toString('base64'),
    },
  };
}

function sanitizeIsoDate(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return fallback;
}

function matchClassification(rawCode: unknown, classifications: ClassificationCode[]): string {
  const fallback = classifications[0]?.code || '421.3';
  if (typeof rawCode !== 'string' || !rawCode.trim()) return fallback;
  const clean = rawCode.trim();
  const exact = classifications.find((c) => c.code === clean);
  if (exact) return exact.code;
  const prefix = classifications.find(
    (c) => clean.startsWith(c.code) || c.code.startsWith(clean)
  );
  return prefix ? prefix.code : fallback;
}

function matchUrgency(rawUrgency: unknown): LetterUrgency {
  if (typeof rawUrgency === 'string') {
    const found = URGENCY_OPTIONS.find(
      (u) => u.toLowerCase() === rawUrgency.trim().toLowerCase()
    );
    if (found) return found;
  }
  return 'Biasa';
}

function matchStaffUnit(rawUnit: unknown): string {
  const fallback = STAFF_UNITS[4] || 'Bagian Tata Usaha';
  if (typeof rawUnit !== 'string' || !rawUnit.trim()) return fallback;
  const needle = rawUnit.trim().toLowerCase();
  const exact = STAFF_UNITS.find((u) => u.toLowerCase() === needle);
  if (exact) return exact;
  const partial = STAFF_UNITS.find(
    (u) => u.toLowerCase().includes(needle) || needle.includes(u.toLowerCase())
  );
  return partial || fallback;
}

function parseJsonResponse<T>(rawText: string | undefined, fallbackError: string): T {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    throw new AiServiceError(fallbackError, 502);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
    throw new AiServiceError(fallbackError, 502);
  }
}

export async function analyzeIncomingLetterWithAi(input: {
  rawText?: string;
  attachment?: InlineAttachmentData | null;
  classifications: ClassificationCode[];
  settings: SchoolSettings;
}): Promise<AiIncomingAnalysisResult> {
  const ai = getGeminiClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const classGuide = input.classifications
    .map((c) => `- ${c.code}: ${c.name} (${c.description})`)
    .join('\n');

  const promptText = [
    `Anda adalah asisten Tata Usaha profesional di ${input.settings.schoolName}.`,
    `Tanggal hari ini: ${todayIso}.`,
    'Ekstrak informasi surat masuk dari berkas lampiran dan/atau teks catatan yang diberikan ke dalam format JSON terstruktur dalam Bahasa Indonesia baku.',
    'Daftar kode klasifikasi arsip yang tersedia di sekolah:',
    classGuide,
    'Aturan pengisian:',
    '- Pilih classificationCode yang paling sesuai dari daftar di atas.',
    '- urgency harus salah satu dari: "Biasa", "Penting", "Segera", "Rahasia".',
    '- letterDate dan receivedDate berformat YYYY-MM-DD (jika tanggal surat tidak tertulis, gunakan tanggal terdekat atau hari ini; receivedDate default hari ini).',
    '- Jika nomor surat atau pengirim tidak terbaca jelas, berikan nilai terbaik yang masuk akal atau string kosong, dan jelaskan di confidenceNote.',
    input.rawText?.trim()
      ? `\nTeks / keterangan tambahan dari operator:\n"""\n${input.rawText.trim().slice(0, 8000)}\n"""`
      : '\nAnalisis langsung isi dokumen lampiran terlampir.',
  ].join('\n');

  const parts: Part[] = [];
  const filePart = buildAttachmentPart(input.attachment);
  if (filePart) {
    parts.push(filePart);
  }
  parts.push({ text: promptText });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            letterNumber: {
              type: Type.STRING,
              description: 'Nomor surat resmi dari pengirim.',
            },
            letterDate: {
              type: Type.STRING,
              description: 'Tanggal tertera pada surat dalam format YYYY-MM-DD.',
            },
            receivedDate: {
              type: Type.STRING,
              description: 'Tanggal diterima sekolah dalam format YYYY-MM-DD.',
            },
            sender: {
              type: Type.STRING,
              description: 'Nama instansi/lembaga pengirim surat.',
            },
            subject: {
              type: Type.STRING,
              description: 'Perihal atau inti pokok surat secara ringkas dan jelas.',
            },
            classificationCode: {
              type: Type.STRING,
              description: 'Kode klasifikasi arsip sekolah yang paling cocok.',
            },
            urgency: {
              type: Type.STRING,
              description: 'Tingkat sifat surat: Biasa, Penting, Segera, atau Rahasia.',
            },
            notes: {
              type: Type.STRING,
              description: 'Catatan tindak lanjut ringkas (misal tanggal kegiatan, tempat, tenggat).',
            },
            summary: {
              type: Type.STRING,
              description: 'Ringkasan 1-2 kalimat isi surat dalam Bahasa Indonesia.',
            },
            confidenceNote: {
              type: Type.STRING,
              description: 'Catatan kejelasan hasil pembacaan dokumen bagi operator TU.',
            },
          },
          required: [
            'letterNumber',
            'letterDate',
            'receivedDate',
            'sender',
            'subject',
            'classificationCode',
            'urgency',
            'notes',
            'summary',
            'confidenceNote',
          ],
        },
      },
    })
  );

  const parsed = parseJsonResponse<Record<string, unknown>>(
    response.text,
    'AI tidak mengembalikan hasil ekstraksi JSON yang valid.'
  );

  return {
    letterNumber: typeof parsed.letterNumber === 'string' ? parsed.letterNumber.trim() : '',
    letterDate: sanitizeIsoDate(parsed.letterDate, todayIso),
    receivedDate: sanitizeIsoDate(parsed.receivedDate, todayIso),
    sender: typeof parsed.sender === 'string' ? parsed.sender.trim() : '',
    subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
    classificationCode: matchClassification(parsed.classificationCode, input.classifications),
    urgency: matchUrgency(parsed.urgency),
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    confidenceNote:
      typeof parsed.confidenceNote === 'string'
        ? parsed.confidenceNote.trim()
        : 'Hasil ekstraksi siap ditinjau sebelum disimpan.',
  };
}

export async function draftOutgoingLetterWithAi(input: {
  recipient: string;
  subject: string;
  classificationCode: string;
  letterDate: string;
  drafterName: string;
  existingBody?: string;
  notes?: string;
  tone: AiDraftTone;
  settings: SchoolSettings;
}): Promise<AiOutgoingDraftResult> {
  const ai = getGeminiClient();

  const toneInstructions: Record<AiDraftTone, string> = {
    surat_dinas: 'Surat Dinas Resmi umum yang tegas, sopan, lugas, dan sesuai EYD V.',
    undangan:
      'Surat Undangan Resmi dengan susunan pembuka, blok rincian Hari/Tanggal, Waktu, Tempat, dan Acara yang rapi, serta penutup hormat.',
    permohonan:
      'Surat Permohonan Resmi yang santun, argumentatif jelas, menyebutkan maksud bantuan/izin, dan mengharapkan balasan/tindak lanjut.',
    pemberitahuan:
      'Surat Pemberitahuan / Edaran Sekolah kepada orang tua, siswa, atau instansi mitra yang informatif, terstruktur, dan mudah dipahami.',
    sempurnakan:
      'Perbaiki dan sempurnakan naskah surat yang sudah ditulis pengguna agar lebih baku, rapi, bebas salah ketik, dan sesuai Tata Naskah Dinas Pendidikan.',
  };

  const prompt = [
    `Anda adalah Sekretaris / Kepala Tata Usaha berpengalaman di ${input.settings.schoolName} (${input.settings.parentAgency}, ${input.settings.districtGov}).`,
    'Susun hanya bagian ISI NASKAH SURAT (mulai dari salam pembuka "Dengan hormat," sampai kalimat penutup "Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.") tanpa mengulang Kop Surat, Nomor, Hal, atau blok Tanda Tangan Kepala Sekolah (karena sistem cetak akan menempelkannya otomatis).',
    `Gaya bahasa yang diminta: ${toneInstructions[input.tone]}`,
    '',
    'Konteks Surat:',
    `- Penerima / Tujuan: ${input.recipient || '(Belum diisi - gunakan sapaan umum yang sesuai)'}`,
    `- Perihal: ${input.subject || '(Buat perihal singkat yang relevan)'}`,
    `- Kode Klasifikasi: ${input.classificationCode}`,
    `- Tanggal Surat: ${input.letterDate}`,
    `- Unit Pengonsep: ${input.drafterName}`,
    input.notes ? `- Catatan/Poin Khusus Operator: ${input.notes}` : '',
    input.existingBody?.trim()
      ? `\nNaskah awal / poin draf dari operator:\n"""\n${input.existingBody.trim()}\n"""`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: {
              type: Type.STRING,
              description: 'Perihal surat yang ringkas dan formal.',
            },
            bodyText: {
              type: Type.STRING,
              description:
                'Naskah lengkap isi surat dinas berbahasa Indonesia baku (tanpa kop & blok TTD). Gunakan baris baru \\n untuk pemisah paragraf.',
            },
            notes: {
              type: Type.STRING,
              description: 'Saran kelengkapan atau catatan arsip singkat untuk operator (opsional).',
            },
            toneUsed: {
              type: Type.STRING,
              description: 'Nama singkat gaya naskah yang diterapkan.',
            },
          },
          required: ['subject', 'bodyText', 'notes', 'toneUsed'],
        },
      },
    })
  );

  const parsed = parseJsonResponse<Record<string, unknown>>(
    response.text,
    'AI gagal menyusun draf naskah surat keluar.'
  );

  return {
    subject:
      typeof parsed.subject === 'string' && parsed.subject.trim()
        ? parsed.subject.trim()
        : input.subject,
    bodyText: typeof parsed.bodyText === 'string' ? parsed.bodyText.trim() : '',
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
    toneUsed: typeof parsed.toneUsed === 'string' ? parsed.toneUsed.trim() : input.tone,
  };
}

export async function summarizeLetterWithAi(input: {
  kind: 'incoming' | 'outgoing';
  incomingLetter?: IncomingLetter;
  outgoingLetter?: OutgoingLetter;
  attachment?: InlineAttachmentData | null;
  settings: SchoolSettings;
}): Promise<AiLetterInsightResult> {
  const ai = getGeminiClient();

  const unitList = STAFF_UNITS.map((u) => `- ${u}`).join('\n');
  const metadataLines =
    input.kind === 'incoming' && input.incomingLetter
      ? [
          'Jenis: SURAT MASUK',
          `Nomor Agenda: ${input.incomingLetter.agendaNumber}`,
          `Nomor Surat Asal: ${input.incomingLetter.letterNumber}`,
          `Pengirim: ${input.incomingLetter.sender}`,
          `Tanggal Surat: ${input.incomingLetter.letterDate}`,
          `Tanggal Diterima: ${input.incomingLetter.receivedDate}`,
          `Sifat: ${input.incomingLetter.urgency}`,
          `Klasifikasi: ${input.incomingLetter.classificationCode}`,
          `Status: ${input.incomingLetter.status}`,
          `Perihal: ${input.incomingLetter.subject}`,
          `Catatan: ${input.incomingLetter.notes || '-'}`,
          `Disposisi yang sudah ada: ${input.incomingLetter.dispositions.length} item`,
        ]
      : input.outgoingLetter
        ? [
            'Jenis: SURAT KELUAR',
            `Nomor Surat: ${input.outgoingLetter.fullLetterNumber}`,
            `Tujuan: ${input.outgoingLetter.recipient}`,
            `Tanggal Surat: ${input.outgoingLetter.letterDate}`,
            `Konseptor: ${input.outgoingLetter.drafterName}`,
            `Klasifikasi: ${input.outgoingLetter.classificationCode}`,
            `Status: ${input.outgoingLetter.status}`,
            `Perihal: ${input.outgoingLetter.subject}`,
            `Isi Naskah:\n${input.outgoingLetter.bodyText || '(Belum ada naskah isi)'}`,
            `Catatan: ${input.outgoingLetter.notes || '-'}`,
          ]
        : [];

  const promptText = [
    `Anda adalah Asisten Eksekutif Persuratan untuk Kepala Sekolah dan Bagian Tata Usaha di ${input.settings.schoolName}.`,
    'Berikan ringkasan eksekutif, poin penting, dan rekomendasi tindak lanjut dalam Bahasa Indonesia yang formal dan tajam.',
    input.kind === 'incoming'
      ? `Untuk Surat Masuk, pilih SATU unit kerja paling relevan dari daftar berikut untuk recommendedUnit:\n${unitList}\nSerta tulis kalimat instruksi disposisi formal di recommendedInstruction dan estimasi batas hari penyelesaian di recommendedDeadlineDays (angka 1-30).`
      : 'Untuk Surat Keluar, berikan catatan evaluasi kelengkapan tata naskah dinas pada reviewNotes (misal kejelasan waktu/tempat/sasaran/EYD).',
    '',
    'Data Surat:',
    ...metadataLines,
  ].join('\n');

  const parts: Part[] = [];
  const filePart = buildAttachmentPart(input.attachment);
  if (filePart) {
    parts.push(filePart);
  }
  parts.push({ text: promptText });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'Ringkasan eksekutif 2-3 kalimat mengenai inti surat.',
            },
            keyPoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Maksimal 4 poin penting isi surat (tanggal, lokasi, aksi, atau syarat).',
            },
            recommendedUnit: {
              type: Type.STRING,
              description: 'Unit kerja sekolah yang paling tepat menerima disposisi.',
            },
            recommendedInstruction: {
              type: Type.STRING,
              description: 'Saran kalimat instruksi disposisi pimpinan yang jelas dan sopan.',
            },
            recommendedDeadlineDays: {
              type: Type.INTEGER,
              description: 'Estimasi jumlah hari dari hari ini untuk batas tindak lanjut (1-30).',
            },
            urgencyAssessment: {
              type: Type.STRING,
              description: 'Penilaian tingkat prioritas atau urgensi surat.',
            },
            suggestedReplySubject: {
              type: Type.STRING,
              description: 'Saran perihal jika perlu dibuatkan surat keluar balasan.',
            },
            reviewNotes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Catatan pemeriksaan kelengkapan atau hal yang perlu diperhatikan.',
            },
          },
          required: [
            'summary',
            'keyPoints',
            'recommendedUnit',
            'recommendedInstruction',
            'recommendedDeadlineDays',
            'urgencyAssessment',
            'suggestedReplySubject',
            'reviewNotes',
          ],
        },
      },
    })
  );

  const parsed = parseJsonResponse<Record<string, unknown>>(
    response.text,
    'AI tidak mengembalikan ringkasan surat dalam format yang valid.'
  );

  const rawDays = Number(parsed.recommendedDeadlineDays);
  const deadlineDays =
    Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 60 ? Math.round(rawDays) : 3;

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    keyPoints: Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.filter((p): p is string => typeof p === 'string').slice(0, 5)
      : [],
    recommendedUnit: matchStaffUnit(parsed.recommendedUnit),
    recommendedInstruction:
      typeof parsed.recommendedInstruction === 'string'
        ? parsed.recommendedInstruction.trim()
        : 'Mohon dipelajari dan ditindaklanjuti sesuai ketentuan.',
    recommendedDeadlineDays: deadlineDays,
    urgencyAssessment:
      typeof parsed.urgencyAssessment === 'string' ? parsed.urgencyAssessment.trim() : '',
    suggestedReplySubject:
      typeof parsed.suggestedReplySubject === 'string' ? parsed.suggestedReplySubject.trim() : '',
    reviewNotes: Array.isArray(parsed.reviewNotes)
      ? parsed.reviewNotes.filter((p): p is string => typeof p === 'string').slice(0, 5)
      : [],
  };
}

export async function queryArchiveWithAi(input: {
  question: string;
  incoming: IncomingLetter[];
  outgoing: OutgoingLetter[];
  settings: SchoolSettings;
}): Promise<AiArchiveQueryResult> {
  const ai = getGeminiClient();
  const cleanQuestion = input.question.trim();
  if (!cleanQuestion) {
    throw new AiServiceError('Pertanyaan untuk Asisten AI tidak boleh kosong.', 400);
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  // Rangkum hingga 120 surat masuk & 120 surat keluar terbaru agar konteks selalu akurat dan hemat token
  const incomingContext = input.incoming.slice(0, 120).map((l) => ({
    agenda: l.agendaNumber,
    noSurat: l.letterNumber,
    tglTerima: l.receivedDate,
    tglSurat: l.letterDate,
    pengirim: l.sender,
    perihal: l.subject,
    klasifikasi: l.classificationCode,
    sifat: l.urgency,
    status: l.status,
    disposisi: l.dispositions.map((d) => ({
      unit: d.targetUnit,
      status: d.status,
      batas: d.deadlineDate || '-',
      instruksi: d.instruction.slice(0, 120),
    })),
  }));

  const outgoingContext = input.outgoing.slice(0, 120).map((l) => ({
    noSurat: l.fullLetterNumber,
    tglSurat: l.letterDate,
    tujuan: l.recipient,
    perihal: l.subject,
    klasifikasi: l.classificationCode,
    konseptor: l.drafterName,
    status: l.status,
  }));

  const prompt = [
    `Anda adalah Asisten Kecerdasan Arsip Persuratan untuk ${input.settings.schoolName}.`,
    `Tanggal hari ini: ${todayIso}.`,
    `Total data saat ini: ${input.incoming.length} surat masuk, ${input.outgoing.length} surat keluar.`,
    'Jawablah pertanyaan pengguna HANYA berdasarkan data arsip nyata berikut ini. Jangan mengarang nomor surat atau fakta yang tidak ada dalam data.',
    'Sertakan nomor agenda (mis. AGD-2026-001) atau nomor surat keluar yang relevan di answer dan daftar referencedNumbers agar pengguna dapat langsung mengklik dokumennya.',
    '',
    'DATA SURAT MASUK:',
    JSON.stringify(incomingContext),
    '',
    'DATA SURAT KELUAR:',
    JSON.stringify(outgoingContext),
    '',
    `PERTANYAAN PENGGUNA:\n${cleanQuestion}`,
  ].join('\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: {
              type: Type.STRING,
              description:
                'Jawaban terperinci dan rapi dalam Bahasa Indonesia berdasarkan data arsip nyata.',
            },
            highlights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Poin temuan utama atau tindak lanjut yang disarankan (maksimal 5 poin).',
            },
            referencedNumbers: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                'Daftar tepat nomor agenda surat masuk (mis. AGD-2026-001) atau nomor surat keluar (fullLetterNumber) yang dirujuk.',
            },
          },
          required: ['answer', 'highlights', 'referencedNumbers'],
        },
      },
    })
  );

  const parsed = parseJsonResponse<Record<string, unknown>>(
    response.text,
    'AI tidak mengembalikan jawaban arsip dalam format yang valid.'
  );

  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((h): h is string => typeof h === 'string').slice(0, 6)
      : [],
    referencedNumbers: Array.isArray(parsed.referencedNumbers)
      ? parsed.referencedNumbers.filter((n): n is string => typeof n === 'string').slice(0, 12)
      : [],
  };
}
