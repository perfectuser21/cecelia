import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, X, MessageCircle, ChevronDown, ChevronUp,
  AlertTriangle, GitBranch, Target, Calendar, Shield,
  Milestone, BarChart3, Activity, ClipboardCheck, Leaf,
} from 'lucide-react';
import type { Proposal } from '../hooks/useProposals';
import ProposalChat from './ProposalChat';
import ProposalOptions from './ProposalOptions';
import type { ProposalComment } from '../hooks/useProposals';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  propose_decomposition: { icon: GitBranch, color: 'text-purple-500 bg-purple-100 dark:bg-purple-900/40', label: 'OKR 拆解' },
  propose_anomaly_action: { icon: AlertTriangle, color: 'text-red-500 bg-red-100 dark:bg-red-900/40', label: '异常处理' },
  propose_priority_change: { icon: BarChart3, color: 'text-orange-500 bg-orange-100 dark:bg-orange-900/40', label: '优先级调整' },
  propose_milestone_review: { icon: Milestone, color: 'text-green-500 bg-green-100 dark:bg-green-900/40', label: '里程碑审核' },
  propose_weekly_plan: { icon: Calendar, color: 'text-blue-500 bg-blue-100 dark:bg-blue-900/40', label: '周计划' },
  propose_strategy_adjustment: { icon: Target, color: 'text-cyan-500 bg-cyan-100 dark:bg-cyan-900/40', label: '策略调整' },
  heartbeat_finding: { icon: Activity, color: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/40', label: '巡检发现' },
  quarantine_task: { icon: Shield, color: 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/40', label: '任务隔离' },
  request_human_review: { icon: MessageCircle, color: 'text-indigo-500 bg-indigo-100 dark:bg-indigo-900/40', label: '人工审核' },
  adjust_strategy: { icon: Target, color: 'text-teal-500 bg-teal-100 dark:bg-teal-900/40', label: '策略调整' },
  okr_decomp_review: { icon: ClipboardCheck, color: 'text-violet-500 bg-violet-100 dark:bg-violet-900/40', label: 'OKR 拆解确认' },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] || { icon: MessageCircle, color: 'text-slate-500 bg-slate-100 dark:bg-slate-700', label: type };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  return `${days} 天前`;
}

function getSummary(proposal: Proposal): string {
  if (proposal.action_type === 'okr_decomp_review') {
    const ctx = proposal.context as Record<string, unknown>;
    return `秋米已完成拆解：KR「${ctx.kr_title || '未知'}」→ 项目「${ctx.project_name || '未知'}」`;
  }
  const p = proposal.params;
  return (p.summary || p.description || p.title || p.reason || JSON.stringify(p).slice(0, 120)) as string;
}

function OkrDecompDetails({ context }: { context: Record<string, unknown> }): React.ReactElement | null {
  const initiatives = Array.isArray(context.initiatives) ? context.initiatives as string[] : [];
  const decomposedAt = context.decomposed_at as string | undefined;

  if (initiatives.length === 0) return null;

  return (
    <div className="mt-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/30">
      <p className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-2">
        拆解结果（{initiatives.length} 个 Initiative）
      </p>
      <ul className="space-y-1">
        {initiatives.map((name, idx) => (
          <li key={idx} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
            {name}
          </li>
        ))}
      </ul>
      {decomposedAt && (
        <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
          拆解时间：{new Date(decomposedAt).toLocaleString('zh-CN')}
        </p>
      )}
    </div>
  );
}

interface ProposalCardProps {
  proposal: Proposal;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
  onComment: (id: string, message: string) => Promise<ProposalComment | null>;
  onSelect: (id: string, optionId: string) => Promise<void>;
}

export default function ProposalCard({
  proposal,
  onApprove,
  onReject,
  onComment,
  onSelect,
}: ProposalCardProps): React.ReactElement {
  const navigate = useNavigate();
  const [showChat, setShowChat] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [acting, setActing] = useState(false);
  const config = getTypeConfig(proposal.action_type);
  const Icon = config.icon;
  const hasOptions = proposal.options && proposal.options.length > 0;

  const handleApprove = async () => {
    setActing(true);
    try { await onApprove(proposal.id); } catch { setActing(false); }
  };

  const handleReject = async () => {
    setActing(true);
    try { await onReject(proposal.id); } catch { setActing(false); }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {config.label}
              </span>
              {proposal.source && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                  {proposal.source}
                </span>
              )}
              <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto whitespace-nowrap">
                {timeAgo(proposal.created_at)}
              </span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              {getSummary(proposal)}
            </p>
          </div>
        </div>

        {/* OKR 拆解专属展示 */}
        {proposal.action_type === 'okr_decomp_review' && (
          <OkrDecompDetails context={proposal.context as Record<string, unknown>} />
        )}

        {/* Expandable details（非 okr_decomp_review 类型） */}
        {proposal.action_type !== 'okr_decomp_review' && proposal.context && Object.keys(proposal.context).length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              详情
            </button>
            {showDetails && (
              <pre className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-600 dark:text-slate-400 overflow-x-auto">
                {JSON.stringify(proposal.context, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Options (for multi-choice proposals) */}
        {hasOptions && (
          <ProposalOptions
            options={proposal.options!}
            onSelect={(optionId) => onSelect(proposal.id, optionId)}
          />
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
          {!hasOptions && (
            <>
              <button
                onClick={handleApprove}
                disabled={acting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {proposal.action_type === 'okr_decomp_review' ? '确认放行' : '批准'}
              </button>
              {proposal.action_type === 'okr_decomp_review' ? (
                <button
                  onClick={() => navigate(`/okr/review/${proposal.id}`)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50 disabled:opacity-50 transition-colors"
                >
                  <Leaf className="w-3.5 h-3.5" />
                  与秋米对话
                </button>
              ) : (
                <button
                  onClick={handleReject}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  拒绝
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setShowChat(!showChat)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors ml-auto"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            追问
            {(proposal.comments?.length || 0) > 0 && (
              <span className="ml-1 text-[10px] bg-blue-200 dark:bg-blue-800 px-1 rounded">
                {proposal.comments!.length}
              </span>
            )}
          </button>
        </div>

        {/* Chat area (通用追问) */}
        {showChat && (
          <ProposalChat
            comments={proposal.comments || []}
            onSend={(msg) => onComment(proposal.id, msg)}
          />
        )}

      </div>
    </div>
  );
}
