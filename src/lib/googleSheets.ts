import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { BuiltWorksheetPayload } from './spreadsheetBuilder.ts';

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export class GoogleSheetsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsAuthError';
  }
}

export const initGoogleSheetsAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.(user);
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.(null);
    }
  });
};

export const googleSignInForSheets = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Token akses Google Sheets tidak ditemukan setelah autentikasi.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getGoogleSheetsAccessToken = (): string | null => cachedAccessToken;

export const clearGoogleSheetsAccessToken = (): void => {
  cachedAccessToken = null;
};

export const googleSignOutForSheets = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};

export interface ExistingSpreadsheetInfo {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  sheets: Array<{ sheetId: number; title: string }>;
}

export interface SpreadsheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  sheetCount: number;
  totalRowsExported: number;
  exportedAt: string;
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

async function googleSheetsFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) || {}),
    },
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new GoogleSheetsAuthError(
      'Sesi izin Google Sheets telah kedaluwarsa. Silakan masuk kembali dengan akun Google.'
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const errMsg =
      (body as { error?: { message?: string } } | null)?.error?.message ||
      `Permintaan Google Sheets gagal (status ${res.status}).`;
    throw new Error(errMsg);
  }

  return body as T;
}

export async function inspectExistingSpreadsheet(
  accessToken: string,
  spreadsheetId: string
): Promise<ExistingSpreadsheetInfo> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title))`;
  const raw = await googleSheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(url, accessToken);

  return {
    spreadsheetId: raw.spreadsheetId,
    spreadsheetUrl:
      raw.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}/edit`,
    title: raw.properties?.title || 'Spreadsheet Tanpa Judul',
    sheets: (raw.sheets || []).map((s, index) => ({
      sheetId: typeof s.properties?.sheetId === 'number' ? s.properties.sheetId : index,
      title: s.properties?.title || `Sheet${index + 1}`,
    })),
  };
}

export async function exportDatabaseToGoogleSpreadsheet(params: {
  accessToken: string;
  mode: 'create' | 'update';
  title: string;
  existingSpreadsheetId?: string;
  worksheets: BuiltWorksheetPayload[];
}): Promise<SpreadsheetExportResult> {
  const { accessToken, mode, title, existingSpreadsheetId, worksheets } = params;
  if (worksheets.length === 0) {
    throw new Error('Pilih minimal satu tabel database untuk diekspor ke Google Spreadsheet.');
  }

  let spreadsheetId = '';
  let spreadsheetUrl = '';
  let finalTitle = title.trim() || 'Database E-Surat Sekolah';
  const sheetIdByTitle = new Map<string, number>();

  if (mode === 'create') {
    const created = await googleSheetsFetch<{
      spreadsheetId: string;
      spreadsheetUrl: string;
      properties?: { title?: string };
      sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    }>('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          title: finalTitle,
        },
        sheets: worksheets.map((ws) => ({
          properties: {
            title: ws.sheetTitle,
            gridProperties: { frozenRowCount: 1 },
          },
        })),
      }),
    });

    spreadsheetId = created.spreadsheetId;
    spreadsheetUrl =
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    finalTitle = created.properties?.title || finalTitle;
    for (const s of created.sheets || []) {
      if (s.properties?.title && typeof s.properties.sheetId === 'number') {
        sheetIdByTitle.set(s.properties.title, s.properties.sheetId);
      }
    }
  } else {
    if (!existingSpreadsheetId) {
      throw new Error('ID atau tautan Google Spreadsheet tujuan wajib diisi.');
    }
    const existingInfo = await inspectExistingSpreadsheet(accessToken, existingSpreadsheetId);
    spreadsheetId = existingInfo.spreadsheetId;
    spreadsheetUrl = existingInfo.spreadsheetUrl;
    finalTitle = existingInfo.title;

    for (const s of existingInfo.sheets) {
      sheetIdByTitle.set(s.title, s.sheetId);
    }

    const missingTabs = worksheets.filter((ws) => !sheetIdByTitle.has(ws.sheetTitle));
    if (missingTabs.length > 0) {
      const addedRes = await googleSheetsFetch<{
        replies?: Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }>;
      }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            requests: missingTabs.map((ws) => ({
              addSheet: {
                properties: {
                  title: ws.sheetTitle,
                  gridProperties: { frozenRowCount: 1 },
                },
              },
            })),
          }),
        }
      );

      for (const reply of addedRes.replies || []) {
        const props = reply.addSheet?.properties;
        if (props?.title && typeof props.sheetId === 'number') {
          sheetIdByTitle.set(props.title, props.sheetId);
        }
      }
    }

    // Bersihkan isi sheet tujuan sebelum menulis ulang data terbaru
    await googleSheetsFetch<unknown>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values:batchClear`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          ranges: worksheets.map((ws) => escapeSheetTitleForRange(ws.sheetTitle)),
        }),
      }
    );
  }

  // Tulis seluruh baris sebagai RAW literal agar formula-injection tidak pernah dievaluasi
  await googleSheetsFetch<unknown>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: worksheets.map((ws) => ({
          range: `${escapeSheetTitleForRange(ws.sheetTitle)}!A1`,
          majorDimension: 'ROWS',
          values: ws.rows,
        })),
      }),
    }
  );

  // Rapikan header (tebal, latar biru dongker, freeze baris 1, dan sesuaikan lebar kolom)
  const formatRequests: Array<Record<string, unknown>> = [];
  for (const ws of worksheets) {
    const sheetId = sheetIdByTitle.get(ws.sheetTitle);
    if (typeof sheetId !== 'number') continue;

    formatRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: ws.columnCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.06, green: 0.16, blue: 0.26 },
            textFormat: {
              bold: true,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
      },
    });

    formatRequests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: ws.columnCount,
        },
      },
    });
  }

  if (formatRequests.length > 0) {
    await googleSheetsFetch<unknown>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      }
    );
  }

  const totalRowsExported = worksheets.reduce((acc, ws) => acc + ws.dataRowCount, 0);
  return {
    spreadsheetId,
    spreadsheetUrl,
    title: finalTitle,
    sheetCount: worksheets.length,
    totalRowsExported,
    exportedAt: new Date().toISOString(),
  };
}
