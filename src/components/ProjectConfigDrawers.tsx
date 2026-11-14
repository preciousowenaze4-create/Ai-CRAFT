import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  Plus,
  RefreshCw,
  Rocket,
  Save,
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

function sanitizeTableName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeColumnType(
  rawType: string | undefined,
  colName: string
): ProjectDatabaseColumn['type'] {
  const t = (rawType || '').trim().toLowerCase();
  if (
    t === 'number' ||
    t === 'numeric' ||
    t === 'int' ||
    t === 'integer' ||
    t === 'float' ||
    t === 'decimal' ||
    t === 'bigint'
  ) {
    return 'number';
  }
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (
    t === 'timestamp' ||
    t === 'timestamptz' ||
    t === 'datetime' ||
    t === 'date'
  ) {
    return 'timestamp';
  }
  if (t === 'json' || t === 'jsonb' || t === 'array' || t === 'object') {
    return 'json';
  }
  if (t === 'text' || t === 'string' || t === 'varchar' || t === 'uuid') {
    return 'text';
  }
  if (
    colName === 'created_at' ||
    colName === 'updated_at' ||
    colName.endsWith('_at')
  ) {
    return 'timestamp';
  }
  if (
    colName === 'count' ||
    colName === 'amount' ||
    colName === 'price' ||
    colName === 'likes' ||
    colName === 'views' ||
    colName.endsWith('_count')
  ) {
    return 'number';
  }
  if (colName.startsWith('is_') || colName.startsWith('has_')) {
    return 'boolean';
  }
  return 'text';
}

function inferColumnTypeFromValue(
  val: unknown,
  colName: string
): ProjectDatabaseColumn['type'] {
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (val !== null && typeof val === 'object') return 'json';
  return normalizeColumnType(undefined, colName);
}

function detectSchemaFromHtml(html: string): {
  tables: ProjectDatabaseTable[];
  storageKeys: string[];
} {
  if (!html) return { tables: [], storageKeys: [] };

  const tableMap = new Map<string, Map<string, ProjectDatabaseColumn>>();
  const ensureTable = (rawName: string) => {
    const clean = sanitizeTableName(rawName);
    if (!clean) return null;
    let colMap = tableMap.get(clean);
    if (!colMap) {
      colMap = new Map<string, ProjectDatabaseColumn>();
      tableMap.set(clean, colMap);
    }
    return colMap;
  };
  const addColumn = (
    colMap: Map<string, ProjectDatabaseColumn>,
    rawCol: string,
    rawType?: string
  ) => {
    const cleanCol = sanitizeTableName(rawCol);
    if (!cleanCol) return;
    if (!colMap.has(cleanCol)) {
      colMap.set(cleanCol, {
        name: cleanCol,
        type: normalizeColumnType(rawType, cleanCol),
        required: cleanCol === 'id',
      });
    }
  };

  // 1. Detect window.AICraft.db.<op>('table', { field1: ..., field2: ... })
  const dbCallRegex =
    /AICraft\.db\.\w+\(\s*['"`]([a-zA-Z0-9_-]+)['"`](?:\s*,\s*(?:['"`][^'"`]*['"`]\s*,\s*)?\{([\s\S]{0,400}?)\})?/g;
  for (const m of html.matchAll(dbCallRegex)) {
    const colMap = ensureTable(m[1] || '');
    if (!colMap) continue;
    addColumn(colMap, 'id', 'text');
    const objBody = m[2];
    if (objBody) {
      const propRegex = /(?:^|[,{])\s*['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?\s*:/g;
      for (const p of objBody.matchAll(propRegex)) {
        if (p[1]) addColumn(colMap, p[1]);
      }
    }
    addColumn(colMap, 'created_at', 'timestamp');
  }

  // 2. Detect SQL CREATE TABLE definitions
  const sqlRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]{1,800}?)\)/gi;
  for (const m of html.matchAll(sqlRegex)) {
    const colMap = ensureTable(m[1] || '');
    if (!colMap) continue;
    const colLines = (m[2] || '').split(',');
    for (const line of colLines) {
      const trimmed = line.trim();
      if (!trimmed || /^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(trimmed)) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      if (parts[0]) {
        addColumn(colMap, parts[0].replace(/["`]/g, ''), parts[1]);
      }
    }
  }

  // 3. Detect app-specific localStorage keys
  const storageKeys = new Set<string>();
  const lsRegex =
    /localStorage\.(?:getItem|setItem)\(\s*['"`]([a-zA-Z0-9_.:-]+)['"`]/g;
  for (const m of html.matchAll(lsRegex)) {
    if (m[1]) storageKeys.add(m[1]);
  }

  const tables: ProjectDatabaseTable[] = Array.from(tableMap.entries())
    .slice(0, 12)
    .map(([name, colMap]) => ({
      id: `detected-${name}`,
      name,
      columns: Array.from(colMap.values()),
    }));

  return {
    tables,
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

interface SecretDraftRow {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

interface ProjectSecretsModalProps {
  open: boolean;
  projectTitle: string;
  secrets: ProjectSecret[];
  onClose: () => void;
  onUpdateSecrets: (next: ProjectSecret[]) => void;
}

function makeBlankSecretRow(): SecretDraftRow {
  return {
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    key: '',
    value: '',
    updatedAt: new Date().toISOString(),
  };
}

export function ProjectSecretsModal({
  open,
  projectTitle,
  secrets,
  onClose,
  onUpdateSecrets,
}: ProjectSecretsModalProps) {
  const [rows, setRows] = useState<SecretDraftRow[]>([]);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showShareInfo, setShowShareInfo] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setShowShareInfo(false);
      setFeedback(null);
      setErrorMsg(null);
      setCopiedId(null);
      return;
    }
    setRows(
      secrets.length > 0
        ? secrets.map((s) => ({
            id: s.id,
            key: s.key,
            value: s.value,
            updatedAt: s.updatedAt,
          }))
        : [makeBlankSecretRow()]
    );
    setRevealedIds({});
    setFeedback(null);
    setErrorMsg(null);
  }, [open, secrets]);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const handleRowChange = (id: string, field: 'key' | 'value', nextVal: string) => {
    setErrorMsg(null);
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: nextVal,
              updatedAt: new Date().toISOString(),
            }
          : row
      )
    );
  };

  const handleAddBlankRow = () => {
    setErrorMsg(null);
    setRows((prev) => [...prev, makeBlankSecretRow()]);
  };

  const handleDeleteRow = (id: string) => {
    setErrorMsg(null);
    setRows((prev) => {
      const remaining = prev.filter((r) => r.id !== id);
      return remaining.length > 0 ? remaining : [makeBlankSecretRow()];
    });
  };

  const handleCopyValue = async (row: SecretDraftRow) => {
    if (!row.value) return;
    try {
      await navigator.clipboard.writeText(row.value);
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId((curr) => (curr === row.id ? null : curr)), 1600);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleApplyChanges = () => {
    setErrorMsg(null);
    const cleanedRows: ProjectSecret[] = [];
    const seenKeys = new Set<string>();

    for (const row of rows) {
      const rawKey = row.key.trim();
      const rawValue = row.value.trim();
      if (!rawKey && !rawValue) {
        continue;
      }
      const normalizedKey = normalizeSecretKey(rawKey);
      if (!normalizedKey) {
        setErrorMsg('Enter a valid secret name (e.g. OPENAI_API_KEY) for every filled row.');
        return;
      }
      if (!rawValue) {
        setErrorMsg(`Enter a secret value for ${normalizedKey}.`);
        return;
      }
      const nextSecret: ProjectSecret = {
        id: row.id,
        key: normalizedKey,
        value: rawValue,
        updatedAt: new Date().toISOString(),
      };
      if (seenKeys.has(normalizedKey)) {
        const idx = cleanedRows.findIndex((s) => s.key === normalizedKey);
        if (idx !== -1) cleanedRows[idx] = nextSecret;
      } else {
        seenKeys.add(normalizedKey);
        cleanedRows.push(nextSecret);
      }
    }

    onUpdateSecrets(cleanedRows);
    setRows(cleanedRows.length > 0 ? cleanedRows : [makeBlankSecretRow()]);
    setFeedback(
      cleanedRows.length === 0
        ? `Cleared all secrets for ${projectTitle}.`
        : `Applied ${cleanedRows.length} ${cleanedRows.length === 1 ? 'secret' : 'secrets'} to ${projectTitle}.`
    );
  };

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Secrets"
      subtitle={`Environment variables scoped to ${projectTitle}`}
      icon={<KeyRound className="w-[18px] h-[18px] text-[#6D4AFF]" />}
    >
      <div className="flex flex-col gap-3.5">
        {/* Inline Editable Secrets Rows */}
        <div className="rounded-2xl border border-black/[0.09] bg-white overflow-hidden divide-y divide-black/[0.07]">
          {rows.map((row) => {
            const isRevealed = Boolean(revealedIds[row.id]);
            const isCopied = copiedId === row.id;
            return (
              <div
                key={row.id}
                className="px-2.5 py-2.5 flex items-center gap-1.5 bg-white"
              >
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => handleRowChange(row.id, 'key', e.target.value)}
                  placeholder="Secret name"
                  aria-label="Secret name"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-[34%] min-w-[92px] h-10 px-2.5 rounded-xl border border-black/[0.11] bg-[#FAFAFC] font-mono text-[12px] font-medium text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
                />

                <input
                  type={isRevealed ? 'text' : 'password'}
                  value={row.value}
                  onChange={(e) => handleRowChange(row.id, 'value', e.target.value)}
                  placeholder="Secret value"
                  aria-label="Secret value"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-black/[0.11] bg-[#FAFAFC] font-mono text-[12px] text-[#0B0B0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#6D4AFF] focus:bg-white"
                />

                <button
                  type="button"
                  onClick={() =>
                    setRevealedIds((prev) => ({
                      ...prev,
                      [row.id]: !prev[row.id],
                    }))
                  }
                  aria-label={isRevealed ? 'Hide secret value' : 'Reveal secret value'}
                  className="w-8 h-9 rounded-lg flex items-center justify-center text-[#52525B] hover:bg-black/[0.04] hover:text-[#0B0B0F] shrink-0 transition-colors"
                >
                  {isRevealed ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyValue(row)}
                  disabled={!row.value}
                  aria-label="Copy secret value"
                  className="w-8 h-9 rounded-lg flex items-center justify-center text-[#52525B] hover:bg-black/[0.04] hover:text-[#0B0B0F] disabled:opacity-35 shrink-0 transition-colors"
                >
                  {isCopied ? (
                    <Check className="w-4 h-4 text-[#6D4AFF]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteRow(row.id)}
                  aria-label="Remove secret row"
                  className="w-8 h-9 rounded-lg flex items-center justify-center text-[#71717A] hover:bg-red-50 hover:text-red-600 shrink-0 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {/* + Add secret button on left */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleAddBlankRow}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-black/[0.11] bg-white hover:bg-[#F7F7FA] text-[13px] font-medium text-[#0B0B0F] active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4 text-[#6D4AFF]" />
            <span>Add secret</span>
          </button>

          <span className="text-[12px] text-[#71717A] tabular-nums">
            {rows.filter((r) => r.key.trim() || r.value.trim()).length} configured
          </span>
        </div>

        {errorMsg && (
          <p
            role="alert"
            className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[12.5px] font-medium"
          >
            {errorMsg}
          </p>
        )}

        {feedback && (
          <p
            role="status"
            className="px-3 py-2 rounded-xl bg-[#F3F0FF] text-[#5B21B6] text-[12.5px] font-medium"
          >
            {feedback}
          </p>
        )}

        <div className="border-t border-black/[0.06]" />

        {/* Info Banner matching reference */}
        <div className="rounded-2xl border border-black/[0.09] bg-[#FAFAFC] px-3.5 py-3 flex flex-col gap-2">
          <div className="flex items-start gap-2.5">
            <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[12.5px] leading-snug text-[#18181B]">
              How are secrets handled when sharing?{' '}
              <button
                type="button"
                onClick={() => setShowShareInfo((v) => !v)}
                className="font-semibold text-[#6D4AFF] hover:underline"
              >
                {showShareInfo ? 'Hide details' : 'Learn more'}
              </button>
            </p>
          </div>
          {showShareInfo && (
            <p className="pl-6 text-[12px] leading-relaxed text-[#52525B]">
              Secrets stay isolated to <span className="font-medium text-[#0B0B0F]">{projectTitle}</span> and
              are injected automatically at runtime via{' '}
              <code className="font-mono text-[#3F3F46]">window.AICraft.getSecret(&quot;KEY&quot;)</code>,{' '}
              <code className="font-mono text-[#3F3F46]">window.ENV</code>, and{' '}
              <code className="font-mono text-[#3F3F46]">process.env</code>. Public share links never expose your raw secret values.
            </p>
          )}
        </div>

        {/* Apply changes primary brand button */}
        <button
          type="button"
          onClick={handleApplyChanges}
          className="w-full h-11 rounded-xl bg-[#6D4AFF] hover:bg-[#5B35F5] text-white text-[13.5px] font-semibold flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(109,74,255,0.26)] active:scale-[0.99] transition-all"
        >
          <Save className="w-4 h-4" />
          <span>Apply changes</span>
        </button>
      </div>
    </DrawerShell>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Per-Project Automatic Real-Time Structured Database Explorer            */
/* -------------------------------------------------------------------------- */

interface ProjectDatabaseModalProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  hasBuiltApp: boolean;
  isStreaming: boolean;
  latestPreviewHtml: string;
  databaseConfig: ProjectDatabaseConfig;
  onClose: () => void;
}

export function ProjectDatabaseModal({
  open,
  projectId,
  projectTitle,
  hasBuiltApp,
  isStreaming,
  latestPreviewHtml,
  databaseConfig,
  onClose,
}: ProjectDatabaseModalProps) {
  const [copiedSqlId, setCopiedSqlId] = useState<string | null>(null);
  const [collapsedTables, setCollapsedTables] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dataRefreshTick, setDataRefreshTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDataRefreshTick((n) => n + 1);
    const handleDbUpdate = (evt: Event) => {
      const detail = (evt as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === projectId) {
        setDataRefreshTick((n) => n + 1);
      }
    };
    window.addEventListener('aicraft:db-updated', handleDbUpdate);
    return () => window.removeEventListener('aicraft:db-updated', handleDbUpdate);
  }, [open, projectId]);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2400);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const detected = useMemo(
    () => detectSchemaFromHtml(latestPreviewHtml),
    [latestPreviewHtml]
  );

  const liveStoredMap = useMemo(() => {
    const map = new Map<string, { storageKey: string; rows: Record<string, unknown>[] }>();
    if (!open) return map;
    const prefix = `aicraft_db_${projectId}_`;

    try {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;

        let tableName = '';
        if (key.startsWith(prefix)) {
          tableName = sanitizeTableName(key.slice(prefix.length));
        } else if (detected.storageKeys.includes(key)) {
          tableName = sanitizeTableName(key);
        } else {
          continue;
        }

        if (!tableName) continue;
        const raw = window.localStorage.getItem(key);
        let parsed: unknown = [];
        try {
          parsed = raw ? JSON.parse(raw) : [];
        } catch {
          parsed = raw ? [{ value: raw }] : [];
        }
        const rawArray = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object'
            ? [parsed]
            : [];
        const normalizedRows = rawArray.map((item, idx) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : { id: `row_${idx + 1}`, value: item }
        );
        map.set(tableName, { storageKey: key, rows: normalizedRows });
      }
    } catch {
      // ignore localStorage read failure
    }
    return map;
  }, [open, projectId, detected.storageKeys, dataRefreshTick]);

  const structuredTables = useMemo(() => {
    const merged = new Map<string, ProjectDatabaseTable>();

    const upsertTable = (table: ProjectDatabaseTable) => {
      const cleanName = sanitizeTableName(table.name);
      if (!cleanName) return;
      const existing = merged.get(cleanName);
      if (!existing) {
        merged.set(cleanName, {
          ...table,
          name: cleanName,
          columns: [...table.columns],
        });
        return;
      }
      const colNames = new Set(existing.columns.map((c) => c.name));
      for (const col of table.columns) {
        if (!colNames.has(col.name)) {
          colNames.add(col.name);
          existing.columns.push(col);
        }
      }
    };

    for (const tbl of databaseConfig.tables) {
      upsertTable(tbl);
    }
    for (const tbl of detected.tables) {
      upsertTable(tbl);
    }
    for (const [tableName, store] of liveStoredMap.entries()) {
      const inferredCols: ProjectDatabaseColumn[] = [];
      const seenCols = new Set<string>();
      for (const row of store.rows.slice(0, 10)) {
        for (const [k, v] of Object.entries(row)) {
          const cleanCol = sanitizeTableName(k);
          if (!cleanCol || seenCols.has(cleanCol)) continue;
          seenCols.add(cleanCol);
          inferredCols.push({
            name: cleanCol,
            type: inferColumnTypeFromValue(v, cleanCol),
            required: cleanCol === 'id',
          });
        }
      }
      upsertTable({
        id: `live-${tableName}`,
        name: tableName,
        columns:
          inferredCols.length > 0
            ? inferredCols
            : [
                { name: 'id', type: 'text', required: true },
                { name: 'created_at', type: 'timestamp' },
              ],
      });
    }

    return Array.from(merged.values());
  }, [databaseConfig.tables, detected.tables, liveStoredMap]);

  const totalLiveRows = useMemo(() => {
    let count = 0;
    for (const store of liveStoredMap.values()) {
      count += store.rows.length;
    }
    return count;
  }, [liveStoredMap]);

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

  const handleClearTableRows = (tableName: string, storageKey: string) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([]));
      setDataRefreshTick((n) => n + 1);
      window.dispatchEvent(
        new CustomEvent('aicraft:db-updated', { detail: { projectId, table: tableName } })
      );
      setFeedback(`Cleared records in "${tableName}".`);
    } catch {
      // ignore storage error
    }
  };

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Database"
      subtitle={`Real-time structured storage · ${projectTitle}`}
      icon={<Database className="w-[18px] h-[18px] text-[#6D4AFF]" />}
    >
      <div className="flex flex-col gap-3.5">
        {feedback && (
          <p
            role="status"
            className="px-3 py-2 rounded-xl bg-[#F3F0FF] text-[#5B21B6] text-[12.5px] font-medium"
          >
            {feedback}
          </p>
        )}

        {structuredTables.length === 0 ? (
          <div className="py-8 px-5 rounded-2xl bg-[#FAFAFC] border border-black/[0.06] text-center flex flex-col items-center gap-2.5">
            <div className="w-11 h-11 rounded-2xl bg-[#F3F0FF] text-[#6D4AFF] flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <p className="text-[14px] font-semibold text-[#0B0B0F]">
              {isStreaming
                ? 'Listening for database tables...'
                : 'No database built yet'}
            </p>
            <p className="text-[12.5px] text-[#71717A] leading-relaxed max-w-[320px]">
              {isStreaming
                ? 'As AI Craft designs your app, structured tables and live records will appear here automatically in real time.'
                : hasBuiltApp
                  ? 'This app does not store structured tables yet. Ask the AI to add persistent data (like profiles, posts, orders, or saved items) and it will structure tables here automatically.'
                  : 'Ask AI Craft to build an app first. Any database tables created for your app will structure and update here automatically in real time.'}
            </p>
          </div>
        ) : (
          <>
            {/* Live Summary Bar */}
            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-[#FAFAFC] border border-black/[0.06]">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isStreaming ? 'bg-[#6D4AFF] animate-pulse' : 'bg-emerald-500'
                  }`}
                />
                <span className="text-[12.5px] font-semibold text-[#0B0B0F] tabular-nums truncate">
                  {structuredTables.length}{' '}
                  {structuredTables.length === 1 ? 'table' : 'tables'} ·{' '}
                  {totalLiveRows} {totalLiveRows === 1 ? 'record' : 'records'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setDataRefreshTick((n) => n + 1)}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-black/[0.08] bg-white hover:bg-black/[0.03] text-[12px] font-medium text-[#3F3F46] active:scale-95 transition-all shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#6D4AFF]" />
                <span>Refresh</span>
              </button>
            </div>

            {/* Structured Database Tables */}
            <div className="flex flex-col gap-3">
              {structuredTables.map((table) => {
                const store = liveStoredMap.get(table.name);
                const rows = store?.rows ?? [];
                const isCollapsed = Boolean(collapsedTables[table.name]);

                return (
                  <div
                    key={table.id}
                    className="rounded-2xl border border-black/[0.08] bg-white overflow-hidden"
                  >
                    <div className="px-3.5 py-2.5 bg-[#FAFAFC] border-b border-black/[0.06] flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedTables((prev) => ({
                            ...prev,
                            [table.name]: !prev[table.name],
                          }))
                        }
                        className="flex items-center gap-2 min-w-0 text-left flex-1"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-[#71717A] shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#71717A] shrink-0" />
                        )}
                        <span className="font-mono text-[13px] font-semibold text-[#0B0B0F] truncate">
                          {table.name}
                        </span>
                        <span className="text-[11.5px] text-[#71717A] tabular-nums whitespace-nowrap">
                          {table.columns.length} cols · {rows.length}{' '}
                          {rows.length === 1 ? 'row' : 'rows'}
                        </span>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleCopySql(table)}
                          className="h-7 px-2 rounded-lg border border-black/[0.08] bg-white text-[11px] font-medium text-[#3F3F46] hover:bg-black/[0.03] flex items-center gap-1"
                        >
                          {copiedSqlId === table.id ? (
                            <>
                              <Check className="w-3 h-3 text-[#6D4AFF]" />
                              <span>SQL</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>SQL</span>
                            </>
                          )}
                        </button>

                        {rows.length > 0 && store && (
                          <button
                            type="button"
                            onClick={() =>
                              handleClearTableRows(table.name, store.storageKey)
                            }
                            aria-label={`Clear ${table.name} records`}
                            className="h-7 px-2 rounded-lg text-[11px] font-medium text-red-600 hover:bg-red-50"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="flex flex-col divide-y divide-black/[0.06]">
                        {/* Columns Structure */}
                        <div className="p-3 bg-white">
                          <div className="flex flex-wrap gap-1.5">
                            {table.columns.map((col) => (
                              <div
                                key={`${table.name}-${col.name}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F7F7FA] border border-black/[0.06]"
                              >
                                <span className="font-mono text-[11.5px] font-medium text-[#0B0B0F]">
                                  {col.name}
                                </span>
                                <span className="text-[10.5px] font-mono text-[#6D4AFF]">
                                  {col.type}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Live Records Preview */}
                        {rows.length > 0 ? (
                          <div className="max-h-44 overflow-auto bg-white">
                            <table className="w-full text-left border-collapse text-[11.5px] font-mono">
                              <thead className="bg-[#FAFAFC] text-[#52525B] sticky top-0 border-b border-black/[0.06]">
                                <tr>
                                  {table.columns.slice(0, 5).map((col) => (
                                    <th
                                      key={col.name}
                                      className="px-3 py-1.5 font-semibold whitespace-nowrap"
                                    >
                                      {col.name}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-black/[0.05] text-[#18181B]">
                                {rows.slice(0, 12).map((row, idx) => (
                                  <tr key={String(row.id ?? idx)}>
                                    {table.columns.slice(0, 5).map((col) => {
                                      const rawCell = row[col.name];
                                      const cellStr =
                                        rawCell === null || rawCell === undefined
                                          ? '—'
                                          : typeof rawCell === 'object'
                                            ? JSON.stringify(rawCell)
                                            : String(rawCell);
                                      return (
                                        <td
                                          key={col.name}
                                          className="px-3 py-1.5 max-w-[140px] truncate"
                                          title={cellStr}
                                        >
                                          {cellStr}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="px-3.5 py-2.5 text-[11.5px] text-[#71717A]">
                            Table ready — live records saved by this app in Preview appear here automatically.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
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
