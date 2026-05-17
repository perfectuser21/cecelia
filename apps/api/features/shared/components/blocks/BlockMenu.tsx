import { Type, Heading1, Heading2, Heading3, List, ListOrdered, Code, MessageSquare } from 'lucide-react';
import { BlockType, BlockContent } from './types';

interface BlockMenuProps {
  onSelect: (type: BlockType, content?: BlockContent) => void;
  onClose: () => void;
}

const blockOptions: Array<{
  type: BlockType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultContent?: BlockContent;
}> = [
  {
    type: 'text',
    label: 'Text',
    description: 'Plain text paragraph',
    icon: Type,
    defaultContent: { text: '' },
  },
  {
    type: 'heading',
    label: 'Heading 1',
    description: 'Large section heading',
    icon: Heading1,
    defaultContent: { text: '', level: 1 },
  },
  {
    type: 'heading',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: Heading2,
    defaultContent: { text: '', level: 2 },
  },
  {
    type: 'heading',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: Heading3,
    defaultContent: { text: '', level: 3 },
  },
  {
    type: 'list',
    label: 'Bullet List',
    description: 'Unordered list',
    icon: List,
    defaultContent: { items: [''], listType: 'bullet' },
  },
  {
    type: 'list',
    label: 'Numbered List',
    description: 'Ordered list',
    icon: ListOrdered,
    defaultContent: { items: [''], listType: 'numbered' },
  },
  {
    type: 'code',
    label: 'Code',
    description: 'Code block with syntax',
    icon: Code,
    defaultContent: { text: '', language: 'plaintext' },
  },
  {
    type: 'callout',
    label: 'Callout',
    description: 'Highlighted info box',
    icon: MessageSquare,
    defaultContent: { text: '', variant: 'info' },
  },
];

export function BlockMenu({ onSelect, onClose }: BlockMenuProps) {
  return (
    <div className="absolute z-50 mt-1 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-2 max-h-80 overflow-y-auto">
      <div className="px-3 py-1 text-xs font-medium text-slate-400 uppercase tracking-wider">
        Add block
      </div>
      {blockOptions.map((option, index) => (
        <button
          key={`${option.type}-${index}`}
          onClick={() => {
            onSelect(option.type, option.defaultContent);
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
        >
          <div className="p-1.5 bg-slate-100 dark:bg-slate-700 rounded">
            <option.icon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              {option.label}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {option.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
