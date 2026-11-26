import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import { api } from './lib/api.ts';
import { applyThemeToDocument, getStoredThemeId } from './lib/themes.ts';

applyThemeToDocument(getStoredThemeId());

let lastReportedError = '';
let lastReportedAt = 0;

function isBenignEnvironmentError(message: string, stack = ''): boolean {
  const combined = `${message}\n${stack}`.toLowerCase();
  if (
    combined.includes('websocket closed without opened') ||
    combined.includes('failed to connect to websocket') ||
    (combined.includes('@vite/client') && combined.includes('websocket')) ||
    combined.includes('resizeobserver loop')
  ) {
    return true;
  }
  return false;
}

function reportGlobalClientError(message: string, stack = '') {
  const normalized = message.trim();
  if (!normalized || isBenignEnvironmentError(normalized, stack)) return;
  const now = Date.now();
  if (normalized === lastReportedError && now - lastReportedAt < 5000) {
    return;
  }
  lastReportedError = normalized;
  lastReportedAt = now;
  void api
    .reportClientError(
      normalized,
      typeof window !== 'undefined' ? window.location.pathname : '/app',
      stack
    )
    .catch(() => {
      // Abaikan jika server sedang tidak terjangkau
    });
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const msg = event.error instanceof Error ? event.error.message : event.message;
    const stack = event.error instanceof Error ? event.error.stack || '' : '';
    if (msg) {
      reportGlobalClientError(msg, stack);
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack || '' : '';
    reportGlobalClientError(msg, stack);
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
