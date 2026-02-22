import { useState } from 'react';
import { Lock, Loader, ChevronDown, Check } from 'lucide-react';
import {
  ModelProfile,
  ModelInfo,
  AgentInfo,
  updateAgentModel,
} from '../api/model-profile.api';

function getProviderColor(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'text-purple-400';
    case 'minimax': return 'text-emerald-400';
    case 'openai': return 'text-blue-400';
    default: return 'text-gray-400';
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
  // executor 层
  const modelMap = profile.config.executor.model_map;
  if (!modelMap || !modelMap[agent.id]) return '';
  const agentMap = modelMap[agent.id];
  // 找到非 null 的模型
  for (const provider of ['minimax', 'anthropic', 'openai']) {
    if (agentMap[provider]) return agentMap[provider];
  }
  return '';
}

interface AgentRowProps {
  agent: AgentInfo;
  models: ModelInfo[];
  currentModelId: string;
  onUpdate: (agentId: string, modelId: string) => Promise<void>;
}

function AgentRow({ agent, models, currentModelId, onUpdate }: AgentRowProps) {
  const [updating, setUpdating] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);

  const allowedModels = models.filter((m) => agent.allowed_models.includes(m.id));
  const isLocked = allowedModels.length <= 1;
  const currentModel = models.find((m) => m.id === currentModelId);

  const handleSelect = async (modelId: string) => {
    setSelectOpen(false);
    if (modelId === currentModelId) return;
    setUpdating(true);
    try {
      await onUpdate(agent.id, modelId);
    } finally {
      setUpdating(false);
    }
  };

  // 按 provider 分组
  const grouped = new Map<string, ModelInfo[]>();
  for (const m of allowedModels) {
    const list = grouped.get(m.provider) || [];
    list.push(m);
    grouped.set(m.provider, list);
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
      {/* Agent 名称 */}
      <div className="flex items-center gap-2 w-44 flex-shrink-0">
        <span className="text-sm text-white font-medium">{agent.name}</span>
        {agent.fixed_provider && (
          <span title={`锁定: ${agent.fixed_provider}`}>
            <Lock className="w-3 h-3 text-gray-500" />
          </span>
        )}
      </div>

      {/* 描述 */}
      <span className="text-xs text-gray-500 w-28 flex-shrink-0 hidden md:block">{agent.description}</span>

      {/* 模型选择器 */}
      <div className="relative flex-1 max-w-xs">
        {updating ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Loader className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span className="text-sm text-gray-400">更新中...</span>
          </div>
        ) : isLocked ? (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getProviderBg(currentModel?.provider || '')} border border-white/5`}>
            <span className={`text-xs ${getProviderColor(currentModel?.provider || '')}`}>
              {currentModel?.provider}
            </span>
            <span className="text-sm text-gray-300">{currentModel?.name || currentModelId}</span>
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={() => setSelectOpen(!selectOpen)}
              className="flex items-center justify-between gap-2 w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs ${getProviderColor(currentModel?.provider || '')}`}>
                  {currentModel?.provider}
                </span>
                <span className="text-sm text-white">{currentModel?.name || currentModelId}</span>
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
                            m.id === currentModelId ? 'text-blue-400 bg-blue-500/10' : 'text-gray-300'
                          }`}
                        >
                          <span>{m.name}</span>
                          {m.id === currentModelId && <Check className="w-3 h-3 ml-auto" />}
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
    </div>
  );
}

interface AgentModelTableProps {
  agents: AgentInfo[];
  models: ModelInfo[];
  profile: ModelProfile;
  onUpdated: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export default function AgentModelTable({ agents, models, profile, onUpdated, onToast }: AgentModelTableProps) {
  const brainAgents = agents.filter((a) => a.layer === 'brain');
  const executorAgents = agents.filter((a) => a.layer === 'executor');

  const handleUpdate = async (agentId: string, modelId: string) => {
    try {
      await updateAgentModel(agentId, modelId);
      onUpdated();
      const agent = agents.find((a) => a.id === agentId);
      const model = models.find((m) => m.id === modelId);
      onToast(`${agent?.name || agentId} → ${model?.name || modelId}`, 'success');
    } catch (err) {
      onToast(`更新失败: ${err instanceof Error ? err.message : '未知错误'}`, 'error');
    }
  };

  const renderGroup = (title: string, groupAgents: AgentInfo[]) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
        <h3 className="text-sm font-medium text-gray-300">{title}</h3>
      </div>
      <div className="divide-y divide-white/5">
        {groupAgents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            models={models}
            currentModelId={getCurrentModel(agent, profile)}
            onUpdate={handleUpdate}
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
