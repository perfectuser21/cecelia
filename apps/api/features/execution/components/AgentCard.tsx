import { Zap, RefreshCw, Diamond, ChevronRight } from 'lucide-react';
import { AgentWithStats } from '../api/agents.api';

interface AgentCardProps {
  agent: AgentWithStats;
  onClick: () => void;
}

const iconMap: Record<string, React.ElementType> = {
  Zap,
  RefreshCw,
  Diamond,
};

export default function AgentCard({ agent, onClick }: AgentCardProps) {
  const Icon = iconMap[agent.icon] || Zap;
  const isPlanned = agent.status === 'planned';
  const isWorking = agent.stats.todayRunning > 0;

  return (
    <button
      onClick={onClick}
      disabled={isPlanned}
      className={`
        w-full text-left p-5 rounded-xl border transition-all duration-200
        ${isPlanned
          ? 'bg-slate-800/50 border-slate-700 opacity-60 cursor-not-allowed'
          : `bg-gradient-to-br ${agent.gradient.from} ${agent.gradient.to} bg-opacity-10
             dark:bg-slate-800 hover:scale-[1.02] hover:shadow-lg ${agent.gradient.border}`
        }
      `}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`
          p-3 rounded-xl
          ${isPlanned
            ? 'bg-slate-700'
            : `bg-gradient-to-br ${agent.gradient.from} ${agent.gradient.to}`
          }
        `}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {!isPlanned && (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </div>

      <h3 className="text-lg font-bold text-white mb-1">
        {agent.name}
      </h3>
      <p className="text-sm text-gray-400 mb-1">
        {agent.role} · {agent.codename}
      </p>

      {isPlanned ? (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <span className="text-sm text-gray-500">待激活</span>
        </div>
      ) : (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-2xl font-bold text-white">{agent.stats.todayTotal}</span>
                <span className="text-sm text-gray-400 ml-1">今日</span>
              </div>
              {agent.stats.todaySuccess > 0 && (
                <div className="text-emerald-400 text-sm">
                  {agent.stats.todaySuccess} 成功
                </div>
              )}
              {agent.stats.todayError > 0 && (
                <div className="text-red-400 text-sm">
                  {agent.stats.todayError} 失败
                </div>
              )}
            </div>
            {isWorking && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/20 rounded-full">
                <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />
                <span className="text-xs text-blue-400">工作中</span>
              </div>
            )}
          </div>
        </div>
      )}
    </button>
  );
}
