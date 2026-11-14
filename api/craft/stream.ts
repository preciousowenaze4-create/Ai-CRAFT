import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { enforceAndConsumeGenerationCredit } from '../_billing.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface NormalizedOpenRouterModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  isFree: boolean;
}

interface OpenRouterApiModel {
  id?: string;
  name?: string;
  context_length?: number;
  endpoints?: string[];
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
}

class OpenRouterApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenRouterApiError';
    this.status = status;
  }
}

function cleanEnvKey(raw: string | undefined, placeholders: string[]): string {
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

function getOpenRouterApiKey(): string {
  const candidates = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPEN_ROUTER_API_KEY,
    process.env.OPENROUTER_KEY,
    process.env.OPENROUTER_API,
    process.env.OPENROUTER_TOKEN,
    process.env.NEXT_PUBLIC_OPENROUTER_API_KEY,
    process.env.VITE_OPENROUTER_API_KEY,
  ];
  for (const raw of candidates) {
    const cleaned = cleanEnvKey(raw, ['MY_OPENROUTER_API_KEY']);
    if (!cleaned || cleaned.startsWith('AIza')) continue;
    return cleaned;
  }
  const apiKey = cleanEnvKey(process.env.API_KEY, ['MY_OPENROUTER_API_KEY']);
  if (apiKey.startsWith('sk-or-')) return apiKey;
  return '';
}

function createGeminiClient() {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.VITE_GEMINI_API_KEY,
  ];
  let apiKey = '';
  for (const raw of candidates) {
    const cleaned = cleanEnvKey(raw, ['MY_GEMINI_API_KEY']);
    if (cleaned) {
      apiKey = cleaned;
      break;
    }
  }
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isRestrictedHarnessModel(id: string): boolean {
  return id.endsWith(':batch') || id.startsWith('thinkingmachines/');
}

function resolveModelInfo(
  modelId: string,
  catalog: NormalizedOpenRouterModel[]
): { id: string; name: string; provider: string } {
  const found = catalog.find((m) => m.id === modelId);
  if (found) {
    return { id: found.id, name: found.name, provider: found.provider };
  }
  const slashIdx = modelId.indexOf('/');
  const provider = slashIdx > 0 ? modelId.slice(0, slashIdx) : 'openrouter';
  const shortName = slashIdx > 0 ? modelId.slice(slashIdx + 1) : modelId;
  return { id: modelId, name: shortName, provider };
}

async function fetchFreeOpenRouterFallbacks(
  apiKey: string,
  referer: string
): Promise<NormalizedOpenRouterModel[]> {
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': referer,
        'X-Title': 'AI Craft',
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: OpenRouterApiModel[] };
    const list = Array.isArray(json?.data) ? json.data : [];
    const out: NormalizedOpenRouterModel[] = [];

    for (const item of list) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!id || isRestrictedHarnessModel(id)) continue;
      if (
        Array.isArray(item?.endpoints) &&
        item.endpoints.length > 0 &&
        !item.endpoints.includes('/api/v1/chat/completions')
      ) {
        continue;
      }
      const promptPrice = Number(item?.pricing?.prompt ?? 1);
      const completionPrice = Number(item?.pricing?.completion ?? 1);
      const isFree =
        id.endsWith(':free') ||
        (Number.isFinite(promptPrice) &&
          Number.isFinite(completionPrice) &&
          promptPrice === 0 &&
          completionPrice === 0);
      if (!isFree) continue;
      const slashIndex = id.indexOf('/');
      out.push({
        id,
        name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : id,
        provider: slashIndex > 0 ? id.slice(0, slashIndex) : 'openrouter',
        contextLength: typeof item?.context_length === 'number' ? item.context_length : 0,
        isFree: true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenRouterMessageContent = string | OpenRouterContentPart[];

interface OpenRouterChatMessage {
  role: 'user' | 'assistant';
  content: OpenRouterMessageContent;
}

interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
  source: string;
  imageUrl?: string;
}

interface SearchImageItem {
  title: string;
  imageUrl: string;
  source: string;
}

async function fetchWithTimeout(url: string, timeoutMs = 2800): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AICraft-WebSearch/1.0',
        Accept: 'application/json',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runLiveBrowserSearch(query: string): Promise<{
  query: string;
  results: SearchResultItem[];
  images: SearchImageItem[];
}> {
  const cleanQuery = query.trim().slice(0, 260);
  if (!cleanQuery) {
    return { query: '', results: [], images: [] };
  }

  const results: SearchResultItem[] = [];
  const images: SearchImageItem[] = [];
  const seenUrls = new Set<string>();
  const seenImages = new Set<string>();

  const addResult = (item: SearchResultItem) => {
    if (!item.snippet.trim() && !item.title.trim()) return;
    const key = item.url || item.title.toLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    results.push(item);
  };

  const addImage = (title: string, imageUrl: string | undefined, source: string) => {
    if (!imageUrl || !/^https:\/\//i.test(imageUrl)) return;
    if (!/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(imageUrl)) return;
    if (seenImages.has(imageUrl)) return;
    seenImages.add(imageUrl);
    images.push({ title: title || cleanQuery, imageUrl, source });
  };

  const ddgTask = (async () => {
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(
        cleanQuery
      )}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetchWithTimeout(ddgUrl, 2600);
      if (!res.ok) return;
      const data = (await res.json()) as {
        Heading?: string;
        AbstractText?: string;
        AbstractURL?: string;
        AbstractSource?: string;
        Image?: string;
        Answer?: string;
        RelatedTopics?: Array<{
          Text?: string;
          FirstURL?: string;
          Topics?: Array<{ Text?: string; FirstURL?: string }>;
        }>;
      };

      if (data.Image && /^https?:\/\//i.test(data.Image)) {
        const normalizedImg = data.Image.startsWith('http://')
          ? `https://${data.Image.slice(7)}`
          : data.Image;
        addImage(data.Heading || cleanQuery, normalizedImg, 'DuckDuckGo');
      }

      if (data.Answer) {
        addResult({
          title: data.Heading || cleanQuery,
          snippet: data.Answer,
          url: data.AbstractURL || '',
          source: 'DuckDuckGo Instant Answer',
        });
      }

      if (data.AbstractText) {
        addResult({
          title: data.Heading || cleanQuery,
          snippet: data.AbstractText,
          url: data.AbstractURL || '',
          source: data.AbstractSource || 'DuckDuckGo',
        });
      }

      const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
      for (const item of related) {
        if (item.Text && item.FirstURL) {
          addResult({
            title: item.Text.split(' - ')[0] || cleanQuery,
            snippet: item.Text,
            url: item.FirstURL,
            source: 'Web',
          });
        } else if (Array.isArray(item.Topics)) {
          for (const sub of item.Topics.slice(0, 3)) {
            if (sub.Text && sub.FirstURL) {
              addResult({
                title: sub.Text.split(' - ')[0] || cleanQuery,
                snippet: sub.Text,
                url: sub.FirstURL,
                source: 'Web',
              });
            }
          }
        }
        if (results.length >= 6) break;
      }
    } catch {
      // ignore timeout or network failure
    }
  })();

  const wikiTask = (async () => {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        cleanQuery
      )}&gsrlimit=4&prop=pageimages|extracts&pithumbsize=720&exintro=1&explaintext=1&exchars=240&format=json`;
      const res = await fetchWithTimeout(wikiUrl, 2600);
      if (!res.ok) return;
      const data = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid?: number;
              title?: string;
              extract?: string;
              thumbnail?: { source?: string };
            }
          >;
        };
      };
      const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
      for (const page of pages) {
        const title = page.title?.trim() || '';
        const snippet = (page.extract || '').trim();
        const thumb = page.thumbnail?.source?.trim();
        if (thumb) {
          addImage(title || cleanQuery, thumb, 'Wikipedia Images');
        }
        if (title && snippet) {
          addResult({
            title,
            snippet,
            url: `https://en.wikipedia.org/?curid=${page.pageid ?? ''}`,
            source: 'Wikipedia',
            ...(thumb && /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(thumb)
              ? { imageUrl: thumb }
              : {}),
          });
        }
      }
    } catch {
      // ignore timeout or network failure
    }
  })();

  const commonsTask = (async () => {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
        cleanQuery
      )}&gsrlimit=5&prop=imageinfo&iiprop=url|mime&iiurlwidth=720&format=json`;
      const res = await fetchWithTimeout(commonsUrl, 2600);
      if (!res.ok) return;
      const data = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              title?: string;
              imageinfo?: Array<{ thumburl?: string; url?: string; mime?: string }>;
            }
          >;
        };
      };
      const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
      for (const page of pages) {
        const info = page.imageinfo?.[0];
        const mime = info?.mime || '';
        if (!/^image\/(jpeg|png|webp)$/i.test(mime)) continue;
        const imgUrl = info?.thumburl || info?.url;
        const cleanTitle = (page.title || cleanQuery)
          .replace(/^File:/i, '')
          .replace(/\.[a-z0-9]+$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim();
        addImage(cleanTitle, imgUrl, 'Wikimedia Commons');
      }
    } catch {
      // ignore timeout or network failure
    }
  })();

  await Promise.allSettled([ddgTask, wikiTask, commonsTask]);
  return {
    query: cleanQuery,
    results: results.slice(0, 8),
    images: images.slice(0, 6),
  };
}

function formatWebSearchContext(searchData: {
  query: string;
  results: SearchResultItem[];
  images?: SearchImageItem[];
}): string {
  const sections: string[] = [];

  if (searchData.results && searchData.results.length > 0) {
    const lines = searchData.results.map(
      (item, idx) =>
        `${idx + 1}. [${item.source}] ${item.title}: ${item.snippet}${
          item.url ? ` (${item.url})` : ''
        }`
    );
    sections.push(
      `Live Browser & Web Search Results for "${searchData.query}":\n${lines.join('\n')}`
    );
  }

  if (searchData.images && searchData.images.length > 0) {
    const imgLines = searchData.images.map(
      (img, idx) => `${idx + 1}. ${img.title} (${img.source}): ${img.imageUrl}`
    );
    sections.push(
      `Verified Image Search Results (real HTTPS image URLs—only use these exact URLs with onerror gradient fallback if relevant):\n${imgLines.join('\n')}`
    );
  }

  if (sections.length === 0) return '';
  sections.push(
    'Use these verified real-world facts and real images naturally in your design and app data when relevant.'
  );
  return sections.join('\n\n');
}

function shouldRunChatSearch(message: string, hasPreviousHtml = false): boolean {
  const clean = message.trim();
  if (clean.length < 4) return false;
  if (
    /^(hi|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|cool|nice|great|awesome|lol|haha|good morning|good afternoon|good evening|good night|bye)[!.\s]*$/i.test(
      clean
    )
  ) {
    return false;
  }
  if (
    hasPreviousHtml &&
    /\b(this app|the app|my app|this screen|the screen|the preview|you built|you made|you added|what does (it|this)|how does (it|this)|why is (it|this|there))\b/i.test(
      clean
    ) &&
    !/\b(search|google|look up|online|internet|weather|news|price|live data|stock)\b/i.test(
      clean
    )
  ) {
    return false;
  }
  return true;
}

type InitialRoute = 'chat' | 'build' | 'auto';

function classifyInitialRoute(
  message: string,
  previousHtml: string,
  attachmentName?: string | null,
  hasAttachmentData = false
): InitialRoute {
  const text = message.trim();
  if (!text) return 'chat';

  const isPoliteBuildCommand =
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:build|create|make|design|code|craft|develop|fix|change|edit|update|add|remove|cut|delete|replace|redesign|upgrade|do)\b/i.test(
      text
    );

  if (attachmentName || hasAttachmentData) {
    const asksPureQuestion =
      (/\?$/.test(text) ||
        /^(what|why|how|who|where|when|which|is|are|does|do|explain|tell me)\b/i.test(
          text
        )) &&
      !isPoliteBuildCommand &&
      !/\b(fix|change|edit|cut|remove|delete|build|make|create|update|add|keep|stay|replace|redesign|take out)\b/i.test(
        text
      );
    return asksPureQuestion ? 'auto' : 'build';
  }

  // Pure conversational greetings & acknowledgments
  if (
    /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|good night|thanks|thank you|ok|okay|cool|nice|great|awesome|how are you|who are you|what time|what day|what date)\b/i.test(
      text
    ) &&
    !/\b(build|create|make|app|website|web\s*app|change|fix|update|remove|add|cut)\b/i.test(
      text
    )
  ) {
    return 'chat';
  }

  // Explicit conversational questions/explanations (even after an app is already built)
  if (
    /\b(tell me a joke|make me laugh|make sense|make sure|write a (poem|story|essay|email|song|letter)|what time|what day|what date|who are you|what model|how are you|explain\b|define\b|what is\b|what are\b|what does\b|why is\b|why are\b|why did\b|why does\b|how does\b|how do i\b|how did\b|how many\b)\b/i.test(
      text
    ) &&
    !isPoliteBuildCommand &&
    !/\b(do my app|build me|create me|make me)\b/i.test(text)
  ) {
    return 'chat';
  }

  // Questions ending in '?' that are not polite build/edit commands: let AI think & decide cleanly
  if (/\?\s*$/.test(text) && !isPoliteBuildCommand) {
    return 'auto';
  }

  const hasExplicitAppArtifact =
    /\b(app|mobile\s*app|ios\s*app|android\s*app|website|web\s*app|webpage|landing\s*page|site|storefront|dashboard|ecommerce|e-commerce|online\s*store|store|shop|portfolio|calculator|tracker|clone|prototype|ui|ux|screen|html|preview|widget|interface|todo|to-do|game|player|quiz|planner|calendar|timer|clock|notes|chat\s*app|social|feed|blog|portal|tool|system|manager|finder|generator|converter|form|login|signup|tiktok|instagram|youtube|spotify|netflix|twitter|whatsapp|uber|airbnb|amazon)\b/i.test(
      text
    );

  const hasBuildVerb =
    /\b(build|create|make|design|develop|generate|craft|code|scaffold|implement|redesign|upgrade|convert|do|want|need|give)\b/i.test(
      text
    );

  if (hasExplicitAppArtifact && (hasBuildVerb || /\b(for me|like)\b/i.test(text))) {
    return 'build';
  }

  if (
    /^(?:please\s+)?(?:build|create|make|design|scaffold|craft)\s+(?:me\s+)?(?:an?|the|my)\s+/i.test(
      text
    ) &&
    !/\b(summary|poem|story|joke|essay|recipe|explanation|sentence|paragraph|list|plan)\b/i.test(
      text
    )
  ) {
    return 'build';
  }

  if (
    previousHtml.trim().length > 0 &&
    !/^(what|why|how|who|where|when|which|is|are|does|do|did|should|would|could)\b/i.test(
      text
    ) &&
    /\b(change|update|modify|edit|fix|add|remove|cut|delete|take\s*out|replace|make\s+it|switch|turn|redesign|upgrade|rebuild|restructure)\b/i.test(
      text
    )
  ) {
    return 'build';
  }

  return 'auto';
}

interface LiveBuildArtifact {
  path: string;
  action: string;
}

const START_MARKER = '<<<AICRAFT_APP_HTML>>>';
const END_MARKER = '<<<END_AICRAFT_APP_HTML>>>';
const HOLDBACK_CHARS = 36;

function findCodeStart(
  raw: string
): { markerIdx: number; htmlOffset: number } | null {
  const markerMatch = /<<<\s*AICRAFT_APP_HTML\s*>>>/i.exec(raw);
  if (markerMatch && markerMatch.index !== undefined) {
    return {
      markerIdx: markerMatch.index,
      htmlOffset: markerMatch.index + markerMatch[0].length,
    };
  }

  const fenceMatch =
    /```(?:html|htm)?\s*\n?\s*(?=<!doctype|<html|<head|<body|<style|<div|<main|<section)/i.exec(
      raw
    );
  if (fenceMatch && fenceMatch.index !== undefined) {
    return {
      markerIdx: fenceMatch.index,
      htmlOffset: fenceMatch.index + fenceMatch[0].length,
    };
  }

  const rawHtmlMatch = /(?:^|\n)\s*(<!doctype\s+html|<html\b)/i.exec(raw);
  if (rawHtmlMatch && rawHtmlMatch.index !== undefined) {
    const tagIdx = raw.indexOf(rawHtmlMatch[1], rawHtmlMatch.index);
    return { markerIdx: tagIdx, htmlOffset: tagIdx };
  }

  return null;
}

function assembleHtmlFromScatteredBlocks(raw: string): string {
  const htmlBlocks: string[] = [];
  const cssBlocks: string[] = [];
  const jsBlocks: string[] = [];

  const fenceRegex = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const content = (match[2] || '').trim();
    if (!content) continue;

    if (lang === 'html' || lang === 'htm') {
      htmlBlocks.push(content);
    } else if (lang === 'css') {
      cssBlocks.push(content);
    } else if (lang === 'js' || lang === 'javascript') {
      jsBlocks.push(content);
    } else if (!lang && /<[a-z][^>]*>/i.test(content)) {
      htmlBlocks.push(content);
    }
  }

  if (htmlBlocks.length === 0) return '';

  let bodyHtml = htmlBlocks.join('\n');
  if (/<!doctype|<html\b/i.test(bodyHtml)) {
    if (cssBlocks.length > 0 && !/<style\b/i.test(bodyHtml)) {
      const styleTag = `<style>\n${cssBlocks.join('\n\n')}\n</style>`;
      bodyHtml = /<\/head>/i.test(bodyHtml)
        ? bodyHtml.replace(/<\/head>/i, `${styleTag}\n</head>`)
        : `${styleTag}\n${bodyHtml}`;
    }
    if (jsBlocks.length > 0 && !/<script(?![^>]*\bsrc=)[^>]*>/i.test(bodyHtml)) {
      const scriptTag = `<script>\n${jsBlocks.join('\n\n')}\n</script>`;
      bodyHtml = /<\/body>/i.test(bodyHtml)
        ? bodyHtml.replace(/<\/body>/i, `${scriptTag}\n</body>`)
        : `${bodyHtml}\n${scriptTag}`;
    }
    return bodyHtml.trim();
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; min-height: 100dvh; width: 100%; font-family: system-ui, -apple-system, sans-serif; }
  ${cssBlocks.join('\n\n')}
</style>
</head>
<body>
${bodyHtml}
${jsBlocks.length > 0 ? `<script>\n${jsBlocks.join('\n\n')}\n</script>` : ''}
</body>
</html>`;
}

function extractPreviewHtmlFromRaw(raw: string): string {
  const codeStart = findCodeStart(raw);
  if (codeStart) {
    let rawHtml = raw.slice(codeStart.htmlOffset);
    const endMarkerMatch = /<<<\s*END_AICRAFT_APP_HTML\s*>>>/i.exec(rawHtml);
    if (endMarkerMatch && endMarkerMatch.index !== undefined) {
      rawHtml = rawHtml.slice(0, endMarkerMatch.index);
    }
    rawHtml = rawHtml
      .trim()
      .replace(/^```(?:html|htm)?\s*/i, '')
      .replace(/\s*```[\s\S]*$/i, '')
      .trim();

    if (rawHtml && /<[a-z][\s\S]*>/i.test(rawHtml)) {
      if (!/<!doctype|<html\b/i.test(rawHtml)) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
</head>
<body style="margin:0;min-height:100dvh;width:100%;">
${rawHtml}
</body>
</html>`;
      }
      return rawHtml;
    }
  }

  return assembleHtmlFromScatteredBlocks(raw);
}

function extractPreviewStructureSummary(previousHtml: string): string {
  if (!previousHtml.trim()) return '';
  const items = extractLiveBuildArtifacts(previousHtml).map((a) => `${a.action} ${a.path}`);
  const idMatches = Array.from(
    previousHtml.matchAll(/<(header|nav|main|section|aside|footer|div|form)\b[^>]*\bid=["']([^"']{1,40})["'][^>]*>/gi)
  )
    .slice(0, 18)
    .map((m) => `<${m[1].toLowerCase()} id="${m[2]}">`);

  return [
    `Live Preview already holds a rendered app (${previousHtml.length} chars).`,
    items.length > 0 ? `Existing artifacts: ${items.join(', ')}.` : '',
    idMatches.length > 0 ? `Existing DOM sections/IDs: ${idMatches.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function stripTagMarkers(text: string): string {
  return text
    .replace(/\[\[\s*INTENT\s*:\s*(?:CHAT|BUILD)\s*\]\]/gi, '')
    .replace(/\[\[\s*PLAN\s*:[^\]]*\]\]\s*\n?/gi, '')
    .replace(/\[\[\s*SUGGESTIONS\s*\]\][\s\S]*?(?:\[\[\s*\/\s*SUGGESTIONS\s*\]\]|$)/gi, '');
}

function sanitizeBuildProse(text: string): string {
  return stripTagMarkers(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```(?:html|htm|css|javascript|js|tsx|ts)?[\s\S]*/gi, '')
    .replace(/<<<\s*AICRAFT_APP_HTML\s*>>>[\s\S]*/gi, '')
    .replace(/<<<\s*END_AICRAFT_APP_HTML\s*>>>[\s\S]*/gi, '')
    .replace(/<!doctype\s+html[\s\S]*/gi, '')
    .replace(/<html\b[\s\S]*/gi, '')
    .replace(/^\s*(?:PART\s*[123]\s*[:\-–]?)\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractPlanStepsFromRaw(raw: string): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  const regex = /\[\[\s*PLAN\s*:\s*([^\]]+?)\s*\]\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const step = match[1].replace(/\s+/g, ' ').trim();
    if (step && !seen.has(step.toLowerCase())) {
      seen.add(step.toLowerCase());
      steps.push(step);
    }
    if (steps.length >= 6) break;
  }
  return steps;
}

function extractSuggestionsFromRaw(raw: string): string[] {
  const blockMatch =
    /\[\[\s*SUGGESTIONS\s*\]\]([\s\S]*?)(?:\[\[\s*\/\s*SUGGESTIONS\s*\]\]|$)/i.exec(raw);
  if (!blockMatch) return [];
  const lines = blockMatch[1]
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim()
    )
    .filter((line) => line.length >= 10 && line.length <= 120);

  const unique: string[] = [];
  for (const l of lines) {
    if (!unique.some((u) => u.toLowerCase() === l.toLowerCase())) {
      unique.push(l);
    }
    if (unique.length >= 4) break;
  }
  return unique;
}

function buildSmartFollowUpSuggestions(
  userMessage: string,
  previewHtml: string,
  mode: 'mobile' | 'web'
): string[] {
  const htmlLower = previewHtml.toLowerCase();
  const msgLower = userMessage.toLowerCase();
  const suggestions: string[] = [];

  if (!/checkout|stripe|payment|billing|receipt/i.test(htmlLower)) {
    suggestions.push('Add a working Pro checkout flow with instant unlock and receipt history');
  } else {
    suggestions.push('Upgrade the monetization dashboard with real-time revenue analytics and promo codes');
  }

  if (!/window\.aicraft\.search/i.test(htmlLower)) {
    suggestions.push('Connect live Google & image search inside the app so users can discover real items');
  } else if (!/dark|theme/i.test(msgLower)) {
    suggestions.push('Add a smooth dark/light theme switcher and custom accent color picker');
  }

  if (mode === 'mobile') {
    suggestions.push('Polish button placement, micro-animations, and add a quick onboarding tour');
  } else {
    suggestions.push('Add interactive real-time charts, filters, and one-click CSV data export');
  }

  return suggestions.slice(0, 3);
}

function extractLiveBuildArtifacts(htmlSoFar: string): LiveBuildArtifact[] {
  const clean = htmlSoFar.trim();
  if (!clean) return [];

  const artifacts: LiveBuildArtifact[] = [];
  const seen = new Set<string>();
  const add = (artifactPath: string, action: string) => {
    if (!seen.has(artifactPath)) {
      seen.add(artifactPath);
      artifacts.push({ path: artifactPath, action });
    }
  };

  add('index.html', 'Writing');

  if (/<style\b/i.test(clean)) {
    add('styles.css', 'Styling');
  }

  const tagRegex =
    /<(header|nav|canvas|form|footer)\b[^>]*>|<(?:section|template|article|main)\b[^>]*\bid=["']([a-zA-Z0-9_-]{2,32})["'][^>]*>|<\w+\b[^>]*\b(?:data-screen|data-view|data-tab|data-page)=["']([a-zA-Z0-9_-]{2,32})["'][^>]*>|<div\b[^>]*\bid=["']([a-zA-Z0-9_-]*(?:screen|view|page|tab|feed|profile|home|explore|discover|upload|create|inbox|chat|message|comment|search|cart|checkout|pricing|paywall|upgrade|pro|premium|billing|revenue|dashboard|settings|player|modal|notification|reel|story|wallet|analytics)[a-zA-Z0-9_-]*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(clean)) !== null) {
    const semanticTag = match[1]?.toLowerCase();
    const namedView = (match[2] || match[3] || match[4])?.toLowerCase();
    if (semanticTag) {
      if (semanticTag === 'canvas') {
        add('components/canvas.html', 'Rendering');
      } else if (semanticTag === 'nav') {
        add('components/navigation.html', 'Building');
      } else if (semanticTag === 'header') {
        add('components/header.html', 'Building');
      } else if (semanticTag === 'footer') {
        add('components/footer.html', 'Building');
      } else if (semanticTag === 'form') {
        add('components/form.html', 'Building');
      }
    } else if (
      namedView &&
      !/^(app|root|container|wrapper|main|body|content|page)$/i.test(namedView)
    ) {
      add(`screens/${namedView}.html`, 'Building');
    }
    if (artifacts.length >= 12) break;
  }

  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(clean)) {
    add('app.js', 'Scripting');
  }

  return artifacts;
}

function stripImagesFromMessages(
  messages: OpenRouterChatMessage[]
): OpenRouterChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') return msg;
    const textOnly = msg.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n');
    return {
      role: msg.role,
      content: textOnly || 'Please process the user request.',
    };
  });
}

async function streamOpenRouterCompletion(
  apiKey: string,
  referer: string,
  modelId: string,
  systemInstruction: string,
  messages: OpenRouterChatMessage[],
  onTextChunk: (chunkText: string) => void,
  onReasoningChunk?: () => void,
  signal?: AbortSignal
): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': referer,
    'X-Title': 'AI Craft',
  };

  const sendRequest = async (payloadMessages: OpenRouterChatMessage[]) =>
    fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        stream: true,
        messages: [
          { role: 'system', content: systemInstruction },
          ...payloadMessages,
        ],
      }),
      signal,
    });

  let response = await sendRequest(messages);
  const hasImages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
  );

  if (
    hasImages &&
    (!response.ok || !response.body) &&
    (response.status === 400 || response.status === 404 || response.status === 422)
  ) {
    await response.text().catch(() => '');
    response = await sendRequest(stripImagesFromMessages(messages));
  }

  if (!response.ok || !response.body) {
    let errorDetail = `OpenRouter error (${response.status})`;
    try {
      const errBody = (await response.json()) as {
        error?: { message?: string };
        message?: string;
      };
      if (errBody?.error?.message) {
        errorDetail = errBody.error.message;
      } else if (errBody?.message) {
        errorDetail = errBody.message;
      }
    } catch {
      const text = await response.text().catch(() => '');
      if (text) errorDetail = text.slice(0, 200);
    }
    throw new OpenRouterApiError(errorDetail, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let parsed: {
        error?: { message?: string };
        choices?: Array<{
          delta?: {
            reasoning?: string;
            reasoning_content?: string;
            content?: string | Array<{ type?: string; text?: string }>;
          };
        }>;
      };

      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed?.error?.message) {
        throw new Error(parsed.error.message);
      }

      const delta = parsed?.choices?.[0]?.delta;
      if ((delta?.reasoning || delta?.reasoning_content) && onReasoningChunk) {
        onReasoningChunk();
      }

      const content = delta?.content;
      if (typeof content === 'string' && content.length > 0) {
        onTextChunk(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part?.text === 'string' && part.text.length > 0) {
            onTextChunk(part.text);
          }
        }
      }
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const referer = process.env.APP_URL || `${reqUrl.protocol}//${reqUrl.host}`;

  let body: {
    message?: string;
    mode?: string;
    model?: string;
    clientTime?: string;
    clientTimeZone?: string;
    previousHtml?: string;
    history?: Array<{ role: string; text: string }>;
    options?: {
      reactEnabled?: boolean;
      backendEnabled?: boolean;
      webSearchEnabled?: boolean;
      forceChat?: boolean;
      attachmentName?: string | null;
      attachmentDataUrl?: string | null;
      attachmentMimeType?: string | null;
      attachmentText?: string | null;
    };
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const mode = body?.mode === 'web' ? 'web' : 'mobile';
  const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
  const clientTime = typeof body?.clientTime === 'string' ? body.clientTime.trim() : '';
  const clientTimeZone =
    typeof body?.clientTimeZone === 'string' ? body.clientTimeZone.trim() : '';
  const previousHtml = typeof body?.previousHtml === 'string' ? body.previousHtml : '';
  const history = Array.isArray(body?.history) ? body.history : [];
  const options = body?.options ?? {};
  const attachmentDataUrl =
    typeof options.attachmentDataUrl === 'string' &&
    options.attachmentDataUrl.startsWith('data:image/')
      ? options.attachmentDataUrl
      : null;
  const attachmentMimeType =
    typeof options.attachmentMimeType === 'string'
      ? options.attachmentMimeType
      : null;
  const attachmentText =
    typeof options.attachmentText === 'string' && options.attachmentText.trim()
      ? options.attachmentText.trim().slice(0, 12000)
      : null;
  const webSearchEnabled = options.webSearchEnabled !== false;

  if (!message) {
    return Response.json({ error: 'Prompt message is required.' }, { status: 400 });
  }

  const creditCheck = await enforceAndConsumeGenerationCredit(request, 1);
  if (!creditCheck.allowed) {
    return Response.json(
      {
        error: creditCheck.error,
        code: creditCheck.code,
        billing: creditCheck.billing,
      },
      { status: creditCheck.status }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const enqueueRaw = (raw: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(raw));
        }
      };

      const sendEvent = (payload: Record<string, unknown>) => {
        enqueueRaw(`data: ${JSON.stringify(payload)}\n\n`);
      };

      enqueueRaw(': connected\n\n');

      const keepAlive = setInterval(() => {
        enqueueRaw(': ping\n\n');
      }, 3000);

      const closeStream = () => {
        clearInterval(keepAlive);
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        const openRouterKey = getOpenRouterApiKey();
        const geminiClient = createGeminiClient();

        if (!openRouterKey && !geminiClient) {
          sendEvent({
            type: 'error',
            message:
              'No AI API key detected in Vercel Environment Variables yet. Save OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel and redeploy.',
          });
          closeStream();
          return;
        }

        const initialRoute: InitialRoute = options.forceChat
          ? 'chat'
          : classifyInitialRoute(
              message,
              previousHtml,
              options.attachmentName,
              Boolean(attachmentDataUrl || attachmentText)
            );

        const now = new Date();
        const timeContext = [
          clientTime ? `User local date/time: ${clientTime}` : '',
          clientTimeZone ? `User timezone: ${clientTimeZone}` : '',
          `Server UTC date/time: ${now.toUTCString()}`,
        ]
          .filter(Boolean)
          .join(' | ');

        // Always begin in normal Thinking mode — never jump straight to Building
        sendEvent({
          type: 'phase',
          phase: 'understanding',
          kind: 'chat',
          label: 'Thinking...',
        });

        let webSearchContext = '';
        if (
          webSearchEnabled &&
          (initialRoute !== 'chat' ||
            shouldRunChatSearch(message, previousHtml.trim().length > 0))
        ) {
          const searchData = await runLiveBrowserSearch(message);
          webSearchContext = formatWebSearchContext(searchData);
        }

        const targetLabel =
          mode === 'mobile'
            ? 'iOS & Android mobile app'
            : 'full-stack web application';
        const activeFlags: string[] = [];
        if (mode === 'web' && options.reactEnabled) activeFlags.push('React UI');
        if (options.backendEnabled) activeFlags.push('Backend database & API');
        if (webSearchEnabled) activeFlags.push('Live browser web search');
        if (options.attachmentName) {
          activeFlags.push(`Attached reference: ${options.attachmentName}`);
        }

        const previewSummary = extractPreviewStructureSummary(previousHtml);

        const buildRulesBlock = [
          'CALM ARCHITECTURAL DISCIPLINE — DO NOT RUSH INTO CODE:',
          'Before writing any HTML, slow down and think carefully like a senior product architect & monetization strategist:',
          'STEP 0 (Architectural Planning Lines): Output 4 short planning lines using exact format `[[PLAN: <step>]]` covering:',
          '  1) `[[PLAN: Color palette & typography — ...]]` (choose a refined, harmonious color palette, high-contrast surfaces, crisp font hierarchy)',
          '  2) `[[PLAN: Layout & button placement — ...]]` (plan clean visual structure, thumb-friendly 44px+ buttons, intuitive header & bottom nav placement, balanced spacing)',
          '  3) `[[PLAN: Real-time features & live media — ...]]` (plan real clocks/timers, localStorage persistence, live `window.AICraft.search(query)` / `window.AICraft.ask(prompt)`, and verified search images or crisp inline SVGs)',
          '  4) `[[PLAN: Monetization & growth flow — ...]]` (plan built-in interactive monetization tailored to the app: Pro/Premium plan sheet, monthly/annual toggle, credits/checkout drawer, creator tips, or revenue metrics)',
          'PART 1 (Architectural Overview & Feedback): Write 2–3 calm, clear plain-text sentences summarizing the structure, color choices, button layout, real-time functionality, and monetization you built, plus brief feedback on how it can grow next. ABSOLUTELY PROHIBITED IN PART 1: NEVER include raw code, HTML tags, CSS, JS, markdown code fences (```), backticks, or the words "PART 1" / "PART 2" / "PART 3", and NEVER tell the user to copy/paste code.',
          'PART 2 (Full-Screen Real-Time App): On a new line immediately output the exact marker <<<AICRAFT_APP_HTML>>> followed by a complete, thoughtfully crafted, self-contained, runnable <!DOCTYPE html> application ending with <<<END_AICRAFT_APP_HTML>>>.',
          'Rules for the HTML app in PART 2:',
          `- Design it as a refined ${targetLabel} experience inside AI Craft's full-screen Preview tab.`,
          '- COHESIVE COLOR & ERGONOMIC BUTTONS: Craft a polished color system (clean surface hierarchy, tasteful accent, accessible contrast), smooth transitions, and well-placed >= 44px touch-target buttons (clear primary CTA, uncluttered header, intuitive navigation).',
          '- BUILD & MONETIZE IN REAL TIME: Every app must include working interactive flows, real-time clock/date or live timers, `localStorage` persistence, plus a genuine interactive monetization feature tailored naturally to the app (such as a working Pro/Premium upgrade modal with monthly/annual switch, interactive checkout/wallet flow, creator tip jar, featured/sponsored tier, or live revenue/MRR widget).',
          '- GOOGLE/WEB SEARCH & REAL IMAGES: Use `await window.AICraft.search(query)` (automatically injected in Preview—returns `{ query, results, images }` with real snippets and `imageUrl`) and `await window.AICraft.ask(prompt)` for live AI responses/content. If you embed verified `https://` image URLs from the search grounding above, always include a clean `onerror` fallback so broken icons never appear; otherwise use crisp inline SVGs and CSS gradients.',
          '- SURGICAL SCREENSHOT & PREVIEW EDITING: When updating an existing Preview app or inspecting an attached screenshot, identify precisely what the user wants removed/cut vs. kept, remove ONLY what was requested, preserve everything else cleanly, and output the complete updated <!DOCTYPE html> app.',
          '- Organize multi-screen apps (like Feed, Discover, Pricing/Pro, Checkout, Profile, Settings, Dashboard) using semantic `<section id="...">`, `<nav>`, `<header>` tags.',
          '- Full-screen layout (`min-height: 100dvh; width: 100%; margin: 0;`) unless the user specifically asks for a compact widget.',
          'PART 3 (Next Suggested Upgrades): Immediately AFTER <<<END_AICRAFT_APP_HTML>>>, output:',
          '[[SUGGESTIONS]]',
          '<Short, specific, immediately tappable upgrade prompt 1>',
          '<Short, specific, immediately tappable upgrade prompt 2>',
          '<Short, specific, immediately tappable upgrade prompt 3>',
          '[[/SUGGESTIONS]]',
        ].join('\n');

        let systemInstruction = '';

        if (initialRoute === 'chat') {
          systemInstruction = [
            'You are AI Craft, a helpful, natural, real-time AI assistant with live browser search access.',
            `Real-time clock context: ${timeContext}.`,
            webSearchContext ? `\n${webSearchContext}` : '',
            previewSummary
              ? `\nContext about the user's current Preview app (for answering questions accurately without rebuilding):\n${previewSummary}`
              : '',
            'Respond directly and conversationally in real time to the user message.',
            'The user is chatting or asking a question right now — reply naturally without rebuilding the app or outputting HTML code.',
            'NEVER tell the user to copy and paste code. If they later ask you to build or change the app, you will build it into Preview.',
            'If the user asks for the current time, date, or day, use the real-time clock context above accurately.',
            'Keep formatting clean and readable.',
          ]
            .filter(Boolean)
            .join('\n');
        } else if (initialRoute === 'build') {
          systemInstruction = [
            'You are AI Craft, an expert autonomous mobile and full-stack product builder directly wired into a live full-screen Preview workspace.',
            `Real-time clock context: ${timeContext}.`,
            webSearchContext ? `\n${webSearchContext}` : '',
            previewSummary ? `\nLIVE PREVIEW ENVIRONMENT AWARENESS:\n${previewSummary}` : '',
            'CRITICAL OUTPUT CONTRACT — TWO STRICTLY SEPARATED PARTS:',
            buildRulesBlock,
            activeFlags.length > 0 ? `Enabled capabilities: ${activeFlags.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join('\n');
        } else {
          // 'auto': Think first, then choose either normal chat reply OR Preview app build
          systemInstruction = [
            'You are AI Craft, an intelligent real-time AI assistant AND autonomous product builder connected to a live Preview workspace.',
            `Real-time clock context: ${timeContext}.`,
            webSearchContext ? `\n${webSearchContext}` : '',
            previewSummary ? `\nLIVE PREVIEW ENVIRONMENT AWARENESS:\n${previewSummary}` : '',
            'THINK FIRST BEFORE RESPONDING:',
            'First decide carefully whether the user message is:',
            '(A) CHAT / QUESTION: A question, greeting, explanation request, feedback discussion, or normal conversation (even if an app was already built in Preview).',
            '    -> Start your output on the VERY FIRST LINE with exactly `[[INTENT:CHAT]]` followed by a newline, then write a natural, helpful conversational reply. Do NOT output HTML, code blocks, or rebuild the app.',
            '(B) BUILD / EDIT APP: A request to create/build a new app or website, OR a request to change, cut, remove, fix, or add something in the Preview app.',
            '    -> Start your output on the VERY FIRST LINE with exactly `[[INTENT:BUILD]]` followed by a newline, then output TWO strictly separated parts:',
            buildRulesBlock,
            activeFlags.length > 0 ? `Enabled capabilities: ${activeFlags.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join('\n');
        }

        const conversationMessages: OpenRouterChatMessage[] = history
          .slice(-8)
          .filter((item) => typeof item?.text === 'string' && item.text.trim().length > 0)
          .map((item) => ({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: item.text,
          }));

        const userTextParts: string[] = [];
        if (previousHtml && initialRoute !== 'chat') {
          userTextParts.push(
            `Existing Preview app HTML (for context or surgical updates if building/editing):\n${previousHtml.slice(0, 28000)}`
          );
        } else if (previousHtml && initialRoute === 'chat') {
          userTextParts.push(
            `Current Preview app summary (user is chatting/asking a question):\n${previewSummary}`
          );
        }
        if (attachmentText) {
          userTextParts.push(
            `Attached reference text (${options.attachmentName || 'file'}):\n${attachmentText}`
          );
        } else if (attachmentDataUrl) {
          userTextParts.push(
            `The user attached a visual screenshot (${options.attachmentName || 'screenshot.jpg'}). Inspect what is shown carefully against the Live Preview app.`
          );
        }
        userTextParts.push(`User request:\n${message}`);
        const currentUserText = userTextParts.join('\n\n');

        const currentUserContent: OpenRouterMessageContent = attachmentDataUrl
          ? [
              { type: 'text', text: currentUserText },
              { type: 'image_url', image_url: { url: attachmentDataUrl } },
            ]
          : currentUserText;

        conversationMessages.push({ role: 'user', content: currentUserContent });

        let fullRaw = '';
        let headerBuffer = '';
        let headerResolved = initialRoute !== 'auto';
        let resolvedKind: 'chat' | 'build' =
          initialRoute === 'build' ? 'build' : 'chat';
        let emittedBuildPhase = false;
        let emittedProseLength = 0;
        let reachedHtml = false;
        let htmlStartIndex = -1;
        let emittedFiles: string[] = [];
        let emittedPlanSteps: string[] = [];
        let lastProgressSentAt = 0;
        let modelUsed = '';
        let noticedReasoning = false;

        const resetStreamParser = () => {
          if (
            emittedProseLength > 0 ||
            emittedFiles.length > 0 ||
            emittedPlanSteps.length > 0 ||
            emittedBuildPhase
          ) {
            sendEvent({ type: 'reset' });
          }
          fullRaw = '';
          headerBuffer = '';
          headerResolved = initialRoute !== 'auto';
          resolvedKind = initialRoute === 'build' ? 'build' : 'chat';
          emittedBuildPhase = false;
          emittedProseLength = 0;
          reachedHtml = false;
          htmlStartIndex = -1;
          emittedFiles = [];
          emittedPlanSteps = [];
          lastProgressSentAt = 0;
          noticedReasoning = false;
        };

        const syncLivePlanSteps = (rawSoFar: string) => {
          const steps = extractPlanStepsFromRaw(rawSoFar);
          for (const step of steps) {
            if (!emittedPlanSteps.includes(step)) {
              emittedPlanSteps.push(step);
              if (!emittedBuildPhase) {
                sendEvent({
                  type: 'phase',
                  phase: 'understanding',
                  kind: resolvedKind,
                  label: 'Planning architecture & design...',
                });
              }
              sendEvent({
                type: 'plan',
                step,
                allSteps: [...emittedPlanSteps],
              });
            }
          }
        };

        const promoteToBuildPhase = () => {
          resolvedKind = 'build';
          if (!emittedBuildPhase) {
            emittedBuildPhase = true;
            sendEvent({
              type: 'phase',
              phase: 'building',
              kind: 'build',
              label: 'Building live app...',
            });
          }
        };

        const syncLiveBuildArtifacts = (htmlSoFar: string) => {
          const cleanHtml = htmlSoFar.split(END_MARKER)[0] ?? htmlSoFar;
          const artifacts = extractLiveBuildArtifacts(cleanHtml);
          let emittedNewFile = false;

          for (const art of artifacts) {
            if (!emittedFiles.includes(art.path)) {
              emittedFiles.push(art.path);
              emittedNewFile = true;
              sendEvent({
                type: 'file',
                action: art.action,
                path: art.path,
                allFiles: [...emittedFiles],
                bytesBuilt: cleanHtml.length,
              });
            }
          }

          const nowMs = Date.now();
          if (!emittedNewFile && nowMs - lastProgressSentAt >= 220) {
            lastProgressSentAt = nowMs;
            sendEvent({
              type: 'progress',
              bytesBuilt: cleanHtml.length,
            });
          }
        };

        const emitCleanProseRange = (upToIndex: number) => {
          if (upToIndex <= emittedProseLength) return;
          const rawSlice = fullRaw.slice(emittedProseLength, upToIndex);
          if (!rawSlice || fullRaw.slice(0, upToIndex).includes('```')) return;
          const cleanDelta = stripTagMarkers(rawSlice)
            .replace(/<<<[\s\S]*/g, '')
            .replace(/```[\s\S]*/g, '')
            .replace(/^\s*(?:PART\s*[123]\s*[:\-–]?)\s*/gim, '');
          if (cleanDelta) {
            sendEvent({ type: 'delta', text: cleanDelta });
          }
          emittedProseLength = upToIndex;
        };

        const safeProseTailEnd = (): number => {
          const baseSafeEnd = Math.max(
            emittedProseLength,
            fullRaw.length - Math.max(HOLDBACK_CHARS, 72)
          );
          const pendingChunk = fullRaw.slice(emittedProseLength, baseSafeEnd);
          const unclosedBracketOffset = pendingChunk.lastIndexOf('[[');
          if (
            unclosedBracketOffset !== -1 &&
            !pendingChunk.slice(unclosedBracketOffset).includes(']]')
          ) {
            return emittedProseLength + unclosedBracketOffset;
          }
          return baseSafeEnd;
        };

        const processBodyChunk = (bodyChunk: string) => {
          if (!bodyChunk) return;
          fullRaw += bodyChunk;

          if (!reachedHtml) {
            syncLivePlanSteps(fullRaw);
          }

          if (resolvedKind === 'chat') {
            if (initialRoute === 'chat') {
              sendEvent({ type: 'delta', text: bodyChunk });
              emittedProseLength += bodyChunk.length;
              return;
            }

            const codeStart = findCodeStart(fullRaw);
            if (codeStart) {
              emitCleanProseRange(codeStart.markerIdx);
              reachedHtml = true;
              htmlStartIndex = codeStart.htmlOffset;
              promoteToBuildPhase();
              syncLiveBuildArtifacts(fullRaw.slice(htmlStartIndex));
            } else {
              emitCleanProseRange(safeProseTailEnd());
            }
            return;
          }

          if (!reachedHtml) {
            const codeStart = findCodeStart(fullRaw);
            if (codeStart) {
              emitCleanProseRange(codeStart.markerIdx);
              reachedHtml = true;
              htmlStartIndex = codeStart.htmlOffset;
              promoteToBuildPhase();
              syncLiveBuildArtifacts(fullRaw.slice(htmlStartIndex));
            } else {
              emitCleanProseRange(safeProseTailEnd());
            }
          } else if (htmlStartIndex !== -1) {
            syncLiveBuildArtifacts(fullRaw.slice(htmlStartIndex));
          }
        };

        const handleTextChunk = (text: string) => {
          if (!text) return;

          if (!headerResolved) {
            headerBuffer += text;
            const intentMatch =
              /^\s*\[\[\s*INTENT\s*:\s*(CHAT|BUILD)\s*\]\]\s*\n?/i.exec(
                headerBuffer
              );
            if (intentMatch) {
              headerResolved = true;
              resolvedKind =
                intentMatch[1].toUpperCase() === 'BUILD' ? 'build' : 'chat';
              const remainder = headerBuffer.slice(intentMatch[0].length);
              headerBuffer = '';
              if (remainder) {
                processBodyChunk(remainder);
              }
              return;
            }

            const trimmedStart = headerBuffer.trimStart();
            const couldStillBeTag =
              trimmedStart.length === 0 ||
              ('[['.startsWith(trimmedStart) ||
                (trimmedStart.startsWith('[') &&
                  headerBuffer.length < 28 &&
                  !trimmedStart.includes('\n')));

            if (!couldStillBeTag) {
              headerResolved = true;
              resolvedKind = findCodeStart(headerBuffer) ? 'build' : 'chat';
              const buffered = headerBuffer;
              headerBuffer = '';
              processBodyChunk(buffered);
            }
            return;
          }

          processBodyChunk(text);
        };

        const flushPendingStreamBuffer = () => {
          if (!headerResolved && headerBuffer) {
            headerResolved = true;
            const cleaned = headerBuffer.replace(
              /^\s*\[\[\s*INTENT\s*:\s*(CHAT|BUILD)\s*\]\]\s*\n?/i,
              (_, kind: string) => {
                resolvedKind = kind.toUpperCase() === 'BUILD' ? 'build' : 'chat';
                return '';
              }
            );
            headerBuffer = '';
            if (cleaned) {
              processBodyChunk(cleaned);
            }
          }
          if (
            resolvedKind === 'chat' &&
            initialRoute === 'auto' &&
            emittedProseLength < fullRaw.length &&
            !findCodeStart(fullRaw)
          ) {
            const tail = stripTagMarkers(fullRaw.slice(emittedProseLength)).trim();
            if (tail) {
              sendEvent({ type: 'delta', text: tail });
              emittedProseLength = fullRaw.length;
            }
          }
        };

        let succeeded = false;
        let lastError: Error | null = null;
        let catalog: NormalizedOpenRouterModel[] = [];

        if (openRouterKey) {
          catalog = await fetchFreeOpenRouterFallbacks(openRouterKey, referer);

          const candidates: string[] = [];
          const addCandidate = (id: string | undefined) => {
            const trimmed = id?.trim();
            if (
              trimmed &&
              !isRestrictedHarnessModel(trimmed) &&
              !candidates.includes(trimmed)
            ) {
              candidates.push(trimmed);
            }
          };

          addCandidate(requestedModel);
          addCandidate(process.env.OPENROUTER_FALLBACK_MODEL);
          addCandidate('openrouter/auto');

          for (const m of catalog) {
            if (candidates.length < 6) {
              addCandidate(m.id);
            }
          }

          for (let i = 0; i < candidates.length; i += 1) {
            const candidateId = candidates[i];
            if (request.signal.aborted) break;

            const modelInfo = resolveModelInfo(candidateId, catalog);

            try {
              if (i > 0) {
                resetStreamParser();
              }

              sendEvent({
                type: 'meta',
                kind: 'chat',
                modelId: modelInfo.id,
                modelName: modelInfo.name,
                provider: modelInfo.provider,
                isFallback: i > 0,
              });

              if (i > 0) {
                sendEvent({
                  type: 'phase',
                  phase: 'understanding',
                  kind: 'chat',
                  label: `Switching to ${modelInfo.name}...`,
                });
              }

              await streamOpenRouterCompletion(
                openRouterKey,
                referer,
                candidateId,
                systemInstruction,
                conversationMessages,
                handleTextChunk,
                () => {
                  if (!noticedReasoning && !emittedBuildPhase) {
                    noticedReasoning = true;
                    sendEvent({
                      type: 'phase',
                      phase: 'understanding',
                      kind: 'chat',
                      label: 'Thinking...',
                    });
                  }
                },
                request.signal
              );

              flushPendingStreamBuffer();

              if (!fullRaw.trim()) {
                throw new Error(`Model ${candidateId} returned an empty response.`);
              }

              if (resolvedKind === 'build') {
                const extractedHtml = extractPreviewHtmlFromRaw(fullRaw);
                if (!extractedHtml || extractedHtml.length < 60 || !/<[a-z]/i.test(extractedHtml)) {
                  throw new Error(
                    `Model ${candidateId} replied without runnable Preview HTML.`
                  );
                }
              }

              modelUsed = candidateId;
              succeeded = true;
              break;
            } catch (err) {
              if (request.signal.aborted) break;
              const errMsg = err instanceof Error ? err.message : String(err);
              const isGenuineInvalidKey =
                err instanceof OpenRouterApiError &&
                err.status === 401 &&
                /no auth credentials|user not found|invalid api key|unauthorized/i.test(errMsg) &&
                !/harness|model|endpoint/i.test(errMsg);

              if (isGenuineInvalidKey) {
                lastError = new Error(
                  `OpenRouter authentication failed (${errMsg}). Please check OPENROUTER_API_KEY in Vercel Environment Variables.`
                );
                break;
              }
              lastError = err instanceof Error ? err : new Error(errMsg);
            }
          }
        }

        if (!succeeded && geminiClient && !request.signal.aborted) {
          try {
            if (openRouterKey) {
              resetStreamParser();
            }

            sendEvent({
              type: 'meta',
              kind: 'chat',
              modelId: 'google/gemini-4-hydrogen',
              modelName: 'Gemini 4 Hydrogen',
              provider: 'google',
              isFallback: Boolean(openRouterKey),
            });

            const conversationContext = history
              .slice(-6)
              .map((item) => `${item.role === 'user' ? 'User' : 'AI Craft'}: ${item.text}`)
              .join('\n');

            const promptParts: string[] = [];
            if (conversationContext) {
              promptParts.push(`Conversation history:\n${conversationContext}`);
            }
            if (previousHtml && initialRoute !== 'chat') {
              promptParts.push(
                `Existing Preview app HTML (for context or surgical updates if building/editing):\n${previousHtml.slice(0, 28000)}`
              );
            } else if (previousHtml && initialRoute === 'chat') {
              promptParts.push(
                `Current Preview app summary (user is chatting/asking a question):\n${previewSummary}`
              );
            }
            if (attachmentText) {
              promptParts.push(
                `Attached reference text (${options.attachmentName || 'file'}):\n${attachmentText}`
              );
            } else if (attachmentDataUrl) {
              promptParts.push(
                `The user attached a screenshot (${options.attachmentName || 'screenshot.jpg'}). Inspect it visually together with the Live Preview app and apply the exact edits or build requested.`
              );
            }
            promptParts.push(`User request:\n${message}`);
            const fullPrompt = promptParts.join('\n\n');

            let geminiContents:
              | string
              | {
                  parts: Array<
                    | { inlineData: { mimeType: string; data: string } }
                    | { text: string }
                  >;
                } = fullPrompt;

            if (attachmentDataUrl) {
              const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(
                attachmentDataUrl
              );
              if (match) {
                geminiContents = {
                  parts: [
                    {
                      inlineData: {
                        mimeType: attachmentMimeType || match[1],
                        data: match[2],
                      },
                    },
                    { text: fullPrompt },
                  ],
                };
              }
            }

            const runGeminiStream = async (withSearchTool: boolean) =>
              geminiClient.models.generateContentStream({
                model: 'gemini-4-hydrogen',
                contents: geminiContents,
                config: {
                  systemInstruction,
                  thinkingConfig: {
                    thinkingLevel:
                      initialRoute === 'chat'
                        ? ThinkingLevel.MEDIUM
                        : ThinkingLevel.HIGH,
                  },
                  ...(withSearchTool ? { tools: [{ googleSearch: {} }] } : {}),
                },
              });

            let geminiStream;
            try {
              geminiStream = await runGeminiStream(webSearchEnabled);
            } catch {
              if (webSearchEnabled) {
                geminiStream = await runGeminiStream(false);
              } else {
                throw new Error('Gemini stream request failed.');
              }
            }

            for await (const chunk of geminiStream) {
              if (request.signal.aborted) break;
              if (chunk.text) {
                handleTextChunk(chunk.text);
              }
            }

            flushPendingStreamBuffer();

            if (!fullRaw.trim()) {
              throw new Error('Fallback AI engine returned an empty response.');
            }

            modelUsed = 'google/gemini-4-hydrogen';
            succeeded = true;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
          }
        }

        if (request.signal.aborted) {
          closeStream();
          return;
        }

        if (!succeeded) {
          throw lastError ?? new Error('Unable to reach AI Craft engine right now.');
        }

        let finalProse = '';
        let previewHtml = '';
        let finalFiles: string[] = [];
        let finalSuggestions: string[] = [];

        if (resolvedKind === 'chat') {
          finalProse = stripTagMarkers(fullRaw).trim();
        } else {
          const codeStart = findCodeStart(fullRaw);
          if (codeStart) {
            finalProse = sanitizeBuildProse(fullRaw.slice(0, codeStart.markerIdx));
          } else {
            finalProse = sanitizeBuildProse(fullRaw);
          }

          previewHtml = extractPreviewHtmlFromRaw(fullRaw);
          const parsedSuggestions = extractSuggestionsFromRaw(fullRaw);
          finalSuggestions =
            parsedSuggestions.length > 0
              ? parsedSuggestions
              : buildSmartFollowUpSuggestions(message, previewHtml, mode);

          if (!finalProse && previewHtml) {
            finalProse =
              'Your real-time app is thoughtfully structured, styled, and ready with monetization built in. Tap Preview to try it live, or pick an upgrade below.';
          }

          if (previewHtml) {
            finalFiles = extractLiveBuildArtifacts(previewHtml).map((a) => a.path);
            sendEvent({
              type: 'file',
              action: 'Built',
              path: finalFiles[0] || 'index.html',
              allFiles: finalFiles,
              bytesBuilt: previewHtml.length,
            });
          }
        }

        const finalInfo = resolveModelInfo(modelUsed, catalog);
        sendEvent({
          type: 'done',
          kind: resolvedKind,
          fullText: finalProse,
          previewHtml,
          allFiles: finalFiles,
          suggestions: finalSuggestions,
          bytesBuilt: previewHtml.length,
          modelUsed: finalInfo.id,
          modelName: finalInfo.name,
          provider: finalInfo.provider,
        });
        closeStream();
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'Unable to reach AI Craft engine right now.';
        sendEvent({
          type: 'error',
          message: errorMessage,
        });
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
