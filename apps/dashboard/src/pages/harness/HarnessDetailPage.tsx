/**
 * HarnessDetailPage — Initiative 详情页（实时日志 + 文档 tab）
 *
 * 路由：/harness/:id（initiative_id）
 * SSE：GET /api/brain/harness/stream?initiative_id=:id
 * 文档：GET /api/brain/harness/sprint-docs?sprint_dir=...
 */

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

interface LogEntry {
  node: string;
  status: string;
  attempt: number;
  ts: number;
}

interface SprintDocs {
  sprint_dir: string;
  docs: {
    prep_prd: string | null;
    sprint_prd: string | null;
    contract: string | null;
    harness_report: string | null;
  };
}

type ActiveTab = 'logs' | 'docs';

export default function HarnessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runStatus, setRunStatus] = useState<'running' | 'done' | 'failed'>('running');
  const [activeTab, setActiveTab] = useState<ActiveTab>('logs');
  const [sprintDocs, setSprintDocs] = useState<SprintDocs | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!id || typeof EventSource === 'undefined') return;

    const url = `/api/brain/harness/stream?initiative_id=${encodeURIComponent(id)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('node_update', (e: MessageEvent) => {
      try {
        const data: LogEntry = JSON.parse(e.data);
        setLogs(prev => [...prev, data]);
      } catch {
        // ignore malformed events
      }
    });

    es.addEventListener('run_completed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setRunStatus(data.status === 'failed' ? 'failed' : 'done');
      } catch {
        setRunStatus('done');
      }
      es.close();
    });

    es.onerror = () => {
      // EventSource 会自动重连，无需额外处理
    };

    return () => {
      es.close();
    };
  }, [id]);

  const loadDocs = async () => {
    if (docsLoading || sprintDocs) return;
    setDocsLoading(true);
    try {
      const detailResp = await fetch(`/api/brain/harness/pipeline-detail?planner_task_id=${id}`);
      if (!detailResp.ok) return;
      const detail = await detailResp.json();
      const sprint_dir = detail.sprint_dir;
      if (!sprint_dir) return;
      const docsResp = await fetch(
        `/api/brain/harness/sprint-docs?sprint_dir=${encodeURIComponent(sprint_dir)}`
      );
      if (docsResp.ok) {
        setSprintDocs(await docsResp.json());
      }
    } catch {
      // ignore
    } finally {
      setDocsLoading(false);
    }
  };

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === 'docs') loadDocs();
  };

  const docSections: { key: keyof SprintDocs['docs']; label: string }[] = [
    { key: 'prep_prd', label: 'Prep PRD' },
    { key: 'sprint_prd', label: 'Sprint PRD' },
    { key: 'contract', label: 'Contract' },
    { key: 'harness_report', label: 'Harness Report' },
  ];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Pipeline 详情</h1>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <button
          onClick={() => handleTabChange('logs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'logs'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          实时日志
        </button>
        <button
          onClick={() => handleTabChange('docs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'docs'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          文档
        </button>
      </div>

      {/* 实时日志 tab */}
      {activeTab === 'logs' && (
        <>
          <div data-testid="realtime-log" className="bg-gray-900 text-green-400 font-mono text-sm rounded p-4 min-h-[200px] space-y-1">
            {logs.length === 0 && runStatus === 'running' && (
              <div className="text-gray-500">等待节点事件...</div>
            )}
            {logs.map((entry, i) => (
              <div key={i} data-testid="log-entry" className="flex gap-2">
                <span className="text-gray-400">[{entry.node}]</span>
                <span className={entry.status === 'done' ? 'text-green-400' : entry.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
                  {entry.status}
                </span>
                <span className="text-gray-500">attempt={entry.attempt}</span>
              </div>
            ))}
          </div>

          {runStatus === 'done' && (
            <div className="mt-4 p-3 bg-green-100 text-green-800 rounded font-medium">
              Pipeline 已完成
            </div>
          )}
          {runStatus === 'failed' && (
            <div className="mt-4 p-3 bg-red-100 text-red-800 rounded font-medium">
              Pipeline 失败
            </div>
          )}
        </>
      )}

      {/* 文档 tab */}
      {activeTab === 'docs' && (
        <div data-testid="docs-tab-content" className="space-y-6">
          {docsLoading && (
            <div className="text-gray-500 text-sm">加载文档中...</div>
          )}
          {!docsLoading && !sprintDocs && (
            <div className="text-gray-500 text-sm">暂无文档（sprint_dir 未知）</div>
          )}
          {sprintDocs && docSections.map(({ key, label }) => (
            <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
              </div>
              <div className="p-4">
                {sprintDocs.docs[key] ? (
                  <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono overflow-auto max-h-96">
                    {sprintDocs.docs[key]}
                  </pre>
                ) : (
                  <div className="text-gray-400 text-sm italic">文件不存在</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
