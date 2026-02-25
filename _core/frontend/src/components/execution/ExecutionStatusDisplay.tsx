import { useState } from 'react';
import { Wifi, WifiOff, Activity } from 'lucide-react';
import { useExecutionStatus } from '../../hooks/useExecutionStatus';
import { ExecutionCard } from './ExecutionCard';
import { ExecutionLogs } from './ExecutionLogs';

export function ExecutionStatusDisplay() {
  const { executions, activeExecutions, completedExecutions, logs, isConnected } =
    useExecutionStatus();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const selectedExecution = executions.find((exec) => exec.runId === selectedRunId);
  const selectedLogs = selectedRunId ? logs.get(selectedRunId) || [] : [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Activity className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-200">Execution Monitor</h1>
            <p className="text-sm text-slate-500">Real-time task execution status</p>
          </div>
        </div>

        {/* Connection status */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
            isConnected
              ? 'bg-green-500/20 border border-green-500/30'
              : 'bg-red-500/20 border border-red-500/30'
          }`}
        >
          {isConnected ? (
            <Wifi className="w-4 h-4 text-green-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-400" />
          )}
          <span className="text-sm font-medium text-slate-200">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        {/* Left sidebar - Execution list */}
        <div className="lg:col-span-1 flex flex-col overflow-hidden">
          <div className="space-y-4 overflow-y-auto">
            {/* Active executions */}
            {activeExecutions.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-slate-400 mb-3">
                  Active ({activeExecutions.length})
                </h2>
                <div className="space-y-2">
                  {activeExecutions.map((exec) => (
                    <ExecutionCard
                      key={exec.runId}
                      execution={exec}
                      isSelected={selectedRunId === exec.runId}
                      onClick={() => setSelectedRunId(exec.runId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed executions */}
            {completedExecutions.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-slate-400 mb-3">
                  Completed ({completedExecutions.length})
                </h2>
                <div className="space-y-2">
                  {completedExecutions.slice(0, 10).map((exec) => (
                    <ExecutionCard
                      key={exec.runId}
                      execution={exec}
                      isSelected={selectedRunId === exec.runId}
                      onClick={() => setSelectedRunId(exec.runId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {executions.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <Activity className="w-12 h-12 mb-2 opacity-50" />
                <p className="text-sm">No executions yet</p>
                <p className="text-xs mt-1">Task executions will appear here</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel - Details and logs */}
        <div className="lg:col-span-2 flex flex-col overflow-hidden">
          {selectedExecution ? (
            <div className="flex-1 flex flex-col overflow-hidden space-y-4">
              {/* Execution details */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-medium text-slate-200 mb-3">
                  {selectedExecution.title}
                </h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">Run ID:</span>
                    <span className="ml-2 text-slate-300 font-mono">
                      {selectedExecution.runId}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Agent:</span>
                    <span className="ml-2 text-slate-300">{selectedExecution.agent || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Started:</span>
                    <span className="ml-2 text-slate-300">
                      {selectedExecution.startedAt
                        ? selectedExecution.startedAt.toLocaleString()
                        : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Status:</span>
                    <span className="ml-2 text-slate-300 capitalize">
                      {selectedExecution.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Logs */}
              <div className="flex-1 overflow-hidden">
                <ExecutionLogs logs={selectedLogs} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Select an execution to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
