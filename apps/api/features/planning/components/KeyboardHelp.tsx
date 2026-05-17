import { useEffect, useCallback } from 'react';

interface KeyboardHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ['Cmd/Ctrl', 'C'], desc: '复制' },
  { keys: ['Cmd/Ctrl', 'V'], desc: '粘贴' },
  { keys: ['Cmd/Ctrl', 'Z'], desc: '撤销' },
  { keys: ['Cmd/Ctrl', 'Shift', 'Z'], desc: '重做' },
  { keys: ['Delete'], desc: '删除' },
  { keys: ['Shift', '点击'], desc: '多选' },
  { keys: ['拖拽空白'], desc: '框选' },
  { keys: ['滚轮'], desc: '缩放' },
  { keys: ['Shift', '拖拽'], desc: '平移画布' },
  { keys: ['双击节点'], desc: '编辑文字' },
  { keys: ['?'], desc: '显示帮助' },
];

export function KeyboardHelp({ isOpen, onClose }: KeyboardHelpProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100 mb-4">快捷键</h2>
        <div className="space-y-2">
          {shortcuts.map(({ keys, desc }) => (
            <div key={desc} className="flex items-center justify-between">
              <span className="text-slate-300">{desc}</span>
              <div className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="px-2 py-1 bg-slate-700 text-slate-200 text-xs rounded border border-slate-600"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  );
}

export default KeyboardHelp;
