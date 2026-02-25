import { useState, useRef, useEffect } from 'react';
import { AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';
import { Block, BlockContent } from '../types';

interface CalloutBlockProps {
  block: Block;
  onUpdate: (content: BlockContent) => void;
  readOnly?: boolean;
}

const variants = {
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    icon: Info,
    iconColor: 'text-blue-500',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
  },
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle,
    iconColor: 'text-emerald-500',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertCircle,
    iconColor: 'text-red-500',
  },
};

export function CalloutBlock({ block, onUpdate, readOnly }: CalloutBlockProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block.content.text || '');
  const variant = (block.content.variant || 'info') as keyof typeof variants;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(block.content.text || '');
  }, [block.content.text]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  const handleBlur = () => {
    setEditing(false);
    if (text !== block.content.text) {
      onUpdate({ ...block.content, text });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setText(block.content.text || '');
      setEditing(false);
    }
  };

  const config = variants[variant];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg p-4 border ${config.bg} ${config.border}`}>
      <div className="flex gap-3">
        {/* Icon and variant selector */}
        <div className="flex-shrink-0 pt-0.5">
          {readOnly ? (
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          ) : (
            <select
              value={variant}
              onChange={(e) => onUpdate({ ...block.content, variant: e.target.value as BlockContent['variant'] })}
              className="appearance-none bg-transparent border-none outline-none cursor-pointer"
              title="Change callout type"
            >
              <option value="info">ℹ️</option>
              <option value="warning">⚠️</option>
              <option value="success">✅</option>
              <option value="error">❌</option>
            </select>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-300"
              rows={Math.max(1, text.split('\n').length)}
              placeholder="Callout text..."
            />
          ) : (
            <div
              onClick={() => !readOnly && setEditing(true)}
              className={`text-slate-700 dark:text-slate-300 whitespace-pre-wrap ${!readOnly ? 'cursor-text' : ''}`}
            >
              {text || <span className="text-slate-400 italic">Click to add callout text...</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
