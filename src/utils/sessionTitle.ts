import type { BuildMode } from '../types/craft';

const BRAND_CASING_MAP: Record<string, string> = {
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
  dropbox: 'Dropbox',
  trello: 'Trello',
  asana: 'Asana',
  shopifyapp: 'Shopify App',
  ios: 'iOS',
  ai: 'AI',
  crm: 'CRM',
  erp: 'ERP',
  pos: 'POS',
  saas: 'SaaS',
  ecommerce: 'E-Commerce',
  'e-commerce': 'E-Commerce',
  ui: 'UI',
  ux: 'UX',
  qr: 'QR',
  pdf: 'PDF',
  tv: 'TV',
  fx: 'FX',
  nft: 'NFT',
  crypto: 'Crypto',
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'me',
  'my',
  'our',
  'your',
  'for',
  'with',
  'using',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'that',
  'which',
  'who',
  'where',
  'please',
  'just',
  'really',
  'very',
  'full',
  'complete',
  'real',
  'realtime',
  'real-time',
  'modern',
  'simple',
  'clean',
  'working',
  'functional',
  'mobile',
  'web',
  'app',
  'application',
  'website',
  'site',
  'webpage',
  'page',
  'platform',
  'system',
  'tool',
  'software',
  'i',
  'want',
  'need',
  'would',
  'should',
  'could',
  'can',
  'help',
]);

function formatTitleWord(word: string): string {
  const clean = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9+-]+$/g, '');
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (BRAND_CASING_MAP[lower]) {
    return BRAND_CASING_MAP[lower];
  }
  if (clean.includes('-')) {
    return clean
      .split('-')
      .filter(Boolean)
      .map((part) => formatTitleWord(part))
      .join('-');
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

export function sanitizeSessionTitle(raw: string): string {
  const stripped = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'`#\s*:-]+|["'`#\s*:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return '';

  const words = stripped
    .split(/\s+/)
    .map(formatTitleWord)
    .filter(Boolean)
    .slice(0, 4);

  if (words.length === 0) return '';
  let joined = words.join(' ');
  if (joined.length > 30) {
    joined = words.slice(0, 3).join(' ');
  }
  if (joined.length > 30) {
    joined = `${joined.slice(0, 29).trim()}…`;
  }
  return joined;
}

export function deriveSmartProjectTitle(
  promptText: string,
  mode: BuildMode = 'mobile'
): string {
  const raw = String(promptText || '')
    .replace(/\[\[\s*[A-Z_]+\s*(?::[^\]]*)?\]\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) {
    return mode === 'mobile' ? 'New Mobile App' : 'New Web App';
  }

  // 1. "like TikTok", "similar to Airbnb", "TikTok clone"
  const likeMatch =
    /(?:app|website|site|platform|clone|tool|something|one|it)?\s*(?:like|similar to|inspired by)\s+(?:the\s+)?([a-z0-9][a-z0-9.+_-]*(?:\s+[a-z0-9][a-z0-9.+_-]*)?)/i.exec(
      raw
    );
  if (likeMatch && likeMatch[1]) {
    const candidateTokens = likeMatch[1]
      .split(/\s+/)
      .filter((t) => !STOP_WORDS.has(t.toLowerCase()) && !/^(with|featuring|that|where)$/i.test(t))
      .slice(0, 2);
    const brandName = candidateTokens.map(formatTitleWord).filter(Boolean).join(' ');
    if (brandName) {
      return sanitizeSessionTitle(`${brandName} Clone`);
    }
  }

  const cloneMatch =
    /\b([a-z0-9][a-z0-9.+_-]{1,24})\s+clone\b/i.exec(raw);
  if (cloneMatch && cloneMatch[1]) {
    return sanitizeSessionTitle(`${formatTitleWord(cloneMatch[1])} Clone`);
  }

  // 2. Strip conversational prefixes & extract meaningful core words
  const trimmedPrefix = raw
    .replace(
      /^(?:please\s+|can you\s+|could you\s+|i want to\s+|i need to\s+|i would like to\s+|help me\s+|let'?s\s+)*(?:build|create|make|design|develop|generate|craft|code|scaffold|write|explain|show|give)\s+(?:me\s+|us\s+)?(?:an?|the|my)?\s*/i,
      ''
    )
    .replace(
      /^(?:mobile|ios|android|web|full-stack|fullstack|real-time|realtime|modern|simple|clean)\s+(?:app|website|site|platform|tool)\s+(?:for|to|of|about|named|called)\s+/i,
      ''
    )
    .replace(/^(?:app|website|site|platform)\s+(?:for|to|about|that)\s+/i, '')
    .trim();

  // Focus on text before "with ..." or "that has ..." clauses when long
  const mainClause =
    trimmedPrefix.split(/\b(?:with|featuring|including|that\s+lets|that\s+allows|where\s+users)\b/i)[0] ||
    trimmedPrefix;

  const coreWords = mainClause
    .split(/[\s,/]+/)
    .map((w) => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9+-]+$/g, ''))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));

  const selected = (coreWords.length > 0
    ? coreWords
    : trimmedPrefix.split(/\s+/).filter(Boolean)
  ).slice(0, 3);

  const titled = sanitizeSessionTitle(selected.join(' '));
  if (titled) return titled;

  return mode === 'mobile' ? 'Mobile App Project' : 'Web App Project';
}

export function slugifyAppTitle(raw: string): string {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return cleaned || 'aicraft-app';
}
