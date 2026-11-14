import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Cloud,
  CreditCard,
  Database,
  DollarSign,
  Dumbbell,
  Gamepad2,
  Globe,
  Loader2,
  MessageCircle,
  Music,
  Smartphone,
  Soup,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { BillingSummary, PaymentTransaction } from '../types/craft';

export interface ProPlanOption {
  id: 'starter' | 'plus' | 'studio' | 'annual';
  name: string;
  subtitle: string;
  priceText: string;
  cadenceText: string;
  dailyLimit: number;
  creditsToAdd: number;
  badgeText?: string;
}

export const PRO_PLANS: ProPlanOption[] = [
  {
    id: 'starter',
    name: 'Starter',
    subtitle: 'Max 1,500/day · 45,000 credits / 30d',
    priceText: '₦25,000.00',
    cadenceText: 'per month',
    dailyLimit: 1500,
    creditsToAdd: 45000,
  },
  {
    id: 'plus',
    name: 'Plus',
    subtitle: 'Max 3,500/day · 105,000 credits / 30d',
    priceText: '₦48,000.00',
    cadenceText: 'per month',
    dailyLimit: 3500,
    creditsToAdd: 105000,
  },
  {
    id: 'studio',
    name: 'Studio',
    subtitle: 'Max 6,000/day · 180,000 credits / 30d',
    priceText: '₦70,000.00',
    cadenceText: 'per month',
    dailyLimit: 6000,
    creditsToAdd: 180000,
  },
  {
    id: 'annual',
    name: 'Annual',
    subtitle: 'Max 8,000/day · 240,000/mo · 12 cycles',
    priceText: '₦800,000.00',
    cadenceText: 'per year',
    dailyLimit: 8000,
    creditsToAdd: 240000,
    badgeText: 'PRO YEARLY',
  },
];

export const STORAGE_PAYMENT_RESULT_KEY = 'aicraft_payment_result_v1';

const SHOWCASE_ROW_1 = [
  { id: 'r1-card', Icon: CreditCard, bg: 'linear-gradient(145deg, #16A34A 0%, #0D9448 100%)' },
  { id: 'r1-food', Icon: Soup, bg: 'linear-gradient(145deg, #FB923C 0%, #EA580C 100%)' },
  { id: 'r1-game', Icon: Gamepad2, bg: 'linear-gradient(145deg, #6382E8 0%, #4666D6 100%)' },
  { id: 'r1-gym', Icon: Dumbbell, bg: 'linear-gradient(145deg, #9333EA 0%, #7E22CE 100%)' },
  { id: 'r1-cal', Icon: Calendar, bg: 'linear-gradient(145deg, #10B981 0%, #059669 100%)' },
  { id: 'r1-chart', Icon: TrendingUp, bg: 'linear-gradient(145deg, #2563EB 0%, #1D4ED8 100%)' },
  { id: 'r1-music', Icon: Music, bg: 'linear-gradient(145deg, #F43F5E 0%, #E11D48 100%)' },
];

const SHOWCASE_ROW_2 = [
  { id: 'r2-check', Icon: CheckCircle2, bg: 'linear-gradient(145deg, #3B6CE8 0%, #2554D4 100%)' },
  { id: 'r2-phone', Icon: Smartphone, bg: 'linear-gradient(145deg, #5474CC 0%, #3F5DB8 100%)' },
  { id: 'r2-wallet', Icon: Wallet, bg: 'linear-gradient(145deg, #34A853 0%, #1E8E3E 100%)' },
  { id: 'r2-sched', Icon: CalendarDays, bg: 'linear-gradient(145deg, #2DD4BF 0%, #0D9488 100%)' },
  { id: 'r2-chat', Icon: MessageCircle, bg: 'linear-gradient(145deg, #4ADE80 0%, #16A34A 100%)' },
  { id: 'r2-spark', Icon: Sparkles, bg: 'linear-gradient(145deg, #60A5FA 0%, #3B82F6 100%)' },
  { id: 'r2-cloud', Icon: Cloud, bg: 'linear-gradient(145deg, #818CF8 0%, #4F46E5 100%)' },
];

const PRO_FEATURES = [
  { id: 'tools', Icon: Sparkles, label: 'AI tools' },
  { id: 'agents', Icon: Bot, label: 'Create your agents' },
  { id: 'db', Icon: Database, label: 'Databases' },
  { id: 'host', Icon: Globe, label: 'Publish and host live apps' },
  { id: 'credits', Icon: DollarSign, label: 'Monthly usage credits' },
];

async function safeParseJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface ProUpgradeModalProps {
  open: boolean;
  credits: number;
  activePlanId: string | null;
  billing: BillingSummary | null;
  userEmail: string;
  userId?: string;
  authHeaders?: Record<string, string>;
  dynamicColorEnabled: boolean;
  onClose: () => void;
  onPaymentSuccess: (
    transaction: PaymentTransaction,
    billing?: BillingSummary | null
  ) => void;
  onRestorePurchase: () => Promise<{ restored: boolean; message: string }> | { restored: boolean; message: string };
}

export function ProUpgradeModal({
  open,
  credits,
  activePlanId,
  billing,
  userEmail,
  userId,
  authHeaders,
  dynamicColorEnabled,
  onClose,
  onPaymentSuccess,
  onRestorePurchase,
}: ProUpgradeModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<ProPlanOption['id']>('annual');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{
    type: 'info' | 'error';
    text: string;
  } | null>(null);
  const [legalSheet, setLegalSheet] = useState<'terms' | 'privacy' | null>(null);
  const popupPollRef = useRef<number | null>(null);

  const selectedPlan =
    PRO_PLANS.find((p) => p.id === selectedPlanId) ?? PRO_PLANS[PRO_PLANS.length - 1];

  const stopPopupPolling = () => {
    if (popupPollRef.current !== null) {
      window.clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopPopupPolling();
      setProcessingPayment(false);
      setRestoring(false);
      setStatusNotice(null);
      setLegalSheet(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!statusNotice) return;
    const t = window.setTimeout(() => setStatusNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [statusNotice]);

  useEffect(() => {
    if (!open) return;
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        origin &&
        origin !== window.location.origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }

      const data = event.data as
        | {
            type?: string;
            transaction?: PaymentTransaction;
            billing?: BillingSummary | null;
            message?: string;
          }
        | undefined;

      if (!data?.type) return;

      if (data.type === 'PAYMENT_AUTH_SUCCESS' && data.transaction) {
        stopPopupPolling();
        setProcessingPayment(false);
        try {
          window.localStorage.removeItem(STORAGE_PAYMENT_RESULT_KEY);
        } catch {
          // ignore storage cleanup
        }
        onPaymentSuccess(data.transaction, data.billing || null);
      } else if (data.type === 'PAYMENT_AUTH_ERROR') {
        stopPopupPolling();
        setProcessingPayment(false);
        setStatusNotice({
          type: 'error',
          text: data.message || 'Payment was not completed.',
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      stopPopupPolling();
    };
  }, [open, onPaymentSuccess]);

  const handleRestore = async () => {
    if (restoring || processingPayment) return;
    setRestoring(true);
    try {
      const res = await onRestorePurchase();
      setStatusNotice({ type: res.restored ? 'info' : 'error', text: res.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleContinueCheckout = async () => {
    if (processingPayment) return;
    setStatusNotice(null);
    setProcessingPayment(true);

    const isInIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    let popup: Window | null = null;
    if (isInIframe) {
      popup = window.open('about:blank', 'aicraft_checkout', 'width=480,height=700');
      if (!popup) {
        setProcessingPayment(false);
        setStatusNotice({
          type: 'error',
          text: 'Please allow popups for this site to continue checkout.',
        });
        return;
      }
    }

    try {
      const response = await fetch('/api/payments/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          email: userEmail,
          userId,
        }),
      });

      const data = await safeParseJson<{
        authorizationUrl?: string;
        reference?: string;
        error?: string;
      }>(response);

      if (!response.ok || !data?.authorizationUrl) {
        popup?.close();
        setProcessingPayment(false);
        setStatusNotice({
          type: 'error',
          text:
            data?.error ||
            'Unable to start checkout right now. Please try again shortly.',
        });
        return;
      }

      if (!isInIframe) {
        window.location.assign(data.authorizationUrl);
        return;
      }

      if (popup) {
        popup.location.href = data.authorizationUrl;
        try {
          window.localStorage.removeItem(STORAGE_PAYMENT_RESULT_KEY);
        } catch {
          // ignore cleanup
        }

        stopPopupPolling();
        popupPollRef.current = window.setInterval(() => {
          try {
            const raw = window.localStorage.getItem(STORAGE_PAYMENT_RESULT_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as PaymentTransaction;
              if (parsed?.reference) {
                window.localStorage.removeItem(STORAGE_PAYMENT_RESULT_KEY);
                stopPopupPolling();
                setProcessingPayment(false);
                onPaymentSuccess(parsed);
                return;
              }
            }
          } catch {
            // ignore storage read error
          }

          if (popup && popup.closed) {
            stopPopupPolling();
              if (data.reference) {
              void (async () => {
                try {
                  const verifyRes = await fetch('/api/payments/verify', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(authHeaders || {}),
                    },
                    body: JSON.stringify({ reference: data.reference }),
                  });
                  const verifyData = await safeParseJson<{
                    verified?: boolean;
                    transaction?: PaymentTransaction;
                    billing?: BillingSummary | null;
                  }>(verifyRes);
                  setProcessingPayment(false);
                  if (verifyRes.ok && verifyData?.verified && verifyData.transaction) {
                    onPaymentSuccess(verifyData.transaction, verifyData.billing || null);
                  }
                } catch {
                  setProcessingPayment(false);
                }
              })();
            } else {
              setProcessingPayment(false);
            }
          }
        }, 700);
      }
    } catch (err) {
      popup?.close();
      setProcessingPayment(false);
      setStatusNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Network error while preparing checkout.',
      });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="pro-upgrade-modal"
          role="dialog"
          aria-modal="true"
          aria-label="AI Craft Pro Upgrade"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 h-dvh w-full bg-white overflow-hidden overscroll-none flex flex-col justify-between"
        >
          {/* COMPACT TOP COBALT HEADER */}
          <div className="shrink-0 w-full flex flex-col bg-white">
            <div
              className="relative w-full overflow-hidden pt-safe pb-2"
              style={{
                background: dynamicColorEnabled
                  ? 'linear-gradient(180deg, #0D47EE 0%, #1654F4 46%, #6492FC 78%, #D6E3FE 93%, #FFFFFF 100%)'
                  : 'linear-gradient(180deg, #1048E6 0%, #245EF5 50%, #DCE7FE 90%, #FFFFFF 100%)',
              }}
            >
              {dynamicColorEnabled && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 w-[130%] h-[130px] animate-aura-pulse"
                  style={{
                    background:
                      'radial-gradient(ellipse 65% 70% at 50% 35%, rgba(125, 178, 255, 0.36) 0%, rgba(13, 91, 255, 0) 75%)',
                  }}
                />
              )}

              {/* Top Controls: Close (left) & Restore (right) */}
              <div className="relative z-20 w-full max-w-[440px] mx-auto px-4 pt-0.5 pb-1.5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close upgrade screen"
                  className="w-8 h-8 rounded-full bg-[#09299E]/45 backdrop-blur-md text-white flex items-center justify-center hover:bg-[#09299E]/60 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X className="w-[17px] h-[17px] stroke-[2.4]" />
                </button>

                <button
                  type="button"
                  disabled={restoring || processingPayment}
                  onClick={() => void handleRestore()}
                  className="h-7 px-3 rounded-full bg-[#09299E]/45 backdrop-blur-md text-white text-[12.5px] font-semibold tracking-[-0.01em] hover:bg-[#09299E]/60 active:scale-95 transition-all disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {restoring ? 'Checking...' : 'Restore'}
                </button>
              </div>

              {/* Dual Auto-Scrolling Compact App Tile Rows */}
              <div className="relative z-10 flex flex-col gap-1.5 overflow-hidden select-none">
                <div className="flex w-max animate-marquee-left">
                  {[0, 1].map((dup) => (
                    <div key={dup} className="flex items-center gap-1.5 pr-1.5">
                      {SHOWCASE_ROW_1.map(({ id, Icon, bg }) => (
                        <div
                          key={`${dup}-${id}`}
                          className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center shadow-[0_5px_12px_rgba(9,25,84,0.18)] shrink-0"
                          style={{ background: bg }}
                          aria-hidden="true"
                        >
                          <Icon className="w-[17px] h-[17px] text-white stroke-[2]" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="flex w-max animate-marquee-right">
                  {[0, 1].map((dup) => (
                    <div key={dup} className="flex items-center gap-1.5 pr-1.5">
                      {SHOWCASE_ROW_2.map(({ id, Icon, bg }) => (
                        <div
                          key={`${dup}-${id}`}
                          className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center shadow-[0_5px_12px_rgba(9,25,84,0.14)] shrink-0"
                          style={{ background: bg }}
                          aria-hidden="true"
                        >
                          <Icon className="w-[17px] h-[17px] text-white stroke-[2]" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Soft Bottom White Mist Fade */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-7"
                  style={{
                    background:
                      'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.88) 72%, #FFFFFF 100%)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* NON-SCROLLABLE MIDDLE BODY: Headline, Features & All 4 Plans Completely Visible */}
          <div className="flex-1 min-h-0 w-full max-w-[440px] mx-auto px-5 pt-0.5 pb-1 bg-white overflow-hidden flex flex-col justify-between">
            <div className="shrink-0">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#141418] text-white shadow-[0_3px_10px_rgba(11,11,15,0.14)]">
                  <img
                    src="/logo-mark.png"
                    alt=""
                    className="w-3 h-3 object-contain brightness-200"
                  />
                  <span className="font-display font-bold text-[9.5px] tracking-[0.06em]">
                    AI CRAFT PRO
                  </span>
                </div>

                <span className="text-[11px] font-medium text-[#71717A] tabular-nums">
                  {billing?.dailyLimit
                    ? `${credits.toLocaleString()} left · ${billing.dailyCreditsUsed.toLocaleString()}/${billing.dailyLimit.toLocaleString()} today`
                    : `${credits.toLocaleString()} credits · Free 300/30d`}
                </span>
              </div>

              {statusNotice && (
                <div
                  role={statusNotice.type === 'error' ? 'alert' : 'status'}
                  className={`mb-1.5 rounded-xl px-3 py-1.5 text-[11px] font-medium ${
                    statusNotice.type === 'error'
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-[#EEF4FF] border border-[#0D5BFF]/20 text-[#0B3AC7]'
                  }`}
                >
                  {statusNotice.text}
                </div>
              )}

              <h2 className="font-display font-extrabold text-[21px] sm:text-[23px] leading-[1.05] tracking-[-0.03em] text-[#0B0B0F] mb-2">
                Create <span className="text-[#0D5BFF]">unlimited</span>{' '}
                <br className="hidden xs:inline" />
                AI apps
              </h2>

              <ul className="flex flex-col gap-1">
                {PRO_FEATURES.map(({ id, Icon, label }) => (
                  <li key={id} className="flex items-center gap-2 text-[#0B0B0F]">
                    <span className="w-3.5 h-3.5 flex items-center justify-center text-[#18181B] shrink-0">
                      <Icon className="w-[13px] h-[13px] stroke-[2]" />
                    </span>
                    <span className="text-[12.5px] font-medium tracking-[-0.01em] text-[#111118] leading-snug">
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* ALL 4 PLANS FULLY VISIBLE — ZERO SCROLL */}
            <div
              role="radiogroup"
              aria-label="Choose AI Craft Pro plan"
              className="shrink-0 flex flex-col gap-1.5 pt-2 pb-1"
            >
              {PRO_PLANS.map((plan) => {
                const isSelected = selectedPlanId === plan.id;
                const isCurrent = activePlanId === plan.id;

                return (
                  <button
                    key={plan.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={processingPayment}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`relative w-full text-left rounded-[13px] px-3 py-2 flex items-center justify-between gap-2 transition-all duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5BFF] ${
                      isSelected
                        ? 'border-2 border-[#0D5BFF] bg-[#F5F8FF] shadow-[0_3px_12px_rgba(13,91,255,0.08)]'
                        : 'border-[1.5px] border-[#E4E4E7] bg-white hover:border-[#C7D2FE]'
                    }`}
                  >
                    {plan.badgeText && (
                      <span className="absolute -top-2 right-3 px-2 py-[0.5px] rounded-full bg-[#0D5BFF] text-white text-[8.5px] font-display font-bold tracking-[0.04em]">
                        {plan.badgeText}
                      </span>
                    )}

                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-[17px] h-[17px] rounded-full flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#0D5BFF] border-2 border-[#0D5BFF]'
                            : 'bg-white border-2 border-[#D4D4D8]'
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </span>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-display font-bold text-[13.5px] text-[#0B0B0F] leading-tight">
                            {plan.name}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-semibold text-[#0D5BFF]">
                              · Active
                            </span>
                          )}
                        </div>
                        <p className="text-[10.5px] text-[#71717A] leading-tight mt-0.5 truncate">
                          {plan.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-display font-bold text-[13.5px] text-[#0B0B0F] tabular-nums leading-tight">
                        {plan.priceText}
                      </div>
                      <div className="text-[10px] text-[#71717A] leading-tight mt-0.5">
                        {plan.cadenceText}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CLEAN WHITE GROUND FOOTER: Continue Button Standing Completely on White Board */}
          <div className="shrink-0 w-full bg-white pt-1.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <div className="w-full max-w-[440px] mx-auto px-5 flex flex-col items-center">
              <button
                type="button"
                disabled={processingPayment}
                onClick={() => void handleContinueCheckout()}
                className="w-full h-[46px] rounded-full bg-[#0D5BFF] hover:bg-[#094EE0] active:scale-[0.98] text-white font-display font-bold text-[15px] tracking-[-0.01em] shadow-[0_6px_18px_rgba(13,91,255,0.22)] flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5BFF] focus-visible:ring-offset-2"
              >
                {processingPayment ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Starting checkout…</span>
                  </>
                ) : (
                  <span>Continue</span>
                )}
              </button>

              <div className="mt-1.5 flex flex-col items-center gap-0.5">
                <p className="text-[10.5px] text-[#71717A] text-center">
                  Auto-renews · Cancel anytime
                </p>
                <div className="flex items-center justify-center gap-5 text-[10.5px] text-[#71717A]">
                  <button
                    type="button"
                    onClick={() =>
                      setLegalSheet((prev) => (prev === 'terms' ? null : 'terms'))
                    }
                    className="hover:text-[#0B0B0F] transition-colors"
                  >
                    Terms
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLegalSheet((prev) => (prev === 'privacy' ? null : 'privacy'))
                    }
                    className="hover:text-[#0B0B0F] transition-colors"
                  >
                    Privacy
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Optional Terms / Privacy Popover (never clips plan cards) */}
          {legalSheet && (
            <div
              role="dialog"
              aria-label={legalSheet === 'terms' ? 'Terms' : 'Privacy'}
              className="fixed inset-x-4 bottom-24 z-30 max-w-[408px] mx-auto rounded-2xl border border-black/10 bg-white p-3.5 shadow-[0_14px_34px_rgba(11,11,15,0.16)] text-[11.5px] text-[#52525B] leading-relaxed flex items-start justify-between gap-2.5"
            >
              <p>
                {legalSheet === 'terms'
                  ? 'AI Craft Pro plans renew per selected billing cycle (Monthly or Annual) and can be managed or cancelled anytime from Profile.'
                  : 'AI Craft stores your plan status, transaction receipts, and projects securely without exposing private credentials.'}
              </p>
              <button
                type="button"
                onClick={() => setLegalSheet(null)}
                aria-label="Close legal notice"
                className="text-[#71717A] hover:text-[#0B0B0F] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
