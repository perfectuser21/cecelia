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
  id: string;
  name?: string;
  available: boolean;
  five_hour_pct?: number;
}

interface LlmCapacity {
  sentinel: string;
  vendors: Record<string, {
    available_count: number;
    total_count: number;
    accounts: AccountInfo[];
  }>;
}

export interface OpsPanoramaData {
  sampled_at: string;
  tasks: {
    in_progress_count: number;
    vendor_dist: Record<string, number>;
  };
  relay: { container_count: number | null };
  sessions: { headed: number; headless: number };
  host: { cpu_usage_pct: number; mem_used_pct: number };
  processes: { claude_total: number; codex_total: number };
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
          {value}
        </span>
      </div>
      <ProgressBar value={pct} color={color} label={label} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

export function OpsPanoramaCard() {
  const [data, setData] = React.useState<OpsPanoramaData | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/brain/ops-panorama');
      if (!res.ok) return;
      const json = await res.json();
      // 仅接受合法对象（防止 mock 或异常返回数组/null 导致渲染崩溃）
      if (!json || typeof json !== 'object' || Array.isArray(json)) return;
      setData(json as OpsPanoramaData);
    } catch {
      /* 静默降级 */
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

  const relayCount = data.relay?.container_count ?? null;
  const claudeAccounts = data.llm_capacity?.vendors?.claude?.accounts ?? [];
  const sentinelColor =
    data.llm_capacity?.sentinel === 'ok'
      ? '#10b981'
      : data.llm_capacity?.sentinel === 'degraded'
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
        <StatChip label="任务" value={data.tasks?.in_progress_count ?? 0} testId="ops-panorama-tasks-count" />
        <StatChip label="Claude" value={data.processes?.claude_total ?? 0} testId="ops-panorama-claude-procs" />
        <StatChip label="Codex" value={data.processes?.codex_total ?? 0} testId="ops-panorama-codex-procs" />
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

      {/* LLM 容量（Claude 账号余量） */}
      {data.llm_capacity && claudeAccounts.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid #21262d', margin: '8px 0' }} />
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: 1 }}>LLM 容量</span>
            <span style={{ fontSize: 9, color: sentinelColor, fontFamily: 'monospace' }}>
              {data.llm_capacity.sentinel}
            </span>
          </div>
          {claudeAccounts.map((acc) => {
            const pct = acc.five_hour_pct ?? 0;
            const color = usageColor(pct);
            return (
              <div
                key={acc.id}
                data-testid={`ops-panorama-account-${acc.id}`}
                style={{ marginBottom: 5 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: '#8b949e', fontFamily: 'monospace' }}>
                    {acc.name ?? acc.id}
                  </span>
                  <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{pct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${acc.id} usage`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  style={{
                    width: '100%',
                    height: 4,
                    background: '#21262d',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                  data-color={color}
                >
                  <div
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      height: '100%',
                      background: color,
                      borderRadius: 2,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, color: '#484f58' }}>{label}</span>
      <span
        data-testid={testId}
        style={{ fontSize: 11, fontFamily: 'monospace', color: '#e6edf3' }}
      >
        {value}
      </span>
    </div>
  );
}

export default OpsPanoramaCard;
