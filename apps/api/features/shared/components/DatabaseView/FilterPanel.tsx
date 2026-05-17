import React, { useRef, useEffect, useState } from 'react';
import { Plus, X, SlidersHorizontal, GripVertical } from 'lucide-react';
import type { FilterRule, ColumnDef } from './types';

const OPERATORS = [
  { value: 'is', label: '等于' },
  { value: 'is_not', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
] as const;

interface FilterPanelProps {
  columns: ColumnDef[];
  filters: FilterRule[];
  onFiltersChange: (filters: FilterRule[]) => void;
  onClose: () => void;
}

export function FilterPanel({ columns, filters, onFiltersChange, onClose }: FilterPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filterableCols = columns.filter((c) => c.filterable !== false);

  function addRule() {
    const firstCol = filterableCols[0];
    if (!firstCol) return;
    onFiltersChange([...filters, { id: `f-${Date.now()}`, field: firstCol.id, operator: 'is', value: '' }]);
  }

  function updateRule(id: string, patch: Partial<FilterRule>) {
    onFiltersChange(filters.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRule(id: string) {
    onFiltersChange(filters.filter((r) => r.id !== id));
  }

  return (
    <div ref={ref} className="absolute top-full mt-2 left-0 z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-4 min-w-[480px]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-gray-200">过滤条件</span>
        </div>
        <div className="flex items-center gap-2">
          {filters.length > 0 && (
            <button onClick={() => onFiltersChange([])} className="text-xs text-red-400 hover:text-red-300 transition-colors">清除全部</button>
          )}
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {filters.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-2">暂无过滤条件</p>
        ) : (
          filters.map((rule) => {
            const col = filterableCols.find((c) => c.id === rule.field);
            return (
              <div key={rule.id} className="flex items-center gap-2">
                <select value={rule.field} onChange={(e) => updateRule(rule.id, { field: e.target.value, value: '' })}
                  className="flex-1 text-sm border border-slate-600 rounded-lg px-2 py-1.5 bg-slate-900 text-gray-300 focus:outline-none focus:border-blue-500">
                  {filterableCols.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select value={rule.operator} onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterRule['operator'] })}
                  className="text-sm border border-slate-600 rounded-lg px-2 py-1.5 bg-slate-900 text-gray-300 focus:outline-none focus:border-blue-500">
                  {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                </select>
                {col?.type === 'select' || col?.type === 'badge' ? (
                  <select value={rule.value} onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    className="flex-1 text-sm border border-slate-600 rounded-lg px-2 py-1.5 bg-slate-900 text-gray-300 focus:outline-none focus:border-blue-500">
                    <option value="">全部</option>
                    {(col.options ?? []).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  <input type={col?.type === 'number' || col?.type === 'progress' ? 'number' : 'text'}
                    value={rule.value} onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    placeholder="值..." className="flex-1 text-sm border border-slate-600 rounded-lg px-2 py-1.5 bg-slate-900 text-gray-300 focus:outline-none focus:border-blue-500 placeholder-slate-500" />
                )}
                <button onClick={() => removeRule(rule.id)} className="p-1 hover:bg-red-900/40 rounded transition-colors text-slate-400 hover:text-red-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      <button onClick={addRule} className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors">
        <Plus className="w-3.5 h-3.5" />添加过滤条件
      </button>
    </div>
  );
}

interface SortPanelProps {
  columns: ColumnDef[];
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (field: string, dir: 'asc' | 'desc') => void;
  onClose: () => void;
}

export function SortPanel({ columns, sortField, sortDir, onSortChange, onClose }: SortPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const sortableCols = columns.filter((c) => c.sortable);

  return (
    <div ref={ref} className="absolute top-full mt-2 left-0 z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-4 min-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-200">排序</span>
        <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded"><X className="w-4 h-4 text-slate-400" /></button>
      </div>
      <div className="flex items-center gap-2">
        <select value={sortField} onChange={(e) => onSortChange(e.target.value, sortDir)}
          className="flex-1 text-sm border border-slate-600 rounded-lg px-2 py-1.5 bg-slate-900 text-gray-300 focus:outline-none focus:border-blue-500">
          <option value="">无排序</option>
          {sortableCols.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={sortDir} onChange={(e) => onSortChange(sortField, e.target.value as 'asc' | 'desc')}
          className="text-sm border border-slate-600 rounded-lg px-2 py-1.5 bg-slate-900 text-gray-300 focus:outline-none focus:border-blue-500">
          <option value="asc">升序 A→Z</option>
          <option value="desc">降序 Z→A</option>
        </select>
      </div>
    </div>
  );
}

interface PropertiesPanelProps {
  columns: ColumnDef[];
  hiddenCols: Set<string>;
  onToggle: (colId: string) => void;
  onReorder?: (fromId: string, toId: string) => void;
  onClose: () => void;
}

export function PropertiesPanel({ columns, hiddenCols, onToggle, onReorder, onClose }: PropertiesPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute top-full mt-2 right-0 z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-4 min-w-[220px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-200">显示列</span>
        <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded"><X className="w-4 h-4 text-slate-400" /></button>
      </div>
      <div className="space-y-0.5">
        {columns.map((col) => (
          <div
            key={col.id}
            draggable={!!onReorder}
            onDragStart={() => { dragIdRef.current = col.id; }}
            onDragOver={(e) => { e.preventDefault(); setDragOverId(col.id); }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={() => {
              if (dragIdRef.current && dragIdRef.current !== col.id && onReorder) {
                onReorder(dragIdRef.current, col.id);
              }
              setDragOverId(null);
              dragIdRef.current = null;
            }}
            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
              dragOverId === col.id ? 'bg-indigo-600/30 border border-indigo-500/50' : 'hover:bg-slate-700'
            }`}
          >
            {onReorder && <GripVertical className="w-3.5 h-3.5 text-slate-500 cursor-grab shrink-0" />}
            <input type="checkbox" checked={!hiddenCols.has(col.id)} onChange={() => onToggle(col.id)}
              className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer" onClick={(e) => e.stopPropagation()} />
            <span className="text-sm text-gray-300 flex-1">{col.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
