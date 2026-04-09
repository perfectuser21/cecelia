/**
 * BrainModelsPage — 大脑模型切换面板
 * 路由：/brain-models
 * 查看/切换 Brain 各 organ 使用的 LLM 模型
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tier: string;
}

interface OrganConfig {
  model: string;
  provider: string;
  tier?: string;
}

interface ProfileConfig {
  thalamus?: OrganConfig;
  cortex?: OrganConfig;
  mouth?: OrganConfig;
  memory?: OrganConfig;
  narrative?: OrganConfig;
  reflection?: OrganConfig;
  rumination?: OrganConfig;
}

interface Profile {
  id: string;
  name: string;
  config: ProfileConfig;
  is_active: boolean;
  updated_at: string;
}

const ORGAN_META: Record<string, { label: string; desc: string; emoji: string }> = {
  thalamus:   { label: '丘脑',  desc: 'L1 事件路由',   emoji: '🔀' },
  cortex:     { label: '皮层',  desc: 'L2 深度决策',   emoji: '🧠' },
  mouth:      { label: '口',    desc: '回复生成',       emoji: '💬' },
  memory:     { label: '记忆',  desc: '记忆检索',       emoji: '📚' },
  narrative:  { label: '叙事',  desc: '叙述生成',       emoji: '📝' },
  reflection: { label: '反思',  desc: '自我反思',       emoji: '🪞' },
  rumination: { label: '沉思',  desc: '深度沉思',       emoji: '🌊' },
};

const PROVIDER_COLOR: Record<string, string> = {
  minimax:   '#10b981',
  anthropic: '#58a6ff',
  openai:    '#d29922',
};

const TIER_BADGE: Record<string, { label: string; color: string }> = {
  fast:     { label: 'FAST',    color: '#10b981' },
  standard: { label: 'STD',     color: '#58a6ff' },
  premium:  { label: 'PREMIUM', color: '#bc8cff' },
};

export default function BrainModelsPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [editingOrgan, setEditingOrgan] = useState<string | null>(null);
  const [savingOrgan, setSavingOrgan] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
    try {
      const [profilesRes, activeRes, modelsRes] = await Promise.all([
        fetch('/api/brain/model-profiles'),
        fetch('/api/brain/model-profiles/active'),
        fetch('/api/brain/model-profiles/models'),
      ]);
      if (profilesRes.ok) {
        const d = await profilesRes.json();
        if (d.success) setProfiles(d.profiles);
      }
      if (activeRes.ok) {
        const d = await activeRes.json();
        if (d.success) setActiveProfile(d.profile);
      }
      if (modelsRes.ok) {
        const d = await modelsRes.json();
        if (d.success) setAvailableModels(d.models);
      }
      setFetchError(null);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : '数据加载失败，请刷新重试');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSwitchProfile = async (profileId: string) => {
    setSwitching(profileId);
    try {
      const res = await fetch('/api/brain/model-profiles/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(`已切换到：${profiles.find(p => p.id === profileId)?.name}`);
        await fetchData();
      } else {
        showToast(d.error || '切换失败', false);
      }
    } catch { showToast('网络错误', false); }
    finally { setSwitching(null); }
  };

  const handleSaveOrgan = async (organId: string, modelId: string, provider: string) => {
    setSavingOrgan(organId);
    try {
      const res = await fetch('/api/brain/model-profiles/active/agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: organId, model_id: modelId, provider }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(`${ORGAN_META[organId]?.label ?? organId} → ${modelId}`);
        setEditingOrgan(null);
        await fetchData();
      } else {
        showToast(d.error || '保存失败', false);
      }
    } catch { showToast('网络错误', false); }
    finally { setSavingOrgan(null); }
  };

  const S = {
    page: {
      minHeight: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '24px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    } as React.CSSProperties,
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 24,
    } as React.CSSProperties,
    backBtn: {
      background: 'none', border: '1px solid #30363d', borderRadius: 6,
      color: '#8b949e', cursor: 'pointer', fontSize: 12, padding: '6px 12px',
    } as React.CSSProperties,
    title: { fontSize: 20, fontWeight: 600, color: '#e6edf3' } as React.CSSProperties,
    subtitle: { fontSize: 12, color: '#8b949e', marginTop: 2 } as React.CSSProperties,
    sectionLabel: {
      fontSize: 11, fontWeight: 600, color: '#8b949e',
      textTransform: 'uppercase' as const, letterSpacing: '0.08em',
      marginBottom: 12,
    },
    card: {
      background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
      padding: '16px 20px',
    } as React.CSSProperties,
    profileCard: (active: boolean, isThis: boolean) => ({
      background: isThis ? '#1c2a1e' : '#161b22',
      border: `1px solid ${isThis ? '#238636' : '#30363d'}`,
      borderRadius: 8, padding: '14px 18px', cursor: 'pointer',
      transition: 'border-color 0.15s',
      position: 'relative' as const,
      opacity: active ? 1 : 0.7,
    }),
    activeBadge: {
      position: 'absolute' as const, top: 10, right: 10,
      background: '#238636', color: '#fff',
      fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
    },
    organRow: (editing: boolean) => ({
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0',
      borderBottom: '1px solid #21262d',
      background: editing ? '#1c2438' : 'transparent',
      borderRadius: editing ? 6 : 0,
      paddingLeft: editing ? 8 : 0,
      paddingRight: editing ? 8 : 0,
      transition: 'background 0.15s',
    }),
    modelTag: (provider: string) => ({
      display: 'inline-block',
      background: `${PROVIDER_COLOR[provider] ?? '#8b949e'}22`,
      color: PROVIDER_COLOR[provider] ?? '#8b949e',
      border: `1px solid ${PROVIDER_COLOR[provider] ?? '#8b949e'}44`,
      borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 500,
    }),
    editBtn: {
      background: 'none', border: '1px solid #30363d', borderRadius: 4,
      color: '#8b949e', cursor: 'pointer', fontSize: 11, padding: '3px 8px',
    } as React.CSSProperties,
    saveBtn: {
      background: '#238636', border: 'none', borderRadius: 4,
      color: '#fff', cursor: 'pointer', fontSize: 11, padding: '4px 10px',
    } as React.CSSProperties,
    cancelBtn: {
      background: 'none', border: '1px solid #30363d', borderRadius: 4,
      color: '#8b949e', cursor: 'pointer', fontSize: 11, padding: '4px 10px',
    } as React.CSSProperties,
    select: {
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 4,
      color: '#e6edf3', fontSize: 12, padding: '4px 8px', cursor: 'pointer',
    } as React.CSSProperties,
  };

  const activeConfig = activeProfile?.config ?? {};
  const organs = Object.keys(ORGAN_META).filter(id => activeConfig[id as keyof ProfileConfig]);

  return (
    <div style={S.page}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          background: toast.ok ? '#238636' : '#da3633',
          color: '#fff', borderRadius: 8, padding: '10px 18px',
          fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          transition: 'opacity 0.3s',
        }}>
          {toast.msg}
        </div>
      )}

      {/* 加载错误提示 */}
      {fetchError && (
        <div style={{
          background: '#2d1515', border: '1px solid #da3633', borderRadius: 8,
          color: '#f85149', padding: '10px 16px', marginBottom: 16, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>⚠ {fetchError}</span>
          <button style={{ ...S.editBtn, color: '#f85149', borderColor: '#da363344' }} onClick={fetchData}>
            重试
          </button>
        </div>
      )}

      {/* 页头 */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button style={S.backBtn} onClick={() => navigate('/live-monitor')}>← 返回</button>
          <div>
            <div style={S.title}>🧠 大脑模型配置</div>
            <div style={S.subtitle}>
              Brain organ LLM 切换面板
              {lastRefresh && ` · 更新于 ${lastRefresh.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}`}
            </div>
          </div>
        </div>
        <button style={S.backBtn} onClick={fetchData}>刷新</button>
      </div>

      {/* Profile 切换 */}
      <div style={{ marginBottom: 28 }}>
        <div style={S.sectionLabel}>Profile 一键切换</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {profiles.map(p => (
            <div
              key={p.id}
              style={S.profileCard(true, p.is_active)}
              onClick={() => !p.is_active && handleSwitchProfile(p.id)}
            >
              {p.is_active && <div style={S.activeBadge}>激活中</div>}
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>
                丘脑: {p.config.thalamus?.model ?? '—'}
              </div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>
                皮层: {p.config.cortex?.model ?? '—'}
              </div>
              {!p.is_active && (
                <div style={{ marginTop: 10 }}>
                  <button
                    style={{ ...S.saveBtn, width: '100%', padding: '6px 0' }}
                    onClick={e => { e.stopPropagation(); handleSwitchProfile(p.id); }}
                    disabled={switching === p.id}
                  >
                    {switching === p.id ? '切换中...' : '切换到此 Profile'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Organ 模型详情 */}
      <div>
        <div style={S.sectionLabel}>
          当前各 Organ 模型
          {activeProfile && <span style={{ color: '#58a6ff', marginLeft: 8 }}>— {activeProfile.name}</span>}
        </div>
        <div style={S.card}>
          {organs.length === 0 ? (
            <div style={{ color: '#8b949e', textAlign: 'center', padding: '24px 0' }}>
              暂无数据，请刷新
            </div>
          ) : (
            organs.map((organId, idx) => {
              const cfg = activeConfig[organId as keyof ProfileConfig]!;
              const meta = ORGAN_META[organId];
              const isEditing = editingOrgan === organId;
              const isSaving = savingOrgan === organId;
              const providerModels = availableModels;

              return (
                <div key={organId} style={{
                  ...S.organRow(isEditing),
                  borderBottom: idx < organs.length - 1 ? '1px solid #21262d' : 'none',
                }}>
                  {/* 左：organ 信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.emoji}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>
                        {meta.label}
                        <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 400, marginLeft: 6 }}>
                          {meta.desc}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                        {organId}
                      </div>
                    </div>
                  </div>

                  {/* 右：模型 + 编辑 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {isEditing ? (
                      <OrganEditor
                        organId={organId}
                        current={cfg}
                        models={providerModels}
                        saving={isSaving}
                        onSave={handleSaveOrgan}
                        onCancel={() => setEditingOrgan(null)}
                        saveBtn={S.saveBtn}
                        cancelBtn={S.cancelBtn}
                        selectStyle={S.select}
                        modelTag={S.modelTag}
                        tierBadge={TIER_BADGE}
                      />
                    ) : (
                      <>
                        <span style={S.modelTag(cfg.provider)}>{cfg.model}</span>
                        {cfg.tier && TIER_BADGE[cfg.tier] && (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: TIER_BADGE[cfg.tier].color,
                            border: `1px solid ${TIER_BADGE[cfg.tier].color}44`,
                            borderRadius: 4, padding: '1px 5px',
                          }}>
                            {TIER_BADGE[cfg.tier].label}
                          </span>
                        )}
                        <button style={S.editBtn} onClick={() => setEditingOrgan(organId)}>
                          调整
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部说明 */}
      <div style={{ marginTop: 24, fontSize: 11, color: '#484f58', lineHeight: 1.6 }}>
        <div>• Profile 切换会立即影响下一次 LLM 调用，无需重启 Brain</div>
        <div>• 单 Organ 调整仅修改当前激活 Profile 中的对应配置</div>
        <div>• 丘脑（thalamus）是 Brain 的 Gateway，负责所有事件路由决策</div>
      </div>
    </div>
  );
}

// Organ 编辑子组件
function OrganEditor({
  organId, current, models, saving,
  onSave, onCancel,
  saveBtn, cancelBtn, selectStyle, modelTag, tierBadge,
}: {
  organId: string;
  current: OrganConfig;
  models: ModelInfo[];
  saving: boolean;
  onSave: (id: string, model: string, provider: string) => void;
  onCancel: () => void;
  saveBtn: React.CSSProperties;
  cancelBtn: React.CSSProperties;
  selectStyle: React.CSSProperties;
  modelTag: (p: string) => React.CSSProperties;
  tierBadge: Record<string, { label: string; color: string }>;
}) {
  const [selectedModel, setSelectedModel] = useState(current.model);
  const selectedInfo = models.find(m => m.id === selectedModel);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select
        style={selectStyle}
        value={selectedModel}
        onChange={e => setSelectedModel(e.target.value)}
      >
        {models.map(m => (
          <option key={m.id} value={m.id}>
            [{m.provider.toUpperCase()}] {m.name} ({m.id})
          </option>
        ))}
      </select>
      {selectedInfo && (
        <span style={modelTag(selectedInfo.provider)}>{selectedInfo.provider}</span>
      )}
      <button
        style={saveBtn}
        disabled={saving}
        onClick={() => onSave(organId, selectedModel, selectedInfo?.provider ?? current.provider)}
      >
        {saving ? '保存...' : '保存'}
      </button>
      <button style={cancelBtn} onClick={onCancel}>取消</button>
    </div>
  );
}
