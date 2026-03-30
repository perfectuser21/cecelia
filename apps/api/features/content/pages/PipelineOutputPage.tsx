/**
 * PipelineOutputPage — 内容作品主页（四 Tab）
 *
 * 路由：/content-factory/:id
 * 设计风格：深色 #07050f 背景、紫色渐变标题（参考 Justin Welsh 预览页）
 *
 * 四 Tab：
 * 1. Summary - 整体表现汇总
 * 2. 生成记录 - 文案产出 + Pipeline 执行阶段
 * 3. 发布记录 - 8 平台发布状态（mock）
 * 4. 数据记录 - 各平台数据（mock）
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart2,
  FileText,
  Send,
  TrendingUp,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Eye,
  Heart,
  MessageCircle,
  Bookmark,
  Play,
  Image,
} from 'lucide-react';

const BRAIN_API = '/api/brain';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface Pipeline {
  id: string;
  title: string;
  status: string;
  priority: string;
  payload: { keyword?: string; content_type?: string };
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

interface PipelineOutput {
  pipeline_id: string;
  output: {
    keyword?: string;
    status?: string;
    article_text?: string;
    cards_text?: string;
    image_urls?: string[];
    images?: string[] | null;
  };
}

interface StageInfo {
  status: string;
  started_at?: string;
  completed_at?: string;
  review_issues?: string[];
  review_passed?: boolean;
}

interface PipelineStages {
  pipeline_id: string;
  stages: Record<string, StageInfo>;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STAGE_LABELS: Record<string, string> = {
  'content-research': '调研',
  'content-copywriting': '写作',
  'content-copy-review': '文案审核',
  'content-generate': '生成',
  'content-image-review': '图片审核',
  'content-export': '导出',
  'content_publish': '发布',
};

const PLATFORMS = [
  { id: 'douyin', name: '抖音', icon: '🎵' },
  { id: 'xiaohongshu', name: '小红书', icon: '📕' },
  { id: 'weixin', name: '微信公众号', icon: '💬' },
  { id: 'weibo', name: '微博', icon: '🌐' },
  { id: 'zhihu', name: '知乎', icon: '💡' },
  { id: 'toutiao', name: '今日头条', icon: '📰' },
  { id: 'kuaishou', name: '快手', icon: '⚡' },
  { id: 'bilibili', name: 'B站', icon: '📺' },
];

// ── Tab 组件 ─────────────────────────────────────────────────────────────────

type TabKey = 'summary' | 'generation' | 'publish' | 'analytics';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'summary', label: 'Summary', icon: <BarChart2 className="w-4 h-4" /> },
  { key: 'generation', label: '生成记录', icon: <FileText className="w-4 h-4" /> },
  { key: 'publish', label: '发布记录', icon: <Send className="w-4 h-4" /> },
  { key: 'analytics', label: '数据记录', icon: <TrendingUp className="w-4 h-4" /> },
];

// ── Summary Tab ────────────────────────────────────────────────────────────────

function SummaryTab({ pipeline }: { pipeline: Pipeline }) {
  const stats = [
    { label: '总曝光', value: '—', sub: 'mock', icon: <Eye className="w-5 h-5 text-purple-400" /> },
    { label: '总互动', value: '—', sub: 'mock', icon: <Heart className="w-5 h-5 text-pink-400" /> },
    { label: '已发布平台', value: '0', sub: '/ 8 个平台', icon: <Send className="w-5 h-5 text-blue-400" /> },
    { label: '互动率', value: '—', sub: 'mock', icon: <TrendingUp className="w-5 h-5 text-green-400" /> },
  ];

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map(s => (
          <div
            key={s.label}
            className="rounded-xl p-4 border"
            style={{ background: 'rgba(139,92,246,0.06)', borderColor: 'rgba(139,92,246,0.15)' }}
          >
            <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-xs text-gray-400">{s.label}</span></div>
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline 基本信息 */}
      <div
        className="rounded-xl p-5 border space-y-3"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.12)' }}
      >
        <h3 className="text-sm font-semibold text-gray-300">Pipeline 信息</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500">关键词</span>
            <p className="text-gray-200 mt-0.5">{pipeline.payload?.keyword || '—'}</p>
          </div>
          <div>
            <span className="text-gray-500">内容类型</span>
            <p className="text-gray-200 mt-0.5">{pipeline.payload?.content_type || '—'}</p>
          </div>
          <div>
            <span className="text-gray-500">创建时间</span>
            <p className="text-gray-200 mt-0.5">{formatTime(pipeline.created_at)}</p>
          </div>
          <div>
            <span className="text-gray-500">完成时间</span>
            <p className="text-gray-200 mt-0.5">{formatTime(pipeline.completed_at)}</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center">
        数据接入后将自动更新 · 当前为 mock 占位
      </p>
    </div>
  );
}

// ── 生成记录 Tab ───────────────────────────────────────────────────────────────

function GenerationTab({
  output,
  stages,
  loading,
}: {
  output: PipelineOutput | null;
  stages: PipelineStages | null;
  loading: boolean;
}) {
  const [expandArticle, setExpandArticle] = useState(false);
  const [expandCards, setExpandCards] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  const stageEntries = stages ? Object.entries(stages.stages) : [];
  const imageUrls = output?.output?.image_urls ?? [];

  return (
    <div className="space-y-5">
      {/* Pipeline 阶段 */}
      {stageEntries.length > 0 && (
        <div
          className="rounded-xl p-5 border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.12)' }}
        >
          <h3 className="text-sm font-semibold text-gray-300 mb-3">执行阶段</h3>
          <div className="space-y-2">
            {stageEntries.map(([key, info]) => (
              <div key={key} className="flex items-center gap-3">
                {info.status === 'completed' ? (
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                ) : info.status === 'failed' ? (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                ) : info.status === 'canceled' ? (
                  <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                ) : (
                  <Play className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                )}
                <span className="text-sm text-gray-300 flex-1">{STAGE_LABELS[key] || key}</span>
                <span className="text-xs text-gray-500">{formatTime(info.completed_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 图片 */}
      {imageUrls.length > 0 && (
        <div
          className="rounded-xl p-5 border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.12)' }}
        >
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Image className="w-4 h-4 text-purple-400" />
            图片产出（{imageUrls.length} 张）
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`生成图片 ${i + 1}`}
                className="w-full rounded-lg object-cover aspect-video"
                style={{ borderColor: 'rgba(139,92,246,0.2)', border: '1px solid' }}
              />
            ))}
          </div>
        </div>
      )}

      {imageUrls.length === 0 && (
        <div
          className="rounded-xl p-4 border flex items-center gap-3"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(139,92,246,0.08)' }}
        >
          <Image className="w-4 h-4 text-gray-600" />
          <span className="text-sm text-gray-500">暂无图片产出</span>
        </div>
      )}

      {/* 文章文案 */}
      {output?.output?.article_text && (
        <div
          className="rounded-xl border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.12)' }}
        >
          <button
            className="w-full p-5 text-left flex items-center justify-between"
            onClick={() => setExpandArticle(!expandArticle)}
          >
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              文章文案
            </h3>
            <span className="text-xs text-gray-500">{expandArticle ? '收起' : '展开'}</span>
          </button>
          {expandArticle && (
            <div className="px-5 pb-5">
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-y-auto">
                {output.output.article_text}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 卡片文案 */}
      {output?.output?.cards_text && (
        <div
          className="rounded-xl border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.12)' }}
        >
          <button
            className="w-full p-5 text-left flex items-center justify-between"
            onClick={() => setExpandCards(!expandCards)}
          >
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" />
              卡片文案
            </h3>
            <span className="text-xs text-gray-500">{expandCards ? '收起' : '展开'}</span>
          </button>
          {expandCards && (
            <div className="px-5 pb-5">
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-y-auto">
                {output.output.cards_text}
              </pre>
            </div>
          )}
        </div>
      )}

      {!output?.output?.article_text && !output?.output?.cards_text && !loading && (
        <p className="text-sm text-gray-500 text-center py-8">暂无文案产出</p>
      )}
    </div>
  );
}

// ── 发布记录 Tab ───────────────────────────────────────────────────────────────

function PublishTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 mb-4">平台发布状态（接入后自动更新）</p>
      {PLATFORMS.map(platform => (
        <div
          key={platform.id}
          className="flex items-center justify-between p-4 rounded-xl border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.10)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">{platform.icon}</span>
            <span className="text-sm text-gray-300">{platform.name}</span>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(107,114,128,0.15)', color: '#9ca3af' }}
          >
            未发布
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 数据记录 Tab ───────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const metrics = [
    { icon: <Play className="w-3.5 h-3.5" />, label: '播放', key: 'plays' },
    { icon: <Heart className="w-3.5 h-3.5" />, label: '点赞', key: 'likes' },
    { icon: <MessageCircle className="w-3.5 h-3.5" />, label: '评论', key: 'comments' },
    { icon: <Bookmark className="w-3.5 h-3.5" />, label: '收藏', key: 'favorites' },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 mb-4">各平台数据（接入后自动更新）</p>
      {/* 表头 */}
      <div className="flex items-center gap-4 px-4 mb-1">
        <span className="text-xs text-gray-600 w-28">平台</span>
        {metrics.map(m => (
          <div key={m.key} className="flex items-center gap-1 text-xs text-gray-600 flex-1 justify-center">
            {m.icon}
            {m.label}
          </div>
        ))}
      </div>
      {PLATFORMS.map(platform => (
        <div
          key={platform.id}
          className="flex items-center gap-4 p-4 rounded-xl border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(139,92,246,0.10)' }}
        >
          <div className="flex items-center gap-2 w-28">
            <span className="text-base">{platform.icon}</span>
            <span className="text-sm text-gray-300">{platform.name}</span>
          </div>
          {metrics.map(m => (
            <span key={m.key} className="flex-1 text-center text-sm text-gray-500">—</span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function PipelineOutputPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('summary');

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [output, setOutput] = useState<PipelineOutput | null>(null);
  const [stages, setStages] = useState<PipelineStages | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  // 加载 Pipeline 基本信息
  const loadPipeline = useCallback(async () => {
    if (!id) return;
    setPipelineLoading(true);
    setPipelineError(null);
    try {
      const res = await fetch(`${BRAIN_API}/pipelines/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPipeline(data);
    } catch (e: unknown) {
      setPipelineError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setPipelineLoading(false);
    }
  }, [id]);

  // 加载生成记录（output + stages）
  const loadContent = useCallback(async () => {
    if (!id) return;
    setContentLoading(true);
    try {
      const [outRes, stagesRes] = await Promise.all([
        fetch(`${BRAIN_API}/pipelines/${id}/output`),
        fetch(`${BRAIN_API}/pipelines/${id}/stages`),
      ]);
      if (outRes.ok) setOutput(await outRes.json());
      if (stagesRes.ok) setStages(await stagesRes.json());
    } catch {
      // 静默失败，不影响其他 Tab
    } finally {
      setContentLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPipeline();
    loadContent();
  }, [loadPipeline, loadContent]);

  if (pipelineLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07050f' }}>
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (pipelineError || !pipeline) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: '#07050f' }}>
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-gray-400">{pipelineError || 'Pipeline 不存在'}</p>
        <Link to="/content-factory" className="text-sm text-purple-400 hover:text-purple-300">
          ← 返回内容工厂
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#07050f' }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* 返回按钮 */}
        <Link
          to="/content-factory"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          内容工厂
        </Link>

        {/* 标题区域 */}
        <div className="mb-8">
          <h1
            className="text-3xl font-black mb-2 bg-clip-text text-transparent"
            style={{
              backgroundImage: 'linear-gradient(135deg, #c084fc 0%, #a78bfa 40%, #e0c3fc 100%)',
            }}
          >
            {pipeline.payload?.keyword || pipeline.title}
          </h1>
          <p className="text-sm text-gray-500">
            {pipeline.payload?.content_type} · {formatTime(pipeline.created_at)}
          </p>
        </div>

        {/* Tab 导航 */}
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'rgba(139,92,246,0.15)' }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-purple-300 border-purple-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div>
          {activeTab === 'summary' && <SummaryTab pipeline={pipeline} />}
          {activeTab === 'generation' && (
            <GenerationTab output={output} stages={stages} loading={contentLoading} />
          )}
          {activeTab === 'publish' && <PublishTab />}
          {activeTab === 'analytics' && <AnalyticsTab />}
        </div>
      </div>
    </div>
  );
}
