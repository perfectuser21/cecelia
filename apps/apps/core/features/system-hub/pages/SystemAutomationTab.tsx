import { useState, Suspense, lazy } from 'react';
import { Workflow, Activity, Users, Loader2 } from 'lucide-react';

const N8nWorkflows = lazy(() => import('../../execution/pages/N8nWorkflows'));
const N8nLiveStatus = lazy(() => import('../../execution/pages/N8nLiveStatus'));
const WorkersOverview = lazy(() => import('../../execution/pages/WorkersOverview'));

const subTabs = [
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'live', label: 'Live', icon: Activity },
  { id: 'workers', label: 'Workers', icon: Users },
] as const;

type SubTabId = (typeof subTabs)[number]['id'];

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64 text-slate-400">
    <Loader2 className="w-6 h-6 animate-spin mr-2" />
    Loading...
  </div>
);

export default function SystemAutomationTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>('workflows');

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
        {activeSubTab === 'workflows' && <N8nWorkflows />}
        {activeSubTab === 'live' && <N8nLiveStatus />}
        {activeSubTab === 'workers' && <WorkersOverview />}
      </Suspense>
    </div>
  );
}
