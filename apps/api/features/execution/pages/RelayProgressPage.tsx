import { useState, useEffect } from 'react';

interface RelayRun {
  initiative_id: string;
  phase: string;
  judge_verdict: string | null;
  cost_usd: number | null;
}

const PHASES = ['planning', 'gan', 'generate', 'evaluate', 'judge', 'merge', 'report'] as const;

export function stripPhasePrefix(phase: string): string {
  return phase.replace(/^[A-Z]_/, '');
}

function getPhaseIndex(phase: string): number {
  const stripped = stripPhasePrefix(phase);
  return PHASES.indexOf(stripped as (typeof PHASES)[number]);
}

function PhaseBar({ currentPhase }: { currentPhase: string }) {
  const currentIndex = getPhaseIndex(currentPhase);

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
      {PHASES.map((phase, index) => {
        const isCurrent = index === currentIndex;
        const isDone = index < currentIndex;

        return (
          <span
            key={phase}
            data-testid={`phase-label-${phase}`}
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: isCurrent ? 'bold' : 'normal',
              backgroundColor: isCurrent
                ? '#3b82f6'
                : isDone
                  ? '#10b981'
                  : '#d1d5db',
              color: isCurrent || isDone ? '#fff' : '#6b7280',
            }}
          >
            {phase}
          </span>
        );
      })}
    </div>
  );
}

type FetchState = 'idle' | 'loading' | 'done' | 'error';

export default function RelayProgressPage() {
  const [runs, setRuns] = useState<RelayRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');

  async function fetchRuns() {
    try {
      const resp = await fetch('/api/brain/orchestrator/relay-runs');
      if (!resp.ok) {
        setError(`请求失败: ${resp.status} ${resp.statusText}`);
        setFetchState('error');
        return;
      }
      const data: RelayRun[] = await resp.json();
      setRuns(data);
      setError(null);
      setFetchState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
      setFetchState('error');
    }
  }

  useEffect(() => {
    fetchRuns();
    const timer = setInterval(() => {
      fetchRuns();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Error state
  if (fetchState === 'error') {
    return (
      <div data-testid="relay-progress-container" style={{ padding: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>Relay 进度</h2>
        <div data-testid="relay-progress-error" style={{ color: '#ef4444', padding: '12px', border: '1px solid #ef4444', borderRadius: '6px' }}>
          错误: {error}
        </div>
      </div>
    );
  }

  // Empty state (fetch done, no runs)
  if (fetchState === 'done' && runs.length === 0) {
    return (
      <div data-testid="relay-progress-container" style={{ padding: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>Relay 进度</h2>
        <p data-testid="relay-progress-empty">暂无进行中的 relay</p>
      </div>
    );
  }

  // Data state
  if (fetchState === 'done' && runs.length > 0) {
    return (
      <div data-testid="relay-progress-container" style={{ padding: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>Relay 进度</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {runs.map((run) => {
            const shortId = run.initiative_id.substring(0, 8);
            const displayPhase = stripPhasePrefix(run.phase);

            return (
              <div
                key={run.initiative_id}
                data-testid="relay-progress-row"
                style={{
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#374151' }}>
                    {shortId}
                  </span>
                  <span style={{ color: '#6b7280', fontSize: '13px' }}>
                    当前: <strong>{displayPhase}</strong>
                  </span>
                  {run.judge_verdict !== null && run.judge_verdict !== undefined && (
                    <span style={{ color: '#059669', fontSize: '13px' }}>
                      verdict: {run.judge_verdict}
                    </span>
                  )}
                  {run.cost_usd !== null && run.cost_usd !== undefined && (
                    <span style={{ color: '#7c3aed', fontSize: '13px' }}>
                      cost: ${run.cost_usd}
                    </span>
                  )}
                </div>
                <PhaseBar currentPhase={run.phase} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Loading / idle state
  return (
    <div data-testid="relay-progress-container" style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '16px' }}>Relay 进度</h2>
      <p>加载中...</p>
    </div>
  );
}
