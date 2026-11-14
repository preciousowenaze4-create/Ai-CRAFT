import {
  extractAuthTokensFromRequest,
  getAuthenticatedSupabaseUser,
  loadCloudWorkspace,
  reconcileAndLoadBillingState,
  saveCloudWorkspace,
  serializeBillingSummary,
  upgradeUserAccountFromTransaction,
} from './_billing.js';
import {
  buildPaymentCallbackHtml,
  getPaymentSecretKey,
  initializeCheckoutSession,
  listCustomerTransactions,
  resolvePlanFromMetadataOrAmount,
  verifyCheckoutTransaction,
  verifyWebhookSignature,
} from './_paystack.js';
import { getRequestBaseUrl } from './_supabaseAuth.js';

function getPaymentSubroute(request: Request): string {
  const reqUrl = new URL(request.url);
  const paramRoute = reqUrl.searchParams.get('__route');
  if (paramRoute !== null) {
    return paramRoute.replace(/^\/+|\/+$/g, '').toLowerCase();
  }
  return reqUrl.pathname
    .replace(/^\/api\/payments\/?/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

export async function GET(request: Request): Promise<Response> {
  const route = getPaymentSubroute(request);

  if (route === 'config') {
    return Response.json(
      { configured: Boolean(getPaymentSecretKey()) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (route === 'callback') {
    return new Response(buildPaymentCallbackHtml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (route === 'transactions') {
    const reqUrl = new URL(request.url);
    const email = reqUrl.searchParams.get('email') || '';
    const data = await listCustomerTransactions(email);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (route === 'billing') {
    const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
    const auth = await getAuthenticatedSupabaseUser(accessToken, refreshToken);
    if (!auth.user) {
      return Response.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const state = await reconcileAndLoadBillingState({
      user: auth.user,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      checkPaystack: true,
    });

    return Response.json(
      {
        billing: serializeBillingSummary(state),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (route === 'sync') {
    const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
    const auth = await getAuthenticatedSupabaseUser(accessToken, refreshToken);
    if (!auth.user) {
      return Response.json({ synced: false, workspace: null }, { status: 401 });
    }

    const workspace = await loadCloudWorkspace(auth.user.id);
    return Response.json(
      {
        synced: Boolean(workspace),
        workspace,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return Response.json({ error: 'Payment endpoint not found.' }, { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  const route = getPaymentSubroute(request);

  if (route === 'webhook') {
    const rawBody = await request.text();
    const signature = request.headers.get('x-paystack-signature');

    if (!verifyWebhookSignature(rawBody, signature)) {
      return Response.json({ error: 'Invalid webhook signature.' }, { status: 401 });
    }

    let eventPayload: {
      event?: string;
      data?: {
        id?: number | string;
        reference?: string;
        amount?: number;
        status?: string;
        paid_at?: string;
        created_at?: string;
        channel?: string;
        customer?: { email?: string };
        metadata?: { userId?: string; [key: string]: unknown };
      };
    } = {};

    try {
      eventPayload = rawBody ? (JSON.parse(rawBody) as typeof eventPayload) : {};
    } catch {
      return Response.json({ error: 'Invalid webhook JSON.' }, { status: 400 });
    }

    if (eventPayload.event === 'charge.success' && eventPayload.data?.reference) {
      const reference = eventPayload.data.reference.trim();
      const verified = await verifyCheckoutTransaction(reference);
      if (verified.ok && verified.verified) {
        await upgradeUserAccountFromTransaction({ tx: verified.transaction });
      } else if (eventPayload.data.status === 'success') {
        const amountKobo = Number(eventPayload.data.amount || 0);
        const plan = resolvePlanFromMetadataOrAmount(
          eventPayload.data.metadata,
          amountKobo
        );
        if (amountKobo >= plan.amountKobo) {
          await upgradeUserAccountFromTransaction({
            tx: {
              id: String(eventPayload.data.id ?? reference),
              reference,
              planId: plan.id,
              planName: plan.name,
              amountNgn: Math.round(amountKobo / 100),
              amountKobo,
              creditsToAdd: plan.monthlyCredits,
              status: 'paid',
              paidAt:
                eventPayload.data.paid_at ||
                eventPayload.data.created_at ||
                new Date().toISOString(),
              channel: eventPayload.data.channel || 'card',
              email: eventPayload.data.customer?.email || '',
              userId:
                typeof eventPayload.data.metadata?.userId === 'string'
                  ? eventPayload.data.metadata.userId
                  : undefined,
            },
          });
        }
      }
    }

    return Response.json({ received: true });
  }

  if (route === 'initialize') {
    const body = (await request.json().catch(() => ({}))) as {
      planId?: string;
      email?: string;
      userId?: string;
    };
    const callbackUrl = `${getRequestBaseUrl(request)}/api/payments/callback`;
    const result = await initializeCheckoutSession({
      planId: typeof body.planId === 'string' ? body.planId : '',
      email: typeof body.email === 'string' ? body.email : '',
      userId: typeof body.userId === 'string' ? body.userId : undefined,
      callbackUrl,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(
      {
        authorizationUrl: result.authorizationUrl,
        reference: result.reference,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (route === 'verify') {
    const body = (await request.json().catch(() => ({}))) as {
      reference?: string;
    };
    const reference =
      typeof body.reference === 'string' ? body.reference.trim() : '';
    const result = await verifyCheckoutTransaction(reference);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    let billingSummary = null;
    if (result.verified) {
      const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
      const auth =
        accessToken || refreshToken
          ? await getAuthenticatedSupabaseUser(accessToken, refreshToken)
          : { user: null, accessToken: '', refreshToken: '' };

      const upgraded = await upgradeUserAccountFromTransaction({
        tx: result.transaction,
        authenticatedUser: auth.user,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      });

      if (upgraded) {
        billingSummary = serializeBillingSummary(upgraded);
      }
    }

    return Response.json(
      {
        verified: result.verified,
        transaction: result.transaction,
        billing: billingSummary,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (route === 'sync') {
    const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
    const auth = await getAuthenticatedSupabaseUser(accessToken, refreshToken);
    if (!auth.user) {
      return Response.json({ synced: false }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ synced: false, error: 'Invalid payload.' }, { status: 400 });
    }

    const saved = await saveCloudWorkspace(auth.user.id, body);
    return Response.json({ synced: saved }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return Response.json({ error: 'Payment endpoint not found.' }, { status: 404 });
}
