import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ChevronRight, Loader2, Plus } from 'lucide-react';
import {
  AuthScreen,
  AuthViewMode,
  STORAGE_SB_RECOVERY_KEY,
  STORAGE_SB_SESSION_KEY,
  StoredSupabaseSession,
} from './components/AuthScreen';
import { BottomNav } from './components/BottomNav';
import { BuilderWorkspace } from './components/BuilderWorkspace';
import { Head3DOverlay } from './components/Head3DOverlay';
import { HeroStage } from './components/HeroStage';
import { ModeSwitcher } from './components/ModeSwitcher';
import { OfflineIndicator } from './components/PWAInstallButton';
import { ProfileSection } from './components/ProfileSection';
import {
  PRO_PLANS,
  ProPlanOption,
  ProUpgradeModal,
} from './components/ProUpgradeModal';
import { PromptComposer } from './components/PromptComposer';
import { TopBar } from './components/TopBar';
import { unlockSpeechSynthesis } from './hooks/useSpeechNarration';
import {
  AuthUser,
  BillingSummary,
  BuildMode,
  BuilderTurn,
  ComposerOptions,
  MODE_THEMES,
  NavTab,
  OpenRouterModel,
  PaymentTransaction,
  ProjectDatabaseColumn,
  ProjectDatabaseConfig,
  ProjectDatabaseTable,
  ProjectDeploymentConfig,
  ProjectSecret,
  TurnKind,
  UserProfile,
  WorkspaceView,
} from './types/craft';

interface CraftProject {
  id: string;
  title: string;
  mode: BuildMode;
  createdAt: string;
  turns: BuilderTurn[];
  secrets?: ProjectSecret[];
  databaseConfig?: ProjectDatabaseConfig;
  deployment?: ProjectDeploymentConfig;
}

interface CloudWorkspacePayload {
  projects?: CraftProject[];
  projectViews?: Record<string, WorkspaceView>;
  publishedProjects?: Record<string, boolean>;
  profile?: UserProfile;
  updatedAt?: string;
}

const STORAGE_PROJECTS_KEY = 'aicraft_projects_v1';
const STORAGE_VIEWS_KEY = 'aicraft_project_views_v1';
const STORAGE_PUBLISHED_KEY = 'aicraft_published_v1';
const STORAGE_MODEL_KEY = 'aicraft_selected_model_v1';
const STORAGE_CREDITS_KEY = 'aicraft_credits_v1';
const STORAGE_PRO_PLAN_KEY = 'aicraft_pro_plan_v1';
const STORAGE_BILLING_KEY = 'aicraft_billing_v1';
const STORAGE_PROFILE_KEY = 'aicraft_profile_v1';
const STORAGE_NOTIFICATIONS_KEY = 'aicraft_notifications_v1';
const STORAGE_AUTOREAD_KEY = 'aicraft_autoread_v1';
const STORAGE_TRANSACTIONS_KEY = 'aicraft_transactions_v1';
const STORAGE_CREDITED_REFS_KEY = 'aicraft_credited_refs_v1';
const STORAGE_LAST_USER_KEY = 'aicraft_last_user_v1';

function isProjectWorking(project: CraftProject | null | undefined): boolean {
  return Boolean(
    project?.turns.some(
      (t) => t.phase === 'understanding' || t.phase === 'building'
    )
  );
}

interface IncomingSchemaTable {
  name: string;
  columns: Array<{
    name: string;
    type: ProjectDatabaseColumn['type'];
    required?: boolean;
  }>;
}

function mergeIncomingDbSchema(
  existing: ProjectDatabaseConfig | undefined,
  incoming: IncomingSchemaTable[]
): ProjectDatabaseConfig {
  const base: ProjectDatabaseConfig = existing ?? {
    enabled: true,
    providerLabel: 'Cloud & Local App Store',
    tables: [],
  };
  if (!Array.isArray(incoming) || incoming.length === 0) return base;

  const tableMap = new Map<string, ProjectDatabaseTable>();
  for (const tbl of base.tables) {
    tableMap.set(tbl.name, {
      ...tbl,
      columns: [...tbl.columns],
    });
  }

  for (const item of incoming) {
    const cleanName = item.name?.trim().toLowerCase();
    if (!cleanName) continue;
    const cols: ProjectDatabaseColumn[] = (item.columns || []).map((c) => ({
      name: c.name,
      type:
        c.type === 'number' ||
        c.type === 'boolean' ||
        c.type === 'timestamp' ||
        c.type === 'json'
          ? c.type
          : 'text',
      required: Boolean(c.required),
    }));
    const current = tableMap.get(cleanName);
    if (!current) {
      tableMap.set(cleanName, {
        id: `tbl-${Date.now()}-${cleanName}`,
        name: cleanName,
        columns: cols,
      });
    } else {
      const seen = new Set(current.columns.map((c) => c.name));
      for (const col of cols) {
        if (!seen.has(col.name)) {
          seen.add(col.name);
          current.columns.push(col);
        }
      }
    }
  }

  return {
    ...base,
    enabled: true,
    tables: Array.from(tableMap.values()),
    updatedAt: new Date().toISOString(),
  };
}

function loadSavedProjects(): CraftProject[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CraftProject[]) : [];
  } catch {
    return [];
  }
}

function loadSavedRecord<T>(key: string): Record<string, T> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function loadSavedString(key: string): string {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function saveProjectsSafely(projects: CraftProject[]) {
  try {
    window.localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // Trim heavy inline base64 screenshots if storage quota is tight
    try {
      const compact = projects.slice(0, 20).map((proj, idx) => ({
        ...proj,
        turns: proj.turns.map((turn) => ({
          ...turn,
          attachmentDataUrl: idx === 0 ? turn.attachmentDataUrl : null,
        })),
      }));
      window.localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(compact));
    } catch {
      // Ignore storage quota failure gracefully
    }
  }
}

function deriveProjectTitle(promptText: string, mode: BuildMode): string {
  const cleaned = promptText
    .replace(/^(build|create|make|design)\s+(me\s+)?(an?|the)\s+/i, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 3);
  if (words.length === 0) {
    return mode === 'mobile' ? 'AICraft Mobile' : 'AICraft Web';
  }
  const title = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return title.length > 24 ? `${title.slice(0, 24)}…` : title;
}

function loadSavedCredits(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_CREDITS_KEY);
    if (!raw) return 300;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 300;
  } catch {
    return 300;
  }
}

function loadSavedProfile(): UserProfile {
  try {
    const raw = window.localStorage.getItem(STORAGE_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserProfile>;
      if (parsed && typeof parsed === 'object') {
        return {
          name:
            typeof parsed.name === 'string' && parsed.name.trim()
              ? parsed.name.trim()
              : 'Precious Owenaze',
          email:
            typeof parsed.email === 'string' && parsed.email.trim()
              ? parsed.email.trim()
              : 'preciousowenaze4@gmail.com',
          avatarDataUrl:
            typeof parsed.avatarDataUrl === 'string' ? parsed.avatarDataUrl : null,
        };
      }
    }
  } catch {
    // ignore storage read error
  }
  return {
    name: 'Precious Owenaze',
    email: 'preciousowenaze4@gmail.com',
    avatarDataUrl: null,
  };
}

function loadSavedBoolean(key: string, defaultValue: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // ignore storage read error
  }
  return defaultValue;
}

function loadStoredJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getStoredAuthHeaders(): Record<string, string> {
  const storedSession = loadStoredJson<StoredSupabaseSession>(STORAGE_SB_SESSION_KEY);
  const headers: Record<string, string> = {};
  if (storedSession?.accessToken) {
    headers.Authorization = `Bearer ${storedSession.accessToken}`;
  }
  if (storedSession?.refreshToken) {
    headers['x-refresh-token'] = storedSession.refreshToken;
  }
  return headers;
}

function mergeProjectsFromCloud(
  localList: CraftProject[],
  cloudList: CraftProject[]
): CraftProject[] {
  const mergedMap = new Map<string, CraftProject>();
  for (const item of cloudList) {
    if (item?.id && Array.isArray(item.turns)) {
      mergedMap.set(item.id, item);
    }
  }
  for (const localItem of localList) {
    if (!localItem?.id || !Array.isArray(localItem.turns)) continue;
    const existing = mergedMap.get(localItem.id);
    if (!existing) {
      mergedMap.set(localItem.id, localItem);
    } else if (localItem.turns.length >= existing.turns.length) {
      const localWorking = isProjectWorking(localItem);
      const cloudComplete = existing.turns.some((t) => t.phase === 'complete');
      const base = localWorking && cloudComplete ? existing : localItem;
      mergedMap.set(localItem.id, {
        ...base,
        secrets:
          base.secrets && base.secrets.length > 0
            ? base.secrets
            : existing.secrets ?? localItem.secrets,
        databaseConfig:
          base.databaseConfig ?? existing.databaseConfig ?? localItem.databaseConfig,
        deployment: base.deployment ?? existing.deployment ?? localItem.deployment,
      });
    }
  }
  return Array.from(mergedMap.values());
}

const CLIENT_BYTES_PER_BUILD_CREDIT = 1350;
const CLIENT_MAX_CREDITS_PER_BUILD = 20;

function calculateClientBuildCredits(bytesBuilt: number): number {
  if (!Number.isFinite(bytesBuilt) || bytesBuilt <= 0) return 0;
  return Math.min(
    CLIENT_MAX_CREDITS_PER_BUILD,
    Math.max(1, Math.floor(bytesBuilt / CLIENT_BYTES_PER_BUILD_CREDIT) + 1)
  );
}

export default function App() {
  const [recoveryTokens, setRecoveryTokens] = useState<StoredSupabaseSession | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_recovery') === '1') {
      return loadStoredJson<StoredSupabaseSession>(STORAGE_SB_RECOVERY_KEY);
    }
    return null;
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(() =>
    Boolean(loadStoredJson<StoredSupabaseSession>(STORAGE_SB_SESSION_KEY))
  );
  const [mode, setMode] = useState<BuildMode>('mobile');
  const [activeTab, setActiveTab] = useState<NavTab>('create');
  const [viewMode, setViewMode] = useState<'home' | 'builder'>('home');
  const [prompt, setPrompt] = useState('');
  const [billing, setBilling] = useState<BillingSummary | null>(() =>
    loadStoredJson<BillingSummary>(STORAGE_BILLING_KEY)
  );
  const [credits, setCredits] = useState<number>(() => {
    const savedBilling = loadStoredJson<BillingSummary>(STORAGE_BILLING_KEY);
    if (savedBilling && typeof savedBilling.monthlyCreditsRemaining === 'number') {
      return savedBilling.monthlyCreditsRemaining;
    }
    return loadSavedCredits();
  });
  const [proPlanId, setProPlanId] = useState<string | null>(() => {
    const savedBilling = loadStoredJson<BillingSummary>(STORAGE_BILLING_KEY);
    if (savedBilling) {
      return savedBilling.tier === 'free' ? null : savedBilling.tier;
    }
    const saved = loadSavedString(STORAGE_PRO_PLAN_KEY);
    return saved || null;
  });
  const [userProfile, setUserProfile] = useState<UserProfile>(() => loadSavedProfile());
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() =>
    loadSavedBoolean(STORAGE_NOTIFICATIONS_KEY, false)
  );
  const [autoReadEnabled, setAutoReadEnabled] = useState<boolean>(() =>
    loadSavedBoolean(STORAGE_AUTOREAD_KEY, true)
  );
  const [showProUpgrade, setShowProUpgrade] = useState(false);
  const [dynamicColorEnabled, setDynamicColorEnabled] = useState(true);
  const [projects, setProjects] = useState<CraftProject[]>(() => loadSavedProjects());
  const [projectViews, setProjectViews] = useState<Record<string, WorkspaceView>>(() =>
    loadSavedRecord<WorkspaceView>(STORAGE_VIEWS_KEY)
  );
  const [publishedProjects, setPublishedProjects] = useState<Record<string, boolean>>(() =>
    loadSavedRecord<boolean>(STORAGE_PUBLISHED_KEY)
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    loadSavedString(STORAGE_MODEL_KEY)
  );
  const [modelsLoading, setModelsLoading] = useState<boolean>(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>(() => {
    const saved = loadStoredJson<PaymentTransaction[]>(STORAGE_TRANSACTIONS_KEY);
    return Array.isArray(saved) ? saved : [];
  });
  const [transactionsLoading, setTransactionsLoading] = useState<boolean>(false);

  // Track active network readers per turnId (never globally aborted when switching projects)
  const activeConnectionsRef = useRef<Map<string, AbortController>>(new Map());
  const retriedTurnsRef = useRef<Set<string>>(new Set());
  const projectsRef = useRef<CraftProject[]>(projects);
  projectsRef.current = projects;

  const persistTimerRef = useRef<number | null>(null);
  const cloudSyncTimerRef = useRef<number | null>(null);
  const cloudHydratedUserRef = useRef<string | null>(null);

  const applyBillingSummary = useCallback((summary: BillingSummary | null | undefined) => {
    if (!summary) return;
    setBilling(summary);
    setCredits(summary.monthlyCreditsRemaining);
    const nextPlan = summary.tier === 'free' ? null : summary.tier;
    setProPlanId(nextPlan);
    try {
      window.localStorage.setItem(STORAGE_BILLING_KEY, JSON.stringify(summary));
      window.localStorage.setItem(
        STORAGE_CREDITS_KEY,
        String(summary.monthlyCreditsRemaining)
      );
      if (nextPlan) {
        window.localStorage.setItem(STORAGE_PRO_PLAN_KEY, nextPlan);
      } else {
        window.localStorage.removeItem(STORAGE_PRO_PLAN_KEY);
      }
    } catch {
      // ignore storage write error
    }
  }, []);

  const syncBillingFromServer = useCallback(async () => {
    const headers = getStoredAuthHeaders();
    if (!headers.Authorization && !headers['x-refresh-token']) return;
    try {
      const res = await fetch('/api/payments/billing', { headers });
      if (!res.ok) return;
      const raw = await res.text();
      const data = raw ? (JSON.parse(raw) as { billing?: BillingSummary }) : {};
      if (data.billing) {
        applyBillingSummary(data.billing);
      }
    } catch {
      // ignore network error
    }
  }, [applyBillingSummary]);

  const theme = MODE_THEMES[mode];
  const energyLevel = dynamicColorEnabled
    ? Math.min(1, prompt.trim().length / 40)
    : 0;

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;
  const activeProjectIsStreaming = isProjectWorking(activeProject);

  // Verify any existing Supabase session via backend on startup
  useEffect(() => {
    let cancelled = false;
    const storedSession = loadStoredJson<StoredSupabaseSession>(STORAGE_SB_SESSION_KEY);

    const checkSession = async () => {
      try {
        const headers: Record<string, string> = {};
        if (storedSession?.accessToken) {
          headers.Authorization = `Bearer ${storedSession.accessToken}`;
        }
        if (storedSession?.refreshToken) {
          headers['x-refresh-token'] = storedSession.refreshToken;
        }
        const res = await fetch('/api/auth/me', { headers });
        const rawText = await res.text();
        let data: {
          authenticated?: boolean;
          user?: AuthUser | null;
          accessToken?: string;
          refreshToken?: string;
        } = {};
        try {
          data = rawText ? (JSON.parse(rawText) as typeof data) : {};
        } catch {
          data = {};
        }
        if (cancelled) return;

        if (data.authenticated && data.user) {
          setAuthUser(data.user);
          if (data.accessToken) {
            try {
              window.localStorage.setItem(
                STORAGE_SB_SESSION_KEY,
                JSON.stringify({
                  accessToken: data.accessToken,
                  refreshToken: data.refreshToken || storedSession?.refreshToken,
                })
              );
            } catch {
              // ignore storage error
            }
          }
          setUserProfile((prev) => ({
            name: data.user!.name || prev.name,
            email: data.user!.email || prev.email,
            avatarDataUrl: prev.avatarDataUrl || data.user!.avatarUrl || null,
          }));
        } else if (storedSession) {
          try {
            window.localStorage.removeItem(STORAGE_SB_SESSION_KEY);
          } catch {
            // ignore storage error
          }
        }
      } catch {
        // leave unauthenticated if backend unreachable
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Real-time dynamic mobile browser theme-color update
  useEffect(() => {
    const existingMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

    if (!authUser) {
      const meta = existingMeta ?? document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#FFFFFF';
      if (!existingMeta) document.head.appendChild(meta);
      return;
    }

    if (showProUpgrade) {
      const meta = existingMeta ?? document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#0D47EE';
      if (!existingMeta) document.head.appendChild(meta);
      return;
    }

    if (viewMode === 'builder' && activeProject) {
      const currentView = projectViews[activeProject.id] ?? 'chat';
      const hasBuiltApp = activeProject.turns.some((t) => Boolean(t.previewHtml));
      if (currentView === 'preview' && !hasBuiltApp) {
        // LivingBotanicalWallpaper dynamically syncs theme-color to each slide's top edge
        return;
      }
      const meta = existingMeta ?? document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#FFFFFF';
      if (!existingMeta) document.head.appendChild(meta);
    } else {
      const meta = existingMeta ?? document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = dynamicColorEnabled ? theme.themeColor : '#FFFFFF';
      if (!existingMeta) document.head.appendChild(meta);
    }
  }, [authUser, theme.themeColor, dynamicColorEnabled, viewMode, activeProject, projectViews, showProUpgrade]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_CREDITS_KEY, String(credits));
    } catch {
      // ignore storage failure
    }
  }, [credits]);

  useEffect(() => {
    try {
      if (proPlanId) {
        window.localStorage.setItem(STORAGE_PRO_PLAN_KEY, proPlanId);
      } else {
        window.localStorage.removeItem(STORAGE_PRO_PLAN_KEY);
      }
    } catch {
      // ignore storage failure
    }
  }, [proPlanId]);

  const [cloudHydratedTick, setCloudHydratedTick] = useState(0);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const currentUserId = authUser.id;
    const previousUserId = loadSavedString(STORAGE_LAST_USER_KEY);
    const switchedAccount = Boolean(previousUserId && previousUserId !== currentUserId);

    try {
      window.localStorage.setItem(STORAGE_LAST_USER_KEY, currentUserId);
    } catch {
      // ignore storage failure
    }

    if (switchedAccount) {
      setProjects([]);
      setProjectViews({});
      setPublishedProjects({});
      setActiveProjectId(null);
      setTransactions([]);
      setBilling(null);
      setProPlanId(null);
      setCredits(300);
    }

    void syncBillingFromServer();

    const hydrateCloudWorkspace = async () => {
      if (cloudHydratedUserRef.current === currentUserId) return;
      try {
        const res = await fetch('/api/payments/sync', {
          headers: getStoredAuthHeaders(),
        });
        if (cancelled) return;
        if (!res.ok) {
          cloudHydratedUserRef.current = currentUserId;
          setCloudHydratedTick((n) => n + 1);
          return;
        }
        const raw = await res.text();
        const data = raw
          ? (JSON.parse(raw) as {
              synced?: boolean;
              workspace?: CloudWorkspacePayload | null;
            })
          : {};
        if (cancelled) return;
        cloudHydratedUserRef.current = currentUserId;

        if (data.synced && data.workspace) {
          const ws = data.workspace;
          if (Array.isArray(ws.projects) && ws.projects.length > 0) {
            setProjects((prev) =>
              switchedAccount
                ? ws.projects!
                : mergeProjectsFromCloud(prev, ws.projects!)
            );
          }
          if (ws.projectViews && typeof ws.projectViews === 'object') {
            setProjectViews((prev) =>
              switchedAccount ? ws.projectViews! : { ...ws.projectViews!, ...prev }
            );
          }
          if (ws.publishedProjects && typeof ws.publishedProjects === 'object') {
            setPublishedProjects((prev) =>
              switchedAccount
                ? ws.publishedProjects!
                : { ...ws.publishedProjects!, ...prev }
            );
          }
          if (ws.profile && typeof ws.profile === 'object') {
            setUserProfile((prev) => ({
              name: ws.profile?.name || prev.name,
              email: authUser.email || ws.profile?.email || prev.email,
              avatarDataUrl: ws.profile?.avatarDataUrl ?? prev.avatarDataUrl,
            }));
          }
        }
        setCloudHydratedTick((n) => n + 1);
      } catch {
        // ignore cloud hydration error when offline
      }
    };

    void hydrateCloudWorkspace();
    return () => {
      cancelled = true;
    };
  }, [authUser, syncBillingFromServer]);

  // Debounced cross-device cloud sync for apps, views, published status, and profile
  useEffect(() => {
    if (!authUser || cloudHydratedUserRef.current !== authUser.id) return;
    if (cloudSyncTimerRef.current !== null) {
      window.clearTimeout(cloudSyncTimerRef.current);
    }
    const working = projects.some((p) => isProjectWorking(p));
    cloudSyncTimerRef.current = window.setTimeout(() => {
      cloudSyncTimerRef.current = null;
      const headers = getStoredAuthHeaders();
      if (!headers.Authorization && !headers['x-refresh-token']) return;

      const compactProjects = projects.slice(0, 40).map((proj, idx) => ({
        ...proj,
        turns: proj.turns.map((turn) => ({
          ...turn,
          attachmentDataUrl: idx < 3 ? turn.attachmentDataUrl : null,
        })),
      }));

      void fetch('/api/payments/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          projects: compactProjects,
          projectViews,
          publishedProjects,
          profile: userProfile,
          updatedAt: new Date().toISOString(),
        }),
      }).catch(() => {
        // ignore background sync failure
      });
    }, working ? 4500 : 1400);

    return () => {
      if (cloudSyncTimerRef.current !== null) {
        window.clearTimeout(cloudSyncTimerRef.current);
        cloudSyncTimerRef.current = null;
      }
    };
  }, [authUser, cloudHydratedTick, projects, projectViews, publishedProjects, userProfile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(userProfile));
    } catch {
      // ignore storage failure
    }
  }, [userProfile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_NOTIFICATIONS_KEY,
        String(notificationsEnabled)
      );
    } catch {
      // ignore storage failure
    }
  }, [notificationsEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_AUTOREAD_KEY, String(autoReadEnabled));
    } catch {
      // ignore storage failure
    }
  }, [autoReadEnabled]);

  useEffect(() => {
    if (!inlineNotice) return;
    const timer = window.setTimeout(() => setInlineNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [inlineNotice]);

  // Debounced lag-free localStorage persistence
  useEffect(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    const delay = projects.some((p) => isProjectWorking(p)) ? 900 : 120;
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      saveProjectsSafely(projects);
    }, delay);
  }, [projects]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_VIEWS_KEY, JSON.stringify(projectViews));
    } catch {
      // ignore storage failure
    }
  }, [projectViews]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_PUBLISHED_KEY, JSON.stringify(publishedProjects));
    } catch {
      // ignore storage failure
    }
  }, [publishedProjects]);

  useEffect(() => {
    if (!selectedModel) return;
    try {
      window.localStorage.setItem(STORAGE_MODEL_KEY, selectedModel);
    } catch {
      // ignore storage failure
    }
  }, [selectedModel]);

  const loadModels = async (refresh = false) => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const url = refresh ? '/api/models?refresh=1' : '/api/models';
      const response = await fetch(url);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Backend /api/models endpoint returned non-JSON response.');
      }
      const data = (await response.json()) as {
        models?: OpenRouterModel[];
        error?: string;
      };
      const fetched = Array.isArray(data?.models) ? data.models : [];
      if (fetched.length > 0) {
        setModels(fetched);
        setSelectedModel((prev) =>
          prev && fetched.some((m) => m.id === prev) ? prev : fetched[0].id
        );
      } else if (!response.ok || data?.error) {
        setModelsError(data?.error || 'Unable to load OpenRouter models.');
      }
    } catch (err) {
      setModelsError(
        err instanceof Error ? err.message : 'Unable to load OpenRouter models.'
      );
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    void loadModels(false);
  }, []);

  const updateTurn = useCallback(
    (
      projectId: string,
      turnId: string,
      updater: (turn: BuilderTurn) => BuilderTurn
    ) => {
      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== projectId) return proj;
          return {
            ...proj,
            turns: proj.turns.map((t) => (t.id === turnId ? updater(t) : t)),
          };
        })
      );
    },
    []
  );

  const adjustLocalCredits = useCallback((delta: number) => {
    if (delta === 0) return;
    setCredits((prev) => Math.max(0, prev + delta));
    setBilling((prev) => {
      if (!prev) return prev;
      const nextMonthly = Math.max(0, prev.monthlyCreditsRemaining + delta);
      const nextDaily = Math.max(0, prev.dailyCreditsUsed - delta);
      const updated: BillingSummary = {
        ...prev,
        dailyCreditsUsed: nextDaily,
        monthlyCreditsRemaining: nextMonthly,
      };
      try {
        window.localStorage.setItem(STORAGE_BILLING_KEY, JSON.stringify(updated));
      } catch {
        // ignore storage error
      }
      return updated;
    });
  }, []);

  const consumeSseStream = useCallback(
    async (
      projectId: string,
      turnId: string,
      fallbackStartedAt: number,
      response: Response,
      onJobAssigned?: (jobId: string) => void
    ): Promise<{ sawTerminalEvent: boolean; latestJobId?: string }> => {
      if (!response.body) {
        throw new Error('Failed to connect to AI Craft.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawTerminalEvent = false;
      let latestJobId: string | undefined;
      let startedAt = fallbackStartedAt;

      // Batch rapid token deltas (~90ms) so concurrent background builds cause zero UI lag
      let pendingDelta = '';
      let pendingBytes: number | null = null;
      let flushTimer: number | null = null;

      // Smooth, realistic token metering: 0 credits for chat/thinking, ~1 credit / ~950ms during active builds
      let turnChargedSoFar = 0;
      let targetCreditsForTurn = 0;
      let currentTurnPhase: 'understanding' | 'building' | 'complete' | 'error' = 'understanding';
      let currentTurnKind: TurnKind = 'chat';
      let latestBytesBuilt = 0;
      let creditTickTimer: number | null = null;

      const stopCreditTicker = () => {
        if (creditTickTimer !== null) {
          window.clearTimeout(creditTickTimer);
          creditTickTimer = null;
        }
      };

      const scheduleCreditTicker = () => {
        if (creditTickTimer !== null) return;
        if (turnChargedSoFar >= targetCreditsForTurn) return;
        const delayMs = turnChargedSoFar === 0 ? 320 : 950;
        creditTickTimer = window.setTimeout(() => {
          creditTickTimer = null;
          if (turnChargedSoFar < targetCreditsForTurn) {
            turnChargedSoFar += 1;
            adjustLocalCredits(-1);
          }
          if (turnChargedSoFar < targetCreditsForTurn) {
            scheduleCreditTicker();
          }
        }, delayMs);
      };

      const flushBuffered = () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        const deltaChunk = pendingDelta;
        const bytesChunk = pendingBytes;
        pendingDelta = '';
        pendingBytes = null;
        if (!deltaChunk && bytesChunk === null) return;

        updateTurn(projectId, turnId, (t) => ({
          ...t,
          aiText: deltaChunk ? t.aiText + deltaChunk : t.aiText,
          bytesBuilt: bytesChunk !== null ? bytesChunk : t.bytesBuilt,
        }));
      };

      const scheduleBufferedFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(flushBuffered, 90);
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const rawEvent of events) {
            const line = rawEvent
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!line) continue;

            try {
              const evt = JSON.parse(line.slice(6)) as {
                type: string;
                jobId?: string;
                startedAt?: number;
                status?: 'running' | 'complete' | 'error';
                kind?: TurnKind;
                modelId?: string;
                modelUsed?: string;
                modelName?: string;
                provider?: string;
                phase?: 'understanding' | 'building' | 'complete' | 'error';
                label?: string;
                phaseLabel?: string;
                action?: string;
                activeAction?: string;
                path?: string;
                activeFile?: string;
                allFiles?: string[];
                files?: string[];
                allSteps?: string[];
                planSteps?: string[];
                suggestions?: string[];
                tables?: IncomingSchemaTable[];
                dbTables?: IncomingSchemaTable[];
                bytesBuilt?: number;
                used?: number;
                targetUsed?: number;
                creditsUsed?: number;
                billing?: BillingSummary | null;
                text?: string;
                aiText?: string;
                fullText?: string;
                previewHtml?: string;
                message?: string;
                errorMessage?: string;
                thoughtSeconds?: number;
              };

              if (evt.type === 'job' && evt.jobId) {
                latestJobId = evt.jobId;
                if (typeof evt.startedAt === 'number') {
                  startedAt = evt.startedAt;
                }
                onJobAssigned?.(evt.jobId);
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  jobId: evt.jobId,
                  startedAt: typeof evt.startedAt === 'number' ? evt.startedAt : t.startedAt,
                }));
              } else if (evt.type === 'snapshot') {
                flushBuffered();
                if (typeof evt.startedAt === 'number') {
                  startedAt = evt.startedAt;
                }
                if (evt.kind) currentTurnKind = evt.kind;
                if (evt.phase) currentTurnPhase = evt.phase;
                if (typeof evt.bytesBuilt === 'number') latestBytesBuilt = evt.bytesBuilt;
                if (Array.isArray(evt.dbTables) && evt.dbTables.length > 0) {
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === projectId
                        ? {
                            ...p,
                            databaseConfig: mergeIncomingDbSchema(
                              p.databaseConfig,
                              evt.dbTables!
                            ),
                          }
                        : p
                    )
                  );
                }
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  jobId: evt.jobId ?? t.jobId,
                  startedAt: typeof evt.startedAt === 'number' ? evt.startedAt : t.startedAt,
                  kind: evt.kind ?? t.kind,
                  phase: evt.phase ?? t.phase,
                  phaseLabel: evt.phaseLabel ?? t.phaseLabel,
                  thoughtSeconds:
                    typeof evt.thoughtSeconds === 'number'
                      ? evt.thoughtSeconds
                      : t.thoughtSeconds,
                  aiText: typeof evt.aiText === 'string' ? evt.aiText : t.aiText,
                  previewHtml: evt.previewHtml || t.previewHtml,
                  files: Array.isArray(evt.files) ? evt.files : t.files,
                  planSteps: Array.isArray(evt.planSteps) ? evt.planSteps : t.planSteps,
                  suggestions: Array.isArray(evt.suggestions)
                    ? evt.suggestions
                    : t.suggestions,
                  activeAction: evt.activeAction ?? t.activeAction,
                  activeFile: evt.activeFile ?? t.activeFile,
                  bytesBuilt:
                    typeof evt.bytesBuilt === 'number' ? evt.bytesBuilt : t.bytesBuilt,
                  modelId: evt.modelId ?? t.modelId,
                  modelName: evt.modelName ?? t.modelName,
                  modelProvider: evt.provider ?? t.modelProvider,
                  errorMessage: evt.errorMessage ?? t.errorMessage,
                }));
              } else if (evt.type === 'meta') {
                if (evt.kind) currentTurnKind = evt.kind;
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  kind: evt.kind ?? t.kind,
                  modelId: evt.modelId ?? t.modelId,
                  modelName: evt.modelName ?? t.modelName,
                  modelProvider: evt.provider ?? t.modelProvider,
                }));
              } else if (
                evt.type === 'phase' &&
                (evt.phase === 'understanding' || evt.phase === 'building') &&
                evt.label
              ) {
                flushBuffered();
                const nextPhase = evt.phase;
                currentTurnPhase = nextPhase;
                currentTurnKind = evt.kind ?? (nextPhase === 'building' ? 'build' : currentTurnKind);
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  kind:
                    evt.kind ??
                    (nextPhase === 'building' ? 'build' : t.kind),
                  phase: nextPhase,
                  phaseLabel: evt.label!,
                }));
              } else if (evt.type === 'plan' && Array.isArray(evt.allSteps)) {
                flushBuffered();
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  planSteps: evt.allSteps,
                }));
              } else if (evt.type === 'schema' && Array.isArray(evt.tables)) {
                const incomingTables = evt.tables;
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === projectId
                      ? {
                          ...p,
                          databaseConfig: mergeIncomingDbSchema(
                            p.databaseConfig,
                            incomingTables
                          ),
                        }
                      : p
                  )
                );
                window.dispatchEvent(
                  new CustomEvent('aicraft:db-updated', { detail: { projectId } })
                );
              } else if (evt.type === 'credits') {
                const desiredTarget =
                  typeof evt.targetUsed === 'number'
                    ? evt.targetUsed
                    : typeof evt.used === 'number'
                      ? evt.used
                      : 0;
                if (desiredTarget > targetCreditsForTurn) {
                  targetCreditsForTurn = Math.min(CLIENT_MAX_CREDITS_PER_BUILD, desiredTarget);
                  scheduleCreditTicker();
                }
              } else if (evt.type === 'file' && evt.path) {
                flushBuffered();
                currentTurnKind = 'build';
                if (currentTurnPhase === 'understanding') {
                  currentTurnPhase = 'building';
                }
                if (typeof evt.bytesBuilt === 'number') {
                  latestBytesBuilt = evt.bytesBuilt;
                  const estCredits = calculateClientBuildCredits(evt.bytesBuilt);
                  if (estCredits > targetCreditsForTurn) {
                    targetCreditsForTurn = estCredits;
                    scheduleCreditTicker();
                  }
                }
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  kind: 'build',
                  phase: t.phase === 'understanding' ? 'building' : t.phase,
                  activeAction: evt.action ?? t.activeAction,
                  activeFile: evt.path!,
                  files: evt.allFiles ?? t.files,
                  bytesBuilt:
                    typeof evt.bytesBuilt === 'number'
                      ? evt.bytesBuilt
                      : t.bytesBuilt,
                }));
              } else if (evt.type === 'progress') {
                if (typeof evt.bytesBuilt === 'number') {
                  latestBytesBuilt = evt.bytesBuilt;
                  pendingBytes = evt.bytesBuilt;
                  scheduleBufferedFlush();
                  if (currentTurnPhase === 'building' || currentTurnKind === 'build') {
                    const estCredits = calculateClientBuildCredits(evt.bytesBuilt);
                    if (estCredits > targetCreditsForTurn) {
                      targetCreditsForTurn = estCredits;
                      scheduleCreditTicker();
                    }
                  }
                }
              } else if (evt.type === 'reset') {
                stopCreditTicker();
                if (turnChargedSoFar > 0) {
                  adjustLocalCredits(turnChargedSoFar);
                  turnChargedSoFar = 0;
                }
                targetCreditsForTurn = 0;
                currentTurnKind = 'chat';
                currentTurnPhase = 'understanding';
                latestBytesBuilt = 0;
                pendingDelta = '';
                pendingBytes = null;
                if (flushTimer !== null) {
                  window.clearTimeout(flushTimer);
                  flushTimer = null;
                }
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  kind: 'chat',
                  phase: 'understanding',
                  phaseLabel: 'Thinking...',
                  aiText: '',
                  files: [],
                  planSteps: [],
                  suggestions: [],
                  activeFile: '',
                  activeAction: 'Thinking',
                  bytesBuilt: 0,
                }));
              } else if (evt.type === 'delta' && evt.text) {
                pendingDelta += evt.text;
                scheduleBufferedFlush();
              } else if (evt.type === 'done') {
                sawTerminalEvent = true;
                stopCreditTicker();
                flushBuffered();
                const finalKind = evt.kind ?? currentTurnKind;
                const finalSeconds = Math.max(
                  1,
                  Math.round(
                    (Date.now() - (typeof evt.startedAt === 'number' ? evt.startedAt : startedAt)) /
                      1000
                  )
                );
                updateTurn(projectId, turnId, (t) => {
                  const resolvedFiles = evt.allFiles ?? t.files;
                  return {
                    ...t,
                    kind: evt.kind ?? t.kind,
                    phase: 'complete',
                    phaseLabel:
                      (evt.kind ?? t.kind) === 'chat'
                        ? 'Answered'
                        : 'Build complete',
                    thoughtSeconds: finalSeconds,
                    aiText:
                      typeof evt.fullText === 'string' && evt.fullText.trim()
                        ? evt.fullText
                        : t.aiText,
                    previewHtml: evt.previewHtml || t.previewHtml,
                    files: resolvedFiles,
                    suggestions: Array.isArray(evt.suggestions)
                      ? evt.suggestions
                      : t.suggestions,
                    activeAction:
                      resolvedFiles.length > 0 ? 'Built' : t.activeAction,
                    activeFile: resolvedFiles[0] ?? t.activeFile,
                    bytesBuilt:
                      typeof evt.bytesBuilt === 'number'
                        ? evt.bytesBuilt
                        : t.bytesBuilt,
                    modelId: evt.modelUsed ?? t.modelId,
                    modelName: evt.modelName ?? t.modelName,
                    modelProvider: evt.provider ?? t.modelProvider,
                  };
                });
                if (Array.isArray(evt.dbTables) && evt.dbTables.length > 0) {
                  const doneTables = evt.dbTables;
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === projectId
                        ? {
                            ...p,
                            databaseConfig: mergeIncomingDbSchema(
                              p.databaseConfig,
                              doneTables
                            ),
                          }
                        : p
                    )
                  );
                  window.dispatchEvent(
                    new CustomEvent('aicraft:db-updated', { detail: { projectId } })
                  );
                }
                if (evt.billing) {
                  applyBillingSummary(evt.billing);
                } else {
                  const hasBuiltCode =
                    Boolean(evt.previewHtml) ||
                    (Array.isArray(evt.allFiles) && evt.allFiles.length > 0);
                  const expectedFinalCost =
                    finalKind === 'chat' || !hasBuiltCode
                      ? 0
                      : Math.min(
                          CLIENT_MAX_CREDITS_PER_BUILD,
                          Math.max(
                            1,
                            typeof evt.creditsUsed === 'number'
                              ? evt.creditsUsed
                              : calculateClientBuildCredits(
                                  typeof evt.bytesBuilt === 'number'
                                    ? evt.bytesBuilt
                                    : latestBytesBuilt
                                )
                          )
                        );
                  const diff = expectedFinalCost - turnChargedSoFar;
                  if (diff !== 0) {
                    adjustLocalCredits(-diff);
                  }
                  void syncBillingFromServer();
                }
                if (
                  notificationsEnabled &&
                  document.visibilityState === 'hidden' &&
                  typeof Notification !== 'undefined' &&
                  Notification.permission === 'granted'
                ) {
                  try {
                    const matchedProj = projectsRef.current.find(
                      (p) => p.id === projectId
                    );
                    new Notification(matchedProj?.title || 'AI Craft', {
                      body:
                        (evt.kind ?? 'chat') === 'build'
                          ? 'Your app build is finished and ready to preview.'
                          : 'AI Craft finished replying to your message.',
                    });
                  } catch {
                    // ignore notification error in unsupported contexts
                  }
                }
              } else if (evt.type === 'error') {
                sawTerminalEvent = true;
                stopCreditTicker();
                flushBuffered();
                if (turnChargedSoFar > 0) {
                  adjustLocalCredits(turnChargedSoFar);
                  turnChargedSoFar = 0;
                  void syncBillingFromServer();
                }
                updateTurn(projectId, turnId, (t) => ({
                  ...t,
                  phase: 'error',
                  phaseLabel: 'Error',
                  errorMessage: evt.message ?? 'AI Craft encountered an error.',
                }));
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      } finally {
        stopCreditTicker();
        flushBuffered();
      }

      return { sawTerminalEvent, latestJobId };
    },
    [
      adjustLocalCredits,
      applyBillingSummary,
      notificationsEnabled,
      syncBillingFromServer,
      updateTurn,
    ]
  );

  const runBuilderStream = useCallback(
    async (
      projectId: string,
      turnId: string,
      message: string,
      targetMode: BuildMode,
      modelToUse: string | undefined,
      history: Array<{ role: string; text: string }>,
      options: ComposerOptions,
      previousHtml = '',
      startedAt = Date.now()
    ) => {
      if (activeConnectionsRef.current.has(turnId)) return;

      const controller = new AbortController();
      activeConnectionsRef.current.set(turnId, controller);

      let knownJobId: string | undefined;

      try {
        const clientTimeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        const clientTime = new Date().toLocaleString();

        const response = await fetch('/api/craft/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAuthHeaders(),
          },
          body: JSON.stringify({
            message,
            mode: targetMode,
            model: modelToUse || undefined,
            clientTime,
            clientTimeZone,
            previousHtml,
            history,
            options,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          let errorText = 'Failed to connect to AI Craft.';
          try {
            const errJson = (await response.json()) as {
              error?: string;
              billing?: BillingSummary;
            };
            if (errJson.billing) {
              applyBillingSummary(errJson.billing);
            }
            if (errJson.error) errorText = errJson.error;
          } catch {
            // ignore parse error
          }
          if (response.status === 402) {
            setInlineNotice(errorText);
            setShowProUpgrade(true);
          }
          throw new Error(errorText);
        }

        const result = await consumeSseStream(
          projectId,
          turnId,
          startedAt,
          response,
          (jid) => {
            knownJobId = jid;
          }
        );

        activeConnectionsRef.current.delete(turnId);

        if (!result.sawTerminalEvent) {
          const reconnectJobId = result.latestJobId || knownJobId;
          if (reconnectJobId && document.visibilityState === 'visible') {
            void resumeJobStreamRef.current?.(projectId, turnId, reconnectJobId);
          } else if (!reconnectJobId) {
            updateTurn(projectId, turnId, (t) =>
              t.phase === 'complete' || t.phase === 'error'
                ? t
                : {
                    ...t,
                    phase: 'error',
                    phaseLabel: 'Paused',
                    errorMessage: 'Stream connection ended early. Send a message to continue.',
                  }
            );
          }
        }
      } catch (err) {
        activeConnectionsRef.current.delete(turnId);
        if ((err as Error).name !== 'AbortError') {
          // If the user left the app on mobile Safari and the socket dropped, reconnect to the backend job instead of failing
          if (knownJobId) {
            if (document.visibilityState === 'visible') {
              window.setTimeout(() => {
                void resumeJobStreamRef.current?.(projectId, turnId, knownJobId!);
              }, 600);
            }
            return;
          }

          const msg =
            err instanceof Error
              ? err.message
              : 'Unable to reach AI Craft engine right now.';
          updateTurn(projectId, turnId, (t) => ({
            ...t,
            phase: 'error',
            phaseLabel: 'Error',
            errorMessage: msg,
          }));
        }
      }
    },
    [applyBillingSummary, consumeSseStream, updateTurn]
  );

  const resumeJobStream = useCallback(
    async (projectId: string, turnId: string, jobId?: string) => {
      if (activeConnectionsRef.current.has(turnId)) return;

      const project = projectsRef.current.find((p) => p.id === projectId);
      const turn = project?.turns.find((t) => t.id === turnId);
      if (!project || !turn) return;
      if (turn.phase === 'complete' || turn.phase === 'error') return;

      const targetJobId = jobId || turn.jobId;
      if (!targetJobId) {
        if (!retriedTurnsRef.current.has(turnId)) {
          retriedTurnsRef.current.add(turnId);
          const idx = project.turns.findIndex((t) => t.id === turnId);
          const priorTurns = idx > 0 ? project.turns.slice(0, idx) : [];
          const history = priorTurns.flatMap((t) => [
            { role: 'user', text: t.userMessage },
            ...(t.aiText ? [{ role: 'model', text: t.aiText }] : []),
          ]);
          const previousHtml =
            [...priorTurns].reverse().find((t) => Boolean(t.previewHtml))?.previewHtml ?? '';
          void runBuilderStream(
            project.id,
            turn.id,
            turn.userMessage,
            project.mode,
            turn.modelId,
            history,
            {
              reactEnabled: project.mode === 'web',
              backendEnabled: false,
              webSearchEnabled: true,
              attachmentName: turn.attachmentName,
              attachmentDataUrl: turn.attachmentDataUrl ?? null,
              secretKeys: (project.secrets ?? []).map((s) => s.key),
              databaseTables: (project.databaseConfig?.tables ?? []).map(
                (t) => `${t.name}(${t.columns.map((c) => `${c.name}:${c.type}`).join(',')})`
              ),
            },
            previousHtml,
            turn.startedAt ?? Date.now()
          );
        }
        return;
      }

      const controller = new AbortController();
      activeConnectionsRef.current.set(turnId, controller);

      try {
        const response = await fetch(
          `/api/craft/jobs/${encodeURIComponent(targetJobId)}?stream=1`,
          { signal: controller.signal }
        );

        if (response.status === 404) {
          activeConnectionsRef.current.delete(turnId);
          // Serverless cold start or expired job: automatically re-run once seamlessly
          if (!retriedTurnsRef.current.has(turnId)) {
            retriedTurnsRef.current.add(turnId);
            const idx = project.turns.findIndex((t) => t.id === turnId);
            const priorTurns = idx > 0 ? project.turns.slice(0, idx) : [];
            const history = priorTurns.flatMap((t) => [
              { role: 'user', text: t.userMessage },
              ...(t.aiText ? [{ role: 'model', text: t.aiText }] : []),
            ]);
            const previousHtml =
              [...priorTurns].reverse().find((t) => Boolean(t.previewHtml))?.previewHtml ?? '';
            void runBuilderStream(
              project.id,
              turn.id,
              turn.userMessage,
              project.mode,
              turn.modelId,
              history,
              {
                reactEnabled: project.mode === 'web',
                backendEnabled: false,
                webSearchEnabled: true,
                attachmentName: turn.attachmentName,
                attachmentDataUrl: turn.attachmentDataUrl ?? null,
                secretKeys: (project.secrets ?? []).map((s) => s.key),
                databaseTables: (project.databaseConfig?.tables ?? []).map(
                  (t) => `${t.name}(${t.columns.map((c) => `${c.name}:${c.type}`).join(',')})`
                ),
              },
              previousHtml,
              turn.startedAt ?? Date.now()
            );
            return;
          }

          updateTurn(projectId, turnId, (t) => ({
            ...t,
            phase: 'error',
            phaseLabel: 'Paused',
            errorMessage: 'Build paused while away. Send a message below to continue.',
          }));
          return;
        }

        if (!response.ok || !response.body) {
          activeConnectionsRef.current.delete(turnId);
          return;
        }

        await consumeSseStream(
          projectId,
          turnId,
          turn.startedAt ?? Date.now(),
          response
        );
        activeConnectionsRef.current.delete(turnId);
      } catch {
        activeConnectionsRef.current.delete(turnId);
      }
    },
    [consumeSseStream, runBuilderStream, updateTurn]
  );

  const resumeJobStreamRef = useRef<
    ((projectId: string, turnId: string, jobId?: string) => Promise<void>) | null
  >(null);
  resumeJobStreamRef.current = resumeJobStream;

  // Reconnect any unfinished background builds on app startup, visibility return, or network recovery
  useEffect(() => {
    const syncUnfinishedJobs = (checkActiveSnapshots = false) => {
      for (const proj of projectsRef.current) {
        for (const turn of proj.turns) {
          if (turn.phase !== 'understanding' && turn.phase !== 'building') {
            continue;
          }

          if (!activeConnectionsRef.current.has(turn.id)) {
            void resumeJobStreamRef.current?.(proj.id, turn.id, turn.jobId);
          } else if (checkActiveSnapshots && turn.jobId) {
            // Verify mobile Safari didn't silently freeze an active SSE socket while backgrounded
            void (async () => {
              try {
                const res = await fetch(
                  `/api/craft/jobs/${encodeURIComponent(turn.jobId!)}`
                );
                if (!res.ok) return;
                const snap = (await res.json()) as {
                  status?: 'running' | 'complete' | 'error';
                  phase?: 'understanding' | 'building' | 'complete' | 'error';
                  phaseLabel?: string;
                  kind?: TurnKind;
                  aiText?: string;
                  previewHtml?: string;
                  files?: string[];
                  planSteps?: string[];
                  suggestions?: string[];
                  activeAction?: string;
                  activeFile?: string;
                  bytesBuilt?: number;
                  thoughtSeconds?: number;
                  modelId?: string;
                  modelName?: string;
                  provider?: string;
                  errorMessage?: string;
                };
                if (snap.status === 'complete' || snap.status === 'error') {
                  activeConnectionsRef.current.get(turn.id)?.abort();
                  activeConnectionsRef.current.delete(turn.id);
                  updateTurn(proj.id, turn.id, (t) => ({
                    ...t,
                    kind: snap.kind ?? t.kind,
                    phase: snap.phase ?? t.phase,
                    phaseLabel: snap.phaseLabel ?? t.phaseLabel,
                    thoughtSeconds:
                      typeof snap.thoughtSeconds === 'number'
                        ? snap.thoughtSeconds
                        : t.thoughtSeconds,
                    aiText:
                      typeof snap.aiText === 'string' && snap.aiText.trim()
                        ? snap.aiText
                        : t.aiText,
                    previewHtml: snap.previewHtml || t.previewHtml,
                    files: Array.isArray(snap.files) ? snap.files : t.files,
                    planSteps: Array.isArray(snap.planSteps)
                      ? snap.planSteps
                      : t.planSteps,
                    suggestions: Array.isArray(snap.suggestions)
                      ? snap.suggestions
                      : t.suggestions,
                    activeAction: snap.activeAction ?? t.activeAction,
                    activeFile: snap.activeFile ?? t.activeFile,
                    bytesBuilt:
                      typeof snap.bytesBuilt === 'number'
                        ? snap.bytesBuilt
                        : t.bytesBuilt,
                    modelId: snap.modelId ?? t.modelId,
                    modelName: snap.modelName ?? t.modelName,
                    modelProvider: snap.provider ?? t.modelProvider,
                    errorMessage: snap.errorMessage ?? t.errorMessage,
                  }));
                }
              } catch {
                // ignore background check failure
              }
            })();
          }
        }
      }
    };

    syncUnfinishedJobs(false);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (persistTimerRef.current !== null) {
          window.clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        saveProjectsSafely(projectsRef.current);
      } else if (document.visibilityState === 'visible') {
        syncUnfinishedJobs(true);
        void syncBillingFromServer();
      }
    };

    const handlePageHide = () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      saveProjectsSafely(projectsRef.current);
    };

    const handleOnline = () => {
      syncUnfinishedJobs(true);
      void syncBillingFromServer();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('online', handleOnline);
    };
  }, [syncBillingFromServer, updateTurn]);

  const handleModeChange = (nextMode: BuildMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
  };

  const checkCanConsumeCredit = useCallback((): boolean => {
    if (
      credits <= 0 ||
      (billing !== null && billing.monthlyCreditsRemaining <= 0)
    ) {
      setInlineNotice(
        proPlanId
          ? 'No credits remaining for this 30-day cycle. Wait for refresh or upgrade your plan.'
          : 'Your 300 free credits are used up. Upgrade to keep chatting or wait for your 30-day refresh.'
      );
      setShowProUpgrade(true);
      return false;
    }

    if (
      billing?.dailyLimit !== null &&
      billing?.dailyLimit !== undefined &&
      billing.dailyCreditsUsed >= billing.dailyLimit
    ) {
      setInlineNotice(
        `Daily limit reached (${billing.dailyLimit.toLocaleString()} credits/day on ${billing.planName}). Resets in 24 hours.`
      );
      setShowProUpgrade(true);
      return false;
    }

    return true;
  }, [billing, credits, proPlanId]);

  // Immediately transforms to BuilderWorkspace when a message is sent from the first screen
  // without ever interrupting or stopping any other project currently building
  const handlePromptSubmit = (options: ComposerOptions) => {
    const trimmed =
      prompt.trim() ||
      (options.attachmentName
        ? `Build an app based on ${options.attachmentName}`
        : '');
    if (!trimmed) return;
    if (!checkCanConsumeCredit()) return;

    unlockSpeechSynthesis();

    const now = Date.now();
    const projectId = `proj-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const turnId = `turn-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const currentModel = models.find((m) => m.id === selectedModel);
    const chosenModelId = currentModel?.id || selectedModel || undefined;

    const newTurn: BuilderTurn = {
      id: turnId,
      startedAt: now,
      kind: 'chat',
      userMessage: trimmed,
      attachmentName: options.attachmentName,
      attachmentDataUrl: options.attachmentDataUrl ?? null,
      phase: 'understanding',
      phaseLabel: 'Thinking...',
      thoughtSeconds: 1,
      activeAction: 'Thinking',
      activeFile: '',
      files: [],
      bytesBuilt: 0,
      aiText: '',
      modelId: chosenModelId,
      modelName: currentModel?.name,
      modelProvider: currentModel?.provider,
    };

    const newProject: CraftProject = {
      id: projectId,
      title: deriveProjectTitle(trimmed, mode),
      mode,
      createdAt: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      turns: [newTurn],
    };

    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(projectId);
    setPrompt('');
    setViewMode('builder');

    void runBuilderStream(
      projectId,
      turnId,
      trimmed,
      mode,
      chosenModelId,
      [],
      options,
      '',
      now
    );
  };

  const handleFollowUp = (message: string, options: ComposerOptions) => {
    if (!activeProject || isProjectWorking(activeProject)) return;
    if (!checkCanConsumeCredit()) return;

    unlockSpeechSynthesis();

    const now = Date.now();
    const turnId = `turn-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const currentModel = models.find((m) => m.id === selectedModel);
    const chosenModelId = currentModel?.id || selectedModel || undefined;

    const newTurn: BuilderTurn = {
      id: turnId,
      startedAt: now,
      kind: 'chat',
      userMessage: message,
      attachmentName: options.attachmentName,
      attachmentDataUrl: options.attachmentDataUrl ?? null,
      phase: 'understanding',
      phaseLabel: 'Thinking...',
      thoughtSeconds: 1,
      activeAction: 'Thinking',
      activeFile: '',
      files: [],
      bytesBuilt: 0,
      aiText: '',
      modelId: chosenModelId,
      modelName: currentModel?.name,
      modelProvider: currentModel?.provider,
    };

    const history = activeProject.turns.flatMap((t) => [
      { role: 'user', text: t.userMessage },
      ...(t.aiText ? [{ role: 'model', text: t.aiText }] : []),
    ]);

    const previousHtml =
      [...activeProject.turns]
        .reverse()
        .find((t) => Boolean(t.previewHtml))?.previewHtml ?? '';

    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id ? { ...p, turns: [...p.turns, newTurn] } : p
      )
    );

    void runBuilderStream(
      activeProject.id,
      turnId,
      message,
      activeProject.mode,
      chosenModelId,
      history,
      options,
      previousHtml,
      now
    );
  };

  const handleScanClick = () => {
    setInlineNotice('QR preview scanner ready');
  };

  const handleCreditsClick = () => {
    setShowProUpgrade(true);
  };

  const applyVerifiedTransaction = useCallback(
    (tx: PaymentTransaction, nextBilling?: BillingSummary | null) => {
      setTransactions((prev) => {
        const merged = [tx, ...prev.filter((item) => item.reference !== tx.reference)];
        try {
          window.localStorage.setItem(STORAGE_TRANSACTIONS_KEY, JSON.stringify(merged));
        } catch {
          // ignore storage write error
        }
        return merged;
      });

      if (tx.status !== 'paid') return;

      if (nextBilling) {
        applyBillingSummary(nextBilling);
      } else {
        const alreadyCredited = (() => {
          const list = loadStoredJson<string[]>(STORAGE_CREDITED_REFS_KEY);
          return Array.isArray(list) && list.includes(tx.reference);
        })();

        setProPlanId(tx.planId);
        try {
          window.localStorage.setItem(STORAGE_PRO_PLAN_KEY, tx.planId);
        } catch {
          // ignore storage write error
        }

        if (!alreadyCredited) {
          setCredits(tx.creditsToAdd);
          try {
            const list = loadStoredJson<string[]>(STORAGE_CREDITED_REFS_KEY);
            const nextList = Array.isArray(list)
              ? [...list, tx.reference]
              : [tx.reference];
            window.localStorage.setItem(
              STORAGE_CREDITED_REFS_KEY,
              JSON.stringify(nextList)
            );
          } catch {
            // ignore storage write error
          }
        }
        void syncBillingFromServer();
      }

      setShowProUpgrade(false);
      setInlineNotice(
        `AI Craft ${tx.planName} activated · ${tx.creditsToAdd.toLocaleString()} credits / 30 days`
      );
    },
    [applyBillingSummary, syncBillingFromServer]
  );

  const refreshTransactions = useCallback(async () => {
    const email = (authUser?.email || userProfile.email || '').trim();
    setTransactionsLoading(true);
    try {
      const res = await fetch(
        `/api/payments/transactions?email=${encodeURIComponent(email)}`
      );
      const raw = await res.text();
      let payload: { transactions?: PaymentTransaction[] } = {};
      try {
        payload = raw ? (JSON.parse(raw) as typeof payload) : {};
      } catch {
        payload = {};
      }
      if (res.ok && Array.isArray(payload.transactions)) {
        setTransactions((prev) => {
          const map = new Map<string, PaymentTransaction>();
          for (const item of payload.transactions!) {
            if (item?.reference) map.set(item.reference, item);
          }
          for (const localItem of prev) {
            if (localItem?.reference && !map.has(localItem.reference)) {
              map.set(localItem.reference, localItem);
            }
          }
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()
          );
          try {
            window.localStorage.setItem(
              STORAGE_TRANSACTIONS_KEY,
              JSON.stringify(merged)
            );
          } catch {
            // ignore storage write error
          }
          return merged;
        });
      }
    } catch {
      // keep existing local transactions if offline
    } finally {
      setTransactionsLoading(false);
    }
  }, [authUser?.email, userProfile.email]);

  useEffect(() => {
    if (!authUser) return;
    void refreshTransactions();
  }, [authUser, refreshTransactions]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentRef = params.get('payment_ref');
    const paymentError = params.get('payment_error');

    if (paymentError) {
      setInlineNotice(paymentError);
      params.delete('payment_error');
      const next = params.toString();
      window.history.replaceState(
        {},
        '',
        next ? `${window.location.pathname}?${next}` : window.location.pathname
      );
      return;
    }

    if (!paymentRef) return;

    params.delete('payment_ref');
    const next = params.toString();
    window.history.replaceState(
      {},
      '',
      next ? `${window.location.pathname}?${next}` : window.location.pathname
    );

    void (async () => {
      try {
        const res = await fetch('/api/payments/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAuthHeaders(),
          },
          body: JSON.stringify({ reference: paymentRef }),
        });
        const raw = await res.text();
        let data: {
          verified?: boolean;
          transaction?: PaymentTransaction;
          billing?: BillingSummary | null;
          error?: string;
        } = {};
        try {
          data = raw ? (JSON.parse(raw) as typeof data) : {};
        } catch {
          data = {};
        }
        if (res.ok && data.verified && data.transaction) {
          applyVerifiedTransaction(data.transaction, data.billing || null);
        } else {
          setInlineNotice(data.error || 'Could not confirm payment status.');
        }
      } catch {
        setInlineNotice('Unable to confirm payment right now.');
      }
    })();
  }, [applyVerifiedTransaction]);

  const handleRestorePurchase = async () => {
    const email = (authUser?.email || userProfile.email || '').trim();
    try {
      await syncBillingFromServer();
      const res = await fetch(
        `/api/payments/transactions?email=${encodeURIComponent(email)}`
      );
      const raw = await res.text();
      let data: { transactions?: PaymentTransaction[] } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        data = {};
      }
      if (res.ok && Array.isArray(data.transactions)) {
        const latestPaid = data.transactions.find((t) => t.status === 'paid');
        if (latestPaid) {
          applyVerifiedTransaction(latestPaid);
          return {
            restored: true,
            message: `Restored AI Craft ${latestPaid.planName}.`,
          };
        }
      }
    } catch {
      // fall back to local saved plan
    }

    const savedPlan = loadSavedString(STORAGE_PRO_PLAN_KEY);
    if (savedPlan) {
      const matched = PRO_PLANS.find((p) => p.id === savedPlan);
      setProPlanId(savedPlan);
      return {
        restored: true,
        message: matched
          ? `Restored AI Craft ${matched.name} (${matched.priceText}).`
          : 'Restored active AI Craft Pro plan.',
      };
    }
    return {
      restored: false,
      message: 'No previous subscription found for this account.',
    };
  };

  const proModalElement = (
    <ProUpgradeModal
      open={showProUpgrade}
      credits={credits}
      activePlanId={proPlanId}
      billing={billing}
      userEmail={authUser?.email || userProfile.email}
      userId={authUser?.id}
      authHeaders={getStoredAuthHeaders()}
      dynamicColorEnabled={dynamicColorEnabled}
      onClose={() => setShowProUpgrade(false)}
      onPaymentSuccess={applyVerifiedTransaction}
      onRestorePurchase={handleRestorePurchase}
    />
  );

  const handleAuthenticated = useCallback(
    (user: AuthUser, session: StoredSupabaseSession) => {
      setAuthUser(user);
      setAuthChecking(false);
      setRecoveryTokens(null);
      cloudHydratedUserRef.current = null;
      try {
        window.localStorage.setItem(STORAGE_SB_SESSION_KEY, JSON.stringify(session));
        if (window.location.search.includes('auth_recovery=')) {
          window.history.replaceState({}, '', '/');
        }
      } catch {
        // ignore storage error
      }
      setUserProfile((prev) => ({
        name: user.name || prev.name,
        email: user.email || prev.email,
        avatarDataUrl: prev.avatarDataUrl || user.avatarUrl || null,
      }));
    },
    []
  );

  const handleSignOut = useCallback(async () => {
    const stored = loadStoredJson<StoredSupabaseSession>(STORAGE_SB_SESSION_KEY);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: stored?.accessToken
          ? { Authorization: `Bearer ${stored.accessToken}` }
          : undefined,
      });
    } catch {
      // ignore network error on sign out
    }
    try {
      window.localStorage.removeItem(STORAGE_SB_SESSION_KEY);
      window.localStorage.removeItem(STORAGE_BILLING_KEY);
      window.localStorage.removeItem(STORAGE_PRO_PLAN_KEY);
      window.localStorage.removeItem(STORAGE_CREDITS_KEY);
    } catch {
      // ignore storage error
    }
    cloudHydratedUserRef.current = null;
    setBilling(null);
    setProPlanId(null);
    setCredits(300);
    setShowProUpgrade(false);
    setViewMode('home');
    setActiveTab('create');
    setAuthUser(null);
  }, []);

  const isBuilderOpen = viewMode === 'builder' && Boolean(activeProject);
  const showHead3D =
    Boolean(authUser) && !isBuilderOpen && activeTab === 'create' && !showProUpgrade;
  const activeWorkspaceView: WorkspaceView = activeProject
    ? (projectViews[activeProject.id] ?? 'chat')
    : 'chat';

  const headOverlayElement = (
    <div
      aria-hidden={!showHead3D}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[35] max-w-[540px] mx-auto ${
        showHead3D ? 'opacity-100 visible' : 'opacity-0 invisible'
      }`}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          top: 'calc(max(6px, env(safe-area-inset-top)) + 2px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'clamp(86px, 23vw, 98px)',
          height: 'clamp(86px, 23vw, 98px)',
        }}
      >
        <Head3DOverlay active={showHead3D} />
      </div>
    </div>
  );

  const initialAuthView: AuthViewMode = recoveryTokens ? 'recovery' : 'welcome';

  return (
    <>
      {authChecking ? (
        <div className="fixed inset-0 h-dvh w-full bg-white flex flex-col items-center justify-center gap-3 overflow-hidden">
          <img
            src="/logo-mark.png"
            alt="AI Craft"
            className="w-14 h-14 object-contain animate-pulse"
          />
        </div>
      ) : !authUser ? (
        <AuthScreen
          initialView={initialAuthView}
          recoveryTokens={recoveryTokens}
          onAuthenticated={handleAuthenticated}
        />
      ) : viewMode === 'builder' && activeProject ? (
        <>
          {activeWorkspaceView !== 'preview' && <OfflineIndicator />}
          <BuilderWorkspace
            projectId={activeProject.id}
            projectTitle={activeProject.title}
            mode={activeProject.mode}
            credits={credits}
            turns={activeProject.turns}
            isStreaming={activeProjectIsStreaming}
            activeView={activeWorkspaceView}
            isPublished={
              Boolean(publishedProjects[activeProject.id]) ||
              activeProject.deployment?.status === 'deployed'
            }
            secrets={activeProject.secrets ?? []}
            databaseConfig={
              activeProject.databaseConfig ?? {
                enabled: true,
                providerLabel: 'Cloud & Local App Store',
                tables: [],
              }
            }
            deployment={
              activeProject.deployment ?? {
                status: publishedProjects[activeProject.id] ? 'deployed' : 'draft',
                slug:
                  activeProject.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '') || 'aicraft-app',
                version: publishedProjects[activeProject.id] ? 1 : 0,
                deployedAt: null,
                environment: 'production',
              }
            }
            models={models}
            selectedModel={selectedModel}
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            authHeaders={getStoredAuthHeaders()}
            inlineNotice={inlineNotice}
            onSelectModel={setSelectedModel}
            onRetryModels={() => void loadModels(true)}
            onSetView={(view) => {
              setProjectViews((prev) => ({
                ...prev,
                [activeProject.id]: view,
              }));
            }}
            onPublish={() => {
              setPublishedProjects((prev) => ({
                ...prev,
                [activeProject.id]: true,
              }));
            }}
            onUpdateSecrets={(nextSecrets) => {
              setProjects((prev) =>
                prev.map((proj) =>
                  proj.id === activeProject.id
                    ? { ...proj, secrets: nextSecrets }
                    : proj
                )
              );
            }}
            onUpdateDatabase={(nextDb) => {
              setProjects((prev) =>
                prev.map((proj) =>
                  proj.id === activeProject.id
                    ? { ...proj, databaseConfig: nextDb }
                    : proj
                )
              );
            }}
            onDeployProject={(slug) => {
              const nowIso = new Date().toISOString();
              setPublishedProjects((prev) => ({
                ...prev,
                [activeProject.id]: true,
              }));
              setProjects((prev) =>
                prev.map((proj) => {
                  if (proj.id !== activeProject.id) return proj;
                  const prevVersion = proj.deployment?.version ?? 0;
                  return {
                    ...proj,
                    deployment: {
                      status: 'deployed',
                      slug,
                      version: prevVersion + 1,
                      deployedAt: nowIso,
                      environment: 'production',
                    },
                  };
                })
              );
              setInlineNotice(`${activeProject.title} deployed live`);
            }}
            onBack={() => {
              if (activeWorkspaceView !== 'chat') {
                setProjectViews((prev) => ({
                  ...prev,
                  [activeProject.id]: 'chat',
                }));
              } else {
                setViewMode('home');
                setActiveTab('create');
              }
            }}
            onSendFollowUp={handleFollowUp}
            onCheckCanUseAi={checkCanConsumeCredit}
            onPaymentRequired={(nextBilling, errMsg) => {
              if (nextBilling) applyBillingSummary(nextBilling);
              if (errMsg) setInlineNotice(errMsg);
              setShowProUpgrade(true);
            }}
            onOpenApps={() => {
              setViewMode('home');
              setActiveTab('apps');
            }}
            onOpenSettings={() => {
              setViewMode('home');
              setActiveTab('setting');
            }}
            onOpenUpgrade={() => setShowProUpgrade(true)}
            autoReadEnabled={autoReadEnabled}
          />
        </>
      ) : (
        <div className="fixed inset-0 h-dvh w-full flex flex-col justify-between bg-white overflow-hidden overscroll-none select-none sm:select-auto">
      {/* Full-Bleed Real-Time Dynamic Top Ambient Color Wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[56dvh] transition-all duration-700 ease-out"
        style={{
          opacity: dynamicColorEnabled ? 0.92 + energyLevel * 0.08 : 0.35,
          background:
            mode === 'mobile'
              ? 'radial-gradient(ellipse 85% 75% at 62% 20%, rgba(254, 240, 138, 0.55) 0%, rgba(254, 249, 195, 0.25) 45%, rgba(255, 255, 255, 0) 80%)'
              : 'radial-gradient(ellipse 85% 75% at 38% 20%, rgba(245, 208, 254, 0.58) 0%, rgba(250, 232, 255, 0.28) 45%, rgba(255, 255, 255, 0) 80%)',
        }}
      />

      {/* Non-intrusive offline indicator */}
      <OfflineIndicator />

      {/* Top Header */}
      <TopBar
        mode={mode}
        credits={credits}
        avatarDataUrl={userProfile.avatarDataUrl}
        onScanClick={handleScanClick}
        onCreditsClick={handleCreditsClick}
        onAvatarClick={() => setActiveTab('setting')}
        onOpenInstallGuide={() => setActiveTab('setting')}
      />

      {/* Main Content Area — Strictly Single Screen, No Overlapping Screens */}
      <main className="relative z-10 flex-1 min-h-0 w-full flex flex-col">
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === 'create' && (
            <motion.section
              key="screen-create"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 min-h-0 w-full max-w-[460px] mx-auto px-4 sm:px-6 pt-0 pb-1 flex flex-col justify-between items-center overflow-hidden"
            >
              {/* Hero Artwork + Copy */}
              <HeroStage mode={mode} energyLevel={energyLevel} />

              {/* Bottom Controls: Mode Switcher + Composer */}
              <div className="shrink-0 w-full flex flex-col items-center gap-3.5">
                {inlineNotice ? (
                  <p
                    role="status"
                    className={`max-w-full px-3 py-1.5 rounded-xl text-xs font-medium tracking-[-0.01em] text-center ${
                      /credit|limit|upgrade|balance/i.test(inlineNotice)
                        ? 'bg-red-50 border border-red-200 text-red-700'
                        : 'text-[#52525B]'
                    }`}
                  >
                    {inlineNotice}
                  </p>
                ) : null}

                <ModeSwitcher mode={mode} onChange={handleModeChange} />

                <PromptComposer
                  mode={mode}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  models={models}
                  selectedModel={selectedModel}
                  modelsLoading={modelsLoading}
                  modelsError={modelsError}
                  onSelectModel={setSelectedModel}
                  onRetryModels={() => void loadModels(true)}
                  onSubmit={handlePromptSubmit}
                />
              </div>
            </motion.section>
          )}

          {activeTab === 'apps' && (
            <motion.section
              key="screen-apps"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 min-h-0 w-full max-w-[460px] mx-auto px-5 py-4 flex flex-col overflow-hidden"
            >
              <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src="/logo-mark.png"
                      alt="AI Craft logo"
                      className="w-8 h-8 object-contain shrink-0"
                    />
                    <div className="min-w-0">
                      <h1 className="font-display font-bold text-2xl tracking-tight text-[#0B0B0F] leading-none">
                        Apps
                      </h1>
                      <p className="text-sm text-[#52525B] mt-1 truncate">
                        Your crafted iOS, Android, and Web builds appear here.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3.5 min-h-[36px] rounded-full bg-[#0B0B0F] text-white text-xs font-medium hover:bg-black/85 active:scale-95 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New</span>
                  </button>
                </div>

                {projects.length === 0 ? (
                  <div className="rounded-[24px] border border-black/[0.08] bg-white p-6 text-center shadow-[0_6px_24px_rgba(15,15,30,0.04)]">
                    <p className="font-display font-semibold text-base text-[#0B0B0F]">
                      No builds started yet
                    </p>
                    <p className="text-sm text-[#71717A] mt-1.5">
                      Describe your app or website idea on the Create screen to begin.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('create')}
                      className="mt-4 inline-flex items-center gap-2 px-5 min-h-[42px] rounded-full bg-[#0B0B0F] text-white text-sm font-medium hover:bg-black/85 active:scale-[0.98] transition-all"
                    >
                      <span>Start Creating</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {projects.map((item) => {
                      const firstTurn = item.turns[0];
                      const latestTurn = item.turns[item.turns.length - 1];
                      const itemWorking = isProjectWorking(item);
                      const hasAppBuilt = item.turns.some((t) => Boolean(t.previewHtml));
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProjectId(item.id);
                              setMode(item.mode);
                              setViewMode('builder');
                            }}
                            className="w-full text-left rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_4px_16px_rgba(15,15,30,0.03)] hover:border-black/20 active:scale-[0.99] transition-all flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-xs text-[#71717A] flex-wrap">
                                <span className="font-semibold text-[#0B0B0F]">
                                  {item.title}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{MODE_THEMES[item.mode].label}</span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">
                                  {item.createdAt}
                                </span>
                                {itemWorking ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                                    style={{
                                      backgroundColor: MODE_THEMES[item.mode].accentSoft,
                                      color: MODE_THEMES[item.mode].accentColor,
                                    }}
                                  >
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span>
                                      {latestTurn?.phase === 'building'
                                        ? 'Building'
                                        : 'Thinking'}
                                    </span>
                                  </span>
                                ) : hasAppBuilt ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium">
                                    Ready
                                  </span>
                                ) : null}
                              </div>
                              {firstTurn && (
                                <p className="mt-1.5 text-sm text-[#27272F] truncate">
                                  {firstTurn.userMessage}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-[#71717A] shrink-0" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.section>
          )}

          {activeTab === 'setting' && (
            <motion.section
              key="screen-profile"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 min-h-0 w-full flex flex-col"
            >
              <ProfileSection
                profile={userProfile}
                credits={credits}
                proPlanId={proPlanId}
                billing={billing}
                projectCount={projects.length}
                mode={mode}
                dynamicColorEnabled={dynamicColorEnabled}
                notificationsEnabled={notificationsEnabled}
                autoReadEnabled={autoReadEnabled}
                transactions={transactions}
                transactionsLoading={transactionsLoading}
                onRefreshTransactions={refreshTransactions}
                onUpdateProfile={setUserProfile}
                onToggleNotifications={async () => {
                  if (notificationsEnabled) {
                    setNotificationsEnabled(false);
                    return;
                  }
                  if (typeof Notification !== 'undefined') {
                    try {
                      if (Notification.permission === 'default') {
                        const perm = await Notification.requestPermission();
                        if (perm === 'denied') {
                          setInlineNotice('Notifications blocked in browser settings');
                          return;
                        }
                      } else if (Notification.permission === 'denied') {
                        setInlineNotice('Notifications blocked in browser settings');
                        return;
                      }
                    } catch {
                      // proceed with local preference toggle if browser restricts API
                    }
                  }
                  setNotificationsEnabled(true);
                }}
                onToggleAutoRead={() => setAutoReadEnabled((v) => !v)}
                onToggleDynamicColor={() => setDynamicColorEnabled((v) => !v)}
                onToggleMode={() => setMode(mode === 'mobile' ? 'web' : 'mobile')}
                onOpenProPlans={() => setShowProUpgrade(true)}
                onClearProjects={() => {
                  activeConnectionsRef.current.forEach((ctrl) => ctrl.abort());
                  activeConnectionsRef.current.clear();
                  setProjects([]);
                  setActiveProjectId(null);
                  setProjectViews({});
                  setPublishedProjects({});
                }}
                onBackToCreate={() => setActiveTab('create')}
                onSignOut={() => void handleSignOut()}
              />
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Tab Bar */}
      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
        </div>
      )}
      {headOverlayElement}
      {proModalElement}
    </>
  );
}
