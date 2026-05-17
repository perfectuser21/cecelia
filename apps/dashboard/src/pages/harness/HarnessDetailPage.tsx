/**
 * HarnessDetailPage — ws4 Initiative 实时 Streaming 详情页
 *
 * 路由：/harness/:id（initiative_id）
 * SSE：GET /api/brain/harness/stream?initiative_id=:id
 *
 * 事件：
 *   node_update  → 追加 data-testid="log-entry" 节点行
 *   run_completed → 显示 "Pipeline 已完成" 或 "Pipeline 失败"
 */

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

interface LogEntry {
  node: string;
  status: string;
  attempt: number;
  ts: number;
}

export default function HarnessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runStatus, setRunStatus] = useState<'running' | 'done' | 'failed'>('running');
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

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Pipeline 实时日志</h1>

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
    </div>
  );
}
