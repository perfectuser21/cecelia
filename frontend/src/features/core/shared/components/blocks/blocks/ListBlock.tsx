import { useState, useRef, useEffect } from 'react';
import { Block, BlockContent } from '../types';

interface ListBlockProps {
  block: Block;
  onUpdate: (content: BlockContent) => void;
  readOnly?: boolean;
}

export function ListBlock({ block, onUpdate, readOnly }: ListBlockProps) {
  const items = block.content.items || [''];
  const listType = block.content.listType || 'bullet';
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingIndex]);

  const handleItemClick = (index: number) => {
    if (readOnly) return;
    setEditingIndex(index);
    setEditText(items[index] || '');
  };

  const handleBlur = () => {
    if (editingIndex === null) return;
    const newItems = [...items];
    newItems[editingIndex] = editText;
    onUpdate({ ...block.content, items: newItems.filter(i => i.trim() !== '') });
    setEditingIndex(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Save current and add new item
      const newItems = [...items];
      newItems[index] = editText;
      newItems.splice(index + 1, 0, '');
      onUpdate({ ...block.content, items: newItems });
      setEditingIndex(index + 1);
      setEditText('');
    }
    if (e.key === 'Backspace' && editText === '' && items.length > 1) {
      e.preventDefault();
      const newItems = items.filter((_, i) => i !== index);
      onUpdate({ ...block.content, items: newItems });
      setEditingIndex(index > 0 ? index - 1 : null);
      setEditText(index > 0 ? items[index - 1] : '');
    }
    if (e.key === 'Escape') {
      setEditingIndex(null);
    }
  };

  const ListTag = listType === 'numbered' ? 'ol' : 'ul';
  const listClass = listType === 'numbered'
    ? 'list-decimal list-inside'
    : 'list-disc list-inside';

  return (
    <ListTag className={`${listClass} text-slate-700 dark:text-slate-300 space-y-1`}>
      {items.map((item, index) => (
        <li key={index} className="pl-1">
          {editingIndex === index ? (
            <input
              ref={inputRef}
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className="bg-transparent border-none outline-none w-[calc(100%-1.5em)]"
              placeholder="List item..."
            />
          ) : (
            <span
              onClick={() => handleItemClick(index)}
              className={!readOnly ? 'cursor-text' : ''}
            >
              {item || <span className="text-slate-400 italic">Empty item</span>}
            </span>
          )}
        </li>
      ))}
      {!readOnly && editingIndex === null && (
        <li
          className="pl-1 text-slate-400 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300"
          onClick={() => {
            const newItems = [...items, ''];
            onUpdate({ ...block.content, items: newItems });
            setEditingIndex(newItems.length - 1);
            setEditText('');
          }}
        >
          + Add item
        </li>
      )}
    </ListTag>
  );
}
