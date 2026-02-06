import React, { Suspense, useState } from 'react';
import { Radio, Shield } from 'lucide-react';

const LiveDashboard = React.lazy(() => import('./LiveDashboard'));
const QualityMonitorPage = React.lazy(() => import('./QualityMonitorPage'));

const tabs = [
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'qa', label: 'QA', icon: Shield },
] as const;

type TabId = (typeof tabs)[number]['id'];

const Loading = () => (
  <div className="flex items-center justify-center h-64 text-slate-400">
    Loading...
  </div>
);

export default function OperationsMonitor() {
  const [activeTab, setActiveTab] = useState<TabId>('live');

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="flex border-b border-slate-700 bg-slate-800">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${
                active
                  ? 'text-white border-b-2 border-blue-500 bg-slate-900'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<Loading />}>
        {activeTab === 'live' && <LiveDashboard />}
        {activeTab === 'qa' && <QualityMonitorPage />}
      </Suspense>
    </div>
  );
}
