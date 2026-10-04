import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

// 闹钟总账（只读）：数据来自 GET /api/brain/agent-ops/alarms（扩 ops_schedule_entries，不另起注册系统）。
const API_BASE = import.meta.env.VITE_API_URL || '';

export interface AlarmRow {
  id: string;
  name: string;
  machine: string;
  source: string;
  mechanism: string;
  cadence: string;
  enabled: boolean;
  tree: { path: string | null; department: string | null; value_stream: string | null; capability: string | null; bucket: string | null };
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string;
  liveness: string | null;
  note: string | null;
  ledger_status: string;
}

interface AlarmSource { source: string; host_alias: string; source_status: string; stale: boolean; last_report_at: string | null }
interface AlarmPayload {
  alarms: AlarmRow[];
  summary: { total: number; enabled: number; unregistered: number; without_tree: number };
  sources: AlarmSource[];
  server_now: string;
}

const STATUS_STYLE: Record<string, string> = {
  正常: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  失败: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  静默: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  无记录: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export function formatBeijing(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ALL = '全部';
const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
      >
        {[ALL, ...options].map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function filterAlarms(rows: AlarmRow[], f: { machine: string; mechanism: string; status: string; department: string; q: string }): AlarmRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) =>
    (f.machine === ALL || r.machine === f.machine)
    && (f.mechanism === ALL || r.mechanism === f.mechanism)
    && (f.status === ALL || r.last_status === f.status)
    && (f.department === ALL || (f.department === '未挂树' ? !r.tree.path : r.tree.department === f.department))
    && (!q || r.name.toLowerCase().includes(q) || (r.note ?? '').toLowerCase().includes(q)));
}

export default function AlarmLedgerTab() {
  const [data, setData] = useState<AlarmPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ machine: ALL, mechanism: ALL, status: ALL, department: ALL, q: '' });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/brain/agent-ops/alarms`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(res.status === 503 ? '总账迁移（517）还没上到这台 Brain，稍后再看' : (body?.error?.message || `加载失败（HTTP ${res.status}）`));
        setData(null);
      } else {
        setData(body.data as AlarmPayload);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const rows = data?.alarms ?? [];
  const shown = useMemo(() => filterAlarms(rows, filters), [rows, filters]);
  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const staleSources = (data?.sources ?? []).filter((s) => s.stale);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">闹钟总账</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">全系统所有定时任务一张表（只读）。新增定时只能经 Brain scheduler 注册。</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="闹钟总数" value={data.summary.total} />
            <Stat label="已启用" value={data.summary.enabled} />
            <Stat label="未登记" value={data.summary.unregistered} warn={data.summary.unregistered > 0} />
            <Stat label="未挂树" value={data.summary.without_tree} warn={data.summary.without_tree > 0} />
          </div>
          {staleSources.length > 0 && (
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              采集来源异常/过期：{staleSources.map((s) => `${s.source}@${s.host_alias}(${s.source_status})`).join('、')}（对应行的状态可能不是最新）
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect label="机器" value={filters.machine} options={uniq(rows.map((r) => r.machine))} onChange={set('machine')} />
            <FilterSelect label="机制" value={filters.mechanism} options={uniq(rows.map((r) => r.mechanism))} onChange={set('mechanism')} />
            <FilterSelect label="状态" value={filters.status} options={['正常', '失败', '静默', '无记录']} onChange={set('status')} />
            <FilterSelect label="部门" value={filters.department} options={[...uniq(rows.map((r) => r.tree.department)), '未挂树']} onChange={set('department')} />
            <input
              aria-label="搜索"
              placeholder="搜名称/备注"
              value={filters.q}
              onChange={(e) => set('q')(e.target.value)}
              className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">显示 {shown.length} / {rows.length}</span>
          </div>

          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  {['#', '名称', '机器', '机制', '多久响一次', '启用', '挂在树的哪个流程', '上次运行', '上次成功', '最近状态', '备注'].map((h) => (
                    <th key={h} className="px-3 py-2 whitespace-nowrap font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {shown.map((r, i) => (
                  <tr key={r.id} className={r.enabled ? '' : 'opacity-60'}>
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100 max-w-xs break-words">{r.name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.machine}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.mechanism}</td>
                    <td className="px-3 py-2 max-w-[14rem] break-words">{r.cadence || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.enabled ? '启用' : '禁用'}</td>
                    <td className="px-3 py-2 max-w-xs break-words">{r.tree.path ?? <span className="text-gray-400">未挂树</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatBeijing(r.last_run_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatBeijing(r.last_success_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.last_status] ?? STATUS_STYLE['无记录']}`}>{r.last_status}</span>
                    </td>
                    <td className="px-3 py-2 max-w-sm break-words text-gray-600 dark:text-gray-300">{r.note ?? ''}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-400">没有符合筛选条件的闹钟</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && loading && <p className="text-sm text-gray-500">加载中…</p>}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-semibold ${warn ? 'text-yellow-600 dark:text-yellow-300' : 'text-gray-900 dark:text-white'}`}>{value}</div>
    </div>
  );
}
