import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Brain, Plus, ArrowLeft, Trash2, Save } from 'lucide-react';

interface ThinkingEntry {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const SAMPLE_ENTRIES: ThinkingEntry[] = [
  {
    id: '1',
    title: '系统架构思考',
    content: '<p>大脑与执行器之间的通信协议需要重新设计...</p>',
    createdAt: '2026-03-05T10:00:00Z',
    updatedAt: '2026-03-05T10:30:00Z',
  },
  {
    id: '2',
    title: 'OKR 进度反思',
    content: '<p>本周 KR 推进较慢，主要原因是测试覆盖不足...</p>',
    createdAt: '2026-03-04T09:00:00Z',
    updatedAt: '2026-03-04T09:45:00Z',
  },
  {
    id: '3',
    title: 'Tick Loop 优化方案',
    content: '<p>当前 5 分钟间隔存在资源浪费，可以改为事件驱动...</p>',
    createdAt: '2026-03-03T14:00:00Z',
    updatedAt: '2026-03-03T15:00:00Z',
  },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: '6px',
    border: 'none',
    background: active ? '#3b82f6' : '#333',
    color: active ? '#fff' : '#ccc',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  });

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        padding: '10px 12px',
        borderBottom: '1px solid #2a2a2a',
        flexWrap: 'wrap',
        background: '#1a1a1a',
        borderRadius: '8px 8px 0 0',
      }}
    >
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        style={btnStyle(editor.isActive('bold'))}
      >
        B
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        style={btnStyle(editor.isActive('italic'))}
      >
        I
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        style={btnStyle(editor.isActive('strike'))}
      >
        S
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        style={btnStyle(editor.isActive('code'))}
      >
        {'<>'}
      </button>
      <div style={{ width: '1px', background: '#333', margin: '0 4px' }} />
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        style={btnStyle(editor.isActive('heading', { level: 1 }))}
      >
        H1
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        style={btnStyle(editor.isActive('heading', { level: 2 }))}
      >
        H2
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        style={btnStyle(editor.isActive('bulletList'))}
      >
        • 列表
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        style={btnStyle(editor.isActive('orderedList'))}
      >
        1. 列表
      </button>
      <div style={{ width: '1px', background: '#333', margin: '0 4px' }} />
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        style={btnStyle(editor.isActive('blockquote'))}
      >
        引用
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        style={btnStyle(editor.isActive('codeBlock'))}
      >
        代码块
      </button>
    </div>
  );
}

interface EditorViewProps {
  entry: ThinkingEntry | null;
  onBack: () => void;
  onSave: (id: string, title: string, content: string) => void;
  onDelete: (id: string) => void;
  isNew?: boolean;
}

function EditorView({ entry, onBack, onSave, onDelete, isNew = false }: EditorViewProps) {
  const [title, setTitle] = useState(entry?.title ?? '');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
    ],
    content: entry?.content ?? '<p>在此记录你的思考...</p>',
  });

  const handleSave = () => {
    if (!editor) return;
    const id = entry?.id ?? String(Date.now());
    onSave(id, title || '无标题', editor.getHTML());
    onBack();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            border: '1px solid #333',
            background: 'transparent',
            color: '#888',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          <ArrowLeft size={14} />
          返回
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入标题..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '20px',
            fontWeight: 600,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          {!isNew && entry && (
            <button
              onClick={() => { onDelete(entry.id); onBack(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #ef4444',
                background: 'transparent',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
          <button
            onClick={handleSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <Save size={14} />
            保存
          </button>
        </div>
      </div>

      {/* Editor */}
      <div
        style={{
          flex: 1,
          border: '1px solid #2a2a2a',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <EditorToolbar editor={editor} />
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px',
            background: '#111',
          }}
        >
          <style>{`
            .ProseMirror {
              outline: none;
              min-height: 300px;
              color: #e5e5e5;
              font-size: 15px;
              line-height: 1.75;
            }
            .ProseMirror p { margin: 0 0 12px 0; }
            .ProseMirror h1 { font-size: 24px; font-weight: 700; margin: 0 0 12px 0; color: #fff; }
            .ProseMirror h2 { font-size: 20px; font-weight: 600; margin: 0 0 12px 0; color: #fff; }
            .ProseMirror strong { color: #fff; }
            .ProseMirror em { color: #a0aec0; }
            .ProseMirror ul, .ProseMirror ol { padding-left: 24px; margin: 0 0 12px 0; }
            .ProseMirror li { margin-bottom: 4px; }
            .ProseMirror code { background: #1e293b; color: #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
            .ProseMirror pre { background: #1e293b; padding: 12px 16px; border-radius: 8px; margin: 0 0 12px 0; }
            .ProseMirror pre code { background: transparent; padding: 0; color: #93c5fd; }
            .ProseMirror blockquote { border-left: 3px solid #3b82f6; padding-left: 16px; color: #9ca3af; margin: 0 0 12px 0; }
            .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #555; pointer-events: none; float: left; height: 0; }
          `}</style>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

export default function ThinkingLog() {
  const [entries, setEntries] = useState<ThinkingEntry[]>(SAMPLE_ENTRIES);
  const [selected, setSelected] = useState<ThinkingEntry | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleSave = (id: string, title: string, content: string) => {
    const now = new Date().toISOString();
    setEntries((prev) => {
      const existing = prev.find((e) => e.id === id);
      if (existing) {
        return prev.map((e) => e.id === id ? { ...e, title, content, updatedAt: now } : e);
      }
      return [{ id, title, content, createdAt: now, updatedAt: now }, ...prev];
    });
    setIsCreating(false);
    setSelected(null);
  };

  const handleDelete = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleBack = () => {
    setSelected(null);
    setIsCreating(false);
  };

  if (selected || isCreating) {
    return (
      <div style={{ padding: '24px', height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
        <EditorView
          entry={selected}
          onBack={handleBack}
          onSave={handleSave}
          onDelete={handleDelete}
          isNew={isCreating}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Brain size={24} />
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Thinking Log</h1>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          <Plus size={16} />
          新建记录
        </button>
      </div>

      {/* Entry List */}
      {entries.length === 0 ? (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: '#555',
            border: '1px dashed #333',
            borderRadius: '12px',
          }}
        >
          <Brain size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <p style={{ fontSize: '15px', margin: 0 }}>暂无思维记录</p>
          <p style={{ fontSize: '13px', marginTop: '8px' }}>点击「新建记录」开始记录你的思考</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {entries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelected(entry)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '16px 20px',
                borderRadius: '12px',
                border: '1px solid #2a2a2a',
                background: 'transparent',
                color: '#ccc',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#3b82f6')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2a2a2a')}
            >
              <span style={{ fontSize: '15px', fontWeight: 500, color: '#fff' }}>{entry.title}</span>
              <div
                style={{ fontSize: '13px', color: '#666' }}
                dangerouslySetInnerHTML={{
                  __html: entry.content.replace(/<[^>]+>/g, '').slice(0, 100) + '...',
                }}
              />
              <span style={{ fontSize: '12px', color: '#444' }}>{formatDate(entry.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
