import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { ViewMode, ColumnDef, FilterRule, DatabaseViewProps, CustomColumnDef } from './types';
import { ToolBar } from './ToolBar';
import { TableView } from './TableView';
import { BoardView } from './BoardView';
import { GalleryView } from './GalleryView';
import { ListView } from './ListView';
import { RowDetailPanel } from './RowDetailPanel';

// ── LocalStorage helpers ──────────────────────────────

interface SavedState {
  view?: ViewMode;
  hiddenCols?: string[];
  colOrder?: string[];
  sortField?: string;
  sortDir?: 'asc' | 'desc';
}

function loadState(key: string): SavedState {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(`dbview:${key}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveState(key: string, state: SavedState) {
  if (!key) return;
  try {
    localStorage.setItem(`dbview:${key}`, JSON.stringify(state));
  } catch {}
}

// ── Filter logic ──────────────────────────────────────

function applyFilters<T extends Record<string, unknown>>(data: T[], filters: FilterRule[], search: string, columns: ColumnDef[]): T[] {
  let result = data;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const textCols = columns.filter((c) => c.type === 'text');
    result = result.filter((row) => textCols.some((col) => String(row[col.id] ?? '').toLowerCase().includes(q)));
  }
  const activeFilters = filters.filter((f) => f.value !== '');
  for (const rule of activeFilters) {
    result = result.filter((row) => {
      const val = String(row[rule.field] ?? '').toLowerCase();
      const ruleVal = rule.value.toLowerCase();
      switch (rule.operator) {
        case 'is': return val === ruleVal;
        case 'is_not': return val !== ruleVal;
        case 'contains': return val.includes(ruleVal);
        case 'gt': return parseFloat(val) > parseFloat(ruleVal);
        case 'lt': return parseFloat(val) < parseFloat(ruleVal);
        default: return true;
      }
    });
  }
  return result;
}

function applySort<T extends Record<string, unknown>>(data: T[], sortField: string, sortDir: 'asc' | 'desc'): T[] {
  if (!sortField) return data;
  return [...data].sort((a, b) => {
    const av = a[sortField], bv = b[sortField];
    const an = typeof av === 'number' ? av : parseFloat(String(av ?? '0'));
    const bn = typeof bv === 'number' ? bv : parseFloat(String(bv ?? '0'));
    if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an;
    const as = String(av ?? '').toLowerCase(), bs = String(bv ?? '').toLowerCase();
    if (as < bs) return sortDir === 'asc' ? -1 : 1;
    if (as > bs) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Meta-Schema hook ──────────────────────────────────

function useCustomColumns(stateKey: string, staticColumns: ColumnDef[]): [ColumnDef[], () => void] {
  const [customCols, setCustomCols] = useState<ColumnDef[]>([]);

  const fetchSchema = useCallback(async () => {
    if (!stateKey) return;
    try {
      const res = await fetch(`/api/tasks/db-schema/${stateKey}`);
      if (!res.ok) return;
      const defs: CustomColumnDef[] = await res.json();
      setCustomCols(defs.map(d => ({
        id: d.col_id,
        label: d.col_label,
        type: d.col_type as ColumnDef['type'],
        options: d.options,
        width: d.col_width,
        sortable: true,
        editable: true,
      })));
    } catch {}
  }, [stateKey]);

  useEffect(() => { fetchSchema(); }, [fetchSchema]);

  const allColumns = useMemo(() => {
    const customIds = new Set(customCols.map(c => c.id));
    return [...staticColumns.filter(c => !customIds.has(c.id)), ...customCols];
  }, [staticColumns, customCols]);

  return [allColumns, fetchSchema];
}

// ── Main DatabaseView component ───────────────────────

export function DatabaseView<T extends { id: string }>({
  data, columns, onUpdate, onCreate, onDelete, onRowNavigate,
  loading = false, boardGroupField, renderGalleryCard, renderListItem,
  defaultView = 'table', stats, stateKey = '',
}: DatabaseViewProps<T>) {
  const [allColumns, refreshCustomCols] = useCustomColumns(stateKey, columns);

  // Load persisted state (with validation)
  const saved = useMemo(() => {
    const s = loadState(stateKey);
    if (s.colOrder) {
      const validIds = new Set(allColumns.map(c => c.id));
      s.colOrder = s.colOrder.filter(id => validIds.has(id));
      if (s.colOrder.length === 0) delete s.colOrder;
    }
    const validViews: ViewMode[] = ['table', 'board', 'gallery', 'list'];
    if (s.view && !validViews.includes(s.view)) delete s.view;
    return s;
  }, [stateKey, allColumns]);

  const [view, setView] = useState<ViewMode>(saved.view ?? defaultView);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [sortField, setSortField] = useState(saved.sortField ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(saved.sortDir ?? 'asc');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (saved.hiddenCols) return new Set(saved.hiddenCols);
    return new Set(allColumns.filter((c) => c.hidden).map((c) => c.id));
  });
  const [colOrder, setColOrder] = useState<string[]>(() => {
    if (saved.colOrder?.length) return saved.colOrder;
    return allColumns.map((c) => c.id);
  });
  const [search, setSearch] = useState('');
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeBoardGroupField, setActiveBoardGroupField] = useState<string>(
    boardGroupField ?? allColumns.find((c) => c.type === 'select' || c.type === 'badge')?.id ?? ''
  );

  // Sync colOrder when custom columns change
  useEffect(() => {
    setColOrder(prev => {
      const existingIds = new Set(prev);
      const newIds = allColumns.map(c => c.id).filter(id => !existingIds.has(id));
      return newIds.length > 0 ? [...prev, ...newIds] : prev;
    });
  }, [allColumns]);

  // Persist state changes
  useEffect(() => {
    if (!stateKey) return;
    saveState(stateKey, { view, hiddenCols: [...hiddenCols], colOrder, sortField, sortDir });
  }, [view, hiddenCols, colOrder, sortField, sortDir, stateKey]);

  // ESC to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreen(false);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const effectiveBoardGroupField = activeBoardGroupField || boardGroupField || allColumns.find((c) => c.type === 'select' || c.type === 'badge')?.id || '';

  const boardGroupOptions = useMemo(
    () => allColumns
      .filter((c) => c.type !== 'progress' && c.type !== 'relation' && c.type !== 'url' && c.type !== 'email' && c.type !== 'phone')
      .map((c) => ({ id: c.id, label: c.label })),
    [allColumns]
  );

  const orderedCols = useMemo(() => {
    const orderMap = Object.fromEntries(colOrder.map((id, i) => [id, i]));
    return [...allColumns].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999));
  }, [allColumns, colOrder]);

  const visibleCols = useMemo(() => orderedCols.filter((c) => !hiddenCols.has(c.id)), [orderedCols, hiddenCols]);

  const processedData = useMemo(() => {
    const filtered = applyFilters(data as unknown as Record<string, unknown>[], filters, search, allColumns);
    const sorted = applySort(filtered, sortField, sortDir);
    return sorted as unknown as T[];
  }, [data, filters, search, allColumns, sortField, sortDir]);

  function handleSortChange(field: string, dir: 'asc' | 'desc') {
    setSortField(field);
    setSortDir(dir);
  }

  function handleToggleCol(colId: string) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  }

  function handleReorderCols(fromId: string, toId: string) {
    setColOrder((prev) => {
      const order = [...prev];
      const allIds = allColumns.map(c => c.id);
      const workOrder = allIds.map(id => {
        const idx = order.indexOf(id);
        return { id, rank: idx >= 0 ? idx : 999 };
      }).sort((a, b) => a.rank - b.rank).map(x => x.id);

      const fromIdx = workOrder.indexOf(fromId);
      const toIdx = workOrder.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return order;
      workOrder.splice(fromIdx, 1);
      workOrder.splice(toIdx, 0, fromId);
      return workOrder;
    });
  }

  async function handleAddProperty(label: string, type: ColumnDef['type']) {
    if (!stateKey || !label.trim()) return;
    const col_id = 'prop_' + Math.random().toString(36).slice(2, 9);
    await fetch(`/api/tasks/db-schema/${stateKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ col_id, col_label: label.trim(), col_type: type }),
    });
    refreshCustomCols();
  }

  const detailRow = detailRowId ? data.find((d) => d.id === detailRowId) ?? null : null;

  const toolbar = (
    <ToolBar
      view={view} onViewChange={setView}
      columns={orderedCols} filters={filters} onFiltersChange={setFilters}
      sortField={sortField} sortDir={sortDir} onSortChange={handleSortChange}
      hiddenCols={hiddenCols} onToggleCol={handleToggleCol} onReorderCols={handleReorderCols}
      search={search} onSearchChange={setSearch} stats={stats}
      boardGroupField={activeBoardGroupField}
      boardGroupOptions={boardGroupOptions}
      onBoardGroupChange={setActiveBoardGroupField}
      fullscreen={fullscreen}
      onFullscreenToggle={() => setFullscreen((v) => !v)}
      stateKey={stateKey}
      onAddProperty={stateKey ? handleAddProperty : undefined}
    />
  );

  const content = (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {view === 'table' && (
          <TableView
            data={processedData} columns={allColumns} visibleCols={visibleCols}
            sortField={sortField} sortDir={sortDir} onSortChange={handleSortChange}
            onUpdate={onUpdate}
            onCreate={onCreate ? () => onCreate({} as Partial<T>) : undefined}
            onRowClick={(id) => setDetailRowId((prev) => (prev === id ? null : id))}
            onDelete={onDelete}
            onReorderCols={handleReorderCols}
            selectedRowId={detailRowId}
            groupByField={activeBoardGroupField || undefined}
          />
        )}
        {view === 'board' && (
          <BoardView data={processedData} columns={allColumns} boardGroupField={effectiveBoardGroupField} onUpdate={onUpdate} onCreate={onCreate} />
        )}
        {view === 'gallery' && (
          <GalleryView data={processedData} columns={allColumns} renderGalleryCard={renderGalleryCard} onUpdate={onUpdate} onDelete={onDelete}
            onCreate={onCreate ? () => onCreate({} as Partial<T>) : undefined}
            groupByField={activeBoardGroupField || undefined} />
        )}
        {view === 'list' && (
          <ListView data={processedData} columns={allColumns} renderListItem={renderListItem}
            onCreate={onCreate ? () => onCreate({} as Partial<T>) : undefined}
            onUpdate={onUpdate}
            groupByField={activeBoardGroupField || undefined} />
        )}
      </div>
      {detailRow && (
        <RowDetailPanel row={detailRow} columns={orderedCols} onClose={() => setDetailRowId(null)} onUpdate={onUpdate} onDelete={onDelete} onNavigate={onRowNavigate} />
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-slate-800 overflow-hidden">
        <div className="h-10 bg-slate-800 border-b border-slate-700 animate-pulse" />
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 bg-slate-700 rounded animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>
      </div>
    );
  }

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-slate-900 overflow-hidden">
        {toolbar}
        {content}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-800 overflow-hidden">
      {toolbar}
      {content}
    </div>
  );
}

export type { ColumnDef, FilterRule, DatabaseViewProps, DatabaseViewStats, ViewMode } from './types';
