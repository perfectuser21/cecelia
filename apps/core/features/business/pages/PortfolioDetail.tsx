/**
 * PortfolioDetail - 投资组合详情页（占位）
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp } from 'lucide-react';

export default function PortfolioDetail() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/command')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-8"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Command Center</span>
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Portfolio</h1>
            <p className="text-slate-500 dark:text-slate-400">Investments</p>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-12 text-center">
          <p className="text-slate-500 dark:text-slate-400">Coming soon</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-2">
            Connect investment APIs
          </p>
        </div>
      </div>
    </div>
  );
}
