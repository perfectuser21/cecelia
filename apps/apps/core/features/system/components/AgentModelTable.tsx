import { useState } from 'react';
import { Lock, ChevronDown, Check } from 'lucide-react';
import { ModelInfo, AgentInfo, ModelProfile } from '../api/model-profile.api';

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
    if (agentMap[provider]) return agentMap[provider];
  }
  return '';
}

interface AgentRowProps {
  agent: AgentInfo;
  models: ModelInfo[];
  currentModelId: string;
  pendingModelId?: string;
  onSelect: (agentId: string, modelId: string) => void;
}

function AgentRow({ agent, models, currentModelId, pendingModelId, onSelect }: AgentRowProps) {
  const [selectOpen, setSelectOpen] = useState(false);
  const allowedModels = models.filter((m) => agent.allowed_models.includes(m.id));
  const isLocked = allowedModels.length <= 1;

  const displayModelId = pendingModelId ?? currentModelId;
  const displayModel = models.find((m) => m.id === displayModelId);
  const hasChange = pendingModelId !== undefined && pendingModelId !== currentModelId;

  const handleSelect = (modelId: string) => {
    setSelectOpen(false);
    onSelect(agent.id, modelId);
  };

  // 按 provider 分组
  const grouped = new Map<string, ModelInfo[]>();
  for (const m of allowedModels) {
    const list = grouped.get(m.provider) || [];
    list.push(m);
    grouped.set(m.provider, list);
  }

  return (
    <div className={`flex items-center gap-4 px-4 py-3 transition-colors ${hasChange ? 'bg-blue-500/5' : 'hover:bg-white/[0.02]'}`}>
      {/* Agent 名称 */}
      <div className="flex items-center gap-2 w-44 flex-shrink-0">
        {hasChange && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />}
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
    </div>
  );
}

interface AgentModelTableProps {
  agents: AgentInfo[];
  models: ModelInfo[];
  profile: ModelProfile;
  pendingChanges: Map<string, string>;
  onModelChange: (agentId: string, modelId: string) => void;
}

export default function AgentModelTable({ agents, models, profile, pendingChanges, onModelChange }: AgentModelTableProps) {
  const brainAgents = agents.filter((a) => a.layer === 'brain');
  const executorAgents = agents.filter((a) => a.layer === 'executor');

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
            pendingModelId={pendingChanges.get(agent.id)}
            onSelect={onModelChange}
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
