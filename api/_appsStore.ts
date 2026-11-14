import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './_supabaseAuth.js';

export interface PublishedAppRecord {
  appId: string;
  projectId: string;
  ownerId?: string;
  title: string;
  slug: string;
  mode: 'mobile' | 'web';
  html: string;
  publicEnv?: Record<string, string>;
  tables?: string[];
  version: number;
  updatedAt: string;
}

const WORKSPACE_BUCKET = 'aicraft-user-data';
const LOCAL_APPS_DIR = '/tmp/aicraft-published-apps';
const memoryApps = new Map<string, PublishedAppRecord>();

function createSupabaseServiceClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const TITLE_BRAND_MAP: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  youtube: 'YouTube',
  netflix: 'Netflix',
  spotify: 'Spotify',
  airbnb: 'Airbnb',
  uber: 'Uber',
  twitter: 'Twitter',
  stripe: 'Stripe',
  paypal: 'PayPal',
  chatgpt: 'ChatGPT',
  openai: 'OpenAI',
  notion: 'Notion',
  slack: 'Slack',
  discord: 'Discord',
  shopify: 'Shopify',
  amazon: 'Amazon',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  snapchat: 'Snapchat',
  reddit: 'Reddit',
  tinder: 'Tinder',
  figma: 'Figma',
  canva: 'Canva',
  ios: 'iOS',
  ai: 'AI',
  crm: 'CRM',
  saas: 'SaaS',
  ecommerce: 'E-Commerce',
  'e-commerce': 'E-Commerce',
  ui: 'UI',
  ux: 'UX',
};

const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'me', 'my', 'our', 'your', 'for', 'with', 'using', 'and',
  'or', 'of', 'to', 'in', 'on', 'at', 'by', 'that', 'which', 'who', 'where',
  'please', 'just', 'really', 'very', 'full', 'complete', 'real', 'realtime',
  'real-time', 'modern', 'simple', 'clean', 'working', 'functional', 'mobile',
  'web', 'app', 'application', 'website', 'site', 'webpage', 'page', 'platform',
  'system', 'tool', 'software', 'i', 'want', 'need', 'would', 'should', 'could',
  'can', 'help',
]);

function formatServerTitleWord(word: string): string {
  const clean = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9+-]+$/g, '');
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (TITLE_BRAND_MAP[lower]) return TITLE_BRAND_MAP[lower];
  if (clean.includes('-')) {
    return clean.split('-').filter(Boolean).map(formatServerTitleWord).join('-');
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

export function sanitizeSessionTitle(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'`#\s*:-]+|["'`#\s*:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).map(formatServerTitleWord).filter(Boolean).slice(0, 4);
  if (words.length === 0) return '';
  let joined = words.join(' ');
  if (joined.length > 30) joined = words.slice(0, 3).join(' ');
  if (joined.length > 30) joined = `${joined.slice(0, 29).trim()}…`;
  return joined;
}

export function deriveServerSessionTitle(
  promptText: string,
  mode: 'mobile' | 'web',
  previewHtml = ''
): string {
  const htmlTitleMatch = /<title\b[^>]*>([^<]{2,40})<\/title>/i.exec(previewHtml);
  const candidateFromHtml = htmlTitleMatch ? sanitizeSessionTitle(htmlTitleMatch[1]) : '';

  const raw = String(promptText || '')
    .replace(/\[\[\s*[A-Z_]+\s*(?::[^\]]*)?\]\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const likeMatch =
    /(?:app|website|site|platform|clone|tool|something|one|it)?\s*(?:like|similar to|inspired by)\s+(?:the\s+)?([a-z0-9][a-z0-9.+_-]*(?:\s+[a-z0-9][a-z0-9.+_-]*)?)/i.exec(
      raw
    );
  if (likeMatch && likeMatch[1]) {
    const brandTokens = likeMatch[1]
      .split(/\s+/)
      .filter((t) => !TITLE_STOP_WORDS.has(t.toLowerCase()) && !/^(with|featuring|that|where)$/i.test(t))
      .slice(0, 2);
    const brandName = brandTokens.map(formatServerTitleWord).filter(Boolean).join(' ');
    if (brandName) return sanitizeSessionTitle(`${brandName} Clone`);
  }

  const cloneMatch = /\b([a-z0-9][a-z0-9.+_-]{1,24})\s+clone\b/i.exec(raw);
  if (cloneMatch && cloneMatch[1]) {
    return sanitizeSessionTitle(`${formatServerTitleWord(cloneMatch[1])} Clone`);
  }

  if (
    candidateFromHtml &&
    !/^(document|index|app|home|ai craft|untitled)$/i.test(candidateFromHtml)
  ) {
    return candidateFromHtml;
  }

  const trimmedPrefix = raw
    .replace(
      /^(?:please\s+|can you\s+|could you\s+|i want to\s+|i need to\s+|i would like to\s+|help me\s+|let'?s\s+)*(?:build|create|make|design|develop|generate|craft|code|scaffold|write|explain|show|give)\s+(?:me\s+|us\s+)?(?:an?|the|my)?\s*/i,
      ''
    )
    .replace(
      /^(?:mobile|ios|android|web|full-stack|fullstack|real-time|realtime|modern|simple|clean)\s+(?:app|website|site|platform|tool)\s+(?:for|to|of|about|named|called)\s+/i,
      ''
    )
    .trim();

  const mainClause =
    trimmedPrefix.split(/\b(?:with|featuring|including|that\s+lets|that\s+allows|where\s+users)\b/i)[0] ||
    trimmedPrefix;
  const coreWords = mainClause
    .split(/[\s,/]+/)
    .map((w) => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9+-]+$/g, ''))
    .filter((w) => w.length >= 2 && !TITLE_STOP_WORDS.has(w.toLowerCase()));

  const selected = (coreWords.length > 0 ? coreWords : trimmedPrefix.split(/\s+/).filter(Boolean)).slice(0, 3);
  const titled = sanitizeSessionTitle(selected.join(' '));
  if (titled) return titled;
  return mode === 'mobile' ? 'Mobile App Project' : 'Web App Project';
}

export function sanitizeAppId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'aicraft-app';
}

export function filterPublicSafeEnv(
  env: Record<string, string> | undefined
): Record<string, string> {
  if (!env || typeof env !== 'object') return {};
  const safe: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (!key || typeof val !== 'string' || !val) continue;
    const isPrivate =
      /(?:secret|service_role|private|password|passwd|webhook|signing|admin|oauth_client_secret|openrouter|gemini_api_key|openai_api_key)/i.test(
        key
      ) || /^sk_(?:live|test)_/i.test(val);
    if (!isPrivate) {
      safe[key] = val;
    }
  }
  return safe;
}

export function buildStandaloneAppHtml(record: PublishedAppRecord): string {
  let html = String(record.html || '').trim();
  if (!html) return '';

  const publicEnv = filterPublicSafeEnv(record.publicEnv);
  const safeEnvJson = JSON.stringify(publicEnv).replace(/</g, '\\u003c');
  const safeDbPrefix = JSON.stringify(`aicraft_db_${record.appId}_`).replace(/</g, '\\u003c');
  const safeDbMeta = JSON.stringify({
    enabled: true,
    tables: Array.isArray(record.tables) ? record.tables : [],
  }).replace(/</g, '\\u003c');

  const runtimeScript = `<script>
(function(){
  if (window.AICraft && window.AICraft.__standalone) return;
  var envMap = ${safeEnvJson};
  var dbPrefix = ${safeDbPrefix};
  var dbMeta = ${safeDbMeta};
  window.__AICRAFT_ENV__ = Object.assign({}, window.__AICRAFT_ENV__ || {}, envMap);
  window.ENV = Object.assign({}, window.ENV || {}, envMap);
  window.process = window.process || {};
  window.process.env = Object.assign({}, window.process.env || {}, envMap);
  function getSecretFn(key) {
    if (!key) return undefined;
    if (Object.prototype.hasOwnProperty.call(envMap, key)) return envMap[key];
    var lower = String(key).toLowerCase();
    var keys = Object.keys(envMap);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === lower) return envMap[keys[i]];
    }
    return undefined;
  }
  function findSecretFn() {
    var patterns = Array.prototype.slice.call(arguments).filter(Boolean);
    var allKeys = Object.keys(envMap);
    for (var p = 0; p < patterns.length; p += 1) {
      var exact = getSecretFn(String(patterns[p]));
      if (exact) return exact;
    }
    for (var p2 = 0; p2 < patterns.length; p2 += 1) {
      var pat = String(patterns[p2]).toLowerCase();
      for (var i = 0; i < allKeys.length; i += 1) {
        var k = allKeys[i];
        var v = String(envMap[k] || '');
        if (!v) continue;
        if (k.toLowerCase().indexOf(pat) !== -1) return v;
      }
    }
    return undefined;
  }
  function cleanTable(t) {
    return String(t || 'items').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'items';
  }
  function readTable(table) {
    try {
      var raw = window.localStorage.getItem(dbPrefix + cleanTable(table));
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function writeTable(table, rows) {
    try {
      window.localStorage.setItem(dbPrefix + cleanTable(table), JSON.stringify(Array.isArray(rows) ? rows : []));
    } catch (e) {}
    return rows;
  }
  var dbApi = {
    meta: dbMeta,
    list: function(table) { return Promise.resolve(readTable(table)); },
    insert: function(table, row) {
      var rows = readTable(table);
      var item = Object.assign({ id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), created_at: new Date().toISOString() }, row || {});
      rows.unshift(item);
      writeTable(table, rows);
      return Promise.resolve(item);
    },
    update: function(table, id, patch) {
      var updated = null;
      var rows = readTable(table).map(function(r) {
        if (r && r.id === id) { updated = Object.assign({}, r, patch || {}); return updated; }
        return r;
      });
      writeTable(table, rows);
      return Promise.resolve(updated);
    },
    remove: function(table, id) {
      var rows = readTable(table).filter(function(r) { return !r || r.id !== id; });
      writeTable(table, rows);
      return Promise.resolve(true);
    },
    clear: function(table) {
      writeTable(table, []);
      return Promise.resolve(true);
    }
  };
  window.AICraft = {
    __standalone: true,
    env: envMap,
    secretKeys: Object.keys(envMap),
    getSecret: getSecretFn,
    hasSecret: function(key) { return Boolean(getSecretFn(key)); },
    findSecret: findSecretFn,
    db: dbApi,
    search: function(query) {
      return fetch('/api/search?q=' + encodeURIComponent(String(query || ''))).then(function(r) { return r.json(); });
    },
    ask: function() { return Promise.resolve(''); },
    chat: function() { return Promise.resolve(''); },
    edit: function() {}
  };
})();
</script>`;

  const safeTitle = record.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const headAdditions: string[] = [];
  if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) {
    headAdditions.push(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />'
    );
  }
  if (!/<title\b[^>]*>/i.test(html)) {
    headAdditions.push(`<title>${safeTitle}</title>`);
  }
  headAdditions.push(runtimeScript);

  const injection = headAdditions.join('\n');
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${injection}`);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${injection}\n</head>`);
  } else {
    html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />${injection}</head><body>${html}</body></html>`;
  }

  return html;
}

function writeLocalAppFile(record: PublishedAppRecord): void {
  try {
    fs.mkdirSync(LOCAL_APPS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(LOCAL_APPS_DIR, `${record.appId}.json`),
      JSON.stringify(record),
      'utf8'
    );
  } catch {
    // ignore read-only filesystem edge cases
  }
}

function readLocalAppFile(appId: string): PublishedAppRecord | null {
  try {
    const filePath = path.join(LOCAL_APPS_DIR, `${appId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw ? (JSON.parse(raw) as PublishedAppRecord) : null;
    return parsed && typeof parsed.html === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

let appsBucketChecked = false;
async function ensurePublishedBucket(): Promise<boolean> {
  const adminClient = createSupabaseServiceClient();
  if (!adminClient) return false;
  if (appsBucketChecked) return true;

  const { error: getErr } = await adminClient.storage.getBucket(WORKSPACE_BUCKET);
  if (!getErr) {
    appsBucketChecked = true;
    return true;
  }
  const { error: createErr } = await adminClient.storage.createBucket(WORKSPACE_BUCKET, {
    public: false,
  });
  if (!createErr || /already exists/i.test(createErr.message)) {
    appsBucketChecked = true;
    return true;
  }
  return false;
}

export async function savePublishedApp(
  record: PublishedAppRecord
): Promise<{ ok: boolean; record: PublishedAppRecord }> {
  const cleanId = sanitizeAppId(record.appId);
  const normalized: PublishedAppRecord = {
    ...record,
    appId: cleanId,
    publicEnv: filterPublicSafeEnv(record.publicEnv),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };

  memoryApps.set(cleanId, normalized);
  writeLocalAppFile(normalized);

  try {
    const adminClient = createSupabaseServiceClient();
    if (adminClient) {
      const ready = await ensurePublishedBucket();
      if (ready) {
        await adminClient.storage
          .from(WORKSPACE_BUCKET)
          .upload(
            `published/${cleanId}.json`,
            Buffer.from(JSON.stringify(normalized), 'utf8'),
            {
              contentType: 'application/json',
              upsert: true,
            }
          );
      }
    }
  } catch {
    // local/memory cache still succeeds when offline
  }

  return { ok: true, record: normalized };
}

export async function loadPublishedApp(
  rawAppId: string
): Promise<PublishedAppRecord | null> {
  const cleanId = sanitizeAppId(rawAppId);
  const mem = memoryApps.get(cleanId);
  if (mem) return mem;

  const local = readLocalAppFile(cleanId);
  if (local) {
    memoryApps.set(cleanId, local);
    return local;
  }

  try {
    const adminClient = createSupabaseServiceClient();
    if (!adminClient) return null;
    const ready = await ensurePublishedBucket();
    if (!ready) return null;

    const { data, error } = await adminClient.storage
      .from(WORKSPACE_BUCKET)
      .download(`published/${cleanId}.json`);
    if (error || !data) return null;

    const text = await data.text();
    const parsed = text ? (JSON.parse(text) as PublishedAppRecord) : null;
    if (parsed && typeof parsed.html === 'string') {
      memoryApps.set(cleanId, parsed);
      writeLocalAppFile(parsed);
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildNotFoundAppHtml(appId: string): string {
  const safeId = appId.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App Not Found · AI Craft</title>
  <style>
    body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: #FAFAFC; color: #0B0B0F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; }
    .card { max-width: 400px; width: 100%; background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 20px; padding: 28px 24px; text-align: center; box-shadow: 0 8px 28px rgba(15,15,30,0.05); }
    h1 { font-size: 19px; margin: 0 0 8px; font-weight: 700; }
    p { font-size: 14px; color: #52525B; line-height: 1.5; margin: 0 0 20px; }
    code { font-size: 12.5px; background: #F4F4F6; padding: 2px 6px; border-radius: 6px; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 18px; border-radius: 12px; background: #0B0B0F; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>App link not ready yet</h1>
    <p>No live build was found for <code>${safeId}</code>. Finish building the app in AI Craft to generate its live link.</p>
    <a href="/">Open AI Craft</a>
  </div>
</body>
</html>`;
}
