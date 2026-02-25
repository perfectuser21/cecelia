import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, ArrowUpDown, Plus, ChevronLeft, ChevronRight, Maximize2, Trash2, GripHorizontal, ChevronDown, ChevronRight as ChevronR } from 'lucide-react';
import type { ColumnDef } from './types';
import { InlineEdit, BadgeDisplay } from './InlineEdit';

const PAGE_SIZE = 50;

interface TableViewProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef[];
  visibleCols: ColumnDef[];
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (field: string, dir: 'asc' | 'desc') => void;
  onUpdate?: (id: string, field: string, value: unknown) => Promise<void>;
  onCreate?: () => void;
  onRowClick?: (id: string) => void;
  onDelete?: (id: string) => Promise<void>;
  onReorderCols?: (fromId: string, toId: string) => void;
  selectedRowId?: string | null;
  groupByField?: string;
}

function groupData<T extends Record<string, unknown>>(data: T[], field: string, columns: ColumnDef[]) {
  const col = columns.find(c => c.id === field);
  const groups: Map<string, T[]> = new Map();
  for (const row of data) {
    const val = String(row[field] ?? '');
    const label = (col?.options?.find(o => o.value === val)?.label ?? val) || '（未分组）';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(row);
  }
  return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }));
}

function SortIcon({ colId, sortField, sortDir }: { colId: string; sortField: string; sortDir: 'asc' | 'desc' }) {
  if (sortField !== colId) return <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />;
  return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-400" /> : <ArrowDown className="w-3 h-3 text-blue-400" />;
}

export function TableView<T extends { id: string }>({
  data, visibleCols, columns, sortField, sortDir, onSortChange,
  onUpdate, onCreate, onRowClick, onDelete, onReorderCols, selectedRowId,
  groupByField,
}: TableViewProps<T>) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const groups = groupByField ? groupData(data as unknown as Record<string, unknown>[], groupByField, columns) : null;
  const flatData = groups ? groups.flatMap(g => g.rows) : data;
  const totalPages = groups ? 1 : Math.ceil(data.length / PAGE_SIZE);
  const pageData = groups ? flatData : data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(colId: string) {
    onSortChange(colId, sortField === colId && sortDir === 'asc' ? 'desc' : 'asc');
  }

  function handleResizeStart(colId: string, startX: number, startWidth: number) {
    const onMove = (e: MouseEvent) => {
      setColumnWidths(prev => ({ ...prev, [colId]: Math.max(80, startWidth + e.clientX - startX) }));
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function toggleGroup(label: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  function renderRow(row: T) {
    const isSelected = selectedRowId === row.id;
    return (
      <tr key={row.id} className={`group border-b border-slate-700/30 transition-colors ${isSelected ? 'bg-slate-700/80' : 'hover:bg-slate-700/40'}`}>
        <td className={`py-2 px-2 sticky left-0 z-10 ${isSelected ? 'bg-slate-700/80' : 'bg-slate-800 group-hover:bg-slate-700/40'}`}>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded border border-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            {onRowClick && (
              <button onClick={(e) => { e.stopPropagation(); onRowClick(row.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-slate-600 rounded text-slate-400 hover:text-blue-400 shrink-0">
                <Maximize2 className="w-3 h-3" />
              </button>
            )}
            {onDelete && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-red-900/40 rounded text-slate-400 hover:text-red-400 shrink-0">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </td>
        {visibleCols.map((col) => (
          <td key={col.id} className="py-1.5 px-3 align-middle text-gray-100">
            <InlineEdit value={(row as Record<string, unknown>)[col.id]} col={col} onSave={(v) => onUpdate?.(row.id, col.id, v)} rowId={row.id} onNavigate={navigate} />
          </td>
        ))}
      </tr>
    );
  }

  const colGroup = columns.find(c => c.id === groupByField);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="w-10 py-2 px-2 sticky left-0 bg-slate-900 z-10" />
              {visibleCols.map((col) => {
                const colWidth = columnWidths[col.id] || col.width || 150;
                const isDragOver = dragOverColId === col.id && dragColId !== col.id;
                return (
                  <th key={col.id}
                    draggable={!!onReorderCols}
                    onDragStart={(e) => { setDragColId(col.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverColId(col.id); }}
                    onDragLeave={() => setDragOverColId(null)}
                    onDrop={(e) => { e.preventDefault(); if (dragColId && dragColId !== col.id && onReorderCols) onReorderCols(dragColId, col.id); setDragColId(null); setDragOverColId(null); }}
                    onDragEnd={() => { setDragColId(null); setDragOverColId(null); }}
                    className={`py-2 px-3 text-left text-xs font-semibold bg-slate-900 group select-none transition-colors ${col.sortable ? 'cursor-pointer hover:text-white' : ''} ${isDragOver ? 'bg-indigo-900/30 text-indigo-300' : 'text-slate-400'} ${dragColId === col.id ? 'opacity-50' : ''}`}
                    style={{ width: colWidth, minWidth: 80, position: 'relative', userSelect: 'none' }}
                    onClick={() => col.sortable && !dragColId && handleSort(col.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      {onReorderCols && <GripHorizontal className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />}
                      {col.label}
                      {col.sortable && <SortIcon colId={col.id} sortField={sortField} sortDir={sortDir} />}
                    </div>
                    <div
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleResizeStart(col.id, e.clientX, colWidth); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', backgroundColor: 'transparent' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(99,102,241,0.5)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups ? (
              groups.map(({ label, rows }) => {
                const collapsed = collapsedGroups.has(label);
                return (
                  <React.Fragment key={label}>
                    {/* Group header */}
                    <tr className="border-b border-slate-700/50 bg-slate-900/60">
                      <td colSpan={visibleCols.length + 1} className="py-1.5 px-3">
                        <button
                          onClick={() => toggleGroup(label)}
                          className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                        >
                          {collapsed ? <ChevronR className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {colGroup?.type === 'badge' || colGroup?.type === 'select'
                            ? <BadgeDisplay value={colGroup?.options?.find(o => o.label === label)?.value ?? label} options={colGroup?.options} />
                            : <span>{label}</span>
                          }
                          <span className="text-slate-500 font-normal">{rows.length}</span>
                        </button>
                      </td>
                    </tr>
                    {!collapsed && (rows as T[]).map(row => renderRow(row))}
                  </React.Fragment>
                );
              })
            ) : (
              pageData.map(row => renderRow(row))
            )}
            {pageData.length === 0 && !groups && (
              <tr><td colSpan={visibleCols.length + 1} className="py-12 text-center text-slate-500 text-sm">无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700/50 bg-slate-800/50 shrink-0">
        {onCreate ? (
          <button onClick={onCreate} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors">
            <Plus className="w-3.5 h-3.5" />新建
          </button>
        ) : (
          <span className="text-xs text-slate-500">{data.length} 条记录</span>
        )}
        {!groups && totalPages > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">第 {page + 1} / {totalPages} 页</span>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 hover:bg-slate-700 rounded disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5 text-slate-400" /></button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 hover:bg-slate-700 rounded disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5 text-slate-400" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
