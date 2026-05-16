import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

interface NodeState {
  node_id: string;
  status: NodeStatus;
  title?: string;
  updated_at?: string;
}

const STATUS_COLOR: Record<NodeStatus, string> = {
  pending: '#6b7280',
  running: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
};

export default function HarnessStreamPage() {
  const { id } = useParams<{ id: string }>();
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!id) return;

    const url = `/api/brain/harness/pipeline/${id}/stream`;
    const eventSource = new EventSource(url);
    esRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
    };

    eventSource.onerror = () => {
      setError('SSE 连接错误');
      setConnected(false);
    };

    eventSource.addEventListener('node_update', (e: MessageEvent) => {
      try {
        const data: NodeState = JSON.parse(e.data);
        setNodes(prev => ({ ...prev, [data.node_id]: data }));
      } catch {
        // ignore malformed events
      }
    });

    eventSource.addEventListener('done', () => {
      setDone(true);
      setConnected(false);
      eventSource.close();
    });

    eventSource.addEventListener('keepalive', () => {
      // keep-alive — no state change needed
    });

    return () => {
      eventSource.close();
    };
  }, [id]);

  const nodeList = Object.values(nodes);

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Harness 流式进度</h2>
        <span style={{ fontSize: '12px', color: done ? '#10b981' : connected ? '#3b82f6' : '#6b7280' }}>
          {done ? '已完成' : connected ? '连接中…' : '未连接'}
        </span>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px' }}>
        Initiative ID: <code>{id}</code>
      </div>

      {nodeList.length === 0 ? (
        <div style={{ color: '#6b7280' }}>等待节点更新…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nodeList.map(node => (
            <div
              key={node.node_id}
              style={{
                border: `2px solid ${STATUS_COLOR[node.status] ?? '#6b7280'}`,
                borderRadius: '8px',
                padding: '12px 16px',
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{node.title ?? node.node_id}</span>
                <span
                  style={{
                    fontSize: '12px',
                    color: STATUS_COLOR[node.status] ?? '#6b7280',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                  }}
                >
                  {node.status}
                </span>
              </div>
              {node.updated_at && (
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  {new Date(node.updated_at).toLocaleTimeString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
