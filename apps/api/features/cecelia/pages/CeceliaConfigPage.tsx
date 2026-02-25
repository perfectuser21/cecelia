import { useState, useEffect, useCallback } from 'react';
import { Brain, Zap, ChevronDown, Check, RefreshCw, AlertCircle } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string;
  name: string;
  provider: 'anthropic' | 'minimax' | 'openai';
  tier: 'premium' | 'standard' | 'fast';
  deprecated?: boolean;
}

interface LayerDef {
  id: string;
  name: string;
  description: string;
  allowed_models: string[];
  currentModel: string;
}

interface ActiveProfile {
  id: string;
  name: string;
  config: {
    thalamus: { model: string; provider: string };
    cortex: { model: string; provider: string };
  };
}

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  layer: string;
  allowed_models: string[];
  recommended_model: string;
  fixed_provider: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PROVIDER_STYLES: Record<string, { bg: string; text: string }> = {
  anthropic: { bg: 'rgba(251,146,60,0.12)', text: '#fb923c' },
  minimax:   { bg: 'rgba(96,165,250,0.12)',  text: '#60a5fa' },
  openai:    { bg: 'rgba(52,211,153,0.12)',  text: '#34d399' },
};

const TIER_DOTS: Record<string, string> = {
  premium:  '#f59e0b',
  standard: '#818cf8',
  fast:     '#34d399',
};

// ── ModelDropdown ──────────────────────────────────────────────────────────

interface ModelDropdownProps {
  value: string;
  options: ModelInfo[];
  allModels: ModelInfo[];
  onChange: (modelId: string) => void;
  saving?: boolean;
  saved?: boolean;
}

function ModelDropdown({ value, options, allModels, onChange, saving, saved }: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const current = allModels.find(m => m.id === value);
  const ps = current ? PROVIDER_STYLES[current.provider] : PROVIDER_STYLES.anthropic;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 8, minWidth: 200,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        {current && (
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            padding: '2px 6px', borderRadius: 4, flexShrink: 0,
            background: ps.bg, color: ps.text }}>
            {current.provider.toUpperCase()}
          </span>
        )}
        <span style={{ fontSize: 12, color: '#e2e8f0', flex: 1, textAlign: 'left' }}>
          {current?.name || value || '—'}
        </span>
        {current && (
          <div style={{ width: 6, height: 6, borderRadius: '50%',
            background: TIER_DOTS[current.tier] || '#666', flexShrink: 0 }} />
        )}
        {saving ? (
          <RefreshCw size={11} style={{ color: '#a78bfa', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        ) : saved ? (
          <Check size={11} style={{ color: '#34d399', flexShrink: 0 }} />
        ) : (
          <ChevronDown size={11} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 10,
            background: '#161622', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, overflow: 'hidden', minWidth: '100%',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {options.filter(m => !m.deprecated).map(m => {
              const mps = PROVIDER_STYLES[m.provider];
              const isSelected = m.id === value;
              return (
                <button
                  key={m.id}
                  onClick={() => { onChange(m.id); setOpen(false); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', border: 'none', cursor: 'pointer',
                    background: isSelected ? 'rgba(139,92,246,0.12)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                    padding: '2px 5px', borderRadius: 3, flexShrink: 0,
                    background: mps.bg, color: mps.text }}>
                    {m.provider.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, color: isSelected ? '#c4b5fd' : '#cbd5e1', flex: 1, textAlign: 'left' }}>
                    {m.name}
                  </span>
                  <div style={{ width: 6, height: 6, borderRadius: '50%',
                    background: TIER_DOTS[m.tier] || '#666', flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── LayerRow ───────────────────────────────────────────────────────────────

interface LayerRowProps {
  layer: LayerDef;
  allModels: ModelInfo[];
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{layer.name}</span>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{layer.description}</div>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <AlertCircle size={10} style={{ color: '#f87171' }} />
            <span style={{ fontSize: 10, color: '#f87171' }}>{error}</span>
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

// ── Main Page ──────────────────────────────────────────────────────────────

// 反思层和嘴巴层 fallback（profile 里没有时使用）
const REFLECTION_MODEL_FALLBACK = 'claude-opus-4-20250514';
const MOUTH_MODEL_FALLBACK = 'MiniMax-M2.5-highspeed';

// 追加 Sonnet 4.6 到模型列表（registry 里只有 4.5，但嘴巴用的是 4.6）
const EXTRA_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-6-20251001', name: 'Sonnet 4.6', provider: 'anthropic', tier: 'standard' },
];

export default function CeceliaConfigPage() {
  const [profile, setProfile] = useState<ActiveProfile | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [profileRes, modelsRes] = await Promise.all([
        fetch('/api/brain/model-profiles/active'),
        fetch('/api/brain/model-profiles/models'),
      ]);
      const profileData = await profileRes.json();
      const modelsData = await modelsRes.json();
      if (profileData.success) {
        setProfile(profileData.profile);
        setProfileName(profileData.profile.name);
      }
      if (modelsData.success) {
        const base: ModelInfo[] = modelsData.models || [];
        const ids = new Set(base.map((m: ModelInfo) => m.id));
        setModels([...base, ...EXTRA_MODELS.filter(m => !ids.has(m.id))]);
        setAgents(modelsData.agents || []);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = useCallback(async (agentId: string, modelId: string) => {
    const res = await fetch('/api/brain/model-profiles/active/agent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, model_id: modelId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '更新失败');
    const freshRes = await fetch('/api/brain/model-profiles/active');
    const freshData = await freshRes.json();
    if (freshData.success) setProfile(freshData.profile);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: '#09090f' }}>
        <RefreshCw size={20} style={{ color: 'rgba(167,139,250,0.4)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // 从 API agents 获取 allowed_models，保证和后端一致
  // fallback 仅在 core 未部署新版本时使用
  function agentModels(id: string, fallback: string[]): string[] {
    return agents.find(a => a.id === id)?.allowed_models || fallback;
  }

  const cfg = profile?.config as any;
  const layers: LayerDef[] = profile ? [
    {
      id: 'thalamus',
      name: 'L1 丘脑',
      description: '事件路由 · 快速判断',
      allowed_models: agentModels('thalamus', ['MiniMax-M2.5-highspeed', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514']),
      currentModel: cfg.thalamus.model,
    },
    {
      id: 'cortex',
      name: 'L2 皮层',
      description: '深度分析 · RCA · 战略调整',
      allowed_models: agentModels('cortex', ['claude-opus-4-20250514', 'claude-sonnet-4-20250514']),
      currentModel: cfg.cortex.model,
    },
    {
      id: 'reflection',
      name: 'L3 反思层',
      description: '定期深度反思 · 生成洞察',
      allowed_models: agentModels('reflection', ['claude-opus-4-20250514', 'claude-sonnet-4-20250514']),
      currentModel: cfg.reflection?.model || REFLECTION_MODEL_FALLBACK,
    },
    {
      id: 'mouth',
      name: '嘴巴',
      description: '对话生成 · 对外接口',
      allowed_models: agentModels('mouth', ['MiniMax-M2.5-highspeed', 'MiniMax-M2.5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514', 'claude-sonnet-4-6-20251001']),
      currentModel: cfg.mouth?.model || MOUTH_MODEL_FALLBACK,
    },
  ] : [];

  return (
    <div style={{ height: '100%', background: '#09090f', overflowY: 'auto' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '28px 24px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: -4,
              background: 'rgba(139,92,246,0.2)', borderRadius: 10, filter: 'blur(6px)' }} />
            <div style={{ position: 'relative', padding: 8,
              background: 'linear-gradient(135deg,#1e1b4b,rgba(124,58,237,0.3))',
              borderRadius: 10, border: '1px solid rgba(139,92,246,0.3)' }}>
              <Brain size={16} style={{ color: '#c4b5fd' }} />
            </div>
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Cecelia 配置</h1>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>模型层级配置</p>
          </div>
          {profileName && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 8,
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa' }} />
              <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 500 }}>{profileName}</span>
            </div>
          )}
        </div>

        {profile ? (
          <>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 8,
                background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.15)' }}>
                <Brain size={12} style={{ color: '#a78bfa' }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>大脑层级</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 2 }}>· 4 层</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
              {layers.map(layer => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  allModels={models}
                  onSave={handleSave}
                />
              ))}
            </div>

            {/* Legend */}
            <div style={{ padding: '10px 14px', borderRadius: 10,
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {[
                  { color: TIER_DOTS.premium, label: 'Premium' },
                  { color: TIER_DOTS.standard, label: 'Standard' },
                  { color: TIER_DOTS.fast, label: 'Fast' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{label}</span>
                  </div>
                ))}
                {Object.entries(PROVIDER_STYLES).map(([p, s]) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                      background: s.bg, color: s.text, letterSpacing: '0.06em' }}>
                      {p.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
              <Zap size={11} style={{ color: 'rgba(167,139,250,0.4)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
                丘脑 / 皮层修改立即生效；反思层 / 嘴巴接入 profile 后生效
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 48 }}>
            <AlertCircle size={24} style={{ color: 'rgba(248,113,113,0.4)' }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>无法加载配置，请检查 Brain 是否运行</span>
            <button
              onClick={loadData}
              style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.04)', color: '#e2e8f0',
                fontSize: 12, cursor: 'pointer' }}
            >
              重试
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
