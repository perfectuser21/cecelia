import { useState } from 'react';
import { ActiveRunsPanel } from '../components/observability/ActiveRunsPanel';
import { ExecutionTraceViewer } from '../components/observability/ExecutionTraceViewer';
import { FailureAnalysisChart } from '../components/observability/FailureAnalysisChart';
import { StuckDetectionPanel } from '../components/observability/StuckDetectionPanel';

export default function ObservabilityDashboard() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Observability Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Real-time execution monitoring and failure analysis
        </p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Active Runs */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow p-4">
          <ActiveRunsPanel
            onSelectRun={setSelectedRunId}
            selectedRunId={selectedRunId}
          />
        </div>

        {/* Right: Execution Trace */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-4 max-h-[600px] overflow-y-auto">
          <ExecutionTraceViewer runId={selectedRunId} />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Failure Analysis */}
        <div className="bg-white rounded-lg shadow p-4">
          <FailureAnalysisChart />
        </div>

        {/* Stuck Detection */}
        <div className="bg-white rounded-lg shadow p-4">
          <StuckDetectionPanel onSelectRun={setSelectedRunId} />
        </div>
      </div>
    </div>
  );
}
