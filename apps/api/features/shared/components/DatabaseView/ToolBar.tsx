import React, { useState } from 'react';
import { Table2, LayoutGrid, Image, List, SlidersHorizontal, ArrowUpDown, Columns, Search, Layers, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import type { ViewMode, ColumnDef, FilterRule } from './types';
import { FilterPanel, SortPanel, PropertiesPanel } from './FilterPanel';

interface ToolBarStats {
  total: number;
  byStatus?: Record<string, number>;
}

interface ToolBarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  columns: ColumnDef[];
  filters: FilterRule[];
  onFiltersChange: (f: FilterRule[]) => void;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (field: string, dir: 'asc' | 'desc') => void;
  hiddenCols: Set<string>;
  onToggleCol: (colId: string) => void;
  onReorderCols?: (fromId: string, toId: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  stats?: ToolBarStats;
  boardGroupField?: string;
  boardGroupOptions?: Array<{ id: string; label: string }>;
  onBoardGroupChange?: (fieldId: string) => void;
  fullscreen?: boolean;
  onFullscreenToggle?: () => void;
  stateKey?: string;
  onAddProperty?: (label: string, type: ColumnDef['type']) => Promise<void>;
}

const VIEW_TABS: { id: ViewMode; icon: React.ReactNode; label: string }[] = [
  { id: 'table', icon: <Table2 className="w-3.5 h-3.5" />, label: 'Table' },
  { id: 'board', icon: <LayoutGrid className="w-3.5 h-3.5" />, label: 'Board' },
  { id: 'gallery', icon: <Image className="w-3.5 h-3.5" />, label: 'Gallery' },
  { id: 'list', icon: <List className="w-3.5 h-3.5" />, label: 'List' },
];

const PROP_TYPES: Array<{ value: ColumnDef['type']; label: string; icon: string }> = [
  { value: 'text',         label: '文本',   icon: 'Aa' },
  { value: 'number',       label: '数字',   icon: '#' },
  { value: 'date',         label: '日期',   icon: '📅' },
  { value: 'select',       label: '单选',   icon: '◉' },
  { value: 'badge',        label: '标签',   icon: '🏷' },
  { value: 'multi_select', label: '多选',   icon: '☰' },
  { value: 'checkbox',     label: '勾选',   icon: '✓' },
  { value: 'url',          label: '链接',   icon: '🔗' },
  { value: 'email',        label: '邮件',   icon: '✉' },
  { value: 'phone',        label: '电话',   icon: '📱' },
  { value: 'progress',     label: '进度条', icon: '▬' },
];

function AddPropertyModal({ onAdd, onClose }: {
  onAdd: (label: string, type: ColumnDef['type']) => Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ColumnDef['type']>('text');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    await onAdd(label, type);
    setSaving(false);
    onClose();
  }

  return (
    <div className="absolute right-0 top-10 z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4 w-64">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-300">添加属性</span>
        <button onClick={onClose} className="p-0.5 hover:bg-slate-700 rounded"><X className="w-3.5 h-3.5 text-slate-400" /></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">属性名称</label>
          <input
            autoFocus
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="输入名称..."
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">属性类型</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as ColumnDef['type'])}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
          >
            {PROP_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!label.trim() || saving}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium py-1.5 rounded-lg transition-colors"
        >
          {saving ? '添加中...' : '+ 添加'}
        </button>
      </form>
    </div>
  );
}

export function ToolBar({
  view, onViewChange, columns, filters, onFiltersChange,
  sortField, sortDir, onSortChange, hiddenCols, onToggleCol,
  onReorderCols, search, onSearchChange, stats,
  boardGroupField, boardGroupOptions, onBoardGroupChange,
  fullscreen, onFullscreenToggle,
  onAddProperty,
}: ToolBarProps) {
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const [showAddProp, setShowAddProp] = useState(false);

  const filterCount = filters.filter((f) => f.value !== '').length;

  function closeAll() { setShowFilter(false); setShowSort(false); setShowProps(false); setShowAddProp(false); }

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 bg-slate-800 flex-wrap shrink-0">
      {/* View tabs */}
      <div className="flex items-center bg-slate-700/60 rounded-lg p-0.5 gap-0.5">
        {VIEW_TABS.map((tab) => (
          <button key={tab.id} onClick={() => onViewChange(tab.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              view === tab.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-slate-600/70'
            }`}>
            {tab.icon}<span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-slate-700 mx-1" />

      {/* Filter */}
      <div className="relative">
        <button onClick={() => { setShowFilter(v => !v); setShowSort(false); setShowProps(false); setShowAddProp(false); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterCount > 0 || showFilter ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-slate-700'
          }`}>
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>过滤{filterCount > 0 ? ` ${filterCount}` : ''}</span>
        </button>
        {showFilter && <FilterPanel columns={columns} filters={filters} onFiltersChange={onFiltersChange} onClose={() => setShowFilter(false)} />}
      </div>

      {/* Sort */}
      <div className="relative">
        <button onClick={() => { setShowSort(v => !v); setShowFilter(false); setShowProps(false); setShowAddProp(false); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            sortField || showSort ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-slate-700'
          }`}>
          <ArrowUpDown className="w-3.5 h-3.5" /><span>排序</span>
        </button>
        {showSort && <SortPanel columns={columns} sortField={sortField} sortDir={sortDir} onSortChange={onSortChange} onClose={() => setShowSort(false)} />}
      </div>

      {/* Columns (table/list only) */}
      {(view === 'table' || view === 'list') && (
        <div className="relative">
          <button onClick={() => { setShowProps(v => !v); setShowFilter(false); setShowSort(false); setShowAddProp(false); }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showProps ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-slate-700'
            }`}>
            <Columns className="w-3.5 h-3.5" /><span>列</span>
          </button>
          {showProps && <PropertiesPanel columns={columns} hiddenCols={hiddenCols} onToggle={onToggleCol} onReorder={onReorderCols} onClose={() => setShowProps(false)} />}
        </div>
      )}

      {/* + 添加属性 (only when stateKey provided) */}
      {onAddProperty && (
        <div className="relative">
          <button
            onClick={() => { setShowAddProp(v => !v); closeAll(); setShowAddProp(true); }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showAddProp ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <Plus className="w-3.5 h-3.5" /><span>属性</span>
          </button>
          {showAddProp && (
            <AddPropertyModal
              onAdd={onAddProperty}
              onClose={() => setShowAddProp(false)}
            />
          )}
        </div>
      )}

      {/* Group by (all views) */}
      {boardGroupOptions && boardGroupOptions.length > 0 && onBoardGroupChange && (
        <div className="flex items-center gap-1.5 text-xs">
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">分组:</span>
          <select
            value={boardGroupField ?? ''}
            onChange={(e) => onBoardGroupChange(e.target.value)}
            className="text-xs border border-slate-600 rounded-lg px-2 py-1 bg-slate-700 text-gray-300 focus:outline-none focus:border-blue-500"
          >
            {boardGroupOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Search */}
      <div className="ml-auto flex items-center gap-1.5 bg-slate-700/60 rounded-lg px-2.5 py-1.5">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索..." className="bg-transparent text-xs text-white placeholder-slate-500 outline-none w-28" />
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">{stats.total} 条</span>
          {stats.byStatus?.in_progress ? (
            <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded">进行中 {stats.byStatus.in_progress}</span>
          ) : null}
          {stats.byStatus?.active ? (
            <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">活跃 {stats.byStatus.active}</span>
          ) : null}
        </div>
      )}

      {/* Fullscreen toggle */}
      {onFullscreenToggle && (
        <button
          onClick={onFullscreenToggle}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          title={fullscreen ? '退出全屏' : '全屏'}
        >
          {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
