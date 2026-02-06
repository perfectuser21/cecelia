import { Suspense, lazy, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface TabConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
}

interface TabbedPageProps {
  tabs: TabConfig[];
  basePath: string;
}

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64 text-slate-400">
    <Loader2 className="w-6 h-6 animate-spin mr-2" />
    Loading...
  </div>
);

export default function TabbedPage({ tabs, basePath }: TabbedPageProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const lazyComponents = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((tab) => [tab.id, lazy(tab.component)])
      ),
    [tabs]
  );

  const activeTab = useMemo(() => {
    const sorted = [...tabs].sort((a, b) => b.path.length - a.path.length);
    const match = sorted.find(
      (tab) =>
        location.pathname === tab.path ||
        location.pathname.startsWith(tab.path + '/')
    );
    return match?.id ?? tabs[0]?.id;
  }, [location.pathname, tabs]);

  const ActiveComponent = activeTab ? lazyComponents[activeTab] : null;

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
                onClick={() => navigate(tab.path)}
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
        {ActiveComponent && <ActiveComponent />}
      </Suspense>
    </div>
  );
}
