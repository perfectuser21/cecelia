import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Workflow,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
  Clock,
  Activity,
  ExternalLink,
  Zap,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Database,
  LogIn,
  Bot,
  Cog,
  FolderOpen,
  Timer,
  BarChart3,
  Cloud,
  Server,
} from 'lucide-react';
import {
  n8nWorkflowsApi,
  N8nOverview,
  N8nWorkflowWithStats,
  N8nInstance,
  InstancesStatus,
} from '../api/n8n-workflows.api';

// 工作流分类配置
const WORKFLOW_CATEGORIES = [
  { key: 'login', label: '登录管理', icon: LogIn, color: 'from-blue-500 to-cyan-500', keywords: ['登录', 'login', 'VNC'] },
  { key: 'scrape', label: '数据采集', icon: Database, color: 'from-green-500 to-emerald-500', keywords: ['爬取', '数据', 'scrape', 'scraping'] },
  { key: 'claude', label: 'Claude 相关', icon: Bot, color: 'from-purple-500 to-violet-500', keywords: ['claude', 'Claude'] },
  { key: 'maintenance', label: '运维任务', icon: Cog, color: 'from-orange-500 to-amber-500', keywords: ['maintenance', 'nightly', '维护', 'scheduler'] },
  { key: 'other', label: '其他', icon: FolderOpen, color: 'from-gray-500 to-slate-500', keywords: [] },
];

export default function N8nWorkflows() {
  const navigate = useNavigate();

  // Tab 状态
  const [activeInstance, setActiveInstance] = useState<N8nInstance>('local');
  const [instancesStatus, setInstancesStatus] = useState<InstancesStatus | null>(null);

  const [overview, setOverview] = useState<N8nOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['all']));

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 获取实例状态
  useEffect(() => {
    n8nWorkflowsApi.getInstancesStatus()
      .then(setInstancesStatus)
      .catch(() => {
        setInstancesStatus({
          cloud: { available: true, name: 'Cloud' },
          local: { available: false, name: 'Local' },
        });
      });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const data = await n8nWorkflowsApi.getOverviewByInstance(activeInstance);
      setOverview(data);
      setLastUpdate(new Date().toLocaleTimeString('zh-CN'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  }, [activeInstance]);

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  // 切换实例时重新获取数据
  useEffect(() => {
    setLoading(true);
    setOverview(null);
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // 点击工作流卡片跳转详情
  const handleWorkflowClick = (workflowId: string) => {
    navigate(`/n8n/workflows/${activeInstance}/${workflowId}`);
  };

  // 工作流分类
  const categorizeWorkflow = (workflow: N8nWorkflowWithStats): string => {
    const name = workflow.name.toLowerCase();
    for (const cat of WORKFLOW_CATEGORIES) {
      if (cat.key === 'other') continue;
      if (cat.keywords.some(kw => name.includes(kw.toLowerCase()))) {
        return cat.key;
      }
    }
    return 'other';
  };

  // 分类后的工作流
  const categorizedWorkflows = useMemo(() => {
    if (!overview?.workflows.workflows) return {};

    const result: Record<string, N8nWorkflowWithStats[]> = {};
    WORKFLOW_CATEGORIES.forEach(cat => {
      result[cat.key] = [];
    });

    overview.workflows.workflows.forEach(wf => {
      const category = categorizeWorkflow(wf);
      result[category].push(wf);
    });

    return result;
  }, [overview?.workflows.workflows]);

  // 每个分类的统计
  const categoryStats = useMemo(() => {
    const stats: Record<string, { total: number; active: number; running: number; successRate: number }> = {};

    WORKFLOW_CATEGORIES.forEach(cat => {
      const workflows = categorizedWorkflows[cat.key] || [];
      const active = workflows.filter(w => w.active).length;
      const running = workflows.reduce((sum, w) => sum + (w.runStats?.runningCount || 0), 0);

      // 计算平均成功率
      const workflowsWithStats = workflows.filter(w => w.runStats?.recentStats.total > 0);
      const avgSuccessRate = workflowsWithStats.length > 0
        ? Math.round(workflowsWithStats.reduce((sum, w) => sum + w.runStats.recentStats.successRate, 0) / workflowsWithStats.length)
        : 0;

      stats[cat.key] = {
        total: workflows.length,
        active,
        running,
        successRate: avgSuccessRate,
      };
    });

    return stats;
  }, [categorizedWorkflows]);

  // 过滤后的执行记录
  const filteredExecutions = useMemo(() => {
    const executions = overview?.recentExecutions.executions || [];
    if (statusFilter === 'all') return executions;
    if (statusFilter === 'error') return executions.filter(e => e.status === 'error' || e.status === 'crashed');
    return executions.filter(e => e.status === statusFilter);
  }, [overview?.recentExecutions.executions, statusFilter]);

  // 分页后的执行记录
  const paginatedExecutions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredExecutions.slice(start, start + pageSize);
  }, [filteredExecutions, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredExecutions.length / pageSize);

  // 重置分页
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, pageSize]);

  // 切换分类展开/折叠
  const toggleCategory = (key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 展开/折叠全部
  const toggleAllCategories = () => {
    if (expandedCategories.size === WORKFLOW_CATEGORIES.length) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(WORKFLOW_CATEGORIES.map(c => c.key)));
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'success':
        return 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
      case 'error':
      case 'crashed':
        return 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400';
      case 'running':
      case 'waiting':
        return 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'error':
      case 'crashed':
        return <XCircle className="w-4 h-4" />;
      case 'running':
      case 'waiting':
        return <Activity className="w-4 h-4 animate-pulse" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'success':
        return '成功';
      case 'error':
        return '失败';
      case 'crashed':
        return '崩溃';
      case 'running':
        return '运行中';
      case 'waiting':
        return '等待中';
      default:
        return status;
    }
  };

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return formatTime(dateStr);
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return '-';
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const duration = Math.round((endTime - startTime) / 1000);

    if (duration < 60) return `${duration}秒`;
    if (duration < 3600) return `${Math.floor(duration / 60)}分${duration % 60}秒`;
    return `${Math.floor(duration / 3600)}时${Math.floor((duration % 3600) / 60)}分`;
  };

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 magnetic-btn"
        >
          重试
        </button>
      </div>
    );
  }

  const workflowStats = overview?.workflows;
  const executionStats = overview?.recentExecutions;

  // 当前正在运行的工作流总数
  const totalRunning = overview?.workflows.workflows.reduce(
    (sum, w) => sum + (w.runStats?.runningCount || 0),
    0
  ) || 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/25">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">N8n 工作流</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              自动化工作流监控 · 更新于 {lastUpdate}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={activeInstance === 'local' ? (import.meta.env.VITE_N8N_LOCAL_URL || 'http://localhost:5679') : (import.meta.env.VITE_N8N_CLOUD_URL || '#')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition"
          >
            <ExternalLink className="w-4 h-4" />
            打开 n8n
          </a>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 shadow-lg shadow-blue-500/25 magnetic-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Instance Tabs */}
      <div className="flex bg-gray-100 dark:bg-slate-700 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveInstance('local')}
          disabled={!instancesStatus?.local.available}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeInstance === 'local'
              ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          } ${!instancesStatus?.local.available ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Server className="w-4 h-4" />
          Local
          {!instancesStatus?.local.available && <span className="text-xs text-red-500">(未配置)</span>}
        </button>
        <button
          onClick={() => setActiveInstance('cloud')}
          disabled={!instancesStatus?.cloud.available}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeInstance === 'cloud'
              ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          } ${!instancesStatus?.cloud.available ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Cloud className="w-4 h-4" />
          Cloud
          {!instancesStatus?.cloud.available && <span className="text-xs text-red-500">(未配置)</span>}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 tilt-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Workflow className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">工作流</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {workflowStats?.totalWorkflows || 0}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 tilt-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/25">
              <Play className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">已启用</div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {workflowStats?.activeWorkflows || 0}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 tilt-card">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ${
              totalRunning > 0
                ? 'bg-gradient-to-br from-blue-500 to-cyan-600 shadow-blue-500/25'
                : 'bg-gradient-to-br from-gray-400 to-gray-500 shadow-gray-500/25'
            }`}>
              <Activity className={`w-4 h-4 text-white ${totalRunning > 0 ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">运行中</div>
              <div className={`text-xl font-bold ${
                totalRunning > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
              }`}>
                {totalRunning}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 tilt-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">成功率</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {executionStats?.successRate || 0}%
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 tilt-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/25">
              <CheckCircle2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">成功</div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {executionStats?.success || 0}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 tilt-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/25">
              <XCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">失败</div>
              <div className="text-xl font-bold text-red-600 dark:text-red-400">
                {executionStats?.error || 0}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workflows by Category - Collapsible Panels */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Workflow className="w-5 h-5" />
            工作流分组
          </h2>
          <button
            onClick={toggleAllCategories}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {expandedCategories.size === WORKFLOW_CATEGORIES.length ? '全部折叠' : '全部展开'}
          </button>
        </div>

        {WORKFLOW_CATEGORIES.filter(cat => (categorizedWorkflows[cat.key]?.length || 0) > 0).map((cat) => {
          const Icon = cat.icon;
          const workflows = categorizedWorkflows[cat.key] || [];
          const stats = categoryStats[cat.key];
          const isExpanded = expandedCategories.has(cat.key);

          return (
            <div
              key={cat.key}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden"
            >
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(cat.key)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 bg-gradient-to-br ${cat.color} rounded-xl flex items-center justify-center shadow-lg`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      {cat.label}
                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                        ({stats.total} 个)
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Play className="w-3 h-3 text-green-500" />
                        {stats.active} 启用
                      </span>
                      {stats.running > 0 && (
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                          <Activity className="w-3 h-3 animate-pulse" />
                          {stats.running} 运行中
                        </span>
                      )}
                      {stats.successRate > 0 && (
                        <span className="flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" />
                          {stats.successRate}% 成功率
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {/* Workflow Cards */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {workflows.map((workflow) => (
                      <WorkflowCard
                        key={workflow.id}
                        workflow={workflow}
                        formatRelativeTime={formatRelativeTime}
                        getStatusColor={getStatusColor}
                        getStatusIcon={getStatusIcon}
                        getStatusLabel={getStatusLabel}
                        onClick={() => handleWorkflowClick(workflow.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Executions with Pagination */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">执行历史</h2>
              <span className="text-sm text-gray-400 dark:text-gray-500">
                (共 {filteredExecutions.length} 条)
              </span>
            </div>
            <div className="flex items-center gap-4">
              {/* Page size selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">每页</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <span className="text-sm text-gray-500 dark:text-gray-400">条</span>
              </div>
              {/* Status filter */}
              <div className="flex bg-gray-100 dark:bg-slate-700 rounded-xl p-1">
                {[
                  { value: 'all', label: '全部' },
                  { value: 'success', label: '成功' },
                  { value: 'error', label: '失败' },
                  { value: 'running', label: '运行中' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                      statusFilter === opt.value
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  工作流
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  触发方式
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  开始时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  耗时
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {paginatedExecutions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    暂无执行记录
                  </td>
                </tr>
              ) : (
                paginatedExecutions.map((execution) => (
                  <tr key={execution.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <Workflow className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {execution.workflowName || execution.workflowId}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 w-fit ${getStatusColor(execution.status)}`}
                      >
                        {getStatusIcon(execution.status)}
                        {getStatusLabel(execution.status)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {execution.mode}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatTime(execution.startedAt)}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">
                      {formatDuration(execution.startedAt, execution.stoppedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700 flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredExecutions.length)} 条，共 {filteredExecutions.length} 条
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-gray-600 dark:text-gray-400"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition ${
                        currentPage === pageNum
                          ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/25'
                          : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-gray-600 dark:text-gray-400"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 工作流卡片组件
interface WorkflowCardProps {
  workflow: N8nWorkflowWithStats;
  formatRelativeTime: (date: string) => string;
  getStatusColor: (status: string) => string;
  getStatusIcon: (status: string) => React.ReactNode;
  getStatusLabel: (status: string) => string;
  onClick?: () => void;
}

function WorkflowCard({
  workflow,
  formatRelativeTime,
  getStatusColor,
  getStatusIcon,
  getStatusLabel,
  onClick,
}: WorkflowCardProps) {
  const { runStats } = workflow;
  const isRunning = runStats?.runningCount > 0;
  const lastExec = runStats?.lastExecution;
  const recentStats = runStats?.recentStats;

  return (
    <div
      onClick={onClick}
      className={`border rounded-xl p-4 transition-all cursor-pointer ${
        isRunning
          ? 'border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/20 shadow-md shadow-blue-500/10'
          : 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 hover:shadow-md dark:hover:shadow-slate-900/50 hover:border-gray-300 dark:hover:border-slate-500'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-medium text-gray-900 dark:text-white truncate flex-1 text-sm" title={workflow.name}>
          {workflow.name}
        </h3>
        <div className="flex items-center gap-1.5 ml-2">
          {isRunning && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <Activity className="w-3 h-3 animate-pulse" />
              {runStats.runningCount}
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${
              workflow.active
                ? 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30'
                : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-600'
            }`}
          >
            {workflow.active ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
            {workflow.active ? '启用' : '停用'}
          </span>
        </div>
      </div>

      {/* Last Execution */}
      {lastExec && (
        <div className="flex items-center gap-2 mb-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${getStatusColor(lastExec.status)}`}>
            {getStatusIcon(lastExec.status)}
            {getStatusLabel(lastExec.status)}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <Timer className="w-3 h-3" />
            {formatRelativeTime(lastExec.startedAt)}
          </span>
        </div>
      )}

      {/* Recent Stats */}
      {recentStats && recentStats.total > 0 && (
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            近 {recentStats.total} 次
          </span>
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-3 h-3" />
            {recentStats.success}
          </span>
          {recentStats.error > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <XCircle className="w-3 h-3" />
              {recentStats.error}
            </span>
          )}
          <span className={`font-medium ${
            recentStats.successRate >= 90 ? 'text-green-600 dark:text-green-400' :
            recentStats.successRate >= 70 ? 'text-yellow-600 dark:text-yellow-400' :
            'text-red-600 dark:text-red-400'
          }`}>
            {recentStats.successRate}%
          </span>
        </div>
      )}

      {/* No executions yet */}
      {(!recentStats || recentStats.total === 0) && !lastExec && (
        <div className="text-xs text-gray-400 dark:text-gray-500">
          暂无执行记录
        </div>
      )}
    </div>
  );
}
