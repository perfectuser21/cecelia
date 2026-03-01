import { useState, useEffect, useCallback } from 'react';
import { Brain, ChevronDown, Check, RefreshCw, AlertCircle, Zap } from 'lucide-react';
import {
  fetchBrainProfile,
  fetchBrainModels,
  updateBrainAgent,
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
}

interface LayerRowProps {
  layer: LayerDef;
  allModels: ModelEntry[];
  onSave: (layerId: string, modelId: string) => Promise<void>;
}

function LayerRow({ layer, allModels, onSave }: LayerRowProps) {
  const [model, setModel] = useState(layer.currentModel);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setModel(layer.currentModel); }, [layer.currentModel]);

  const options = allModels.filter(m => layer.allowed_models.includes(m.id));

  async function handleChange(modelId: string) {
    if (modelId === model) return;
    setModel(modelId);
    setSaving(true);
    setError('');
    try {
      await onSave(layer.id, modelId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message || '保存失败');
      setModel(layer.currentModel);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] bg-white/[0.02] border border-white/5">
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium text-slate-200">{layer.name}</span>
        <div className="text-[11px] text-white/30 mt-px">{layer.description}</div>
        {error && (
          <div className="flex items-center gap-1 mt-1">
            <AlertCircle size={10} className="text-red-400" />
            <span className="text-[10px] text-red-400">{error}</span>
          </div>
        )}
      </div>
      <ModelDropdown
        value={model}
        options={options}
        allModels={allModels}
        onChange={handleChange}
        saving={saving}
        saved={saved}
      />
    </div>
  );
}

// ── BrainLayerConfig ─────────────────────────────────────────────────────

const REFLECTION_FALLBACK = 'claude-opus-4-6';
const MOUTH_FALLBACK = 'MiniMax-M2.5-highspeed';

export default function BrainLayerConfig() {
  const [profile, setProfile] = useState<BrainProfile | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [agents, setAgents] = useState<BrainAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

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

  const handleSave = useCallback(async (agentId: string, modelId: string) => {
    await updateBrainAgent(agentId, modelId);
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

  function agentModels(id: string, fallback: string[]): string[] {
    return agents.find(a => a.id === id)?.allowed_models || fallback;
  }

  const cfg = profile.config as any;
  const layers: LayerDef[] = [
    {
      id: 'thalamus',
      name: 'L1 丘脑',
      description: '事件路由 · 快速判断',
      allowed_models: agentModels('thalamus', ['MiniMax-M2.5-highspeed', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6']),
      currentModel: cfg.thalamus?.model || 'MiniMax-M2.5-highspeed',
    },
    {
      id: 'cortex',
      name: 'L2 皮层',
      description: '深度分析 · RCA · 战略调整',
      allowed_models: agentModels('cortex', ['claude-opus-4-6', 'claude-sonnet-4-6']),
      currentModel: cfg.cortex?.model || 'claude-opus-4-6',
    },
    {
      id: 'reflection',
      name: 'L3 反思层',
      description: '定期深度反思 · 生成洞察',
      allowed_models: agentModels('reflection', ['claude-opus-4-6', 'claude-sonnet-4-6']),
      currentModel: cfg.reflection?.model || REFLECTION_FALLBACK,
    },
    {
      id: 'mouth',
      name: '嘴巴',
      description: '对话生成 · 对外接口',
      allowed_models: agentModels('mouth', ['MiniMax-M2.5-highspeed', 'MiniMax-M2.5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6']),
      currentModel: cfg.mouth?.model || MOUTH_FALLBACK,
    },
    {
      id: 'memory',
      name: '记忆打分',
      description: '为感知观察打重要性分（批量）',
      allowed_models: agentModels('memory', ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5']),
      currentModel: cfg.memory?.model || 'claude-haiku-4-5-20251001',
    },
    {
      id: 'rumination',
      name: '反刍消化',
      description: '深度思考 · 模式发现 · 跨知识关联',
      allowed_models: agentModels('rumination', ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']),
      currentModel: cfg.rumination?.model || 'claude-opus-4-6',
    },
  ];

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

      {/* Layers */}
      <div className="flex flex-col gap-1.5 mb-4">
        {layers.map(layer => (
          <LayerRow key={layer.id} layer={layer} allModels={models} onSave={handleSave} />
        ))}
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
