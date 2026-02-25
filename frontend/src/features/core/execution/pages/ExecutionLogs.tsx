import { useParams } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import LogViewer from '../components/LogViewer';

export default function ExecutionLogs() {
  const { runId } = useParams<{ runId?: string }>();

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-800">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <ScrollText className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              {runId ? `执行日志 - ${runId}` : '系统日志'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {runId ? '查看任务执行的详细日志' : '查看系统运行日志'}
            </p>
          </div>
        </div>
      </div>

      {/* Log Viewer */}
      <div className="flex-1 overflow-hidden">
        <LogViewer runId={runId} />
      </div>
    </div>
  );
}
