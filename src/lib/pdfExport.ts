import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  IncomingLetter,
  OutgoingLetter,
  SchoolSettings,
} from '../types.ts';
import { STAFF_UNITS } from '../types.ts';
import { formatDateId } from './format.ts';
import { filterLettersByDateRange, type ReportScope } from './reportUtils.ts';
import { buildLiveGuideSummary, type AppGuideContext } from './appGuideContent.ts';

export type PdfOrientation = 'portrait' | 'landscape';

const PDF_ORIENTATION_KEY = 'esurat_pdf_orientation';

export function getStoredPdfOrientation(): PdfOrientation {
  try {
    const val = window.localStorage.getItem(PDF_ORIENTATION_KEY);
    return val === 'landscape' ? 'landscape' : 'portrait';
  } catch {
    return 'portrait';
  }
}

export function savePdfOrientation(orientation: PdfOrientation): void {
  try {
    window.localStorage.setItem(PDF_ORIENTATION_KEY, orientation);
  } catch {
    // ignore storage errors
  }
}


interface BannerPngResult {
  dataUrl: string;
  aspectRatio: number;
}

async function loadBannerPngDataUrl(
  imageUrl: string,
  maxW = 900
): Promise<BannerPngResult | null> {
  if (!imageUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width || 400;
        const naturalH = img.naturalHeight || img.height || 80;
        const scale = Math.min(1, maxW / naturalW);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalW * scale));
        canvas.height = Math.max(1, Math.round(naturalH * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          aspectRatio: naturalW / naturalH,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

async function drawKopSurat(doc: jsPDF, settings: SchoolSettings): Promise<number> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const leftMargin = 15;
  const rightMargin = 15;

  if (settings.kopImageUrl) {
    const fullKopBanner = await loadBannerPngDataUrl(settings.kopImageUrl, 1600);
    if (fullKopBanner) {
      const contentWidth = pageWidth - leftMargin - rightMargin;
      let bannerWidthMm = contentWidth;
      let bannerHeightMm = bannerWidthMm / fullKopBanner.aspectRatio;
      const maxHeightMm = 44;
      if (bannerHeightMm > maxHeightMm) {
        bannerHeightMm = maxHeightMm;
        bannerWidthMm = bannerHeightMm * fullKopBanner.aspectRatio;
      }
      const bannerX = leftMargin + (contentWidth - bannerWidthMm) / 2;
      const bannerY = 10;
      doc.addImage(
        fullKopBanner.dataUrl,
        'PNG',
        bannerX,
        bannerY,
        bannerWidthMm,
        bannerHeightMm
      );
      return bannerY + bannerHeightMm + 5.5;
    }
  }

  const centerX = pageWidth / 2;
  const maxTextWidth = pageWidth - leftMargin - rightMargin;

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(settings.districtGov.toUpperCase(), centerX, 15, {
    align: 'center',
    maxWidth: maxTextWidth,
  });
  doc.setFontSize(10.5);
  doc.text(settings.parentAgency.toUpperCase(), centerX, 19.8, {
    align: 'center',
    maxWidth: maxTextWidth,
  });
  doc.setFontSize(14);
  doc.text(settings.schoolName.toUpperCase(), centerX, 25.4, {
    align: 'center',
    maxWidth: maxTextWidth,
  });

  const addressY = 29.8;
  const contactY = addressY + 3.8;
  const lineTopY = contactY + 2.9;
  const lineBottomY = lineTopY + 1.1;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `Alamat: ${settings.address} ${settings.postalCode} · Telp. ${settings.phone}`,
    centerX,
    addressY,
    { align: 'center', maxWidth: maxTextWidth }
  );
  doc.text(
    `Laman: ${settings.website} · Pos-el: ${settings.email} · NPSN: ${settings.npsn}`,
    centerX,
    contactY,
    { align: 'center', maxWidth: maxTextWidth }
  );

  // Double horizontal line
  doc.setLineWidth(0.8);
  doc.line(leftMargin, lineTopY, pageWidth - rightMargin, lineTopY);
  doc.setLineWidth(0.25);
  doc.line(leftMargin, lineBottomY, pageWidth - rightMargin, lineBottomY);

  return lineBottomY + 5.4;
}

function drawSignatureFooter(doc: jsPDF, settings: SchoolSettings, startY: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const todayLong = formatDateId(new Date().toISOString().slice(0, 10), true);

  let y = startY + 10;
  if (y + 38 > pageHeight - 12) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // Left signature (Kepala Sekolah)
  doc.text('Mengetahui,', 18, y);
  doc.text(`Kepala ${settings.schoolName}`, 18, y + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.principalName, 18, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${settings.principalNip || '-'}`, 18, y + 28.5);

  // Right signature (Kepala TU)
  const rightX = pageWidth - 78;
  doc.text(`Girimulyo, ${todayLong}`, rightX, y);
  doc.text('Bagian Tata Usaha', rightX, y + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.tuHeadName, rightX, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${settings.tuHeadNip || '-'}`, rightX, y + 28.5);
}

export async function exportIncomingAgendaPdf(
  letters: IncomingLetter[],
  settings: SchoolSettings,
  periodLabel: string,
  orientation: PdfOrientation = 'portrait'
): Promise<void> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();
  const todayLong = formatDateId(new Date().toISOString().slice(0, 10), true);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('BUKU AGENDA SURAT MASUK', pageWidth / 2, yStart + 2, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`${periodLabel} · Diekspor tanggal ${todayLong}`, pageWidth / 2, yStart + 7, {
    align: 'center',
  });

  autoTable(doc, {
    startY: yStart + 11,
    margin: { left: 15, right: 15 },
    theme: 'grid',
    styles: {
      fontSize: 7.8,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [100, 116, 139],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    head: [['No. Agenda', 'Tgl Terima', 'No. & Tgl Surat', 'Pengirim', 'Perihal', 'Status']],
    body: letters.map((l) => [
      l.agendaNumber,
      formatDateId(l.receivedDate),
      `${l.letterNumber}\n(${formatDateId(l.letterDate)})`,
      l.sender,
      l.subject,
      l.status,
    ]),
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yStart + 30;
  drawSignatureFooter(doc, settings, finalY);

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`buku-agenda-surat-masuk-${fileDate}.pdf`);
}

export async function exportOutgoingAgendaPdf(
  letters: OutgoingLetter[],
  settings: SchoolSettings,
  periodLabel: string,
  orientation: PdfOrientation = 'portrait'
): Promise<void> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();
  const todayLong = formatDateId(new Date().toISOString().slice(0, 10), true);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('BUKU AGENDA SURAT KELUAR', pageWidth / 2, yStart + 2, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`${periodLabel} · Diekspor tanggal ${todayLong}`, pageWidth / 2, yStart + 7, {
    align: 'center',
  });

  autoTable(doc, {
    startY: yStart + 11,
    margin: { left: 15, right: 15 },
    theme: 'grid',
    styles: {
      fontSize: 7.8,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [100, 116, 139],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    head: [['No. Urut', 'Nomor Surat Keluar', 'Tgl Surat', 'Tujuan', 'Perihal', 'Status']],
    body: letters.map((l) => [
      l.sequenceNumber > 0 ? String(l.sequenceNumber).padStart(3, '0') : 'Manual',
      l.fullLetterNumber,
      formatDateId(l.letterDate),
      l.recipient,
      l.subject,
      l.status,
    ]),
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yStart + 30;
  drawSignatureFooter(doc, settings, finalY);

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`buku-agenda-surat-keluar-${fileDate}.pdf`);
}

export async function exportDispositionPdf(
  letter: IncomingLetter,
  settings: SchoolSettings,
  orientation: PdfOrientation = 'portrait'
): Promise<void> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('LEMBAR DISPOSISI', pageWidth / 2, yStart + 3, { align: 'center' });

  const unitsText = STAFF_UNITS.slice(0, 7)
    .map((u) => {
      const checked = letter.dispositions.some((d) => d.targetUnit === u);
      return `[${checked ? 'x' : ' '}] ${u}`;
    })
    .join('\n');

  const dispNotes =
    letter.dispositions.length > 0
      ? letter.dispositions
          .map(
            (d, i) =>
              `${i + 1}. ${d.targetUnit}${d.targetStaffName ? ` (${d.targetStaffName})` : ''}\n   ${d.instruction}${d.deadlineDate ? `\n   Batas: ${formatDateId(d.deadlineDate, true)}` : ''}`
          )
          .join('\n\n')
      : '(Belum ada catatan disposisi)';

  const urgencies = (['Biasa', 'Penting', 'Segera', 'Rahasia'] as const)
    .map((u) => `[${letter.urgency === u ? 'x' : ' '}] ${u}`)
    .join('   ');

  autoTable(doc, {
    startY: yStart + 8,
    margin: { left: 15, right: 15 },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
      textColor: [0, 0, 0],
      lineColor: [30, 41, 59],
      lineWidth: 0.25,
      valign: 'top',
    },
    body: [
      [
        `Surat Dari:\n${letter.sender}`,
        `Diterima Tanggal: ${formatDateId(letter.receivedDate, true)}\nNomor Agenda: ${letter.agendaNumber}`,
      ],
      [
        `Nomor Surat: ${letter.letterNumber}\nTanggal Surat: ${formatDateId(letter.letterDate, true)}`,
        `Sifat Surat:\n${urgencies}`,
      ],
      [{ content: `Perihal:\n${letter.subject}`, colSpan: 2 }],
      [
        `Diteruskan Kepada Yth.:\n\n${unitsText}`,
        `Isi Disposisi Pimpinan:\n\n${dispNotes}`,
      ],
    ],
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yStart + 90;
  drawSignatureFooter(doc, settings, finalY);

  doc.save(`lembar-disposisi-${letter.agendaNumber}.pdf`);
}

export async function exportIncomingLetterPdf(
  letter: IncomingLetter,
  settings: SchoolSettings,
  orientation: PdfOrientation = 'portrait'
): Promise<void> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('KARTU KENDALI & PRATINJAU SURAT MASUK', pageWidth / 2, yStart + 3, {
    align: 'center',
  });

  autoTable(doc, {
    startY: yStart + 8,
    margin: { left: 15, right: 15 },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 2.8,
      textColor: [15, 23, 42],
      lineColor: [71, 85, 105],
      lineWidth: 0.25,
      valign: 'top',
    },
    columnStyles: {
      0: { cellWidth: 46, fontStyle: 'bold', fillColor: [248, 250, 252] },
    },
    body: [
      ['Nomor Agenda Sekolah', letter.agendaNumber],
      ['Nomor Surat Asal', letter.letterNumber],
      ['Tanggal Surat / Terima', `${formatDateId(letter.letterDate, true)}  /  Diterima: ${formatDateId(letter.receivedDate, true)}`],
      ['Asal / Pengirim Surat', letter.sender],
      ['Perihal Surat', letter.subject],
      ['Klasifikasi & Sifat', `Kode ${letter.classificationCode}  ·  Sifat: ${letter.urgency}  ·  Status: ${letter.status}`],
      ['Lampiran Digital', letter.attachmentName || letter.attachmentUrl || '-'],
      ['Catatan Arsip', letter.notes || '-'],
    ],
  });

  const afterMetaY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yStart + 70;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`Riwayat Disposisi (${letter.dispositions.length})`, 15, afterMetaY + 8);

  if (letter.dispositions.length > 0) {
    autoTable(doc, {
      startY: afterMetaY + 11,
      margin: { left: 15, right: 15 },
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2.4,
        textColor: [15, 23, 42],
        lineColor: [100, 116, 139],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [30, 58, 95],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      head: [['Unit / Tujuan', 'Instruksi Disposisi', 'Batas Waktu', 'Status & Laporan']],
      body: letter.dispositions.map((d) => [
        `${d.targetUnit}${d.targetStaffName ? `\n(${d.targetStaffName})` : ''}`,
        d.instruction,
        d.deadlineDate ? formatDateId(d.deadlineDate) : '-',
        `${d.status}${d.completionNote ? `\n${d.completionNote}` : ''}`,
      ]),
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Belum ada disposisi yang dicatat untuk surat ini.', 15, afterMetaY + 14);
  }

  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? afterMetaY + 20;
  drawSignatureFooter(doc, settings, finalY);

  doc.save(`surat-masuk-${letter.agendaNumber}.pdf`);
}

export async function exportOutgoingLetterPdf(
  letter: OutgoingLetter,
  settings: SchoolSettings,
  orientation: PdfOrientation = 'portrait'
): Promise<void> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const leftMargin = 20;
  const maxContentWidth = pageWidth - 40;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  // Tanggal surat di kanan atas
  doc.text(`Girimulyo, ${formatDateId(letter.letterDate, true)}`, pageWidth - 20, yStart + 3, {
    align: 'right',
  });

  // Nomor, Lampiran, Hal
  let y = yStart + 10;
  const rows: Array<[string, string]> = [
    ['Nomor', letter.fullLetterNumber],
    ['Lampiran', letter.attachmentName ? `1 berkas (${letter.attachmentName})` : '-'],
    ['Hal', letter.subject],
  ];

  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.text(label, leftMargin, y);
    doc.text(':', leftMargin + 24, y);
    const wrapped = doc.splitTextToSize(value, maxContentWidth - 28) as string[];
    if (label === 'Hal') doc.setFont('helvetica', 'bold');
    doc.text(wrapped, leftMargin + 28, y);
    y += wrapped.length * 5 + 1;
  }

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text('Kepada Yth.', leftMargin, y);
  y += 5;
  const recipientLines = doc.splitTextToSize(letter.recipient, maxContentWidth - 10) as string[];
  doc.setFont('helvetica', 'bold');
  doc.text(recipientLines, leftMargin, y);
  y += recipientLines.length * 5;
  doc.setFont('helvetica', 'normal');
  doc.text('di Tempat', leftMargin, y);

  y += 10;
  const fallbackBody = [
    'Dengan hormat,',
    '',
    `Sehubungan dengan ${letter.subject}, bersama surat ini kami sampaikan pemberitahuan resmi dari ${settings.schoolName} untuk dapat ditindaklanjuti sebagaimana mestinya.`,
    letter.notes ? `Keterangan tambahan: ${letter.notes}` : '',
    '',
    'Demikian surat ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.',
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');

  const rawBody = (letter.bodyText || '').trim() || fallbackBody;
  const paragraphs = rawBody.split('\n');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  for (const para of paragraphs) {
    if (!para.trim()) {
      y += 4;
      continue;
    }
    const lines = doc.splitTextToSize(para, maxContentWidth) as string[];
    if (y + lines.length * 5 > pageHeight - 45) {
      doc.addPage();
      y = 20;
    }
    doc.text(lines, leftMargin, y);
    y += lines.length * 5 + 1;
  }

  y += 10;
  if (y + 38 > pageHeight - 15) {
    doc.addPage();
    y = 24;
  }

  const sigX = pageWidth - 82;
  doc.text(`Kepala ${settings.schoolName}`, sigX, y);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.principalName, sigX, y + 23);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${settings.principalNip || '-'}`, sigX, y + 28);

  const safeNumber = letter.fullLetterNumber.replace(/[^a-zA-Z0-9._-]+/g, '-');
  doc.save(`surat-keluar-${safeNumber}.pdf`);
}

export async function exportMonthlyReportPdf(options: {
  incomingLetters: IncomingLetter[];
  outgoingLetters: OutgoingLetter[];
  settings: SchoolSettings;
  startDate: string;
  endDate: string;
  scope?: ReportScope;
  orientation?: PdfOrientation;
}): Promise<void> {
  const {
    incomingLetters,
    outgoingLetters,
    settings,
    startDate,
    endDate,
    scope = 'both',
    orientation = 'portrait',
  } = options;

  const filtered = filterLettersByDateRange(
    incomingLetters,
    outgoingLetters,
    startDate,
    endDate
  );

  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const todayLong = formatDateId(new Date().toISOString().slice(0, 10), true);

  const reportTitle =
    scope === 'incoming'
      ? 'LAPORAN BULANAN SURAT MASUK'
      : scope === 'outgoing'
        ? 'LAPORAN BULANAN SURAT KELUAR'
        : 'LAPORAN BULANAN SURAT MASUK DAN SURAT KELUAR';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(reportTitle, pageWidth / 2, yStart + 2, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `Periode: ${formatDateId(filtered.startDate, true)} s.d. ${formatDateId(filtered.endDate, true)} · Diekspor tanggal ${todayLong}`,
    pageWidth / 2,
    yStart + 7,
    { align: 'center' }
  );

  // Rekapitulasi ringkas
  const summaryRows: Array<[string, string, string]> = [];
  if (scope === 'both' || scope === 'incoming') {
    summaryRows.push([
      'Surat Masuk',
      `${filtered.summary.incomingTotal} surat`,
      `Selesai: ${filtered.summary.incomingCompleted} · Didisposisikan: ${filtered.summary.incomingDisposed} · Menunggu: ${filtered.summary.incomingPending} (${filtered.summary.dispositionTotal} disposisi)`,
    ]);
  }
  if (scope === 'both' || scope === 'outgoing') {
    summaryRows.push([
      'Surat Keluar',
      `${filtered.summary.outgoingTotal} surat`,
      `Terkirim: ${filtered.summary.outgoingSent} · Diarsipkan: ${filtered.summary.outgoingArchived} · Draf/Menunggu TTD: ${filtered.summary.outgoingWaiting}`,
    ]);
  }

  autoTable(doc, {
    startY: yStart + 11,
    margin: { left: 15, right: 15 },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [100, 116, 139],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 34, fontStyle: 'bold' },
      1: { cellWidth: 28, fontStyle: 'bold' },
    },
    head: [['Jenis Naskah', 'Jumlah', 'Rincian Status pada Rentang Tanggal']],
    body: summaryRows,
  });

  let cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yStart + 28) + 7;

  if (scope === 'both' || scope === 'incoming') {
    if (cursorY + 24 > pageHeight - 18) {
      doc.addPage();
      cursorY = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(
      `A. Daftar Surat Masuk (${filtered.incoming.length} berkas)`,
      15,
      cursorY
    );

    autoTable(doc, {
      startY: cursorY + 3,
      margin: { left: 15, right: 15 },
      theme: 'grid',
      styles: {
        fontSize: 7.6,
        cellPadding: 2,
        textColor: [15, 23, 42],
        lineColor: [100, 116, 139],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [30, 58, 95],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
      },
      head: [['No', 'No. Agenda', 'Tgl Terima', 'No. & Tgl Surat', 'Pengirim', 'Perihal', 'Status']],
      body:
        filtered.incoming.length > 0
          ? filtered.incoming.map((l, idx) => [
              String(idx + 1),
              l.agendaNumber,
              formatDateId(l.receivedDate),
              `${l.letterNumber}\n(${formatDateId(l.letterDate)})`,
              l.sender,
              l.subject,
              l.status,
            ])
          : [
              [
                {
                  content: 'Tidak ada data surat masuk pada rentang tanggal ini.',
                  colSpan: 7,
                  styles: { halign: 'center', fontStyle: 'italic' },
                },
              ],
            ],
    });

    cursorY =
      ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
        cursorY + 20) + 8;
  }

  if (scope === 'both' || scope === 'outgoing') {
    if (cursorY + 24 > pageHeight - 18) {
      doc.addPage();
      cursorY = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(
      `${scope === 'both' ? 'B.' : 'A.'} Daftar Surat Keluar (${filtered.outgoing.length} berkas)`,
      15,
      cursorY
    );

    autoTable(doc, {
      startY: cursorY + 3,
      margin: { left: 15, right: 15 },
      theme: 'grid',
      styles: {
        fontSize: 7.6,
        cellPadding: 2,
        textColor: [15, 23, 42],
        lineColor: [100, 116, 139],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [30, 58, 95],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
      },
      head: [['No', 'No. Urut', 'Nomor Surat Keluar', 'Tgl Surat', 'Tujuan', 'Perihal', 'Status']],
      body:
        filtered.outgoing.length > 0
          ? filtered.outgoing.map((l, idx) => [
              String(idx + 1),
              l.sequenceNumber > 0 ? String(l.sequenceNumber).padStart(3, '0') : 'Manual',
              l.fullLetterNumber,
              formatDateId(l.letterDate),
              l.recipient,
              l.subject,
              l.status,
            ])
          : [
              [
                {
                  content: 'Tidak ada data surat keluar pada rentang tanggal ini.',
                  colSpan: 7,
                  styles: { halign: 'center', fontStyle: 'italic' },
                },
              ],
            ],
    });

    cursorY =
      ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
        cursorY + 20) + 2;
  }

  drawSignatureFooter(doc, settings, cursorY);
  doc.save(`laporan-bulanan-surat-${filtered.startDate}-sd-${filtered.endDate}.pdf`);
}

export async function buildApplicationGuidePdf(
  settings: SchoolSettings,
  context?: Omit<AppGuideContext, 'settings'>
): Promise<{ blob: Blob; fileName: string }> {
  const summary = buildLiveGuideSummary({ settings, ...context });
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const yStart = await drawKopSurat(doc, settings);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const leftMargin = 15;
  const maxWidth = pageWidth - leftMargin * 2;
  const todayLong = formatDateId(new Date().toISOString().slice(0, 10), true);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('PANDUAN PENGGUNAAN APLIKASI E-SURAT SEKOLAH', pageWidth / 2, yStart + 2, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `${settings.schoolName} · Versi ${summary.version} · Diperbarui Otomatis ${todayLong}`,
    pageWidth / 2,
    yStart + 7,
    { align: 'center' }
  );

  let cursorY = yStart + 13;

  const ensureSpace = (neededMm: number) => {
    if (cursorY + neededMm > pageHeight - 18) {
      doc.addPage();
      cursorY = 18;
    }
  };

  const drawSectionHeading = (title: string) => {
    ensureSpace(14);
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(leftMargin, cursorY, maxWidth, 7, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title, leftMargin + 3, cursorY + 4.8);
    cursorY += 10;
  };

  const drawParagraph = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    ensureSpace(lines.length * 4.2 + 2);
    doc.text(lines, leftMargin, cursorY);
    cursorY += lines.length * 4.2 + 2;
  };

  // BAB I
  drawSectionHeading('BAB I · HAK AKSES PERAN PENGGUNA');
  drawParagraph(
    'Aplikasi E-Surat Sekolah membagi hak akses menjadi tiga peran agar pengelolaan arsip surat masuk, surat keluar, disposisi pimpinan, ekspor data, dan pengaturan tema berjalan tertib serta aman.'
  );
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.4,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold' },
    },
    head: [['Peran Akun', 'Wewenang & Tugas Utama di Aplikasi']],
    body: [
      [
        'Admin / Bagian Tata Usaha',
        `Akses penuh khusus Admin: mencatat surat masuk & surat keluar, mengelola direktori Guru & Karyawan penerima disposisi, mencetak laporan bulanan, mengunggah kop sekolah, memilih ${summary.totalThemes} tema di tab Tampilan & Tema (eksklusif Admin), mengelola klasifikasi + impor Excel, menginisialisasi penghitung tahun baru, mengekspor database ke Google Spreadsheet, mengekspor kode & template Blogger, mengelola akun, serta memeriksa keamanan & cadangan database.`,
      ],
      [
        'Kepala Sekolah',
        'Memantau antrean surat masuk prioritas di Dasbor, memberi instruksi disposisi ke unit kerja beserta nama guru/karyawan, meninjau dan menandatangani surat keluar, serta membaca dokumen referensi peraturan.',
      ],
      [
        'Staf / Unit Kerja',
        'Membaca arsip surat masuk & surat keluar, memantau disposisi yang ditujukan ke unitnya pada menu Disposisi, serta memperbarui status tindak lanjut (Sedang Diproses / Selesai) beserta catatan penyelesaian.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB II
  drawSectionHeading('BAB II · SURAT MASUK, DISPOSISI & DIREKTORI GURU/KARYAWAN');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 46, fontStyle: 'bold' },
    },
    head: [['No', 'Tahapan', 'Langkah Pelaksanaan']],
    body: [
      [
        '1',
        'Pilih Tahun Agenda',
        'Gunakan pemilih Tahun Agenda di bilah samping atau tombol "+ Pilih Tahun" untuk melihat arsip tahun tertentu maupun Semua Tahun. Pencatatan surat baru otomatis mengikuti tahun aktif yang dipilih.',
      ],
      [
        '2',
        'Catat Surat Masuk',
        'Buka menu Surat Masuk -> klik "Catat Surat". Isi nomor surat asal, tanggal surat, tanggal terima, pengirim, kode klasifikasi, sifat urgensi, dan perihal. Nomor agenda dibuat otomatis per tahun dan draf tersimpan otomatis.',
      ],
      [
        '3',
        'Direktori Guru & Karyawan',
        `Admin & Operator dapat menambah, mengubah, dan menonaktifkan daftar guru/karyawan penerima disposisi (saat ini ${summary.activeRecipientsCount} aktif dari ${summary.recipientsCount} terdaftar) di tab Guru & Karyawan atau langsung saat mengisi disposisi.`,
      ],
      [
        '4',
        'Terbitkan & Cetak Disposisi',
        'Buka detail surat masuk -> pilih unit tujuan, nama guru/karyawan penerima, instruksi, dan batas waktu -> klik "Cetak Lembar Disposisi" atau ekspor PDF A4 resmi ber-Kop Sekolah.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB III
  drawSectionHeading('BAB III · SURAT KELUAR, PENOMORAN & PERGANTIAN TAHUN BARU');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 46, fontStyle: 'bold' },
    },
    head: [['No', 'Tahapan', 'Langkah Pelaksanaan']],
    body: [
      [
        '1',
        'Klasifikasi & Nomor Otomatis',
        `Klik "Buat Surat Keluar", pilih kode klasifikasi dan tanggal surat. Sistem otomatis membentuk nomor resmi berurutan per tahun sesuai pola "${summary.outgoingPattern}".`,
      ],
      [
        '2',
        'Peringatan & Auto-Rollover Tahun Baru',
        'Ketika tahun anggaran baru mendekat (H-30 sebelum 1 Januari), spanduk kesiapan tahun baru tampil otomatis. Admin dapat menginisialisasi penghitung #001 satu klik lebih awal atau mengaktifkan opsi inisialisasi otomatis per 1 Januari.',
      ],
      [
        '3',
        'Mode Nomor Manual & Pratinjau A4',
        'Aktifkan mode manual jika perlu nomor sisipan, lalu periksa naskah surat pada Pratinjau Cetak A4 dengan Kop Sekolah dan tanda tangan Kepala Sekolah sebelum mencetak/unduh PDF.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB IV
  drawSectionHeading('BAB IV · CETAK LAPORAN BULANAN SURAT MASUK & KELUAR');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 46, fontStyle: 'bold' },
    },
    head: [['No', 'Fitur Laporan', 'Penjelasan Penggunaan']],
    body: [
      [
        '1',
        'Akses Laporan Bulanan',
        'Klik tombol "Laporan Bulanan" di Dasbor atau bilah alat halaman Surat Masuk maupun Surat Keluar.',
      ],
      [
        '2',
        'Rentang Tanggal & Orientasi',
        'Pilih bulan penuh, pintasan "Bulan Ini" / "Bulan Lalu", atau rentang tanggal khusus, lalu tentukan cakupan (Masuk & Keluar, Masuk saja, Keluar saja) serta orientasi Portrait / Landscape.',
      ],
      [
        '3',
        'Unduh PDF & Cetak Resmi',
        'Dokumen laporan dilengkapi Kop Sekolah, statistik ringkas, daftar surat lengkap, dan blok tanda tangan Kepala Sekolah serta Koordinator TU.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB V
  drawSectionHeading('BAB V · PENGATURAN ADMIN, TEMA, EXCEL KLASIFIKASI & EKSPOR');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
    },
    head: [['Tab Pengaturan (Khusus Admin)', 'Fungsi & Cara Pengelolaan']],
    body: [
      [
        'Profil & Logo Sekolah',
        'Unggah gambar Kop Sekolah Lengkap (maks. 4 MB), logo portal, identitas sekolah, pejabat penanda tangan, dan pola nomor surat keluar.',
      ],
      [
        'Tampilan & Tema (Admin Only)',
        `Pilih dari ${summary.totalThemes} tema (${summary.lightThemesCount} Mode Terang & ${summary.darkThemesCount} Mode Gelap, termasuk ${summary.freshThemesCount} tema Fresh & Elegan). Dokumen cetak PDF tetap menggunakan kertas putih formal.`,
      ],
      [
        'Klasifikasi & Nomor Urut (+ Excel)',
        `Kelola ${summary.classificationsCount} kode klasifikasi tata naskah dinas. Gunakan tombol "Template Excel (.xlsx)" untuk mengunduh format siap isi, "Ekspor Excel" untuk cadangan tabel, dan "Impor Excel" untuk mengimpor banyak kode sekaligus (mode Gabung atau Ganti Semua).`,
      ],
      [
        'Ekspor Google Spreadsheet',
        'Hubungkan akun Google di tab Ekspor Google Spreadsheet, pilih cakupan tahun dan tabel database (Surat Masuk, Keluar, Disposisi, Klasifikasi, Guru/Karyawan, Penghitung, Peraturan, Log), lalu ekspor ke spreadsheet baru atau perbarui spreadsheet yang ada.',
      ],
      [
        'Ekspor Blogger',
        'Tersedia di dalam menu Pengaturan khusus Admin untuk menghasilkan Template XML Tema Blogger, HTML Mandiri tunggal, Embed Iframe server live, atau arsip kode sumber lengkap (.ZIP).',
      ],
      [
        'Keamanan & Data',
        'Database SQLite WAL otomatis tersinkron ke disk. Admin dapat membuat snapshot server, mengunduh/memulihkan cadangan JSON, serta memantau notifikasi keamanan.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB VI
  drawSectionHeading('BAB VI · TAMPILAN MOBILE, PINTASAN & REFERENSI PERATURAN');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
    },
    head: [['Pintasan / Fitur', 'Kegunaan']],
    body: [
      [
        'Pengaturan Kolom Tabel (Mobile)',
        'Klik tombol "Kolom" di atas tabel Surat Masuk atau Surat Keluar untuk menyembunyikan/menampilkan kolom atau memilih preset "Ringkas Mobile".',
      ],
      [
        'Tombol "/" & "Esc" pada Keyboard',
        'Tekan "/" untuk memfokuskan pencarian cepat, dan tekan "Esc" untuk menutup modal, drawer detail, atau menu mobile.',
      ],
      [
        'Ekspor CSV & Buku Agenda PDF',
        'Unduh daftar surat hasil filter ke CSV atau cetak Buku Agenda Surat Masuk/Keluar dalam format PDF A4 resmi.',
      ],
      [
        'Referensi Peraturan PDF',
        'Simpan dan baca dokumen PDF pedoman tata naskah dinas dan kearsipan sekolah langsung di dalam aplikasi.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB VII
  drawSectionHeading('BAB VII · FITUR KECERDASAN BUATAN (ARTIFICIAL INTELLIGENCE)');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
    },
    head: [['Fitur AI Terpadu', 'Cara Penggunaan & Manfaat']],
    body: [
      [
        'Ekstraksi Cerdas AI (Surat Masuk)',
        'Unggah pindai PDF/gambar atau tempel teks surat di formulir Surat Masuk, lalu klik "Ekstrak Otomatis AI" untuk mengisi nomor surat, pengirim, tanggal, klasifikasi, sifat, perihal, dan ringkasan.',
      ],
      [
        'Penyusun Naskah Dinas AI',
        'Di formulir Surat Keluar, pilih gaya naskah (Surat Dinas, Undangan, Permohonan, Pemberitahuan, atau Sempurnakan Draf) lalu klik "Susun Naskah AI".',
      ],
      [
        'Analisis & Saran Disposisi AI',
        'Buka panel detail surat lalu klik "Analisis AI" untuk ringkasan eksekutif serta rekomendasi unit tujuan dan instruksi disposisi.',
      ],
      [
        'Asisten AI Pencarian Arsip',
        'Klik tombol "Asisten AI" di Dasbor untuk bertanya dengan bahasa alami terhadap seluruh arsip surat masuk, surat keluar, dan disposisi sekolah.',
      ],
    ],
  });
  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 30) + 7;

  // BAB VIII: Otomatis Update Mengikuti Konfigurasi & Pembaruan Terkini
  drawSectionHeading('BAB VIII · RINGKASAN KONFIGURASI AKTIF & PEMBARUAN TERKINI');
  drawParagraph(
    `Dokumen panduan ini diperbarui secara otomatis mengikuti versi fitur aplikasi (${summary.version}) serta data konfigurasi aktif sekolah pada saat dibuka:`
  );
  autoTable(doc, {
    startY: cursorY,
    margin: { left: leftMargin, right: leftMargin },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 52, fontStyle: 'bold' },
    },
    head: [['Parameter Sistem Aktif', 'Nilai / Status Saat Ini']],
    body: [
      ['Versi Panduan & Aplikasi', `v${summary.version} · ${summary.releaseLabel}`],
      ['Tema Antarmuka Aktif', `${summary.activeThemeName} (dari ${summary.totalThemes} tema tersedia)`],
      ['Cakupan Tahun Agenda Aktif', summary.yearScopeLabel],
      [
        'Tahun Penghitung Terdaftar',
        summary.counterYears.length > 0 ? summary.counterYears.join(', ') : 'Belum ada',
      ],
      [
        'Auto-Inisialisasi Tahun Baru (1 Jan)',
        summary.autoInitNewYear ? 'Aktif (Otomatis #001)' : 'Manual oleh Admin',
      ],
      ['Kode Klasifikasi Terdaftar', `${summary.classificationsCount} kode klasifikasi`],
      [
        'Direktori Guru & Karyawan',
        `${summary.activeRecipientsCount} aktif (${summary.recipientsCount} total terdaftar)`,
      ],
      [
        'Catatan Pembaruan Terbaru',
        summary.changelog.map((item, i) => `${i + 1}. ${item}`).join('\n'),
      ],
    ],
  });

  // Nomor halaman pada seluruh halaman PDF
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Panduan Penggunaan Aplikasi E-Surat v${summary.version} · ${settings.schoolName}`,
      leftMargin,
      pageHeight - 8
    );
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - leftMargin, pageHeight - 8, {
      align: 'right',
    });
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  const fileName = `panduan-aplikasi-esurat-${fileDate}.pdf`;
  const blob = doc.output('blob');
  return { blob, fileName };
}

export async function exportApplicationGuidePdf(
  settings: SchoolSettings,
  context?: Omit<AppGuideContext, 'settings'>
): Promise<void> {
  const { blob, fileName } = await buildApplicationGuidePdf(settings, context);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
