import { useState, useRef, useEffect } from 'react';
import { Block, BlockContent } from '../types';

interface TextBlockProps {
  block: Block;
  onUpdate: (content: BlockContent) => void;
  readOnly?: boolean;
}

export function TextBlock({ block, onUpdate, readOnly }: TextBlockProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block.content.text || '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(block.content.text || '');
  }, [block.content.text]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(text.length, text.length);
    }
  }, [editing, text.length]);

  const handleBlur = () => {
    setEditing(false);
    if (text !== block.content.text) {
      onUpdate({ ...block.content, text });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === 'Escape') {
      setText(block.content.text || '');
      setEditing(false);
    }
  };

  if (readOnly) {
    return (
      <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
        {text || <span className="text-slate-400 italic">Empty</span>}
      </p>
    );
  }

  if (editing) {
    return (
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-300"
        rows={Math.max(1, text.split('\n').length)}
        placeholder="Type something..."
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="cursor-text min-h-[1.5em] text-slate-700 dark:text-slate-300 whitespace-pre-wrap"
    >
      {text || <span className="text-slate-400 italic">Click to edit...</span>}
    </div>
  );
}
