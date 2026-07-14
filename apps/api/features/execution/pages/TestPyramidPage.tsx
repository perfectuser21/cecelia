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

export default function TestPyramidPage() {
  const [data, setData] = useState<PyramidData | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('loading');

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

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

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

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <StatCard label="孤儿测试" count={orphansTotal} testId="pyramid-orphans" />
        <StatCard label="smoke 未挂跑道" count={unwiredCount} testId="pyramid-unwired" />
      </div>
    </div>
  );
}
