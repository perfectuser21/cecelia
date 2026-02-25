import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ColumnDef } from './types';
import { BadgeDisplay, ProgressDisplay } from './InlineEdit';

interface GalleryViewProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef[];
  renderGalleryCard?: (row: T) => React.ReactNode;
  onUpdate?: (id: string, field: string, value: unknown) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onCreate?: () => void;
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

function CardGrid<T extends { id: string }>({ rows, columns, titleCol, renderGalleryCard }: {
  rows: T[];
  columns: ColumnDef[];
  titleCol: ColumnDef | undefined;
  renderGalleryCard?: (row: T) => React.ReactNode;
}) {
  return (
    <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {rows.map((row) => {
        if (renderGalleryCard) return <div key={row.id}>{renderGalleryCard(row)}</div>;
        const title = titleCol ? String((row as Record<string, unknown>)[titleCol.id] ?? '') : row.id;
        return (
          <div key={row.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-slate-600 transition-all hover:shadow-lg cursor-pointer">
            <h3 className="text-sm font-medium text-gray-200 leading-snug mb-3">{title || '—'}</h3>
            <div className="space-y-1.5">
              {columns.filter((c) => c.id !== titleCol?.id).slice(0, 4).map((col) => {
                const val = (row as Record<string, unknown>)[col.id];
                if (val === null || val === undefined || String(val) === '') return null;
                return (
                  <div key={col.id} className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-16 shrink-0">{col.label}</span>
                    <div className="flex-1">
                      {col.type === 'badge' ? <BadgeDisplay value={String(val)} options={col.options} /> :
                       col.type === 'progress' ? <ProgressDisplay value={Number(val)} /> :
                       <span className="text-xs text-gray-300">{String(val)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GalleryView<T extends { id: string }>({ data, columns, renderGalleryCard, groupByField }: GalleryViewProps<T>) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const titleCol = columns.find((c) => c.id === 'title' || c.id === 'name') ?? columns.find((c) => c.type === 'text') ?? columns[0];
  const colGroup = columns.find(c => c.id === groupByField);

  function toggleGroup(label: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  const groups = groupByField ? groupData(data as unknown as Record<string, unknown>[], groupByField, columns) : null;

  if (groups) {
    return (
      <div className="overflow-auto h-full">
        {groups.map(({ label, rows }) => {
          const collapsed = collapsedGroups.has(label);
          return (
            <div key={label}>
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/60 border-b border-slate-700/50 sticky top-0 z-10">
                <button
                  onClick={() => toggleGroup(label)}
                  className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {colGroup?.type === 'badge' || colGroup?.type === 'select'
                    ? <BadgeDisplay value={colGroup?.options?.find(o => o.label === label)?.value ?? label} options={colGroup?.options} />
                    : <span>{label}</span>
                  }
                  <span className="text-slate-500 font-normal">{rows.length}</span>
                </button>
              </div>
              {!collapsed && (
                <CardGrid rows={rows as T[]} columns={columns} titleCol={titleCol} renderGalleryCard={renderGalleryCard} />
              )}
            </div>
          );
        })}
        {data.length === 0 && <div className="py-16 text-center text-slate-500 text-sm">无数据</div>}
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full p-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {data.map((row) => {
          if (renderGalleryCard) return <div key={row.id}>{renderGalleryCard(row)}</div>;
          const title = titleCol ? String((row as Record<string, unknown>)[titleCol.id] ?? '') : row.id;
          return (
            <div key={row.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-slate-600 transition-all hover:shadow-lg cursor-pointer">
              <h3 className="text-sm font-medium text-gray-200 leading-snug mb-3">{title || '—'}</h3>
              <div className="space-y-1.5">
                {columns.filter((c) => c.id !== titleCol?.id).slice(0, 4).map((col) => {
                  const val = (row as Record<string, unknown>)[col.id];
                  if (val === null || val === undefined || String(val) === '') return null;
                  return (
                    <div key={col.id} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-16 shrink-0">{col.label}</span>
                      <div className="flex-1">
                        {col.type === 'badge' ? <BadgeDisplay value={String(val)} options={col.options} /> :
                         col.type === 'progress' ? <ProgressDisplay value={Number(val)} /> :
                         <span className="text-xs text-gray-300">{String(val)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {data.length === 0 && (
          <div className="col-span-3 py-16 text-center text-slate-500 text-sm">无数据</div>
        )}
      </div>
    </div>
  );
}
