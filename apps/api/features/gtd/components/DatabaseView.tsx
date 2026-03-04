/**
 * DatabaseView — Notion 风格的通用数据库视图组件
 * 支持：列排序、状态筛选、搜索、行展开
 */

import { useState, useMemo, useCallback } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, Filter, X,
  ChevronRight, ChevronDown, Loader2,
} from 'lucide-react';

// ── 类型 ──────────────────────────────────────────────

export interface Column<T> {
  key: string;
  label: string;
  width?: string;        // tailwind width class, e.g. 'w-24'
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  getValue?: (row: T) => string | number;  // for sorting
}

export interface DatabaseViewProps<T> {
  title: string;
  icon?: React.ReactNode;
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  getRowId: (row: T) => string;
  // 可选：行内展开子项
  getChildren?: (row: T) => T[];
  childIndent?: boolean;
  // 可选：筛选
  filterOptions?: FilterOption[];
  // 可选：搜索
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  // 可选：统计
  footer?: React.ReactNode;
  // 可选：行点击
  onRowClick?: (row: T) => void;
  // 空状态
  emptyText?: string;
}

export interface FilterOption {
  key: string;
  label: string;
  values: { value: string; label: string; color?: string }[];
}

// ── 状态/优先级通用渲染 ──────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active:      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  in_progress: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',
  completed:   'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  pending:     'bg-slate-500/15 text-slate-400 border border-slate-500/25',
  paused:      'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  queued:      'bg-slate-500/15 text-slate-400 border border-slate-500/25',
  failed:      'bg-red-500/15 text-red-400 border border-red-500/25',
  quarantined: 'bg-red-500/15 text-red-400 border border-red-500/25',
};

const STATUS_LABELS: Record<string, string> = {
  active:      '活跃',
  in_progress: '进行中',
  completed:   '已完成',
  pending:     '待开始',
  paused:      '暂停',
  queued:      '排队中',
  failed:      '失败',
  quarantined: '隔离',
};

const PRIORITY_STYLES: Record<string, string> = {
  P0: 'text-red-400 font-semibold',
  P1: 'text-amber-400',
  P2: 'text-slate-500',
  P3: 'text-slate-600',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`text-xs ${PRIORITY_STYLES[priority] ?? ''}`}>
      {priority}
    </span>
  );
}

export function ProgressBar({ value, color = 'bg-blue-500' }: { value: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-slate-500 w-8 text-right tabular-nums">{pct}%</span>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

export default function DatabaseView<T>({
  title,
  icon,
  columns,
  data,
  loading,
  getRowId,
  getChildren,
  childIndent = true,
  filterOptions,
  searchPlaceholder = '搜索...',
  searchFilter,
  footer,
  onRowClick,
  emptyText = '暂无数据',
}: DatabaseViewProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // 排序
  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // 筛选 + 搜索
  const filteredData = useMemo(() => {
    let result = data;

    // 搜索
    if (searchQuery && searchFilter) {
      result = result.filter(row => searchFilter(row, searchQuery));
    }

    // 筛选
    for (const [key, value] of Object.entries(activeFilters)) {
      if (!value) continue;
      const col = columns.find(c => c.key === key);
      if (col?.getValue) {
        result = result.filter(row => String(col.getValue!(row)) === value);
      }
    }

    return result;
  }, [data, searchQuery, searchFilter, activeFilters, columns]);

  // 排序后数据
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.getValue) return filteredData;

    return [...filteredData].sort((a, b) => {
      const va = col.getValue!(a);
      const vb = col.getValue!(b);
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sortKey, sortDir, columns]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const hasActiveFilters = Object.values(activeFilters).some(Boolean);

  const renderRow = (row: T, depth: number = 0) => {
    const id = getRowId(row);
    const children = getChildren?.(row) ?? [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(id);

    return (
      <div key={id}>
        <div
          className={`group flex items-center gap-2 px-4 py-2 border-b border-slate-800/40 text-sm transition-colors ${
            onRowClick ? 'cursor-pointer' : ''
          } ${depth === 0 ? 'hover:bg-slate-800/30' : 'hover:bg-slate-800/20 bg-slate-900/20'}`}
          style={childIndent && depth > 0 ? { paddingLeft: `${16 + depth * 24}px` } : undefined}
          onClick={() => onRowClick?.(row)}
        >
          {/* 展开/折叠 */}
          {getChildren && (
            <button
              className="w-5 h-5 flex items-center justify-center shrink-0 text-slate-500 hover:text-slate-300"
              onClick={(e) => { e.stopPropagation(); hasChildren && toggleCollapse(id); }}
            >
              {hasChildren
                ? isCollapsed
                  ? <ChevronRight className="w-3.5 h-3.5" />
                  : <ChevronDown className="w-3.5 h-3.5" />
                : null}
            </button>
          )}

          {/* 列内容 */}
          {columns.map(col => (
            <div
              key={col.key}
              className={`${col.width ?? 'flex-1'} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} min-w-0 shrink-0`}
            >
              {col.render(row)}
            </div>
          ))}
        </div>

        {/* 子行 */}
        {hasChildren && !isCollapsed && children.map(child => renderRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 工具栏 */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          {icon}
          <span>{title}</span>
          <span className="text-slate-500 font-normal text-xs">
            {loading ? '...' : `${filteredData.length} 条`}
          </span>
        </div>

        <div className="flex-1" />

        {/* 搜索 */}
        {searchFilter && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-gray-300 placeholder-slate-500 focus:outline-none focus:border-slate-600 w-48"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* 筛选按钮 */}
        {filterOptions && filterOptions.length > 0 && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
              hasActiveFilters
                ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-300'
            }`}
          >
            <Filter className="w-3 h-3" />
            筛选
          </button>
        )}
      </div>

      {/* 筛选面板 */}
      {showFilters && filterOptions && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-800/30">
          {filterOptions.map(opt => (
            <div key={opt.key} className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">{opt.label}:</span>
              <select
                value={activeFilters[opt.key] ?? ''}
                onChange={(e) => setActiveFilters(prev => ({ ...prev, [opt.key]: e.target.value }))}
                className="text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-gray-300 focus:outline-none"
              >
                <option value="">全部</option>
                {opt.values.map(v => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
          ))}
          {hasActiveFilters && (
            <button
              onClick={() => setActiveFilters({})}
              className="text-[11px] text-slate-500 hover:text-slate-300 ml-auto"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {/* 表头 */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900/60">
        {getChildren && <span className="w-5 shrink-0" />}
        {columns.map(col => (
          <div
            key={col.key}
            className={`${col.width ?? 'flex-1'} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} min-w-0 shrink-0 ${
              col.sortable ? 'cursor-pointer hover:text-slate-300 select-none' : ''
            } flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}
            onClick={() => col.sortable && handleSort(col.key)}
          >
            {col.label}
            {col.sortable && (
              sortKey === col.key
                ? sortDir === 'asc'
                  ? <ArrowUp className="w-3 h-3 text-blue-400" />
                  : <ArrowDown className="w-3 h-3 text-blue-400" />
                : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
            )}
          </div>
        ))}
      </div>

      {/* 数据行 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : sortedData.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            {emptyText}
          </div>
        ) : (
          sortedData.map(row => renderRow(row))
        )}
      </div>

      {/* 底部统计 */}
      {footer && (
        <div className="shrink-0 px-4 py-2 text-xs text-slate-600 border-t border-slate-800 flex items-center gap-4">
          {footer}
        </div>
      )}
    </div>
  );
}
