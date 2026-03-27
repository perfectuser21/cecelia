import { useState, useEffect, useCallback } from 'react';

// ─── 类型 ─────────────────────────────────────────────

interface Pipeline {
  id: string;
  title: string;
  status: string;
  priority: string;
  payload: { keyword?: string; content_type?: string };
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

interface StageInfo {
  status: string;
  started_at?: string;
  completed_at?: string;
}

// ─── 常量 ─────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'content-research', label: '调研', icon: '🔍' },
  { key: 'content-copywriting', label: '文案', icon: '✍️' },
  { key: 'content-copy-review', label: '文案审核', icon: '📋' },
  { key: 'content-generate', label: '图片', icon: '🖼️' },
  { key: 'content-image-review', label: '图片审核', icon: '👁️' },
  { key: 'content-export', label: '导出', icon: '📦' },
];

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-500/20 text-gray-300',
  in_progress: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '等待中',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
};

const CONTENT_TYPES = [
  { value: 'solo-company-case', label: '一人公司案例', desc: '拆解关键词相关的能力下放案例' },
  { value: 'short-form', label: '短内容', desc: '社交媒体短图文' },
  { value: 'long-form', label: '长文', desc: '公众号/知乎深度长文' },
  { value: 'data-analysis', label: '数据分析', desc: '数据驱动的分析内容' },
  { value: 'promo-copy', label: '推广文案', desc: '产品/服务推广' },
  { value: 'video-script', label: '视频脚本', desc: '短视频/长视频脚本' },
];

// ─── 组件 ─────────────────────────────────────────────

export default function ContentPipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, StageInfo>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // 表单
  const [keyword, setKeyword] = useState('');
  const [contentType, setContentType] = useState('solo-company-case');
  const [showForm, setShowForm] = useState(false);

  // 加载 pipeline 列表
  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/pipelines?limit=30');
      if (res.ok) {
        const data = await res.json();
        setPipelines(Array.isArray(data) ? data : []);
      }
    } catch { /* */ }
    setLoading(false);
  }, []);

  // 加载选中 pipeline 的阶段详情
  const fetchStages = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/brain/pipelines/${id}/stages`);
      if (res.ok) {
        const data = await res.json();
        setStages(data.stages || {});
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchPipelines();
    const timer = setInterval(fetchPipelines, 15000);
    return () => clearInterval(timer);
  }, [fetchPipelines]);

  useEffect(() => {
    if (selectedId) {
      fetchStages(selectedId);
      const timer = setInterval(() => fetchStages(selectedId), 10000);
      return () => clearInterval(timer);
    }
  }, [selectedId, fetchStages]);

  // 创建 pipeline
  const handleCreate = async () => {
    if (!keyword.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/brain/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), content_type: contentType }),
      });
      if (res.ok) {
        setKeyword('');
        setShowForm(false);
        await fetchPipelines();
      }
    } catch { /* */ }
    setCreating(false);
  };

  // 手动触发执行
  const handleRun = async (id: string) => {
    try {
      await fetch(`/api/brain/pipelines/${id}/run`, { method: 'POST' });
      setTimeout(() => fetchStages(id), 2000);
    } catch { /* */ }
  };

  const selectedPipeline = pipelines.find(p => p.id === selectedId);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">内容工厂</h1>
          <p className="text-sm text-blue-300/60 mt-1">6 步自动化内容制作流水线</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
        >
          + 发起制作
        </button>
      </div>

      {/* 创建表单 */}
      {showForm && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
          <h3 className="text-lg font-semibold mb-4">新建内容 Pipeline</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-blue-200/70 mb-1.5">关键词 *</label>
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="例：AI 创业、数字游民、Dan Koe"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-sm text-blue-200/70 mb-1.5">内容类型</label>
              <select
                value={contentType}
                onChange={e => setContentType(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
              >
                {CONTENT_TYPES.map(t => (
                  <option key={t.value} value={t.value} className="bg-[#1a1e2e]">
                    {t.label} — {t.desc}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !keyword.trim()}
              className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {creating ? '创建中...' : '开始制作'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 主体：左列表 + 右详情 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：Pipeline 列表 */}
        <div className="lg:col-span-1 space-y-2">
          <h3 className="text-sm font-medium text-blue-200/60 mb-3">
            Pipeline 列表 ({pipelines.length})
          </h3>
          {loading ? (
            <div className="text-center text-white/30 py-8">加载中...</div>
          ) : pipelines.length === 0 ? (
            <div className="text-center text-white/30 py-8">
              暂无 Pipeline，点击"发起制作"创建
            </div>
          ) : (
            pipelines.map(p => (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  selectedId === p.id
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-white/3 border-white/5 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate max-w-[200px]">
                    {p.payload?.keyword || p.title}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status] || STATUS_COLORS.queued}`}>
                    {STATUS_LABELS[p.status] || p.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/30">
                  <span>{p.payload?.content_type || '-'}</span>
                  <span>·</span>
                  <span>{new Date(p.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 右侧：详情面板 */}
        <div className="lg:col-span-2">
          {selectedPipeline ? (
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              {/* 标题栏 */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">
                    {selectedPipeline.payload?.keyword || selectedPipeline.title}
                  </h2>
                  <p className="text-sm text-white/40 mt-1">
                    {selectedPipeline.payload?.content_type} · {selectedPipeline.priority} · {selectedPipeline.id.slice(0, 8)}
                  </p>
                </div>
                {selectedPipeline.status === 'queued' && (
                  <button
                    onClick={() => handleRun(selectedPipeline.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors"
                  >
                    手动执行
                  </button>
                )}
              </div>

              {/* 6 步进度条 */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-blue-200/60 mb-3">Pipeline 进度</h3>
                <div className="flex items-center gap-1">
                  {PIPELINE_STAGES.map((stage, i) => {
                    const info = stages[stage.key];
                    const status = info?.status || 'pending';
                    const isActive = status === 'in_progress';
                    const isDone = status === 'completed';
                    const isFail = status === 'failed';

                    return (
                      <div key={stage.key} className="flex items-center flex-1">
                        <div className={`flex-1 rounded-lg p-3 text-center transition-all ${
                          isDone ? 'bg-green-500/15 border border-green-500/30' :
                          isActive ? 'bg-blue-500/15 border border-blue-500/30 animate-pulse' :
                          isFail ? 'bg-red-500/15 border border-red-500/30' :
                          'bg-white/3 border border-white/5'
                        }`}>
                          <div className="text-lg mb-1">{stage.icon}</div>
                          <div className={`text-xs font-medium ${
                            isDone ? 'text-green-400' :
                            isActive ? 'text-blue-400' :
                            isFail ? 'text-red-400' :
                            'text-white/30'
                          }`}>
                            {stage.label}
                          </div>
                          <div className={`text-[10px] mt-0.5 ${
                            isDone ? 'text-green-400/60' :
                            isActive ? 'text-blue-400/60' :
                            isFail ? 'text-red-400/60' :
                            'text-white/20'
                          }`}>
                            {isDone ? '完成' : isActive ? '进行中' : isFail ? '失败' : '等待'}
                          </div>
                        </div>
                        {i < PIPELINE_STAGES.length - 1 && (
                          <div className={`w-4 h-0.5 ${isDone ? 'bg-green-500/40' : 'bg-white/10'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 时间信息 */}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-white/3 rounded-lg p-3">
                  <div className="text-white/30 text-xs mb-1">创建时间</div>
                  <div>{new Date(selectedPipeline.created_at).toLocaleString('zh-CN')}</div>
                </div>
                <div className="bg-white/3 rounded-lg p-3">
                  <div className="text-white/30 text-xs mb-1">开始时间</div>
                  <div>{selectedPipeline.started_at ? new Date(selectedPipeline.started_at).toLocaleString('zh-CN') : '-'}</div>
                </div>
                <div className="bg-white/3 rounded-lg p-3">
                  <div className="text-white/30 text-xs mb-1">完成时间</div>
                  <div>{selectedPipeline.completed_at ? new Date(selectedPipeline.completed_at).toLocaleString('zh-CN') : '-'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-white/30">
              <div className="text-4xl mb-3">📋</div>
              <p>选择一个 Pipeline 查看详情</p>
              <p className="text-sm mt-1">或点击"发起制作"创建新的内容 Pipeline</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
