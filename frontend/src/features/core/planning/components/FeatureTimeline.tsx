/**
 * FeatureTimeline - Feature evolution path with collapsible PR list
 * Groups PRs by feature extracted from title/branch name
 */

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  GitMerge,
  GitBranch,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import type { FeatureInfo, PrInfo } from '../api/github.api';

interface FeatureTimelineProps {
  features: FeatureInfo[];
  loading?: boolean;
}

// PR state badge component
const PrStateBadge = ({ state }: { state: string }) => {
  const config = {
    merged: {
      icon: GitMerge,
      color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    },
    open: {
      icon: GitPullRequest,
      color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    },
    closed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
  };

  const { icon: Icon, color } = config[state as keyof typeof config] || config.closed;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded ${color}`}>
      <Icon className="w-3 h-3" />
    </span>
  );
};

// Feature card component
const FeatureCard = ({ feature }: { feature: FeatureInfo }) => {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
    });
  };

  const mergedCount = feature.prs.filter((pr) => pr.state === 'merged').length;
  const openCount = feature.prs.filter((pr) => pr.state === 'open').length;

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 last:border-b-0">
      {/* Feature header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
          <span className="font-medium text-slate-800 dark:text-white">
            {feature.displayName}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            [{feature.prs.length} PR{feature.prs.length > 1 ? 's' : ''}]
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {mergedCount > 0 && (
            <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-full">
              {mergedCount} merged
            </span>
          )}
          {openCount > 0 && (
            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
              {openCount} open
            </span>
          )}
        </div>
      </button>

      {/* Latest PR preview (when collapsed) */}
      {!expanded && feature.latestPr && (
        <div className="px-4 pb-3 pl-11">
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
            Latest: {feature.latestPr.title}
          </p>
        </div>
      )}

      {/* PR list (when expanded) */}
      {expanded && (
        <div className="pb-2">
          {feature.prs.map((pr) => (
            <PrItem key={pr.number} pr={pr} formatDate={formatDate} />
          ))}
        </div>
      )}
    </div>
  );
};

// Individual PR item
const PrItem = ({ pr, formatDate }: { pr: PrInfo; formatDate: (d: string) => string }) => (
  <a
    href={pr.url}
    target="_blank"
    rel="noopener noreferrer"
    className="block mx-4 mb-2 ml-11 p-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-colors group"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            #{pr.number}
          </span>
          <PrStateBadge state={pr.state} />
          <ExternalLink className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-sm font-medium text-slate-800 dark:text-white truncate">
          {pr.title}
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            {pr.headBranch}
          </span>
          <span>{formatDate(pr.mergedAt || pr.createdAt)}</span>
        </div>
      </div>
    </div>
  </a>
);

export default function FeatureTimeline({ features, loading }: FeatureTimelineProps) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-slate-100 dark:bg-slate-700/50 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!features || features.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-slate-400 dark:text-slate-500">
        <p>暂无 Feature 数据</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-700">
      {features.map((feature) => (
        <FeatureCard key={feature.name} feature={feature} />
      ))}
    </div>
  );
}
