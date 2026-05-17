import React from 'react';
import { X, ExternalLink, Trash2 } from 'lucide-react';
import type { ColumnDef } from './types';
import { InlineEdit } from './InlineEdit';

interface RowDetailPanelProps<T extends { id: string }> {
  row: T;
  columns: ColumnDef[];
  onClose: () => void;
  onUpdate?: (id: string, field: string, value: unknown) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onNavigate?: (id: string) => void;
}

export function RowDetailPanel<T extends { id: string }>({ row, columns, onClose, onUpdate, onDelete, onNavigate }: RowDetailPanelProps<T>) {
  const titleCol = columns.find((c) => c.id === 'title' || c.id === 'name') ?? columns.find((c) => c.type === 'text') ?? columns[0];
  const otherCols = columns.filter((c) => c !== titleCol);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: '#1a2236' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-700 shrink-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">详情</span>
          <div className="flex items-center gap-1.5">
            {onNavigate && (
              <button
                onClick={() => onNavigate(row.id)}
                className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-400 transition-colors"
                title="打开原始页面"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { onDelete(row.id); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />删除
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Title area */}
        {titleCol && (
          <div className="px-6 pt-5 pb-2 shrink-0">
            <div className="text-xl font-semibold text-white">
              <InlineEdit
                value={(row as Record<string, unknown>)[titleCol.id]}
                col={titleCol}
                onSave={(value) => onUpdate?.(row.id, titleCol.id, value)}
              />
            </div>
          </div>
        )}

        {/* Properties list */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2">
          {otherCols.map((col) => {
            const rawVal = (row as Record<string, unknown>)[col.id];
            const isEmpty = rawVal === undefined || rawVal === null || String(rawVal) === '';
            return (
              <div
                key={col.id}
                className="flex items-center gap-4 px-3 py-2.5 rounded-xl hover:bg-slate-700/30 transition-colors"
              >
                <span className="text-sm text-slate-400 w-28 shrink-0">{col.label}</span>
                <div className="flex-1 min-w-0">
                  {col.editable ? (
                    <InlineEdit value={rawVal} col={col} onSave={(value) => onUpdate?.(row.id, col.id, value)} />
                  ) : (
                    <span className={`text-sm ${isEmpty ? 'text-slate-600' : 'text-gray-200'}`}>
                      {isEmpty ? '—' : String(rawVal)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
