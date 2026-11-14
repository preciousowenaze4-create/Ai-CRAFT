import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Rocket,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  BuildMode,
  MODE_THEMES,
  ProjectDatabaseColumn,
  ProjectDatabaseConfig,
  ProjectDatabaseTable,
  ProjectDeploymentConfig,
  ProjectSecret,
} from '../types/craft';

function slugifyProjectTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'aicraft-app'
  );
}

function normalizeSecretKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function maskSecretValue(value: string): string {
  if (!value) return '••••••••';
  if (value.length <= 6) return '••••••••';
  return `••••••••••••${value.slice(-4)}`;
}

function sanitizeTableName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function detectSchemaFromHtml(html: string): {
  dbTables: string[];
  storageKeys: string[];
} {
  if (!html) return { dbTables: [], storageKeys: [] };
  const dbTables = new Set<string>();
  const storageKeys = new Set<string>();

  const dbRegex = /AICraft\.db\.\w+\(\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
  for (const m of html.matchAll(dbRegex)) {
    if (m[1]) dbTables.add(m[1]);
  }

  const sqlRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
  for (const m of html.matchAll(sqlRegex)) {
    if (m[1]) dbTables.add(m[1].toLowerCase());
  }

  const lsRegex = /localStorage\.(?:getItem|setItem)\(\s*['"`]([a-zA-Z0-9_.:-]+)['"`]/g;
  for (const m of html.matchAll(lsRegex)) {
    if (m[1]) storageKeys.add(m[1]);
  }

  return {
    dbTables: Array.from(dbTables).slice(0, 12),
    storageKeys: Array.from(storageKeys).slice(0, 12),
  };
}

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function DrawerShell({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
}: DrawerShellProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[480px] max-h-[88dvh] bg-white rounded-t-3xl sm:rounded-3xl shadow-[0_-10px_40px_rgba(15,15,30,0.18)] sm:shadow-[0_24px_64px_rgba(15,15,30,0.22)] flex flex-col overflow-hidden pb-safe"
      >
        <div
          aria-hidden="true"
          className="w-10 h-1 rounded-full bg-black/15 mx-auto mt-2.5 sm:hidden shrink-0"
        />

        <div className="shrink-0 px-5 pt-3.5 pb-3 border-b border-black/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#F4F4F6] text-[#0B0B0F] flex items-center justify-center shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-[16px] tracking-[-0.02em] text-[#0B0B0F] leading-tight">
                {title}
              </h2>
              <p className="text-[12px] text-[#71717A] truncate mt-0.5">
                {subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="min-w-[44px] min-h-[44px] -mr-2 rounded-full flex items-center justify-center text-[#52525B] hover:bg-black/[0.04] active:scale-95 transition-all shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Per-Project Secrets / Environment Variables Modal                       */
/* -------------------------------------------------------------------------- */

interface ProjectSecretsModalProps {
  open: boolean;
  projectTitle: string;
  secrets: ProjectSecret[];
  onClose: () => void;
  onUpdateSecrets: (next: ProjectSecret[]) => void;
}

const SUGGESTED_SECRET_KEYS = [
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'RESEND_API_KEY',
  'WEBHOOK_SECRET',
];

export function ProjectSecretsModal({
  open,
  projectTitle,
  secrets,
  onClose,
  onUpdateSecrets,
}: ProjectSecretsModalProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showNewValue, setShowNewValue] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [showEditValue, setShowEditValue] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setFeedback(null);
    }
  }, [open]);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const handleAddSecret = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedKey = normalizeSecretKey(newKey);
    const cleanedValue = newValue.trim();
    if (!cleanedKey) {
      setFeedback('Enter a valid key name (e.g. OPENAI_API_KEY).');
      return;
    }
    if (!cleanedValue) {
      setFeedback('Paste the secret value before saving.');
      return;
    }

    const nowIso = new Date().toISOString();
    const existing = secrets.find((s) => s.key === cleanedKey);
    let next: ProjectSecret[];
    if (existing) {
      next = secrets.map((s) =>
        s.key === cleanedKey ? { ...s, value: cleanedValue, updatedAt: nowIso } : s
      );
      setFeedback(`Updated ${cleanedKey} for ${projectTitle}.`);
    } else {
      next = [
        {
          id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          key: cleanedKey,
          value: cleanedValue,
          updatedAt: nowIso,
        },
        ...secrets,
      ];
      setFeedback(`Saved ${cleanedKey} to ${projectTitle}.`);
    }
    onUpdateSecrets(next);
    setNewKey('');
    setNewValue('');
    setShowNewValue(false);
  };

  const startEditing = (secret: ProjectSecret) => {
    setEditingId(secret.id);
    setEditKey(secret.key);
    setEditValue(secret.value);
    setShowEditValue(false);
  };

  const handleSaveEdit = (id: string) => {
    const cleanedKey = normalizeSecretKey(editKey);
    const cleanedValue = editValue.trim();
    if (!cleanedKey || !cleanedValue) {
      setFeedback('Key and value cannot be empty.');
      return;
    }
    const next = secrets.map((s) =>
      s.id === id
        ? { ...s, key: cleanedKey, value: cleanedValue, updatedAt: new Date().toISOString() }
        : s
    );
    onUpdateSecrets(next);
    setEditingId(null);
    setFeedback(`Updated ${cleanedKey}.`);
  };

  const handleDelete = (id: string, keyName: string) => {
    onUpdateSecrets(secrets.filter((s) => s.id !== id));
    if (editingId === id) setEditingId(null);
    setFeedback(`Removed ${keyName}.`);
  };

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Secrets"
      subtitle={`Environment variables scoped to ${projectTitle}`}
      icon={<KeyRound className="w-[18px] h-[18px] text-[#6D4AFF]" />}
    >
      <div className="flex flex-col gap-5">
        <form onSubmit={handleAddSecret} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-[#52525B]">
              Add Environment Variable
            </label>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="KEY_NAME (e.g. OPENAI_API_KEY)"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full h-11 px-3.5 rounded-xl border border-black/[0.12] bg-[#FAFAFC] font-mono text-[13px] text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
            />
            <div className="relative flex items-center">
              <input
                type={showNewValue ? 'text' : 'password'}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Paste secret key or token..."
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-black/[0.12] bg-[#FAFAFC] font-mono text-[13px] text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
              />
              <button
                type="button"
                onClick={() => setShowNewValue((v) => !v)}
                aria-label={showNewValue ? 'Hide secret value' : 'Reveal secret value'}
                className="absolute right-1 min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-[#71717A] hover:text-[#0B0B0F]"
              >
                {showNewValue ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {SUGGESTED_SECRET_KEYS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setNewKey(sample)}
                className="px-2.5 py-1.5 rounded-lg bg-[#F4F4F6] hover:bg-[#EAEAEF] text-[11px] font-mono text-[#3F3F46] whitespace-nowrap shrink-0 transition-colors"
              >
                + {sample}
              </button>
            ))}
          </div>

          <button
            type="submit"
            className="w-full h-11 rounded-xl bg-[#0B0B0F] hover:bg-black/85 text-white text-[13.5px] font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Save Secret</span>
          </button>
        </form>

        {feedback && (
          <p
            role="status"
            className="px-3 py-2 rounded-xl bg-[#F3F0FF] text-[#5B21B6] text-[12.5px] font-medium"
          >
            {feedback}
          </p>
        )}

        <div className="border-t border-black/[0.06] pt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-[#0B0B0F]">
              Saved for {projectTitle}
            </span>
            <span className="text-[#71717A] tabular-nums">
              {secrets.length} {secrets.length === 1 ? 'key' : 'keys'}
            </span>
          </div>

          {secrets.length === 0 ? (
            <div className="py-5 px-4 rounded-2xl bg-[#FAFAFC] border border-black/[0.06] text-center">
              <p className="text-[13px] font-medium text-[#18181B]">
                No secrets added for this app yet
              </p>
              <p className="text-[12px] text-[#71717A] mt-1 leading-relaxed">
                Add API keys here whenever this app needs credentials. They are injected automatically at runtime via{' '}
                <code className="font-mono text-[#3F3F46]">window.AICraft.env</code>.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-black/[0.06] border border-black/[0.07] rounded-2xl overflow-hidden">
              {secrets.map((item) => {
                const isRevealed = Boolean(revealedIds[item.id]);
                const isEditing = editingId === item.id;

                return (
                  <li key={item.id} className="px-3.5 py-3 bg-white">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={editKey}
                          onChange={(e) => setEditKey(e.target.value)}
                          spellCheck={false}
                          className="w-full h-10 px-3 rounded-lg border border-black/[0.14] font-mono text-[12.5px] text-[#0B0B0F] focus:outline-none focus:border-[#6D4AFF]"
                        />
                        <div className="relative flex items-center">
                          <input
                            type={showEditValue ? 'text' : 'password'}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            spellCheck={false}
                            className="w-full h-10 pl-3 pr-10 rounded-lg border border-black/[0.14] font-mono text-[12.5px] text-[#0B0B0F] focus:outline-none focus:border-[#6D4AFF]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditValue((v) => !v)}
                            aria-label="Toggle edit secret visibility"
                            className="absolute right-1 min-w-[36px] min-h-[36px] flex items-center justify-center text-[#71717A]"
                          >
                            {showEditValue ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="h-9 px-3 rounded-lg border border-black/[0.1] text-xs font-medium text-[#52525B]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(item.id)}
                            className="h-9 px-3.5 rounded-lg bg-[#6D4AFF] text-white text-xs font-medium"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[12.5px] font-semibold text-[#0B0B0F] truncate">
                            {item.key}
                          </p>
                          <p className="font-mono text-[12px] text-[#71717A] truncate mt-0.5">
                            {isRevealed ? item.value : maskSecretValue(item.value)}
                          </p>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedIds((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            aria-label={isRevealed ? `Hide ${item.key}` : `Reveal ${item.key}`}
                            className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-[#52525B] hover:bg-black/[0.04]"
                          >
                            {isRevealed ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditing(item)}
                            aria-label={`Edit ${item.key}`}
                            className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-[#52525B] hover:bg-black/[0.04]"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id, item.key)}
                            aria-label={`Delete ${item.key}`}
                            className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="text-[11.5px] text-[#71717A] leading-relaxed">
            Automatically injected into this app&apos;s Preview runtime via{' '}
            <code className="font-mono text-[#3F3F46]">window.AICraft.getSecret(&quot;KEY&quot;)</code>,{' '}
            <code className="font-mono text-[#3F3F46]">window.ENV</code>, and{' '}
            <code className="font-mono text-[#3F3F46]">process.env</code>.
          </p>
        </div>
      </div>
    </DrawerShell>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Per-Project Database Configuration & Schema View                        */
/* -------------------------------------------------------------------------- */

interface ProjectDatabaseModalProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  latestPreviewHtml: string;
  databaseConfig: ProjectDatabaseConfig;
  onClose: () => void;
  onUpdateDatabase: (next: ProjectDatabaseConfig) => void;
  onApplySchemaWithAi: (promptText: string) => void;
}

export function ProjectDatabaseModal({
  open,
  projectId,
  projectTitle,
  latestPreviewHtml,
  databaseConfig,
  onClose,
  onUpdateDatabase,
  onApplySchemaWithAi,
}: ProjectDatabaseModalProps) {
  const [activeTab, setActiveTab] = useState<'schema' | 'data' | 'connection'>('schema');
  const [tableName, setTableName] = useState('');
  const [columnsInput, setColumnsInput] = useState('id, title, status, created_at');
  const [apiUrlInput, setApiUrlInput] = useState(databaseConfig.apiUrl || '');
  const [copiedSqlId, setCopiedSqlId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dataRefreshTick, setDataRefreshTick] = useState(0);

  useEffect(() => {
    setApiUrlInput(databaseConfig.apiUrl || '');
  }, [databaseConfig.apiUrl, open]);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const detected = useMemo(
    () => detectSchemaFromHtml(latestPreviewHtml),
    [latestPreviewHtml]
  );

  const liveStoredTables = useMemo(() => {
    if (!open) return [];
    const prefix = `aicraft_db_${projectId}_`;
    const items: Array<{ key: string; name: string; rows: unknown[] }> = [];
    try {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (key.startsWith(prefix)) {
          const raw = window.localStorage.getItem(key);
          const parsed = raw ? (JSON.parse(raw) as unknown) : [];
          items.push({
            key,
            name: key.slice(prefix.length),
            rows: Array.isArray(parsed) ? parsed : [parsed],
          });
        } else if (detected.storageKeys.includes(key)) {
          const raw = window.localStorage.getItem(key);
          let parsed: unknown = raw;
          try {
            parsed = raw ? JSON.parse(raw) : [];
          } catch {
            parsed = raw ? [raw] : [];
          }
          items.push({
            key,
            name: key,
            rows: Array.isArray(parsed) ? parsed : [parsed],
          });
        }
      }
    } catch {
      // ignore localStorage read failure
    }
    return items;
  }, [open, projectId, detected.storageKeys, dataRefreshTick]);

  const handleAddTable = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeTableName(tableName);
    if (!cleaned) {
      setFeedback('Enter a table name (e.g. users, orders, tasks).');
      return;
    }
    if (databaseConfig.tables.some((t) => t.name === cleaned)) {
      setFeedback(`Table "${cleaned}" already exists.`);
      return;
    }

    const columns: ProjectDatabaseColumn[] = columnsInput
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [rawCol, rawType] = part.split(':').map((s) => s.trim());
        const colName = sanitizeTableName(rawCol || '');
        const colType: ProjectDatabaseColumn['type'] =
          rawType === 'number' ||
          rawType === 'boolean' ||
          rawType === 'timestamp' ||
          rawType === 'json'
            ? rawType
            : colName === 'created_at' || colName === 'updated_at'
              ? 'timestamp'
              : colName === 'amount' || colName === 'price' || colName === 'count'
                ? 'number'
                : 'text';
        return { name: colName, type: colType, required: colName === 'id' };
      })
      .filter((c) => c.name.length > 0);

    const nextTable: ProjectDatabaseTable = {
      id: `tbl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleaned,
      columns:
        columns.length > 0
          ? columns
          : [
              { name: 'id', type: 'text', required: true },
              { name: 'created_at', type: 'timestamp' },
            ],
    };

    onUpdateDatabase({
      ...databaseConfig,
      enabled: true,
      tables: [...databaseConfig.tables, nextTable],
      updatedAt: new Date().toISOString(),
    });
    setTableName('');
    setFeedback(`Created table "${cleaned}".`);
  };

  const handleDeleteTable = (id: string) => {
    onUpdateDatabase({
      ...databaseConfig,
      tables: databaseConfig.tables.filter((t) => t.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const buildCreateSql = (table: ProjectDatabaseTable): string => {
    const colLines = table.columns.map((c) => {
      const sqlType =
        c.type === 'number'
          ? 'NUMERIC'
          : c.type === 'boolean'
            ? 'BOOLEAN DEFAULT false'
            : c.type === 'timestamp'
              ? 'TIMESTAMPTZ DEFAULT now()'
              : c.type === 'json'
                ? 'JSONB DEFAULT \'{}\'::jsonb'
                : c.name === 'id'
                  ? 'TEXT PRIMARY KEY'
                  : 'TEXT';
      return `  ${c.name} ${sqlType}`;
    });
    return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${colLines.join(',\n')}\n);`;
  };

  const handleCopySql = async (table: ProjectDatabaseTable) => {
    try {
      await navigator.clipboard.writeText(buildCreateSql(table));
      setCopiedSqlId(table.id);
      window.setTimeout(() => setCopiedSqlId(null), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleSaveConnection = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateDatabase({
      ...databaseConfig,
      apiUrl: apiUrlInput.trim(),
      updatedAt: new Date().toISOString(),
    });
    setFeedback('Database connection saved.');
  };

  const handleApplyToApp = () => {
    const tableList = databaseConfig.tables
      .map(
        (t) =>
          `${t.name} (${t.columns.map((c) => `${c.name}:${c.type}`).join(', ')})`
      )
      .join('; ');
    onClose();
    onApplySchemaWithAi(
      `Connect this app to persistent database storage using these tables: ${tableList}. Persist records using window.AICraft.db so data survives reloads.`
    );
  };

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Database"
      subtitle={`Schema & Storage · ${projectTitle}`}
      icon={<Database className="w-[18px] h-[18px] text-[#6D4AFF]" />}
    >
      <div className="flex flex-col gap-4">
        {/* Segmented Control Tabs */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F4F4F6]">
          {(
            [
              { id: 'schema', label: 'Schema' },
              { id: 'data', label: 'Live Data' },
              { id: 'connection', label: 'Settings' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[36px] rounded-lg text-[12.5px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white text-[#0B0B0F] shadow-sm'
                  : 'text-[#52525B] hover:text-[#0B0B0F]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {feedback && (
          <p
            role="status"
            className="px-3 py-2 rounded-xl bg-[#F3F0FF] text-[#5B21B6] text-[12.5px] font-medium"
          >
            {feedback}
          </p>
        )}

        {activeTab === 'schema' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between px-3.5 py-3 rounded-2xl bg-[#FAFAFC] border border-black/[0.06]">
              <div>
                <p className="text-[13.5px] font-semibold text-[#0B0B0F]">
                  App Data Persistence
                </p>
                <p className="text-[12px] text-[#71717A] mt-0.5">
                  {databaseConfig.providerLabel} ·{' '}
                  {databaseConfig.enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={databaseConfig.enabled}
                onClick={() =>
                  onUpdateDatabase({
                    ...databaseConfig,
                    enabled: !databaseConfig.enabled,
                    updatedAt: new Date().toISOString(),
                  })
                }
                className={`relative w-12 h-7 rounded-full transition-colors ${
                  databaseConfig.enabled ? 'bg-[#6D4AFF]' : 'bg-[#D4D4D8]'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    databaseConfig.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {detected.dbTables.length > 0 && (
              <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-[12px] text-emerald-900">
                <span className="font-semibold">Detected in app code:</span>{' '}
                <span className="font-mono">{detected.dbTables.join(', ')}</span>
              </div>
            )}

            <form onSubmit={handleAddTable} className="flex flex-col gap-2">
              <label className="text-[12px] font-medium text-[#52525B]">
                Add Table to Project Schema
              </label>
              <input
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="Table name (e.g. users, orders, bookings)"
                className="w-full h-11 px-3.5 rounded-xl border border-black/[0.12] bg-[#FAFAFC] font-mono text-[13px] text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
              />
              <input
                type="text"
                value={columnsInput}
                onChange={(e) => setColumnsInput(e.target.value)}
                placeholder="Columns: id, name:text, amount:number, created_at"
                className="w-full h-11 px-3.5 rounded-xl border border-black/[0.12] bg-[#FAFAFC] font-mono text-[12.5px] text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
              />
              <button
                type="submit"
                className="w-full h-11 rounded-xl bg-[#0B0B0F] hover:bg-black/85 text-white text-[13.5px] font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Create Table</span>
              </button>
            </form>

            <div className="border-t border-black/[0.06] pt-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-semibold text-[#0B0B0F]">Project Tables</span>
                <span className="text-[#71717A] tabular-nums">
                  {databaseConfig.tables.length}{' '}
                  {databaseConfig.tables.length === 1 ? 'table' : 'tables'}
                </span>
              </div>

              {databaseConfig.tables.length === 0 ? (
                <p className="text-[12.5px] text-[#71717A] py-3">
                  No custom schema tables defined yet. Create a table above to structure this app&apos;s data.
                </p>
              ) : (
                <ul className="divide-y divide-black/[0.06] border border-black/[0.07] rounded-2xl overflow-hidden">
                  {databaseConfig.tables.map((tbl) => (
                    <li key={tbl.id} className="px-3.5 py-3 bg-white flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-semibold text-[#0B0B0F]">
                          {tbl.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleCopySql(tbl)}
                            className="h-8 px-2.5 rounded-lg border border-black/[0.08] text-[11.5px] font-medium text-[#3F3F46] hover:bg-black/[0.03] flex items-center gap-1"
                          >
                            {copiedSqlId === tbl.id ? (
                              <>
                                <Check className="w-3 h-3 text-[#6D4AFF]" />
                                <span>SQL Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy SQL</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTable(tbl.id)}
                            aria-label={`Delete table ${tbl.name}`}
                            className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="font-mono text-[11.5px] text-[#71717A] leading-relaxed">
                        {tbl.columns.map((c) => `${c.name}: ${c.type}`).join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {databaseConfig.tables.length > 0 && (
                <button
                  type="button"
                  onClick={handleApplyToApp}
                  className="mt-1 w-full h-11 rounded-xl bg-[#6D4AFF] hover:bg-[#5B35F5] text-white text-[13.5px] font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
                >
                  <Database className="w-4 h-4" />
                  <span>Wire Schema Into App</span>
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="font-semibold text-[#0B0B0F]">
                Stored Records ({liveStoredTables.length})
              </span>
              <button
                type="button"
                onClick={() => setDataRefreshTick((n) => n + 1)}
                className="text-[12px] font-medium text-[#6D4AFF] hover:opacity-80"
              >
                Refresh
              </button>
            </div>

            {liveStoredTables.length === 0 ? (
              <div className="py-6 px-4 rounded-2xl bg-[#FAFAFC] border border-black/[0.06] text-center">
                <p className="text-[13px] font-medium text-[#18181B]">
                  No records stored yet
                </p>
                <p className="text-[12px] text-[#71717A] mt-1">
                  Records saved by your Preview app via{' '}
                  <code className="font-mono">window.AICraft.db</code> or{' '}
                  <code className="font-mono">localStorage</code> appear here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {liveStoredTables.map((store) => (
                  <div
                    key={store.key}
                    className="rounded-2xl border border-black/[0.08] bg-white overflow-hidden"
                  >
                    <div className="px-3.5 py-2.5 bg-[#FAFAFC] border-b border-black/[0.06] flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-[12.5px] font-semibold text-[#0B0B0F]">
                          {store.name}
                        </span>
                        <span className="ml-2 text-[11.5px] text-[#71717A] tabular-nums">
                          {store.rows.length} {store.rows.length === 1 ? 'row' : 'rows'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            window.localStorage.removeItem(store.key);
                            setDataRefreshTick((n) => n + 1);
                            setFeedback(`Cleared ${store.name}.`);
                          } catch {
                            // ignore storage failure
                          }
                        }}
                        className="text-[11.5px] font-medium text-red-600 hover:opacity-80"
                      >
                        Clear
                      </button>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-[#3F3F46] max-h-40 overflow-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(store.rows.slice(0, 15), null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'connection' && (
          <form onSubmit={handleSaveConnection} className="flex flex-col gap-3">
            <div className="px-3.5 py-3 rounded-2xl bg-[#FAFAFC] border border-black/[0.06] text-[12.5px] text-[#52525B] leading-relaxed">
              Your project automatically includes built-in local &amp; cloud persistence via{' '}
              <code className="font-mono text-[#0B0B0F]">window.AICraft.db</code>. Optionally attach a custom PostgreSQL / Supabase endpoint URL for this project below.
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#52525B] mb-1.5">
                Custom Database / API Endpoint (Optional)
              </label>
              <input
                type="url"
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                placeholder="https://your-project.supabase.co"
                className="w-full h-11 px-3.5 rounded-xl border border-black/[0.12] bg-[#FAFAFC] font-mono text-[12.5px] text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
              />
            </div>
            <button
              type="submit"
              className="w-full h-11 rounded-xl bg-[#0B0B0F] hover:bg-black/85 text-white text-[13.5px] font-medium"
            >
              Save Connection Settings
            </button>
          </form>
        )}
      </div>
    </DrawerShell>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Per-Project Deployment Panel                                            */
/* -------------------------------------------------------------------------- */

interface ProjectDeployModalProps {
  open: boolean;
  projectTitle: string;
  mode: BuildMode;
  hasBuiltApp: boolean;
  isPublished: boolean;
  latestPreviewHtml: string;
  secrets: ProjectSecret[];
  databaseConfig: ProjectDatabaseConfig;
  deployment: ProjectDeploymentConfig;
  onClose: () => void;
  onDeploy: (slug: string) => void;
  onOpenPreview: () => void;
  onOpenCode: () => void;
  onShare: () => Promise<string>;
}

export function ProjectDeployModal({
  open,
  projectTitle,
  mode,
  hasBuiltApp,
  isPublished,
  latestPreviewHtml,
  secrets,
  databaseConfig,
  deployment,
  onClose,
  onDeploy,
  onOpenPreview,
  onOpenCode,
  onShare,
}: ProjectDeployModalProps) {
  const [slugInput, setSlugInput] = useState(
    deployment.slug || slugifyProjectTitle(projectTitle)
  );
  const [includeSecretsInExport, setIncludeSecretsInExport] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  useEffect(() => {
    setSlugInput(deployment.slug || slugifyProjectTitle(projectTitle));
  }, [deployment.slug, projectTitle, open]);

  useEffect(() => {
    if (!statusNote) return;
    const t = window.setTimeout(() => setStatusNote(null), 2800);
    return () => window.clearTimeout(t);
  }, [statusNote]);

  const cleanedSlug = slugifyProjectTitle(slugInput);
  const codeKb = latestPreviewHtml
    ? `${(latestPreviewHtml.length / 1024).toFixed(1)} KB`
    : '0 KB';

  const handleDeployClick = () => {
    if (!hasBuiltApp) {
      setStatusNote('Build your app in chat first before deploying.');
      return;
    }
    onDeploy(cleanedSlug);
    setStatusNote(`Deployed ${projectTitle} (v${deployment.version + 1})`);
  };

  const handleDownloadHtml = () => {
    if (!latestPreviewHtml) return;
    let exportHtml = latestPreviewHtml;
    if (includeSecretsInExport && secrets.length > 0) {
      const envObj: Record<string, string> = {};
      for (const s of secrets) envObj[s.key] = s.value;
      const safeJson = JSON.stringify(envObj).replace(/</g, '\\u003c');
      const envScript = `<script>window.__AICRAFT_ENV__=${safeJson};window.ENV=Object.assign({},window.ENV||{},window.__AICRAFT_ENV__);</script>`;
      exportHtml = /<\/head>/i.test(exportHtml)
        ? exportHtml.replace(/<\/head>/i, `${envScript}</head>`)
        : `${envScript}${exportHtml}`;
    }
    const blob = new Blob([exportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${cleanedSlug}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusNote(`Downloaded ${cleanedSlug}.html`);
  };

  const handleShareClick = async () => {
    const msg = await onShare();
    setStatusNote(msg);
  };

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Deploy"
      subtitle={`Launch & Export · ${projectTitle}`}
      icon={<Rocket className="w-[18px] h-[18px] text-[#6D4AFF]" />}
    >
      <div className="flex flex-col gap-4">
        {/* Deployment Status Overview */}
        <div className="p-4 rounded-2xl bg-[#FAFAFC] border border-black/[0.07] flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[14px] font-semibold text-[#0B0B0F]">
                {isPublished ? 'Live Deployment Active' : hasBuiltApp ? 'Ready to Deploy' : 'Build Pending'}
              </p>
              <p className="text-[12px] text-[#71717A] mt-0.5 tabular-nums">
                {MODE_THEMES[mode].label} · {codeKb}
                {deployment.version > 0 ? ` · v${deployment.version}` : ''}
              </p>
            </div>
            <span
              className={`text-[12px] font-semibold ${
                isPublished ? 'text-emerald-700' : 'text-[#52525B]'
              }`}
            >
              {isPublished ? 'Published' : 'Draft'}
            </span>
          </div>

          <div className="pt-2.5 border-t border-black/[0.06] grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <span className="text-[#71717A] block">Project Secrets</span>
              <span className="font-semibold text-[#0B0B0F] tabular-nums">
                {secrets.length} configured
              </span>
            </div>
            <div>
              <span className="text-[#71717A] block">Database Tables</span>
              <span className="font-semibold text-[#0B0B0F] tabular-nums">
                {databaseConfig.tables.length} schema{' '}
                {databaseConfig.tables.length === 1 ? 'table' : 'tables'}
              </span>
            </div>
          </div>
        </div>

        {/* App Slug Input */}
        <div>
          <label className="block text-[12px] font-medium text-[#52525B] mb-1.5">
            App Slug
          </label>
          <input
            type="text"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder="my-app-slug"
            className="w-full h-11 px-3.5 rounded-xl border border-black/[0.12] bg-[#FAFAFC] font-mono text-[13px] text-[#0B0B0F] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
          />
          {deployment.deployedAt && (
            <p className="text-[11.5px] text-[#71717A] mt-1.5">
              Last deployed {new Date(deployment.deployedAt).toLocaleString()}
            </p>
          )}
        </div>

        {statusNote && (
          <p
            role="status"
            className="px-3 py-2 rounded-xl bg-[#F3F0FF] text-[#5B21B6] text-[12.5px] font-medium"
          >
            {statusNote}
          </p>
        )}

        {/* Primary Deploy CTA */}
        <button
          type="button"
          onClick={handleDeployClick}
          disabled={!hasBuiltApp}
          className="w-full h-11 rounded-xl bg-[#6D4AFF] hover:bg-[#5B35F5] disabled:bg-[#BEB5F9] text-white text-[14px] font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
        >
          <Rocket className="w-4 h-4" />
          <span>{isPublished ? 'Update Live Deployment' : 'Deploy App'}</span>
        </button>

        {/* Secondary Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!hasBuiltApp}
            onClick={() => {
              onClose();
              onOpenPreview();
            }}
            className="h-11 px-3 rounded-xl border border-black/[0.1] bg-white hover:bg-black/[0.03] disabled:opacity-45 text-[13px] font-medium text-[#0B0B0F] flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Open Preview</span>
          </button>

          <button
            type="button"
            disabled={!hasBuiltApp}
            onClick={() => {
              onClose();
              onOpenCode();
            }}
            className="h-11 px-3 rounded-xl border border-black/[0.1] bg-white hover:bg-black/[0.03] disabled:opacity-45 text-[13px] font-medium text-[#0B0B0F] flex items-center justify-center gap-1.5"
          >
            <Code2 className="w-4 h-4" />
            <span>View Code</span>
          </button>

          <button
            type="button"
            disabled={!hasBuiltApp}
            onClick={handleDownloadHtml}
            className="h-11 px-3 rounded-xl border border-black/[0.1] bg-white hover:bg-black/[0.03] disabled:opacity-45 text-[13px] font-medium text-[#0B0B0F] flex items-center justify-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Export HTML</span>
          </button>

          <button
            type="button"
            onClick={() => void handleShareClick()}
            className="h-11 px-3 rounded-xl border border-black/[0.1] bg-white hover:bg-black/[0.03] text-[13px] font-medium text-[#0B0B0F] flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-4 h-4" />
            <span>Share App</span>
          </button>
        </div>

        {hasBuiltApp && secrets.length > 0 && (
          <label className="flex items-center gap-2.5 text-[12px] text-[#52525B] cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={includeSecretsInExport}
              onChange={(e) => setIncludeSecretsInExport(e.target.checked)}
              className="w-4 h-4 rounded accent-[#6D4AFF]"
            />
            <span>Include saved project secrets inside exported HTML bundle</span>
          </label>
        )}
      </div>
    </DrawerShell>
  );
}
