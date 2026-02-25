import React from 'react';

export type ViewMode = 'table' | 'board' | 'gallery' | 'list';

export interface ColumnDef {
  id: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'progress' | 'relation' | 'date' | 'badge' | 'link' | 'multi_select' | 'checkbox' | 'url' | 'email' | 'phone';
  options?: Array<{ value: string; label: string; color?: string }>;
  width?: number;
  hidden?: boolean;
  editable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  navigateTo?: (rowId: string) => string | null;  // for clickable relations
}

export interface FilterRule {
  id: string;
  field: string;
  operator: 'is' | 'is_not' | 'contains' | 'gt' | 'lt';
  value: string;
}

export interface SortRule {
  field: string;
  dir: 'asc' | 'desc';
}

export interface DatabaseViewStats {
  total: number;
  byStatus?: Record<string, number>;
}

export interface CustomColumnDef {
  col_id: string;
  col_label: string;
  col_type: 'text' | 'number' | 'date' | 'select' | 'badge' | 'multi_select' | 'checkbox' | 'url' | 'email' | 'phone' | 'progress';
  options: Array<{ value: string; label: string; color?: string }>;
  col_width: number;
  col_order: number;
}

export interface DatabaseViewProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef[];
  onUpdate?: (id: string, field: string, value: unknown) => Promise<void>;
  onCreate?: (data: Partial<T>) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onRowNavigate?: (id: string) => void;
  loading?: boolean;
  groupByField?: string;
  boardGroupField?: string;
  renderGalleryCard?: (row: T) => React.ReactNode;
  renderListItem?: (row: T) => React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  defaultView?: ViewMode;
  stats?: DatabaseViewStats;
  stateKey?: string;
}
