/**
 * PortfolioSection - Investment portfolio (placeholder)
 */

import { Wallet, TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  loading: boolean;
}

export default function PortfolioSection({ loading }: Props) {
  if (loading) {
    return (
      <div className="h-32 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Total Value
            </span>
          </div>
          <div className="flex items-center gap-1 text-slate-400">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs">-</span>
          </div>
        </div>
        <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-2">
          $ -
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-center">
          <TrendingUp className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
          <p className="text-sm font-bold text-emerald-500">-</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Day P/L</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 text-center">
          <TrendingDown className="w-4 h-4 text-slate-400 mx-auto mb-1" />
          <p className="text-sm font-bold text-slate-500">-</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Total P/L</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
        Coming soon
      </p>
    </div>
  );
}
