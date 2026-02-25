import { useState, Suspense, lazy } from 'react';
import { Server, Activity, Loader2 } from 'lucide-react';

const VpsMonitor = lazy(() => import('./VpsMonitor'));
const PerformanceMonitoring = lazy(() => import('./PerformanceMonitoring'));

const tabs = [
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'services', label: 'Services', icon: Activity },
] as const;

type TabId = (typeof tabs)[number]['id'];

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64 text-slate-400">
    <Loader2 className="w-6 h-6 animate-spin mr-2" />
    Loading...
  </div>
);

export default function InfrastructureMonitor() {
  const [activeTab, setActiveTab] = useState<TabId>('infrastructure');

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="border-b border-slate-700 bg-slate-800">
        <div className="flex space-x-1 p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<LoadingFallback />}>
        {activeTab === 'infrastructure' && <VpsMonitor />}
        {activeTab === 'services' && <PerformanceMonitoring />}
      </Suspense>
    </div>
  );
}
