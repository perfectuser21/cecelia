import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain,
  RefreshCw,
  XCircle,
  Activity,
  Clock,
  CheckCircle2,
  Cpu,
  HardDrive,
  Server,
  FolderGit2,
  FileText,
  GitBranch,
  Play,
  Pause,
  Calendar,
  TrendingUp,
  Users,
  Layers,
  ArrowRight,
} from 'lucide-react';
import axios from 'axios';

interface Repository {
  name: string;
  path: string;
  branch: string;
  status: 'clean' | 'modified';
  last_commit: string;
  last_commit_time: string;
  has_session: boolean;
  session_cpu: number;
  prd_count: number;
  feature_branches: number;
}

interface PendingWork {
  repo: string;
  file: string;
  path: string;
  title: string;
}

interface ActiveWork {
  pid: string;
  project: string;
  cwd: string;
  cpu: number;
  memory: number;
  runtime: string;
  status: 'active' | 'idle';
}

interface PlannerData {
  timestamp: string;
  summary: {
    total_repos: number;
    repos_with_sessions: number;
    pending_prds: number;
    active_sessions: number;
    active_working: number;
    max_concurrent: number;
    available_slots: number;
  };
  repositories: Repository[];
  pending_work: PendingWork[];
  active_work: ActiveWork[];
  capacity: {
    max: number;
    used: number;
    available: number;
    can_schedule: number;
  };
}

export default function PlanningDashboard() {
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadData = async () => {
    try {
      const response = await axios.get('/api/panorama/planner');
      if (response.data.success) {
        setData(response.data.data);
        setError(null);
        setLastUpdate(new Date());
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
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
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
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Calendar className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">工作规划</h1>
            <p className="text-gray-400">
              {data.summary.total_repos} 个仓库 · {data.summary.pending_prds} 个待处理 PRD · {data.summary.active_sessions} 个活跃会话
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-sm text-gray-500">{lastUpdate.toLocaleTimeString('zh-CN')}</span>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard
          icon={<FolderGit2 className="w-5 h-5" />}
          label="仓库"
          value={data.summary.total_repos}
          color="blue"
        />
        <SummaryCard
          icon={<FileText className="w-5 h-5" />}
          label="待处理 PRD"
          value={data.summary.pending_prds}
          color="amber"
        />
        <SummaryCard
          icon={<Activity className="w-5 h-5" />}
          label="活跃会话"
          value={`${data.summary.active_working}/${data.summary.active_sessions}`}
          color="green"
          subtitle="工作中/总数"
        />
        <SummaryCard
          icon={<Layers className="w-5 h-5" />}
          label="容量"
          value={`${data.capacity.used}/${data.capacity.max}`}
          color={data.capacity.available === 0 ? 'red' : 'cyan'}
          subtitle={data.capacity.available === 0 ? '已满载' : `剩余 ${data.capacity.available}`}
        />
        <SummaryCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="可调度"
          value={data.capacity.can_schedule}
          color={data.capacity.can_schedule > 0 ? 'green' : 'gray'}
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Active Work */}
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-400" />
              正在运行
              <span className="ml-auto text-sm text-gray-400">
                {data.active_work.filter(w => w.status === 'active').length} 活跃
              </span>
            </h2>

            {data.active_work.length > 0 ? (
              <div className="space-y-3">
                {data.active_work.map((work) => (
                  <div
                    key={work.pid}
                    className={`p-4 rounded-lg border ${
                      work.status === 'active'
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-slate-700 bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {work.status === 'active' ? (
                          <Play className="w-4 h-4 text-green-400" />
                        ) : (
                          <Pause className="w-4 h-4 text-gray-400" />
                        )}
                        <span className="font-medium text-white">{work.project}</span>
                      </div>
                      <span className={`text-sm ${work.status === 'active' ? 'text-green-400' : 'text-gray-400'}`}>
                        CPU: {work.cpu}%
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      PID: {work.pid} · 运行: {work.runtime}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Pause className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>没有运行中的任务</p>
                <p className="text-sm mt-1">可以开始新的工作</p>
              </div>
            )}
          </div>

          {/* Capacity Gauge */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">容量规划</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">并发容量</span>
                  <span className="text-white">{data.capacity.used} / {data.capacity.max}</span>
                </div>
                <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
                  {[...Array(data.capacity.max)].map((_, i) => (
                    <div
                      key={i}
                      className={`inline-block h-full ${
                        i < data.capacity.used
                          ? i < data.active_work.filter(w => w.status === 'active').length
                            ? 'bg-green-500'
                            : 'bg-amber-500'
                          : 'bg-slate-600'
                      }`}
                      style={{ width: `${100 / data.capacity.max}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs mt-2">
                  <span className="text-green-400">● 活跃工作</span>
                  <span className="text-amber-400">● 空闲会话</span>
                  <span className="text-gray-400">● 可用</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Middle: Repositories */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-blue-400" />
            仓库状态
          </h2>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {data.repositories.map((repo) => (
              <Link
                key={repo.name}
                to={`/ops/panorama/repo/${repo.name}`}
                className="block p-4 rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{repo.name}</span>
                      {repo.has_session && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
                          运行中
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                      <GitBranch className="w-3 h-3" />
                      {repo.branch}
                      <span className={`w-2 h-2 rounded-full ${
                        repo.status === 'modified' ? 'bg-amber-400' : 'bg-green-400'
                      }`} />
                    </div>
                  </div>
                  <div className="text-right">
                    {repo.prd_count > 0 && (
                      <div className="text-sm text-amber-400">
                        {repo.prd_count} PRD
                      </div>
                    )}
                    {repo.feature_branches > 0 && (
                      <div className="text-xs text-gray-500">
                        {repo.feature_branches} 分支
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2 truncate">
                  {repo.last_commit}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {repo.last_commit_time}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Right: Pending PRDs */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            待处理 PRD
            <span className="ml-auto text-sm text-gray-400">{data.pending_work.length} 个</span>
          </h2>

          {data.pending_work.length > 0 ? (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {data.pending_work.map((prd, index) => (
                <div
                  key={`${prd.repo}-${prd.file}-${index}`}
                  className="p-4 rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">{prd.title}</div>
                      <div className="text-sm text-gray-400 mt-1">{prd.repo}</div>
                      <div className="text-xs text-gray-500 mt-1 font-mono truncate">{prd.file}</div>
                    </div>
                    {data.capacity.can_schedule > 0 && (
                      <button
                        className="ml-2 p-2 text-cyan-400 hover:bg-cyan-500/20 rounded-lg transition-colors"
                        title="调度执行"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>没有待处理的 PRD</p>
              <p className="text-sm mt-1">所有工作已完成</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">快速导航</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/ops/planner"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Command Center
          </Link>
          <Link
            to="/ops/cecelia/runs"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Cecelia Runs
          </Link>
          <Link
            to="/ops/panorama"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Dev Panorama
          </Link>
          <Link
            to="/ops/system"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            System Status
          </Link>
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
    amber: 'from-amber-500 to-amber-600',
    green: 'from-green-500 to-green-600',
    red: 'from-red-500 to-red-600',
    cyan: 'from-cyan-500 to-cyan-600',
    gray: 'from-gray-500 to-gray-600',
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 bg-gradient-to-br ${colorClasses[color]} rounded-xl flex items-center justify-center text-white`}>
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
