/**
 * RepoDetail - 单仓库详情页
 * 显示完整的分支树和 PR 历史
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  GitBranch,
  GitPullRequest,
  GitMerge,
  GitCommit,
  ArrowLeft,
  RefreshCw,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { getBranches, getPulls, type BranchInfo, type PrInfo } from '../api/github.api';

// Glass card component
const GlassCard = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`
      rounded-2xl
      bg-white dark:bg-slate-800/80
      backdrop-blur-xl
      border border-slate-200 dark:border-slate-700
      shadow-lg shadow-slate-200/50 dark:shadow-black/30
      ${className}
    `}
  >
    {children}
  </div>
);

// Branch tree visualization
const BranchTree = ({ branches }: { branches: BranchInfo[] }) => {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set(['main', 'develop']));

  const toggleBranch = (name: string) => {
    const newExpanded = new Set(expandedBranches);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedBranches(newExpanded);
  };

  const formatTime = (time: string) => {
    const date = new Date(time);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getBranchColor = (name: string) => {
    if (name === 'main') return 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20';
    if (name === 'develop') return 'border-blue-500 bg-blue-50 dark:bg-blue-900/20';
    if (name.startsWith('feature/')) return 'border-purple-500 bg-purple-50 dark:bg-purple-900/20';
    if (name.startsWith('cp-')) return 'border-amber-500 bg-amber-50 dark:bg-amber-900/20';
    return 'border-slate-300 bg-slate-50 dark:bg-slate-700/50';
  };

  const getBranchIcon = (name: string) => {
    if (name === 'main' || name === 'develop') {
      return <GitBranch className="w-4 h-4 text-slate-500" />;
    }
    return <GitCommit className="w-4 h-4 text-slate-400" />;
  };

  // Group branches
  const mainBranch = branches.find((b) => b.name === 'main');
  const developBranch = branches.find((b) => b.name === 'develop');
  const featureBranches = branches.filter((b) => b.name.startsWith('feature/'));
  const cpBranches = branches.filter((b) => b.name.startsWith('cp-'));
  const otherBranches = branches.filter(
    (b) => !['main', 'develop'].includes(b.name) && !b.name.startsWith('feature/') && !b.name.startsWith('cp-')
  );

  const renderBranch = (branch: BranchInfo, indent = 0) => {
    const isExpanded = expandedBranches.has(branch.name);

    return (
      <div key={branch.name} className="relative">
        {/* Connection line */}
        {indent > 0 && (
          <div
            className="absolute left-4 top-0 w-px h-full bg-slate-200 dark:bg-slate-700"
            style={{ marginLeft: `${(indent - 1) * 24}px` }}
          />
        )}

        <div
          className={`
            relative flex items-start gap-3 p-3 rounded-lg border-l-4 cursor-pointer
            transition-all hover:shadow-md
            ${getBranchColor(branch.name)}
          `}
          style={{ marginLeft: `${indent * 24}px` }}
          onClick={() => toggleBranch(branch.name)}
        >
          {/* Expand icon */}
          <div className="mt-0.5">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            )}
          </div>

          {/* Branch icon */}
          <div className="mt-0.5">{getBranchIcon(branch.name)}</div>

          {/* Branch info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium text-slate-800 dark:text-white">
                {branch.name}
              </span>
              {branch.protected && (
                <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded">
                  protected
                </span>
              )}
            </div>

            {isExpanded && (
              <div className="mt-2 space-y-1">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-mono text-slate-500">{branch.sha.slice(0, 7)}</span>
                  <span className="mx-2">·</span>
                  {branch.lastCommit.message}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>{branch.lastCommit.author}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(branch.lastCommit.date)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {/* Main branches */}
      {mainBranch && renderBranch(mainBranch)}
      {developBranch && renderBranch(developBranch, 1)}

      {/* Feature branches */}
      {featureBranches.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 ml-12">
            Feature 分支 ({featureBranches.length})
          </p>
          {featureBranches.map((b) => renderBranch(b, 2))}
        </div>
      )}

      {/* Checkpoint branches */}
      {cpBranches.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 ml-12">
            Checkpoint 分支 ({cpBranches.length})
          </p>
          {cpBranches.map((b) => renderBranch(b, 2))}
        </div>
      )}

      {/* Other branches */}
      {otherBranches.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 ml-12">
            其他分支 ({otherBranches.length})
          </p>
          {otherBranches.map((b) => renderBranch(b, 2))}
        </div>
      )}
    </div>
  );
};

// PR timeline
const PrTimeline = ({ prs }: { prs: PrInfo[] }) => {
  const formatTime = (time: string) => {
    const date = new Date(time);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'merged':
        return 'bg-purple-500';
      case 'open':
        return 'bg-green-500';
      case 'closed':
        return 'bg-red-500';
      default:
        return 'bg-slate-500';
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'merged':
        return <GitMerge className="w-4 h-4 text-white" />;
      case 'open':
        return <GitPullRequest className="w-4 h-4 text-white" />;
      default:
        return <GitPullRequest className="w-4 h-4 text-white" />;
    }
  };

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />

      <div className="space-y-4">
        {prs.map((pr, index) => (
          <div key={pr.number} className="relative flex gap-4">
            {/* Timeline dot */}
            <div
              className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full ${getStateColor(
                pr.state
              )} shadow-lg`}
            >
              {getStateIcon(pr.state)}
            </div>

            {/* PR card */}
            <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-600">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-500">#{pr.number}</span>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        pr.state === 'merged'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                          : pr.state === 'open'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {pr.state}
                    </span>
                  </div>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-slate-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1"
                  >
                    {pr.title}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="mt-2 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span>{pr.author}</span>
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      {pr.headBranch} → {pr.baseBranch}
                    </span>
                    {pr.changedFiles > 0 && (
                      <span>
                        <span className="text-green-600 dark:text-green-400">+{pr.additions}</span>
                        <span className="mx-1">/</span>
                        <span className="text-red-600 dark:text-red-400">-{pr.deletions}</span>
                        <span className="ml-1">({pr.changedFiles} files)</span>
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  {formatTime(pr.mergedAt || pr.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function RepoDetail() {
  const { repoName } = useParams<{ repoName: string }>();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [prs, setPrs] = useState<PrInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'branches' | 'prs'>('branches');

  useEffect(() => {
    if (!repoName) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [branchesRes, prsRes] = await Promise.all([
          getBranches(repoName),
          getPulls(repoName, { state: 'all', limit: 20 }),
        ]);

        if (branchesRes.success && branchesRes.data) {
          setBranches(branchesRes.data);
        }
        if (prsRes.success && prsRes.data) {
          setPrs(prsRes.data);
        }
      } catch (e) {
        console.error('Fetch error:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [repoName]);

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8">
      <div className="space-y-6 p-2">
        {/* Header */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/panorama"
                className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{repoName}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {branches.length} 个分支 · {prs.length} 个 PR
                </p>
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setActiveTab('branches')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'branches'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-800'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              <GitBranch className="w-4 h-4 inline-block mr-2" />
              分支树
            </button>
            <button
              onClick={() => setActiveTab('prs')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'prs'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-800'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              <GitPullRequest className="w-4 h-4 inline-block mr-2" />
              PR 时间线
            </button>
          </div>
        </GlassCard>

        {/* Content */}
        <GlassCard className="p-6">
          {loading ? (
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-slate-100 dark:bg-slate-700/50 rounded-lg" />
              ))}
            </div>
          ) : activeTab === 'branches' ? (
            <BranchTree branches={branches} />
          ) : (
            <PrTimeline prs={prs} />
          )}
        </GlassCard>
      </div>
    </div>
  );
}
