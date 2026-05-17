import { Monitor, Bot, Cpu, Workflow, Users, Activity, Server, Shield, GitBranch, Compass, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SubGroup {
  title: string;
  items: { label: string; icon: React.ComponentType<{ size?: number }>; path: string }[];
}

const groups: SubGroup[] = [
  {
    title: 'Cecelia',
    items: [
      { label: 'Planner', icon: Bot, path: '/system/planner' },
      { label: 'Cecelia Overview', icon: Bot, path: '/system/cecelia' },
      { label: 'Runs', icon: Bot, path: '/system/cecelia/runs' },
    ],
  },
  {
    title: 'Engine',
    items: [
      { label: 'Engine Dashboard', icon: Cpu, path: '/system/engine' },
      { label: 'Capabilities', icon: Cpu, path: '/system/engine/capabilities' },
      { label: 'Brain', icon: Brain, path: '/system/brain' },
      { label: 'Orchestrator', icon: Cpu, path: '/system/orchestrator' },
    ],
  },
  {
    title: 'N8N',
    items: [
      { label: 'Workflows', icon: Workflow, path: '/system/n8n/workflows' },
      { label: 'Live Status', icon: Workflow, path: '/system/n8n/live-status' },
    ],
  },
  {
    title: 'Workers',
    items: [
      { label: 'Workers Overview', icon: Users, path: '/system/workers' },
      { label: 'Session Monitor', icon: Users, path: '/system/session-monitor' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { label: 'VPS Monitor', icon: Server, path: '/system/vps-monitor' },
      { label: 'Performance', icon: Activity, path: '/system/performance' },
      { label: 'Claude Monitor', icon: Bot, path: '/system/claude-monitor' },
      { label: 'Claude Stats', icon: Bot, path: '/system/claude-stats' },
      { label: 'Quality', icon: Shield, path: '/system/quality' },
      { label: 'DevGate', icon: GitBranch, path: '/system/devgate' },
      { label: 'Live Dashboard', icon: Activity, path: '/system/live' },
    ],
  },
  {
    title: 'Panorama',
    items: [
      { label: 'Canvas', icon: Compass, path: '/system/canvas' },
      { label: 'Project Panorama', icon: Compass, path: '/system/project-panorama' },
      { label: 'Dev Panorama', icon: Compass, path: '/system/panorama' },
    ],
  },
];

export default function SystemHome() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Monitor size={24} />
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>System</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {groups.map(group => (
          <div key={group.title}>
            <h2 style={{ fontSize: '16px', fontWeight: 500, color: '#888', marginBottom: '12px' }}>{group.title}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
              {group.items.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      border: '1px solid #333',
                      background: 'transparent',
                      color: '#ccc',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
