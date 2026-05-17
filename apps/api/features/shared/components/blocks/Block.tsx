import { GripVertical, Trash2 } from 'lucide-react';
import { Block as BlockType, BlockContent } from './types';
import { TextBlock, HeadingBlock, ListBlock, CodeBlock, CalloutBlock } from './blocks';

interface BlockProps {
  block: BlockType;
  onUpdate: (content: BlockContent) => void;
  onDelete: () => void;
  readOnly?: boolean;
  dragHandleProps?: Record<string, unknown>;
}

export function Block({ block, onUpdate, onDelete, readOnly, dragHandleProps }: BlockProps) {
  const renderBlockContent = () => {
    switch (block.type) {
      case 'text':
        return <TextBlock block={block} onUpdate={onUpdate} readOnly={readOnly} />;
      case 'heading':
        return <HeadingBlock block={block} onUpdate={onUpdate} readOnly={readOnly} />;
      case 'list':
        return <ListBlock block={block} onUpdate={onUpdate} readOnly={readOnly} />;
      case 'code':
        return <CodeBlock block={block} onUpdate={onUpdate} readOnly={readOnly} />;
      case 'callout':
        return <CalloutBlock block={block} onUpdate={onUpdate} readOnly={readOnly} />;
      default:
        return <div className="text-slate-400">Unknown block type: {block.type}</div>;
    }
  };

  return (
    <div className="group flex items-start gap-2 py-1 -ml-8 pl-8 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors">
      {/* Drag handle and actions */}
      {!readOnly && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity -ml-7">
          <button
            {...dragHandleProps}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing"
            title="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
            title="Delete block"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Block content */}
      <div className="flex-1 min-w-0">
        {renderBlockContent()}
      </div>
    </div>
  );
}
