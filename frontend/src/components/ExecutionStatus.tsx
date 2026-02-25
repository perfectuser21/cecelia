import { useEffect, useState, useCallback } from 'react';
import { Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface ExecutionRun {
  id: string;
  project: string;
  feature_branch: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  total_checkpoints: number;
  completed_checkpoints: number;
  failed_checkpoints: number;
  current_checkpoint: string | null;
  started_at: string;
  updated_at: string;
}

interface ExecutionOverview {
  total_runs: number;
  running: number;
  completed: number;
  failed: number;
  active_processes: number;
  recent_runs: ExecutionRun[];
  live_processes?: Array<{ pid: number; task_id: string; started_at: string }>;
}

interface ExecutionStatusProps {
  apiBaseUrl?: string;
  refreshInterval?: number;
  showDetails?: boolean;
}

export function ExecutionStatus({
  apiBaseUrl = '/api/brain',
  refreshInterval = 2000,
  showDetails = false
}: ExecutionStatusProps) {
  const [overview, setOverview] = useState<ExecutionOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Fetch execution status from API
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/cecelia/overview`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setOverview(data);
        setError(null);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
      console.error('[ExecutionStatus] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl]);

  // Setup WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('[ExecutionStatus] WebSocket connected');
      setWsConnected(true);
      setError(null);
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[ExecutionStatus] WebSocket message:', message);

        // On task status change, refresh the overview
        if (message.event && message.event.startsWith('task:')) {
          fetchStatus();
        }
      } catch (err) {
        console.error('[ExecutionStatus] Failed to parse WebSocket message:', err);
      }
    };

    websocket.onerror = (event) => {
      console.error('[ExecutionStatus] WebSocket error:', event);
      setWsConnected(false);
    };

    websocket.onclose = () => {
      console.log('[ExecutionStatus] WebSocket disconnected');
      setWsConnected(false);
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, [fetchStatus]);

  // Polling fallback when WebSocket is not connected
  useEffect(() => {
    fetchStatus(); // Initial fetch

    if (!wsConnected) {
      const interval = setInterval(fetchStatus, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [wsConnected, fetchStatus, refreshInterval]);

  // Helper functions
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'in_progress':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700 border-gray-300',
      in_progress: 'bg-blue-100 text-blue-700 border-blue-300',
      completed: 'bg-green-100 text-green-700 border-green-300',
      failed: 'bg-red-100 text-red-700 border-red-300'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.pending}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString();
    } catch {
      return timestamp;
    }
  };

  if (isLoading) {
    return (
      <div className="w-full bg-white rounded-lg border shadow-sm">
        <div className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
          <span className="ml-2 text-gray-500">Loading execution status...</span>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="w-full bg-white rounded-lg border border-red-200 shadow-sm">
        <div className="p-6">
          <div className="flex items-center text-red-600">
            <XCircle className="h-5 w-5 mr-2" />
            <span>Error: {error}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-white rounded-lg border shadow-sm">
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold">Execution Status</h3>
            {wsConnected ? (
              <span className="px-2 py-1 rounded-full text-xs font-medium border border-green-300 bg-green-50 text-green-700">
                <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                Live
              </span>
            ) : (
              <span className="px-2 py-1 rounded-full text-xs font-medium border border-gray-300 bg-gray-50 text-gray-500">
                Polling ({refreshInterval / 1000}s)
              </span>
            )}
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-600 font-medium">Running</div>
            <div className="text-2xl font-bold text-blue-700">{overview?.running || 0}</div>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-green-600 font-medium">Completed</div>
            <div className="text-2xl font-bold text-green-700">{overview?.completed || 0}</div>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <div className="text-xs text-red-600 font-medium">Failed</div>
            <div className="text-2xl font-bold text-red-700">{overview?.failed || 0}</div>
          </div>
          <div className="p-3 bg-purple-50 rounded-lg">
            <div className="text-xs text-purple-600 font-medium">Active</div>
            <div className="text-2xl font-bold text-purple-700">{overview?.active_processes || 0}</div>
          </div>
        </div>

        {/* Recent Runs */}
        {expanded && overview?.recent_runs && overview.recent_runs.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Recent Runs</h4>
            <div className="h-64 md:h-80 overflow-y-auto rounded border">
              <div className="space-y-2 p-3">
                {overview.recent_runs.map((run) => (
                  <div
                    key={run.id}
                    className="p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(run.status)}
                          <h5 className="font-medium text-sm truncate">{run.project}</h5>
                        </div>
                        {run.feature_branch && (
                          <div className="text-xs text-gray-500 truncate">
                            Branch: {run.feature_branch}
                          </div>
                        )}
                      </div>
                      {getStatusBadge(run.status)}
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>
                        Progress: {run.completed_checkpoints}/{run.total_checkpoints}
                      </span>
                      <span>{formatTimestamp(run.updated_at)}</span>
                    </div>

                    {run.current_checkpoint && (
                      <div className="mt-2 text-xs text-gray-500">
                        Current: {run.current_checkpoint}
                      </div>
                    )}

                    {run.status === 'in_progress' && (
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                            style={{
                              width: `${(run.completed_checkpoints / run.total_checkpoints) * 100}%`
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {expanded && (!overview?.recent_runs || overview.recent_runs.length === 0) && (
          <div className="text-center py-8 text-gray-500">
            <Clock className="h-12 w-12 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No recent executions</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExecutionStatus;
