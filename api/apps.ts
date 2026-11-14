import {
  buildAppManifestJson,
  buildAppServiceWorkerJs,
  buildNotFoundAppHtml,
  buildStandaloneAppHtml,
  filterPublicSafeEnv,
  getAppLogoConfig,
  loadPublishedApp,
  renderAppIconPng,
  renderAppIconSvg,
  sanitizeAppId,
  savePublishedApp,
  type AppLogoConfig,
} from './_appsStore.js';
import {
  extractAuthTokensFromRequest,
  getAuthenticatedSupabaseUser,
} from './_billing.js';

function parseAppRequest(request: Request): { rawId: string; asset: string } {
  const reqUrl = new URL(request.url);
  const queryId = reqUrl.searchParams.get('id') || '';
  const queryAsset = reqUrl.searchParams.get('asset') || '';
  if (queryId) {
    return { rawId: queryId, asset: queryAsset.toLowerCase() };
  }

  const trimmedPath = reqUrl.pathname.replace(/^\/(?:api\/apps|app)\/?/i, '');
  const segments = trimmedPath.split('/').filter(Boolean);
  const rawId = segments[0] || '';
  const sub = (segments[1] || '').toLowerCase();

  let asset = queryAsset.toLowerCase();
  if (!asset && sub) {
    if (sub === 'manifest.webmanifest' || sub === 'manifest.json') asset = 'manifest';
    else if (sub === 'sw.js') asset = 'sw';
    else if (sub === 'icon.svg') asset = 'icon-svg';
    else if (sub === 'icon-180.png' || sub === 'apple-touch-icon.png') asset = 'icon-180';
    else if (sub === 'icon-192.png') asset = 'icon-192';
    else if (sub === 'icon-512.png') asset = 'icon-512';
    else if (sub === 'icon-maskable.png') asset = 'icon-maskable';
  }
  return { rawId, asset };
}

export async function GET(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const { rawId, asset } = parseAppRequest(request);
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
    if (reqUrl.searchParams.get('format') === 'json' || asset === 'manifest') {
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

  if (asset === 'manifest') {
    return new Response(JSON.stringify(buildAppManifestJson(record)), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  if (asset === 'sw') {
    return new Response(buildAppServiceWorkerJs(record), {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': `/app/${record.appId}`,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  if (asset === 'icon-svg') {
    const logo = getAppLogoConfig(record);
    return new Response(renderAppIconSvg(logo), {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  if (
    asset === 'icon-180' ||
    asset === 'icon-192' ||
    asset === 'icon-512' ||
    asset === 'icon-maskable'
  ) {
    const logo = getAppLogoConfig(record);
    const pngSize = asset === 'icon-180' ? 180 : asset === 'icon-192' ? 192 : 512;
    const pngBuf = renderAppIconPng(logo, pngSize, {
      maskable: asset === 'icon-maskable',
      opaqueFullBleed: asset === 'icon-180' || asset === 'icon-maskable',
    });
    return new Response(new Uint8Array(pngBuf), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  if (reqUrl.searchParams.get('format') === 'json') {
    const logo = getAppLogoConfig(record);
    return Response.json(
      {
        exists: true,
        appId: record.appId,
        projectId: record.projectId,
        title: record.title,
        slug: record.slug,
        mode: record.mode,
        version: record.version,
        themeColor: logo.themeColor,
        logoUrl: `/app/${record.appId}/icon-180.png?v=${record.version}`,
        manifestUrl: `/app/${record.appId}/manifest.webmanifest?v=${record.version}`,
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
    logo?: Partial<AppLogoConfig>;
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

  const resolvedExisting =
    targetAppId === existing?.appId ? existing : await loadPublishedApp(targetAppId);

  const nextVersion =
    typeof body.version === 'number' && Number.isFinite(body.version) && body.version > 0
      ? Math.floor(body.version)
      : (resolvedExisting?.version ?? 0) + 1;

  const { record } = await savePublishedApp({
    appId: targetAppId,
    projectId,
    ownerId: auth.user?.id || resolvedExisting?.ownerId,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'AI Craft App',
    slug,
    mode: body.mode === 'web' ? 'web' : 'mobile',
    html,
    publicEnv: filterPublicSafeEnv(body.publicEnv),
    tables: Array.isArray(body.tables) ? body.tables.filter((t) => typeof t === 'string') : [],
    logo: body.logo && typeof body.logo === 'object' ? body.logo : undefined,
    version: nextVersion,
    updatedAt: new Date().toISOString(),
  });

  const logo = getAppLogoConfig(record);

  return Response.json(
    {
      ok: true,
      appId: record.appId,
      slug: record.slug,
      path: `/app/${record.appId}`,
      logoUrl: `/app/${record.appId}/icon-180.png?v=${record.version}`,
      manifestUrl: `/app/${record.appId}/manifest.webmanifest?v=${record.version}`,
      themeColor: logo.themeColor,
      version: record.version,
      deployedAt: record.updatedAt,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
