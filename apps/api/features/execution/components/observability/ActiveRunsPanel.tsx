import { useEffect, useState } from 'react';
import { observabilityApi, type ActiveRun } from '../../api/observability.api';

interface ActiveRunsPanelProps {
  onSelectRun: (runId: string) => void;
  selectedRunId: string | null;
}

export function ActiveRunsPanel({ onSelectRun, selectedRunId }: ActiveRunsPanelProps) {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = async () => {
    try {
      const response = await observabilityApi.getActiveRuns();
      setRuns(response.data.data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch active runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000); // 5 秒刷新
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded">
        <p className="text-red-600">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Active Runs ({runs.length})</h3>
        <span className="text-sm text-gray-500">Auto-refresh: 5s</span>
      </div>
      
      {runs.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No active runs</div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.run_id}
              onClick={() => onSelectRun(run.run_id)}
              className={`p-3 border rounded cursor-pointer transition-colors ${
                selectedRunId === run.run_id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-mono text-sm text-gray-600">
                    {run.run_id.slice(0, 8)}...
                  </div>
                  <div className="text-sm mt-1">
                    <span className="font-semibold">{run.layer}</span> → {run.step_name}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                    run.status === 'running' ? 'bg-blue-100 text-blue-800' :
                    run.status === 'success' ? 'bg-green-100 text-green-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {run.status}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Math.floor(run.seconds_since_activity)}s ago
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
