import { useEffect, useState } from 'react';
import {
  RefreshCw,
  XCircle,
  FolderGit2,
  FileText,
  GitBranch,
  Play,
  ChevronRight,
  ChevronDown,
  Layers,
  Target,
  Clock,
  ArrowRight,
  Zap,
  Map,
  Package,
  Code2,
} from 'lucide-react';
import axios from 'axios';

interface Feature {
  id: string;
  name: string;
  version: string;
  path: string;
  pages_count: number;
  source: 'code' | 'markdown';
  tasks?: ParsedTask[];
}

interface PRD {
  repo: string;
  file: string;
  title: string;
  path: string;
  feature_hint: string;
  parsed?: ParsedTask[];
  parsing?: boolean;
}

interface Repository {
  name: string;
  path: string;
  branch: string;
  status: 'clean' | 'modified';
  feature_count: number;
  features: Feature[];
  prd_count: number;
  has_session: boolean;
}

interface ParsedTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  estimated_time: string;
  dependencies: string[];
  tags: string[];
}

interface RoadmapData {
  timestamp: string;
  summary: {
    total_repos: number;
    total_features: number;
    pending_prds: number;
    active_sessions: number;
  };
  repositories: Repository[];
  pending_work: PRD[];
  capacity: {
    max: number;
    used: number;
    available: number;
  };
}

export default function RoadmapView() {
  const [data, setData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const [selectedTasks, setSelectedTasks] = useState<ParsedTask[]>([]);

  const loadData = async () => {
    try {
      const response = await axios.get('/api/panorama/planner');
      if (response.data.success) {
        setData(response.data.data);
        setError(null);
        // Expand repos with features by default
        const withFeatures = response.data.data.repositories
          .filter((r: Repository) => r.feature_count > 0)
          .map((r: Repository) => r.name);
        setExpandedRepos(new Set(withFeatures));
      } else {
        setError(response.data.error);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleRepo = (name: string) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleFeature = (key: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // 获取 Feature 关联的 PRDs
  const getFeaturePRDs = (repo: Repository, feature: Feature): PRD[] => {
    if (!data) return [];
    return data.pending_work.filter(
      (prd) => prd.repo === repo.name && prd.feature_hint.includes(feature.id)
    );
  };

  // 解析 PRD
  const parsePRD = async (prd: PRD) => {
    // Mark as parsing
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pending_work: prev.pending_work.map((p) => {
          if (p.path !== prd.path) return p;
          return { ...p, parsing: true };
        }),
      };
    });

    try {
      const response = await axios.post('/api/panorama/roadmap/parse-prd', {
        prd_path: prd.path,
      });

      if (response.data.success) {
        const tasks = response.data.data.tasks || [];
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pending_work: prev.pending_work.map((p) => {
              if (p.path !== prd.path) return p;
              return { ...p, parsing: false, parsed: tasks };
            }),
          };
        });
      }
    } catch (e) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pending_work: prev.pending_work.map((p) => {
            if (p.path !== prd.path) return p;
            return { ...p, parsing: false };
          }),
        };
      });
    }
  };

  const addTaskToSelection = (task: ParsedTask) => {
    setSelectedTasks((prev) => {
      if (prev.find((t) => t.id === task.id)) {
        return prev.filter((t) => t.id !== task.id);
      }
      return [...prev, task];
    });
  };

  const [executing, setExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<string | null>(null);

  // 执行 PRD
  const executePRD = async (prdPath: string) => {
    setExecuting(true);
    setExecutionStatus('启动中...');
    try {
      const response = await axios.post('/api/panorama/execute', {
        prd_path: prdPath,
        priority: 'P1',
      });

      if (response.data.success) {
        setExecutionStatus(`任务 ${response.data.data.task_id} 已启动`);
        // 刷新数据
        setTimeout(() => loadData(), 2000);
      } else {
        setExecutionStatus(`启动失败: ${response.data.error}`);
      }
    } catch (e: any) {
      setExecutionStatus(`错误: ${e.message}`);
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">加载失败: {error}</p>
        <button onClick={loadData} className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg">
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl">
            <Map className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Roadmap</h1>
            <p className="text-gray-400">
              {data.summary.total_repos} Projects · {data.summary.total_features} Features ·{' '}
              {data.summary.pending_prds} PRDs
            </p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Execution Status */}
      {executionStatus && (
        <div className={`p-3 rounded-lg flex items-center gap-2 ${
          executionStatus.includes('错误') || executionStatus.includes('失败')
            ? 'bg-red-500/20 text-red-400'
            : executionStatus.includes('启动')
            ? 'bg-green-500/20 text-green-400'
            : 'bg-blue-500/20 text-blue-400'
        }`}>
          {executing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {executionStatus}
          <button
            onClick={() => setExecutionStatus(null)}
            className="ml-auto text-gray-400 hover:text-white"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<FolderGit2 className="w-5 h-5" />}
          label="Projects"
          value={data.summary.total_repos}
          color="blue"
        />
        <SummaryCard
          icon={<Package className="w-5 h-5" />}
          label="Features"
          value={data.summary.total_features}
          color="purple"
        />
        <SummaryCard
          icon={<FileText className="w-5 h-5" />}
          label="PRDs"
          value={data.summary.pending_prds}
          color="amber"
        />
        <SummaryCard
          icon={<Layers className="w-5 h-5" />}
          label="容量"
          value={`${data.capacity.used}/${data.capacity.max}`}
          color={data.capacity.available > 0 ? 'green' : 'red'}
          subtitle={`剩余 ${data.capacity.available}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Project → Feature → Task 层级 */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Code2 className="w-5 h-5 text-blue-400" />
            Project → Feature → Task
          </h2>

          <div className="space-y-3">
            {data.repositories
              .filter((r) => r.feature_count > 0)
              .map((repo) => (
                <div
                  key={repo.name}
                  className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden"
                >
                  {/* Project Header */}
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-700/50"
                    onClick={() => toggleRepo(repo.name)}
                  >
                    <div className="flex items-center gap-3">
                      {expandedRepos.has(repo.name) ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                      <FolderGit2 className="w-5 h-5 text-blue-400" />
                      <div>
                        <span className="font-medium text-white">{repo.name}</span>
                        <span className="ml-2 text-sm text-gray-500">(Project)</span>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <GitBranch className="w-3 h-3" />
                          {repo.branch}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 text-sm bg-purple-500/20 text-purple-400 rounded-lg">
                        {repo.feature_count} Features
                      </span>
                      {repo.has_session && (
                        <span className="px-2 py-1 text-sm bg-green-500/20 text-green-400 rounded-lg">
                          运行中
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Features List */}
                  {expandedRepos.has(repo.name) && (
                    <div className="border-t border-slate-700 p-4 space-y-2">
                      {repo.features.map((feature) => {
                        const featureKey = `${repo.name}:${feature.id}`;
                        const featurePRDs = getFeaturePRDs(repo, feature);
                        const isExpanded = expandedFeatures.has(featureKey);

                        return (
                          <div key={feature.id} className="space-y-2">
                            {/* Feature Header */}
                            <div
                              className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg cursor-pointer hover:bg-slate-900"
                              onClick={() => toggleFeature(featureKey)}
                            >
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-gray-500" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-gray-500" />
                                )}
                                <Package className="w-4 h-4 text-purple-400" />
                                <div>
                                  <span className="text-white text-sm font-medium">
                                    {feature.name}
                                  </span>
                                  <span className="ml-2 text-xs text-gray-500">
                                    v{feature.version}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-500">{feature.pages_count} pages</span>
                                {featurePRDs.length > 0 && (
                                  <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">
                                    {featurePRDs.length} PRD
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Feature PRDs & Tasks */}
                            {isExpanded && (
                              <div className="ml-8 space-y-2">
                                {featurePRDs.length > 0 ? (
                                  featurePRDs.map((prd) => (
                                    <div key={prd.path} className="space-y-2">
                                      {/* PRD */}
                                      <div className="flex items-center justify-between p-2 bg-slate-800 rounded-lg border border-slate-700">
                                        <div className="flex items-center gap-2">
                                          <FileText className="w-4 h-4 text-amber-400" />
                                          <span className="text-sm text-white">{prd.title}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => parsePRD(prd)}
                                            disabled={prd.parsing}
                                            className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                                              prd.parsing
                                                ? 'bg-slate-700 text-gray-400'
                                                : prd.parsed
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                                            }`}
                                          >
                                            {prd.parsing ? (
                                              <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : prd.parsed ? (
                                              <>
                                                <Layers className="w-3 h-3" />
                                                {prd.parsed.length} Tasks
                                              </>
                                            ) : (
                                              <>
                                                <Zap className="w-3 h-3" />
                                                解析
                                              </>
                                            )}
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              executePRD(prd.path);
                                            }}
                                            disabled={executing || data?.capacity.available === 0}
                                            className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                                              executing || data?.capacity.available === 0
                                                ? 'bg-slate-700 text-gray-500'
                                                : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                            }`}
                                            title={data?.capacity.available === 0 ? '无可用槽位' : '执行此 PRD'}
                                          >
                                            <Play className="w-3 h-3" />
                                            执行
                                          </button>
                                        </div>
                                      </div>

                                      {/* Tasks */}
                                      {prd.parsed && prd.parsed.length > 0 && (
                                        <div className="ml-4 space-y-1">
                                          {prd.parsed.map((task) => {
                                            const isSelected = selectedTasks.find(
                                              (t) => t.id === task.id
                                            );
                                            return (
                                              <div
                                                key={task.id}
                                                onClick={() => addTaskToSelection(task)}
                                                className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${
                                                  isSelected
                                                    ? 'bg-cyan-500/20 border border-cyan-500'
                                                    : 'bg-slate-900/30 border border-transparent hover:border-slate-600'
                                                }`}
                                              >
                                                <Target className="w-3 h-3 text-gray-500" />
                                                <span
                                                  className={`px-1 py-0.5 text-xs rounded ${
                                                    task.priority === 'P0'
                                                      ? 'bg-red-500/20 text-red-400'
                                                      : task.priority === 'P1'
                                                      ? 'bg-amber-500/20 text-amber-400'
                                                      : 'bg-blue-500/20 text-blue-400'
                                                  }`}
                                                >
                                                  {task.priority}
                                                </span>
                                                <span className="text-sm text-white flex-1">
                                                  {task.title}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                  {task.estimated_time}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-sm text-gray-500 p-2">
                                    该 Feature 暂无 PRD
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
          </div>

          {/* 未关联 Feature 的 PRDs */}
          {data.pending_work.filter((p) => !p.feature_hint).length > 0 && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                未关联 Feature 的 PRDs
              </h3>
              <div className="space-y-2">
                {data.pending_work
                  .filter((p) => !p.feature_hint)
                  .map((prd) => (
                    <div
                      key={prd.path}
                      className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg"
                    >
                      <div>
                        <span className="text-sm text-white">{prd.title}</span>
                        <span className="ml-2 text-xs text-gray-500">{prd.repo}</span>
                      </div>
                      <button
                        onClick={() => parsePRD(prd)}
                        disabled={prd.parsing}
                        className="px-2 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded"
                      >
                        解析
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Selected Tasks Queue */}
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-cyan-400" />
              待执行 Tasks
              <span className="ml-auto text-sm text-gray-400">{selectedTasks.length} 个</span>
            </h3>

            {selectedTasks.length > 0 ? (
              <div className="space-y-2 mb-4">
                {selectedTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 p-2 bg-slate-900/50 rounded-lg"
                  >
                    <span className="text-gray-500 text-sm w-5">{index + 1}.</span>
                    <span
                      className={`px-1.5 py-0.5 text-xs rounded ${
                        task.priority === 'P0'
                          ? 'bg-red-500/20 text-red-400'
                          : task.priority === 'P1'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {task.priority}
                    </span>
                    <span className="text-white text-sm flex-1 truncate">{task.title}</span>
                    <button
                      onClick={() => addTaskToSelection(task)}
                      className="text-gray-500 hover:text-red-400"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500">
                <Target className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">点击左侧 Task 添加到队列</p>
              </div>
            )}

            <button
              disabled={selectedTasks.length === 0}
              className={`w-full py-2 rounded-lg flex items-center justify-center gap-2 ${
                selectedTasks.length === 0
                  ? 'bg-slate-700 text-gray-500'
                  : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600'
              }`}
            >
              <Play className="w-4 h-4" />
              执行选中的 Tasks
            </button>
          </div>

          {/* Quick Stats */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-lg font-semibold text-white mb-4">层级统计</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <FolderGit2 className="w-4 h-4" />
                  Projects
                </span>
                <span className="text-white font-medium">{data.summary.total_repos}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Features
                </span>
                <span className="text-white font-medium">{data.summary.total_features}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  PRDs
                </span>
                <span className="text-white font-medium">{data.summary.pending_prds}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Selected Tasks
                </span>
                <span className="text-cyan-400 font-medium">{selectedTasks.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  subtitle?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'from-blue-500 to-blue-600',
    purple: 'from-purple-500 to-purple-600',
    amber: 'from-amber-500 to-amber-600',
    green: 'from-green-500 to-green-600',
    red: 'from-red-500 to-red-600',
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 bg-gradient-to-br ${colorClasses[color]} rounded-xl flex items-center justify-center text-white`}
        >
          {icon}
        </div>
        <div>
          <div className="text-xs text-gray-400">{label}</div>
          <div className="text-xl font-bold text-white">{value}</div>
          {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}
