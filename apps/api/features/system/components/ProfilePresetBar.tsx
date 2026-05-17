import { useState } from 'react';
import { Check, Loader } from 'lucide-react';
import { ModelProfile, switchProfile } from '../api/model-profile.api';

interface ProfilePresetBarProps {
  profiles: ModelProfile[];
  onSwitch: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export default function ProfilePresetBar({ profiles, onSwitch, onToast }: ProfilePresetBarProps) {
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSwitch = async (profileId: string) => {
    const target = profiles.find((p) => p.id === profileId);
    if (!target || target.is_active) return;

    if (!window.confirm(`切换到「${target.name}」预设？\n\n这将重置所有 Agent 的模型配置为预设值。`)) {
      return;
    }

    setSwitching(profileId);
    try {
      await switchProfile(profileId);
      onSwitch();
      onToast(`已切换到「${target.name}」`, 'success');
    } catch (err) {
      onToast(`切换失败: ${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
      <span className="text-sm text-gray-400 mr-1">快速预设</span>
      {profiles.map((profile) => (
        <button
          key={profile.id}
          onClick={() => handleSwitch(profile.id)}
          disabled={switching !== null}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
            profile.is_active
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300 cursor-default'
              : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20'
          } disabled:opacity-50`}
        >
          {switching === profile.id ? (
            <Loader className="w-3.5 h-3.5 animate-spin" />
          ) : profile.is_active ? (
            <Check className="w-3.5 h-3.5" />
          ) : null}
          {profile.name}
        </button>
      ))}
    </div>
  );
}
