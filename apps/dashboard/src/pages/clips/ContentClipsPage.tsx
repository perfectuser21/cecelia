import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, RefreshCw, ExternalLink } from 'lucide-react';

interface Clip {
  id: string;
  url: string;
  platform: 'douyin' | 'xiaohongshu';
  status: 'pending' | 'processing' | 'done' | 'failed';
  title: string | null;
  author: string | null;
  like_count: number | null;
  cover_url: string | null;
  retry_count: number;
  requested_by: string | null;
  created_at: string;
  processed_at: string | null;
  error_msg: string | null;
}

interface ClipsResponse {
  success: boolean;
  data: Clip[];
  total: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
};

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  done:       'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed:     'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function ContentClipsPage() {
  const navigate = useNavigate();
  const [clips, setClips] = useState<Clip[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
      if (platform) params.set('platform', platform);
      if (status) params.set('status', status);
      const resp = await fetch(`/api/brain/clips?${params}`);
      const data: ClipsResponse = await resp.json();
      setClips(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to load clips:', e);
    } finally {
      setLoading(false);
    }
  }, [platform, status, page]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/brain/clips/${id}/retry`, { method: 'POST' });
    fetchClips();
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Scissors className="w-6 h-6 text-blue-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Content Clips</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-1">({total} 条)</span>
        </div>
        <button
          onClick={fetchClips}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={platform}
          onChange={e => { setPlatform(e.target.value); setPage(0); }}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">全部平台</option>
          <option value="douyin">抖音</option>
          <option value="xiaohongshu">小红书</option>
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0); }}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="done">完成</option>
          <option value="failed">失败</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : clips.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Scissors className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-base">还没有采集记录</p>
          <p className="text-sm mt-1">通过 API 提交第一个链接开始采集</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  {['平台', '标题', '状态', '作者', '采集时间', '操作'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {clips.map(clip => (
                  <tr
                    key={clip.id}
                    onClick={() => navigate(`/clips/${clip.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800/30 cursor-pointer"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {PLATFORM_LABELS[clip.platform] || clip.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <span className="text-gray-900 dark:text-white line-clamp-1">
                        {clip.title || <span className="text-gray-400">-</span>}
                      </span>
                      <span className="text-xs text-gray-400 truncate block max-w-[240px]">{clip.url}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[clip.status]}`}>
                        {clip.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{clip.author || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(clip.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <a
                          href={clip.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        {clip.status === 'failed' && (
                          <button
                            onClick={e => handleRetry(clip.id, e)}
                            className="text-xs text-orange-500 hover:text-orange-700 font-medium"
                          >
                            重试
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-500">共 {total} 条</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
                >上一页</button>
                <button
                  disabled={(page + 1) * pageSize >= total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
