import { useState, useEffect, useCallback } from 'react';

// ============== 类型 ==============
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

// ============== 5 列布局：左→右信息流 ==============
//
//  信号输入        感知路由        认知处理         记忆学习          行动输出
//  ─────────     ─────────     ─────────       ─────────        ─────────
//  tick      →   thalamus  →   cortex      →   memory       →   planner
//  dialog    →               →   emotion    →   rumination   →   executor
//                              cognitive   →   learning     →   suggestion
//                              desire      →   self_model   →   immune

const COLUMNS = [
  { label: '信号输入', x: 60 },
  { label: '感知路由', x: 250 },
  { label: '认知处理', x: 440 },
  { label: '记忆学习', x: 630 },
  { label: '行动输出', x: 820 },
];

const NODE_W = 110;
const NODE_H = 52;

const NODE_LAYOUT: Record<string, { x: number; y: number; col: number }> = {
  // Col 0: 信号输入
  tick:        { x: 60,  y: 120, col: 0 },
  dialog:      { x: 60,  y: 320, col: 0 },
  // Col 1: 感知路由
  thalamus:    { x: 250, y: 120, col: 1 },
  emotion:     { x: 250, y: 320, col: 1 },
  // Col 2: 认知处理
  cortex:      { x: 440, y: 80,  col: 2 },
  cognitive:   { x: 440, y: 220, col: 2 },
  desire:      { x: 440, y: 360, col: 2 },
  // Col 3: 记忆学习
  memory:      { x: 630, y: 80,  col: 3 },
  rumination:  { x: 630, y: 200, col: 3 },
  learning:    { x: 630, y: 320, col: 3 },
  self_model:  { x: 630, y: 440, col: 3 },
  // Col 4: 行动输出
  planner:     { x: 820, y: 80,  col: 4 },
  executor:    { x: 820, y: 200, col: 4 },
  suggestion:  { x: 820, y: 340, col: 4 },
  immune:      { x: 820, y: 460, col: 4 },
};

// 4 条核心路径（类似 Feature Map 的 Path A/B/C/D）
const PATHS: Record<string, { color: string; label: string }> = {
  A: { color: '#3b82f6', label: 'A 自主循环' },   // tick → thalamus → cortex → planner → executor
  B: { color: '#a855f7', label: 'B 对话驱动' },   // dialog → thalamus → emotion → desire → suggestion
  C: { color: '#eab308', label: 'C 学习回路' },   // memory → rumination → learning → self_model → cognitive
  D: { color: '#ef4444', label: 'D 防护回路' },   // executor → immune → planner
};

// 每条连接归属的路径
const CONNECTION_PATH: Record<string, string> = {
  'tick→thalamus': 'A',
  'thalamus→cortex': 'A',
  'cortex→memory': 'A',
  'cortex→learning': 'A',
  'planner→executor': 'A',
  'tick→planner': 'A',
  'tick→cognitive': 'A',
  'dialog→thalamus': 'B',
  'dialog→memory': 'B',
  'thalamus→emotion': 'B',
  'emotion→desire': 'B',
  'desire→suggestion': 'B',
  'desire→executor': 'B',
  'suggestion→planner': 'B',
  'memory→rumination': 'C',
  'rumination→learning': 'C',
  'learning→self_model': 'C',
  'self_model→cognitive': 'C',
  'cognitive→emotion': 'C',
  'executor→immune': 'D',
  'immune→planner': 'D',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  idle: '#eab308',
  dormant: '#6b7280',
};

const COL_BG: Record<number, string> = {
  0: 'rgba(249,115,22,0.06)',
  1: 'rgba(99,102,241,0.06)',
  2: 'rgba(168,85,247,0.06)',
  3: 'rgba(234,179,8,0.06)',
  4: 'rgba(34,197,94,0.06)',
};

// ============== 连接线 ==============
function FlowLine({ conn }: { conn: Connection }) {
  const from = NODE_LAYOUT[conn.from];
  const to = NODE_LAYOUT[conn.to];
  if (!from || !to) return null;

  const x1 = from.x + NODE_W;    // 从右边出
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;               // 到左边入
  const y2 = to.y + NODE_H / 2;

  // 同列或反向连接用曲线
  const isBackward = to.col <= from.col;
  const pathKey = `${conn.from}→${conn.to}`;
  const pathId = CONNECTION_PATH[pathKey];
  const pathColor = pathId ? PATHS[pathId].color : '#475569';
  const isActive = conn.status === 'active';
  const isDormant = conn.status === 'deployed_no_data';

  let d: string;
  if (isBackward) {
    // 反向连接：从底部绕一圈回去
    const drop = 30;
    const cx1x = x1 + 20;
    const cx2x = x2 - 20;
    const bottomY = Math.max(y1, y2) + 60;
    d = `M ${x1} ${y1} C ${cx1x} ${y1 + drop}, ${cx1x} ${bottomY}, ${(x1 + x2) / 2} ${bottomY} C ${cx2x} ${bottomY}, ${cx2x} ${y2 + drop}, ${x2} ${y2}`;
  } else {
    // 正向连接：贝塞尔曲线左→右
    const cpx = (x1 + x2) / 2;
    d = `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`;
  }

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={isActive ? pathColor : isDormant ? 'rgba(107,114,128,0.25)' : 'rgba(107,114,128,0.15)'}
        strokeWidth={isActive ? 2 : 1}
        strokeDasharray={isDormant ? '4 4' : 'none'}
        opacity={isActive ? 0.7 : 0.4}
        markerEnd={isActive ? `url(#arrow-${pathId || 'default'})` : undefined}
      />
      {/* 流动小圆点 */}
      {isActive && (
        <circle r="3" fill={pathColor} opacity="0.9">
          <animateMotion
            dur={`${2.5 + Math.random() * 1.5}s`}
            repeatCount="indefinite"
            path={d}
          />
        </circle>
      )}
    </g>
  );
}

// ============== 节点 ==============
function Node({
  subsystem, onClick, isSelected,
}: { subsystem: Subsystem; onClick: () => void; isSelected: boolean }) {
  const pos = NODE_LAYOUT[subsystem.id];
  if (!pos) return null;

  const sc = STATUS_COLORS[subsystem.status];
  const isActive = subsystem.status === 'active';

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* 呼吸光晕 */}
      {isActive && (
        <rect
          x={pos.x - 3} y={pos.y - 3}
          width={NODE_W + 6} height={NODE_H + 6}
          rx={10} fill="none"
          stroke={sc} strokeWidth={1} opacity={0.3}
        >
          <animate attributeName="opacity" values="0.1;0.35;0.1" dur="3s" repeatCount="indefinite" />
        </rect>
      )}
      {/* 背景 */}
      <rect
        x={pos.x} y={pos.y}
        width={NODE_W} height={NODE_H}
        rx={8}
        fill={isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}
        stroke={isSelected ? '#e5e7eb' : 'rgba(255,255,255,0.12)'}
        strokeWidth={isSelected ? 1.5 : 0.5}
      />
      {/* 状态灯 */}
      <circle cx={pos.x + 12} cy={pos.y + 12} r={4} fill={sc}>
        {isActive && (
          <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
        )}
      </circle>
      {/* 名称 */}
      <text
        x={pos.x + NODE_W / 2} y={pos.y + 20}
        textAnchor="middle" fill="#e5e7eb" fontSize={11} fontWeight={600}
      >
        {subsystem.name}
      </text>
      {/* 今日计数 */}
      <text
        x={pos.x + NODE_W / 2} y={pos.y + 38}
        textAnchor="middle" fill="#9ca3af" fontSize={10}
      >
        {subsystem.metrics.today_count !== null && subsystem.metrics.today_count !== undefined
          ? `${subsystem.metrics.today_count.toLocaleString()} 次`
          : subsystem.status}
      </text>
    </g>
  );
}

// ============== 详情面板 ==============
function DetailPanel({ subsystem }: { subsystem: Subsystem | null }) {
  if (!subsystem) return null;

  const lastActive = subsystem.metrics.last_active_at
    ? new Date(subsystem.metrics.last_active_at).toLocaleString('zh-CN')
    : '-';

  return (
    <div style={{
      padding: '14px 20px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          background: STATUS_COLORS[subsystem.status],
        }} />
        <span style={{ color: '#f3f4f6', fontSize: 15, fontWeight: 600 }}>
          {subsystem.name}
        </span>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 10,
          background: `${STATUS_COLORS[subsystem.status]}20`,
          color: STATUS_COLORS[subsystem.status],
        }}>
          {subsystem.status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 28, color: '#d1d5db', fontSize: 12, flexWrap: 'wrap' }}>
        <div><span style={{ color: '#6b7280' }}>today </span>{subsystem.metrics.today_count ?? '-'}</div>
        <div><span style={{ color: '#6b7280' }}>last </span>{lastActive}</div>
        {subsystem.metrics.extra && Object.entries(subsystem.metrics.extra).map(([k, v]) => (
          <div key={k}>
            <span style={{ color: '#6b7280' }}>{k} </span>
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
      setData(await res.json());
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
      minHeight: '100vh', background: '#0d1117', color: '#e5e7eb', padding: '20px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f3f4f6' }}>
            Brain Cognitive Map
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9ca3af' }}>
            {data ? `${activeCount} active / ${idleCount} idle / ${dormantCount} dormant` : 'Loading...'}
            {data?.snapshot_at && (
              <span style={{ marginLeft: 12 }}>
                {new Date(data.snapshot_at).toLocaleTimeString('zh-CN')}
              </span>
            )}
          </p>
        </div>
        {/* 路径图例 */}
        <div style={{
          display: 'flex', gap: 16, padding: '8px 14px',
          background: 'rgba(255,255,255,0.03)', borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {Object.entries(PATHS).map(([id, p]) => (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 20, height: 2, background: p.color, borderRadius: 1 }} />
              <span style={{ color: '#d1d5db', fontSize: 11 }}>{p.label}</span>
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS.active }} />
            <span style={{ color: '#d1d5db', fontSize: 11 }}>active</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS.idle }} />
            <span style={{ color: '#d1d5db', fontSize: 11 }}>idle</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS.dormant }} />
            <span style={{ color: '#d1d5db', fontSize: 11 }}>dormant</span>
          </span>
        </div>
        {error && <span style={{ color: '#ef4444', fontSize: 12 }}>Error: {error}</span>}
      </div>

      {/* SVG 主体 */}
      <div style={{
        background: 'rgba(0,0,0,0.25)', borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden',
      }}>
        <svg viewBox="0 0 1000 540" width="100%" style={{ display: 'block' }}>
          <defs>
            {/* 箭头 marker */}
            {Object.entries(PATHS).map(([id, p]) => (
              <marker key={id} id={`arrow-${id}`} viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={p.color} opacity="0.6" />
              </marker>
            ))}
            <marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" opacity="0.5" />
            </marker>
          </defs>

          {/* 列背景 + 标题 */}
          {COLUMNS.map((col, i) => (
            <g key={i}>
              <rect
                x={col.x - 15} y={30} width={NODE_W + 30} height={490}
                rx={8} fill={COL_BG[i]} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5}
              />
              <text
                x={col.x + NODE_W / 2} y={22}
                textAnchor="middle" fill="#9ca3af" fontSize={11} fontWeight={600}
                letterSpacing="0.05em"
              >
                {col.label}
              </text>
              {/* 列间箭头 */}
              {i < COLUMNS.length - 1 && (
                <text
                  x={(col.x + NODE_W + COLUMNS[i + 1].x) / 2}
                  y={22} textAnchor="middle" fill="#4b5563" fontSize={14}
                >
                  →
                </text>
              )}
            </g>
          ))}

          {/* 连接线（底层） */}
          {data?.connections.map((conn, i) => (
            <FlowLine key={i} conn={conn} />
          ))}

          {/* 节点（上层） */}
          {data?.subsystems.map(subsystem => (
            <Node
              key={subsystem.id}
              subsystem={subsystem}
              onClick={() => setSelected(selected === subsystem.id ? null : subsystem.id)}
              isSelected={selected === subsystem.id}
            />
          ))}
        </svg>
      </div>

      {/* 详情面板 */}
      <div style={{ marginTop: 12 }}>
        <DetailPanel subsystem={selectedSubsystem} />
      </div>
    </div>
  );
}
