import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

interface ExecutionProgressProps {
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  currentStep: number;
  stepName: string;
}

export function ExecutionProgress({
  status,
  progress,
  currentStep,
  stepName,
}: ExecutionProgressProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'queued':
        return <Circle className="w-5 h-5 text-slate-400" />;
      case 'in_progress':
        return <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-400" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-400" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'queued':
        return 'bg-slate-500/20 border-slate-500/30';
      case 'in_progress':
        return 'bg-purple-500/20 border-purple-500/30';
      case 'completed':
        return 'bg-green-500/20 border-green-500/30';
      case 'failed':
        return 'bg-red-500/20 border-red-500/30';
    }
  };

  const getProgressBarColor = () => {
    switch (status) {
      case 'queued':
        return 'bg-slate-500';
      case 'in_progress':
        return 'bg-purple-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
    }
  };

  const displayProgress = status === 'completed' ? 100 : progress;

  return (
    <div className="space-y-3">
      {/* Status badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${getStatusColor()}`}>
        {getStatusIcon()}
        <span className="text-sm font-medium text-slate-200">
          {status === 'queued' && 'Queued'}
          {status === 'in_progress' && 'In Progress'}
          {status === 'completed' && 'Completed'}
          {status === 'failed' && 'Failed'}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">
            Step {currentStep}: {stepName}
          </span>
          <span className="text-slate-400">{displayProgress}%</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-out ${getProgressBarColor()}`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
