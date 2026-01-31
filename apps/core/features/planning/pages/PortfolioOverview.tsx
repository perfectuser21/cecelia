import { TrendingUp, Construction } from 'lucide-react';

export default function PortfolioOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg">
          <TrendingUp className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolio</h1>
          <p className="text-gray-400">投资组合</p>
        </div>
      </div>

      {/* Placeholder */}
      <div className="flex flex-col items-center justify-center py-20 bg-white/5 rounded-xl border border-white/10">
        <Construction className="w-12 h-12 text-gray-500 mb-4" />
        <h2 className="text-lg font-medium text-white">Coming Soon</h2>
        <p className="text-gray-400 mt-1">投资组合功能开发中</p>
      </div>
    </div>
  );
}
