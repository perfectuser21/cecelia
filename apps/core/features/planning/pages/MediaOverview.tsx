import { Link } from 'react-router-dom';
import { Share2, ArrowLeft, Construction } from 'lucide-react';

export default function MediaOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/company"
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
            <Share2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Media</h1>
            <p className="text-sm text-gray-400">自媒体数据统计</p>
          </div>
        </div>
      </div>

      {/* Placeholder */}
      <div className="flex flex-col items-center justify-center py-20 bg-white/5 rounded-xl border border-white/10">
        <Construction className="w-12 h-12 text-gray-500 mb-4" />
        <h2 className="text-lg font-medium text-white">Coming Soon</h2>
        <p className="text-gray-400 mt-1">自媒体数据统计功能开发中</p>
      </div>
    </div>
  );
}
