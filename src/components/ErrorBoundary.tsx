import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.ts';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Terjadi gangguan saat menampilkan antarmuka aplikasi.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = [error?.stack, info?.componentStack].filter(Boolean).join('\n');
    void api
      .reportClientError(
        error?.message || 'React ErrorBoundary caught an error',
        typeof window !== 'undefined' ? window.location.pathname : '/app',
        stack
      )
      .catch(() => {
        // Abaikan kegagalan pelaporan error agar fallback UI tetap tampil stabil
      });
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[var(--theme-canvas)] text-[var(--theme-text)] flex items-center justify-center p-4">
        <div
          role="alert"
          className="w-full max-w-lg bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-6 sm:p-8 shadow-lg space-y-5"
        >
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h1 className="text-base font-semibold text-[var(--theme-text)]">
                Terjadi Gangguan Tampilan Aplikasi
              </h1>
              <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed">
                Sistem mendeteksi kesalahan tak terduga saat memuat komponen halaman. Data persuratan Anda di server tetap aman.
              </p>
            </div>
          </div>

          {this.state.errorMessage && (
            <div className="px-3.5 py-2.5 rounded-lg border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/40 text-xs font-mono text-rose-800 dark:text-rose-200 break-words">
              {this.state.errorMessage}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-3.5 py-2 text-xs font-medium border border-[var(--theme-border-strong)] rounded-lg text-[var(--theme-text-secondary)] hover:bg-[var(--theme-surface-hover)] inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Coba Pulihkan
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 text-xs font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white rounded-lg inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      </div>
    );
  }
}
