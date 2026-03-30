/**
 * ContentFactory — 内容工厂触发页
 *
 * 功能：
 * 1. 从 Brain API 读取内容类型列表 → 下拉选择
 * 2. 选内容类型后自动带入 notebook_id（从类型配置读取）
 * 3. 输入关键词 → 提交创建 content-pipeline 任务
 * 4. 展示已有 Pipeline 列表及状态，点击展开查看 stage 详情
 */

import { useState, useEffect, useCallback } from 'react';
import { Factory, Play, RefreshCw, Clock, CheckCircle, XCircle, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

const BRAIN_API = '/api/brain';

interface Pipeline {
  id: string;
  title: string;
  status: string;
  priority: string;
  payload: { keyword?: string; content_type?: string };
  created_at: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
}

interface Stage {
  status: string;
  started_at?: string;
  completed_at?: string;
  summary?: string | null;
}

type Priority = 'P0' | 'P1' | 'P2';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    queued: {
      icon: <Clock className="w-3 h-3" />,
      label: '排队中',
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    },
    in_progress: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: '执行中',
      cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    },
    completed: {
      icon: <CheckCircle className="w-3 h-3" />,
      label: '完成',
      cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    },
    failed: {
      icon: <XCircle className="w-3 h-3" />,
      label: '失败',
      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    },
  };

  const s = map[status] ?? {
    icon: <AlertCircle className="w-3 h-3" />,
    label: status,
    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

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

function calcDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '—';
  const end = completedAt ? new Date(completedAt) : new Date();
  const secs = Math.round((end.getTime() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${secs % 60}s`;
}

const STAGE_LABELS: Record<string, string> = {
  'content-research': '调研',
  'content-copywriting': '文案',
  'content-copy-review': '文案审查',
  'content-generate': '生成',
  'content-image-review': '图片审查',
  'content-export': '导出',
};

function StageDetail({ stages }: { stages: Record<string, Stage> }) {
  const entries = Object.entries(stages);
  if (entries.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 py-2 text-center">暂无 Stage 数据</p>;
  }
  return (
    <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-gray-100 dark:border-gray-700">
      {entries.map(([type, stage]) => (
        <div key={type} className="flex items-start gap-2">
          <StatusBadge status={stage.status} />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {STAGE_LABELS[type] ?? type}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
              {calcDuration(stage.started_at, stage.completed_at)}
            </span>
            {stage.summary && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate" title={stage.summary}>
                {stage.summary}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ContentFactory() {
  // 内容类型列表
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);

  // 表单状态
  const [keyword, setKeyword] = useState('');
  const [contentType, setContentType] = useState('');
  const [notebookId, setNotebookId] = useState('');
  const [priority, setPriority] = useState<Priority>('P1');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Pipeline 列表
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // 展开的 pipeline stages
  const [expandedPipeline, setExpandedPipeline] = useState<string | null>(null);
  const [pipelineStages, setPipelineStages] = useState<Record<string, Record<string, Stage>>>({});
  const [stagesLoading, setStagesLoading] = useState<Record<string, boolean>>({});

  const loadContentTypes = useCallback(async () => {
    setTypesLoading(true);
    setTypesError(null);
    try {
      const res = await fetch(`${BRAIN_API}/content-types`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContentTypes(data);
      if (data.length > 0) {
        setContentType(prev => prev || data[0]);
      }
    } catch (e: unknown) {
      setTypesError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setTypesLoading(false);
    }
  }, []);

  const loadPipelines = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(`${BRAIN_API}/pipelines?limit=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPipelines(data);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setListLoading(false);
    }
  }, []);

  // 内容类型变化时，自动从配置带入 notebook_id
  const fetchTypeNotebookId = useCallback(async (type: string) => {
    if (!type) return;
    try {
      const res = await fetch(`${BRAIN_API}/content-types/${encodeURIComponent(type)}/config`);
      if (!res.ok) return;
      const data = await res.json();
      const id = data?.config?.notebook_id ?? '';
      setNotebookId(id);
    } catch {
      // 拉取失败不影响表单
    }
  }, []);

  useEffect(() => {
    loadContentTypes();
    loadPipelines();
  }, [loadContentTypes, loadPipelines]);

  useEffect(() => {
    fetchTypeNotebookId(contentType);
  }, [contentType, fetchTypeNotebookId]);

  const loadStages = useCallback(async (pipelineId: string) => {
    setStagesLoading(prev => ({ ...prev, [pipelineId]: true }));
    try {
      const res = await fetch(`${BRAIN_API}/pipelines/${pipelineId}/stages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPipelineStages(prev => ({ ...prev, [pipelineId]: data.stages ?? {} }));
    } catch {
      // 拉取失败 stages 保持空
    } finally {
      setStagesLoading(prev => ({ ...prev, [pipelineId]: false }));
    }
  }, []);

  const toggleExpand = useCallback((pipelineId: string) => {
    setExpandedPipeline(prev => {
      const next = prev === pipelineId ? null : pipelineId;
      if (next && !pipelineStages[next]) {
        loadStages(next);
      }
      return next;
    });
  }, [pipelineStages, loadStages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || !contentType) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const body: Record<string, string> = {
        keyword: keyword.trim(),
        content_type: contentType,
        priority,
      };
      if (notebookId.trim()) {
        body.notebook_id = notebookId.trim();
      }

      const res = await fetch(`${BRAIN_API}/pipelines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setSubmitSuccess(true);
      setKeyword('');
      await loadPipelines();
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
          <Factory className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">内容工厂</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">选择内容类型 + 输入关键词 → 触发 Brain 自动生产流水线</p>
        </div>
      </div>

      {/* 触发表单 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">启动新 Pipeline</h2>

        {typesError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            内容类型加载失败：{typesError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 内容类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                内容类型 <span className="text-red-500">*</span>
              </label>
              {typesLoading ? (
                <div className="w-full h-9 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={contentType}
                  onChange={e => setContentType(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  {contentTypes.length === 0 && <option value="">— 无可用类型 —</option>}
                  {contentTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>

            {/* 优先级 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">优先级</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                <option value="P0">P0（最高）</option>
                <option value="P1">P1（默认）</option>
                <option value="P2">P2（低）</option>
              </select>
            </div>
          </div>

          {/* NotebookLM ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              NotebookLM ID
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">（从内容类型配置自动带入，可手动修改）</span>
            </label>
            <input
              type="text"
              value={notebookId}
              onChange={e => setNotebookId(e.target.value)}
              placeholder="留空则不使用 NotebookLM 调研"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {/* 关键词 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              关键词 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="例：字节跳动、得物"
              required
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {submitError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Pipeline 已创建，Brain 将自动开始执行
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || typesLoading || !contentType || !keyword.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {submitting ? '提交中...' : '启动 Pipeline'}
          </button>
        </form>
      </div>

      {/* Pipeline 列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Pipeline 列表</h2>
          <button
            onClick={loadPipelines}
            disabled={listLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${listLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {listError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {listError}
          </div>
        )}

        {listLoading && pipelines.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {!listLoading && pipelines.length === 0 && !listError && (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">
            暂无 Pipeline，提交表单创建第一个
          </p>
        )}

        {pipelines.length > 0 && (
          <div className="space-y-2">
            {pipelines.map(p => {
              const isExpanded = expandedPipeline === p.id;
              const stages = pipelineStages[p.id];
              const loading = stagesLoading[p.id];
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-gray-100 dark:border-gray-700"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(p.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors text-left rounded-lg"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.title}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        创建：{formatTime(p.created_at)}
                        {p.completed_at && ` · 完成：${formatTime(p.completed_at)}`}
                        {p.failed_at && ` · 失败：${formatTime(p.failed_at)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 dark:text-gray-500">{p.priority}</span>
                      <StatusBadge status={p.status} />
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3">
                      {loading ? (
                        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          加载 Stage 详情...
                        </div>
                      ) : (
                        <StageDetail stages={stages ?? {}} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
