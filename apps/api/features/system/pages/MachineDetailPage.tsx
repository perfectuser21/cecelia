import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Server, Globe, Wifi, WifiOff, AlertTriangle, XCircle,
  ChevronLeft, Trash2, CheckCircle2,
} from 'lucide-react';
import { machinesApi, Machine, MachineService, MachineDeprecated, MachineConflict } from '../api/machines.api';

const COUNTRY_FLAG: Record<string, string> = { US: '🇺🇸', CN: '🇨🇳', HK: '🇭🇰' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-1.5">
      <span className="text-sm text-gray-500 dark:text-gray-400 w-32 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-900 dark:text-white font-mono">{value || '—'}</span>
    </div>
  );
}

function ConflictBadge({ conflict }: { conflict: MachineConflict }) {
  const isError = conflict.severity === 'error';
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
      isError
        ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
        : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
    }`}>
      {isError ? <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
      <div>
        <span className="font-medium">{conflict.service}</span>
        {' — '}
        {conflict.message}
      </div>
    </div>
  );
}

function ServiceRow({ svc, effectiveCountry }: { svc: MachineService; effectiveCountry?: string }) {
  const hasConflict = svc.needs_cn_ip && effectiveCountry !== 'CN';
  return (
    <div className={`flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 ${hasConflict ? 'bg-red-50/50 dark:bg-red-900/10 -mx-2 px-2 rounded' : ''}`}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{svc.name}</span>
          {svc.port && (
            <span className="text-xs text-gray-400 font-mono">:{svc.port}</span>
          )}
          {svc.internal && (
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">内网</span>
          )}
        </div>
        {svc.description && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{svc.description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {svc.type && <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{svc.type}</span>}
        {svc.needs_cn_ip !== undefined && (
          <span className={hasConflict ? 'text-red-500' : 'text-gray-400'}>
            {COUNTRY_FLAG[svc.needs_cn_ip ? 'CN' : (effectiveCountry || 'US')]}
            {hasConflict ? ' ⛔' : ' ✓'}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MachineDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMachine = async () => {
    if (!name) return;
    setLoading(true);
    try {
      const data = await machinesApi.get(name);
      setMachine(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const markDeprecatedHandled = async (depName: string) => {
    if (!machine) return;
    const newDeprecated = (machine.metadata.deprecated || []).filter(d => d.name !== depName);
    try {
      const updated = await machinesApi.patch(machine.name, { deprecated: newDeprecated });
      setMachine(updated);
    } catch (err) {
      console.error('Failed to update:', err);
    }
  };

  useEffect(() => { fetchMachine(); }, [name]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !machine) {
    return <div className="p-6 text-center text-red-500">{error || '未找到设备'}</div>;
  }

  const meta = machine.metadata;
  const errorConflicts = machine.conflicts.filter(c => c.severity === 'error');
  const warnConflicts = machine.conflicts.filter(c => c.severity === 'warning');

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate('/machines')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        所有设备
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Server className="w-6 h-6" />
            {meta.hardware || machine.name}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className="font-mono">{machine.name}</span>
            {meta.os && <span>{meta.os}</span>}
            {machine.tailscale_online ? (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <Wifi className="w-4 h-4" /> 在线
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-400">
                <WifiOff className="w-4 h-4" /> 离线
              </span>
            )}
          </div>
        </div>
      </div>

      {machine.conflicts.length > 0 && (
        <div className="mb-4 space-y-2">
          {[...errorConflicts, ...warnConflicts].map((c, i) => (
            <ConflictBadge key={i} conflict={c} />
          ))}
        </div>
      )}

      <Section title="网络配置">
        <Field label="Tailscale IP" value={meta.tailscale_ip} />
        <Field label="公网 IP" value={meta.public_ip} />
        <Field
          label="出口国家"
          value={`${COUNTRY_FLAG[meta.effective_country || ''] || '🌐'} ${meta.effective_country || '未知'}`}
        />
        <Field
          label="Exit Node"
          value={meta.exit_node ? `${meta.exit_node} (${meta.exit_node_ip || ''})` : '直连'}
        />
        {meta.socks_proxy && <Field label="SOCKS Proxy" value={meta.socks_proxy} />}
        {meta.ssh_tunnels?.length ? (
          <Field label="SSH Tunnels" value={meta.ssh_tunnels.join(', ')} />
        ) : null}
        <Field label="SSH 连接" value={`ssh ${meta.ssh_user || 'root'}@${meta.tailscale_ip}`} />
      </Section>

      <Section title="职责 & 账号">
        {meta.role && <Field label="角色" value={meta.role} />}
        {meta.accounts?.length ? (
          <Field label="绑定账号" value={meta.accounts.join('  ·  ')} />
        ) : null}
        {meta.notes && <Field label="备注" value={meta.notes} />}
      </Section>

      {(meta.services || []).length > 0 && (
        <Section title="正式服务">
          {meta.services.map((svc, i) => (
            <ServiceRow key={i} svc={svc} effectiveCountry={meta.effective_country} />
          ))}
        </Section>
      )}

      {(meta.deprecated || []).length > 0 && (
        <Section title="废弃服务">
          {meta.deprecated.map((dep: MachineDeprecated, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-yellow-500" />
                  {dep.name}
                </span>
                {dep.reason && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{dep.reason}</div>
                )}
              </div>
              <button
                onClick={() => markDeprecatedHandled(dep.name)}
                className="text-xs text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                标记已处理
              </button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
