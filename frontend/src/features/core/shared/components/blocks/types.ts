// Block types for Notion-style editor

export type BlockType = 'text' | 'heading' | 'list' | 'code' | 'callout';

export interface BlockContent {
  text?: string;
  level?: 1 | 2 | 3; // for heading
  listType?: 'bullet' | 'numbered'; // for list
  items?: string[]; // for list
  language?: string; // for code
  icon?: string; // for callout
  variant?: 'info' | 'warning' | 'success' | 'error'; // for callout
}

export interface Block {
  id: string;
  parent_id: string;
  parent_type: 'goal' | 'task' | 'project' | 'block';
  type: BlockType;
  content: BlockContent;
  order_index: number;
  created_at?: string;
  updated_at?: string;
}

export interface BlockEditorProps {
  parentType: 'goal' | 'task' | 'project';
  parentId: string;
  readOnly?: boolean;
}
