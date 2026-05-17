/**
 * DevPanorama - VPS 全景视图 v2
 * 双栏布局：左侧分支图，右侧 Feature 进化路径
 * 支持三个仓库 Tab 切换
 */

import { useEffect, useState, useCallback } from 'react';
import {
  GitBranch,
  GitPullRequest,
  Clock,
  RefreshCw,
  Server,
  AlertCircle,
  Layers,
} from 'lucide-react';
import {
  getCommits,
  getFeatures,
  type CommitsData,
  type FeaturesData,
} from '../api/github.api';
import BranchGraph from '../components/BranchGraph';
import FeatureTimeline from '../components/FeatureTimeline';

// Tracked repos
const REPOS = ['zenithjoy-engine', 'zenithjoy-core', 'zenithjoy-autopilot'];

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
      transition-all duration-300 ease-out
      ${className}
    `}
  >
    {children}
  </div>
);

// Tab button component
const TabButton = ({
  repo,
  active,
  onClick,
}: {
  repo: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`
      px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200
      ${active
        ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-800 shadow-md'
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
      }
    `}
  >
    {repo}
  </button>
);

// Section header component
const SectionHeader = ({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) => (
  <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 dark:border-slate-700">
    <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
  </div>
);

export default function DevPanorama() {
  const [activeRepo, setActiveRepo] = useState(REPOS[0]);
  const [commitsData, setCommitsData] = useState<CommitsData | null>(null);
  const [featuresData, setFeaturesData] = useState<FeaturesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async (repo: string) => {
    try {
      setLoading(true);
      setError(null);

      const [commitsRes, featuresRes] = await Promise.all([
        getCommits(repo),
        getFeatures(repo),
      ]);

      if (commitsRes.success && commitsRes.data) {
        setCommitsData(commitsRes.data);
      } else {
        setCommitsData(null);
      }

      if (featuresRes.success && featuresRes.data) {
        setFeaturesData(featuresRes.data);
      } else {
        setFeaturesData(null);
      }

      setLastUpdated(new Date());
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeRepo);
  }, [activeRepo, fetchData]);

  // Auto refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => fetchData(activeRepo), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activeRepo, fetchData]);

  const handleRefresh = () => {
    fetchData(activeRepo);
  };

  const handleTabChange = (repo: string) => {
    if (repo !== activeRepo) {
      setActiveRepo(repo);
    }
  };

  // Calculate stats
  const stats = {
    mainCommits: commitsData?.main?.length || 0,
    developCommits: commitsData?.develop?.length || 0,
    features: featuresData?.features?.length || 0,
    totalPrs: featuresData?.features?.reduce((acc, f) => acc + f.prs.length, 0) || 0,
  };

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8">
      <div className="space-y-6 p-2">
        {/* Header */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-white">VPS 全景视图</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                分支结构 + Feature 进化路径
              </p>
            </div>
            <div className="flex items-center gap-4">
              {lastUpdated && (
                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                title="刷新"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Repo tabs */}
          <div className="mt-4 flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-700/50 rounded-xl">
            {REPOS.map((repo) => (
              <TabButton
                key={repo}
                repo={repo}
                active={repo === activeRepo}
                onClick={() => handleTabChange(repo)}
              />
            ))}
          </div>
        </GlassCard>

        {/* Error state */}
        {error && (
          <GlassCard className="p-6 border-red-200 dark:border-red-800/50">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertCircle className="w-5 h-5" />
              <div>
                <p className="font-medium">加载失败</p>
                <p className="text-sm opacity-75">{error}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Stats row */}
        {!error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: '仓库',
                value: activeRepo.replace('zenithjoy-', ''),
                icon: Server,
                color: 'text-slate-600 dark:text-slate-400',
                bg: 'bg-slate-500/10',
              },
              {
                label: 'Main Commits',
                value: stats.mainCommits,
                icon: GitBranch,
                color: 'text-emerald-600 dark:text-emerald-400',
                bg: 'bg-emerald-500/10',
              },
              {
                label: 'Features',
                value: stats.features,
                icon: Layers,
                color: 'text-purple-600 dark:text-purple-400',
                bg: 'bg-purple-500/10',
              },
              {
                label: '总 PRs',
                value: stats.totalPrs,
                icon: GitPullRequest,
                color: 'text-blue-600 dark:text-blue-400',
                bg: 'bg-blue-500/10',
              },
            ].map((stat) => (
              <GlassCard key={stat.label} className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
                    <p className="text-xl font-semibold text-slate-800 dark:text-white">{stat.value}</p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Main content - Two column layout */}
        {!error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Branch Graph */}
            <GlassCard className="overflow-hidden">
              <SectionHeader icon={GitBranch} title="分支图" />
              <div className="p-5">
                <BranchGraph data={commitsData} loading={loading} />
              </div>
            </GlassCard>

            {/* Right: Feature Timeline */}
            <GlassCard className="overflow-hidden">
              <SectionHeader icon={Layers} title="Feature 进化路径" />
              <div className="max-h-[400px] overflow-y-auto">
                <FeatureTimeline
                  features={featuresData?.features || []}
                  loading={loading}
                />
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </div>
  );
}
