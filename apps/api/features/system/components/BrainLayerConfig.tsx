import { useState, useEffect, useCallback } from 'react';
import { Brain, ChevronDown, ChevronUp, Check, RefreshCw, AlertCircle, Zap, CheckCircle, XCircle } from 'lucide-react';
import {
  fetchBrainProfile,
  fetchBrainModels,
  updateBrainAgent,
  fetchMouthConfig,
  updateMouthConfig,
  type BrainProfile,
  type BrainAgentInfo,
  type ModelEntry,
} from '../api/staffApi';

// ── Types ─────────────────────────────────────────────────────────────────

type CallProvider = 'anthropic-api' | 'anthropic' | 'minimax' | 'minimax-headless';

interface CallOption {
  modelId: string;
  modelName: string;
  provider: CallProvider;
  providerGroup: 'anthropic' | 'minimax';
  callMethod: 'API' | '无头';
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getProviderGroup(modelId: string): 'anthropic' | 'minimax' {
  return modelId.startsWith('MiniMax-') ? 'minimax' : 'anthropic';
}

function getProviderForOption(modelId: string, callMethod: 'API' | '无头'): CallProvider {
  if (modelId.startsWith('MiniMax-')) {
    return callMethod === 'API' ? 'minimax' : 'minimax-headless';
  }
  return callMethod === 'API' ? 'anthropic-api' : 'anthropic';
}

function getCallMethod(provider: CallProvider): '无头' | 'API' {
  return provider === 'anthropic' || provider === 'minimax-headless' ? '无头' : 'API';
}

function modelShortName(modelId: string): string {
  if (modelId.includes('haiku')) return 'Haiku';
  if (modelId.includes('sonnet')) return 'Sonnet';
  if (modelId.includes('opus')) return 'Opus';
  if (modelId === 'MiniMax-M2.5-highspeed') return 'M2.5 Fast';
  if (modelId === 'MiniMax-M2.5') return 'M2.5';
  if (modelId === 'MiniMax-M2') return 'M2';
  if (modelId === 'MiniMax-M2.1') return 'M2.1';
  return modelId;
}

function buildCallOptions(allowedModels: string[], allModels: ModelEntry[]): CallOption[] {
  const options: CallOption[] = [];
  for (const modelId of allowedModels) {
    const m = allModels.find(x => x.id === modelId);
    const modelName = m?.name || modelShortName(modelId);
    const group = getProviderGroup(modelId);
    for (const method of (['API', '无头'] as const)) {
      options.push({
        modelId,
        modelName: modelShortName(modelId),
        provider: getProviderForOption(modelId, method),
        providerGroup: group,
        callMethod: method,
      });
    }
  }
  return options;
}

function currentLabel(model: string, provider: CallProvider): string {
  const group = getProviderGroup(model);
  const providerTag = group === 'minimax' ? 'MM' : 'AN';
  const method = getCallMethod(provider);
  return `${providerTag} · ${modelShortName(model)} · ${method}`;
}

// ── Toast ─────────────────────────────────────────────────────────────────

interface ToastProps { message: string; ok: boolean }

function Toast({ message, ok }: ToastProps) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
      ok
        ? 'bg-emerald-500/[0.12] border-emerald-500/25 text-emerald-300'
        : 'bg-red-500/[0.12] border-red-500/25 text-red-300'
    }`}>
      {ok
        ? <CheckCircle size={13} className="text-emerald-400 shrink-0" />
        : <XCircle size={13} className="text-red-400 shrink-0" />}
      {message}
    </div>
  );
}

// ── OptionButton ──────────────────────────────────────────────────────────

interface OptionButtonProps {
  opt: CallOption;
  isActive: boolean;
  saving: boolean;
  onSelect: (opt: CallOption) => void;
}

const METHOD_STYLES: Record<string, { active: string; base: string; badge: string }> = {
  'API':  {
    active: 'bg-emerald-500/[0.18] border-emerald-500/40 text-emerald-200',
    base:   'bg-white/[0.02] border-white/[0.07] text-slate-400 hover:border-white/20 hover:text-slate-300',
    badge:  'bg-emerald-500/20 text-emerald-400',
  },
  '无头': {
    active: 'bg-orange-500/[0.18] border-orange-500/40 text-orange-200',
    base:   'bg-white/[0.02] border-white/[0.07] text-slate-400 hover:border-white/20 hover:text-slate-300',
    badge:  'bg-orange-500/20 text-orange-400',
  },
};

function OptionButton({ opt, isActive, saving, onSelect }: OptionButtonProps) {
  const styles = METHOD_STYLES[opt.callMethod];
  return (
    <button
      onClick={() => !saving && onSelect(opt)}
      disabled={saving}
      className={`relative text-left px-2.5 py-2 rounded-lg border transition-all cursor-pointer ${
        isActive ? styles.active : styles.base
      } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[9px] font-bold tracking-wider px-1 py-px rounded shrink-0 ${styles.badge}`}>
          {opt.callMethod}
        </span>
        <span className="text-[11px] font-medium truncate">{opt.modelName}</span>
        {isActive && <Check size={9} className="ml-auto shrink-0 text-current opacity-70" />}
      </div>
    </button>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: BrainAgentInfo;
  allModels: ModelEntry[];
  currentModel: string;
  currentProvider: CallProvider;
  onSave: (agentId: string, modelId: string, provider: string) => Promise<void>;
  onSuccess: (agentName: string, modelId: string, provider: string) => void;
  onError: (agentName: string, message: string) => void;
}

function AgentCard({ agent, allModels, currentModel, currentProvider, onSave, onSuccess, onError }: AgentCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const options = buildCallOptions(agent.allowed_models, allModels);
  const anthropicOptions = options.filter(o => o.providerGroup === 'anthropic');
  const minimaxOptions = options.filter(o => o.providerGroup === 'minimax');

  const isActive = (opt: CallOption) =>
    opt.modelId === currentModel && opt.provider === currentProvider;

  async function handleSelect(opt: CallOption) {
    if (isActive(opt) || saving) return;
    setSaving(true);
    try {
      await onSave(agent.id, opt.modelId, opt.provider);
      onSuccess(agent.name, opt.modelId, opt.provider);
      setIsOpen(false);
    } catch (e: any) {
      onError(agent.name, e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[10px] border border-white/[0.07] overflow-hidden">
      {/* 折叠态 Header */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
      >
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-slate-200">{agent.name}</span>
          <span className="text-[11px] text-white/25 ml-2">{agent.description}</span>
        </div>
        {saving && <RefreshCw size={11} className="text-violet-400 animate-spin shrink-0" />}
        {!saving && (
          <span className="text-[10px] text-white/35 font-mono shrink-0">
            {currentLabel(currentModel, currentProvider)}
          </span>
        )}
        {isOpen
          ? <ChevronUp size={13} className="text-white/30 shrink-0" />
          : <ChevronDown size={13} className="text-white/30 shrink-0" />
        }
      </button>

      {/* 展开态 */}
      {isOpen && (
        <div className="px-3.5 py-3 border-t border-white/[0.05] bg-black/20 flex flex-col gap-3">
          {/* Anthropic 分组 */}
          {anthropicOptions.length > 0 && (
            <div>
              <div className="text-[9px] font-bold tracking-wider text-orange-400/60 uppercase mb-1.5 px-0.5">
                Anthropic
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {anthropicOptions.map(opt => (
                  <OptionButton
                    key={`${opt.provider}-${opt.modelId}`}
                    opt={opt}
                    isActive={isActive(opt)}
                    saving={saving}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          )}

          {/* MiniMax 分组 */}
          {minimaxOptions.length > 0 && (
            <div>
              <div className="text-[9px] font-bold tracking-wider text-blue-400/60 uppercase mb-1.5 px-0.5">
                MiniMax
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {minimaxOptions.map(opt => (
                  <OptionButton
                    key={`${opt.provider}-${opt.modelId}`}
                    opt={opt}
                    isActive={isActive(opt)}
                    saving={saving}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MouthModeSelector ────────────────────────────────────────────────────

const MOUTH_OPTIONS = [
  { label: 'API · Haiku',  model: 'claude-haiku-4-5-20251001', provider: 'anthropic-api', desc: '~3s · 快速 · 按量计费' },
  { label: 'API · Sonnet', model: 'claude-sonnet-4-6',         provider: 'anthropic-api', desc: '~6s · 高质量 · 按量计费' },
  { label: '无头 · Haiku',  model: 'claude-haiku-4-5-20251001', provider: 'anthropic',     desc: '~10s · 快速 · Max订阅' },
  { label: '无头 · Sonnet', model: 'claude-sonnet-4-6',         provider: 'anthropic',     desc: '~15s · 高质量 · Max订阅' },
] as const;

interface MouthModeSelectorProps {
  onSuccess: (agentName: string, modelId: string, provider: string) => void;
  onError: (agentName: string, message: string) => void;
}

function MouthModeSelector({ onSuccess, onError }: MouthModeSelectorProps) {
  const [current, setCurrent] = useState<{ model: string | null; provider: string | null }>({ model: null, provider: null });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMouthConfig().then(setCurrent);
  }, []);

  const isActive = (opt: typeof MOUTH_OPTIONS[number]) =>
    opt.model === current.model && opt.provider === current.provider;

  async function handleSelect(opt: typeof MOUTH_OPTIONS[number]) {
    if (isActive(opt) || saving) return;
    setSaving(true);
    setError('');
    try {
      await updateMouthConfig(opt.model, opt.provider);
      setCurrent({ model: opt.model, provider: opt.provider });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSuccess('嘴巴', opt.model, opt.provider);
    } catch (e: any) {
      setError(e.message || '更新失败');
      onError('嘴巴', e.message || '更新失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5 rounded-[10px] bg-white/[0.02] border border-white/[0.07]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[13px] font-medium text-slate-200">嘴巴</span>
          <span className="text-[11px] text-white/30">对话生成 · 对外接口</span>
          {saving && <RefreshCw size={11} className="text-violet-400 animate-spin ml-auto" />}
          {saved && !saving && <Check size={11} className="text-emerald-400 ml-auto" />}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {MOUTH_OPTIONS.map(opt => {
            const active = isActive(opt);
            const isApi = opt.provider === 'anthropic-api';
            return (
              <button
                key={`${opt.provider}-${opt.model}`}
                onClick={() => handleSelect(opt)}
                disabled={saving}
                className={`text-left px-2.5 py-2 rounded-lg border transition-all cursor-pointer ${
                  active
                    ? 'bg-violet-500/[0.15] border-violet-500/40 text-violet-300'
                    : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:border-white/20 hover:text-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[9px] font-bold tracking-wider px-1 py-px rounded ${
                    isApi ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    {isApi ? 'API' : '无头'}
                  </span>
                  <span className="text-[12px] font-medium">
                    {opt.model.includes('haiku') ? 'Haiku' : 'Sonnet'}
                  </span>
                  {active && <Check size={10} className="text-violet-400 ml-auto" />}
                </div>
                <div className="text-[10px] text-white/25">{opt.desc}</div>
              </button>
            );
          })}
        </div>
        {error && (
          <div className="flex items-center gap-1 mt-1.5">
            <AlertCircle size={10} className="text-red-400" />
            <span className="text-[10px] text-red-400">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── BrainLayerConfig ──────────────────────────────────────────────────────

export default function BrainLayerConfig() {
  const [profile, setProfile] = useState<BrainProfile | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [agents, setAgents] = useState<BrainAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [prof, brainModels] = await Promise.all([
        fetchBrainProfile(),
        fetchBrainModels(),
      ]);
      setProfile(prof);
      setModels(brainModels.models);
      setAgents(brainModels.agents);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const showToast = useCallback((message: string, ok: boolean) => {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleSuccess = useCallback((agentName: string, _modelId: string, provider: string) => {
    const method = getCallMethod(provider as CallProvider);
    const group = getProviderGroup(_modelId);
    const providerLabel = group === 'minimax' ? 'MiniMax' : 'Anthropic';
    showToast(`${agentName} 已切换 → ${providerLabel} ${method}`, true);
  }, [showToast]);

  const handleError = useCallback((agentName: string, message: string) => {
    showToast(`${agentName} 切换失败：${message}`, false);
  }, [showToast]);

  const handleSave = useCallback(async (agentId: string, modelId: string, provider: string) => {
    await updateBrainAgent(agentId, modelId, provider);
    const fresh = await fetchBrainProfile();
    if (fresh) setProfile(fresh);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw size={18} className="text-violet-400/40 animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center gap-2 py-8">
        <AlertCircle size={20} className="text-red-400/40" />
        <span className="text-sm text-white/30">无法加载配置，请检查 Brain 是否运行</span>
        <button onClick={loadData} className="mt-2 px-3.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 text-xs cursor-pointer hover:bg-white/[0.08] transition-colors">
          重试
        </button>
      </div>
    );
  }

  const cfg = profile.config as any;
  const brainAgents = agents.filter(a => a.layer === 'brain' && a.id !== 'mouth');

  function agentCurrentModel(id: string, agent: BrainAgentInfo): string {
    return cfg[id]?.model || agent.recommended_model;
  }

  function agentCurrentProvider(id: string, model: string): CallProvider {
    if (cfg[id]?.provider) return cfg[id].provider as CallProvider;
    return getProviderForOption(model, 'API');
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-6">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="relative">
          <div className="absolute -inset-1 bg-violet-500/20 rounded-lg blur-sm" />
          <div className="relative p-2 bg-gradient-to-br from-indigo-950 to-violet-600/30 rounded-lg border border-violet-500/30">
            <Brain size={14} className="text-violet-300" />
          </div>
        </div>
        <div className="text-sm font-semibold text-slate-100">大脑层级</div>
        <div className="text-[11px] text-white/30 ml-0.5">· {brainAgents.length} 层</div>
        {profile.name && (
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/[0.08] border border-violet-500/15">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            <span className="text-[11px] text-violet-400 font-medium">{profile.name}</span>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="mb-3">
          <Toast message={toast.message} ok={toast.ok} />
        </div>
      )}

      {/* Agents */}
      <div className="flex flex-col gap-1.5 mb-4">
        {brainAgents.map(agent => {
          const model = agentCurrentModel(agent.id, agent);
          const provider = agentCurrentProvider(agent.id, model);
          return (
            <AgentCard
              key={agent.id}
              agent={agent}
              allModels={models}
              currentModel={model}
              currentProvider={provider}
              onSave={handleSave}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          );
        })}
        <MouthModeSelector onSuccess={handleSuccess} onError={handleError} />
      </div>

      {/* Legend */}
      <div className="px-3.5 py-2.5 rounded-[10px] bg-white/[0.02] border border-white/[0.04]">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold tracking-wider px-1 py-px rounded bg-emerald-500/20 text-emerald-400">API</span>
            <span className="text-[10px] text-white/30">直连 REST API</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold tracking-wider px-1 py-px rounded bg-orange-500/20 text-orange-400">无头</span>
            <span className="text-[10px] text-white/30">claude -p（Max 订阅 / Skills）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold tracking-wider px-1 py-px rounded bg-orange-400/15 text-orange-400/70">AN</span>
            <span className="text-[10px] text-white/30">Anthropic</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold tracking-wider px-1 py-px rounded bg-blue-400/15 text-blue-400/70">MM</span>
            <span className="text-[10px] text-white/30">MiniMax</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3">
        <Zap size={11} className="text-violet-400/40 shrink-0" />
        <span className="text-[11px] text-white/25">点击 agent 展开选项，选择后立即生效</span>
      </div>
    </div>
  );
}
