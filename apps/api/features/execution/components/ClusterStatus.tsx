import { Server, Cpu, HardDrive, Users, AlertTriangle } from 'lucide-react';
import { ClusterStatus as ClusterStatusType, ServerStatus } from '../api/agents.api';

interface ClusterStatusProps {
  data: ClusterStatusType | null;
  loading?: boolean;
}

// 危险等级颜色
const dangerLevelColors = {
  normal: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger: 'bg-orange-500',
  critical: 'bg-red-500',
};

// 计算危险等级
function calculateDangerLevel(server: ServerStatus): 'normal' | 'warning' | 'danger' | 'critical' {
  if (!server.online) return 'critical';

  const cpuPct = (server.cpu_load / server.cpu_cores) * 100;
  const memUsedPct = ((server.mem_total_gb - server.mem_free_gb) / server.mem_total_gb) * 100;

  if (cpuPct > 90 || memUsedPct > 90) return 'critical';
  if (cpuPct > 80 || memUsedPct > 80) return 'danger';
  if (cpuPct > 60 || memUsedPct > 70) return 'warning';
  return 'normal';
}

// 集群状态颜色
const clusterStatusColors = {
  healthy: 'text-green-400',
  partial: 'text-yellow-400',
  degraded: 'text-red-400',
};

const clusterStatusLabels = {
  healthy: '健康',
  partial: '部分可用',
  degraded: '降级',
};

// 进度条组件
function ProgressBar({
  value,
  max,
  color = 'from-blue-500 to-cyan-500',
  showLabel = true,
}: {
  value: number;
  max: number;
  color?: string;
  showLabel?: boolean;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-700 rounded-full h-2">
        <div
          className={`bg-gradient-to-r ${color} h-2 rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-gray-400 w-16 text-right">
          {value.toFixed(1)}/{max}
        </span>
      )}
    </div>
  );
}

// 单个服务器状态卡片
function ServerCard({
  name,
  label,
  server,
}: {
  name: string;
  label: string;
  server: ServerStatus;
}) {
  const dangerLevel = server.danger_level || calculateDangerLevel(server);
  const cpuPct = server.cpu_cores > 0 ? (server.cpu_load / server.cpu_cores) * 100 : 0;
  const memUsedGb = server.mem_total_gb - server.mem_free_gb;
  const memPct = server.mem_total_gb > 0 ? (memUsedGb / server.mem_total_gb) * 100 : 0;

  return (
    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-white">{label}</span>
          <span className="text-xs text-gray-500">({name.toUpperCase()})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${server.online ? dangerLevelColors[dangerLevel] : 'bg-gray-500'} ${server.online && dangerLevel === 'normal' ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-gray-400">
            {server.online ? (dangerLevel === 'normal' ? '正常' : dangerLevel === 'warning' ? '警告' : dangerLevel === 'danger' ? '危险' : '紧急') : '离线'}
          </span>
        </div>
      </div>

      {/* CPU */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <div className="flex items-center gap-1 text-gray-400">
              <Cpu className="w-3 h-3" />
              <span>CPU</span>
            </div>
            <span className="text-white">{cpuPct.toFixed(0)}%</span>
          </div>
          <ProgressBar
            value={server.cpu_load}
            max={server.cpu_cores}
            color={cpuPct > 80 ? 'from-red-500 to-orange-500' : cpuPct > 60 ? 'from-yellow-500 to-orange-400' : 'from-blue-500 to-cyan-500'}
            showLabel
          />
        </div>

        {/* Memory */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <div className="flex items-center gap-1 text-gray-400">
              <HardDrive className="w-3 h-3" />
              <span>内存</span>
            </div>
            <span className="text-white">{memPct.toFixed(0)}%</span>
          </div>
          <ProgressBar
            value={memUsedGb}
            max={server.mem_total_gb}
            color={memPct > 80 ? 'from-red-500 to-orange-500' : memPct > 70 ? 'from-yellow-500 to-orange-400' : 'from-green-500 to-emerald-500'}
            showLabel
          />
          <div className="text-xs text-gray-500 mt-1">
            剩余 {server.mem_free_gb.toFixed(1)} GB
          </div>
        </div>

        {/* Slots */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <div className="flex items-center gap-1 text-gray-400">
              <Users className="w-3 h-3" />
              <span>Slots</span>
            </div>
            <span className={`${server.slots_available === 0 ? 'text-red-400' : 'text-white'}`}>
              {server.slots_in_use}/{server.slots_max}
            </span>
          </div>
          <ProgressBar
            value={server.slots_in_use}
            max={server.slots_max}
            color={server.slots_available === 0 ? 'from-red-500 to-rose-500' : 'from-violet-500 to-purple-500'}
            showLabel={false}
          />
          <div className="text-xs text-gray-500 mt-1">
            可用 {server.slots_available} 个
          </div>
        </div>

        {/* Running Tasks */}
        {server.tasks_running.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="text-xs text-gray-400 mb-2">运行中任务</div>
            <div className="space-y-1">
              {server.tasks_running.slice(0, 3).map((task, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  <span className="text-xs text-gray-300 truncate">{task}</span>
                </div>
              ))}
              {server.tasks_running.length > 3 && (
                <div className="text-xs text-gray-500">
                  +{server.tasks_running.length - 3} 更多
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 单服务器模式提示
function SingleServerMode() {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-violet-400">
          <Server className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-white">集群状态</h3>
      </div>
      <div className="flex items-center gap-3 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
        <AlertTriangle className="w-5 h-5 text-yellow-500" />
        <div>
          <div className="text-sm text-white">单服务器模式</div>
          <div className="text-xs text-gray-400">
            集群状态 API 不可用，当前运行在单服务器模式
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClusterStatus({ data, loading }: ClusterStatusProps) {
  // API 不可用时显示单服务器模式提示
  if (!data && !loading) {
    return <SingleServerMode />;
  }

  // 加载中
  if (loading && !data) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-violet-400">
            <Server className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">集群状态</h3>
        </div>
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="text-violet-400">
            <Server className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">集群状态</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${clusterStatusColors[data.cluster_status]}`}>
            {clusterStatusLabels[data.cluster_status]}
          </span>
        </div>
      </div>

      {/* 整体统计 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-900/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{data.total_slots}</div>
          <div className="text-xs text-gray-400">总席位</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 text-center">
          <div className={`text-2xl font-bold ${data.available_slots === 0 ? 'text-red-400' : 'text-green-400'}`}>
            {data.available_slots}
          </div>
          <div className="text-xs text-gray-400">可用席位</div>
        </div>
      </div>

      {/* 推荐提示 */}
      {data.recommendation && (
        <div className="bg-slate-900/30 rounded-lg px-3 py-2 mb-4">
          <div className="text-xs text-gray-400">{data.recommendation}</div>
        </div>
      )}

      {/* 双服务器状态 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ServerCard name="us" label="US VPS (主力)" server={data.servers.us} />
        <ServerCard name="hk" label="HK VPS (辅助)" server={data.servers.hk} />
      </div>
    </div>
  );
}
