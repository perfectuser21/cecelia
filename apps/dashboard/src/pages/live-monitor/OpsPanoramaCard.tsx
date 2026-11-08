/**
 * OpsPanoramaCard — 执行全景面板卡片
 * Task: 28e7c41a-9384-405b-9e82-aa5b9871293f
 *
 * 每 30s 轮询 /api/brain/ops-panorama，展示：
 * - host CPU/内存进度条
 * - LLM 账号余量进度条（颜色编码：<50% 绿，50-80% 黄，>80% 红）
 * - 任务数、进程数、relay 容器数
 * - sampled_at 抓取时间（相对时间）
 */

import React from 'react';

// ── Types ────────────────────────────────────────────────────────

interface AccountInfo {
  id?: string;
  name?: string;
  available: boolean;
  five_hour_pct?: number;
  used_percent?: number | null;
  source?: string;
}

interface LlmCapacity {
  sentinel: string;
  vendors: Record<string, {
    available_count: number;
    total_count: number;
    accounts: AccountInfo[];
    poller?: string;
  }>;
}

export interface OpsPanoramaData {
  sampled_at: string;
  tasks: {
    in_progress_count: number | null;
    vendor_dist: Record<string, number> | null;
    available?: boolean;
    error?: string;
    sampled_at?: string | null;
  };
  relay: { container_count: number | null };
  sessions: { headed: number | null; headless: number | null };
  host: { cpu_usage_pct: number; mem_used_pct: number };
  processes: { claude_total: number | null; codex_total: number | null; available?: boolean; error?: string; sampled_at?: string | null };
  llm_capacity: LlmCapacity | null;
}

// ── Helpers ──────────────────────────────────────────────────────

function fmtAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  return `${Math.floor(diff / 3600)}h 前`;
}

function usageColor(pct: number): string {
  if (pct > 80) return '#ef4444';
  if (pct > 50) return '#f59e0b';
  return '#10b981';
}

function accountState(account: AccountInfo, poller?: string): '可用' | '不可用' | '未知' {
  if (poller !== 'ok' || !account.source) return '未知';
  if (account.source.startsWith('ledger:usable:') && account.available === true) return '可用';
  if (account.source.startsWith('ledger:unusable:') && account.available === false) return '不可用';
  return '未知';
}

// ── Sub-components ───────────────────────────────────────────────

function ProgressBar({
  value,
  color,
  height = 6,
  label,
}: {
  value: number;
  color: string;
  height?: number;
  label?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      style={{
        width: '100%',
        height,
        background: '#21262d',
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          background: color,
          borderRadius: height / 2,
          transition: 'width 0.4s ease',
        }}
        data-color={color}
      />
    </div>
  );
}

function MetricRow({
  label,
  value,
  pct,
  testId,
  valueTestId,
}: {
  label: string;
  value: string;
  pct: number;
  testId: string;
  valueTestId: string;
}) {
  const color = usageColor(pct);
  return (
    <div data-testid={testId} style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#8b949e' }}>{label}</span>
        <span data-testid={valueTestId} style={{ fontSize: 10, fontFamily: 'monospace', color }}>
          {value ?? '—'}
        </span>
      </div>
      <ProgressBar value={pct} color={color} label={label} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

export function OpsPanoramaCard() {
  const [data, setData] = React.useState<OpsPanoramaData | null>(null);
  const [loadError, setLoadError] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/brain/ops-panorama');
      if (!res.ok) throw new Error('来源请求失败');
      const json = await res.json();
      // 仅接受合法对象（防止 mock 或异常返回数组/null 导致渲染崩溃）
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('来源响应无效');
      setData(json as OpsPanoramaData);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) {
    return (
      <div
        data-testid="ops-panorama-loading"
        style={{
          background: '#161b22',
          border: '1px solid #21262d',
          borderRadius: 10,
          padding: '12px 14px',
          color: '#484f58',
          fontSize: 11,
        }}
      >
        加载中…
      </div>
    );
  }

  const sourceErrors = [loadError ? '刷新失败，显示上次采样' : null,
    data.tasks?.available === false ? data.tasks.error || '任务来源不可用' : null,
    data.processes?.available === false ? data.processes.error || '进程来源不可用' : null].filter(Boolean);
  const relayCount = data.relay?.container_count ?? null;
  const activeVendors = ['codex', 'grok'] as const;
  const hasUnknown = activeVendors.some((key) => {
    const ledger = data.llm_capacity?.vendors?.[key];
    return !ledger || ledger.poller !== 'ok' || !ledger.accounts?.length ||
      ledger.accounts.some((account) => accountState(account, ledger.poller) === '未知');
  });
  const hasAvailable = activeVendors.some((key) => {
    const ledger = data.llm_capacity?.vendors?.[key];
    return ledger?.accounts?.some((account) => accountState(account, ledger.poller) === '可用');
  });
  const capacityStatus = hasUnknown ? '未知' : hasAvailable ? '正常' : '不可用';
  const sentinelColor =
    capacityStatus === '正常'
      ? '#10b981'
      : capacityStatus === '未知'
        ? '#f59e0b'
        : '#ef4444';

  return (
    <div
      data-testid="ops-panorama-card"
      style={{
        background: '#161b22',
        border: '1px solid #21262d',
        borderRadius: 10,
        padding: '12px 14px',
        color: '#e6edf3',
        fontFamily: '"Inter", system-ui, sans-serif',
      }}
    >
      {/* 标题行 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <span
          data-testid="ops-panorama-title"
          style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#8b949e' }}
        >
          执行全景
        </span>
        {data.sampled_at && (
          <span
            data-testid="ops-panorama-sampled-at"
            style={{ fontSize: 10, color: '#484f58', fontFamily: 'monospace' }}
          >
            {fmtAgo(data.sampled_at)}
          </span>
        )}
      </div>

      {sourceErrors.length > 0 && <div role="status" data-testid="ops-panorama-source-errors" style={{fontSize:10,color:'#f59e0b',marginBottom:8}}>{sourceErrors.join('；')}</div>}
      {/* HOST 指标 */}
      <MetricRow
        label="CPU"
        value={`${(data.host?.cpu_usage_pct ?? 0).toFixed(1)}%`}
        pct={data.host?.cpu_usage_pct ?? 0}
        testId="ops-panorama-cpu"
        valueTestId="ops-panorama-cpu-value"
      />
      <MetricRow
        label="MEM"
        value={`${(data.host?.mem_used_pct ?? 0).toFixed(1)}%`}
        pct={data.host?.mem_used_pct ?? 0}
        testId="ops-panorama-mem"
        valueTestId="ops-panorama-mem-value"
      />

      {/* 分割线 */}
      <div style={{ borderTop: '1px solid #21262d', margin: '8px 0' }} />

      {/* 统计行 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <StatChip label="任务" value={data.tasks?.available === false ? null : data.tasks?.in_progress_count ?? null} testId="ops-panorama-tasks-count" />
        <StatChip label="Claude" value={data.processes?.available === false ? null : data.processes?.claude_total ?? null} testId="ops-panorama-claude-procs" />
        <StatChip label="Codex" value={data.processes?.available === false ? null : data.processes?.codex_total ?? null} testId="ops-panorama-codex-procs" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, color: '#484f58' }}>Relay</span>
          <span
            data-testid="ops-panorama-relay"
            style={{ fontSize: 11, fontFamily: 'monospace', color: '#e6edf3' }}
          >
            {relayCount !== null ? relayCount : '—'}
          </span>
        </div>
      </div>

      {/* 现役模型容量；未知配额不等于可用 */}
        <div data-testid="ops-panorama-llm-capacity">
          <div style={{ borderTop: '1px solid #21262d', margin: '8px 0' }} />
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: 1 }}>LLM 容量</span>
            <span data-testid="ops-panorama-llm-status" style={{ fontSize: 9, color: sentinelColor, fontFamily: 'monospace' }}>
              {capacityStatus}
            </span>
          </div>
          {activeVendors.map((vendor) => {
            const ledger = data.llm_capacity?.vendors?.[vendor];
            return <div key={vendor} data-testid={`ops-panorama-vendor-${vendor}`} style={{ marginBottom: 5 }}>
              <span style={{ fontSize: 10 }}>{vendor === 'codex' ? 'Codex' : 'Grok'}</span>
              {!ledger || ledger.poller !== 'ok' || !ledger.accounts?.length ? <span>：未知</span> :
                ledger.accounts.map((acc, index) => {
                  const name = acc.name ?? acc.id ?? String(index + 1);
                  const state = accountState(acc, ledger.poller);
                  const pct = acc.used_percent;
                  return <div key={`${vendor}-${name}`} data-testid={`ops-panorama-account-${vendor}-${name}`} style={{ fontSize: 10, marginTop: 3 }}>
                    <span>{name}：{state}</span>
                    {state !== '未知' && typeof pct === 'number' && Number.isFinite(pct) && <>
                      <span> {pct}%</span>
                      <ProgressBar value={pct} color={usageColor(pct)} label={`${name} usage`} height={4} />
                    </>}
                  </div>;
                })}
            </div>;
          })}
        </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  testId,
}: {
  label: string;
  value: number | null;
  testId: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, color: '#484f58' }}>{label}</span>
      <span
        data-testid={testId}
        style={{ fontSize: 11, fontFamily: 'monospace', color: '#e6edf3' }}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

export default OpsPanoramaCard;
