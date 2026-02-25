import { useState, useRef, useEffect } from 'react';
import { Block, BlockContent } from '../types';

interface CodeBlockProps {
  block: Block;
  onUpdate: (content: BlockContent) => void;
  readOnly?: boolean;
}

export function CodeBlock({ block, onUpdate, readOnly }: CodeBlockProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block.content.text || '');
  const [language, setLanguage] = useState(block.content.language || 'plaintext');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(block.content.text || '');
    setLanguage(block.content.language || 'plaintext');
  }, [block.content.text, block.content.language]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  const handleBlur = () => {
    setEditing(false);
    if (text !== block.content.text || language !== block.content.language) {
      onUpdate({ ...block.content, text, language });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setText(block.content.text || '');
      setLanguage(block.content.language || 'plaintext');
      setEditing(false);
    }
    // Allow Tab for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newText = text.substring(0, start) + '  ' + text.substring(end);
        setText(newText);
        // Set cursor position after the tab
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }, 0);
      }
    }
  };

  const languages = ['plaintext', 'javascript', 'typescript', 'python', 'bash', 'json', 'sql', 'css', 'html'];

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
      {/* Language selector */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        {readOnly ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">{language}</span>
        ) : (
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              onUpdate({ ...block.content, text, language: e.target.value });
            }}
            className="text-xs bg-transparent border-none outline-none text-slate-600 dark:text-slate-400 cursor-pointer"
          >
            {languages.map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        )}
      </div>

      {/* Code content */}
      <div className="p-3 bg-slate-50 dark:bg-slate-900">
        {editing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent border-none outline-none resize-none font-mono text-sm text-slate-800 dark:text-slate-200"
            rows={Math.max(3, text.split('\n').length)}
            placeholder="// Code here..."
          />
        ) : (
          <pre
            onClick={() => !readOnly && setEditing(true)}
            className={`font-mono text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap ${!readOnly ? 'cursor-text' : ''}`}
          >
            {text || <span className="text-slate-400 italic">Click to add code...</span>}
          </pre>
        )}
      </div>
    </div>
  );
}
