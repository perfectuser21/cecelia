import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ColumnDef } from './types';
import { BadgeDisplay } from './InlineEdit';

interface ListViewProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef[];
  renderListItem?: (row: T) => React.ReactNode;
  onCreate?: () => void;
  onUpdate?: (id: string, field: string, value: unknown) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
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

export function ListView<T extends { id: string }>({ data, columns, renderListItem, groupByField, onUpdate }: ListViewProps<T>) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const titleCol = columns.find((c) => c.id === 'title' || c.id === 'name') ?? columns.find((c) => c.type === 'text') ?? columns[0];
  const metaCols = columns.filter((c) => c.id !== titleCol?.id && (c.type === 'badge' || c.type === 'select')).slice(0, 3);
  const colGroup = columns.find(c => c.id === groupByField);

  function toggleGroup(label: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  function renderRow(row: T) {
    if (renderListItem) return <div key={row.id}>{renderListItem(row)}</div>;
    const title = titleCol ? String((row as Record<string, unknown>)[titleCol.id] ?? '') : row.id;
    return (
      <div key={row.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/30 hover:bg-slate-700/30 transition-colors">
        <span className="flex-1 text-sm text-gray-200 truncate">{title || '—'}</span>
        <div className="flex items-center gap-2 shrink-0">
          {metaCols.map((col) => {
            const val = (row as Record<string, unknown>)[col.id];
            if (!val) return null;
            return <BadgeDisplay key={col.id} value={String(val)} options={col.options} />;
          })}
        </div>
      </div>
    );
  }

  const groups = groupByField ? groupData(data as unknown as Record<string, unknown>[], groupByField, columns) : null;

  return (
    <div className="overflow-auto h-full">
      {groups ? (
        groups.map(({ label, rows }) => {
          const collapsed = collapsedGroups.has(label);
          return (
            <React.Fragment key={label}>
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
              {!collapsed && (rows as T[]).map(row => renderRow(row))}
            </React.Fragment>
          );
        })
      ) : (
        data.map(row => renderRow(row))
      )}
      {data.length === 0 && <div className="py-16 text-center text-slate-500 text-sm">无数据</div>}
    </div>
  );
}
