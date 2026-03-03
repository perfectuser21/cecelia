import { useState, useEffect, useCallback } from 'react';
import { Brain, ChevronDown, Check, RefreshCw, AlertCircle, Zap, CheckCircle, XCircle } from 'lucide-react';
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

// ── Styles ───────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, { badge: string; text: string }> = {
  anthropic: { badge: 'bg-orange-500/[0.12]', text: 'text-orange-400' },
  minimax:   { badge: 'bg-blue-500/[0.12]',   text: 'text-blue-400' },
  openai:    { badge: 'bg-emerald-500/[0.12]', text: 'text-emerald-400' },
};

const TIER_COLORS: Record<string, string> = {
  premium:  'bg-amber-500',
  standard: 'bg-indigo-400',
  fast:     'bg-emerald-400',
};

// ── Toast ─────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  ok: boolean;
}

function Toast({ message, ok }: ToastProps) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
      ok
        ? 'bg-emerald-500/[0.12] border-emerald-500/25 text-emerald-300'
        : 'bg-red-500/[0.12] border-red-500/25 text-red-300'
    }`}>
      {ok
        ? <CheckCircle size={13} className="text-emerald-400 shrink-0" />
        : <XCircle size={13} className="text-red-400 shrink-0" />
      }
      {message}
    </div>
  );
}

// ── ModelDropdown ────────────────────────────────────────────────────────

interface ModelDropdownProps {
  value: string;
  options: ModelEntry[];
  allModels: ModelEntry[];
  onChange: (modelId: string) => void;
  saving?: boolean;
  saved?: boolean;
}

function ModelDropdown({ value, options, allModels, onChange, saving, saved }: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const current = allModels.find(m => m.id === value);
  const ps = current ? PROVIDER_COLORS[current.provider] : PROVIDER_COLORS.anthropic;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg min-w-[200px] bg-white/5 border border-white/10 cursor-pointer transition-all hover:border-white/20"
      >
        {current && (
          <span className={`text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${ps.badge} ${ps.text} shrink-0`}>
            {current.provider.toUpperCase()}
          </span>
        )}
        <span className="text-xs text-slate-200 flex-1 text-left">
          {current?.name || value || '—'}
        </span>
        {current && (
          <div className={`w-1.5 h-1.5 rounded-full ${TIER_COLORS[current.tier || ''] || 'bg-gray-500'} shrink-0`} />
        )}
        {saving ? (
          <RefreshCw size={11} className="text-violet-400 animate-spin shrink-0" />
        ) : saved ? (
          <Check size={11} className="text-emerald-400 shrink-0" />
        ) : (
          <ChevronDown size={11} className="text-white/30 shrink-0" />
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-[9]" />
          <div className="absolute top-full left-0 mt-1 z-10 bg-slate-900 border border-white/10 rounded-[10px] overflow-hidden min-w-full shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            {options.filter(m => !(m as any).deprecated).map(m => {
              const mps = PROVIDER_COLORS[m.provider] || PROVIDER_COLORS.anthropic;
              const isSelected = m.id === value;
              return (
                <button
                  key={m.id}
                  onClick={() => { onChange(m.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 border-none cursor-pointer border-b border-b-white/[0.04] transition-colors ${
                    isSelected ? 'bg-violet-500/[0.12]' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <span className={`text-[9px] font-semibold tracking-wider px-[5px] py-0.5 rounded-[3px] shrink-0 ${mps.badge} ${mps.text}`}>
                    {m.provider.slice(0, 2).toUpperCase()}
                  </span>
                  <span className={`text-xs flex-1 text-left ${isSelected ? 'text-violet-300' : 'text-slate-300'}`}>
                    {m.name || m.id}
                  </span>
                  <div className={`w-1.5 h-1.5 rounded-full ${TIER_COLORS[m.tier || ''] || 'bg-gray-500'} shrink-0`} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── LayerRow ─────────────────────────────────────────────────────────────

interface LayerDef {
  id: string;
  name: string;
  description: string;
  allowed_models: string[];
  currentModel: string;
  currentProvider: string;
}

interface LayerRowProps {
  layer: LayerDef;
  allModels: ModelEntry[];
  onSave: (layerId: string, modelId: string, provider: string) => Promise<void>;
  onSuccess: (agentName: string, modelId: string, provider: string) => void;
  onError: (agentName: string, message: string) => void;
}

// 从 model ID 推断自然 provider
function naturalProviderForModel(modelId: string): string {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('MiniMax-')) return 'minimax';
  return 'openai';
}

// API/无头 切换控件（仅 Anthropic/Claude 模型显示）
interface ProviderToggleProps {
  modelId: string;
  provider: string;
  saving: boolean;
  onChange: (provider: string) => void;
}

function ProviderToggle({ modelId, provider, saving, onChange }: ProviderToggleProps) {
  const isAnthropic = modelId.startsWith('claude-');
  if (!isAnthropic) {
    return (
      <span className="text-[9px] font-bold tracking-wider px-[5px] py-px rounded bg-blue-500/10 text-blue-400 shrink-0">
        API
      </span>
    );
  }
  const isApi = provider === 'anthropic-api';
  return (
    <div className="flex items-center rounded-[6px] border border-white/10 overflow-hidden shrink-0">
      <button
        onClick={() => !saving && onChange('anthropic-api')}
        disabled={saving}
        title="直连 Anthropic API（按量计费，速度快）"
        className={`px-1.5 py-px text-[9px] font-bold tracking-wider transition-colors cursor-pointer ${
          isApi
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'text-white/25 hover:text-white/50'
        }`}
      >
        API
      </button>
      <div className="w-px h-3 bg-white/10" />
      <button
        onClick={() => !saving && onChange('anthropic')}
        disabled={saving}
        title="无头 claude -p（走 Max订阅，速度稍慢）"
        className={`px-1.5 py-px text-[9px] font-bold tracking-wider transition-colors cursor-pointer ${
          !isApi
            ? 'bg-orange-500/20 text-orange-400'
            : 'text-white/25 hover:text-white/50'
        }`}
      >
        无头
      </button>
    </div>
  );
}

function LayerRow({ layer, allModels, onSave, onSuccess, onError }: LayerRowProps) {
  const [model, setModel] = useState(layer.currentModel);
  const [provider, setProvider] = useState(layer.currentProvider);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setModel(layer.currentModel);
    setProvider(layer.currentProvider);
  }, [layer.currentModel, layer.currentProvider]);

  const options = allModels.filter(m => layer.allowed_models.includes(m.id));

  async function doSave(modelId: string, newProvider: string) {
    setSaving(true);
    try {
      await onSave(layer.id, modelId, newProvider);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSuccess(layer.name, modelId, newProvider);
    } catch (e: any) {
      setModel(layer.currentModel);
      setProvider(layer.currentProvider);
      onError(layer.name, e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleModelChange(modelId: string) {
    if (modelId === model) return;
    const newProvider = naturalProviderForModel(modelId);
    setModel(modelId);
    setProvider(newProvider);
    await doSave(modelId, newProvider);
  }

  async function handleProviderChange(newProvider: string) {
    if (newProvider === provider) return;
    setProvider(newProvider);
    await doSave(model, newProvider);
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] bg-white/[0.02] border border-white/5">
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium text-slate-200">{layer.name}</span>
        <div className="text-[11px] text-white/30 mt-px">{layer.description}</div>
      </div>
      <ProviderToggle
        modelId={model}
        provider={provider}
        saving={saving}
        onChange={handleProviderChange}
      />
      <ModelDropdown
        value={model}
        options={options}
        allModels={allModels}
        onChange={handleModelChange}
        saving={saving}
        saved={saved}
      />
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

  useEffect(() => {
    fetchMouthConfig().then(setCurrent);
  }, []);

  const isActive = (opt: typeof MOUTH_OPTIONS[number]) =>
    opt.model === current.model && opt.provider === current.provider;

  async function handleSelect(opt: typeof MOUTH_OPTIONS[number]) {
    if (isActive(opt) || saving) return;
    setSaving(true);
    try {
      await updateMouthConfig(opt.model, opt.provider);
      setCurrent({ model: opt.model, provider: opt.provider });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSuccess('嘴巴', opt.model, opt.provider);
    } catch (e: any) {
      onError('嘴巴', e.message || '更新失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5 rounded-[10px] bg-white/[0.02] border border-white/5">
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
      </div>
    </div>
  );
}

// ── BrainLayerConfig ─────────────────────────────────────────────────────

export default function BrainLayerConfig() {
  const [profile, setProfile] = useState<BrainProfile | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [agents, setAgents] = useState<BrainAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);

  const showToast = useCallback((message: string, ok: boolean) => {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleSuccess = useCallback((agentName: string, _modelId: string, provider: string) => {
    const modeLabel = provider === 'anthropic-api' ? 'API 直连' : '无头模式';
    showToast(`${agentName} 已切换 → ${modeLabel}`, true);
  }, [showToast]);

  const handleError = useCallback((agentName: string, message: string) => {
    showToast(`${agentName} 切换失败：${message}`, false);
  }, [showToast]);

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

  // 从 API agents 动态生成 layers，不再硬编码
  // 过滤 brain 层且排除 mouth（mouth 有独立的 MouthModeSelector）
  const layers: LayerDef[] = agents
    .filter(a => a.layer === 'brain' && a.id !== 'mouth')
    .map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      allowed_models: a.allowed_models,
      currentModel: (cfg[a.id] as any)?.model || a.recommended_model,
      currentProvider: (cfg[a.id] as any)?.provider || naturalProviderForModel((cfg[a.id] as any)?.model || a.recommended_model),
    }));

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
        <div className="text-[11px] text-white/30 ml-0.5">· {layers.length} 层</div>
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

      {/* Layers */}
      <div className="flex flex-col gap-1.5 mb-4">
        {layers.map(layer => (
          <LayerRow
            key={layer.id}
            layer={layer}
            allModels={models}
            onSave={handleSave}
            onSuccess={handleSuccess}
            onError={handleError}
          />
        ))}
        <MouthModeSelector onSuccess={handleSuccess} onError={handleError} />
      </div>

      {/* Legend */}
      <div className="px-3.5 py-2.5 rounded-[10px] bg-white/[0.02] border border-white/[0.04]">
        <div className="flex flex-wrap gap-3">
          {[
            { color: 'bg-amber-500', label: 'Premium' },
            { color: 'bg-indigo-400', label: 'Standard' },
            { color: 'bg-emerald-400', label: 'Fast' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
              <span className="text-[10px] text-white/30">{label}</span>
            </div>
          ))}
          {Object.entries(PROVIDER_COLORS).map(([p, s]) => (
            <div key={p} className="flex items-center gap-1.5">
              <span className={`text-[9px] font-semibold px-[5px] py-px rounded-[3px] tracking-wider ${s.badge} ${s.text}`}>
                {p.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3">
        <Zap size={11} className="text-violet-400/40 shrink-0" />
        <span className="text-[11px] text-white/25">选择模型后立即生效</span>
      </div>
    </div>
  );
}
