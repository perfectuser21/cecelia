import { useEffect, useState } from 'react';
import { observabilityApi, type RunEvent } from '../../api/observability.api';

interface ExecutionTraceViewerProps {
  runId: string | null;
}

const LAYER_COLORS = {
  L0_orchestrator: 'bg-purple-100 text-purple-800',
  L1_brain: 'bg-blue-100 text-blue-800',
  L2_executor: 'bg-green-100 text-green-800',
  L3_browser: 'bg-yellow-100 text-yellow-800',
  L4_artifact: 'bg-pink-100 text-pink-800',
};

const STATUS_COLORS = {
  queued: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  blocked: 'bg-orange-100 text-orange-800',
  retrying: 'bg-yellow-100 text-yellow-800',
  canceled: 'bg-gray-100 text-gray-800',
};

export function ExecutionTraceViewer({ runId }: ExecutionTraceViewerProps) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }

    const fetchTrace = async () => {
      setLoading(true);
      try {
        const response = await observabilityApi.getRun(runId);
        setEvents(response.data.data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch trace');
      } finally {
        setLoading(false);
      }
    };

    fetchTrace();
  }, [runId]);

  if (!runId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Select a run to view execution trace
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading trace...</div>
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
    <div className="space-y-3">
      <h3 className="font-semibold text-lg mb-4">
        Execution Trace ({events.length} spans)
      </h3>
      
      {events.map((event, index) => (
        <div key={event.id} className="border rounded p-3">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-24">
              <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${LAYER_COLORS[event.layer] || 'bg-gray-100'}`}>
                {event.layer}
              </span>
            </div>
            <div className="flex-1">
              <div className="font-semibold">{event.step_name}</div>
              <div className="text-sm text-gray-600 mt-1">
                Attempt #{event.attempt} • {event.executor_host}
              </div>
              {event.reason_code && (
                <div className="text-sm text-red-600 mt-1">
                  {event.reason_kind}: {event.reason_code}
                </div>
              )}
            </div>
            <div className="flex-shrink-0">
              <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${STATUS_COLORS[event.status] || 'bg-gray-100'}`}>
                {event.status}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
