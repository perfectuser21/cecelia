/**
 * PanoramaV3 - 个人指挥中心 Command Center
 * 六个区域：TODAY, AI WORKFORCE, MEDIA, CLIENTS, PORTFOLIO, LIVE
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ListTodo,
  Bot,
  Share2,
  Briefcase,
  TrendingUp,
  Activity,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { getPlan, type PlanData } from '../api/panorama.api';
import TodaySection from '../components/TodaySection';
import AIWorkforceSection from '../components/AIWorkforceSection';
import MediaSection from '../components/MediaSection';
import ClientsSection from '../components/ClientsSection';
import PortfolioSection from '../components/PortfolioSection';
import LiveSection from '../components/LiveSection';

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

// Section header component
const SectionHeader = ({
  icon: Icon,
  title,
  subtitle,
  color = 'slate',
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  color?: 'slate' | 'blue' | 'purple' | 'emerald' | 'amber';
}) => {
  const colorClasses = {
    slate: 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  };

  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
      <div className={`p-2 rounded-xl ${colorClasses[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

export default function PanoramaV3() {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const planRes = await getPlan();
      if (planRes.success && planRes.data) {
        setPlan(planRes.data);
      }

      setLastUpdated(new Date());
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRefresh = () => {
    fetchData();
  };

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="space-y-6 p-2 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Command Center</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Personal Dashboard
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
              className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* TODAY Section - Full width */}
        <GlassCard className="overflow-hidden">
          <SectionHeader icon={ListTodo} title="Today" subtitle="Plan & Tasks" color="slate" />
          <div className="p-5">
            <TodaySection data={plan} loading={loading} />
          </div>
        </GlassCard>

        {/* AI WORKFORCE + MEDIA - Two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <GlassCard className="overflow-hidden">
            <SectionHeader icon={Bot} title="AI Workforce" subtitle="Cecelia + N8N" color="blue" />
            <div className="p-5">
              <AIWorkforceSection loading={loading} />
            </div>
          </GlassCard>

          <GlassCard className="overflow-hidden">
            <SectionHeader icon={Share2} title="Media" subtitle="Content & Growth" color="purple" />
            <div className="p-5">
              <MediaSection loading={loading} />
            </div>
          </GlassCard>
        </div>

        {/* CLIENTS + PORTFOLIO - Two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <GlassCard className="overflow-hidden">
            <SectionHeader icon={Briefcase} title="Clients" subtitle="Project Delivery" color="emerald" />
            <div className="p-5">
              <ClientsSection loading={loading} />
            </div>
          </GlassCard>

          <GlassCard className="overflow-hidden">
            <SectionHeader icon={TrendingUp} title="Portfolio" subtitle="Investments" color="amber" />
            <div className="p-5">
              <PortfolioSection loading={loading} />
            </div>
          </GlassCard>
        </div>

        {/* LIVE Section - Full width */}
        <GlassCard className="overflow-hidden">
          <SectionHeader icon={Activity} title="Live" subtitle="Current Execution" color="blue" />
          <div className="p-5">
            <LiveSection loading={loading} />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
