import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface ClipDetail {
  id: string;
  url: string;
  platform: string;
  status: string;
  title: string | null;
  author: string | null;
  author_id: string | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  cover_url: string | null;
  video_url: string | null;
  transcript: string | null;
  images: string[];
  raw_response: Record<string, unknown> | null;
  error_msg: string | null;
  retry_count: number;
  requested_by: string | null;
  created_at: string;
  processed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  done:       'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
};

export default function ContentClipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    fetch(`/api/brain/clips/${id}`)
      .then(r => r.json())
      .then(d => setClip(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleRetry = async () => {
    setRetrying(true);
    await fetch(`/api/brain/clips/${id}/retry`, { method: 'POST' });
    const r = await fetch(`/api/brain/clips/${id}`);
    const d = await r.json();
    setClip(d.data);
    setRetrying(false);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">未找到该记录</p>
        <button onClick={() => navigate('/clips')} className="mt-4 text-blue-500">返回列表</button>
      </div>
    );
  }

  const images: string[] = Array.isArray(clip.images) ? clip.images : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back */}
      <button
        onClick={() => navigate('/clips')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> 返回列表
      </button>

      {/* Info Card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {clip.title || '(无标题)'}
            </h1>
            <a
              href={clip.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:underline flex items-center gap-1"
            >
              {clip.url} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[clip.status] || ''}`}>
            {clip.status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="平台" value={clip.platform} />
          <Stat label="作者" value={clip.author || '-'} />
          <Stat label="点赞" value={clip.like_count?.toLocaleString() || '-'} />
          <Stat label="评论" value={clip.comment_count?.toLocaleString() || '-'} />
          <Stat label="采集时间" value={formatDate(clip.created_at)} />
          {clip.processed_at && <Stat label="完成时间" value={formatDate(clip.processed_at)} />}
          {clip.requested_by && <Stat label="提交方" value={clip.requested_by} />}
          <Stat label="重试次数" value={String(clip.retry_count)} />
        </div>

        {clip.status === 'failed' && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-700 dark:text-red-400">
            错误：{clip.error_msg || '未知错误'}
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="ml-3 inline-flex items-center gap-1 text-orange-600 hover:text-orange-800 font-medium"
            >
              <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? '重试中...' : '重试'}
            </button>
          </div>
        )}
      </div>

      {/* Transcript */}
      {clip.transcript && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setTranscriptExpanded(e => !e)}
          >
            <h2 className="font-medium text-gray-900 dark:text-white">转写文案</h2>
            <div className="flex items-center gap-1 text-gray-400 text-xs">
              {clip.transcript.length} 字
              {transcriptExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
          <div className={`mt-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap ${
            !transcriptExpanded && clip.transcript.length > 500 ? 'line-clamp-6' : ''
          }`}>
            {clip.transcript}
          </div>
          {clip.transcript.length > 500 && (
            <button
              onClick={() => setTranscriptExpanded(e => !e)}
              className="mt-2 text-xs text-blue-500 hover:underline"
            >
              {transcriptExpanded ? '收起' : '展开全文'}
            </button>
          )}
        </div>
      )}

      {/* Images */}
      {images.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <h2 className="font-medium text-gray-900 dark:text-white mb-3">图片 ({images.length})</h2>
          <div className="grid grid-cols-3 gap-2">
            {images.slice(0, 9).map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                <img src={src} alt={`图片 ${i + 1}`} className="w-full h-32 object-cover rounded-lg" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-800 dark:text-gray-200 font-medium">{value}</p>
    </div>
  );
}
