import { useEffect, useState, useCallback } from 'react';
import { Bot, AlertCircle, Loader2, Brain, Building2, Users, X, ChevronRight, Check } from 'lucide-react';
import {
  fetchStaff,
  fetchModels,
  fetchCredentials,
  updateWorker,
  type Team,
  type AreaConfig,
  type Worker,
  type ModelEntry,
  type CredentialEntry,
} from '../api/staffApi';
import BrainLayerConfig from '../components/BrainLayerConfig';


// ── Model badge ───────────────────────────────────────────────

function ModelBadge({ provider, name }: { provider: string | null; name: string | null }) {
  if (!provider || !name) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">未配置</span>;
  }
  const colors: Record<string, string> = {
    anthropic: 'bg-orange-900/40 text-orange-400',
    minimax:   'bg-blue-900/40 text-blue-400',
    openai:    'bg-green-900/40 text-green-400',
  };
  const short = name.replace('claude-', '').replace('-20250514', '').replace('-20251001', '').replace('MiniMax-', '');
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[provider] || 'bg-slate-700 text-slate-400'}`}>
      {short}
    </span>
  );
}

// ── Worker card ───────────────────────────────────────────────

function WorkerCard({ worker, onClick }: { worker: Worker; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-700 bg-slate-800 p-4 hover:border-blue-500/50 hover:bg-slate-700/50 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-semibold text-slate-100 group-hover:text-blue-300 transition-colors">
            {worker.name}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{worker.role}</div>
        </div>
        <div className="flex items-center gap-1 text-slate-600 group-hover:text-blue-400 transition-colors">
          <Bot size={15} />
          <ChevronRight size={13} />
        </div>
      </div>
      <p className="text-sm text-slate-400 mb-3 line-clamp-2">{worker.description}</p>
      <div className="flex items-center justify-between">
        <ModelBadge provider={worker.model.provider} name={worker.model.name} />
        {worker.skill && <span className="text-xs text-slate-500 font-mono">{worker.skill}</span>}
      </div>
    </button>
  );
}

// ── Worker detail panel ───────────────────────────────────────

interface WorkerPanelProps {
  worker: Worker;
  models: ModelEntry[];
  onClose: () => void;
}

function WorkerPanel({ worker, models, onClose }: WorkerPanelProps) {
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelName, setModelName] = useState(worker.model.name || '');
  const [credAccount, setCredAccount] = useState(
    worker.model.credentials_file || worker.model.provider || 'account1'
  );
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);

  useEffect(() => {
    fetchCredentials().then(setCredentials);
  }, []);

  const providerFromAccount = credentials.find(c => c.name === credAccount)?.provider || 'anthropic';
  const modelsForProvider = models.filter(m => m.provider === providerFromAccount);

  const doSave = async (newModel: string, newCred: string, field: string) => {
    setSavingField(field);
    setSavedField(null);
    setError(null);
    try {
      const provider = credentials.find(c => c.name === newCred)?.provider || 'anthropic';
      await updateWorker(worker.id, {
        skill: worker.skill || null,
        model: newModel ? { provider, name: newModel } : null,
        credentials_file: newCred || null,
      });
      setSavedField(field);
      setTimeout(() => setSavedField(null), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingField(null);
    }
  };

  const selectAccount = (name: string) => {
    setCredAccount(name);
    setModelName('');
    doSave('', name, 'account');
  };

  const selectModel = (name: string) => {
    setModelName(name);
    doSave(name, credAccount, 'model');
  };

  // 未选中按钮样式（可见边框）
  const idleBtn = 'bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:border-slate-500';
  // 选中按钮样式
  const activeBtn = 'bg-blue-500/20 border border-blue-500/50 text-blue-200';

  const SectionHeader = ({ label, field }: { label: string; field: string }) => (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
      {savingField === field && <Loader2 size={12} className="animate-spin text-slate-400" />}
      {savedField === field && <Check size={12} className="text-emerald-400" />}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-screen w-full max-w-sm bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-slate-100 truncate">{worker.name}</div>
              <div className="text-xs text-slate-400">{worker.role}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1 shrink-0 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">
          <p className="text-xs text-slate-400 leading-relaxed">{worker.description}</p>

          {/* Skill（只读展示） */}
          {worker.skill && (
            <div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Skill</div>
              <div className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300">
                {worker.skill}
              </div>
            </div>
          )}

          {/* 账户 */}
          <div>
            <SectionHeader label="账户" field="account" />
            <div className="space-y-1.5">
              {credentials.length === 0 ? (
                <div className="text-sm text-slate-500 px-3 py-2 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> 加载中...
                </div>
              ) : (
                credentials.map(cred => (
                  <button
                    key={cred.name}
                    onClick={() => selectAccount(cred.name)}
                    disabled={savingField !== null}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      credAccount === cred.name ? activeBtn : idleBtn
                    }`}
                  >
                    <span className="font-medium">{cred.name}</span>
                    <span className="text-xs opacity-60">{cred.provider}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 模型 */}
          <div>
            <SectionHeader label="模型" field="model" />
            <div className="space-y-1.5">
              {modelsForProvider.length === 0 ? (
                <div className="text-sm text-slate-500 px-3 py-2">无可用模型</div>
              ) : (
                modelsForProvider.map(m => (
                  <button
                    key={m.id}
                    onClick={() => selectModel(m.id)}
                    disabled={savingField !== null}
                    className={`w-full flex items-center px-3 py-2 rounded-lg text-xs transition-colors ${
                      modelName === m.id ? activeBtn : idleBtn
                    }`}
                  >
                    <span className="font-mono">{m.id}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Abilities */}
          {worker.abilities && worker.abilities.length > 0 && (
            <div>
              <SectionHeader label="Abilities" field="abilities" />
              <div className="space-y-1.5">
                {worker.abilities.map(ab => (
                  <div key={ab.id} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
                    <div className="text-xs font-medium text-slate-200">{ab.name}</div>
                    {ab.description && <div className="text-[11px] text-slate-500 mt-0.5">{ab.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 rounded-lg p-2.5 border border-red-800/40">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Tab 定义 ──────────────────────────────────────────────────

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  areaId: string | null;
}

const TABS: TabDef[] = [
  {
    id: 'cecelia',
    label: 'Cecelia',
    icon: <Brain size={16} />,
    areaId: null,
  },
  {
    id: 'core',
    label: '核心团队',
    icon: <Users size={16} />,
    areaId: 'cecelia',
  },
  {
    id: 'zenithjoy',
    label: 'ZenithJoy',
    icon: <Building2 size={16} />,
    areaId: 'zenithjoy',
  },
];

// ── Main page ─────────────────────────────────────────────────

export default function TeamPage() {
  const [teams, setTeams]               = useState<Team[]>([]);
  const [areas, setAreas]               = useState<Record<string, AreaConfig>>({});
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [models, setModels]             = useState<ModelEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [selected, setSelected]         = useState<Worker | null>(null);
  const [activeTab, setActiveTab]       = useState('cecelia');

  void areas;

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    Promise.all([fetchStaff(), fetchModels()])
      .then(([staff, modelList]) => {
        setTeams(staff.teams);
        setAreas(staff.areas || {});
        setTotalWorkers(staff.total_workers);
        setModels(modelList);
      })
      .catch(err => setError(err.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClose = () => {
    setSelected(null);
    load(true); // 静默刷新，不触发 loading spinner
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-slate-500" size={32} />
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 p-8">
      <AlertCircle size={20} /><span>{error}</span>
    </div>
  );

  const getAreaWorkers = (areaId: string) => {
    const areaTeams = teams.filter(t => t.area === areaId);
    const map: Record<string, Team[]> = {};
    for (const t of areaTeams) {
      const dept = t.department || t.name;
      if (!map[dept]) map[dept] = [];
      map[dept].push(t);
    }
    return map;
  };

  const renderWorkers = (areaId: string) => {
    const deptMap = getAreaWorkers(areaId);
    if (!Object.keys(deptMap).length) return (
      <div className="text-sm text-slate-500 text-center py-8">暂无成员</div>
    );
    return (
      <div className="space-y-6">
        {Object.entries(deptMap).map(([dept, deptTeams]) => {
          const workers = deptTeams.flatMap(t => t.workers);
          return (
            <div key={dept}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium text-slate-400">{dept}</span>
                <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                  {workers.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {workers.map(w => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    onClick={() => setSelected(w)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const currentTab = TABS.find(t => t.id === activeTab) || TABS[0];

  return (
    <div className="p-6 space-y-8">

      {/* ── Header + Tab Bar ─────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <Brain size={22} className="text-slate-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-100">LM 配置</h2>
            <p className="text-xs text-slate-500">{totalWorkers} workers · 点击卡片配置账户/模型</p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-800 w-fit mb-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-slate-700 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'cecelia' && <BrainLayerConfig />}
          {currentTab.areaId !== null && renderWorkers(currentTab.areaId)}
        </div>
      </section>

      {/* ── Detail panel ──────────────────────────────── */}
      {selected && (
        <WorkerPanel
          worker={selected}
          models={models}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
