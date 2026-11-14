import { createClient, type User as SupabaseUser } from '@supabase/supabase-js';
import {
  BILLING_PLANS,
  FREE_TIER_CONFIG,
  PaymentTransactionRecord,
  SubscriptionTier,
  getPlanConfig,
  listCustomerTransactions,
} from './_paystack.js';
import {
  SB_ACCESS_COOKIE,
  SB_REFRESH_COOKIE,
  getSupabaseConfig,
  parseCookies,
} from './_supabaseAuth.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const WORKSPACE_BUCKET = 'aicraft-user-data';

export interface BillingAccountState {
  tier: SubscriptionTier;
  dailyCreditsUsed: number;
  dailyResetAt: string;
  monthlyCreditsRemaining: number;
  monthlyResetAt: string;
  annualCyclesRemaining: number;
  subscriptionExpiresAt: string | null;
  creditedRefs: string[];
  updatedAt: string;
}

export interface BillingSummaryPayload {
  tier: SubscriptionTier;
  planName: string;
  dailyCreditsUsed: number;
  dailyLimit: number | null;
  dailyResetAt: string;
  monthlyCreditsRemaining: number;
  monthlyLimit: number;
  monthlyResetAt: string;
  annualCyclesRemaining: number;
  subscriptionExpiresAt: string | null;
}

export function createInitialFreeBillingState(
  nowMs = Date.now(),
  creditedRefs: string[] = []
): BillingAccountState {
  return {
    tier: 'free',
    dailyCreditsUsed: 0,
    dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
    monthlyCreditsRemaining: FREE_TIER_CONFIG.monthlyCredits,
    monthlyResetAt: new Date(nowMs + MONTH_MS).toISOString(),
    annualCyclesRemaining: 0,
    subscriptionExpiresAt: null,
    creditedRefs: creditedRefs.slice(0, 25),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function parseRawBillingState(
  raw: unknown,
  nowMs = Date.now()
): { state: BillingAccountState; initialized: boolean } {
  if (!raw || typeof raw !== 'object') {
    return { state: createInitialFreeBillingState(nowMs), initialized: false };
  }

  const obj = raw as Record<string, unknown>;
  const rawTier = typeof obj.tier === 'string' ? obj.tier.trim().toLowerCase() : 'free';
  const tier: SubscriptionTier =
    rawTier === 'starter' ||
    rawTier === 'plus' ||
    rawTier === 'studio' ||
    rawTier === 'annual'
      ? rawTier
      : 'free';

  const plan = getPlanConfig(tier);
  const dailyCreditsUsed =
    typeof obj.dailyCreditsUsed === 'number' && Number.isFinite(obj.dailyCreditsUsed)
      ? Math.max(0, Math.floor(obj.dailyCreditsUsed))
      : 0;
  const dailyResetMs =
    typeof obj.dailyResetAt === 'string' && !Number.isNaN(Date.parse(obj.dailyResetAt))
      ? Date.parse(obj.dailyResetAt)
      : nowMs + DAY_MS;

  const monthlyCreditsRemaining =
    typeof obj.monthlyCreditsRemaining === 'number' &&
    Number.isFinite(obj.monthlyCreditsRemaining)
      ? Math.max(0, Math.floor(obj.monthlyCreditsRemaining))
      : plan.monthlyCredits;
  const monthlyResetMs =
    typeof obj.monthlyResetAt === 'string' && !Number.isNaN(Date.parse(obj.monthlyResetAt))
      ? Date.parse(obj.monthlyResetAt)
      : nowMs + MONTH_MS;

  const annualCyclesRemaining =
    typeof obj.annualCyclesRemaining === 'number' &&
    Number.isFinite(obj.annualCyclesRemaining)
      ? Math.max(0, Math.min(11, Math.floor(obj.annualCyclesRemaining)))
      : tier === 'annual'
        ? 11
        : 0;

  const subscriptionExpiresAt =
    typeof obj.subscriptionExpiresAt === 'string' &&
    !Number.isNaN(Date.parse(obj.subscriptionExpiresAt))
      ? obj.subscriptionExpiresAt
      : null;

  const creditedRefs = Array.isArray(obj.creditedRefs)
    ? obj.creditedRefs.filter((r): r is string => typeof r === 'string').slice(0, 25)
    : [];

  return {
    initialized: true,
    state: {
      tier,
      dailyCreditsUsed,
      dailyResetAt: new Date(dailyResetMs).toISOString(),
      monthlyCreditsRemaining,
      monthlyResetAt: new Date(monthlyResetMs).toISOString(),
      annualCyclesRemaining,
      subscriptionExpiresAt,
      creditedRefs,
      updatedAt:
        typeof obj.updatedAt === 'string'
          ? obj.updatedAt
          : new Date(nowMs).toISOString(),
    },
  };
}

/**
 * Enforces 24h daily reset and 30-day cycle reset with ZERO rollover.
 */
export function normalizeBillingState(
  input: BillingAccountState,
  nowMs = Date.now()
): { state: BillingAccountState; changed: boolean } {
  let state: BillingAccountState = { ...input };
  let changed = false;

  const monthlyResetMs = Date.parse(state.monthlyResetAt);
  const dailyResetMs = Date.parse(state.dailyResetAt);
  const expiresMs = state.subscriptionExpiresAt
    ? Date.parse(state.subscriptionExpiresAt)
    : null;

  if (Number.isNaN(monthlyResetMs) || nowMs >= monthlyResetMs) {
    changed = true;
    const baseMonthly = Number.isNaN(monthlyResetMs) ? nowMs : monthlyResetMs;
    const cyclesElapsed = Math.max(
      1,
      Math.floor((nowMs - baseMonthly) / MONTH_MS) + 1
    );

    if (state.tier === 'free') {
      state = {
        ...state,
        tier: 'free',
        dailyCreditsUsed: 0,
        dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
        monthlyCreditsRemaining: FREE_TIER_CONFIG.monthlyCredits,
        monthlyResetAt: new Date(baseMonthly + cyclesElapsed * MONTH_MS).toISOString(),
        annualCyclesRemaining: 0,
        subscriptionExpiresAt: null,
        updatedAt: new Date(nowMs).toISOString(),
      };
    } else if (state.tier === 'annual') {
      const withinYear = expiresMs === null || nowMs < expiresMs;
      if (withinYear && state.annualCyclesRemaining >= cyclesElapsed) {
        state = {
          ...state,
          tier: 'annual',
          dailyCreditsUsed: 0,
          dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
          monthlyCreditsRemaining: BILLING_PLANS.annual.monthlyCredits,
          monthlyResetAt: new Date(baseMonthly + cyclesElapsed * MONTH_MS).toISOString(),
          annualCyclesRemaining: state.annualCyclesRemaining - cyclesElapsed,
          updatedAt: new Date(nowMs).toISOString(),
        };
      } else {
        // Annual 12 cycles / 365 days completed without renewal -> revert to Free
        state = {
          ...state,
          tier: 'free',
          dailyCreditsUsed: 0,
          dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
          monthlyCreditsRemaining: FREE_TIER_CONFIG.monthlyCredits,
          monthlyResetAt: new Date(nowMs + MONTH_MS).toISOString(),
          annualCyclesRemaining: 0,
          subscriptionExpiresAt: null,
          updatedAt: new Date(nowMs).toISOString(),
        };
      }
    } else {
      // Monthly paid tier (starter, plus, studio): revert to Free on cycle expiry unless renewed
      if (expiresMs !== null && nowMs < expiresMs) {
        const plan = getPlanConfig(state.tier);
        state = {
          ...state,
          dailyCreditsUsed: 0,
          dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
          monthlyCreditsRemaining: plan.monthlyCredits,
          monthlyResetAt: new Date(baseMonthly + cyclesElapsed * MONTH_MS).toISOString(),
          updatedAt: new Date(nowMs).toISOString(),
        };
      } else {
        state = {
          ...state,
          tier: 'free',
          dailyCreditsUsed: 0,
          dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
          monthlyCreditsRemaining: FREE_TIER_CONFIG.monthlyCredits,
          monthlyResetAt: new Date(nowMs + MONTH_MS).toISOString(),
          annualCyclesRemaining: 0,
          subscriptionExpiresAt: null,
          updatedAt: new Date(nowMs).toISOString(),
        };
      }
    }
  } else if (Number.isNaN(dailyResetMs) || nowMs >= dailyResetMs) {
    changed = true;
    const baseDaily = Number.isNaN(dailyResetMs) ? nowMs : dailyResetMs;
    const daysElapsed = Math.max(1, Math.floor((nowMs - baseDaily) / DAY_MS) + 1);
    state = {
      ...state,
      dailyCreditsUsed: 0,
      dailyResetAt: new Date(baseDaily + daysElapsed * DAY_MS).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  return { state, changed };
}

export function applyPaidUpgradeToState(
  input: BillingAccountState,
  tx: PaymentTransactionRecord,
  nowMs = Date.now()
): { state: BillingAccountState; applied: boolean } {
  if (tx.status !== 'paid' || !tx.reference) {
    return { state: input, applied: false };
  }
  if (input.creditedRefs.includes(tx.reference)) {
    return { state: input, applied: false };
  }

  const plan = BILLING_PLANS[tx.planId];
  const paidMs = Date.parse(tx.paidAt);
  const effectiveNow = !Number.isNaN(paidMs) && paidMs <= nowMs ? paidMs : nowMs;
  const durationMs = tx.planId === 'annual' ? YEAR_MS : MONTH_MS;

  // If the payment happened in a past expired period, normalize after setting
  const upgradedRaw: BillingAccountState = {
    tier: plan.id,
    dailyCreditsUsed: 0,
    dailyResetAt: new Date(nowMs + DAY_MS).toISOString(),
    monthlyCreditsRemaining: plan.monthlyCredits,
    monthlyResetAt: new Date(effectiveNow + MONTH_MS).toISOString(),
    annualCyclesRemaining: tx.planId === 'annual' ? 11 : 0,
    subscriptionExpiresAt: new Date(effectiveNow + durationMs).toISOString(),
    creditedRefs: [tx.reference, ...input.creditedRefs].slice(0, 25),
    updatedAt: new Date(nowMs).toISOString(),
  };

  const normalized = normalizeBillingState(upgradedRaw, nowMs);
  return { state: normalized.state, applied: true };
}

export function consumeBillingCredit(
  input: BillingAccountState,
  amount = 1,
  nowMs = Date.now()
): {
  allowed: boolean;
  code?: 'DAILY_LIMIT_REACHED' | 'MONTHLY_LIMIT_REACHED';
  error?: string;
  state: BillingAccountState;
} {
  const { state } = normalizeBillingState(input, nowMs);
  const plan = getPlanConfig(state.tier);

  if (state.monthlyCreditsRemaining < amount) {
    return {
      allowed: false,
      code: 'MONTHLY_LIMIT_REACHED',
      error:
        state.tier === 'free'
          ? 'You have used all 300 free credits for this 30-day cycle. Upgrade to a paid plan or wait for your monthly refresh.'
          : `You have reached your ${plan.monthlyCredits.toLocaleString()} monthly credit cap on ${plan.name}. Wait for your 30-day cycle refresh or upgrade your plan.`,
      state,
    };
  }

  if (plan.dailyLimit !== null && state.dailyCreditsUsed + amount > plan.dailyLimit) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT_REACHED',
      error: `Daily limit reached (${plan.dailyLimit.toLocaleString()} credits/day on ${plan.name}). Unused daily credits reset every 24 hours.`,
      state,
    };
  }

  const nextState: BillingAccountState = {
    ...state,
    dailyCreditsUsed: state.dailyCreditsUsed + amount,
    monthlyCreditsRemaining: Math.max(0, state.monthlyCreditsRemaining - amount),
    updatedAt: new Date(nowMs).toISOString(),
  };

  return { allowed: true, state: nextState };
}

export function serializeBillingSummary(
  state: BillingAccountState
): BillingSummaryPayload {
  const plan = getPlanConfig(state.tier);
  return {
    tier: state.tier,
    planName: plan.name,
    dailyCreditsUsed: state.dailyCreditsUsed,
    dailyLimit: plan.dailyLimit,
    dailyResetAt: state.dailyResetAt,
    monthlyCreditsRemaining: state.monthlyCreditsRemaining,
    monthlyLimit: plan.monthlyCredits,
    monthlyResetAt: state.monthlyResetAt,
    annualCyclesRemaining: state.annualCyclesRemaining,
    subscriptionExpiresAt: state.subscriptionExpiresAt,
  };
}

export function createSupabaseServiceClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createSupabaseUserClient(accessToken: string, refreshToken?: string) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function extractAuthTokensFromRequest(request: Request): {
  accessToken: string;
  refreshToken: string;
} {
  const cookies = parseCookies(request.headers.get('cookie'));
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = /^bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^bearer\s+/i, '').trim()
    : '';
  const accessToken = bearerToken || cookies[SB_ACCESS_COOKIE] || '';
  const refreshToken =
    request.headers.get('x-refresh-token')?.trim() ||
    cookies[SB_REFRESH_COOKIE] ||
    '';
  return { accessToken, refreshToken };
}

export async function getAuthenticatedSupabaseUser(
  accessToken: string,
  refreshToken?: string
): Promise<{
  user: SupabaseUser | null;
  accessToken: string;
  refreshToken?: string;
}> {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey || (!accessToken && !refreshToken)) {
    return { user: null, accessToken };
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (accessToken) {
    const { data, error } = await client.auth.getUser(accessToken);
    if (!error && data.user) {
      return { user: data.user, accessToken, refreshToken };
    }
  }

  if (refreshToken) {
    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (!error && data.session && data.user) {
      return {
        user: data.user,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    }
  }

  return { user: null, accessToken };
}

export async function saveUserBillingState(params: {
  user: SupabaseUser;
  state: BillingAccountState;
  accessToken?: string;
  refreshToken?: string;
}): Promise<boolean> {
  const existingMeta = (params.user.user_metadata ?? {}) as Record<string, unknown>;
  const adminClient = createSupabaseServiceClient();

  if (adminClient) {
    const { error } = await adminClient.auth.admin.updateUserById(params.user.id, {
      user_metadata: {
        ...existingMeta,
        aicraft_billing: params.state,
      },
    });
    if (!error) return true;
  }

  if (params.accessToken) {
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey) {
      const userClient = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: {
          headers: { Authorization: `Bearer ${params.accessToken}` },
        },
      });
      if (params.refreshToken) {
        await userClient.auth.setSession({
          access_token: params.accessToken,
          refresh_token: params.refreshToken,
        });
      }
      const { error } = await userClient.auth.updateUser({
        data: { aicraft_billing: params.state },
      });
      if (!error) return true;
    }
  }

  return false;
}

export async function reconcileAndLoadBillingState(params: {
  user: SupabaseUser;
  accessToken?: string;
  refreshToken?: string;
  checkPaystack?: boolean;
}): Promise<BillingAccountState> {
  const nowMs = Date.now();
  const meta = (params.user.user_metadata ?? {}) as Record<string, unknown>;
  const parsed = parseRawBillingState(meta.aicraft_billing, nowMs);
  let { state, changed } = normalizeBillingState(parsed.state, nowMs);

  if (!parsed.initialized) {
    changed = true;
  }

  // Automatically detect any paid Paystack transactions for this user's email
  if (params.checkPaystack !== false && params.user.email) {
    try {
      const txList = await listCustomerTransactions(params.user.email);
      const paidTxs = txList.transactions
        .filter((t) => t.status === 'paid')
        .sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());

      for (const tx of paidTxs) {
        const upgradeRes = applyPaidUpgradeToState(state, tx, nowMs);
        if (upgradeRes.applied) {
          state = upgradeRes.state;
          changed = true;
        }
      }
    } catch {
      // ignore transient Paystack network error during reconciliation
    }
  }

  if (changed) {
    await saveUserBillingState({
      user: params.user,
      state,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
    });
  }

  return state;
}

export async function findUserByIdOrEmail(
  userId?: string,
  email?: string
): Promise<SupabaseUser | null> {
  const adminClient = createSupabaseServiceClient();
  if (!adminClient) return null;

  if (userId) {
    const { data, error } = await adminClient.auth.admin.getUserById(userId);
    if (!error && data.user) return data.user;
  }

  const targetEmail = (email || '').trim().toLowerCase();
  if (targetEmail) {
    let page = 1;
    while (page <= 10) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error || !data?.users?.length) break;
      const found = data.users.find(
        (u) => (u.email || '').trim().toLowerCase() === targetEmail
      );
      if (found) return found;
      if (data.users.length < 200) break;
      page += 1;
    }
  }

  return null;
}

export async function upgradeUserAccountFromTransaction(params: {
  tx: PaymentTransactionRecord;
  authenticatedUser?: SupabaseUser | null;
  accessToken?: string;
  refreshToken?: string;
}): Promise<BillingAccountState | null> {
  const nowMs = Date.now();
  let targetUser = params.authenticatedUser ?? null;

  if (!targetUser) {
    targetUser = await findUserByIdOrEmail(params.tx.userId, params.tx.email);
  }

  if (!targetUser) return null;

  const meta = (targetUser.user_metadata ?? {}) as Record<string, unknown>;
  const parsed = parseRawBillingState(meta.aicraft_billing, nowMs);
  const normalized = normalizeBillingState(parsed.state, nowMs);
  const upgraded = applyPaidUpgradeToState(normalized.state, params.tx, nowMs);

  if (upgraded.applied || !parsed.initialized || normalized.changed) {
    await saveUserBillingState({
      user: targetUser,
      state: upgraded.state,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
    });
  }

  return upgraded.state;
}

export const BYTES_PER_BUILD_CREDIT = 1350;
export const MAX_CREDITS_PER_BUILD = 35;

export function calculateBuildCreditsForBytes(bytesBuilt: number): number {
  if (!Number.isFinite(bytesBuilt) || bytesBuilt <= 0) return 0;
  return Math.min(
    MAX_CREDITS_PER_BUILD,
    Math.max(1, Math.floor(bytesBuilt / BYTES_PER_BUILD_CREDIT) + 1)
  );
}

export function getAvailableCreditsBudget(
  input: BillingAccountState,
  nowMs = Date.now()
): number {
  const { state } = normalizeBillingState(input, nowMs);
  const plan = getPlanConfig(state.tier);
  const dailyHeadroom =
    plan.dailyLimit !== null
      ? Math.max(0, plan.dailyLimit - state.dailyCreditsUsed)
      : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(state.monthlyCreditsRemaining, dailyHeadroom));
}

export function getCreditExhaustionInfo(
  input: BillingAccountState,
  nowMs = Date.now()
): {
  code: 'DAILY_LIMIT_REACHED' | 'MONTHLY_LIMIT_REACHED';
  error: string;
} {
  const { state } = normalizeBillingState(input, nowMs);
  const plan = getPlanConfig(state.tier);
  if (state.monthlyCreditsRemaining <= 0) {
    return {
      code: 'MONTHLY_LIMIT_REACHED',
      error:
        state.tier === 'free'
          ? 'Your 300 free credits for this 30-day cycle have finished. Building is paused until your monthly refresh or plan upgrade.'
          : `All ${plan.monthlyCredits.toLocaleString()} credits for this 30-day cycle on ${plan.name} are used up. Building is paused until your cycle resets or you upgrade.`,
    };
  }
  return {
    code: 'DAILY_LIMIT_REACHED',
    error: `Daily limit reached (${(plan.dailyLimit ?? 0).toLocaleString()} credits/day on ${plan.name}). Building is paused until your 24-hour reset or plan upgrade.`,
  };
}

export interface VerifiedGenerationContext {
  user: SupabaseUser;
  accessToken: string;
  refreshToken?: string;
  state: BillingAccountState;
}

export async function verifyUserCanGenerate(
  request: Request
): Promise<
  | {
      allowed: true;
      context: VerifiedGenerationContext | null;
      billing: BillingSummaryPayload | null;
      creditBudget: number | null;
    }
  | {
      allowed: false;
      status: number;
      code: string;
      error: string;
      billing: BillingSummaryPayload;
    }
> {
  const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
  if (!accessToken && !refreshToken) {
    return { allowed: true, context: null, billing: null, creditBudget: null };
  }

  const auth = await getAuthenticatedSupabaseUser(accessToken, refreshToken);
  if (!auth.user) {
    return { allowed: true, context: null, billing: null, creditBudget: null };
  }

  const current = await reconcileAndLoadBillingState({
    user: auth.user,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    checkPaystack: false,
  });

  const check = consumeBillingCredit(current, 1, Date.now());
  if (!check.allowed) {
    return {
      allowed: false,
      status: 402,
      code: check.code || 'LIMIT_REACHED',
      error: check.error || 'Credit limit reached.',
      billing: serializeBillingSummary(check.state),
    };
  }

  return {
    allowed: true,
    context: {
      user: auth.user,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      state: current,
    },
    billing: serializeBillingSummary(current),
    creditBudget: getAvailableCreditsBudget(current, Date.now()),
  };
}

export async function commitGenerationCredits(
  context: VerifiedGenerationContext | null,
  rawAmount: number
): Promise<BillingSummaryPayload | null> {
  if (!context) return null;
  const amount = Math.max(0, Math.floor(rawAmount));
  if (amount <= 0) {
    return serializeBillingSummary(context.state);
  }

  const nowMs = Date.now();
  const freshAuth = await getAuthenticatedSupabaseUser(
    context.accessToken,
    context.refreshToken
  );
  const activeUser = freshAuth.user || context.user;
  const latestState = await reconcileAndLoadBillingState({
    user: activeUser,
    accessToken: freshAuth.accessToken || context.accessToken,
    refreshToken: freshAuth.refreshToken || context.refreshToken,
    checkPaystack: false,
  });

  const plan = getPlanConfig(latestState.tier);
  const dailyHeadroom =
    plan.dailyLimit !== null
      ? Math.max(0, plan.dailyLimit - latestState.dailyCreditsUsed)
      : amount;
  const effectiveAmount = Math.min(
    amount,
    latestState.monthlyCreditsRemaining,
    dailyHeadroom
  );

  if (effectiveAmount <= 0) {
    return serializeBillingSummary(latestState);
  }

  const consumed = consumeBillingCredit(latestState, effectiveAmount, nowMs);
  if (!consumed.allowed) {
    return serializeBillingSummary(consumed.state);
  }

  await saveUserBillingState({
    user: activeUser,
    state: consumed.state,
    accessToken: freshAuth.accessToken || context.accessToken,
    refreshToken: freshAuth.refreshToken || context.refreshToken,
  });

  return serializeBillingSummary(consumed.state);
}

export async function enforceAndConsumeGenerationCredit(
  request: Request,
  amount = 1
): Promise<
  | {
      allowed: true;
      billing: BillingSummaryPayload | null;
    }
  | {
      allowed: false;
      status: number;
      code: string;
      error: string;
      billing: BillingSummaryPayload;
    }
> {
  const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
  if (!accessToken && !refreshToken) {
    return { allowed: true, billing: null };
  }

  const auth = await getAuthenticatedSupabaseUser(accessToken, refreshToken);
  if (!auth.user) {
    return { allowed: true, billing: null };
  }

  const current = await reconcileAndLoadBillingState({
    user: auth.user,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    checkPaystack: false,
  });

  const consumed = consumeBillingCredit(current, amount, Date.now());
  if (!consumed.allowed) {
    return {
      allowed: false,
      status: 402,
      code: consumed.code || 'LIMIT_REACHED',
      error: consumed.error || 'Credit limit reached.',
      billing: serializeBillingSummary(consumed.state),
    };
  }

  await saveUserBillingState({
    user: auth.user,
    state: consumed.state,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
  });

  return {
    allowed: true,
    billing: serializeBillingSummary(consumed.state),
  };
}

let bucketChecked = false;
async function ensureWorkspaceBucket(): Promise<boolean> {
  const adminClient = createSupabaseServiceClient();
  if (!adminClient) return false;
  if (bucketChecked) return true;

  const { error: getErr } = await adminClient.storage.getBucket(WORKSPACE_BUCKET);
  if (!getErr) {
    bucketChecked = true;
    return true;
  }

  const { error: createErr } = await adminClient.storage.createBucket(
    WORKSPACE_BUCKET,
    { public: false }
  );
  if (!createErr || /already exists/i.test(createErr.message)) {
    bucketChecked = true;
    return true;
  }
  return false;
}

export async function saveCloudWorkspace(
  userId: string,
  payload: unknown
): Promise<boolean> {
  const adminClient = createSupabaseServiceClient();
  if (!adminClient || !userId) return false;

  const ready = await ensureWorkspaceBucket();
  if (!ready) return false;

  const jsonBody = JSON.stringify(payload);
  const { error } = await adminClient.storage
    .from(WORKSPACE_BUCKET)
    .upload(`${userId}/workspace.json`, Buffer.from(jsonBody, 'utf8'), {
      contentType: 'application/json',
      upsert: true,
    });

  return !error;
}

export async function loadCloudWorkspace(userId: string): Promise<unknown | null> {
  const adminClient = createSupabaseServiceClient();
  if (!adminClient || !userId) return null;

  const ready = await ensureWorkspaceBucket();
  if (!ready) return null;

  const { data, error } = await adminClient.storage
    .from(WORKSPACE_BUCKET)
    .download(`${userId}/workspace.json`);

  if (error || !data) return null;

  try {
    const text = await data.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
