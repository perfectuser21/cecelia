import { useState, useEffect } from 'react';
import { BookOpen, Cpu, Zap, ArrowRight, Wrench } from 'lucide-react';

interface Section {
  what?: string;
  trigger?: string;
  howToUse?: string;
  output?: string;
  addedIn?: string;
}

interface Entry {
  id: string;
  version: string;
  title: string;
  category: 'skill' | 'feature';
  sections: Section;
}

interface InstructionBookData {
  skills: Entry[];
  features: Entry[];
}

function CodeBlock({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const code = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
          return (
            <pre key={i} style={{
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '12px 16px',
              overflowX: 'auto',
              fontSize: '13px',
              lineHeight: '1.6',
              color: '#e2e8f0',
              margin: '8px 0',
            }}>
              <code>{code}</code>
            </pre>
          );
        }
        return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
      })}
    </>
  );
}

function SectionBlock({ label, content }: { label: string; content?: string }) {
  if (!content) return null;
  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{
        fontSize: '12px',
        fontWeight: 600,
        color: '#3467D6',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: '8px',
      }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.7' }}>
        <CodeBlock content={content} />
      </div>
    </div>
  );
}

function EntryDetail({ entry }: { entry: Entry }) {
  return (
    <div style={{ padding: '28px 32px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        {entry.category === 'skill'
          ? <Cpu size={18} color="#3467D6" />
          : <Zap size={18} color="#01C7D2" />
        }
        <span style={{ fontSize: '11px', color: entry.category === 'skill' ? '#3467D6' : '#01C7D2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {entry.category === 'skill' ? 'Skill' : 'Feature'}
        </span>
        {entry.version && (
          <span style={{ fontSize: '11px', color: '#555', marginLeft: 'auto' }}>v{entry.version}</span>
        )}
      </div>

      <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', margin: '0 0 24px' }}>
        {entry.title}
      </h2>

      <SectionBlock label="是什么" content={entry.sections.what} />
      <SectionBlock label="触发条件" content={entry.sections.trigger} />
      <SectionBlock label="怎么用" content={entry.sections.howToUse} />
      <SectionBlock label="输出" content={entry.sections.output} />
      {entry.sections.addedIn && (
        <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid #222', fontSize: '12px', color: '#555' }}>
          {entry.sections.addedIn}
        </div>
      )}
    </div>
  );
}

export default function InstructionBook() {
  const [data, setData] = useState<InstructionBookData | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brain/docs/instruction-book')
      .then(r => r.json())
      .then((d: InstructionBookData) => {
        setData(d);
        if (d.skills.length > 0) setSelected(d.skills[0]);
        else if (d.features.length > 0) setSelected(d.features[0]);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '48px', color: '#555', textAlign: 'center' }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '48px', color: '#f87171', textAlign: 'center' }}>
        加载失败：{error}
      </div>
    );
  }

  const allEntries = [...(data?.skills ?? []), ...(data?.features ?? [])];

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0d0d0d' }}>
      {/* 左侧列表 */}
      <div style={{
        width: '240px',
        flexShrink: 0,
        borderRight: '1px solid #1f1f1f',
        overflowY: 'auto',
        padding: '16px 0',
      }}>
        <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={16} color="#888" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#888' }}>说明书</span>
        </div>

        {/* Skills 分组 */}
        {(data?.skills ?? []).length > 0 && (
          <>
            <div style={{ padding: '8px 16px 4px', fontSize: '11px', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={10} /> Skills
            </div>
            {(data?.skills ?? []).map(entry => (
              <button
                key={entry.id}
                onClick={() => setSelected(entry)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 16px',
                  background: selected?.id === entry.id ? '#1a2a3a' : 'transparent',
                  border: 'none',
                  borderLeft: selected?.id === entry.id ? '2px solid #3467D6' : '2px solid transparent',
                  color: selected?.id === entry.id ? '#fff' : '#888',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {selected?.id === entry.id && <ArrowRight size={12} color="#3467D6" />}
                {entry.title}
              </button>
            ))}
          </>
        )}

        {/* Features 分组 */}
        {(data?.features ?? []).length > 0 && (
          <>
            <div style={{ padding: '16px 16px 4px', fontSize: '11px', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={10} /> Features
            </div>
            {(data?.features ?? []).map(entry => (
              <button
                key={entry.id}
                onClick={() => setSelected(entry)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 16px',
                  background: selected?.id === entry.id ? '#0d2a2a' : 'transparent',
                  border: 'none',
                  borderLeft: selected?.id === entry.id ? '2px solid #01C7D2' : '2px solid transparent',
                  color: selected?.id === entry.id ? '#fff' : '#888',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {selected?.id === entry.id && <ArrowRight size={12} color="#01C7D2" />}
                {entry.title}
              </button>
            ))}
          </>
        )}

        {allEntries.length === 0 && (
          <div style={{ padding: '16px', fontSize: '13px', color: '#555' }}>
            暂无条目
          </div>
        )}
      </div>

      {/* 右侧详情 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {selected
          ? <EntryDetail entry={selected} />
          : (
            <div style={{ padding: '48px', color: '#555', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <Wrench size={32} color="#333" />
              <span>选择左侧条目查看详情</span>
            </div>
          )
        }
      </div>
    </div>
  );
}
