import { useEffect, useState, useCallback } from 'react';
import { Bot, Users, Puzzle, AlertCircle, Loader2, Brain, Building2, X, ChevronRight, Check } from 'lucide-react';
import {
  fetchStaff,
  fetchSkillsRegistry,
  fetchModels,
  fetchCredentials,
  updateWorker,
  type Team,
  type AreaConfig,
  type SkillItem,
  type Worker,
  type ModelEntry,
  type CredentialEntry,
} from '../api/staffApi';



// ── Model badge ───────────────────────────────────────────────

function ModelBadge({ provider, name }: { provider: string | null; name: string | null }) {
  if (!provider || !name) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">未配置</span>;
  }
  const colors: Record<string, string> = {
    anthropic: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    minimax:   'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    openai:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  };
  const short = name.replace('claude-', '').replace('-20250514', '').replace('-20251001', '').replace('MiniMax-', '');
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[provider] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
      {short}
    </span>
  );
}

// ── Worker card ───────────────────────────────────────────────

function WorkerCard({ worker, onClick }: { worker: Worker; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {worker.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{worker.role}</div>
        </div>
        <div className="flex items-center gap-1 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 transition-colors">
          <Bot size={15} />
          <ChevronRight size={13} />
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{worker.description}</p>
      <div className="flex items-center justify-between">
        <ModelBadge provider={worker.model.provider} name={worker.model.name} />
        {worker.skill && <span className="text-xs text-gray-400 font-mono">{worker.skill}</span>}
      </div>
    </button>
  );
}

// ── Worker detail panel ───────────────────────────────────────

interface WorkerPanelProps {
  worker: Worker;
  skills: SkillItem[];
  models: ModelEntry[];
  onClose: () => void;
  onSaved: () => void;
}

// Skills 分组
const SKILL_GROUPS: Record<string, string[]> = {
  '开发': ['dev', 'review', 'code-review', 'plan', 'frontend-design', 'chrome', 'dashboard-debug', 'feature-map', 'canvas-project', 'repo-visualizer', 'headless-deploy'],
  '管理': ['okr', 'autumnrice', 'cecelia', 'cecelia-brain', 'credentials', 'versioning', 'nobel', 'repo-lead'],
  '内容': ['content-analyzer', 'content-creator', 'content-rewriter', 'batch-notion-analyzer', 'two-layer-parallel-analyzer', 'claude-work-summarizer', 'notebooklm', 'quote-card-generator', 'luxury-card-generator', 'batch-luxury-card-generator', 'image-gen-workflow'],
  '发布': ['douyin-publisher', 'toutiao-publisher'],
  '数据': ['platform-scraper', 'social-media-analysis', 'media-scraping'],
};

function groupSkills(skills: SkillItem[]) {
  const grouped: Record<string, SkillItem[]> = {};
  const used = new Set<string>();
  for (const [group, ids] of Object.entries(SKILL_GROUPS)) {
    const items = skills.filter(s => ids.includes(s.id));
    if (items.length > 0) {
      grouped[group] = items;
      items.forEach(s => used.add(s.id));
    }
  }
  const rest = skills.filter(s => !used.has(s.id));
  if (rest.length > 0) grouped['其他'] = rest;
  return grouped;
}

function WorkerPanel({ worker, skills, models, onClose, onSaved }: WorkerPanelProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState(worker.skill || '');
  const [modelName, setModelName] = useState(worker.model.name || '');
  const defaultCred = worker.model.credentials_file || worker.model.provider || 'anthropic';
  const [credAccount, setCredAccount] = useState(defaultCred);
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);

  useEffect(() => {
    fetchCredentials().then(setCredentials);
  }, []);

  const providerFromAccount = credentials.find(c => c.name === credAccount)?.provider || 'anthropic';
  const modelsForProvider = models.filter(m => m.provider === providerFromAccount);
  const skillGroups = groupSkills(skills);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const provider = providerFromAccount;
      await updateWorker(worker.id, {
        skill: skill || null,
        model: modelName ? { provider, name: modelName } : null,
        credentials_file: credAccount || null,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-screen w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{worker.name}</div>
              <div className="text-xs text-gray-500">{worker.role}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">

          <p className="text-xs text-gray-500 dark:text-gray-400">{worker.description}</p>

          {/* 账户选择 */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">账户</label>
            <select
              value={credAccount}
              onChange={e => { setCredAccount(e.target.value); setModelName(''); }}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {credentials.length === 0 && (
                <option value={credAccount}>{credAccount}</option>
              )}
              {credentials.map(cred => (
                <option key={cred.name} value={cred.name}>
                  {cred.name}  ({cred.path})
                </option>
              ))}
            </select>
            {credentials.length > 0 && (
              <div className="mt-0.5 text-[11px] text-gray-400">
                Provider: <span className="font-mono">{providerFromAccount}</span>
              </div>
            )}
          </div>

          {/* 模型选择 */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">模型</label>
            <select
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- 不绑定 --</option>
              {modelsForProvider.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </div>

          {/* Skill — 分组 */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Skill</label>
            <select
              value={skill}
              onChange={e => setSkill(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- 不绑定 --</option>
              {Object.entries(skillGroups).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map(s => (
                    <option key={s.id} value={`/${s.id}`}>
                      /{s.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Abilities */}
          {worker.abilities && worker.abilities.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">
                Abilities ({worker.abilities.length})
              </div>
              <div className="space-y-1">
                {worker.abilities.map(ab => (
                  <div key={ab.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{ab.name}</div>
                    {ab.description && <div className="text-[11px] text-gray-500 mt-0.5">{ab.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        {/* Footer — 固定底部 */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={save}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Skill card ────────────────────────────────────────────────

function SkillCard({ item }: { item: SkillItem }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
          <Puzzle size={13} className="text-blue-400" />
          {item.name || item.id}
        </div>
        <span className="text-xs text-gray-400 font-mono">v{item.version}</span>
      </div>
      {item.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{item.description}</p>
      )}
      <div className="mt-3 text-xs font-mono text-gray-400">{item.id}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function TeamPage() {
  const [teams, setTeams]               = useState<Team[]>([]);
  const [areas, setAreas]               = useState<Record<string, AreaConfig>>({});
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [skills, setSkills]             = useState<SkillItem[]>([]);
  const [models, setModels]             = useState<ModelEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [selected, setSelected]         = useState<Worker | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchStaff(), fetchSkillsRegistry(), fetchModels()])
      .then(([staff, registry, modelList]) => {
        setTeams(staff.teams);
        setAreas(staff.areas || {});
        setTotalWorkers(staff.total_workers);
        setSkills(registry.skills);
        setModels(modelList);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = () => {
    setSelected(null);
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-gray-400" size={32} />
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-500 p-8">
      <AlertCircle size={20} /><span>{error}</span>
    </div>
  );

  const areaIds = Object.keys(areas).length > 0
    ? Object.keys(areas)
    : [...new Set(teams.map(t => t.area).filter(Boolean) as string[])];

  const groupByDept = (areaId: string) => {
    const areaTeams = teams.filter(t => t.area === areaId);
    const map: Record<string, Team[]> = {};
    for (const t of areaTeams) {
      const dept = t.department || t.name;
      if (!map[dept]) map[dept] = [];
      map[dept].push(t);
    }
    return map;
  };

  const areaIcon = (id: string) =>
    id === 'cecelia'
      ? <Brain size={18} className="text-purple-500" />
      : <Building2 size={18} className="text-blue-500" />;

  return (
    <div className="p-6 space-y-10">

      {/* ── Team ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <Users size={22} className="text-gray-500" />
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Team</h2>
            <p className="text-xs text-gray-500">{totalWorkers} workers · 点击卡片查看/编辑</p>
          </div>
        </div>

        <div className="space-y-8">
          {areaIds.map(areaId => {
            const area = areas[areaId];
            const deptMap = groupByDept(areaId);
            if (!Object.keys(deptMap).length) return null;
            return (
              <div key={areaId}>
                <div className="flex items-center gap-2 mb-4">
                  {areaIcon(areaId)}
                  <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                    {area?.name || areaId}
                  </h3>
                  {area?.description && (
                    <span className="text-xs text-gray-400">{area.description}</span>
                  )}
                </div>
                <div className="pl-4 space-y-6 border-l-2 border-gray-100 dark:border-gray-800">
                  {Object.entries(deptMap).map(([dept, deptTeams]) => {
                    const workers = deptTeams.flatMap(t => t.workers);
                    return (
                      <div key={dept}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{dept}</span>
                          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">
                            {workers.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {workers.map(w => (
                            <WorkerCard key={w.id} worker={w} onClick={() => setSelected(w)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Skills ──────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <Puzzle size={22} className="text-gray-500" />
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Skills</h2>
            <p className="text-xs text-gray-500">{skills.length} registered</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {skills.map(item => <SkillCard key={item.id} item={item} />)}
        </div>
      </section>

      {/* ── Detail panel ──────────────────────────────── */}
      {selected && (
        <WorkerPanel
          worker={selected}
          skills={skills}
          models={models}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
