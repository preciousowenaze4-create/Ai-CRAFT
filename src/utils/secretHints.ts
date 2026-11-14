import { ProjectSecret, ProjectSecretHint } from '../types/craft';

export function classifySecretHint(key: string, value: string): string {
  const k = key.trim().toLowerCase();
  const v = value.trim();

  if (
    /^https:\/\/[a-z0-9-]+\.supabase\.co(?:\/|$)/i.test(v) ||
    (/^https:\/\//i.test(v) && k.includes('supabase') && (k.includes('url') || k === 'supabase'))
  ) {
    return 'supabase-project-url';
  }
  if (
    /^sb_(?:publishable|secret)_[a-zA-Z0-9_-]{8,}/i.test(v) ||
    (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\./.test(v) && k.includes('supabase'))
  ) {
    return k.includes('service') ? 'supabase-service-key' : 'supabase-anon-key';
  }
  if (/\.apps\.googleusercontent\.com$/i.test(v) || (k.includes('google') && k.includes('client_id'))) {
    return 'google-oauth-client-id';
  }
  if (/^GOCSPX-[a-zA-Z0-9_-]+/.test(v) || (k.includes('google') && k.includes('secret'))) {
    return 'google-oauth-client-secret';
  }
  if (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(v)) {
    return 'jwt-token';
  }
  if (/^(?:pk|sk)_(?:live|test)_[a-zA-Z0-9]+/i.test(v)) {
    return v.toLowerCase().startsWith('pk_') ? 'payment-public-key' : 'payment-secret-key';
  }
  if (/^AIza[0-9A-Za-z_-]{20,}/.test(v)) {
    return 'google-api-key';
  }
  if (/^sk-or-/i.test(v)) {
    return 'openrouter-api-key';
  }
  if (/^sk-[a-zA-Z0-9_-]{16,}/.test(v)) {
    return 'api-secret-key';
  }
  if (/^https?:\/\//i.test(v)) {
    return 'endpoint-url';
  }
  if (k.includes('supabase')) {
    return 'supabase-credential';
  }
  if (k.includes('firebase')) {
    return 'firebase-credential';
  }
  if (k.includes('oauth') || k.includes('client')) {
    return 'oauth-credential';
  }
  return 'configured-secret';
}

export function buildProjectSecretHints(secrets: ProjectSecret[]): ProjectSecretHint[] {
  return secrets
    .filter((s) => s.key.trim().length > 0 && s.value.trim().length > 0)
    .slice(0, 30)
    .map((s) => ({
      key: s.key.trim(),
      hint: classifySecretHint(s.key, s.value),
    }));
}
