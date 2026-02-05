import { useEffect, useState } from 'react';
import {
  Users,
  Building2,
  Zap,
  RefreshCw,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { workersApi, Department, Worker } from '../api/workers.api';

// Icon mapping for dynamic icons
const iconMap: Record<string, React.FC<{ className?: string }>> = {
  Code: ({ className }) => <span className={className}>💻</span>,
  Zap: Zap,
  RefreshCw: RefreshCw,
  Diamond: ({ className }) => <span className={className}>💎</span>,
  Monitor: ({ className }) => <span className={className}>🖥️</span>,
  Video: ({ className }) => <span className={className}>📹</span>,
  BarChart3: ({ className }) => <span className={className}>📊</span>,
  Wrench: ({ className }) => <span className={className}>🔧</span>,
  Server: ({ className }) => <span className={className}>🖥️</span>,
  Plug: ({ className }) => <span className={className}>🔌</span>,
  Link: ({ className }) => <span className={className}>🔗</span>,
};

function getIcon(iconName: string) {
  return iconMap[iconName] || Users;
}

export default function WorkersOverview() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({ totalWorkers: 0, totalAbilities: 0 });

  const loadData = async () => {
    try {
      const response = await workersApi.getAll();
      if (response.success) {
        setDepartments(response.data.departments);
        setStats({
          totalWorkers: response.data.totalWorkers,
          totalAbilities: response.data.totalAbilities,
        });
        // 默认展开所有部门
        setExpandedDepts(new Set(response.data.departments.map((d) => d.id)));
      }
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleDept = (deptId: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) {
        next.delete(deptId);
      } else {
        next.add(deptId);
      }
      return next;
    });
  };

  const toggleWorker = (workerId: string) => {
    setExpandedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'planned':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-red-400">加载失败: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-7 h-7" />
            AI 员工
          </h1>
          <p className="text-gray-400 mt-1">
            统一管理所有 AI 员工和工作流能力
          </p>
        </div>
        <button
          onClick={loadData}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
        >
          <RefreshCw className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 text-gray-400">
            <Building2 className="w-4 h-4" />
            <span>部门</span>
          </div>
          <div className="text-2xl font-bold text-white mt-1">
            {departments.length}
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 text-gray-400">
            <Users className="w-4 h-4" />
            <span>员工</span>
          </div>
          <div className="text-2xl font-bold text-white mt-1">
            {stats.totalWorkers}
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 text-gray-400">
            <Zap className="w-4 h-4" />
            <span>能力</span>
          </div>
          <div className="text-2xl font-bold text-white mt-1">
            {stats.totalAbilities}
          </div>
        </div>
      </div>

      {/* Departments */}
      <div className="space-y-4">
        {departments.map((dept) => {
          const DeptIcon = getIcon(dept.icon);
          const isExpanded = expandedDepts.has(dept.id);

          return (
            <div
              key={dept.id}
              className="bg-white/5 rounded-lg border border-white/10 overflow-hidden"
            >
              {/* Department Header */}
              <button
                onClick={() => toggleDept(dept.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <DeptIcon className="w-5 h-5 text-blue-400" />
                  <div className="text-left">
                    <h3 className="font-medium text-white">{dept.name}</h3>
                    <p className="text-sm text-gray-400">{dept.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">
                    {dept.workers.length} 人
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </button>

              {/* Workers List */}
              {isExpanded && (
                <div className="border-t border-white/10">
                  {dept.workers.map((worker) => (
                    <WorkerCard
                      key={worker.id}
                      worker={worker}
                      expanded={expandedWorkers.has(worker.id)}
                      onToggle={() => toggleWorker(worker.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkerCard({
  worker,
  expanded,
  onToggle,
}: {
  worker: Worker;
  expanded: boolean;
  onToggle: () => void;
}) {
  const WorkerIcon = getIcon(worker.icon);

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg bg-gradient-to-br ${worker.gradient.from} ${worker.gradient.to} flex items-center justify-center`}
          >
            <WorkerIcon className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">{worker.name}</span>
              {worker.alias && (
                <span className="text-sm text-gray-500">({worker.alias})</span>
              )}
              {worker.status === 'planned' && (
                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                  规划中
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">{worker.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {worker.abilities.length} 个能力
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-16">
          <p className="text-sm text-gray-400 mb-2">{worker.description}</p>
          <div className="space-y-2">
            {worker.abilities.map((ability) => (
              <div
                key={ability.id}
                className="bg-white/5 rounded-lg p-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  <span className="text-white">{ability.name}</span>
                </div>
                <p className="text-gray-500 text-xs mt-1 ml-5">
                  {ability.description}
                </p>
                <div className="flex flex-wrap gap-1 mt-1 ml-5">
                  {ability.n8nKeywords.slice(0, 3).map((kw) => (
                    <span
                      key={kw}
                      className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded"
                    >
                      {kw}
                    </span>
                  ))}
                  {ability.n8nKeywords.length > 3 && (
                    <span className="text-xs text-gray-500">
                      +{ability.n8nKeywords.length - 3}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
