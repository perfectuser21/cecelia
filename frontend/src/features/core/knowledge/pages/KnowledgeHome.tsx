import { BookOpen, PenTool, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const sections = [
  { id: 'content', label: 'Content Studio', icon: PenTool, path: '/knowledge/content', desc: 'Content & media assets' },
  { id: 'brain', label: 'Super Brain', icon: Brain, path: '/knowledge/brain', desc: 'Knowledge base & notes' },
] as const;

export default function KnowledgeHome() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <BookOpen size={24} />
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Knowledge</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {sections.map(section => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              onClick={() => navigate(section.path)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '20px',
                borderRadius: '12px',
                border: '1px solid #333',
                background: 'transparent',
                color: '#ccc',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon size={20} />
              <span style={{ fontSize: '15px', fontWeight: 500, color: '#fff' }}>{section.label}</span>
              <span style={{ fontSize: '13px', color: '#888' }}>{section.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
