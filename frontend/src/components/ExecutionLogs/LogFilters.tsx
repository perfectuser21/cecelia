import React from 'react';
import { Filter, X } from 'lucide-react';
import type { LogFilters as LogFiltersType } from '../../types/execution-logs';

interface LogFiltersProps {
  filters: LogFiltersType;
  onFiltersChange: (filters: LogFiltersType) => void;
  onReset: () => void;
}

export const LogFilters: React.FC<LogFiltersProps> = ({
  filters,
  onFiltersChange,
  onReset
}) => {
  const handleChange = (key: keyof LogFiltersType, value: string) => {
    onFiltersChange({
      ...filters,
      [key]: value || undefined
    });
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== undefined && v !== '');

  return (
    <div className="bg-white border-b border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-gray-600" />
        <h3 className="font-semibold text-gray-900">筛选条件</h3>
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="ml-auto text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            清空
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">任务 ID</label>
          <input
            type="text"
            placeholder="输入任务 ID"
            value={filters.runId || ''}
            onChange={(e) => handleChange('runId', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">状态</label>
          <select
            value={filters.status || ''}
            onChange={(e) => handleChange('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部状态</option>
            <option value="queued">排队中</option>
            <option value="running">运行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">开始时间</label>
          <input
            type="datetime-local"
            value={filters.startDate || ''}
            onChange={(e) => handleChange('startDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">结束时间</label>
          <input
            type="datetime-local"
            value={filters.endDate || ''}
            onChange={(e) => handleChange('endDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs text-gray-600 mb-1">搜索日志内容</label>
        <input
          type="text"
          placeholder="输入关键词搜索日志..."
          value={filters.searchText || ''}
          onChange={(e) => handleChange('searchText', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
};
