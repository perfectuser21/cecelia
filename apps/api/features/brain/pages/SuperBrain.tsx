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

interface ManifestModule {
  id: string;
  label: string;
  desc: string;
  file: string;
}

interface ManifestBlock {
  id: string;
  label: string;
  color: string;
  desc: string;
  nodeIds: string[];
  modules: ManifestModule[];
}

interface BlockConnection {
  from: string;
  to: string;
  label: string;
  type: 'primary' | 'fast_path' | 'feedback';
  desc: string;
}

interface ManifestData {
  version: string;
  blocks: ManifestBlock[];
  blockConnections: BlockConnection[];
}

// ============== Level 2: 5 列布局（左→右信息流）==============
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
  tick:        { x: 60,  y: 120, col: 0 },
  dialog:      { x: 60,  y: 320, col: 0 },
  thalamus:    { x: 250, y: 120, col: 1 },
  emotion:     { x: 250, y: 320, col: 1 },
  cortex:      { x: 440, y: 80,  col: 2 },
  cognitive:   { x: 440, y: 220, col: 2 },
  desire:      { x: 440, y: 360, col: 2 },
  memory:      { x: 630, y: 80,  col: 3 },
  rumination:  { x: 630, y: 200, col: 3 },
  learning:    { x: 630, y: 320, col: 3 },
  self_model:  { x: 630, y: 440, col: 3 },
  planner:     { x: 820, y: 80,  col: 4 },
  executor:    { x: 820, y: 200, col: 4 },
  suggestion:  { x: 820, y: 340, col: 4 },
  immune:      { x: 820, y: 460, col: 4 },
};

const PATHS: Record<string, { color: string; label: string }> = {
  A: { color: '#3b82f6', label: 'A 自主循环' },
  B: { color: '#a855f7', label: 'B 对话驱动' },
  C: { color: '#eab308', label: 'C 学习回路' },
  D: { color: '#ef4444', label: 'D 防护回路' },
};

const CONNECTION_PATH: Record<string, string> = {
  'tick→thalamus': 'A', 'thalamus→cortex': 'A', 'cortex→memory': 'A',
  'cortex→learning': 'A', 'planner→executor': 'A', 'tick→planner': 'A', 'tick→cognitive': 'A',
  'dialog→thalamus': 'B', 'dialog→memory': 'B', 'thalamus→emotion': 'B',
  'emotion→desire': 'B', 'desire→suggestion': 'B', 'desire→executor': 'B', 'suggestion→planner': 'B',
  'memory→rumination': 'C', 'rumination→learning': 'C', 'learning→self_model': 'C',
  'self_model→cognitive': 'C', 'cognitive→emotion': 'C',
  'executor→immune': 'D', 'immune→planner': 'D',
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

// ============== Level 2: 连接线 ==============
function FlowLine({ conn }: { conn: Connection }) {
  const from = NODE_LAYOUT[conn.from];
  const to = NODE_LAYOUT[conn.to];
  if (!from || !to) return null;

  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;

  const isBackward = to.col <= from.col;
  const pathKey = `${conn.from}→${conn.to}`;
  const pathId = CONNECTION_PATH[pathKey];
  const pathColor = pathId ? PATHS[pathId].color : '#475569';
  const isActive = conn.status === 'active';
  const isDormant = conn.status === 'deployed_no_data';

  let d: string;
  if (isBackward) {
    const drop = 30;
    const cx1x = x1 + 20;
    const cx2x = x2 - 20;
    const bottomY = Math.max(y1, y2) + 60;
    d = `M ${x1} ${y1} C ${cx1x} ${y1 + drop}, ${cx1x} ${bottomY}, ${(x1 + x2) / 2} ${bottomY} C ${cx2x} ${bottomY}, ${cx2x} ${y2 + drop}, ${x2} ${y2}`;
  } else {
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

// ============== Level 2: 节点 ==============
function Node({
  subsystem, onClick, isSelected, blockColor,
}: { subsystem: Subsystem; onClick: () => void; isSelected: boolean; blockColor?: string }) {
  const pos = NODE_LAYOUT[subsystem.id];
  if (!pos) return null;

  const sc = STATUS_COLORS[subsystem.status];
  const isActive = subsystem.status === 'active';
  const borderColor = isSelected ? '#e5e7eb' : (blockColor ? `${blockColor}60` : 'rgba(255,255,255,0.12)');

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
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
      {blockColor && (
        <rect
          x={pos.x} y={pos.y}
          width={4} height={NODE_H}
          rx={2} fill={blockColor} opacity={0.6}
        />
      )}
      <rect
        x={pos.x} y={pos.y}
        width={NODE_W} height={NODE_H}
        rx={8}
        fill={isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}
        stroke={borderColor}
        strokeWidth={isSelected ? 1.5 : 0.5}
      />
      <circle cx={pos.x + 12} cy={pos.y + 12} r={4} fill={sc}>
        {isActive && (
          <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
        )}
      </circle>
      <text
        x={pos.x + NODE_W / 2} y={pos.y + 20}
        textAnchor="middle" fill="#e5e7eb" fontSize={11} fontWeight={600}
      >
        {subsystem.name}
      </text>
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

// ============== Level 1: 块聚合状态计算 ==============
function computeBlockStatus(block: ManifestBlock, subsystems: Subsystem[]) {
  const nodes = subsystems.filter(s => block.nodeIds.includes(s.id));
  const active = nodes.filter(n => n.status === 'active').length;
  const idle = nodes.filter(n => n.status === 'idle').length;
  const dormant = nodes.filter(n => n.status === 'dormant').length;

  let status: 'active' | 'idle' | 'dormant' = 'dormant';
  if (active > 0) status = 'active';
  else if (idle > 0) status = 'idle';

  return { active, idle, dormant, status, total: block.modules.length };
}

// ============== Level 1: 块卡片 ==============
interface BlockCardProps {
  block: ManifestBlock;
  subsystems: Subsystem[];
  x: number;
  y: number;
  width: number;
  height: number;
  onClick: () => void;
  isSelected: boolean;
}

function BlockCard({ block, subsystems, x, y, width, height, onClick, isSelected }: BlockCardProps) {
  const { active, idle, dormant, status, total } = computeBlockStatus(block, subsystems);
  const sc = STATUS_COLORS[status];
  const isActive = status === 'active';

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* 选中光晕 */}
      {isSelected && (
        <rect x={x - 3} y={y - 3} width={width + 6} height={height + 6}
          rx={13} fill="none" stroke={block.color} strokeWidth={1.5} opacity={0.5} />
      )}
      {/* 背景 */}
      <rect x={x} y={y} width={width} height={height} rx={10}
        fill={`${block.color}08`}
        stroke={isSelected ? block.color : `${block.color}30`}
        strokeWidth={isSelected ? 1.5 : 1}
      />
      {/* 顶部色条 */}
      <rect x={x} y={y} width={width} height={4} rx={0}
        fill={block.color} opacity={0.6}
        style={{ borderTopLeftRadius: 10, borderTopRightRadius: 10 }}
      />
      {/* 状态灯 */}
      <circle cx={x + 18} cy={y + 22} r={5} fill={sc}>
        {isActive && (
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        )}
      </circle>
      {/* 块名称 */}
      <text x={x + width / 2} y={y + 26}
        textAnchor="middle" fill="#f3f4f6" fontSize={13} fontWeight={700}
      >
        {block.label}
      </text>
      {/* 描述 */}
      <foreignObject x={x + 8} y={y + 34} width={width - 16} height={40}>
        <div style={{
          color: '#9ca3af', fontSize: 10, lineHeight: '14px', overflow: 'hidden',
        }}>
          {block.desc}
        </div>
      </foreignObject>
      {/* 模块统计 */}
      <text x={x + 10} y={y + height - 28}
        fill="#6b7280" fontSize={9}
      >
        {total} 模块
      </text>
      {/* 状态数字 */}
      <text x={x + 10} y={y + height - 14}
        fill="#6b7280" fontSize={9}
      >
        <tspan fill={STATUS_COLORS.active}>{active}▸</tspan>
        <tspan> </tspan>
        <tspan fill={STATUS_COLORS.idle}>{idle}◌</tspan>
        <tspan> </tspan>
        <tspan fill={STATUS_COLORS.dormant}>{dormant}○</tspan>
      </text>
      {/* 点击提示 */}
      <text x={x + width - 10} y={y + height - 14}
        textAnchor="end" fill={block.color} fontSize={9} opacity={0.7}
      >
        详情 →
      </text>
    </g>
  );
}

// ============== Level 1: 块间连接线 ==============
interface BlockArrowProps {
  x1: number; y1: number;
  x2: number; y2: number;
  label: string;
  type: 'primary' | 'fast_path' | 'feedback';
  active: boolean;
}

function BlockArrow({ x1, y1, x2, y2, label, type, active }: BlockArrowProps) {
  const color = type === 'feedback' ? '#ec4899' : type === 'fast_path' ? '#eab308' : '#94a3b8';
  const strokeWidth = type === 'feedback' ? 2 : active ? 2 : 1.5;
  const dashed = type === 'fast_path' ? '6 3' : 'none';
  const opacity = active ? 0.8 : 0.4;

  const mid = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;

  return (
    <g>
      <defs>
        <marker id={`arr-${type}`} viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity="0.7" />
        </marker>
      </defs>
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={dashed} opacity={opacity}
        markerEnd={`url(#arr-${type})`}
      />
      {active && type !== 'fast_path' && (
        <circle r="3" fill={color} opacity="0.8">
          <animateMotion dur="2s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      <text
        x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}
        textAnchor="middle" fill={color} fontSize={9} opacity={0.7}
      >
        {label}
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

// ============== 块详情面板 ==============
function BlockDetailPanel({ block, subsystems }: { block: ManifestBlock; subsystems: Subsystem[] }) {
  return (
    <div style={{
      padding: '14px 20px',
      background: `${block.color}08`,
      borderRadius: 8,
      border: `1px solid ${block.color}30`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          display: 'inline-block', width: 12, height: 12, borderRadius: 3,
          background: block.color, opacity: 0.8,
        }} />
        <span style={{ color: '#f3f4f6', fontSize: 15, fontWeight: 700 }}>{block.label}</span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{block.desc}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {block.modules.map(mod => {
          const node = subsystems.find(s => s.id === mod.id);
          const status = node?.status || 'dormant';
          return (
            <div key={mod.id} style={{
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 6,
              border: `1px solid ${STATUS_COLORS[status]}30`,
              minWidth: 140,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: STATUS_COLORS[status], display: 'inline-block',
                }} />
                <span style={{ color: '#e5e7eb', fontSize: 12, fontWeight: 600 }}>{mod.label}</span>
              </div>
              <div style={{ color: '#6b7280', fontSize: 10, lineHeight: '14px' }}>{mod.desc}</div>
              <div style={{ color: '#4b5563', fontSize: 9, marginTop: 4 }}>{mod.file}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============== 主组件 ==============
export default function SuperBrain() {
  const [data, setData] = useState<CognitiveMapData | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewLevel, setViewLevel] = useState<'overview' | 'detail'>('overview');
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [mapRes, manifestRes] = await Promise.all([
        fetch('/api/brain/cognitive-map'),
        fetch('/api/brain/manifest'),
      ]);
      if (!mapRes.ok) throw new Error(`cognitive-map HTTP ${mapRes.status}`);
      if (!manifestRes.ok) throw new Error(`manifest HTTP ${manifestRes.status}`);
      setData(await mapRes.json());
      setManifest(await manifestRes.json());
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

  // 为每个节点查找所属块的颜色
  const getNodeBlockColor = useCallback((nodeId: string) => {
    if (!manifest) return undefined;
    const block = manifest.blocks.find(b => b.nodeIds.includes(nodeId));
    return block?.color;
  }, [manifest]);

  const selectedSubsystem = data?.subsystems.find(s => s.id === selected) || null;
  const selectedBlockData = manifest?.blocks.find(b => b.id === selectedBlock) || null;
  const activeCount = data?.subsystems.filter(s => s.status === 'active').length || 0;
  const idleCount = data?.subsystems.filter(s => s.status === 'idle').length || 0;
  const dormantCount = data?.subsystems.filter(s => s.status === 'dormant').length || 0;

  // ── Level 1 (overview) 布局 ──
  // 4 主块 top row + 自我演化 bottom
  const BW = 180;  // block width
  const BH = 160;  // block height
  const GAP = 18;
  const topY = 40;
  const botY = 250;
  const svgW = 960;

  const mainBlocks = manifest?.blocks.filter(b => b.id !== 'evolution') || [];
  const evolutionBlock = manifest?.blocks.find(b => b.id === 'evolution');

  const totalTopW = mainBlocks.length * BW + (mainBlocks.length - 1) * GAP;
  const startX = (svgW - totalTopW) / 2;

  const blockPositions: Record<string, { x: number; y: number }> = {};
  mainBlocks.forEach((b, i) => {
    blockPositions[b.id] = { x: startX + i * (BW + GAP), y: topY };
  });
  if (evolutionBlock) {
    const evW = totalTopW;
    blockPositions['evolution'] = { x: startX, y: botY };
    // store width
    (blockPositions['evolution'] as any).w = evW;
  }

  const evolutionW = evolutionBlock ? totalTopW : BW;

  // ── 连接线坐标计算 ──
  function getBlockCenter(id: string, side: 'right' | 'left' | 'top' | 'bottom') {
    const pos = blockPositions[id];
    if (!pos) return { x: 0, y: 0 };
    const w = id === 'evolution' ? evolutionW : BW;
    const h = BH;
    if (side === 'right') return { x: pos.x + w, y: pos.y + h / 2 };
    if (side === 'left') return { x: pos.x, y: pos.y + h / 2 };
    if (side === 'top') return { x: pos.x + w / 2, y: pos.y };
    return { x: pos.x + w / 2, y: pos.y + h }; // bottom
  }

  // 计算块的聚合 active 状态（用于箭头激活状态）
  function isBlockActive(id: string) {
    if (!manifest || !data) return false;
    const block = manifest.blocks.find(b => b.id === id);
    if (!block) return false;
    return block.nodeIds.some(nid => data.subsystems.find(s => s.id === nid)?.status === 'active');
  }

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
            {manifest && <span style={{ marginLeft: 8, fontSize: 12, color: '#4b5563', fontWeight: 400 }}>
              v{manifest.version}
            </span>}
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

        {/* 视图切换 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {viewLevel === 'detail' && (
            <button
              onClick={() => { setViewLevel('overview'); setSelected(null); setSelectedBlock(null); }}
              style={{
                padding: '6px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6, color: '#d1d5db', fontSize: 12, cursor: 'pointer',
              }}
            >
              ← 概览
            </button>
          )}
          <div style={{
            display: 'flex', padding: '3px',
            background: 'rgba(255,255,255,0.06)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            {(['overview', 'detail'] as const).map(level => (
              <button key={level}
                onClick={() => { setViewLevel(level); setSelected(null); }}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: viewLevel === level ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: viewLevel === level ? '#f3f4f6' : '#6b7280',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                {level === 'overview' ? '概览' : '详情'}
              </button>
            ))}
          </div>
          {error && <span style={{ color: '#ef4444', fontSize: 12 }}>Error: {error}</span>}
        </div>
      </div>

      {/* ─── Level 1: Overview ─── */}
      {viewLevel === 'overview' && manifest && (
        <>
          <div style={{
            background: 'rgba(0,0,0,0.25)', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <svg viewBox={`0 0 ${svgW} 400`} width="100%" style={{ display: 'block' }}>
              <defs>
                <marker id="arr-primary" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" opacity="0.7" />
                </marker>
                <marker id="arr-feedback" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ec4899" opacity="0.7" />
                </marker>
                <marker id="arr-fast_path" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308" opacity="0.7" />
                </marker>
              </defs>

              {/* 主流箭头（相邻块之间） */}
              {mainBlocks.slice(0, -1).map((block, i) => {
                const from = getBlockCenter(block.id, 'right');
                const to = getBlockCenter(mainBlocks[i + 1].id, 'left');
                const active = isBlockActive(block.id) && isBlockActive(mainBlocks[i + 1].id);
                const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
                const color = active ? '#94a3b8' : 'rgba(100,116,139,0.4)';
                return (
                  <g key={block.id}>
                    <path d={d} fill="none" stroke={color} strokeWidth={active ? 2 : 1.5}
                      opacity={active ? 0.8 : 0.4}
                      markerEnd="url(#arr-primary)"
                    />
                    {active && (
                      <circle r="3" fill={color} opacity="0.8">
                        <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                  </g>
                );
              })}

              {/* interface → core 快速路径（弧线，对话快速到丘脑） */}
              {blockPositions['interface'] && blockPositions['core'] && (() => {
                const from = getBlockCenter('interface', 'right');
                const to = getBlockCenter('core', 'left');
                const d = `M ${from.x} ${from.y - 25} C ${(from.x + to.x) / 2} ${from.y - 50}, ${(from.x + to.x) / 2} ${to.y - 50}, ${to.x} ${to.y - 25}`;
                return (
                  <g>
                    <path d={d} fill="none" stroke="#eab308" strokeWidth={1}
                      strokeDasharray="5 3" opacity={0.4}
                      markerEnd="url(#arr-fast_path)"
                    />
                    <text
                      x={(from.x + to.x) / 2} y={topY - 12}
                      textAnchor="middle" fill="#eab308" fontSize={9} opacity={0.6}
                    >
                      对话→丘脑 (快速路径)
                    </text>
                  </g>
                );
              })()}

              {/* action → evolution 反馈弧 */}
              {blockPositions['action'] && blockPositions['evolution'] && (() => {
                const from = getBlockCenter('action', 'bottom');
                const evPos = blockPositions['evolution'];
                const to = { x: evPos.x + evolutionW * 0.75, y: evPos.y };
                const d = `M ${from.x} ${from.y} C ${from.x} ${from.y + 40}, ${to.x} ${to.y - 40}, ${to.x} ${to.y}`;
                const active = isBlockActive('action');
                return (
                  <g>
                    <path d={d} fill="none" stroke="#ec4899" strokeWidth={active ? 2 : 1.5}
                      opacity={active ? 0.8 : 0.4}
                      markerEnd="url(#arr-feedback)"
                    />
                    {active && (
                      <circle r="3" fill="#ec4899" opacity="0.8">
                        <animateMotion dur="2.5s" repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                    <text x={(from.x + to.x) / 2 + 20} y={from.y + 30}
                      textAnchor="middle" fill="#ec4899" fontSize={9} opacity={0.7}
                    >
                      结果→演化
                    </text>
                  </g>
                );
              })()}

              {/* evolution → perception 反馈弧 */}
              {blockPositions['evolution'] && blockPositions['perception'] && (() => {
                const evPos = blockPositions['evolution'];
                const from = { x: evPos.x + evolutionW * 0.25, y: evPos.y };
                const to = getBlockCenter('perception', 'bottom');
                const d = `M ${from.x} ${from.y} C ${from.x} ${from.y - 40}, ${to.x} ${to.y + 40}, ${to.x} ${to.y}`;
                const active = isBlockActive('evolution');
                return (
                  <g>
                    <path d={d} fill="none" stroke="#ec4899" strokeWidth={active ? 2 : 1.5}
                      opacity={active ? 0.8 : 0.4}
                      markerEnd="url(#arr-feedback)"
                    />
                    {active && (
                      <circle r="3" fill="#ec4899" opacity="0.8">
                        <animateMotion dur="2.5s" repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                    <text x={(from.x + to.x) / 2 - 20} y={from.y - 30}
                      textAnchor="middle" fill="#ec4899" fontSize={9} opacity={0.7}
                    >
                      自我→感知
                    </text>
                  </g>
                );
              })()}

              {/* 主块卡片 */}
              {mainBlocks.map(block => {
                const pos = blockPositions[block.id];
                if (!pos) return null;
                return (
                  <BlockCard key={block.id} block={block}
                    subsystems={data?.subsystems || []}
                    x={pos.x} y={pos.y} width={BW} height={BH}
                    onClick={() => {
                      setSelectedBlock(selectedBlock === block.id ? null : block.id);
                    }}
                    isSelected={selectedBlock === block.id}
                  />
                );
              })}

              {/* 自我演化块 */}
              {evolutionBlock && (() => {
                const pos = blockPositions['evolution'];
                if (!pos) return null;
                return (
                  <BlockCard block={evolutionBlock}
                    subsystems={data?.subsystems || []}
                    x={pos.x} y={pos.y} width={evolutionW} height={BH}
                    onClick={() => {
                      setSelectedBlock(selectedBlock === 'evolution' ? null : 'evolution');
                    }}
                    isSelected={selectedBlock === 'evolution'}
                  />
                );
              })()}

              {/* 反馈弧图例 */}
              <g>
                <line x1={20} y1={388} x2={40} y2={388} stroke="#ec4899" strokeWidth={1.5} opacity={0.6}
                  markerEnd="url(#arr-feedback)" />
                <text x={44} y={391} fill="#ec4899" fontSize={9} opacity={0.7}>反馈弧</text>
                <line x1={120} y1={388} x2={140} y2={388} stroke="#94a3b8" strokeWidth={1.5} opacity={0.6}
                  markerEnd="url(#arr-primary)" />
                <text x={144} y={391} fill="#94a3b8" fontSize={9} opacity={0.7}>主流</text>
                <line x1={220} y1={388} x2={240} y2={388} stroke="#eab308" strokeWidth={1}
                  strokeDasharray="4 2" opacity={0.6} markerEnd="url(#arr-fast_path)" />
                <text x={244} y={391} fill="#eab308" fontSize={9} opacity={0.7}>快速路径</text>
                <text x={svgW - 20} y={391} textAnchor="end" fill="#4b5563" fontSize={9}>
                  点击块查看模块详情 · 切换"详情"看节点流图
                </text>
              </g>
            </svg>
          </div>

          {/* 块详情面板 */}
          {selectedBlockData && data && (
            <div style={{ marginTop: 12 }}>
              <BlockDetailPanel block={selectedBlockData} subsystems={data.subsystems} />
            </div>
          )}
        </>
      )}

      {/* ─── Level 2: Detail (现有节点流图) ─── */}
      {viewLevel === 'detail' && (
        <>
          {/* 路径图例 */}
          <div style={{
            display: 'flex', gap: 16, padding: '8px 14px', marginBottom: 12,
            background: 'rgba(255,255,255,0.03)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap',
          }}>
            {Object.entries(PATHS).map(([id, p]) => (
              <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 20, height: 2, background: p.color, borderRadius: 1 }} />
                <span style={{ color: '#d1d5db', fontSize: 11 }}>{p.label}</span>
              </span>
            ))}
            {manifest?.blocks.map(b => (
              <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: b.color, opacity: 0.8 }} />
                <span style={{ color: '#d1d5db', fontSize: 11 }}>{b.label}</span>
              </span>
            ))}
          </div>

          <div style={{
            background: 'rgba(0,0,0,0.25)', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <svg viewBox="0 0 1000 540" width="100%" style={{ display: 'block' }}>
              <defs>
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

              {/* 连接线 */}
              {data?.connections.map((conn, i) => (
                <FlowLine key={i} conn={conn} />
              ))}

              {/* 节点（按块着色） */}
              {data?.subsystems.map(subsystem => (
                <Node
                  key={subsystem.id}
                  subsystem={subsystem}
                  onClick={() => setSelected(selected === subsystem.id ? null : subsystem.id)}
                  isSelected={selected === subsystem.id}
                  blockColor={getNodeBlockColor(subsystem.id)}
                />
              ))}
            </svg>
          </div>

          {/* 节点详情面板 */}
          <div style={{ marginTop: 12 }}>
            <DetailPanel subsystem={selectedSubsystem} />
          </div>
        </>
      )}
    </div>
  );
}
