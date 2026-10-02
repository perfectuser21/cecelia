import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server, Globe, AlertTriangle, CheckCircle2,
  XCircle, Wifi, WifiOff, ChevronRight, RefreshCw,
} from 'lucide-react';
import { machinesApi, Machine } from '../api/machines.api';
import NodeOnboarding from './NodeOnboarding';
import { ExistingNode } from './NodeOnboardingForm';

const COUNTRY_FLAG: Record<string, string> = { US: '🇺🇸', CN: '🇨🇳', HK: '🇭🇰' };
const LOCATION_LABEL: Record<string, string> = { US: '美国', Xian: '西安', HK: '香港', CN: '中国大陆', other: '其他', Unknown: '未知地区' };

function groupByLocation(machines: Machine[]): Record<string, Machine[]> {
  const groups: Record<string, Machine[]> = {};
  for (const m of machines) {
    const loc = m.metadata.physical_location || m.metadata.effective_country || 'Unknown';
    if (!groups[loc]) groups[loc] = [];
    groups[loc].push(m);
  }
  return groups;
}

const HEALTH_FRESHNESS_MS = 5 * 60_000;
const NODE_ROLE_LABEL: Record<string, string> = { observer: '监控节点', worker: '执行节点', service: '服务节点', database: '数据库节点' };
function healthState(machine: Machine, now: number) {
  const health = machine.metadata.node_health;
  const observedAt = health?.observed_at;
  const age = now - new Date(observedAt || '').getTime();
  const valid = Number.isFinite(age) && age >= -30_000;
  const fresh = valid && age <= HEALTH_FRESHNESS_MS && health?.capabilities?.collector === true;
  const seconds = Math.max(0, Math.floor(age / 1000));
  const elapsed = !valid ? '尚无有效健康采样' : seconds < 60 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分钟前`;
  return { fresh, valid, observedAt, elapsed };
}

function MachineCard({ machine, now, onClick }: { machine: Machine; now: number; onClick: () => void }) {
  const meta = machine.metadata;
  const managed = meta.onboarding?.state === 'managed';
  const health = healthState(machine, now);
  const executionEnabled=machine.execution?.enabled===true&&Date.parse(machine.execution.verified_until||'')>now;
  const hasErrors = machine.conflicts.some(c => c.severity === 'error');
  const hasWarnings = machine.conflicts.some(c => c.severity === 'warning');
  const errorCount = machine.conflicts.filter(c => c.severity === 'error').length;
  const warnCount = machine.conflicts.filter(c => c.severity === 'warning').length;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white dark:bg-gray-800 rounded-xl border p-4 hover:shadow-md transition-shadow ${
        hasErrors
          ? 'border-red-300 dark:border-red-700'
          : hasWarnings
          ? 'border-yellow-300 dark:border-yellow-700'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {managed ? (
            health.fresh ? <CheckCircle2 aria-label="健康采样有效" className="w-4 h-4 text-green-500 flex-shrink-0" />
              : <AlertTriangle aria-label={health.valid ? '健康数据已过期' : '尚无有效健康采样'} className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          ) : machine.tailscale_online ? (
            <Wifi className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : (
            <WifiOff className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <div>
            <div className="font-medium text-gray-900 dark:text-white text-sm">
              {meta.hardware || machine.name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{machine.name}</div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
      </div>

      {managed && <div className="mb-2 text-xs space-y-1">
        <p className="text-gray-600 dark:text-gray-300"><span>监控纳管</span><span className="ml-2">{executionEnabled ? '执行已启用' : '执行未启用'}</span></p>
        <p className={health.fresh ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}>
          {health.valid ? <time dateTime={health.observedAt} title={new Date(health.observedAt!).toLocaleString('zh-CN')}>健康采样：{health.elapsed}{!health.fresh && '（已过期）'}</time> : health.elapsed}
        </p>
      </div>}

      {meta.role && (
        <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">{managed ? NODE_ROLE_LABEL[meta.role] || meta.role : meta.role}</div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-2">
        <Globe className="w-3 h-3" />
        <span>
          {COUNTRY_FLAG[meta.effective_country || ''] || '🌐'}{' '}
          {meta.effective_country || '未知'}
          {meta.exit_node ? ` via ${meta.exit_node}` : ' 直连'}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          {(meta.services || []).length} 个服务
        </span>
        {errorCount > 0 && (
          <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
            <XCircle className="w-3 h-3" />
            {errorCount} 个冲突
          </span>
        )}
        {warnCount > 0 && (
          <span className="flex items-center gap-0.5 text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="w-3 h-3" />
            {warnCount} 个警告
          </span>
        )}
      </div>
    </button>
  );
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [existingNode, setExistingNode] = useState<ExistingNode>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const fetchMachines = async () => {
    setLoading(true);
    try {
      const data = await machinesApi.list();
      setMachines(data);
      setRefreshError(null);
    } catch {
      setRefreshError('设备列表刷新失败，请点击刷新重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMachines(); }, []);
  const managed=machines.some(m=>m.metadata.onboarding?.state==='managed');
  useEffect(()=>{if(!managed)return;const timer=setInterval(()=>fetchMachines(),30_000);return()=>clearInterval(timer);},[managed]);

  const online = machines.filter(m => m.tailscale_online).length;
  const conflictCount = machines.filter(m => m.conflicts.some(c => c.severity === 'error')).length;
  const warnCount = machines.filter(m => m.conflicts.some(c => c.severity === 'warning')).length;
  const groups = groupByLocation(machines);
  const priorityLocations = ['US', 'HK', 'Xian', 'CN', 'other'];
  const locationOrder = [...priorityLocations, ...Object.keys(groups).filter(loc => !priorityLocations.includes(loc)).sort()];
  const monitored = machines.filter(machine => machine.metadata.onboarding?.state === 'managed' && healthState(machine, now).fresh).length;


  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Server className="w-6 h-6" />
            设备管理
          </h1>
          <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span>{machines.length} 台设备</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              {online} 台 Tailscale 在线
            </span>
            {monitored > 0 && <span>{monitored} 台监控健康</span>}
            {conflictCount > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <XCircle className="w-4 h-4" />
                {conflictCount} 个冲突
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-1 text-yellow-500">
                <AlertTriangle className="w-4 h-4" />
                {warnCount} 个警告
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
        <button onClick={() => { setExistingNode(undefined); setOnboardingOpen(true); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white">接入新机器</button>
        <button
          onClick={() => fetchMachines()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
        </div>
      </div>

      {refreshError && <p role="alert" className="mb-4 text-sm text-red-600">{refreshError}</p>}
      <NodeOnboarding existing={existingNode} open={onboardingOpen} onOpen={() => setOnboardingOpen(true)} onClose={() => setOnboardingOpen(false)} onCompleted={() => fetchMachines()} />

      {loading && <p role="status" className="mb-4 text-sm text-gray-500">正在加载设备…</p>}

      {locationOrder.filter(loc => groups[loc]).map(loc => (
        <div key={loc} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            {COUNTRY_FLAG[loc]} {LOCATION_LABEL[loc] || loc}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groups[loc].map(machine => (
              <div key={machine.id}>
                <MachineCard machine={machine} now={now} onClick={() => navigate(`/machines/${machine.name}`)} />
                {!machine.metadata.onboarding && <button aria-label={`接入管理：${machine.name}`}
                  className="mt-2 text-sm text-blue-600" onClick={() => {
                    const region = machine.metadata.physical_location;
                    setExistingNode({ name: machine.name, address: machine.metadata.address || machine.metadata.tailscale_ip || machine.metadata.public_ip || '',
                      region: region === 'US' || region === 'HK' || region === 'CN' ? region : 'other' });
                    setOnboardingOpen(true);
                  }}>接入管理</button>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
