import crypto from 'node:crypto';

export type SubscriptionTier = 'free' | 'starter' | 'plus' | 'studio' | 'annual';
export type PaidTierId = 'starter' | 'plus' | 'studio' | 'annual';

export interface BillingPlanConfig {
  id: SubscriptionTier;
  name: string;
  amountKobo: number;
  amountNgn: number;
  dailyLimit: number | null;
  monthlyCredits: number;
  annualCycles: number; // total 30-day cycles covered (1 for monthly, 12 for annual)
  cadenceText: string;
}

export interface PaymentTransactionRecord {
  id: string;
  reference: string;
  planId: PaidTierId;
  planName: string;
  amountNgn: number;
  amountKobo: number;
  creditsToAdd: number;
  status: 'paid' | 'pending' | 'failed';
  paidAt: string;
  channel: string;
  email: string;
  userId?: string;
}

export const FREE_TIER_CONFIG: BillingPlanConfig = {
  id: 'free',
  name: 'Free',
  amountKobo: 0,
  amountNgn: 0,
  dailyLimit: null,
  monthlyCredits: 300,
  annualCycles: 1,
  cadenceText: 'every 30 days',
};

export const BILLING_PLANS: Record<PaidTierId, BillingPlanConfig> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    amountKobo: 2500000,
    amountNgn: 25000,
    dailyLimit: 1500,
    monthlyCredits: 45000,
    annualCycles: 1,
    cadenceText: 'per month',
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    amountKobo: 4800000,
    amountNgn: 48000,
    dailyLimit: 3500,
    monthlyCredits: 105000,
    annualCycles: 1,
    cadenceText: 'per month',
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    amountKobo: 7000000,
    amountNgn: 70000,
    dailyLimit: 6000,
    monthlyCredits: 180000,
    annualCycles: 1,
    cadenceText: 'per month',
  },
  annual: {
    id: 'annual',
    name: 'Annual',
    amountKobo: 80000000,
    amountNgn: 800000,
    dailyLimit: 8000,
    monthlyCredits: 240000,
    annualCycles: 12,
    cadenceText: 'per year',
  },
};

export function getPlanConfig(tier: string | null | undefined): BillingPlanConfig {
  const clean = (tier || '').trim().toLowerCase();
  if (
    clean === 'starter' ||
    clean === 'plus' ||
    clean === 'studio' ||
    clean === 'annual'
  ) {
    return BILLING_PLANS[clean];
  }
  return FREE_TIER_CONFIG;
}

const PAYSTACK_API_BASE = 'https://api.paystack.co';

function cleanSecret(raw: string | undefined, placeholders: string[]): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^bearer\s+/i, '').trim();
  }
  if (!cleaned || placeholders.includes(cleaned)) return '';
  return cleaned;
}

export function getPaymentSecretKey(): string {
  const candidates = [
    process.env.PAYSTACK_SECRET_KEY,
    process.env.PAYSTACK_SECRET,
    process.env.PAYSTACK_API_KEY,
    process.env.PAYSTACK_LIVE_SECRET_KEY,
    process.env.PAYSTACK_TEST_SECRET_KEY,
    process.env.PAYMENT_SECRET_KEY,
    process.env.BILLING_SECRET_KEY,
  ];
  for (const raw of candidates) {
    const cleaned = cleanSecret(raw, [
      'MY_PAYSTACK_SECRET_KEY',
      'MY_PAYMENT_SECRET_KEY',
    ]);
    if (cleaned) return cleaned;
  }
  return '';
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  const secretKey = getPaymentSecretKey();
  if (!secretKey || !signatureHeader) return false;

  const expected = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8');
  const expBuf = Buffer.from(expected.toLowerCase(), 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export function resolvePlanFromMetadataOrAmount(
  metadata: unknown,
  amountKobo: number
): BillingPlanConfig & { id: PaidTierId } {
  const meta =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : {};
  const rawPlanId =
    typeof meta.planId === 'string' ? meta.planId.trim().toLowerCase() : '';
  if (
    rawPlanId === 'starter' ||
    rawPlanId === 'plus' ||
    rawPlanId === 'studio' ||
    rawPlanId === 'annual'
  ) {
    return BILLING_PLANS[rawPlanId] as BillingPlanConfig & { id: PaidTierId };
  }

  const byAmount = (Object.values(BILLING_PLANS) as Array<BillingPlanConfig & { id: PaidTierId }>).find(
    (p) => p.amountKobo === amountKobo
  );
  return byAmount ?? (BILLING_PLANS.starter as BillingPlanConfig & { id: PaidTierId });
}

export async function initializeCheckoutSession(params: {
  planId: string;
  email: string;
  userId?: string;
  callbackUrl: string;
}): Promise<
  | {
      ok: true;
      authorizationUrl: string;
      reference: string;
      plan: BillingPlanConfig;
    }
  | { ok: false; status: number; error: string }
> {
  const secretKey = getPaymentSecretKey();
  if (!secretKey) {
    return {
      ok: false,
      status: 503,
      error:
        'Payment service secret key is not configured in backend environment variables.',
    };
  }

  const cleanPlanId = params.planId.trim().toLowerCase();
  if (
    cleanPlanId !== 'starter' &&
    cleanPlanId !== 'plus' &&
    cleanPlanId !== 'studio' &&
    cleanPlanId !== 'annual'
  ) {
    return { ok: false, status: 400, error: 'Please select a valid plan.' };
  }

  const plan = BILLING_PLANS[cleanPlanId];
  const email = params.email.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      status: 400,
      error: 'A valid account email is required to start checkout.',
    };
  }

  try {
    const res = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: plan.amountKobo,
        currency: 'NGN',
        callback_url: params.callbackUrl,
        metadata: {
          planId: plan.id,
          planName: plan.name,
          creditsToAdd: plan.monthlyCredits,
          dailyLimit: plan.dailyLimit,
          userId: params.userId || '',
        },
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    };

    if (!res.ok || !payload.status || !payload.data?.authorization_url) {
      return {
        ok: false,
        status: res.status >= 400 ? res.status : 400,
        error: payload.message || 'Unable to start checkout right now.',
      };
    }

    return {
      ok: true,
      authorizationUrl: payload.data.authorization_url,
      reference: payload.data.reference || '',
      plan,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error:
        err instanceof Error ? err.message : 'Unable to reach checkout gateway.',
    };
  }
}

export async function verifyCheckoutTransaction(reference: string): Promise<
  | {
      ok: true;
      verified: boolean;
      transaction: PaymentTransactionRecord;
    }
  | { ok: false; status: number; error: string }
> {
  const secretKey = getPaymentSecretKey();
  if (!secretKey) {
    return {
      ok: false,
      status: 503,
      error:
        'Payment service secret key is not configured in backend environment variables.',
    };
  }

  const cleanRef = reference.trim();
  if (!cleanRef) {
    return { ok: false, status: 400, error: 'Missing payment reference.' };
  }

  try {
    const res = await fetch(
      `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(cleanRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    const payload = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        id?: number | string;
        status?: string;
        reference?: string;
        amount?: number;
        paid_at?: string;
        created_at?: string;
        channel?: string;
        customer?: { email?: string };
        metadata?: { userId?: string; [key: string]: unknown };
      };
    };

    if (!res.ok || !payload.status || !payload.data) {
      return {
        ok: false,
        status: res.status >= 400 ? res.status : 400,
        error: payload.message || 'Unable to verify payment status.',
      };
    }

    const tx = payload.data;
    const amountKobo = Number(tx.amount || 0);
    const plan = resolvePlanFromMetadataOrAmount(tx.metadata, amountKobo);
    const isPaid = tx.status === 'success' && amountKobo >= plan.amountKobo;
    const metaUserId =
      tx.metadata && typeof tx.metadata === 'object' && typeof tx.metadata.userId === 'string'
        ? tx.metadata.userId
        : undefined;

    return {
      ok: true,
      verified: isPaid,
      transaction: {
        id: String(tx.id ?? cleanRef),
        reference: tx.reference || cleanRef,
        planId: plan.id,
        planName: plan.name,
        amountNgn: Math.round(amountKobo / 100),
        amountKobo,
        creditsToAdd: plan.monthlyCredits,
        status:
          tx.status === 'success'
            ? 'paid'
            : tx.status === 'failed' || tx.status === 'abandoned'
              ? 'failed'
              : 'pending',
        paidAt: tx.paid_at || tx.created_at || new Date().toISOString(),
        channel: tx.channel || 'card',
        email: tx.customer?.email || '',
        userId: metaUserId,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error:
        err instanceof Error ? err.message : 'Unable to verify payment right now.',
    };
  }
}

export async function listCustomerTransactions(email: string): Promise<{
  configured: boolean;
  transactions: PaymentTransactionRecord[];
}> {
  const secretKey = getPaymentSecretKey();
  if (!secretKey) {
    return { configured: false, transactions: [] };
  }

  try {
    const res = await fetch(`${PAYSTACK_API_BASE}/transaction?perPage=50`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });
    if (!res.ok) {
      return { configured: true, transactions: [] };
    }

    const payload = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      data?: Array<{
        id?: number | string;
        status?: string;
        reference?: string;
        amount?: number;
        paid_at?: string;
        created_at?: string;
        channel?: string;
        customer?: { email?: string };
        metadata?: { userId?: string; [key: string]: unknown };
      }>;
    };

    const rawList = Array.isArray(payload.data) ? payload.data : [];
    const targetEmail = email.trim().toLowerCase();

    const filtered = rawList.filter((item) => {
      if (!targetEmail) return true;
      return (item.customer?.email || '').trim().toLowerCase() === targetEmail;
    });

    const transactions: PaymentTransactionRecord[] = filtered.map((tx) => {
      const amountKobo = Number(tx.amount || 0);
      const plan = resolvePlanFromMetadataOrAmount(tx.metadata, amountKobo);
      const metaUserId =
        tx.metadata && typeof tx.metadata === 'object' && typeof tx.metadata.userId === 'string'
          ? tx.metadata.userId
          : undefined;

      return {
        id: String(tx.id ?? tx.reference ?? ''),
        reference: tx.reference || '',
        planId: plan.id,
        planName: plan.name,
        amountNgn: Math.round(amountKobo / 100),
        amountKobo,
        creditsToAdd: plan.monthlyCredits,
        status:
          tx.status === 'success'
            ? 'paid'
            : tx.status === 'failed' || tx.status === 'abandoned'
              ? 'failed'
              : 'pending',
        paidAt: tx.paid_at || tx.created_at || new Date().toISOString(),
        channel: tx.channel || 'card',
        email: tx.customer?.email || '',
        userId: metaUserId,
      };
    });

    return { configured: true, transactions };
  } catch {
    return { configured: true, transactions: [] };
  }
}

export function buildPaymentCallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Craft — Confirming Upgrade</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #ffffff;
        color: #0b0b0f;
        padding: 24px;
        text-align: center;
      }
      .card { max-width: 340px; }
      h1 { font-size: 18px; margin: 0 0 8px; font-weight: 700; }
      p { font-size: 14px; color: #52525b; margin: 0; line-height: 1.45; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 id="title">Confirming payment…</h1>
      <p id="status">Activating your AI Craft Pro plan.</p>
    </div>
    <script>
      (async function () {
        var titleEl = document.getElementById('title');
        var statusEl = document.getElementById('status');
        try {
          var params = new URLSearchParams(window.location.search || '');
          var reference = params.get('reference') || params.get('trxref') || '';
          var cancelled = params.get('cancelled');

          if (cancelled === '1' || !reference) {
            var cancelMsg = 'Payment was not completed.';
            titleEl.textContent = 'Payment canceled';
            statusEl.textContent = cancelMsg;
            if (window.opener) {
              window.opener.postMessage({ type: 'PAYMENT_AUTH_ERROR', message: cancelMsg }, '*');
              setTimeout(function () { window.close(); }, 1200);
            } else {
              setTimeout(function () {
                window.location.replace('/?payment_error=' + encodeURIComponent(cancelMsg));
              }, 700);
            }
            return;
          }

          var res = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: reference })
          });
          var rawText = await res.text();
          var payload = {};
          try { payload = rawText ? JSON.parse(rawText) : {}; } catch (e) {}

          if (!res.ok || !payload.verified || !payload.transaction) {
            throw new Error(payload.error || 'Payment could not be verified.');
          }

          try {
            localStorage.setItem('aicraft_payment_result_v1', JSON.stringify(payload.transaction));
          } catch (e) {}

          if (window.opener) {
            window.opener.postMessage(
              {
                type: 'PAYMENT_AUTH_SUCCESS',
                transaction: payload.transaction,
                billing: payload.billing || null
              },
              '*'
            );
            window.close();
          } else {
            window.location.replace('/?payment_ref=' + encodeURIComponent(payload.transaction.reference));
          }
        } catch (err) {
          var msg = err && err.message ? err.message : 'Unable to confirm payment.';
          titleEl.textContent = 'Payment issue';
          statusEl.textContent = msg;
          if (window.opener) {
            window.opener.postMessage({ type: 'PAYMENT_AUTH_ERROR', message: msg }, '*');
          } else {
            setTimeout(function () {
              window.location.replace('/?payment_error=' + encodeURIComponent(msg));
            }, 900);
          }
        }
      })();
    </script>
  </body>
</html>`;
}
