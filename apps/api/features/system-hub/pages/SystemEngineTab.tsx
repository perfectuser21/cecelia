import { useState, Suspense, lazy } from 'react';
import { Cpu, Brain, Zap, Loader2 } from 'lucide-react';

const EngineDashboard = lazy(() => import('../../execution/pages/EngineDashboard'));
const BrainDashboard = lazy(() => import('../../planning/pages/BrainDashboard'));
const EngineCapabilities = lazy(() => import('../../execution/pages/EngineCapabilities'));

const subTabs = [
  { id: 'dashboard', label: 'Dashboard', icon: Cpu },
  { id: 'brain', label: 'Brain', icon: Brain },
  { id: 'capabilities', label: 'Capabilities', icon: Zap },
] as const;

type SubTabId = (typeof subTabs)[number]['id'];

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64 text-slate-400">
    <Loader2 className="w-6 h-6 animate-spin mr-2" />
    Loading...
  </div>
);

export default function SystemEngineTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>('dashboard');

  return (
    <div>
      <div className="border-b border-slate-700/50 bg-slate-800/50">
        <div className="flex space-x-1 px-4 pt-2">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700/50 text-white border-b-2 border-sky-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<LoadingFallback />}>
        {activeSubTab === 'dashboard' && <EngineDashboard />}
        {activeSubTab === 'brain' && <BrainDashboard />}
        {activeSubTab === 'capabilities' && <EngineCapabilities />}
      </Suspense>
    </div>
  );
}
