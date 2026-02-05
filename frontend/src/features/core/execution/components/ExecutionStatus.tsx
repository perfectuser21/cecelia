import { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, AlertCircle } from 'lucide-react';
import { brainApi, type VpsSlot } from '../../../../api/brain.api';
import { TaskCard } from './TaskCard';

export interface ExecutionStatusProps {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function ExecutionStatus({
  autoRefresh = true,
  refreshInterval = 5000,
}: ExecutionStatusProps) {
  const [slots, setSlots] = useState<VpsSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const response = await brainApi.getVpsSlots();

      if (response.success) {
        setSlots(response.slots);
        setError(null);
        setLastUpdate(new Date());
      } else {
        setError('Failed to load execution status');
      }
    } catch (err) {
      console.error('Failed to load execution status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadData();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, loadData]);

  const handleManualRefresh = () => {
    if (!isRefreshing) {
      loadData();
    }
  };

  const activeTasks = slots.filter(slot => slot.taskId !== null);
  const hasActiveTasks = activeTasks.length > 0;

  if (loading && !lastUpdate) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading execution status...</span>
        </div>
      </div>
    );
  }

  if (error && !lastUpdate) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Execution Status
            </h2>
            <p className="text-sm text-gray-500">
              {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''} running
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {lastUpdate && (
            <span className="text-sm text-gray-500">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Refresh now"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">Error loading data</p>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Task list */}
      {hasActiveTasks ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeTasks.map((slot) => (
            <TaskCard key={slot.pid} slot={slot} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Activity className="w-12 h-12 text-gray-400 mb-3" />
          <p className="text-lg font-medium text-gray-600 mb-1">
            No active tasks
          </p>
          <p className="text-sm text-gray-500">
            Tasks will appear here when they start executing
          </p>
        </div>
      )}
    </div>
  );
}
