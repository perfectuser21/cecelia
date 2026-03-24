import { useState } from 'react';
import { GitMerge, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface DevRecord {
  id: string;
  task_id?: string;
  pr_title?: string;
  pr_url?: string;
  branch?: string;
  merged_at?: string;
  ci_results?: Record<string, string>;
  code_review_result?: string;
  arch_review_result?: string;
  self_score?: number;
  learning_ref?: string;
  learning_summary?: string;
  root_cause?: string;
  created_at: string;
}

interface Annotation {
  id: string;
  content: string;
  created_at: string;
}

function CiBadge({ level, status }: { level: string; status?: string }) {
  const color = status === 'pass' ? 'bg-green-100 text-green-700' :
    status === 'fail' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500';
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono ${color}`}>
      {level.toUpperCase()}: {status || 'skip'}
    </span>
  );
}

function AnnotationBox({ entityId }: { entityId: string }) {
  const { data, refresh } = useApi<{ success: boolean; data: Annotation[] }>(
    `/api/brain/user-annotations?entity_type=dev_record&entity_id=${entityId}`,
    { staleTime: 10_000 }
  );
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function addAnnotation() {
    if (!text.trim()) return;
    setSaving(true);
    await fetch('/api/brain/user-annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'dev_record', entity_id: entityId, content: text }),
    });
    setText('');
    setSaving(false);
    refresh();
  }

  const annotations = data?.data || [];

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-medium text-gray-500 mb-2">备注</p>
      {annotations.map(a => (
        <div key={a.id} className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-1 text-sm text-gray-700">
          {a.content}
          <span className="text-xs text-gray-400 ml-2">{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <input
          className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
          placeholder="添加备注..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addAnnotation()}
        />
        <button
          onClick={addAnnotation}
          disabled={saving || !text.trim()}
          className="text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 flex items-center gap-1"
        >
          <Plus size={12} /> 添加
        </button>
      </div>
    </div>
  );
}

function RecordCard({ record }: { record: DevRecord }) {
  const [expanded, setExpanded] = useState(false);
  const ci = record.ci_results || {};

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <GitMerge size={14} className="text-purple-500 flex-shrink-0" />
            {record.pr_url ? (
              <a href={record.pr_url} target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium text-blue-600 hover:underline truncate">
                {record.pr_title || record.branch || '未命名 PR'}
              </a>
            ) : (
              <span className="text-sm font-medium text-gray-800 truncate">
                {record.pr_title || record.branch || '未命名 PR'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            {record.branch && <span className="font-mono bg-gray-100 px-1.5 rounded">{record.branch}</span>}
            {record.merged_at && (
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {new Date(record.merged_at).toLocaleDateString('zh-CN')}
              </span>
            )}
            {record.self_score && (
              <span className="text-orange-600 font-medium">评分: {record.self_score}/10</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {['l1', 'l2', 'l3', 'l4'].map(l => ci[l] && <CiBadge key={l} level={l} status={ci[l]} />)}
          </div>
        </div>
        <button onClick={() => setExpanded(v => !v)} className="text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          {record.code_review_result && (
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Code Review</span>
              <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{record.code_review_result}</p>
            </div>
          )}
          {record.learning_summary && (
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Learning</span>
              <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{record.learning_summary}</p>
            </div>
          )}
          {record.root_cause && (
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">根本原因</span>
              <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{record.root_cause}</p>
            </div>
          )}
          <AnnotationBox entityId={record.id} />
        </div>
      )}
    </div>
  );
}

export default function DevLog() {
  const { data, loading } = useApi<{ success: boolean; data: DevRecord[]; total: number }>(
    '/api/brain/dev-records?limit=50',
    { staleTime: 30_000 }
  );

  const records = data?.data || [];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <GitMerge size={24} className="text-purple-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dev Log</h1>
          <p className="text-sm text-gray-500">PR 完整开发档案 · {data?.total ?? 0} 条记录</p>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      )}

      {!loading && records.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <GitMerge size={40} className="mx-auto mb-3 opacity-30" />
          <p>暂无 PR 记录</p>
          <p className="text-xs mt-1">PR 合并后将自动出现在这里</p>
        </div>
      )}

      <div className="space-y-3">
        {records.map(r => <RecordCard key={r.id} record={r} />)}
      </div>
    </div>
  );
}
