export type BuildMode = 'mobile' | 'web';

export type NavTab = 'apps' | 'create' | 'setting';

export type WorkspaceView = 'chat' | 'preview' | 'code';

export type BuildPhase =
  | 'understanding'
  | 'building'
  | 'paused'
  | 'complete'
  | 'error';

export type TurnKind = 'chat' | 'build';

export interface UserProfile {
  name: string;
  email: string;
  avatarDataUrl: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: string;
}

export type SubscriptionTier = 'free' | 'starter' | 'plus' | 'studio' | 'annual';

export interface BillingSummary {
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

export interface PaymentTransaction {
  id: string;
  reference: string;
  planId: 'starter' | 'plus' | 'studio' | 'annual';
  planName: string;
  amountNgn: number;
  amountKobo: number;
  creditsToAdd: number;
  status: 'paid' | 'pending' | 'failed';
  paidAt: string;
  channel: string;
  email: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  isFree: boolean;
}

export interface ProjectSecret {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface ProjectSecretHint {
  key: string;
  hint: string;
}

export interface ProjectDatabaseColumn {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'timestamp' | 'json';
  required?: boolean;
}

export interface ProjectDatabaseTable {
  id: string;
  name: string;
  columns: ProjectDatabaseColumn[];
  description?: string;
}

export interface ProjectDatabaseConfig {
  enabled: boolean;
  providerLabel: string;
  apiUrl?: string;
  tables: ProjectDatabaseTable[];
  updatedAt?: string;
}

export interface ProjectDeploymentConfig {
  status: 'draft' | 'deployed';
  slug: string;
  appId?: string;
  liveUrl?: string;
  logoUrl?: string;
  themeColor?: string;
  logo?: Record<string, string>;
  livePublishing?: boolean;
  version: number;
  deployedAt: string | null;
  environment: 'production' | 'preview';
}

export interface ComposerOptions {
  reactEnabled: boolean;
  backendEnabled: boolean;
  webSearchEnabled: boolean;
  attachmentName: string | null;
  attachmentDataUrl?: string | null;
  attachmentMimeType?: string | null;
  attachmentText?: string | null;
  secretKeys?: string[];
  secretHints?: ProjectSecretHint[];
  databaseTables?: string[];
  clientCreditsRemaining?: number;
  needsTitle?: boolean;
}

export interface BuilderTurn {
  id: string;
  jobId?: string;
  startedAt?: number;
  kind: TurnKind;
  userMessage: string;
  attachmentName: string | null;
  attachmentDataUrl?: string | null;
  phase: BuildPhase;
  phaseLabel: string;
  thoughtSeconds: number;
  activeAction: string;
  activeFile: string;
  files: string[];
  planSteps?: string[];
  suggestions?: string[];
  aiText: string;
  modelId?: string;
  modelName?: string;
  modelProvider?: string;
  previewHtml?: string;
  bytesBuilt?: number;
  creditsUsed?: number;
  pausedReason?:
    | 'DAILY_LIMIT_REACHED'
    | 'MONTHLY_LIMIT_REACHED'
    | 'CREDITS_EXHAUSTED'
    | 'STREAM_INTERRUPTED';
  pausedMessage?: string;
  pausedAt?: string;
  errorMessage?: string;
}

export interface ModeThemeConfig {
  id: BuildMode;
  label: string;
  headline: string;
  subtitle: string;
  placeholder: string;
  artworkSrc: string;
  artworkAlt: string;
  themeColor: string;
  glowPrimary: string;
  glowSecondary: string;
  ringColor: string;
  accentColor: string;
  accentSoft: string;
  sendActiveBg: string;
}

export const MODE_THEMES: Record<BuildMode, ModeThemeConfig> = {
  mobile: {
    id: 'mobile',
    label: 'iOS&Android',
    headline: 'Build iOS & Android Apps. Instantly. No Code.',
    subtitle: 'Idea → Chat → App Store',
    placeholder: 'Ask AI Craft to create',
    artworkSrc: '/assets/aistudio/IMG_5323_802cf4cd.png',
    artworkAlt: 'Classical marble figure holding a glowing smartphone in golden light',
    themeColor: '#FFFBEB',
    glowPrimary: 'rgba(253, 224, 71, 0.48)',
    glowSecondary: 'rgba(251, 191, 36, 0.20)',
    ringColor: 'rgba(245, 185, 55, 0.34)',
    accentColor: '#7A68F6',
    accentSoft: '#F1EEFF',
    sendActiveBg: '#7A68F6',
  },
  web: {
    id: 'web',
    label: 'Website',
    headline: 'No Code. Build Full-Stack Web Apps',
    subtitle: 'From idea to launch in minutes.',
    placeholder: 'Ask AI Craft to create a prototype',
    artworkSrc: '/assets/aistudio/IMG_5324_4d3c7f62.png',
    artworkAlt: 'Classical marble sculptor crafting a desktop monitor in orchid light',
    themeColor: '#FDF4FF',
    glowPrimary: 'rgba(232, 121, 249, 0.44)',
    glowSecondary: 'rgba(192, 132, 252, 0.22)',
    ringColor: 'rgba(217, 70, 239, 0.28)',
    accentColor: '#8B5CF6',
    accentSoft: '#F5EEFF',
    sendActiveBg: '#8B5CF6',
  },
};
