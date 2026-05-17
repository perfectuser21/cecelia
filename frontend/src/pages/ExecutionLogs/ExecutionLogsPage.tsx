import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader2, FileText } from 'lucide-react';
import { brainApi } from '../../api/brain.api';
import { LogFilters } from '../../components/ExecutionLogs/LogFilters';
import { LogViewerPanel } from '../../components/ExecutionLogs/LogViewerPanel';
import type { LogFilters as LogFiltersType, CeceliaRun } from '../../types/execution-logs';

export default function ExecutionLogsPage() {
  const [runs, setRuns] = useState<CeceliaRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<CeceliaRun | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<LogFiltersType>({});

  // Fetch runs list
  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [filters.status]);

  // Fetch logs when selectedRun changes or when run is still running
  useEffect(() => {
    if (selectedRun) {
      fetchLogs();
      if (selectedRun.status === 'running') {
        const interval = setInterval(fetchLogs, 3000); // Poll every 3 seconds for running tasks
        return () => clearInterval(interval);
      }
    }
  }, [selectedRun?.id, selectedRun?.status]);

  const fetchRuns = async () => {
    try {
      setLoading(true);
      const response = await brainApi.getCeceliaRuns({
        status: filters.status as any,
        limit: 50
      });
      setRuns(response.runs || []);
      setError('');

      // If a run is selected, update it from the list
      if (selectedRun) {
        const updatedRun = response.runs?.find(r => r.id === selectedRun.id);
        if (updatedRun) {
          setSelectedRun(updatedRun);
        }
      }
    } catch (err: any) {
      setError(err.message || '获取任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    if (!selectedRun) return;

    try {
      setLogsLoading(true);
      const response = await brainApi.getCeceliaRunLogs(selectedRun.id);
      setLogs(response.logs || []);
    } catch (err: any) {
      console.error('Failed to fetch logs:', err);
      // Don't set error here as it might be transient
    } finally {
      setLogsLoading(false);
    }
  };

  const handleFiltersChange = (newFilters: LogFiltersType) => {
    setFilters(newFilters);
  };

  const handleFiltersReset = () => {
    setFilters({});
  };

  const getStatusBadge = (status: CeceliaRun['status']) => {
    const badges = {
      queued: 'bg-gray-100 text-gray-700',
      running: 'bg-blue-100 text-blue-700',
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700'
    };
    const labels = {
      queued: '排队中',
      running: '运行中',
      completed: '已完成',
      failed: '失败'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${badges[status]}`}>
        {labels[status]}
      </span>
    );
  };

  // Filter runs based on filters
  const filteredRuns = runs.filter(run => {
    if (filters.runId && !run.id.includes(filters.runId)) return false;
    if (filters.startDate && new Date(run.created_at) < new Date(filters.startDate)) return false;
    if (filters.endDate && new Date(run.created_at) > new Date(filters.endDate)) return false;
    return true;
  });

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">执行日志</h1>
            <p className="text-sm text-gray-500">查看 Cecelia 任务执行日志</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <LogFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onReset={handleFiltersReset}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Runs List */}
        <div className="w-96 bg-white border-r border-gray-200 overflow-auto">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">
              任务列表 ({filteredRuns.length})
            </h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              暂无任务记录
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredRuns.map(run => (
                <div
                  key={run.id}
                  onClick={() => setSelectedRun(run)}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedRun?.id === run.id
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-medium text-gray-900 text-sm truncate flex-1">
                      {run.task_id}
                    </div>
                    {getStatusBadge(run.status)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(run.created_at).toLocaleString('zh-CN')}
                  </div>
                  {run.agent && (
                    <div className="text-xs text-gray-400 mt-1">
                      Agent: {run.agent}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs Viewer */}
        <div className="flex-1 p-6 overflow-hidden">
          {selectedRun ? (
            <LogViewerPanel
              logs={logs}
              runId={selectedRun.id}
              status={selectedRun.status}
              searchText={filters.searchText}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-white rounded-lg border border-gray-200">
              <div className="text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>请选择一个任务查看日志</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
