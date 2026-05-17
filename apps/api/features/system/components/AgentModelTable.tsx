import { useState } from 'react';
import { Lock, ChevronDown, Check, RotateCcw } from 'lucide-react';
import { ModelInfo, AgentInfo, ModelProfile, AgentModelMapEntry, updateAgentCascade } from '../api/model-profile.api';

function getProviderColor(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'text-purple-400';
    case 'minimax': return 'text-emerald-400';
    case 'openai': return 'text-blue-400';
    default: return 'text-gray-400';
  }
}

function getProviderDotColor(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'bg-purple-400';
    case 'minimax': return 'bg-emerald-400';
    case 'openai': return 'bg-blue-400';
    default: return 'bg-gray-400';
  }
}

function getProviderBg(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'bg-purple-500/10';
    case 'minimax': return 'bg-emerald-500/10';
    case 'openai': return 'bg-blue-500/10';
    default: return 'bg-gray-500/10';
  }
}

function getCurrentModel(agent: AgentInfo, profile: ModelProfile): string {
  if (agent.layer === 'brain') {
    const layerConfig = profile.config[agent.id as 'thalamus' | 'cortex'];
    return layerConfig?.model || '';
  }
  const modelMap = profile.config.executor.model_map;
  if (!modelMap || !modelMap[agent.id]) return '';
  const agentMap = modelMap[agent.id];
  for (const provider of ['minimax', 'anthropic', 'openai']) {
    const val = agentMap[provider as keyof AgentModelMapEntry];
    if (val && typeof val === 'string') return val;
  }
  return '';
}

function getAgentCascade(agent: AgentInfo, profile: ModelProfile): string[] | null {
  if (agent.layer !== 'executor') return null;
  const modelMap = profile.config.executor.model_map;
  return modelMap?.[agent.id]?.cascade ?? null;
}

// 梯队个数
const TIER_COUNT = 4;

interface TierSelectProps {
  tierIndex: number;
  modelId: string | null; // null = 自动 / 不使用
  isAuto: boolean;
  models: ModelInfo[];
  allowedModels: string[];
  onChange: (modelId: string | null) => void;
}

function TierSelect({ tierIndex, modelId, isAuto, models, allowedModels, onChange }: TierSelectProps) {
  const [open, setOpen] = useState(false);
  const allowedList = models.filter((m) => allowedModels.includes(m.id));
  const displayModel = modelId ? models.find((m) => m.id === modelId) : null;

  // 按 provider 分组
  const grouped = new Map<string, ModelInfo[]>();
  for (const m of allowedList) {
    const list = grouped.get(m.provider) || [];
    list.push(m);
    grouped.set(m.provider, list);
  }

  const tierLabel = `T${tierIndex + 1}`;
  const isSet = !isAuto && modelId !== null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={`梯队 ${tierIndex + 1}`}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs transition-colors min-w-[90px] ${
          isAuto
            ? 'bg-white/[0.02] border-white/5 text-gray-500'
            : isSet
            ? 'bg-blue-500/10 border-blue-500/30 text-white hover:border-blue-500/50'
            : 'bg-white/[0.02] border-dashed border-white/10 text-gray-600'
        }`}
      >
        <span className={`text-[10px] font-mono flex-shrink-0 ${isAuto ? 'text-gray-600' : 'text-gray-400'}`}>
          {tierLabel}
        </span>
        {isAuto ? (
          <span className="truncate">自动</span>
        ) : displayModel ? (
          <>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getProviderDotColor(displayModel.provider)}`} />
            <span className="truncate">{displayModel.name}</span>
          </>
        ) : (
          <span className="truncate text-gray-600">不使用</span>
        )}
        <ChevronDown className={`w-3 h-3 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-gray-900 border border-white/10 rounded-lg shadow-xl z-20 py-1 max-h-60 overflow-auto">
            {/* 不使用选项 */}
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors text-gray-500 ${
                !isAuto && modelId === null ? 'bg-white/5' : ''
              }`}
            >
              — 不使用
            </button>

            {Array.from(grouped.entries()).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className={`px-3 py-1 text-[10px] font-medium ${getProviderColor(provider)} opacity-60`}>
                  {provider}
                </div>
                {providerModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center gap-2 ${
                      m.id === modelId ? 'text-blue-400 bg-blue-500/10' : 'text-gray-300'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getProviderDotColor(m.provider)}`} />
                    <span>{m.name}</span>
                    {m.id === modelId && <Check className="w-3 h-3 ml-auto flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface AgentRowProps {
  agent: AgentInfo;
  models: ModelInfo[];
  currentModelId: string;
  pendingModelId?: string;
  profile: ModelProfile;
  onSelect: (agentId: string, modelId: string) => void;
  onCascadeChange: (agentId: string, cascade: string[] | null) => void;
}

function AgentRow({ agent, models, currentModelId, pendingModelId, profile, onSelect, onCascadeChange }: AgentRowProps) {
  const [selectOpen, setSelectOpen] = useState(false);
  const [localCascade, setLocalCascade] = useState<(string | null)[] | null>(null); // null = not edited yet
  const [saving, setSaving] = useState(false);

  const allowedModels = models.filter((m) => agent.allowed_models.includes(m.id));
  const isLocked = allowedModels.length <= 1;

  const displayModelId = pendingModelId ?? currentModelId;
  const displayModel = models.find((m) => m.id === displayModelId);
  const hasChange = pendingModelId !== undefined && pendingModelId !== currentModelId;

  // Cascade state
  const profileCascade = getAgentCascade(agent, profile); // null = auto
  const isExecutor = agent.layer === 'executor';

  // Tiers: localCascade takes priority, then profileCascade, else all-null (auto)
  const activeCascade: (string | null)[] = localCascade
    ?? (profileCascade ? [...profileCascade, ...Array(TIER_COUNT).fill(null)].slice(0, TIER_COUNT) : Array(TIER_COUNT).fill(null));

  const hasCascadeEdit = localCascade !== null;
  const hasCascadeSet = profileCascade !== null;

  const handleTierChange = (tierIndex: number, modelId: string | null) => {
    const next = [...activeCascade];
    next[tierIndex] = modelId;
    setLocalCascade(next);
  };

  const saveCascade = async () => {
    // compact: remove trailing nulls, if all null → reset to auto
    const compact = [...activeCascade];
    while (compact.length > 0 && compact[compact.length - 1] === null) compact.pop();
    const newCascade = compact.length === 0 ? null : compact.filter(Boolean) as string[];

    setSaving(true);
    try {
      await updateAgentCascade(agent.id, newCascade);
      onCascadeChange(agent.id, newCascade);
      setLocalCascade(null);
    } finally {
      setSaving(false);
    }
  };

  const resetCascade = async () => {
    setSaving(true);
    try {
      await updateAgentCascade(agent.id, null);
      onCascadeChange(agent.id, null);
      setLocalCascade(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (modelId: string) => {
    setSelectOpen(false);
    onSelect(agent.id, modelId);
  };

  // 按 provider 分组（for brain-layer dropdown）
  const grouped = new Map<string, ModelInfo[]>();
  for (const m of allowedModels) {
    const list = grouped.get(m.provider) || [];
    list.push(m);
    grouped.set(m.provider, list);
  }

  return (
    <div className={`px-4 py-3 transition-colors ${hasChange || hasCascadeEdit ? 'bg-blue-500/5' : 'hover:bg-white/[0.02]'}`}>
      <div className="flex items-center gap-4">
        {/* Agent 名称 */}
        <div className="flex items-center gap-2 w-44 flex-shrink-0">
          {(hasChange || hasCascadeEdit) && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />}
          <span className="text-sm text-white font-medium">{agent.name}</span>
          {agent.fixed_provider && (
            <span title={`锁定: ${agent.fixed_provider}`}>
              <Lock className="w-3 h-3 text-gray-500" />
            </span>
          )}
        </div>

        {/* 描述 */}
        <span className="text-xs text-gray-500 w-28 flex-shrink-0 hidden md:block">{agent.description}</span>

        {/* 模型选择器 (brain) 或 梯队选择器 (executor) */}
        {isExecutor ? (
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {Array.from({ length: TIER_COUNT }).map((_, i) => {
              const tierModelId = activeCascade[i] ?? null;
              const isAuto = !hasCascadeEdit && !hasCascadeSet;
              return (
                <TierSelect
                  key={i}
                  tierIndex={i}
                  modelId={tierModelId}
                  isAuto={isAuto && tierModelId === null}
                  models={models}
                  allowedModels={agent.allowed_models}
                  onChange={(mid) => handleTierChange(i, mid)}
                />
              );
            })}

            {/* 操作按钮 */}
            {hasCascadeEdit && (
              <button
                onClick={saveCascade}
                disabled={saving}
                className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            )}
            {!hasCascadeEdit && hasCascadeSet && (
              <button
                onClick={resetCascade}
                disabled={saving}
                title="重置为自动"
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          /* Brain 层：单模型下拉 */
          <div className="relative flex-1 max-w-xs">
            {isLocked ? (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getProviderBg(displayModel?.provider || '')} border border-white/5`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getProviderDotColor(displayModel?.provider || '')}`} />
                <span className="text-sm text-gray-300">{displayModel?.name || displayModelId}</span>
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setSelectOpen(!selectOpen)}
                  className={`flex items-center justify-between gap-2 w-full px-3 py-1.5 rounded-lg border transition-colors ${
                    hasChange
                      ? 'bg-blue-500/10 border-blue-500/30 hover:border-blue-500/50'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getProviderDotColor(displayModel?.provider || '')}`} />
                    <span className="text-sm text-white">{displayModel?.name || displayModelId}</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${selectOpen ? 'rotate-180' : ''}`} />
                </button>

                {selectOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setSelectOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 w-full min-w-[200px] bg-gray-900 border border-white/10 rounded-lg shadow-xl z-20 py-1 max-h-60 overflow-auto">
                      {Array.from(grouped.entries()).map(([provider, providerModels]) => (
                        <div key={provider}>
                          <div className={`px-3 py-1 text-xs font-medium ${getProviderColor(provider)} opacity-60`}>
                            {provider}
                          </div>
                          {providerModels.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => handleSelect(m.id)}
                              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors flex items-center gap-2 ${
                                m.id === displayModelId ? 'text-blue-400 bg-blue-500/10' : 'text-gray-300'
                              }`}
                            >
                              <span>{m.name}</span>
                              {m.id === agent.recommended_model && (
                                <span className="text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">推荐</span>
                              )}
                              {m.id === displayModelId && <Check className="w-3 h-3 ml-auto flex-shrink-0" />}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentModelTableProps {
  agents: AgentInfo[];
  models: ModelInfo[];
  profile: ModelProfile;
  pendingChanges: Map<string, string>;
  onModelChange: (agentId: string, modelId: string) => void;
  onProfileRefresh?: () => void;
}

export default function AgentModelTable({ agents, models, profile, pendingChanges, onModelChange, onProfileRefresh }: AgentModelTableProps) {
  const brainAgents = agents.filter((a) => a.layer === 'brain');
  const executorAgents = agents.filter((a) => a.layer === 'executor');

  const handleCascadeChange = (_agentId: string, _cascade: string[] | null) => {
    // 触发父组件刷新 profile 数据
    onProfileRefresh?.();
  };

  const renderGroup = (title: string, groupAgents: AgentInfo[]) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
        <h3 className="text-sm font-medium text-gray-300">{title}</h3>
        {title === '执行层' && (
          <p className="text-xs text-gray-600 mt-0.5">梯队顺序 = 降级顺序，T1 优先，自动表示走默认配额瀑布</p>
        )}
      </div>
      <div className="divide-y divide-white/5">
        {groupAgents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            models={models}
            profile={profile}
            currentModelId={getCurrentModel(agent, profile)}
            pendingModelId={pendingChanges.get(agent.id)}
            onSelect={onModelChange}
            onCascadeChange={handleCascadeChange}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {brainAgents.length > 0 && renderGroup('大脑层', brainAgents)}
      {executorAgents.length > 0 && renderGroup('执行层', executorAgents)}
    </div>
  );
}
