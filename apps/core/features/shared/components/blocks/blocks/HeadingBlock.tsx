import { useState, useRef, useEffect } from 'react';
import { Block, BlockContent } from '../types';

interface HeadingBlockProps {
  block: Block;
  onUpdate: (content: BlockContent) => void;
  readOnly?: boolean;
}

export function HeadingBlock({ block, onUpdate, readOnly }: HeadingBlockProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block.content.text || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const level = block.content.level || 1;

  useEffect(() => {
    setText(block.content.text || '');
  }, [block.content.text]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleBlur = () => {
    setEditing(false);
    if (text !== block.content.text) {
      onUpdate({ ...block.content, text });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === 'Escape') {
      setText(block.content.text || '');
      setEditing(false);
    }
  };

  const sizeClasses = {
    1: 'text-2xl font-bold',
    2: 'text-xl font-semibold',
    3: 'text-lg font-medium',
  };

  const className = `${sizeClasses[level as 1 | 2 | 3]} text-slate-900 dark:text-white`;

  if (readOnly) {
    return (
      <div className={className}>
        {text || <span className="text-slate-400 italic">Empty heading</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-full bg-transparent border-none outline-none ${className}`}
        placeholder={`Heading ${level}`}
      />
    );
  }

  return (
    <div onClick={() => setEditing(true)} className={`cursor-text ${className}`}>
      {text || <span className="text-slate-400 italic">Click to add heading...</span>}
    </div>
  );
}
