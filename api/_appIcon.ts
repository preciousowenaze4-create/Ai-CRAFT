import zlib from 'node:zlib';

export type AppLogoMotif =
  | 'play'
  | 'chat'
  | 'bag'
  | 'music'
  | 'camera'
  | 'heart'
  | 'bolt'
  | 'star'
  | 'wallet'
  | 'map'
  | 'flame'
  | 'spark'
  | 'letter';

export interface AppLogoConfig {
  name: string;
  shortName: string;
  bgColor: string;
  accentColor: string;
  themeColor: string;
  backgroundColor: string;
  fgColor: string;
  isDark: boolean;
  motif: AppLogoMotif;
  letters: string;
  customSvg?: string;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

const NAMED_COLORS: Record<string, string> = {
  red: '#DC2626',
  crimson: '#B91C1C',
  scarlet: '#EF4444',
  rose: '#E11D48',
  pink: '#EC4899',
  magenta: '#D946EF',
  purple: '#7C3AED',
  violet: '#6D28D9',
  indigo: '#4F46E5',
  blue: '#2563EB',
  sky: '#0284C7',
  cyan: '#06B6D4',
  teal: '#0D9488',
  emerald: '#059669',
  green: '#16A34A',
  lime: '#65A30D',
  yellow: '#EAB308',
  amber: '#D97706',
  gold: '#CA8A04',
  orange: '#EA580C',
  coral: '#F97316',
  black: '#0B0B0F',
  dark: '#111118',
  charcoal: '#1F2937',
  slate: '#334155',
  navy: '#0F172A',
  white: '#FFFFFF',
};

function parseHexColor(raw: string | undefined | null): string {
  if (!raw) return '';
  const cleaned = raw.trim().toLowerCase();
  if (NAMED_COLORS[cleaned]) return NAMED_COLORS[cleaned];
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cleaned);
  if (!hexMatch) return '';
  const hex = hexMatch[1];
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase();
  }
  return `#${hex}`.toUpperCase();
}

function hexToRgb(hex: string): RGB {
  const norm = parseHexColor(hex) || '#111118';
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

function luminance(rgb: RGB): number {
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped),
  };
}

function darkenHex(hex: string, amount = 0.28): string {
  const rgb = hexToRgb(hex);
  const dark = mixRgb(rgb, { r: 6, g: 8, b: 14 }, amount);
  return `#${dark.r.toString(16).padStart(2, '0')}${dark.g
    .toString(16)
    .padStart(2, '0')}${dark.b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function lightenHex(hex: string, amount = 0.22): string {
  const rgb = hexToRgb(hex);
  const light = mixRgb(rgb, { r: 255, g: 255, b: 255 }, amount);
  return `#${light.r.toString(16).padStart(2, '0')}${light.g
    .toString(16)
    .padStart(2, '0')}${light.b.toString(16).padStart(2, '0')}`.toUpperCase();
}

export function condenseShortName(rawTitle: string): string {
  const cleaned = String(rawTitle || '')
    .replace(/\s+Clone$/i, '')
    .replace(/\s+App$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || String(rawTitle || 'App').trim() || 'App';
  if (base.length <= 12) return base;
  const words = base.split(' ').filter(Boolean);
  if (words.length > 1 && words[0].length <= 12) {
    return words[0];
  }
  return base.slice(0, 12).trim();
}

function deriveLetters(title: string): string {
  const words = String(title || 'App')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function normalizeMotif(raw: string | undefined): AppLogoMotif | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase();
  const allowed: AppLogoMotif[] = [
    'play',
    'chat',
    'bag',
    'music',
    'camera',
    'heart',
    'bolt',
    'star',
    'wallet',
    'map',
    'flame',
    'spark',
    'letter',
  ];
  if (allowed.includes(m as AppLogoMotif)) return m as AppLogoMotif;
  if (/video|reel|stream|tube|movie/.test(m)) return 'play';
  if (/message|talk|social|forum/.test(m)) return 'chat';
  if (/shop|store|cart|commerce|market/.test(m)) return 'bag';
  if (/audio|song|podcast|sound|beat/.test(m)) return 'music';
  if (/photo|pic|gallery|snap/.test(m)) return 'camera';
  if (/health|fit|love|dating|care/.test(m)) return 'heart';
  if (/pay|bank|cash|finance|money|crypto/.test(m)) return 'wallet';
  if (/travel|ride|food|delivery|track/.test(m)) return 'map';
  if (/ai|magic|bot|smart/.test(m)) return 'spark';
  if (/power|energy|fast|flash/.test(m)) return 'bolt';
  return null;
}

function detectDomainDefaults(title: string, html: string): {
  bgColor: string;
  accentColor: string;
  motif: AppLogoMotif;
} {
  const corpus = `${title} ${html.slice(0, 2500)}`.toLowerCase();
  if (/tiktok|reels|short video|for you/.test(corpus)) {
    return { bgColor: '#0B0B0F', accentColor: '#FE2C55', motif: 'music' };
  }
  if (/youtube|video|stream|cinema|netflix/.test(corpus)) {
    return { bgColor: '#DC2626', accentColor: '#FCA5A5', motif: 'play' };
  }
  if (/whatsapp|messenger|telegram|chat|messaging/.test(corpus)) {
    return { bgColor: '#16A34A', accentColor: '#86EFAC', motif: 'chat' };
  }
  if (/instagram|photo|camera|stories/.test(corpus)) {
    return { bgColor: '#E11D48', accentColor: '#FDBA74', motif: 'camera' };
  }
  if (/spotify|music|audio|podcast|radio/.test(corpus)) {
    return { bgColor: '#15803D', accentColor: '#4ADE80', motif: 'music' };
  }
  if (/shop|store|sneaker|fashion|ecommerce|e-commerce|cart|boutique/.test(corpus)) {
    return { bgColor: '#EA580C', accentColor: '#FED7AA', motif: 'bag' };
  }
  if (/wallet|bank|pay|fintech|invoice|budget|crypto/.test(corpus)) {
    return { bgColor: '#0F172A', accentColor: '#38BDF8', motif: 'wallet' };
  }
  if (/fitness|workout|gym|calorie|run|flame/.test(corpus)) {
    return { bgColor: '#EA580C', accentColor: '#FDE047', motif: 'flame' };
  }
  if (/health|wellness|dating|love|care/.test(corpus)) {
    return { bgColor: '#E11D48', accentColor: '#FBCFE8', motif: 'heart' };
  }
  if (/map|uber|ride|delivery|food|travel|hotel|airbnb/.test(corpus)) {
    return { bgColor: '#0284C7', accentColor: '#BAE6FD', motif: 'map' };
  }
  if (/ai|assistant|prompt|studio/.test(corpus)) {
    return { bgColor: '#4F46E5', accentColor: '#C4B5FD', motif: 'spark' };
  }

  // Deterministic vibrant palette seeded by title
  const palettes = [
    { bgColor: '#2563EB', accentColor: '#93C5FD' },
    { bgColor: '#DC2626', accentColor: '#FCA5A5' },
    { bgColor: '#7C3AED', accentColor: '#DDD6FE' },
    { bgColor: '#059669', accentColor: '#6EE7B7' },
    { bgColor: '#D97706', accentColor: '#FDE68A' },
    { bgColor: '#E11D48', accentColor: '#FDA4AF' },
  ];
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  const chosen = palettes[hash % palettes.length];
  return { ...chosen, motif: 'letter' };
}

function getAttr(tag: string, attrName: string): string {
  const re = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = re.exec(tag);
  return m ? m[1].trim() : '';
}

export function extractLogoDirectiveFromRaw(raw: string): Partial<{
  bgColor: string;
  accentColor: string;
  themeColor: string;
  motif: AppLogoMotif;
  letters: string;
}> | null {
  const match = /\[\[\s*LOGO\s*:\s*([^\]]+?)\s*\]\]/i.exec(raw);
  if (!match) return null;
  const body = match[1];
  const out: Partial<{
    bgColor: string;
    accentColor: string;
    themeColor: string;
    motif: AppLogoMotif;
    letters: string;
  }> = {};

  for (const part of body.split(/[,;|]+/)) {
    const [kRaw, vRaw] = part.split('=').map((s) => s.trim());
    if (!kRaw || !vRaw) continue;
    const k = kRaw.toLowerCase();
    if (k === 'bg' || k === 'bgcolor' || k === 'color') {
      const parsed = parseHexColor(vRaw);
      if (parsed) out.bgColor = parsed;
    } else if (k === 'accent') {
      const parsed = parseHexColor(vRaw);
      if (parsed) out.accentColor = parsed;
    } else if (k === 'theme' || k === 'theme_color' || k === 'themecolor') {
      const parsed = parseHexColor(vRaw);
      if (parsed) out.themeColor = parsed;
    } else if (k === 'motif' || k === 'icon' || k === 'shape') {
      const parsed = normalizeMotif(vRaw);
      if (parsed) out.motif = parsed;
    } else if (k === 'letters' || k === 'text' || k === 'monogram') {
      const cleanLetters = vRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
      if (cleanLetters) out.letters = cleanLetters;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function extractAppLogoConfig(input: {
  title: string;
  html: string;
  logoOverride?: Partial<{
    bgColor: string;
    accentColor: string;
    themeColor: string;
    motif: string;
    letters: string;
  }>;
}): AppLogoConfig {
  const title = (input.title || 'App').trim() || 'App';
  const html = String(input.html || '');
  const domain = detectDomainDefaults(title, html);

  let bgColor = '';
  let accentColor = '';
  let themeColor = '';
  let backgroundColor = '';
  let motif: AppLogoMotif | null = null;
  let letters = '';
  let customSvg = '';

  // 1. Check <meta name="aicraft-logo" ...>
  const logoMetaMatch = /<meta\b[^>]*name=["']aicraft-logo["'][^>]*>/i.exec(html);
  if (logoMetaMatch) {
    const tag = logoMetaMatch[0];
    bgColor = parseHexColor(getAttr(tag, 'data-bg')) || parseHexColor(getAttr(tag, 'content')) || bgColor;
    accentColor = parseHexColor(getAttr(tag, 'data-accent')) || accentColor;
    themeColor = parseHexColor(getAttr(tag, 'data-theme')) || themeColor;
    motif = normalizeMotif(getAttr(tag, 'data-motif')) || motif;
    const rawLetters = getAttr(tag, 'data-letters').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
    if (rawLetters) letters = rawLetters;
  }

  // 2. Check <meta name="theme-color" ...> & <meta name="background-color" ...>
  const themeMetaMatch = /<meta\b[^>]*name=["']theme-color["'][^>]*>/i.exec(html);
  if (themeMetaMatch) {
    const c = parseHexColor(getAttr(themeMetaMatch[0], 'content'));
    if (c) themeColor = themeColor || c;
  }
  const bgMetaMatch = /<meta\b[^>]*name=["']background-color["'][^>]*>/i.exec(html);
  if (bgMetaMatch) {
    const c = parseHexColor(getAttr(bgMetaMatch[0], 'content'));
    if (c) backgroundColor = c;
  }

  // 3. Check custom inline <svg id="aicraft-app-icon" ...>...</svg>
  const svgMatch = /<svg\b[^>]*\bid=["']aicraft-app-icon["'][^>]*>[\s\S]*?<\/svg>/i.exec(html);
  if (svgMatch) {
    customSvg = svgMatch[0];
    // Extract first hex fill from custom SVG if bgColor not yet known
    const hexHits = Array.from(customSvg.matchAll(/#[0-9a-f]{3,6}\b/gi)).map((m) =>
      parseHexColor(m[0])
    );
    const nonWhite = hexHits.filter((h) => h && h !== '#FFFFFF' && h !== '#FFF');
    if (!bgColor && nonWhite[0]) bgColor = nonWhite[0];
    if (!accentColor && nonWhite[1]) accentColor = nonWhite[1];
  }

  // 4. Inspect CSS custom properties (--primary / --accent / --brand / --bg) as subtle fallback
  if (!bgColor || !themeColor) {
    const cssPrimaryMatch = /--(?:primary|brand|accent|theme)(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/i.exec(html);
    if (cssPrimaryMatch) {
      const c = parseHexColor(cssPrimaryMatch[1]);
      if (c && !bgColor) bgColor = c;
    }
    const cssBgMatch = /--(?:bg|background|surface)(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/i.exec(html);
    if (cssBgMatch) {
      const c = parseHexColor(cssBgMatch[1]);
      if (c && !backgroundColor) backgroundColor = c;
    }
  }

  // 5. Explicit overrides (e.g. from [[LOGO:...]]) win cleanly
  if (input.logoOverride) {
    if (input.logoOverride.bgColor) {
      const parsed = parseHexColor(input.logoOverride.bgColor);
      if (parsed) bgColor = parsed;
    }
    if (input.logoOverride.accentColor) {
      const parsed = parseHexColor(input.logoOverride.accentColor);
      if (parsed) accentColor = parsed;
    }
    if (input.logoOverride.themeColor) {
      const parsed = parseHexColor(input.logoOverride.themeColor);
      if (parsed) themeColor = parsed;
    }
    if (input.logoOverride.motif) {
      const parsed = normalizeMotif(input.logoOverride.motif);
      if (parsed) motif = parsed;
    }
    if (input.logoOverride.letters) {
      letters = input.logoOverride.letters.slice(0, 2).toUpperCase();
    }
  }

  const finalBg = bgColor || (themeColor && themeColor !== '#FFFFFF' ? themeColor : domain.bgColor);
  const finalAccent = accentColor || lightenHex(finalBg, 0.35) || domain.accentColor;
  const finalTheme = themeColor || finalBg;
  const finalBackground = backgroundColor || finalTheme;
  const finalMotif = motif || domain.motif;
  const finalLetters = letters || deriveLetters(title);

  const bgRgb = hexToRgb(finalBg);
  const fgColor = luminance(bgRgb) > 0.62 ? '#0B0B0F' : '#FFFFFF';
  const themeLum = luminance(hexToRgb(finalTheme));

  return {
    name: title,
    shortName: condenseShortName(title),
    bgColor: finalBg,
    accentColor: finalAccent,
    themeColor: finalTheme,
    backgroundColor: finalBackground,
    fgColor,
    isDark: themeLum < 0.45,
    motif: finalMotif,
    letters: finalLetters,
    customSvg: customSvg || undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Pure TypeScript Anti-Aliased PNG Rasterizer (Zero Native Dependencies)     */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0; // filter type 0 (None)
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundedRect(px: number, py: number, hx: number, hy: number, r: number): number {
  const dx = Math.abs(px) - (hx - r);
  const dy = Math.abs(py) - (hy - r);
  const outDist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inDist = Math.min(Math.max(dx, dy), 0);
  return outDist + inDist - r;
}

function sdSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay || 1e-6;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / denom));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  const e0x = bx - ax;
  const e0y = by - ay;
  const e1x = cx - bx;
  const e1y = cy - by;
  const e2x = ax - cx;
  const e2y = ay - cy;
  const v0x = px - ax;
  const v0y = py - ay;
  const v1x = px - bx;
  const v1y = py - by;
  const v2x = px - cx;
  const v2y = py - cy;

  const d0 = sdSegment(px, py, ax, ay, bx, by);
  const d1 = sdSegment(px, py, bx, by, cx, cy);
  const d2 = sdSegment(px, py, cx, cy, ax, ay);
  const minD = Math.min(d0, d1, d2);

  const c0 = e0x * v0y - e0y * v0x;
  const c1 = e1x * v1y - e1y * v1x;
  const c2 = e2x * v2y - e2y * v2x;
  const inside =
    (c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0);
  return inside ? -minD : minD;
}

// 5x7 crisp geometric stroke paths (normalized around [-1, 1] cell)
const GLYPH_SEGMENTS: Record<string, Array<[number, number, number, number]>> = {
  A: [[-0.65, 0.85, 0, -0.85], [0, -0.85, 0.65, 0.85], [-0.42, 0.25, 0.42, 0.25]],
  B: [[-0.55, -0.85, -0.55, 0.85], [-0.55, -0.85, 0.35, -0.85], [0.35, -0.85, 0.55, -0.45], [0.55, -0.45, 0.35, -0.05], [-0.55, -0.05, 0.4, -0.05], [0.4, -0.05, 0.6, 0.4], [0.6, 0.4, 0.38, 0.85], [-0.55, 0.85, 0.38, 0.85]],
  C: [[0.55, -0.62, 0.1, -0.85], [0.1, -0.85, -0.42, -0.62], [-0.42, -0.62, -0.58, 0], [-0.58, 0, -0.42, 0.62], [-0.42, 0.62, 0.1, 0.85], [0.1, 0.85, 0.55, 0.62]],
  D: [[-0.55, -0.85, -0.55, 0.85], [-0.55, -0.85, 0.2, -0.85], [0.2, -0.85, 0.6, -0.4], [0.6, -0.4, 0.6, 0.4], [0.6, 0.4, 0.2, 0.85], [0.2, 0.85, -0.55, 0.85]],
  E: [[0.5, -0.85, -0.5, -0.85], [-0.5, -0.85, -0.5, 0.85], [-0.5, 0, 0.35, 0], [-0.5, 0.85, 0.5, 0.85]],
  F: [[0.5, -0.85, -0.5, -0.85], [-0.5, -0.85, -0.5, 0.85], [-0.5, 0, 0.35, 0]],
  G: [[0.52, -0.6, 0.05, -0.85], [0.05, -0.85, -0.45, -0.6], [-0.45, -0.6, -0.6, 0], [-0.6, 0, -0.45, 0.6], [-0.45, 0.6, 0.1, 0.85], [0.1, 0.85, 0.58, 0.55], [0.58, 0.55, 0.58, 0.1], [0.58, 0.1, 0.08, 0.1]],
  H: [[-0.55, -0.85, -0.55, 0.85], [0.55, -0.85, 0.55, 0.85], [-0.55, 0, 0.55, 0]],
  I: [[-0.35, -0.85, 0.35, -0.85], [0, -0.85, 0, 0.85], [-0.35, 0.85, 0.35, 0.85]],
  J: [[0.4, -0.85, 0.4, 0.45], [0.4, 0.45, 0.08, 0.85], [0.08, 0.85, -0.35, 0.72], [-0.35, 0.72, -0.5, 0.4]],
  K: [[-0.5, -0.85, -0.5, 0.85], [0.5, -0.85, -0.45, 0.05], [-0.25, -0.1, 0.55, 0.85]],
  L: [[-0.45, -0.85, -0.45, 0.85], [-0.45, 0.85, 0.5, 0.85]],
  M: [[-0.65, 0.85, -0.65, -0.85], [-0.65, -0.85, 0, 0.15], [0, 0.15, 0.65, -0.85], [0.65, -0.85, 0.65, 0.85]],
  N: [[-0.55, 0.85, -0.55, -0.85], [-0.55, -0.85, 0.55, 0.85], [0.55, 0.85, 0.55, -0.85]],
  O: [[0, -0.85, 0.52, -0.55], [0.52, -0.55, 0.6, 0], [0.6, 0, 0.52, 0.55], [0.52, 0.55, 0, 0.85], [0, 0.85, -0.52, 0.55], [-0.52, 0.55, -0.6, 0], [-0.6, 0, -0.52, -0.55], [-0.52, -0.55, 0, -0.85]],
  P: [[-0.5, 0.85, -0.5, -0.85], [-0.5, -0.85, 0.35, -0.85], [0.35, -0.85, 0.55, -0.4], [0.55, -0.4, 0.35, 0.05], [0.35, 0.05, -0.5, 0.05]],
  Q: [[0, -0.85, 0.52, -0.55], [0.52, -0.55, 0.6, 0], [0.6, 0, 0.52, 0.55], [0.52, 0.55, 0, 0.85], [0, 0.85, -0.52, 0.55], [-0.52, 0.55, -0.6, 0], [-0.6, 0, -0.52, -0.55], [-0.52, -0.55, 0, -0.85], [0.15, 0.35, 0.65, 0.9]],
  R: [[-0.5, 0.85, -0.5, -0.85], [-0.5, -0.85, 0.35, -0.85], [0.35, -0.85, 0.55, -0.4], [0.55, -0.4, 0.35, 0.05], [0.35, 0.05, -0.5, 0.05], [0.05, 0.05, 0.58, 0.85]],
  S: [[0.48, -0.65, 0.05, -0.85], [0.05, -0.85, -0.45, -0.62], [-0.45, -0.62, -0.45, -0.2], [-0.45, -0.2, 0.45, 0.18], [0.45, 0.18, 0.48, 0.62], [0.48, 0.62, 0, 0.85], [0, 0.85, -0.5, 0.62]],
  T: [[-0.6, -0.85, 0.6, -0.85], [0, -0.85, 0, 0.85]],
  U: [[-0.52, -0.85, -0.52, 0.45], [-0.52, 0.45, -0.2, 0.85], [-0.2, 0.85, 0.2, 0.85], [0.2, 0.85, 0.52, 0.45], [0.52, 0.45, 0.52, -0.85]],
  V: [[-0.6, -0.85, 0, 0.85], [0, 0.85, 0.6, -0.85]],
  W: [[-0.72, -0.85, -0.4, 0.85], [-0.4, 0.85, 0, -0.15], [0, -0.15, 0.4, 0.85], [0.4, 0.85, 0.72, -0.85]],
  X: [[-0.55, -0.85, 0.55, 0.85], [0.55, -0.85, -0.55, 0.85]],
  Y: [[-0.58, -0.85, 0, 0.02], [0.58, -0.85, 0, 0.02], [0, 0.02, 0, 0.85]],
  Z: [[-0.55, -0.85, 0.55, -0.85], [0.55, -0.85, -0.55, 0.85], [-0.55, 0.85, 0.55, 0.85]],
};

function glyphDistance(nx: number, ny: number, motif: AppLogoMotif, letters: string): {
  dist: number;
  accentDist: number;
} {
  // Coordinates are in [-1, 1] inside the emblem box
  if (motif === 'play') {
    const tri = sdTriangle(nx, ny, -0.24, -0.34, 0.36, 0, -0.24, 0.34);
    const ring = Math.abs(Math.hypot(nx, ny) - 0.58) - 0.045;
    return { dist: tri, accentDist: ring };
  }

  if (motif === 'chat') {
    const bubble = sdRoundedRect(nx, ny + 0.04, 0.44, 0.34, 0.18);
    const tail = sdTriangle(nx, ny, -0.28, 0.25, -0.05, 0.34, -0.38, 0.5);
    const body = Math.min(bubble, tail);
    const dot1 = Math.hypot(nx + 0.18, ny + 0.04) - 0.055;
    const dot2 = Math.hypot(nx, ny + 0.04) - 0.055;
    const dot3 = Math.hypot(nx - 0.18, ny + 0.04) - 0.055;
    const dots = Math.min(dot1, dot2, dot3);
    // Cut dots out of bubble or highlight as accent
    return { dist: Math.max(body, -dots), accentDist: dots };
  }

  if (motif === 'bag') {
    const bagBody = sdRoundedRect(nx, ny - 0.12, 0.38, 0.32, 0.1);
    const handle = Math.abs(Math.hypot(nx, ny + 0.2) - 0.2) - 0.048;
    const upperHandle = ny < -0.18 ? handle : 1;
    const clasp = Math.hypot(nx, ny - 0.06) - 0.07;
    return { dist: Math.min(bagBody, upperHandle), accentDist: clasp };
  }

  if (motif === 'music') {
    const note1 = Math.hypot((nx + 0.18) * 0.9, ny - 0.28) - 0.13;
    const note2 = Math.hypot((nx - 0.22) * 0.9, ny - 0.18) - 0.13;
    const stem1 = sdSegment(nx, ny, -0.08, 0.26, -0.08, -0.34) - 0.045;
    const stem2 = sdSegment(nx, ny, 0.32, 0.16, 0.32, -0.44) - 0.045;
    const beam = sdSegment(nx, ny, -0.08, -0.34, 0.32, -0.44) - 0.065;
    const all = Math.min(note1, note2, stem1, stem2, beam);
    return { dist: all, accentDist: 1 };
  }

  if (motif === 'camera') {
    const body = sdRoundedRect(nx, ny - 0.03, 0.46, 0.34, 0.12);
    const topBump = sdRoundedRect(nx, ny + 0.36, 0.18, 0.09, 0.05);
    const outer = Math.min(body, topBump);
    const lensRing = Math.hypot(nx, ny - 0.03) - 0.16;
    const lensInner = Math.hypot(nx, ny - 0.03) - 0.085;
    return { dist: Math.max(outer, -lensRing), accentDist: lensInner };
  }

  if (motif === 'heart') {
    const c1 = Math.hypot(nx + 0.19, ny + 0.12) - 0.22;
    const c2 = Math.hypot(nx - 0.19, ny + 0.12) - 0.22;
    const tri = sdTriangle(nx, ny, -0.39, -0.04, 0.39, -0.04, 0, 0.42);
    return { dist: Math.min(c1, c2, tri), accentDist: 1 };
  }

  if (motif === 'bolt') {
    const top = sdTriangle(nx, ny, 0.08, -0.48, -0.28, 0.04, 0.06, 0.04);
    const bot = sdTriangle(nx, ny, -0.06, -0.04, 0.28, -0.04, -0.08, 0.48);
    return { dist: Math.min(top, bot), accentDist: 1 };
  }

  if (motif === 'wallet') {
    const outer = sdRoundedRect(nx, ny, 0.46, 0.34, 0.12);
    const clasp = sdRoundedRect(nx - 0.22, ny, 0.18, 0.1, 0.05);
    return { dist: Math.max(outer, -clasp), accentDist: Math.hypot(nx - 0.18, ny) - 0.055 };
  }

  if (motif === 'map') {
    const head = Math.hypot(nx, ny + 0.12) - 0.28;
    const tail = sdTriangle(nx, ny, -0.24, -0.02, 0.24, -0.02, 0, 0.46);
    const hole = Math.hypot(nx, ny + 0.12) - 0.11;
    return { dist: Math.max(Math.min(head, tail), -hole), accentDist: 1 };
  }

  if (motif === 'flame') {
    const outer = Math.min(
      Math.hypot(nx, ny - 0.14) - 0.28,
      sdTriangle(nx, ny, -0.27, 0.08, 0.27, 0.08, 0, -0.46)
    );
    const core = Math.hypot(nx, ny - 0.18) - 0.12;
    return { dist: Math.max(outer, -core), accentDist: core };
  }

  if (motif === 'star' || motif === 'spark') {
    // Crisp 4-point star / diamond sparkle
    const sx = Math.abs(nx);
    const sy = Math.abs(ny);
    const d1 = (sx + sy * 0.38 - 0.42) * 0.72;
    const d2 = (sy + sx * 0.38 - 0.42) * 0.72;
    const star = Math.min(Math.max(sx - 0.45, d2), Math.max(sy - 0.45, d1));
    const mini = Math.hypot(nx - 0.34, ny + 0.34) - 0.075;
    return { dist: star, accentDist: mini };
  }

  // Geometric monogram letters ('letter')
  const chars = (letters || 'A').replace(/[^A-Z]/g, '').slice(0, 2) || 'A';
  let minD = 1e6;
  const count = chars.length;
  for (let idx = 0; idx < count; idx += 1) {
    const segs = GLYPH_SEGMENTS[chars[idx]] || GLYPH_SEGMENTS.A;
    const scale = count === 1 ? 0.34 : 0.24;
    const offsetX = count === 1 ? 0 : idx === 0 ? -0.21 : 0.21;
    const lx = (nx - offsetX) / scale;
    const ly = ny / scale;
    for (const [ax, ay, bx, by] of segs) {
      const segD = (sdSegment(lx, ly, ax, ay, bx, by) - 0.22) * scale;
      if (segD < minD) minD = segD;
    }
  }
  return { dist: minD, accentDist: 1 };
}

export function renderAppIconPng(
  config: AppLogoConfig,
  size: number,
  options?: { maskable?: boolean; opaqueFullBleed?: boolean }
): Buffer {
  const s = Math.max(32, Math.min(512, Math.floor(size)));
  const rgba = new Uint8Array(s * s * 4);

  const bgTop = hexToRgb(lightenHex(config.bgColor, 0.08));
  const bgBot = hexToRgb(darkenHex(config.bgColor, 0.32));
  const accentRgb = hexToRgb(config.accentColor);
  const fgRgb = hexToRgb(config.fgColor);

  const fullBleed = Boolean(options?.maskable || options?.opaqueFullBleed);
  const glyphScale = options?.maskable ? 1.48 : 1.15; // extra safe zone for maskable
  const aaWidth = 2.0 / s;

  // 2x2 supersampling for crisp edges
  const offsets = [0.25, 0.75];

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (const oy of offsets) {
        for (const ox of offsets) {
          const u = ((x + ox) / s) * 2 - 1;
          const v = ((y + oy) / s) * 2 - 1;

          // Rounded squircle mask unless full-bleed
          let shapeAlpha = 1;
          if (!fullBleed) {
            const rectD = sdRoundedRect(u, v, 0.94, 0.94, 0.42);
            shapeAlpha = Math.max(0, Math.min(1, 0.5 - rectD / (aaWidth * 1.4)));
          }
          if (shapeAlpha <= 0) continue;

          // Rich diagonal gradient + soft top-left glow
          const gradT = Math.max(0, Math.min(1, (u * 0.35 + v * 0.65 + 1) * 0.5));
          let pixel = mixRgb(bgTop, bgBot, gradT);

          const glowDist = Math.hypot(u + 0.35, v + 0.45);
          const glowStrength = Math.max(0, 1 - glowDist / 1.15) * 0.28;
          pixel = mixRgb(pixel, accentRgb, glowStrength);

          // Glyph in centered box
          const g = glyphDistance(u * glyphScale, v * glyphScale, config.motif, config.letters);
          const fgCoverage = Math.max(0, Math.min(1, 0.5 - (g.dist / glyphScale) / aaWidth));
          const accCoverage = Math.max(
            0,
            Math.min(1, 0.5 - (g.accentDist / glyphScale) / aaWidth)
          );

          if (accCoverage > 0) {
            pixel = mixRgb(pixel, accentRgb, accCoverage);
          }
          if (fgCoverage > 0) {
            pixel = mixRgb(pixel, fgRgb, fgCoverage);
          }

          rSum += pixel.r * shapeAlpha;
          gSum += pixel.g * shapeAlpha;
          bSum += pixel.b * shapeAlpha;
          aSum += 255 * shapeAlpha;
        }
      }

      const idx = (y * s + x) * 4;
      const samples = 4;
      const a = Math.round(aSum / samples);
      if (a > 0) {
        rgba[idx] = Math.round(rSum / (aSum / 255) / samples);
        rgba[idx + 1] = Math.round(gSum / (aSum / 255) / samples);
        rgba[idx + 2] = Math.round(bSum / (aSum / 255) / samples);
      }
      rgba[idx + 3] = a;
    }
  }

  return encodeRgbaPng(s, s, rgba);
}

export function renderAppIconSvg(config: AppLogoConfig): string {
  if (config.customSvg) {
    let svg = config.customSvg.trim();
    if (!/\bxmlns=/.test(svg)) {
      svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
  }

  const top = lightenHex(config.bgColor, 0.08);
  const bot = darkenHex(config.bgColor, 0.32);
  const fg = config.fgColor;
  const acc = config.accentColor;

  let glyphMarkup = '';
  switch (config.motif) {
    case 'play':
      glyphMarkup = `<circle cx="64" cy="64" r="36" fill="none" stroke="${acc}" stroke-width="5"/><polygon points="52,44 86,64 52,84" fill="${fg}"/>`;
      break;
    case 'chat':
      glyphMarkup = `<path d="M30 46c0-9 7-16 16-16h36c9 0 16 7 16 16v26c0 9-7 16-16 16H52l-16 12V86c-4-3-6-8-6-14V46z" fill="${fg}"/><circle cx="50" cy="59" r="4.5" fill="${acc}"/><circle cx="64" cy="59" r="4.5" fill="${acc}"/><circle cx="78" cy="59" r="4.5" fill="${acc}"/>`;
      break;
    case 'bag':
      glyphMarkup = `<path d="M48 48v-6a16 16 0 0 1 32 0v6" fill="none" stroke="${fg}" stroke-width="6" stroke-linecap="round"/><rect x="34" y="48" width="60" height="48" rx="12" fill="${fg}"/><circle cx="64" cy="68" r="6" fill="${acc}"/>`;
      break;
    case 'music':
      glyphMarkup = `<path d="M54 80V40l34-8v40" fill="none" stroke="${fg}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="44" cy="82" r="11" fill="${fg}"/><circle cx="78" cy="74" r="11" fill="${acc}"/>`;
      break;
    case 'camera':
      glyphMarkup = `<rect x="28" y="42" width="72" height="50" rx="14" fill="${fg}"/><path d="M48 42l5-10h22l5 10" fill="${fg}"/><circle cx="64" cy="67" r="14" fill="${bot}"/><circle cx="64" cy="67" r="7" fill="${acc}"/>`;
      break;
    case 'heart':
      glyphMarkup = `<path d="M64 96S30 74 30 50a18 18 0 0 1 34-8 18 18 0 0 1 34 8c0 24-34 46-34 46z" fill="${fg}"/>`;
      break;
    case 'bolt':
      glyphMarkup = `<polygon points="69,26 40,68 62,68 58,102 88,58 66,58" fill="${fg}"/>`;
      break;
    case 'wallet':
      glyphMarkup = `<rect x="28" y="40" width="72" height="50" rx="14" fill="${fg}"/><rect x="68" y="57" width="34" height="16" rx="8" fill="${bot}"/><circle cx="78" cy="65" r="4.5" fill="${acc}"/>`;
      break;
    case 'map':
      glyphMarkup = `<path d="M64 28a24 24 0 0 0-24 24c0 18 24 48 24 48s24-30 24-48a24 24 0 0 0-24-24z" fill="${fg}"/><circle cx="64" cy="52" r="9" fill="${bot}"/>`;
      break;
    case 'flame':
      glyphMarkup = `<path d="M66 26c8 14 22 24 22 42a24 24 0 0 1-48 0c0-13 8-24 16-32 1 8 5 12 10 12 0-8 0-16 0-22z" fill="${fg}"/><circle cx="64" cy="76" r="9" fill="${acc}"/>`;
      break;
    case 'star':
    case 'spark':
      glyphMarkup = `<path d="M64 28l9 27 27 9-27 9-9 27-9-27-27-9 27-9z" fill="${fg}"/><circle cx="92" cy="36" r="6" fill="${acc}"/>`;
      break;
    default: {
      const escaped = config.letters.replace(/</g, '').slice(0, 2) || 'A';
      glyphMarkup = `<text x="64" y="77" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="800" font-size="${
        escaped.length > 1 ? '44' : '54'
      }" fill="${fg}" letter-spacing="-1">${escaped}</text>`;
      break;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${top}" />
      <stop offset="100%" stop-color="${bot}" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)" />
  ${glyphMarkup}
</svg>`;
}
