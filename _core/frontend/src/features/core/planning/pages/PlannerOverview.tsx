import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain,
  RefreshCw,
  XCircle,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  Server,
  Container,
  Plus,
  ExternalLink,
  GitBranch,
  Folder,
  Play,
  Users,
  Gauge,
} from 'lucide-react';
import {
  fetchCeceliaOverview,
  fetchCommandCenter,
  triggerCeceliaTask,
  CeceliaOverview,
  CeceliaRun,
  CommandCenterData,
} from '../api/planner.api';

export default function PlannerOverview() {
  const [cecelia, setCecelia] = useState<CeceliaOverview | null>(null);
  const [commandCenter, setCommandCenter] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const loadData = async () => {
    try {
      const [ceceliaData, ccData] = await Promise.all([
        fetchCeceliaOverview(20),
        fetchCommandCenter(),
      ]);
      setCecelia(ceceliaData);
      setCommandCenter(ccData);
      setError(null);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const handleTriggerTask = async (project: string, prd: string) => {
    setTriggering(true);
    try {
      const result = await triggerCeceliaTask({ project, prd_content: prd });
      if (result.success) {
        alert('任务已触发！');
        loadData();
      } else {
        alert(`触发失败: ${result.message}`);
      }
    } finally {
      setTriggering(false);
    }
  };

  if (loading && !commandCenter) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && !commandCenter) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">加载失败: {error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Command Center</h1>
            <p className="text-gray-400">
              VPS 状态 · Claude 会话 · 任务调度
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-sm text-gray-500">
              {lastUpdate.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建任务
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* VPS Stats */}
      {commandCenter && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              VPS 状态
            </h2>
            <div className="text-sm text-gray-400">
              运行时间: {commandCenter.vps.uptime}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* CPU */}
            <div className="bg-slate-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-gray-400">CPU</span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">
                {commandCenter.vps.cpu.usage.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                {commandCenter.vps.cpu.cores} 核 · 负载 {commandCenter.vps.cpu.load.map(l => l.toFixed(2)).join(' / ')}
              </div>
              <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    commandCenter.vps.cpu.usage > 80 ? 'bg-red-500' :
                    commandCenter.vps.cpu.usage > 50 ? 'bg-amber-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(commandCenter.vps.cpu.usage, 100)}%` }}
                />
              </div>
            </div>

            {/* Memory */}
            <div className="bg-slate-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-gray-400">内存</span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">
                {commandCenter.vps.memory.percent.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                {commandCenter.vps.memory.used_gb} / {commandCenter.vps.memory.total_gb} GB
              </div>
              <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    commandCenter.vps.memory.percent > 80 ? 'bg-red-500' :
                    commandCenter.vps.memory.percent > 50 ? 'bg-amber-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${commandCenter.vps.memory.percent}%` }}
                />
              </div>
            </div>

            {/* Disk */}
            <div className="bg-slate-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <HardDrive className="w-4 h-4 text-green-400" />
                <span className="text-sm text-gray-400">磁盘</span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">
                {commandCenter.vps.disk.percent.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                {commandCenter.vps.disk.used_gb} / {commandCenter.vps.disk.total_gb} GB
              </div>
              <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    commandCenter.vps.disk.percent > 80 ? 'bg-red-500' :
                    commandCenter.vps.disk.percent > 50 ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${commandCenter.vps.disk.percent}%` }}
                />
              </div>
            </div>

            {/* Capacity */}
            <div className="bg-slate-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Gauge className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-gray-400">并发容量</span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">
                {commandCenter.capacity.current_load} / {commandCenter.capacity.max_concurrent}
              </div>
              <div className="text-xs text-gray-500">
                剩余 {commandCenter.capacity.available_slots} 个槽位
              </div>
              <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    commandCenter.capacity.available_slots === 0 ? 'bg-red-500' :
                    commandCenter.capacity.available_slots === 1 ? 'bg-amber-500' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${(commandCenter.capacity.current_load / commandCenter.capacity.max_concurrent) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Claude Sessions & Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Running Claude Sessions */}
          {commandCenter && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                Claude 会话
                <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                  commandCenter.claude.active_sessions > 0
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-slate-700 text-gray-400'
                }`}>
                  {commandCenter.claude.active_sessions} 活跃
                </span>
              </h2>

              {commandCenter.claude.sessions.length > 0 ? (
                <div className="space-y-3">
                  {/* Group by repository */}
                  {Object.entries(commandCenter.claude.by_repository || {}).map(([repo, sessions]) => (
                    <div key={repo} className="space-y-2">
                      <Link
                        to={repo !== 'other' ? `/ops/panorama/repo/${repo}` : '#'}
                        className={`text-sm font-medium ${repo !== 'other' ? 'text-cyan-400 hover:underline' : 'text-gray-400'}`}
                      >
                        {repo === 'other' ? '其他' : repo}
                        <span className="ml-2 text-gray-500">({(sessions as any[]).length})</span>
                      </Link>
                      {(sessions as any[]).map((session: any) => (
                        <div
                          key={session.pid}
                          className={`p-4 rounded-lg border ${
                            session.status === 'active'
                              ? 'border-blue-500/30 bg-blue-500/5'
                              : 'border-slate-700 bg-slate-900/50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <Folder className="w-4 h-4 text-gray-500" />
                                <span className="font-medium text-white">{session.project}</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1 font-mono truncate max-w-md">
                                {session.cwd}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="text-xs text-gray-400">CPU</div>
                                <div className={`text-sm font-medium ${
                                  session.cpu > 50 ? 'text-amber-400' : 'text-white'
                                }`}>
                                  {session.cpu.toFixed(1)}%
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-gray-400">内存</div>
                                <div className="text-sm font-medium text-white">
                                  {session.memory.toFixed(1)}%
                                </div>
                              </div>
                              <div className={`px-2 py-1 rounded-full text-xs ${
                                session.status === 'active'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-slate-700 text-gray-400'
                              }`}>
                                {session.status === 'active' ? '活跃' : '空闲'}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-gray-500">
                            PID: {session.pid} · 运行: {session.runtime}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>没有运行中的 Claude 会话</p>
                  <p className="text-sm mt-1">VPS 空闲，可以开始新任务</p>
                </div>
              )}
            </div>
          )}

          {/* Cecelia Tasks */}
          {cecelia && cecelia.recent_runs.length > 0 && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-400" />
                Cecelia 任务
                {cecelia.running > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 animate-pulse">
                    {cecelia.running} 运行中
                  </span>
                )}
              </h2>
              <div className="space-y-3">
                {cecelia.recent_runs.slice(0, 8).map(run => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Docker & Quick Actions */}
        <div className="space-y-6">
          {/* Docker Containers */}
          {commandCenter && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Container className="w-5 h-5 text-blue-400" />
                Docker 容器
                <span className="ml-2 text-xs text-gray-400">
                  {commandCenter.docker.running} 运行中
                </span>
              </h2>

              {commandCenter.docker.containers.length > 0 ? (
                <div className="space-y-2">
                  {commandCenter.docker.containers.map((container) => (
                    <div
                      key={container.name}
                      className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                          container.status.startsWith('Up') ? 'bg-green-400' : 'bg-gray-500'
                        }`} />
                        <span className="text-sm text-white font-mono">{container.name}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {container.status.replace('Up ', '').split(' ')[0]}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <Container className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">无容器运行</p>
                </div>
              )}
            </div>
          )}

          {/* Task Summary */}
          {cecelia && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">任务统计</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">总任务</span>
                  <span className="text-white font-medium">{cecelia.total_runs}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-blue-400">运行中</span>
                  <span className="text-white font-medium">{cecelia.running}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-green-400">已完成</span>
                  <span className="text-white font-medium">{cecelia.completed}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-red-400">失败</span>
                  <span className="text-white font-medium">{cecelia.failed}</span>
                </div>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">导航</h2>
            <div className="space-y-2">
              <Link
                to="/ops/cecelia/runs"
                className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <Activity className="w-5 h-5 text-purple-400" />
                <span className="text-white">Cecelia Runs</span>
                <ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
              </Link>
              <Link
                to="/ops/panorama"
                className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <Server className="w-5 h-5 text-cyan-400" />
                <span className="text-white">Dev Panorama</span>
                <ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
              </Link>
              <Link
                to="/ops/cecelia"
                className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <Folder className="w-5 h-5 text-green-400" />
                <span className="text-white">Cecelia Overview</span>
                <ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
              </Link>
              <Link
                to="/ops/system"
                className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <Clock className="w-5 h-5 text-amber-400" />
                <span className="text-white">System Status</span>
                <ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
              </Link>
              <button
                onClick={() => setShowCreateModal(true)}
                className="w-full flex items-center gap-3 p-3 bg-cyan-600/20 border border-cyan-600/30 rounded-lg hover:bg-cyan-600/30 transition-colors"
              >
                <Plus className="w-5 h-5 text-cyan-400" />
                <span className="text-white">创建新任务</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleTriggerTask}
          triggering={triggering}
        />
      )}
    </div>
  );
}

// Components
function RunCard({ run }: { run: CeceliaRun }) {
  const statusConfig = {
    running: { color: 'text-blue-400', bg: 'bg-blue-500/20', icon: Activity, label: '运行中' },
    completed: { color: 'text-green-400', bg: 'bg-green-500/20', icon: CheckCircle2, label: '已完成' },
    failed: { color: 'text-red-400', bg: 'bg-red-500/20', icon: XCircle, label: '失败' },
    pending: { color: 'text-amber-400', bg: 'bg-amber-500/20', icon: Clock, label: '等待中' },
  };

  const config = statusConfig[run.status] || statusConfig.pending;
  const Icon = config.icon;
  const progress = run.total_checkpoints > 0
    ? Math.round((run.completed_checkpoints / run.total_checkpoints) * 100)
    : 0;

  return (
    <Link
      to={`/ops/cecelia/runs/${run.id}`}
      className={`block p-4 rounded-lg border transition-colors ${
        run.status === 'running'
          ? 'border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10'
          : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-gray-500" />
            <span className="font-medium text-white truncate">{run.project}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <GitBranch className="w-3 h-3 text-gray-500" />
            <span className="text-sm text-gray-400 truncate">{run.feature_branch}</span>
          </div>
          {run.current_step && (
            <div className="text-xs text-cyan-400 mt-2">
              {run.current_step}: {run.current_action || '处理中...'}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${config.bg} ${config.color}`}>
            <Icon className={`w-3 h-3 ${run.status === 'running' ? 'animate-spin' : ''}`} />
            {config.label}
          </div>
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              查看 PR
            </a>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>进度 {run.completed_checkpoints}/{run.total_checkpoints}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${run.status === 'failed' ? 'bg-red-500' : 'bg-cyan-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-2">
        {new Date(run.updated_at).toLocaleString('zh-CN')}
      </div>
    </Link>
  );
}

interface CreateTaskModalProps {
  onClose: () => void;
  onSubmit: (project: string, prd: string) => void;
  triggering: boolean;
}

function CreateTaskModal({ onClose, onSubmit, triggering }: CreateTaskModalProps) {
  const [project, setProject] = useState('');
  const [prd, setPrd] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (project && prd) {
      onSubmit(project, prd);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-lg mx-4">
        <h2 className="text-xl font-bold text-white mb-4">创建新任务</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">项目名称</label>
            <input
              type="text"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="例如: cecelia-workspace"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">PRD 内容</label>
            <textarea
              value={prd}
              onChange={(e) => setPrd(e.target.value)}
              placeholder="描述你要实现的功能..."
              rows={6}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!project || !prd || triggering}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50"
            >
              {triggering ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  触发中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  触发执行
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
