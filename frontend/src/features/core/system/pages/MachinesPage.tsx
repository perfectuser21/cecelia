import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server, Globe, AlertTriangle, CheckCircle2,
  XCircle, Wifi, WifiOff, ChevronRight, RefreshCw,
} from 'lucide-react';
import { machinesApi, Machine } from '../api/machines.api';

const COUNTRY_FLAG: Record<string, string> = { US: '🇺🇸', CN: '🇨🇳', HK: '🇭🇰' };
const LOCATION_LABEL: Record<string, string> = { US: '美国', CN: '西安', HK: '香港' };

function groupByLocation(machines: Machine[]): Record<string, Machine[]> {
  const groups: Record<string, Machine[]> = {};
  for (const m of machines) {
    const loc = m.metadata.effective_country || 'Unknown';
    if (!groups[loc]) groups[loc] = [];
    groups[loc].push(m);
  }
  return groups;
}

function MachineCard({ machine, onClick }: { machine: Machine; onClick: () => void }) {
  const meta = machine.metadata;
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
          {machine.tailscale_online ? (
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

      {meta.role && (
        <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">{meta.role}</div>
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
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchMachines = async () => {
    setLoading(true);
    try {
      const data = await machinesApi.list();
      setMachines(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMachines(); }, []);

  const online = machines.filter(m => m.tailscale_online).length;
  const conflictCount = machines.filter(m => m.conflicts.some(c => c.severity === 'error')).length;
  const warnCount = machines.filter(m => m.conflicts.some(c => c.severity === 'warning')).length;
  const groups = groupByLocation(machines);
  const locationOrder = ['US', 'HK', 'CN'];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-center text-red-500">{error}</div>;
  }

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
              {online} 在线
            </span>
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
        <button
          onClick={fetchMachines}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {locationOrder.filter(loc => groups[loc]).map(loc => (
        <div key={loc} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            {COUNTRY_FLAG[loc]} {LOCATION_LABEL[loc] || loc}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groups[loc].map(machine => (
              <MachineCard
                key={machine.id}
                machine={machine}
                onClick={() => navigate(`/machines/${machine.name}`)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
