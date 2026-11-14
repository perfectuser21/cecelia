import { useEffect, useState, useCallback } from 'react';
import { Bot, AlertCircle, Loader2, Brain, Building2, Users, X, ChevronRight } from 'lucide-react';
import {
  fetchStaff,
  type Team,
  type Worker,
} from '../api/staffApi';


// ── Model badge ───────────────────────────────────────────────

function ModelBadge({ provider, name }: { provider: string | null; name: string | null }) {
  if (!provider || !name) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">未配置</span>;
  }
  const colors: Record<string, string> = {
    anthropic: 'bg-orange-900/40 text-orange-400',
    minimax:   'bg-blue-900/40 text-blue-400',
    openai:    'bg-green-900/40 text-green-400',
  };
  const short = name.replace('claude-', '').replace('-20250514', '').replace('-20251001', '').replace('MiniMax-', '');
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[provider] || 'bg-slate-700 text-slate-400'}`}>
      {short}
    </span>
  );
}

// ── Worker card ───────────────────────────────────────────────

function WorkerCard({ worker, onClick }: { worker: Worker; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-700 bg-slate-800 p-4 hover:border-blue-500/50 hover:bg-slate-700/50 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-semibold text-slate-100 group-hover:text-blue-300 transition-colors">
            {worker.name}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{worker.role}</div>
        </div>
        <div className="flex items-center gap-1 text-slate-600 group-hover:text-blue-400 transition-colors">
          <Bot size={15} />
          <ChevronRight size={13} />
        </div>
      </div>
      <p className="text-sm text-slate-400 mb-3 line-clamp-2">{worker.description}</p>
      <div className="flex items-center justify-between">
        <ModelBadge provider={worker.model.provider} name={worker.model.name} />
        {worker.skill && <span className="text-xs text-slate-500 font-mono">{worker.skill}</span>}
      </div>
    </button>
  );
}

// ── Worker detail panel ───────────────────────────────────────

function WorkerPanel({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-screen w-full max-w-sm bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div>
            <div className="font-bold text-slate-100">{worker.name}</div>
            <div className="text-xs text-slate-400">{worker.role}</div>
          </div>
          <button onClick={onClose} aria-label="关闭员工详情" className="text-slate-400 hover:text-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <p className="text-sm text-slate-400">{worker.description}</p>
          {worker.skill && <div className="text-xs font-mono text-slate-300">{worker.skill}</div>}
          <ModelBadge provider={worker.model.provider} name={worker.model.name} />
          {worker.abilities?.map(ability => (
            <div key={ability.id} className="rounded-lg border border-slate-700 p-3">
              <div className="text-sm text-slate-200">{ability.name}</div>
              <div className="text-xs text-slate-400">{ability.description}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Tab 定义 ──────────────────────────────────────────────────

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  areaId: string | null;
}

const TABS: TabDef[] = [
  {
    id: 'core',
    label: '核心团队',
    icon: <Users size={16} />,
    areaId: 'cecelia',
  },
  {
    id: 'zenithjoy',
    label: 'ZenithJoy',
    icon: <Building2 size={16} />,
    areaId: 'zenithjoy',
  },
];

// ── Main page ─────────────────────────────────────────────────

export default function TeamPage() {
  const [teams, setTeams]               = useState<Team[]>([]);
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [selected, setSelected]         = useState<Worker | null>(null);
  const [activeTab, setActiveTab]       = useState('core');

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    fetchStaff()
      .then(staff => {
        setTeams(staff.teams);
        setTotalWorkers(staff.total_workers);
      })
      .catch(err => setError(err.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClose = () => {
    setSelected(null);
    load(true); // 静默刷新，不触发 loading spinner
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-slate-500" size={32} />
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 p-8">
      <AlertCircle size={20} /><span>{error}</span>
    </div>
  );

  const getAreaWorkers = (areaId: string) => {
    const areaTeams = teams.filter(t => t.area === areaId);
    const map: Record<string, Team[]> = {};
    for (const t of areaTeams) {
      const dept = t.department || t.name;
      if (!map[dept]) map[dept] = [];
      map[dept].push(t);
    }
    return map;
  };

  const renderWorkers = (areaId: string) => {
    const deptMap = getAreaWorkers(areaId);
    if (!Object.keys(deptMap).length) return (
      <div className="text-sm text-slate-500 text-center py-8">暂无成员</div>
    );
    return (
      <div className="space-y-6">
        {Object.entries(deptMap).map(([dept, deptTeams]) => {
          const workers = deptTeams.flatMap(t => t.workers);
          return (
            <div key={dept}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium text-slate-400">{dept}</span>
                <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                  {workers.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {workers.map(w => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    onClick={() => setSelected(w)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const currentTab = TABS.find(t => t.id === activeTab) || TABS[0];

  return (
    <div className="p-6 space-y-8">

      {/* ── Header + Tab Bar ─────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <Brain size={22} className="text-slate-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-100">员工目录</h2>
            <p className="text-xs text-slate-500">{totalWorkers} workers · 点击卡片查看职责与能力</p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-800 w-fit mb-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-slate-700 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {currentTab.areaId !== null && renderWorkers(currentTab.areaId)}
        </div>
      </section>

      {/* ── Detail panel ──────────────────────────────── */}
      {selected && (
        <WorkerPanel
          worker={selected}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
