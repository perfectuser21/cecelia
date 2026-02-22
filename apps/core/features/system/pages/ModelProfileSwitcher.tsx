import { useState, useCallback } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { useApiFn } from '../../shared/hooks/useApi';
import { useWebSocket } from '../../shared/hooks/useWebSocket';
import Toast, { ToastType } from '../components/Toast';
import ProfilePresetBar from '../components/ProfilePresetBar';
import AgentModelTable from '../components/AgentModelTable';
import {
  ModelProfile,
  fetchModelProfiles,
  fetchModelRegistry,
  ModelInfo,
  AgentInfo,
} from '../api/model-profile.api';

export default function ModelProfileSwitcher() {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

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
        // ignore non-JSON messages
      }
    },
    [refreshProfiles]
  );

  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/brain/ws`;
  useWebSocket(wsUrl, { onMessage: handleWsMessage });

  const handleToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  const activeProfile = profiles?.find((p) => p.is_active);
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
            onSwitch={refreshProfiles}
            onToast={handleToast}
          />
        )}

        {/* Agent 模型配置表格 */}
        {registry && activeProfile && (
          <AgentModelTable
            agents={registry.agents}
            models={registry.models}
            profile={activeProfile}
            onUpdated={refreshProfiles}
            onToast={handleToast}
          />
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
