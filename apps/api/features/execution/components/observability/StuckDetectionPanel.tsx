import { useEffect, useState } from 'react';
import { observabilityApi, type StuckRun } from '../../api/observability.api';

interface StuckDetectionPanelProps {
  onSelectRun: (runId: string) => void;
}

export function StuckDetectionPanel({ onSelectRun }: StuckDetectionPanelProps) {
  const [stuckRuns, setStuckRuns] = useState<StuckRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStuck = async () => {
      try {
        const response = await observabilityApi.getStuckRuns();
        setStuckRuns(response.data.data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch stuck runs');
      } finally {
        setLoading(false);
      }
    };

    fetchStuck();
    const interval = setInterval(fetchStuck, 10000); // 10 秒刷新
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="text-center text-gray-500">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded">
        <p className="text-red-600">Error: {error}</p>
      </div>
    );
  }

  if (stuckRuns.length === 0) {
    return (
      <div className="p-4 bg-green-50 border border-green-200 rounded">
        <p className="text-green-700">✅ No stuck runs detected</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold text-lg mb-4 text-red-600">
        ⚠️ Stuck Runs Detected ({stuckRuns.length})
      </h3>
      <div className="space-y-2">
        {stuckRuns.map((run) => (
          <div
            key={run.run_id}
            className="p-3 bg-red-50 border border-red-200 rounded cursor-pointer hover:bg-red-100"
            onClick={() => onSelectRun(run.run_id)}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-sm text-gray-600">
                  {run.run_id.slice(0, 12)}...
                </div>
                <div className="text-sm mt-1">
                  <span className="font-semibold">{run.layer}</span> → {run.step_name}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-red-600">
                  Stuck for {Math.floor(run.stuck_duration_seconds / 60)}m
                </div>
                <div className="text-xs text-gray-600">{run.executor_host}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
