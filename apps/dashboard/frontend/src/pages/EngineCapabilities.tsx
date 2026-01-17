import { useEffect, useState } from 'react';
import { Cpu, GitBranch, Shield, Workflow, History, RefreshCw, CheckCircle2, Zap, Terminal } from 'lucide-react';
import { getEngineInfo, type EngineInfo } from '../api/engine.api';

export default function EngineCapabilities() {
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'skills' | 'hooks' | 'changelog'>('overview');

  const fetchEngineInfo = async () => {
    try {
      const data = await getEngineInfo();
      if (data.success && data.engine) {
        setEngineInfo(data.engine);
        setError(null);
      } else {
        setError(data.error || 'Failed to load engine info');
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEngineInfo();
  }, []);

  const getVersionBadge = (type: string) => {
    const styles: Record<string, string> = {
      major: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      minor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      patch: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    };
    return styles[type] || styles.patch;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部信息 */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 border border-cyan-500/20">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-cyan-500/20 rounded-xl">
            <Cpu className="w-8 h-8 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{engineInfo?.name}</h1>
            <p className="text-slate-400">{engineInfo?.description}</p>
          </div>
          <div className="ml-auto">
            <span className="px-4 py-2 bg-cyan-500/20 text-cyan-400 font-mono text-lg rounded-lg border border-cyan-500/30">
              v{engineInfo?.version}
            </span>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Workflow className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Skills</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{engineInfo?.skills.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Hooks</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{engineInfo?.hooks.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">更新记录</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{engineInfo?.changelog.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        {[
          { key: 'overview', label: '概览', icon: Zap },
          { key: 'skills', label: 'Skills', icon: Workflow },
          { key: 'hooks', label: 'Hooks', icon: Shield },
          { key: 'changelog', label: '更新记录', icon: History },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-cyan-600 dark:text-cyan-400 border-cyan-500'
                : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="mt-4">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Skills 预览 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Workflow className="w-5 h-5 text-purple-500" />
                Skills 能力
              </h3>
              <div className="space-y-3">
                {engineInfo?.skills.map((skill) => (
                  <div key={skill.name} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                    <Terminal className="w-5 h-5 text-cyan-500" />
                    <div className="flex-1">
                      <p className="font-mono text-cyan-600 dark:text-cyan-400">{skill.name}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{skill.description}</p>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  </div>
                ))}
              </div>
            </div>

            {/* 最近更新 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-blue-500" />
                最近更新
              </h3>
              <div className="space-y-3">
                {engineInfo?.changelog.slice(0, 3).map((entry) => (
                  <div key={entry.version} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-sm text-slate-900 dark:text-white">v{entry.version}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${getVersionBadge(entry.type)}`}>
                        {entry.type}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto">{entry.date}</span>
                    </div>
                    <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                      {entry.changes.map((change, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-cyan-500 mt-1">•</span>
                          {change}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="space-y-4">
            {engineInfo?.skills.map((skill) => (
              <div key={skill.name} className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                    <Terminal className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-mono font-semibold text-cyan-600 dark:text-cyan-400">{skill.name}</h3>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        skill.status === 'active'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                      }`}>
                        {skill.status === 'active' ? '已启用' : '未启用'}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mb-3">{skill.description}</p>
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <Zap className="w-4 h-4" />
                      <span>触发条件：{skill.trigger}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'hooks' && (
          <div className="space-y-4">
            {engineInfo?.hooks.map((hook) => (
              <div key={hook.name} className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl">
                    <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-mono font-semibold text-slate-900 dark:text-white">{hook.name}</h3>
                      <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
                        {hook.trigger}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mb-3">{hook.description}</p>
                    {hook.protectedPaths.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {hook.protectedPaths.map((path) => (
                          <span key={path} className="px-2 py-1 text-xs font-mono bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                            {path}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'changelog' && (
          <div className="space-y-4">
            {engineInfo?.changelog.map((entry) => (
              <div key={entry.version} className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3 mb-4">
                  <GitBranch className="w-5 h-5 text-cyan-500" />
                  <span className="text-xl font-mono font-bold text-slate-900 dark:text-white">v{entry.version}</span>
                  <span className={`px-3 py-1 text-sm rounded-full ${getVersionBadge(entry.type)}`}>
                    {entry.type}
                  </span>
                  <span className="text-sm text-slate-400 ml-auto">{entry.date}</span>
                </div>
                <ul className="space-y-2">
                  {entry.changes.map((change, i) => (
                    <li key={i} className="flex items-start gap-3 text-slate-600 dark:text-slate-300">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
