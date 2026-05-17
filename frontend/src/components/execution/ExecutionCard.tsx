import { Clock, Play, CheckCircle2, XCircle } from 'lucide-react';
import type { ExecutionStatus } from '../../hooks/useExecutionStatus';
import { ExecutionProgress } from './ExecutionProgress';

interface ExecutionCardProps {
  execution: ExecutionStatus;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ExecutionCard({ execution, isSelected = false, onClick }: ExecutionCardProps) {
  const formatTimestamp = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDuration = () => {
    if (!execution.startedAt) return '';
    const end = execution.completedAt || new Date();
    const duration = Math.floor((end.getTime() - execution.startedAt.getTime()) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg border transition-all cursor-pointer ${
        isSelected
          ? 'bg-purple-500/10 border-purple-500/50 shadow-lg shadow-purple-500/20'
          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-slate-200 truncate">{execution.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
            <span>{execution.runId.slice(0, 8)}</span>
            {execution.agent && (
              <>
                <span>•</span>
                <span>{execution.agent}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <ExecutionProgress
          status={execution.status}
          progress={execution.progress}
          currentStep={execution.currentStep}
          stepName={execution.stepName}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          {execution.status === 'queued' && <Clock className="w-3.5 h-3.5" />}
          {execution.status === 'in_progress' && <Play className="w-3.5 h-3.5 text-purple-400" />}
          {execution.status === 'completed' && (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          )}
          {execution.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
          <span>{formatTimestamp(execution.startedAt)}</span>
        </div>
        {(execution.status === 'completed' || execution.status === 'failed') && (
          <span>{getDuration()}</span>
        )}
      </div>

      {/* Error message if failed */}
      {execution.status === 'failed' && execution.error && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
          {execution.error}
        </div>
      )}
    </div>
  );
}
