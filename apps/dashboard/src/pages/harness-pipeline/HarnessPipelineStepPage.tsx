import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface PipelineStep {
  step: number;
  task_id: string;
  task_type: string;
  label: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  verdict: string | null;
  pr_url: string | null;
  error_message: string | null;
  input_content: string | null;
  system_prompt_content: string | null;
  output_content: string | null;
}

interface PipelineDetail {
  planner_task_id: string;
  title: string;
  steps: PipelineStep[];
}

function ContentBlock({ title, content }: { title: string; content: string | null }) {
  return (
    <div className="flex flex-col border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          {title}
        </span>
      </div>
      <div className="flex-1 p-4 bg-white dark:bg-slate-900/50 overflow-auto max-h-[60vh]">
        {content ? (
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        ) : (
          <div className="text-xs text-slate-400 dark:text-slate-500 italic py-8 text-center font-mono">
            暂无数据
          </div>
        )}
      </div>
    </div>
  );
}

export default function HarnessPipelineStepPage() {
  const { id, step } = useParams<{ id: string; step: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/brain/harness/pipeline-detail?planner_task_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json: PipelineDetail = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const stepNum = step ? parseInt(step, 10) : null;
  const stepData = data?.steps.find(s => s.step === stepNum) ?? null;

  if (loading && !data) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 dark:text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          <button onClick={fetchDetail} className="mt-2 text-xs text-red-500 hover:underline">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* 返回按钮 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/pipeline/${id}`)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          &larr; 返回 Pipeline 详情
        </button>
      </div>

      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">
          步骤 #{step} — {stepData?.label ?? '未知步骤'}
        </h1>
        {data?.title && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{data.title}</p>
        )}
      </div>

      {/* 三栏区块 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ContentBlock title="User Input" content={stepData?.input_content ?? null} />
        <ContentBlock title="System Prompt" content={stepData?.system_prompt_content ?? null} />
        <ContentBlock title="Output" content={stepData?.output_content ?? null} />
      </div>
    </div>
  );
}
