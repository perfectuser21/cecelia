import { useState } from 'react';
import { Play, RefreshCw, Activity, Trash2, RotateCcw } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

interface QuickActionsBarProps {
  onRunQA: () => void;
  onSyncNotion: () => void;
  onHealthCheck: () => void;
  onClearQueue: () => void;
  onRestartWorker: () => void;
  queueLength?: number;
  workerStatus?: string;
}

export default function QuickActionsBar({
  onRunQA,
  onSyncNotion,
  onHealthCheck,
  onClearQueue,
  onRestartWorker,
  queueLength = 0,
  workerStatus = 'unknown',
}: QuickActionsBarProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const handleClearQueue = () => {
    setShowClearConfirm(false);
    onClearQueue();
  };

  const handleRestartWorker = () => {
    setShowRestartConfirm(false);
    onRestartWorker();
  };

  return (
    <>
      <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={onRunQA}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition font-medium"
          >
            <Play className="w-4 h-4" />
            Run QA Now
          </button>

          <button
            onClick={onSyncNotion}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Sync Notion
          </button>

          <button
            onClick={onHealthCheck}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
          >
            <Activity className="w-4 h-4" />
            Health Check
          </button>

          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Clear Queue
          </button>

          <button
            onClick={() => setShowRestartConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
          >
            <RotateCcw className="w-4 h-4" />
            Restart Worker
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear Queue"
        message="This will delete all pending tasks in the queue."
        details={`Current queue: ${queueLength} tasks`}
        confirmText="Clear Queue"
        onConfirm={handleClearQueue}
        onCancel={() => setShowClearConfirm(false)}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showRestartConfirm}
        title="Restart Worker"
        message="This will restart the worker process."
        details={`Current status: ${workerStatus}`}
        confirmText="Restart"
        onConfirm={handleRestartWorker}
        onCancel={() => setShowRestartConfirm(false)}
        variant="warning"
      />
    </>
  );
}
