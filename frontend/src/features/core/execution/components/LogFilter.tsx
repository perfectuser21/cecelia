import { useState } from 'react';
import { Search, Filter, X } from 'lucide-react';

export interface LogFilterOptions {
  levels: Array<'DEBUG' | 'INFO' | 'WARN' | 'ERROR'>;
  searchQuery: string;
  startTime?: string;
  endTime?: string;
}

interface LogFilterProps {
  filters: LogFilterOptions;
  onFilterChange: (filters: LogFilterOptions) => void;
}

const LEVEL_OPTIONS: Array<'DEBUG' | 'INFO' | 'WARN' | 'ERROR'> = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export default function LogFilter({ filters, onFilterChange }: LogFilterProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleLevel = (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') => {
    const newLevels = filters.levels.includes(level)
      ? filters.levels.filter(l => l !== level)
      : [...filters.levels, level];
    onFilterChange({ ...filters, levels: newLevels });
  };

  const clearFilters = () => {
    onFilterChange({
      levels: LEVEL_OPTIONS,
      searchQuery: '',
      startTime: undefined,
      endTime: undefined,
    });
  };

  const hasActiveFilters =
    filters.levels.length !== LEVEL_OPTIONS.length ||
    filters.searchQuery ||
    filters.startTime ||
    filters.endTime;

  return (
    <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索日志..."
            value={filters.searchQuery}
            onChange={e => onFilterChange({ ...filters, searchQuery: e.target.value })}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent outline-none"
          />
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
        >
          <Filter className="w-4 h-4" />
          筛选
          {hasActiveFilters && (
            <span className="ml-1 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full">
              {filters.levels.length !== LEVEL_OPTIONS.length ? filters.levels.length : ''}
            </span>
          )}
        </button>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="清除筛选"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Expanded Filters */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-gray-200 dark:border-slate-700 pt-3">
          {/* Level Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              日志级别
            </label>
            <div className="flex flex-wrap gap-2">
              {LEVEL_OPTIONS.map(level => {
                const isSelected = filters.levels.includes(level);
                return (
                  <button
                    key={level}
                    onClick={() => toggleLevel(level)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isSelected
                        ? level === 'DEBUG'
                          ? 'bg-gray-500 text-white'
                          : level === 'INFO'
                          ? 'bg-blue-500 text-white'
                          : level === 'WARN'
                          ? 'bg-yellow-500 text-white'
                          : 'bg-red-500 text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Range Filter */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                开始时间
              </label>
              <input
                type="datetime-local"
                value={filters.startTime || ''}
                onChange={e => onFilterChange({ ...filters, startTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                结束时间
              </label>
              <input
                type="datetime-local"
                value={filters.endTime || ''}
                onChange={e => onFilterChange({ ...filters, endTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
