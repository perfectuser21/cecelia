import { useState, useCallback, useMemo } from 'react';
import { Brain, RefreshCw, Save, Loader, X } from 'lucide-react';
import { useApiFn } from '../../shared/hooks/useApi';
import { useWebSocket } from '../../shared/hooks/useWebSocket';
import Toast, { ToastType } from '../components/Toast';
import ProfilePresetBar from '../components/ProfilePresetBar';
import AgentModelTable from '../components/AgentModelTable';
import {
  ModelProfile,
  fetchModelProfiles,
  fetchModelRegistry,
  batchUpdateAgentModels,
  ModelInfo,
  AgentInfo,
} from '../api/model-profile.api';

export default function ModelProfileSwitcher() {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);

  const {
    data: profiles,
    loading: profilesLoading,
    error: profilesError,
    refresh: refreshProfiles,
  } = useApiFn<ModelProfile[]>('model-profiles', fetchModelProfiles, {
    staleTime: 30_000,
  });

  const {
    data: registry,
    loading: registryLoading,
    error: registryError,
  } = useApiFn<{ models: ModelInfo[]; agents: AgentInfo[] }>(
    'model-registry',
    fetchModelRegistry,
    { staleTime: 120_000 }
  );

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'profile:changed') {
          refreshProfiles();
        }
      } catch {
        // ignore non-JSON
      }
    },
    [refreshProfiles]
  );

  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/brain/ws`;
  useWebSocket(wsUrl, { onMessage: handleWsMessage });

  const handleToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  const handleModelChange = useCallback((agentId: string, modelId: string) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(agentId, modelId);
      return next;
    });
  }, []);

  const activeProfile = profiles?.find((p) => p.is_active);

  // 过滤掉和服务端当前值一致的修改
  const effectiveChanges = useMemo(() => {
    if (!activeProfile || !registry) return new Map<string, string>();
    const filtered = new Map<string, string>();
    for (const [agentId, modelId] of pendingChanges) {
      const agent = registry.agents.find((a) => a.id === agentId);
      if (!agent) continue;
      let currentModel = '';
      if (agent.layer === 'brain') {
        const layerConfig = activeProfile.config[agentId as 'thalamus' | 'cortex'];
        currentModel = layerConfig?.model || '';
      } else {
        const modelMap = activeProfile.config.executor.model_map;
        if (modelMap && modelMap[agentId]) {
          for (const p of ['minimax', 'anthropic', 'openai']) {
            if (modelMap[agentId][p]) { currentModel = modelMap[agentId][p]; break; }
          }
        }
      }
      if (modelId !== currentModel) {
        filtered.set(agentId, modelId);
      }
    }
    return filtered;
  }, [pendingChanges, activeProfile, registry]);

  const hasChanges = effectiveChanges.size > 0;

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const updates = Array.from(effectiveChanges.entries()).map(([agent_id, model_id]) => ({
        agent_id,
        model_id,
      }));
      await batchUpdateAgentModels(updates);
      setPendingChanges(new Map());
      refreshProfiles();
      handleToast(`已保存 ${updates.length} 项修改`, 'success');
    } catch (err) {
      handleToast(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setPendingChanges(new Map());
  };

  const handlePresetSwitch = () => {
    setPendingChanges(new Map());
    refreshProfiles();
  };

  const loading = profilesLoading || registryLoading;
  const error = profilesError || registryError;

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-white/10 rounded w-48" />
          <div className="h-14 bg-white/5 rounded-xl border border-white/10" />
          <div className="h-64 bg-white/5 rounded-xl border border-white/10" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          加载失败: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-400" />
            模型配置
          </h1>
          {activeProfile && (
            <p className="text-sm text-gray-400 mt-1">
              预设: <span className="text-white font-medium">{activeProfile.name}</span>
            </p>
          )}
        </div>
        <button
          onClick={refreshProfiles}
          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-6">
        {/* 预设切换条 */}
        {profiles && (
          <ProfilePresetBar
            profiles={profiles}
            onSwitch={handlePresetSwitch}
            onToast={handleToast}
          />
        )}

        {/* Agent 模型配置表格 */}
        {registry && activeProfile && (
          <AgentModelTable
            agents={registry.agents}
            models={registry.models}
            profile={activeProfile}
            pendingChanges={pendingChanges}
            onModelChange={handleModelChange}
          />
        )}
      </div>

      {/* 浮动保存栏 */}
      {hasChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-gray-800 border border-white/20 shadow-2xl shadow-black/50">
            <span className="text-sm text-gray-300">
              {effectiveChanges.size} 项修改未保存
            </span>
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              放弃
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
