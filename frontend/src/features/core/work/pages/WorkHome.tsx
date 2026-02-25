import { Briefcase, ListTodo, FolderKanban, Target, Map, GitBranch, Layers, PenTool, Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const sections = [
  { id: 'projects', label: 'Projects', icon: FolderKanban, path: '/work/projects', desc: 'Project list & details' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, path: '/work/tasks', desc: 'Kanban & time-slot view' },
  { id: 'okr', label: 'OKR', icon: Target, path: '/work/okr', desc: 'Objectives & key results' },
  { id: 'roadmap', label: 'Roadmap', icon: Map, path: '/work/roadmap', desc: 'Repo scan & feature list' },
  { id: 'dev-tasks', label: 'Dev Tasks', icon: GitBranch, path: '/work/dev-tasks', desc: 'Development task tracking' },
  { id: 'features', label: 'Features', icon: Layers, path: '/work/features', desc: 'Feature registry' },
  { id: 'panorama', label: 'Panorama', icon: Compass, path: '/work/panorama', desc: 'Full view' },
  { id: 'whiteboard', label: 'Whiteboard', icon: PenTool, path: '/work/whiteboard', desc: 'Whiteboard & mind map' },
] as const;

export default function WorkHome() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Briefcase size={24} />
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Work</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
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
