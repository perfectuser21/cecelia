import { useEffect, useState, useCallback } from 'react';

const PHASES = ['planning', 'gan', 'generate', 'evaluate', 'judge', 'merge', 'report'] as const;
type Phase = typeof PHASES[number];
type PhaseStatus = 'completed' | 'running' | 'pending';

interface RelayRun {
  initiative_id: string;
  current_phase: string;
  phases: Record<Phase, PhaseStatus>;
  verdict?: string;
  cost?: number;
}

interface RelayRunsResponse {
  runs: RelayRun[];
}

const PHASE_LABELS: Record<Phase, string> = {
  planning: 'Planning',
  gan: 'GAN',
  generate: 'Generate',
  evaluate: 'Evaluate',
  judge: 'Judge',
  merge: 'Merge',
  report: 'Report',
};

function phaseClass(status: PhaseStatus): string {
  switch (status) {
    case 'completed': return 'bg-green-500 text-white';
    case 'running': return 'bg-blue-500 text-white animate-pulse';
    case 'pending': return 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  }
}

function getPhaseStatus(run: RelayRun, phase: Phase): PhaseStatus {
  if (run.phases?.[phase]) return run.phases[phase];
  const currentIdx = PHASES.indexOf(run.current_phase as Phase);
  const phaseIdx = PHASES.indexOf(phase);
  if (phaseIdx < currentIdx) return 'completed';
  if (phaseIdx === currentIdx) return 'running';
  return 'pending';
}

export default function RelayProgressPage() {
  const [runs, setRuns] = useState<RelayRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/orchestrator/relay-runs?limit=20');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RelayRunsResponse = await res.json();
      setRuns(data.runs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const timer = setInterval(fetchRuns, 15_000);
    return () => clearInterval(timer);
  }, [fetchRuns]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Harness 进度
      </h1>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="text-red-500 text-sm py-4">加载失败：{error}</div>
      )}

      {!loading && !error && runs.length === 0 && (
        <div
          data-testid="relay-empty-state"
          className="text-center py-12 text-gray-500 dark:text-gray-400"
        >
          暂无进行中的 relay
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div data-testid="relay-progress-list" className="space-y-4">
          {runs.map((run) => (
            <div
              key={run.initiative_id}
              data-testid="relay-run-item"
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                  {run.initiative_id.slice(0, 8)}
                </span>
                <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  {run.current_phase}
                </span>
                {run.verdict && (
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                    {run.verdict}
                  </span>
                )}
                {run.cost != null && (
                  <span className="text-xs text-gray-400">${run.cost.toFixed(3)}</span>
                )}
              </div>

              <div className="flex gap-1">
                {PHASES.map((phase) => {
                  const status = getPhaseStatus(run, phase);
                  return (
                    <div
                      key={phase}
                      className={`flex-1 py-1 px-1 rounded text-center text-xs font-medium transition-colors ${phaseClass(status)}`}
                      title={phase}
                    >
                      {PHASE_LABELS[phase]}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
