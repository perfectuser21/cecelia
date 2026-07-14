import { useState, useEffect } from 'react';

interface PyramidData {
  available: boolean;
  updated_at?: string;
  error?: string;
  pass?: boolean;
  failures?: string[];
  orphans?: { tests: number; e2e: number; total: number };
  smoke?: { total: number; unwired: string[] };
  permanent?: { total: number; layers: { unit: number; integration: number } };
  panel?: { fresh: boolean; generated: string };
  bare_fr?: { count: number; baseline: number } | null;
}

interface RingResult {
  ring: number;
  label: string;
  ok: boolean;
  warn: boolean;
  hard_flaw: boolean;
  detail: string;
}

interface SevenRingData {
  available: boolean;
  updated_at?: string;
  rings?: RingResult[];
  hard_flaws?: number;
  ratchet_max?: number;
  ratchet_breached?: boolean;
  pass?: boolean;
  audited_at?: string;
}

interface RatchetMetric {
  name: string;
  label: string;
  direction: 'only_up' | 'only_down';
  watermark: number;
  guard: string;
  source: string;
  skip_if_brain_unavailable?: boolean;
}

interface RatchetData {
  available: boolean;
  registry?: RatchetMetric[];
  error?: string;
}

type FetchState = 'loading' | 'done' | 'unavailable';

function LayerCard({ label, count, testId, color }: { label: string; count: number; testId: string; color: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1,
        minWidth: '140px',
        padding: '16px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        background: '#fff',
        borderTop: `3px solid ${color}`,
      }}
    >
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#111827' }}>{count}</div>
    </div>
  );
}

function StatCard({ label, count, testId }: { label: string; count: number; testId: string }) {
  const warn = count > 0;
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1,
        minWidth: '140px',
        padding: '16px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        background: '#fff',
      }}
    >
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color: warn ? '#d97706' : '#111827' }}>{count}</div>
    </div>
  );
}

function RingRow({ ring }: { ring: RingResult }) {
  const icon = ring.ok ? (ring.warn ? '⚠️' : '✅') : '❌';
  const bg = ring.ok ? (ring.warn ? '#fffbeb' : '#f0fdf4') : '#fef2f2';
  const border = ring.ok ? (ring.warn ? '#fbbf24' : '#10b981') : '#ef4444';
  return (
    <div
      data-testid={`seven-ring-row-${ring.ring}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: '6px',
        background: bg,
        border: `1px solid ${border}`,
        marginBottom: '6px',
      }}
    >
      <span style={{ fontSize: '16px', lineHeight: '1.4' }}>{icon}</span>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
          环{ring.ring}：{ring.label}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{ring.detail}</div>
      </div>
    </div>
  );
}

function BareFrCard({ count, baseline }: { count: number; baseline: number }) {
  const exceeded = count > baseline;
  return (
    <div
      data-testid="pyramid-bare-fr"
      style={{
        flex: 1,
        minWidth: '140px',
        padding: '16px',
        border: `1px solid ${exceeded ? '#ef4444' : '#e5e7eb'}`,
        borderTop: `3px solid ${exceeded ? '#ef4444' : '#f59e0b'}`,
        borderRadius: '8px',
        background: exceeded ? '#fef2f2' : '#fff',
      }}
    >
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>裸奔 FR（无守卫 live）</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color: exceeded ? '#dc2626' : '#111827' }}>{count}</div>
      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>基线 {baseline}，只许降</div>
    </div>
  );
}

export default function TestPyramidPage() {
  const [data, setData] = useState<PyramidData | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [sevenRing, setSevenRing] = useState<SevenRingData | null>(null);
  const [sevenRingState, setSevenRingState] = useState<FetchState>('loading');
  const [ratchet, setRatchet] = useState<RatchetData | null>(null);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const resp = await fetch('/api/brain/quality/test-pyramid');
        if (cancelled) return;
        if (!resp.ok) {
          setFetchState('unavailable');
          return;
        }
        const body: PyramidData = await resp.json();
        if (cancelled) return;
        if (!body || body.available === false) {
          setData(body ?? null);
          setFetchState('unavailable');
          return;
        }
        setData(body);
        setFetchState('done');
      } catch {
        if (!cancelled) setFetchState('unavailable');
      }
    }

    async function fetchSevenRing() {
      try {
        const resp = await fetch('/api/brain/quality/seven-ring');
        if (cancelled) return;
        if (!resp.ok) { setSevenRingState('unavailable'); return; }
        const body: SevenRingData = await resp.json();
        if (cancelled) return;
        if (!body || body.available === false) {
          setSevenRing(body ?? null);
          setSevenRingState('unavailable');
          return;
        }
        setSevenRing(body);
        setSevenRingState('done');
      } catch {
        if (!cancelled) setSevenRingState('unavailable');
      }
    }

    async function fetchRatchet() {
      try {
        const resp = await fetch('/api/brain/quality/ratchet');
        if (cancelled) return;
        if (!resp.ok) { setRatchet({ available: false }); return; }
        const body: RatchetData = await resp.json();
        if (cancelled) return;
        setRatchet(body);
      } catch {
        if (!cancelled) setRatchet({ available: false });
      }
    }

    fetchData();
    fetchSevenRing();
    fetchRatchet();
    return () => { cancelled = true; };
  }, []);

  async function triggerAudit() {
    setTriggering(true);
    try {
      const resp = await fetch('/api/brain/quality/seven-ring/trigger', { method: 'POST' });
      const body = await resp.json();
      if (body.rings) {
        setSevenRing({ available: true, ...body });
        setSevenRingState('done');
      }
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  }

  // 灰态：guard 数据不可用
  if (fetchState === 'unavailable') {
    return (
      <div data-testid="pyramid-container" style={{ padding: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>测试金字塔</h2>
        <div
          data-testid="pyramid-unavailable"
          style={{
            padding: '16px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            background: '#f3f4f6',
            color: '#6b7280',
          }}
        >
          guard 数据不可用{data?.error ? `：${data.error}` : ''}。
          等每日 03:30 面板日更，或手动 bash scripts/write-current-state.sh 喂数据。
        </div>
      </div>
    );
  }

  // 加载态
  if (fetchState === 'loading' || !data) {
    return (
      <div data-testid="pyramid-container" style={{ padding: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>测试金字塔</h2>
        <p>加载中...</p>
      </div>
    );
  }

  const failures = data.failures ?? [];
  const layers = data.permanent?.layers ?? { unit: 0, integration: 0 };
  const smokeTotal = data.smoke?.total ?? 0;
  const unwiredCount = data.smoke?.unwired?.length ?? 0;
  const orphansTotal = data.orphans?.total ?? 0;
  const bareFr = data.bare_fr ?? null;

  return (
    <div data-testid="pyramid-container" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>测试金字塔</h2>
        {data.pass ? (
          <span
            data-testid="pyramid-guard-pass"
            style={{
              padding: '2px 10px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 'bold',
              backgroundColor: '#10b981',
              color: '#fff',
            }}
          >
            守卫 PASS
          </span>
        ) : (
          <span
            style={{
              padding: '2px 10px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 'bold',
              backgroundColor: '#ef4444',
              color: '#fff',
            }}
          >
            守卫 FAIL
          </span>
        )}
        {data.panel?.generated && (
          <span data-testid="pyramid-generated" style={{ color: '#6b7280', fontSize: '13px' }}>
            面板生成于 {data.panel.generated}
          </span>
        )}
        {data.updated_at && (
          <span data-testid="pyramid-updated-at" style={{ color: '#6b7280', fontSize: '13px' }}>
            数据时间 {data.updated_at.replace('T', ' ').slice(0, 19)}
          </span>
        )}
      </div>

      {!data.pass && (
        <div
          data-testid="pyramid-guard-fail"
          style={{
            padding: '12px 16px',
            border: '1px solid #ef4444',
            borderLeft: '4px solid #ef4444',
            borderRadius: '6px',
            background: '#fef2f2',
            color: '#b91c1c',
            marginBottom: '16px',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: failures.length > 0 ? '8px' : 0 }}>
            守卫 FAIL — {failures.length} 条违规
          </div>
          {failures.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {failures.map((failure) => (
                <li key={failure} data-testid="pyramid-failure-item" style={{ fontSize: '13px' }}>
                  {failure}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <LayerCard label="Unit" count={layers.unit} testId="pyramid-layer-unit" color="#10b981" />
        <LayerCard label="Integration" count={layers.integration} testId="pyramid-layer-integration" color="#3b82f6" />
        <LayerCard label="E2E Smoke" count={smokeTotal} testId="pyramid-layer-e2e-smoke" color="#8b5cf6" />
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '32px' }}>
        <StatCard label="孤儿测试" count={orphansTotal} testId="pyramid-orphans" />
        <StatCard label="smoke 未挂跑道" count={unwiredCount} testId="pyramid-unwired" />
        {bareFr !== null && <BareFrCard count={bareFr.count} baseline={bareFr.baseline} />}
      </div>

      {/* ── 七环对账区块 ─────────────────────────────────────────────── */}
      <div data-testid="seven-ring-section" style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>七环对账</h3>
          {sevenRingState === 'done' && sevenRing && (
            <>
              {sevenRing.pass ? (
                <span
                  data-testid="seven-ring-pass"
                  style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', backgroundColor: '#10b981', color: '#fff' }}
                >
                  全环 PASS
                </span>
              ) : (
                <span
                  data-testid="seven-ring-fail"
                  style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', backgroundColor: '#ef4444', color: '#fff' }}
                >
                  硬伤 {sevenRing.hard_flaws}/{7}
                </span>
              )}
              {sevenRing.ratchet_breached && (
                <span
                  data-testid="seven-ring-ratchet-breached"
                  style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', backgroundColor: '#7c3aed', color: '#fff' }}
                >
                  棘轮击穿 &gt; {sevenRing.ratchet_max}
                </span>
              )}
              {sevenRing.audited_at && (
                <span style={{ color: '#6b7280', fontSize: '13px' }}>
                  对账时间 {sevenRing.audited_at.replace('T', ' ').slice(0, 16)}
                </span>
              )}
            </>
          )}
          <button
            data-testid="seven-ring-trigger-btn"
            onClick={triggerAudit}
            disabled={triggering}
            style={{
              marginLeft: 'auto',
              padding: '4px 12px',
              borderRadius: '4px',
              fontSize: '13px',
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: triggering ? 'not-allowed' : 'pointer',
              color: '#374151',
            }}
          >
            {triggering ? '审计中...' : '立即审计'}
          </button>
        </div>

        {sevenRingState === 'loading' && <p style={{ color: '#6b7280', fontSize: '14px' }}>加载七环数据...</p>}
        {sevenRingState === 'unavailable' && (
          <div
            data-testid="seven-ring-unavailable"
            style={{ padding: '14px', border: '1px solid #d1d5db', borderRadius: '8px', background: '#f3f4f6', color: '#6b7280', fontSize: '13px' }}
          >
            暂无七环对账数据。点击「立即审计」触发首次运行，或等待每日调度（24h 自 gate）。
          </div>
        )}
        {sevenRingState === 'done' && sevenRing?.rings && (
          <div data-testid="seven-ring-rings">
            {sevenRing.rings.map((ring) => (
              <RingRow key={ring.ring} ring={ring} />
            ))}
          </div>
        )}
      </div>

      {/* ── 棘轮水位区块 ─────────────────────────────────────────────── */}
      <div data-testid="ratchet-section" style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px', marginTop: '24px' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: '18px' }}>棘轮水位台账</h3>
        {(!ratchet || !ratchet.available || !ratchet.registry) ? (
          <div
            data-testid="ratchet-unavailable"
            style={{ padding: '14px', border: '1px solid #d1d5db', borderRadius: '8px', background: '#f3f4f6', color: '#6b7280', fontSize: '13px' }}
          >
            棘轮台账数据不可用。
          </div>
        ) : (
          <div data-testid="ratchet-table" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>指标</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>方向</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>水位</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>守卫</th>
                </tr>
              </thead>
              <tbody>
                {ratchet.registry.map((m) => (
                  <tr key={m.name} data-testid={`ratchet-row-${m.name}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px', color: '#111827' }}>
                      <span style={{ fontWeight: 500 }}>{m.label}</span>
                      <span style={{ color: '#9ca3af', marginLeft: '6px', fontSize: '11px' }}>{m.name}</span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '1px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: m.direction === 'only_up' ? '#ecfdf5' : '#fff7ed',
                        color: m.direction === 'only_up' ? '#059669' : '#d97706',
                      }}>
                        {m.direction === 'only_up' ? '↑只增' : '↓只降'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 700, color: '#111827' }}>
                      {m.watermark}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: '12px' }}>{m.guard}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
