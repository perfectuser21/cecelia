import { useState, useEffect, useCallback } from 'react';

// ============== 类型定义 ==============
interface SubsystemMetrics {
  today_count: number | null;
  last_active_at: string | null;
  extra?: Record<string, unknown>;
}

interface Subsystem {
  id: string;
  name: string;
  group: string;
  status: 'active' | 'idle' | 'dormant';
  metrics: SubsystemMetrics;
}

interface Connection {
  from: string;
  to: string;
  label: string;
  status: 'active' | 'deployed_no_data' | 'not_implemented';
}

interface CognitiveMapData {
  subsystems: Subsystem[];
  connections: Connection[];
  snapshot_at: string;
}

// ============== 布局常量 ==============
const NODE_LAYOUT: Record<string, { x: number; y: number }> = {
  tick:        { x: 400, y: 60 },
  planner:     { x: 220, y: 160 },
  executor:    { x: 580, y: 160 },
  thalamus:    { x: 400, y: 260 },
  cortex:      { x: 580, y: 340 },
  cognitive:   { x: 220, y: 340 },
  emotion:     { x: 100, y: 460 },
  desire:      { x: 300, y: 460 },
  self_model:  { x: 500, y: 460 },
  memory:      { x: 700, y: 460 },
  learning:    { x: 600, y: 560 },
  rumination:  { x: 800, y: 560 },
  suggestion:  { x: 100, y: 580 },
  immune:      { x: 700, y: 260 },
  dialog:      { x: 100, y: 260 },
};

const GROUP_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  core:         { fill: '#1a1520', stroke: '#f97316', glow: '#f97316' },
  cognition:    { fill: '#0f1729', stroke: '#6366f1', glow: '#6366f1' },
  consciousness:{ fill: '#0f1f15', stroke: '#22c55e', glow: '#22c55e' },
  memory:       { fill: '#1a1500', stroke: '#eab308', glow: '#eab308' },
  interface:    { fill: '#1a0f29', stroke: '#a78bfa', glow: '#a78bfa' },
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  idle: '#eab308',
  dormant: '#6b7280',
};

const GROUP_NAMES: Record<string, string> = {
  core: '核心驱动',
  cognition: '认知处理',
  consciousness: '意识层',
  memory: '记忆学习',
  interface: '接口层',
};

const NODE_W = 120;
const NODE_H = 56;

// ============== SVG 子组件 ==============

function ConnectionLine({
  conn, nodes,
}: { conn: Connection; nodes: Record<string, { x: number; y: number }> }) {
  const from = nodes[conn.from];
  const to = nodes[conn.to];
  if (!from || !to) return null;

  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y + NODE_H / 2;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * 0.15;
  const cy = my + dx * 0.15;

  const isActive = conn.status === 'active';
  const isDormant = conn.status === 'deployed_no_data';
  const color = isActive ? 'rgba(99,102,241,0.6)' : isDormant ? 'rgba(107,114,128,0.3)' : 'rgba(107,114,128,0.2)';
  const id = `flow-${conn.from}-${conn.to}`;

  return (
    <g>
      <path
        d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={isActive ? 1.5 : 1}
        strokeDasharray={isDormant ? '4 4' : 'none'}
      />
      {isActive && (
        <>
          <circle r="3" fill="#818cf8" opacity="0.8">
            <animateMotion
              dur={`${2 + Math.random() * 2}s`}
              repeatCount="indefinite"
              path={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
            />
          </circle>
          <circle r="2" fill="#818cf8" opacity="0.5" id={id}>
            <animateMotion
              dur={`${3 + Math.random() * 2}s`}
              repeatCount="indefinite"
              path={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
            />
          </circle>
        </>
      )}
    </g>
  );
}

function CognitiveNode({
  subsystem, onClick, isSelected,
}: { subsystem: Subsystem; onClick: () => void; isSelected: boolean }) {
  const pos = NODE_LAYOUT[subsystem.id];
  if (!pos) return null;

  const gc = GROUP_COLORS[subsystem.group] || GROUP_COLORS.interface;
  const sc = STATUS_COLORS[subsystem.status];
  const isActive = subsystem.status === 'active';

  return (
    <g
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {isActive && (
        <rect
          x={pos.x - 4} y={pos.y - 4}
          width={NODE_W + 8} height={NODE_H + 8}
          rx={10} fill="none"
          stroke={gc.glow} strokeWidth={1} opacity={0.3}
        >
          <animate attributeName="opacity" values="0.1;0.4;0.1" dur="3s" repeatCount="indefinite" />
        </rect>
      )}
      <rect
        x={pos.x} y={pos.y}
        width={NODE_W} height={NODE_H}
        rx={8}
        fill={gc.fill}
        stroke={isSelected ? '#fff' : gc.stroke}
        strokeWidth={isSelected ? 2 : 1}
      />
      {/* 状态灯 */}
      <circle cx={pos.x + 14} cy={pos.y + 14} r={4} fill={sc}>
        {isActive && (
          <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
        )}
      </circle>
      {/* 名称 */}
      <text
        x={pos.x + NODE_W / 2} y={pos.y + 22}
        textAnchor="middle" fill="#e5e7eb" fontSize={12} fontWeight={500}
      >
        {subsystem.name}
      </text>
      {/* 今日计数 */}
      {subsystem.metrics.today_count !== null && (
        <text
          x={pos.x + NODE_W / 2} y={pos.y + 42}
          textAnchor="middle" fill="#9ca3af" fontSize={10}
        >
          {subsystem.metrics.today_count.toLocaleString()}
        </text>
      )}
    </g>
  );
}

function Legend() {
  const groups = Object.entries(GROUP_NAMES);
  const statuses = [
    { label: 'Active', color: STATUS_COLORS.active },
    { label: 'Idle', color: STATUS_COLORS.idle },
    { label: 'Dormant', color: STATUS_COLORS.dormant },
  ];

  return (
    <div style={{
      display: 'flex', gap: 24, flexWrap: 'wrap',
      padding: '12px 16px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>分组:</span>
        {groups.map(([key, name]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: 2,
              border: `2px solid ${GROUP_COLORS[key].stroke}`,
              background: GROUP_COLORS[key].fill,
            }} />
            <span style={{ color: '#d1d5db', fontSize: 11 }}>{name}</span>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>状态:</span>
        {statuses.map(s => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: s.color,
            }} />
            <span style={{ color: '#d1d5db', fontSize: 11 }}>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({ subsystem }: { subsystem: Subsystem | null }) {
  if (!subsystem) return null;

  const gc = GROUP_COLORS[subsystem.group] || GROUP_COLORS.interface;
  const lastActive = subsystem.metrics.last_active_at
    ? new Date(subsystem.metrics.last_active_at).toLocaleString('zh-CN')
    : '-';

  return (
    <div style={{
      padding: '16px 20px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      border: `1px solid ${gc.stroke}40`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          background: STATUS_COLORS[subsystem.status],
        }} />
        <span style={{ color: '#f3f4f6', fontSize: 16, fontWeight: 600 }}>
          {subsystem.name}
        </span>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11,
          background: `${gc.stroke}20`, color: gc.stroke,
        }}>
          {GROUP_NAMES[subsystem.group] || subsystem.group}
        </span>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11,
          background: `${STATUS_COLORS[subsystem.status]}20`,
          color: STATUS_COLORS[subsystem.status],
        }}>
          {subsystem.status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 32, color: '#d1d5db', fontSize: 13 }}>
        <div>
          <span style={{ color: '#9ca3af' }}>today: </span>
          {subsystem.metrics.today_count ?? '-'}
        </div>
        <div>
          <span style={{ color: '#9ca3af' }}>last active: </span>
          {lastActive}
        </div>
        {subsystem.metrics.extra && Object.entries(subsystem.metrics.extra).map(([k, v]) => (
          <div key={k}>
            <span style={{ color: '#9ca3af' }}>{k}: </span>
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== 主组件 ==============

export default function SuperBrain() {
  const [data, setData] = useState<CognitiveMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/cognitive-map');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const selectedSubsystem = data?.subsystems.find(s => s.id === selected) || null;

  const activeCount = data?.subsystems.filter(s => s.status === 'active').length || 0;
  const idleCount = data?.subsystems.filter(s => s.status === 'idle').length || 0;
  const dormantCount = data?.subsystems.filter(s => s.status === 'dormant').length || 0;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d1117',
      color: '#e5e7eb',
      padding: '24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f3f4f6' }}>
            Cognitive Map
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>
            {data ? `${activeCount} active / ${idleCount} idle / ${dormantCount} dormant` : 'Loading...'}
            {data?.snapshot_at && (
              <span style={{ marginLeft: 12 }}>
                {new Date(data.snapshot_at).toLocaleTimeString('zh-CN')}
              </span>
            )}
          </p>
        </div>
        {error && (
          <span style={{ color: '#ef4444', fontSize: 12 }}>Error: {error}</span>
        )}
      </div>

      {/* 图例 */}
      <Legend />

      {/* SVG 认知地图 */}
      <div style={{
        marginTop: 16,
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        <svg
          viewBox="0 0 920 640"
          width="100%"
          style={{ display: 'block', maxHeight: '65vh' }}
        >
          {/* 连接线（底层） */}
          {data?.connections.map((conn, i) => (
            <ConnectionLine key={i} conn={conn} nodes={NODE_LAYOUT} />
          ))}

          {/* 节点（上层） */}
          {data?.subsystems.map(subsystem => (
            <CognitiveNode
              key={subsystem.id}
              subsystem={subsystem}
              onClick={() => setSelected(selected === subsystem.id ? null : subsystem.id)}
              isSelected={selected === subsystem.id}
            />
          ))}
        </svg>
      </div>

      {/* 详情面板 */}
      <div style={{ marginTop: 16 }}>
        <DetailPanel subsystem={selectedSubsystem} />
      </div>
    </div>
  );
}
