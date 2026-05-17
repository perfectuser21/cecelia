/**
 * AccountUsagePage — 账号用量详情页
 * 路由：/account-usage
 * 显示 Claude 三账号 + Codex 五账号的完整用量数据
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface AccountUsage {
  five_hour_pct: number;
  seven_day_pct: number;
  seven_day_sonnet_pct: number;
  resets_at: string | null;
  seven_day_resets_at: string | null;
}

interface CodexAccountUsage {
  accountId: string;
  primaryUsedPct: number;
  primaryResetSeconds: number;
  secondaryUsedPct: number;
  codeReviewUsedPct: number;
  tokenExpired: boolean;
}

const ACCOUNTS = ['account1', 'account2', 'account3'];
const ACCOUNT_LABELS: Record<string, string> = {
  account1: 'AP01',  // alexperfectapi01@gmail.com
  account2: 'LCH',   // chalexlch@gmail.com
  account3: 'ZJ',    // zenithjoy21xx@gmail.com
};

const CODEX_ACCOUNTS = ['team1', 'team2', 'team3', 'team4', 'team5'];
const CODEX_LABELS: Record<string, string> = {
  team1: 'CDX-1',
  team2: 'CDX-2',
  team3: 'CDX-3',
  team4: 'CDX-4',
  team5: 'CDX-5',
};

// 颜色规范
const COLOR_5H = '#58a6ff';      // 蓝
const COLOR_7D = '#d29922';      // 金黄
const COLOR_SON = '#bc8cff';     // 紫
const COLOR_WARN = '#f85149';    // 红色警告（≥80%）
const COLOR_CODEX = '#10b981';   // 绿（Codex 主色）

function metricColor(base: string, pct: number): string {
  return pct >= 80 ? COLOR_WARN : base;
}

function fmt5hCountdown(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const now = Date.now();
  const resetMs = new Date(resetsAt).getTime();
  const diffMs = resetMs - now;
  if (diffMs <= 0) return '已重置';
  const diffMin = Math.floor(diffMs / 60000);
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return h > 0 ? `↺ ${h}:${String(m).padStart(2, '0')}` : `↺ ${m}m`;
}

function fmtResetSeconds(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `↺ ${h}:${String(m).padStart(2, '0')}` : `↺ ${m}m`;
}

function fmt7dDate(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const d = new Date(resetsAt);
  return `↺ ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function AccountUsagePage() {
  const navigate = useNavigate();
  const [usage, setUsage] = useState<Record<string, AccountUsage> | null>(null);
  const [codexUsage, setCodexUsage] = useState<Record<string, CodexAccountUsage> | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      const [claudeRes, codexRes] = await Promise.all([
        fetch('/api/brain/account-usage'),
        fetch('/api/brain/codex-usage'),
      ]);
      if (claudeRes.ok) {
        const data = await claudeRes.json();
        if (data.ok) setUsage(data.usage);
      }
      if (codexRes.ok) {
        const data = await codexRes.json();
        if (data.ok) setCodexUsage(data.usage);
      }
      setFetchError(null);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : '数据加载失败，请刷新重试');
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    const t = setInterval(fetchUsage, 60000);
    return () => clearInterval(t);
  }, [fetchUsage]);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetch('/api/brain/account-usage/refresh', { method: 'POST' }),
        fetch('/api/brain/codex-usage/refresh', { method: 'POST' }),
      ]);
      await fetchUsage();
    } catch { /* 静默 */ } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '24px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    }}>
      {/* 加载错误提示 */}
      {fetchError && (
        <div style={{
          background: '#2d1515', border: '1px solid #da3633', borderRadius: 8,
          color: '#f85149', padding: '10px 16px', marginBottom: 16, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>⚠ {fetchError}</span>
          <button
            onClick={fetchUsage}
            style={{ background: 'none', border: '1px solid #da363344', borderRadius: 4, color: '#f85149', cursor: 'pointer', fontSize: 12, padding: '3px 8px' }}
          >
            重试
          </button>
        </div>
      )}

      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/live-monitor')}
            style={{
              background: 'none',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: 13,
              padding: '4px 10px',
            }}
          >
            ← 返回
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e6edf3' }}>账号用量</h1>
            {lastRefresh && (
              <div style={{ fontSize: 11, color: '#484f58', marginTop: 2 }}>
                最后刷新：{lastRefresh.toLocaleTimeString('zh-CN')}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={handleForceRefresh}
          disabled={refreshing}
          style={{
            background: refreshing ? '#21262d' : '#1f6feb',
            border: '1px solid #388bfd',
            borderRadius: 6,
            color: refreshing ? '#8b949e' : '#e6edf3',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            padding: '6px 16px',
            transition: 'background 0.15s',
          }}
        >
          {refreshing ? '刷新中…' : '强制刷新'}
        </button>
      </div>

      {/* ── Claude Code ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#8b949e', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Claude Code
      </div>

      {/* 图例 */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 11, color: '#8b949e' }}>
        <span style={{ color: COLOR_5H }}>● 5h 用量</span>
        <span style={{ color: COLOR_7D }}>● 7d 用量</span>
        <span style={{ color: COLOR_SON }}>● 7d Sonnet</span>
        <span style={{ color: COLOR_WARN }}>● ≥80% 警告</span>
      </div>

      {/* 三列 Claude 账号 */}
      {usage ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {ACCOUNTS.map(id => {
            const u = usage[id];
            const pct5h = u?.five_hour_pct ?? 0;
            const pct7d = u?.seven_day_pct ?? 0;
            const pctSon = u?.seven_day_sonnet_pct ?? 0;
            const countdown5h = fmt5hCountdown(u?.resets_at ?? null);
            const date7d = fmt7dDate(u?.seven_day_resets_at ?? null);

            return (
              <div
                key={id}
                style={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 10,
                  padding: '16px 20px',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#8b949e', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {ACCOUNT_LABELS[id] ?? id.replace('account', 'Account ')}
                </div>
                <MetricRow emoji="🔵" label="5h" pct={pct5h} baseColor={COLOR_5H} suffix={countdown5h} />
                <MetricRow emoji="🟡" label="7d" pct={pct7d} baseColor={COLOR_7D} suffix={date7d} />
                <MetricRow emoji="🟣" label="son" pct={pctSon} baseColor={COLOR_SON} suffix={date7d} />
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#484f58', padding: '40px 0', fontSize: 14 }}>
          加载中…
        </div>
      )}

      {/* ── Codex ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#8b949e', marginBottom: 10, marginTop: 32, textTransform: 'uppercase', letterSpacing: 1 }}>
        OpenAI Codex
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 11, color: '#8b949e' }}>
        <span style={{ color: COLOR_CODEX }}>● 5h 用量</span>
        <span style={{ color: COLOR_7D }}>● 7d 用量</span>
        <span style={{ color: COLOR_WARN }}>● ≥80% 警告</span>
      </div>

      {codexUsage ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {CODEX_ACCOUNTS.map(id => {
            const u = codexUsage[id];
            const pct5h = u?.primaryUsedPct ?? 0;
            const pct7d = u?.secondaryUsedPct ?? 0;
            const countdown5h = fmtResetSeconds(u?.primaryResetSeconds);
            const expired = u?.tokenExpired;

            return (
              <div
                key={id}
                style={{
                  background: '#161b22',
                  border: `1px solid ${expired ? COLOR_WARN : '#30363d'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  opacity: expired ? 0.5 : 1,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: expired ? COLOR_WARN : '#8b949e', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {CODEX_LABELS[id] ?? id}
                  {expired && <span style={{ fontSize: 10, marginLeft: 6 }}>EXPIRED</span>}
                </div>
                <MetricRow emoji="🟢" label="5h" pct={pct5h} baseColor={COLOR_CODEX} suffix={countdown5h} />
                <MetricRow emoji="🟡" label="7d" pct={pct7d} baseColor={COLOR_7D} suffix="" />
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#484f58', padding: '30px 0', fontSize: 13 }}>
          Codex 用量加载中…
        </div>
      )}
    </div>
  );
}

interface MetricRowProps {
  emoji: string;
  label: string;
  pct: number;
  baseColor: string;
  suffix: string;
}

function MetricRow({ emoji, label, pct, baseColor, suffix }: MetricRowProps) {
  const color = metricColor(baseColor, pct);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12 }}>{emoji}</span>
        <span style={{ fontSize: 12, color: '#8b949e', width: 28 }}>{label}:</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{pct}%</span>
      </div>
      {suffix && (
        <span style={{ fontSize: 11, color: pct >= 80 ? COLOR_WARN : '#484f58' }}>
          {suffix}
        </span>
      )}
    </div>
  );
}
