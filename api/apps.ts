import {
  buildNotFoundAppHtml,
  buildStandaloneAppHtml,
  filterPublicSafeEnv,
  loadPublishedApp,
  sanitizeAppId,
  savePublishedApp,
} from './_appsStore.js';
import {
  extractAuthTokensFromRequest,
  getAuthenticatedSupabaseUser,
} from './_billing.js';

export async function GET(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const rawId =
    reqUrl.searchParams.get('id') ||
    reqUrl.pathname.replace(/^\/(?:api\/apps|app)\/?/i, '').split('/')[0] ||
    '';

  const cleanId = sanitizeAppId(rawId);
  if (!rawId || !cleanId) {
    return new Response(buildNotFoundAppHtml(rawId || 'app'), {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const record = await loadPublishedApp(cleanId);
  if (!record || !record.html) {
    if (reqUrl.searchParams.get('format') === 'json') {
      return Response.json(
        { exists: false, appId: cleanId },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return new Response(buildNotFoundAppHtml(cleanId), {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (reqUrl.searchParams.get('format') === 'json') {
    return Response.json(
      {
        exists: true,
        appId: record.appId,
        projectId: record.projectId,
        title: record.title,
        slug: record.slug,
        mode: record.mode,
        version: record.version,
        updatedAt: record.updatedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const standaloneHtml = buildStandaloneAppHtml(record);
  return new Response(standaloneHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: {
    appId?: string;
    projectId?: string;
    title?: string;
    slug?: string;
    mode?: 'mobile' | 'web';
    html?: string;
    publicEnv?: Record<string, string>;
    tables?: string[];
    version?: number;
  } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const html = typeof body.html === 'string' ? body.html.trim() : '';
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!html || !projectId) {
    return Response.json(
      { ok: false, error: 'Missing required html or projectId.' },
      { status: 400 }
    );
  }

  const { accessToken, refreshToken } = extractAuthTokensFromRequest(request);
  const auth =
    accessToken || refreshToken
      ? await getAuthenticatedSupabaseUser(accessToken, refreshToken).catch(() => ({
          user: null,
        }))
      : { user: null };

  const slug = sanitizeAppId(body.slug || body.title || projectId);
  let targetAppId = sanitizeAppId(body.appId || slug);

  // Prevent accidentally overwriting a different project's slug collision
  const existing = await loadPublishedApp(targetAppId);
  if (
    existing &&
    existing.projectId !== projectId &&
    (!auth.user || (existing.ownerId && existing.ownerId !== auth.user.id))
  ) {
    const suffix = projectId.replace(/[^a-z0-9]/gi, '').slice(-5).toLowerCase() || 'app';
    targetAppId = sanitizeAppId(`${slug}-${suffix}`);
  }

  const nextVersion =
    typeof body.version === 'number' && Number.isFinite(body.version) && body.version > 0
      ? Math.floor(body.version)
      : (existing?.version ?? 0) + 1;

  const { record } = await savePublishedApp({
    appId: targetAppId,
    projectId,
    ownerId: auth.user?.id || existing?.ownerId,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'AI Craft App',
    slug,
    mode: body.mode === 'web' ? 'web' : 'mobile',
    html,
    publicEnv: filterPublicSafeEnv(body.publicEnv),
    tables: Array.isArray(body.tables) ? body.tables.filter((t) => typeof t === 'string') : [],
    version: nextVersion,
    updatedAt: new Date().toISOString(),
  });

  return Response.json(
    {
      ok: true,
      appId: record.appId,
      slug: record.slug,
      path: `/app/${record.appId}`,
      version: record.version,
      deployedAt: record.updatedAt,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
