import { Plus } from 'lucide-react';
import { BuildMode, MODE_THEMES } from '../types/craft';
import { PWAInstallButton } from './PWAInstallButton';

interface TopBarProps {
  mode: BuildMode;
  credits: number;
  avatarDataUrl?: string | null;
  onScanClick: () => void;
  onCreditsClick: () => void;
  onAvatarClick: () => void;
  onOpenInstallGuide?: () => void;
}

export function TopBar({
  mode,
  credits,
  avatarDataUrl,
  onScanClick,
  onCreditsClick,
  onAvatarClick,
  onOpenInstallGuide,
}: TopBarProps) {
  const theme = MODE_THEMES[mode];

  return (
    <header className="relative z-30 shrink-0 w-full pt-safe pointer-events-none">
      <div className="w-full max-w-[540px] mx-auto px-5 py-2.5 flex items-center justify-between gap-2">
        {/* Left: QR / Preview Scan button + compact Install trigger (hidden once installed) */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={onScanClick}
            aria-label="Scan project QR code"
            className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center rounded-full text-[#111118] hover:bg-black/[0.04] active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A68F6]"
          >
            <svg
              width="23"
              height="23"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 8V6a2 2 0 0 1 2-2h2" />
              <path d="M4 16v2a2 2 0 0 0 2 2h2" />
              <path d="M16 4h2a2 2 0 0 1 2 2v2" />
              <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
          </button>

          <PWAInstallButton
            variant="compact"
            onOpenInstallGuide={onOpenInstallGuide}
          />
        </div>

        {/* Right: Credits Pill & Profile Avatar */}
        <div className="flex items-center gap-2.5 shrink-0 pointer-events-auto">
          <button
            type="button"
            onClick={onCreditsClick}
            aria-label={`AI Craft credits: ${credits.toLocaleString()}. Tap to open AI Craft Pro plans`}
            style={{
              backgroundColor: credits <= 0 ? '#FEF2F2' : theme.accentSoft,
            }}
            className={`h-9 min-h-[40px] pl-2 pr-1.5 rounded-full flex items-center gap-2 transition-colors duration-500 hover:brightness-[0.97] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A68F6] ${
              credits <= 0 ? 'ring-1 ring-red-200' : ''
            }`}
          >
            {/* Iridescent compass orb */}
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center shadow-xs shrink-0"
              style={{
                background:
                  credits <= 0
                    ? 'linear-gradient(135deg, #FCA5A5 0%, #EF4444 65%, #B91C1C 100%)'
                    : mode === 'mobile'
                      ? 'linear-gradient(135deg, #C4B5FD 0%, #7A68F6 60%, #5B21B6 100%)'
                      : 'linear-gradient(135deg, #F0ABFC 0%, #8B5CF6 60%, #6D28D9 100%)',
              }}
              aria-hidden="true"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path
                  d="M14.5 9.5L12 16L9.5 14.5L12 8L14.5 9.5Z"
                  fill="white"
                  fillOpacity="0.95"
                />
                <circle cx="12" cy="12" r="8" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
              </svg>
            </span>

            <span
              className={`font-display font-semibold text-[15px] leading-none tabular-nums ${
                credits <= 0 ? 'text-red-700' : 'text-[#111118]'
              }`}
            >
              {credits.toLocaleString()}
            </span>

            <span
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-white transition-colors duration-500 shrink-0"
              style={{
                backgroundColor: credits <= 0 ? '#EF4444' : theme.accentColor,
              }}
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.75]" />
            </span>
          </button>

          {/* User Avatar */}
          <button
            type="button"
            onClick={onAvatarClick}
            aria-label="Open profile"
            className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-black/10 hover:ring-black/25 active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A68F6] shrink-0"
          >
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt="Your profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
                <defs>
                  <linearGradient id="avatarBg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#3B0764" />
                    <stop offset="55%" stopColor="#1E1B4B" />
                    <stop offset="100%" stopColor="#BE185D" />
                  </linearGradient>
                  <linearGradient id="hoodRim" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" />
                    <stop offset="100%" stopColor="#F43F5E" />
                  </linearGradient>
                </defs>
                <rect width="40" height="40" fill="url(#avatarBg)" />
                <circle cx="20" cy="18" r="13" fill="#0F172A" stroke="url(#hoodRim)" strokeWidth="1.8" />
                <path
                  d="M11 38 C11 29, 29 29, 29 38 Z"
                  fill="#090D16"
                  stroke="#6366F1"
                  strokeWidth="1.2"
                />
                <ellipse cx="16.2" cy="18.2" rx="1.6" ry="1.1" fill="#38BDF8" />
                <ellipse cx="23.8" cy="18.2" rx="1.6" ry="1.1" fill="#FB7185" />
                <path d="M13 13 Q20 7 27 13" stroke="#E0E7FF" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
