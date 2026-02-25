import React from 'react';
import type { ColumnDef } from './types';
import { InlineEdit } from './InlineEdit';
import { BadgeDisplay } from './InlineEdit';

interface BoardViewProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef[];
  boardGroupField: string;
  onUpdate?: (id: string, field: string, value: unknown) => Promise<void>;
  onCreate?: (data: Partial<T>) => Promise<void>;
}

export function BoardView<T extends { id: string }>({ data, columns, boardGroupField, onUpdate }: BoardViewProps<T>) {
  const groupCol = columns.find((c) => c.id === boardGroupField);
  const options = groupCol?.options ?? [];

  const groups: Array<{ value: string; label: string; items: T[] }> = options.length > 0
    ? options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        items: data.filter((row) => String((row as Record<string, unknown>)[boardGroupField] ?? '') === opt.value),
      }))
    : (() => {
        const vals = [...new Set(data.map((row) => String((row as Record<string, unknown>)[boardGroupField] ?? '')))];
        return vals.map((v) => ({ value: v, label: v || '未分组', items: data.filter((row) => String((row as Record<string, unknown>)[boardGroupField] ?? '') === v) }));
      })();

  const titleCol = columns.find((c) => c.id === 'title' || c.id === 'name') ?? columns.find((c) => c.type === 'text') ?? columns[0];

  return (
    <div className="flex gap-3 h-full overflow-x-auto p-3">
      {groups.map((group) => (
        <div key={group.value} className="w-64 shrink-0 flex flex-col bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-700/50 flex items-center gap-2">
            <BadgeDisplay value={group.value} options={groupCol?.options} />
            <span className="text-xs text-slate-500 ml-auto">{group.items.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {group.items.map((row) => {
              const title = titleCol ? String((row as Record<string, unknown>)[titleCol.id] ?? '') : row.id;
              return (
                <div key={row.id} className="bg-slate-800 rounded-lg p-3 border border-slate-700/50 hover:border-slate-600 transition-colors cursor-pointer">
                  <p className="text-sm text-gray-200 leading-snug mb-2">{title || '—'}</p>
                  <div className="flex flex-wrap gap-1">
                    {columns.filter((c) => c.id !== titleCol?.id && c.type === 'badge' && (row as Record<string, unknown>)[c.id]).map((col) => {
                      const val = (row as Record<string, unknown>)[col.id];
                      if (!val) return null;
                      return <BadgeDisplay key={col.id} value={String(val)} options={col.options} />;
                    })}
                  </div>
                </div>
              );
            })}
            {group.items.length === 0 && (
              <p className="text-xs text-slate-600 text-center py-4">空</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
