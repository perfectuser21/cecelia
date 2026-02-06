import { Monitor, Bot, Cpu, Workflow, Users, Activity, Server, GitBranch, Compass, Brain } from 'lucide-react';
import GenericHome from '../../shared/pages/GenericHome';
import type { HomeGroup } from '../../shared/pages/GenericHome';

const groups: HomeGroup[] = [
  {
    title: 'Cecelia',
    items: [
      { id: 'cecelia', label: 'Cecelia Overview', icon: Bot, path: '/system/cecelia' },
      { id: 'runs', label: 'Runs', icon: Bot, path: '/system/cecelia/runs' },
    ],
  },
  {
    title: 'Engine',
    items: [
      { id: 'engine', label: 'Engine Dashboard', icon: Cpu, path: '/system/engine' },
      { id: 'capabilities', label: 'Capabilities', icon: Cpu, path: '/system/engine/capabilities' },
      { id: 'brain', label: 'Brain', icon: Brain, path: '/system/brain' },
    ],
  },
  {
    title: 'N8N',
    items: [
      { id: 'workflows', label: 'Workflows', icon: Workflow, path: '/system/n8n/workflows' },
      { id: 'live-status', label: 'Live Status', icon: Workflow, path: '/system/n8n/live-status' },
    ],
  },
  {
    title: 'Workers',
    items: [
      { id: 'workers', label: 'Workers Overview', icon: Users, path: '/system/workers' },
      { id: 'session-monitor', label: 'Session Monitor', icon: Users, path: '/system/session-monitor' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { id: 'infrastructure', label: 'Infrastructure', icon: Server, path: '/system/infrastructure' },
      { id: 'claude', label: 'Claude', icon: Bot, path: '/system/claude' },
      { id: 'operations', label: 'Operations', icon: Activity, path: '/system/operations' },
      { id: 'devgate', label: 'DevGate', icon: GitBranch, path: '/system/devgate' },
    ],
  },
  {
    title: 'Visualization',
    items: [
      { id: 'panorama', label: 'Dev Panorama', icon: Compass, path: '/system/panorama' },
    ],
  },
];

export default function SystemHome() {
  return <GenericHome title="System" icon={Monitor} groups={groups} minCardWidth={200} />;
}
