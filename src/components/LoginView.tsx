import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { DEFAULT_LOGIN_PORTAL_COPY, type AuthUser, type PublicBranding } from '../types.ts';
import { api } from '../lib/api.ts';
import { SchoolCrest } from './SchoolCrest.tsx';

interface LoginViewProps {
  branding: PublicBranding;
  onLoginSuccess: (user: AuthUser) => void;
}

export function LoginView({ branding, onLoginSuccess }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const headline = branding.loginHeadline || DEFAULT_LOGIN_PORTAL_COPY.loginHeadline;
  const description = branding.loginDescription ?? DEFAULT_LOGIN_PORTAL_COPY.loginDescription;
  const formTitle = branding.loginFormTitle || DEFAULT_LOGIN_PORTAL_COPY.loginFormTitle;
  const formSubtitle = branding.loginFormSubtitle ?? DEFAULT_LOGIN_PORTAL_COPY.loginFormSubtitle;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const user = await api.login(username.trim(), password);
      onLoginSuccess(user);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal masuk. Periksa kembali kredensial Anda.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--theme-canvas)] text-[var(--theme-text)] flex flex-col lg:flex-row transition-colors">
      {/* Left Institutional Panel */}
      <div className="lg:w-[46%] bg-[var(--theme-hero-panel)] text-white p-8 sm:p-12 lg:p-14 flex flex-col justify-between relative overflow-hidden border-b lg:border-b-0 lg:border-r border-white/10">
        {/* Subtle Architectural Grid Geometry */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 18% 18%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(circle at 85% 88%, rgba(255,255,255,0.06), transparent 50%)',
          }}
        />
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.06]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-grid)" />
        </svg>

        <div className="space-y-8 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center p-2 shrink-0 shadow-xs">
              <SchoolCrest
                className="w-full h-full"
                logoUrl={branding.logoUrl}
                alt={`Logo ${branding.schoolName}`}
              />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-white font-display truncate">
                {branding.schoolName}
              </div>
              <div className="text-xs text-slate-300 truncate mt-0.5">
                {branding.parentAgency}
              </div>
            </div>
          </div>

          <div className="space-y-4 max-w-lg pt-2">
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight text-balance font-display">
              {headline}
            </h1>
            {description && (
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="pt-8 border-t border-white/15 mt-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-200">{branding.schoolName}</div>
            <div className="text-xs text-slate-400 leading-relaxed">{branding.address}</div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Penyimpanan Terproteksi</span>
          </div>
        </div>
      </div>

      {/* Right Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-5">
          <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-7 sm:p-8 shadow-md shadow-slate-950/5 dark:shadow-black/30 space-y-6">
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-[var(--theme-accent-text)] font-medium">
                Portal Administrasi Persuratan
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-[var(--theme-text)] font-display text-balance">
                {formTitle}
              </h2>
              {formSubtitle && (
                <p className="text-xs text-[var(--theme-text-muted)] leading-relaxed whitespace-pre-line">
                  {formSubtitle}
                </p>
              )}
            </div>

            {errorMsg && (
              <div className="border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-3.5 py-2.5 rounded-lg text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-1.5 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Username</span>
                <div className="relative">
                  <User className="w-4 h-4 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/25 focus:border-[var(--theme-accent)]"
                  />
                </div>
              </label>

              <label className="block space-y-1.5 text-xs">
                <span className="font-medium text-[var(--theme-text-secondary)]">Kata Sandi</span>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[var(--theme-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="w-full pl-9 pr-10 py-2.5 text-sm border border-[var(--theme-border-strong)] rounded-lg bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/25 focus:border-[var(--theme-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>{submitting ? 'Memverifikasi...' : 'Masuk ke Aplikasi'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="pt-4 border-t border-[var(--theme-border)] text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
              Setelah masuk, menu <strong className="text-[var(--theme-text-secondary)]">Panduan Aplikasi</strong> tersedia di bilah navigasi untuk membantu seluruh operator dan staf.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
