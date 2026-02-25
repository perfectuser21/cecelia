import React, { useState, useMemo } from 'react';
import {
  Inbox, Filter, RefreshCw, Wifi, WifiOff,
  ChevronDown, ChevronUp, CheckCircle2,
} from 'lucide-react';
import { useProposals } from '../hooks/useProposals';
import type { Proposal } from '../hooks/useProposals';
import ProposalCard from '../components/ProposalCard';
import HeartbeatEditor from '../components/HeartbeatEditor';
import { LoadingState, EmptyState } from '../../shared/components/LoadingState';

type FilterType = 'all' | string;
type TabType = 'inbox' | 'heartbeat';

function getUniqueTypes(proposals: Proposal[]): string[] {
  const types = new Set(proposals.map(p => p.action_type));
  return Array.from(types).sort();
}

const TYPE_LABELS: Record<string, string> = {
  propose_decomposition: 'OKR 拆解',
  propose_anomaly_action: '异常处理',
  propose_priority_change: '优先级',
  propose_milestone_review: '里程碑',
  propose_weekly_plan: '周计划',
  propose_strategy_adjustment: '策略调整',
  heartbeat_finding: '巡检发现',
  quarantine_task: '任务隔离',
  request_human_review: '人工审核',
  adjust_strategy: '策略调整',
};

export default function InboxPage(): React.ReactElement {
  const {
    proposals,
    pendingCount,
    loading,
    error,
    refresh,
    approve,
    reject,
    comment,
    selectOption,
    wsConnected,
  } = useProposals();

  const [filter, setFilter] = useState<FilterType>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [tab, setTab] = useState<TabType>('inbox');

  const pending = useMemo(
    () => proposals.filter(p => p.status === 'pending_approval'),
    [proposals]
  );

  const resolved = useMemo(
    () => proposals.filter(p => p.status !== 'pending_approval'),
    [proposals]
  );

  const filteredPending = useMemo(
    () => filter === 'all' ? pending : pending.filter(p => p.action_type === filter),
    [pending, filter]
  );

  const filteredResolved = useMemo(
    () => filter === 'all' ? resolved : resolved.filter(p => p.action_type === filter),
    [resolved, filter]
  );

  const uniqueTypes = useMemo(() => getUniqueTypes(proposals), [proposals]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Inbox className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-white">收件箱</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cecelia 的提案和巡检
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection status */}
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium ${
            wsConnected
              ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
          }`}>
            {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {wsConnected ? '实时' : '轮询'}
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs: Inbox / Heartbeat */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        <button
          onClick={() => setTab('inbox')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'inbox'
              ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Inbox className="w-4 h-4" />
          提案
          {pendingCount > 0 && (
            <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('heartbeat')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'heartbeat'
              ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          巡检设置
        </button>
      </div>

      {/* Tab content */}
      {tab === 'heartbeat' ? (
        <HeartbeatEditor />
      ) : (
        <>
          {/* Filter bar */}
          {uniqueTypes.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                全部
              </button>
              {uniqueTypes.map(type => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    filter === type
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {TYPE_LABELS[type] || type}
                </button>
              ))}
            </div>
          )}

          {/* Loading */}
          {loading && <LoadingState message="加载提案..." />}

          {/* Error */}
          {error && !loading && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button onClick={refresh} className="mt-2 text-xs text-red-500 hover:underline">
                重试
              </button>
            </div>
          )}

          {/* Pending proposals */}
          {!loading && !error && (
            <>
              {filteredPending.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="w-16 h-16" />}
                  title="没有待处理的提案"
                  description="Cecelia 目前没有需要你决定的事情"
                  height="h-48"
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    待处理 ({filteredPending.length})
                  </p>
                  {filteredPending.map(p => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      onApprove={approve}
                      onReject={reject}
                      onComment={comment}
                      onSelect={selectOption}
                    />
                  ))}
                </div>
              )}

              {/* Resolved section */}
              {filteredResolved.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowResolved(!showResolved)}
                    className="flex items-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    {showResolved ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    已处理 ({filteredResolved.length})
                  </button>
                  {showResolved && (
                    <div className="mt-3 space-y-3 opacity-60">
                      {filteredResolved.map(p => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          onApprove={approve}
                          onReject={reject}
                          onComment={comment}
                          onSelect={selectOption}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
