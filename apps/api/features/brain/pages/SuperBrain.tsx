import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  ReactFlow, Background, Controls, Handle, Position,
  useNodesState, useEdgesState, MarkerType,
  type Node as RFNode, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

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
  nature?: 'dynamic' | 'growing' | 'fixed';
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
  broken?: boolean;
}

interface BrokenConnection {
  from: string;
  to: string;
  reason: string;
  severity: 'P0' | 'P1';
}

interface ManifestIssue {
  severity: 'P0' | 'P1';
  type: string;
  title: string;
  detail: string;
  affected: string[];
}

interface ManifestAction {
  name: string;
  description: string;
  dangerous: boolean;
}

interface ManifestSignal {
  name: string;
}

interface ManifestSkill {
  taskType: string;
  skill: string | null;
}

interface ManifestData {
  version: string;
  blocks: ManifestBlock[];
  blockConnections: BlockConnection[];
  brokenConnections?: BrokenConnection[];
  issues?: ManifestIssue[];
  allActions?: Record<string, { description: string; dangerous: boolean }>;
  allSignals?: string[];
  allSkills?: Record<string, string | null>;
  skillWhitelist?: Record<string, string>;
  generatedAt?: string;
}

interface PerceptionSignal {
  id: string;
  label: string;
  importance: number;
  hasConsumer: boolean;
  value: number | null;
  context: string | null;
  observed: boolean;
}

interface PerceptionSignalsData {
  signals: PerceptionSignal[];
  snapshot_at: string;
  error?: string;
}

// ============== Architecture DB 类型 ==============
interface ArchitectureNode {
  id: string;
  block_id: string;
  label: string;
  nature: 'dynamic' | 'growing' | 'fixed';
  pos_x: number;
  pos_y: number;
}

interface ArchitectureConnection {
  id: number;
  from_node: string;
  to_node: string;
  path_type: 'A' | 'B' | 'C' | 'D';
  is_broken: boolean;
}

interface ArchitectureData {
  nodes: ArchitectureNode[];
  connections: ArchitectureConnection[];
  snapshot_at: string;
}

// ============== Level 2: 颜色配置 ==============
const PATHS: Record<string, { color: string; label: string }> = {
  A: { color: '#3b82f6', label: 'A 自主循环' },
  B: { color: '#a855f7', label: 'B 对话驱动' },
  C: { color: '#eab308', label: 'C 学习回路' },
  D: { color: '#ef4444', label: 'D 防护回路' },
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  idle: '#eab308',
  dormant: '#6b7280',
};

const NATURE_BADGE: Record<string, string> = {
  dynamic: '🔄',
  growing: '📈',
  fixed: '🔒',
};

const BLOCK_COLORS: Record<string, string> = {
  interface:  '#f97316',
  perception: '#6366f1',
  core:       '#a855f7',
  action:     '#22c55e',
  evolution:  '#ec4899',
};

// ============== React Flow 自定义节点 ==============
interface BrainNodeData {
  label: string;
  nature?: 'dynamic' | 'growing' | 'fixed';
  blockColor?: string;
  status?: 'active' | 'idle' | 'dormant';
  todayCount?: number | null;
  [key: string]: unknown;
}

const BrainNodeComponent = memo(({ data, selected }: NodeProps & { data: BrainNodeData }) => {
  const sc = STATUS_COLORS[data.status || 'dormant'];
  const isActive = data.status === 'active';
  const natureBadge = data.nature ? NATURE_BADGE[data.nature] : undefined;
  const blockColor = data.blockColor;

  return (
    <div style={{
      width: 110, height: 52,
      background: selected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
      borderRadius: 8,
      border: `1px solid ${selected ? '#e5e7eb' : blockColor ? `${blockColor}60` : 'rgba(255,255,255,0.12)'}`,
      position: 'relative',
      cursor: 'pointer',
      boxShadow: isActive ? `0 0 8px ${sc}30` : 'none',
      transition: 'box-shadow 0.3s',
    }}>
      {blockColor && (
        <div style={{
          position: 'absolute', left: 0, top: 0, width: 4, height: '100%',
          borderRadius: '8px 0 0 8px', background: blockColor, opacity: 0.6,
        }} />
      )}
      {/* 状态灯 */}
      <div style={{
        position: 'absolute', left: 10, top: 10,
        width: 8, height: 8, borderRadius: '50%',
        background: sc,
        boxShadow: isActive ? `0 0 4px ${sc}` : 'none',
      }} />
      {/* nature 徽章 */}
      {natureBadge && (
        <div style={{ position: 'absolute', right: 6, top: 6, fontSize: 10 }}>
          {natureBadge}
        </div>
      )}
      {/* 名称 */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 16,
        textAlign: 'center', color: '#e5e7eb', fontSize: 11, fontWeight: 600,
      }}>
        {data.label}
      </div>
      {/* 计数 */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 7,
        textAlign: 'center', color: '#9ca3af', fontSize: 10,
      }}>
        {data.todayCount != null
          ? `${data.todayCount.toLocaleString()} 次`
          : (data.status || 'dormant')}
      </div>
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
});
BrainNodeComponent.displayName = 'BrainNodeComponent';

const nodeTypes = { brainNode: BrainNodeComponent };

// ============== Level 1: 块健康状态计算 ==============
function computeBlockHealth(block: ManifestBlock, issues?: ManifestIssue[]) {
  if (!issues) return 'ok';
  const hasP0 = issues.some(
    iss => iss.severity === 'P0' && iss.affected.some(a => block.modules.some(m => m.id === a) || block.nodeIds.includes(a))
  );
  const hasP1 = issues.some(
    iss => iss.severity === 'P1' && iss.affected.some(a => block.modules.some(m => m.id === a) || block.nodeIds.includes(a))
  );
  if (hasP0) return 'broken';
  if (hasP1) return 'warning';
  return 'ok';
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
  health: 'ok' | 'warning' | 'broken';
}

function BlockCard({ block, subsystems, x, y, width, height, onClick, isSelected, health }: BlockCardProps) {
  const { active, idle, dormant, status, total } = computeBlockStatus(block, subsystems);
  const sc = STATUS_COLORS[status];
  const isActive = status === 'active';

  const healthBadge = health === 'broken' ? '🔴' : health === 'warning' ? '⚠️' : '✅';

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      {isSelected && (
        <rect x={x - 3} y={y - 3} width={width + 6} height={height + 6}
          rx={13} fill="none" stroke={block.color} strokeWidth={1.5} opacity={0.5} />
      )}
      <rect x={x} y={y} width={width} height={height} rx={10}
        fill={`${block.color}08`}
        stroke={isSelected ? block.color : `${block.color}30`}
        strokeWidth={isSelected ? 1.5 : 1}
      />
      {/* 顶部色条 */}
      <rect x={x} y={y} width={width} height={4} rx={0}
        fill={block.color} opacity={0.6}
      />
      {/* 状态灯 */}
      <circle cx={x + 18} cy={y + 22} r={5} fill={sc}>
        {isActive && (
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        )}
      </circle>
      {/* 健康徽章 */}
      <text x={x + width - 10} y={y + 26} textAnchor="end" fontSize={14}>
        {healthBadge}
      </text>
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

// ============== Level 2 节点钻取面板 ==============
interface NodeDrillPanelProps {
  nodeId: string | null;
  manifest: ManifestData | null;
  subsystems: Subsystem[];
  onClose: () => void;
}

function NodeDrillPanel({ nodeId, manifest, subsystems, onClose }: NodeDrillPanelProps) {
  if (!nodeId) return null;

  // 从 manifest 中找到对应模块
  let module: ManifestModule | undefined;
  let blockColor: string = '#6b7280';
  if (manifest) {
    for (const block of manifest.blocks) {
      const found = block.modules.find(m => m.id === nodeId);
      if (found) {
        module = found;
        blockColor = block.color;
        break;
      }
    }
  }

  const subsystem = subsystems.find(s => s.id === nodeId);
  const natureBadge = module?.nature ? NATURE_BADGE[module.nature] : '';
  const sc = STATUS_COLORS[subsystem?.status || 'dormant'];

  // 从 manifest 中读取 thalamus actions / perception_signals signals / executor skills
  const actions: ManifestAction[] = (module as (ManifestModule & { actions?: ManifestAction[] }))?.actions || [];
  const signals: ManifestSignal[] = (module as (ManifestModule & { signals?: ManifestSignal[] }))?.signals || [];
  const skills: ManifestSkill[] = (module as (ManifestModule & { skills?: ManifestSkill[] }))?.skills || [];

  return (
    <div style={{
      padding: '16px 20px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 12,
      border: `1px solid ${blockColor}40`,
      position: 'relative',
    }}>
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', right: 14, top: 14,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
          color: '#9ca3af', fontSize: 11,
        }}
      >
        ✕ 关闭
      </button>

      {/* 标题区 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{
          display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
          background: sc, flexShrink: 0,
        }} />
        <span style={{ color: '#f3f4f6', fontSize: 16, fontWeight: 700 }}>
          {module?.label || nodeId}
        </span>
        {natureBadge && (
          <span style={{ fontSize: 14 }}>{natureBadge}</span>
        )}
        {subsystem && (
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 10,
            background: `${sc}20`, color: sc,
          }}>
            {subsystem.status}
          </span>
        )}
        <span style={{
          marginLeft: 'auto', color: '#4b5563', fontSize: 11, fontFamily: 'monospace',
        }}>
          {nodeId}
        </span>
      </div>

      {/* 描述 */}
      {module?.desc && (
        <div style={{
          color: '#9ca3af', fontSize: 12, marginBottom: 14, lineHeight: 1.5,
          padding: '8px 12px', background: 'rgba(255,255,255,0.02)',
          borderRadius: 6, borderLeft: `3px solid ${blockColor}60`,
        }}>
          {module.desc}
        </div>
      )}

      {/* 基础指标 */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 14, flexWrap: 'wrap' }}>
        {subsystem && (
          <>
            <div>
              <span style={{ color: '#6b7280', fontSize: 11 }}>今日次数 </span>
              <span style={{ color: '#d1d5db', fontSize: 13, fontWeight: 600 }}>
                {subsystem.metrics.today_count?.toLocaleString() ?? '—'}
              </span>
            </div>
            {subsystem.metrics.last_active_at && (
              <div>
                <span style={{ color: '#6b7280', fontSize: 11 }}>最后活跃 </span>
                <span style={{ color: '#d1d5db', fontSize: 13 }}>
                  {new Date(subsystem.metrics.last_active_at).toLocaleTimeString('zh-CN')}
                </span>
              </div>
            )}
          </>
        )}
        {module?.file && (
          <div>
            <span style={{ color: '#6b7280', fontSize: 11 }}>实现文件 </span>
            <span style={{
              color: '#60a5fa', fontSize: 11, fontFamily: 'monospace',
              padding: '1px 6px', background: 'rgba(96,165,250,0.1)',
              borderRadius: 4, border: '1px solid rgba(96,165,250,0.2)',
            }}>
              src/{module.file}
            </span>
          </div>
        )}
      </div>

      {/* 动作列表（仅 thalamus 有）*/}
      {actions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            color: '#d1d5db', fontSize: 12, fontWeight: 600, marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>动作白名单</span>
            <span style={{
              padding: '1px 7px', borderRadius: 10, fontSize: 10,
              background: 'rgba(34,197,94,0.15)', color: '#22c55e',
              border: '1px solid rgba(34,197,94,0.3)',
            }}>
              {actions.length}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 5 }}>
            {actions.map(a => (
              <div key={a.name} style={{
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.025)',
                borderRadius: 6,
                border: `1px solid ${a.dangerous ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.07)'}`,
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <span style={{
                  color: a.dangerous ? '#ef4444' : '#6b7280',
                  fontSize: 12, flexShrink: 0, marginTop: 1,
                }}>
                  {a.dangerous ? '🔴' : '●'}
                </span>
                <div>
                  <div style={{ color: '#d1d5db', fontSize: 11, fontFamily: 'monospace', fontWeight: 500 }}>
                    {a.name}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: 10, marginTop: 1 }}>
                    {a.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 信号列表（仅 perception_signals 有）*/}
      {signals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            color: '#d1d5db', fontSize: 12, fontWeight: 600, marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>感知信号</span>
            <span style={{
              padding: '1px 7px', borderRadius: 10, fontSize: 10,
              background: 'rgba(99,102,241,0.15)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,0.3)',
            }}>
              {signals.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {signals.map(s => (
              <span key={s.name} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11,
                fontFamily: 'monospace',
                background: 'rgba(99,102,241,0.1)',
                color: '#a5b4fc',
                border: '1px solid rgba(99,102,241,0.25)',
              }}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 技能映射（仅 executor 有）*/}
      {skills.length > 0 && (
        <div>
          <div style={{
            color: '#d1d5db', fontSize: 12, fontWeight: 600, marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>技能映射</span>
            <span style={{
              padding: '1px 7px', borderRadius: 10, fontSize: 10,
              background: 'rgba(249,115,22,0.15)', color: '#fb923c',
              border: '1px solid rgba(249,115,22,0.3)',
            }}>
              {skills.length}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 5 }}>
            {skills.map(s => (
              <div key={s.taskType} style={{
                padding: '5px 10px',
                background: 'rgba(255,255,255,0.025)',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ color: '#fb923c', fontSize: 11, fontFamily: 'monospace', flex: 1 }}>
                  {s.taskType}
                </span>
                <span style={{ color: '#4b5563', fontSize: 10 }}>→</span>
                <span style={{
                  color: s.skill ? '#60a5fa' : '#4b5563',
                  fontSize: 11, fontFamily: 'monospace',
                }}>
                  {s.skill || 'null'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 如果什么额外信息都没有 */}
      {actions.length === 0 && signals.length === 0 && skills.length === 0 && (
        <div style={{ color: '#4b5563', fontSize: 12, padding: '8px 0' }}>
          该模块暂无扫描到的动作/信号/技能数据
        </div>
      )}
    </div>
  );
}

// ============== 感知层信号面板 ==============
function SignalPanel({ signalsData }: { signalsData: PerceptionSignalsData | null }) {
  if (!signalsData) {
    return (
      <div style={{
        padding: '14px 20px', background: 'rgba(99,102,241,0.06)',
        borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)',
        color: '#9ca3af', fontSize: 12,
      }}>
        加载感知信号中...
      </div>
    );
  }

  const { signals, snapshot_at } = signalsData;
  const noConsumerCount = signals.filter(s => !s.hasConsumer).length;
  const observedCount = signals.filter(s => s.observed).length;

  return (
    <div style={{
      padding: '14px 20px',
      background: 'rgba(99,102,241,0.06)',
      borderRadius: 8,
      border: '1px solid rgba(99,102,241,0.2)',
    }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          display: 'inline-block', width: 12, height: 12, borderRadius: 3,
          background: '#6366f1', opacity: 0.8,
        }} />
        <span style={{ color: '#f3f4f6', fontSize: 15, fontWeight: 700 }}>感知层 — 16 个信号</span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>
          {observedCount}/16 激活
          {noConsumerCount > 0 && (
            <span style={{ color: '#f97316', marginLeft: 8 }}>⚠️ {noConsumerCount} 无消费者</span>
          )}
        </span>
        <span style={{ marginLeft: 'auto', color: '#4b5563', fontSize: 10 }}>
          {new Date(snapshot_at).toLocaleTimeString('zh-CN')}
        </span>
      </div>

      {/* 信号列表 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
        {signals.map(sig => (
          <div key={sig.id} style={{
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 6,
            border: `1px solid ${!sig.hasConsumer ? 'rgba(249,115,22,0.3)' : sig.observed ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              {/* 激活状态 */}
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: sig.observed ? '#22c55e' : '#374151',
                display: 'inline-block',
              }} />
              {/* 信号名 */}
              <span style={{ color: '#d1d5db', fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}>
                {sig.id}
              </span>
              {/* 无消费者警告 */}
              {!sig.hasConsumer && (
                <span style={{ color: '#f97316', fontSize: 10, marginLeft: 'auto' }}>⚠️ 无消费</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* 中文含义 */}
              <span style={{ color: '#9ca3af', fontSize: 10 }}>{sig.label}</span>
              {/* 重要性 */}
              <span style={{ marginLeft: 'auto', color: '#4b5563', fontSize: 9 }}>
                {'█'.repeat(Math.round(sig.importance / 2))}{'░'.repeat(5 - Math.round(sig.importance / 2))}
                <span style={{ marginLeft: 3 }}>{sig.importance}/10</span>
              </span>
            </div>
            {/* 当前值 */}
            {sig.observed && sig.value !== null && (
              <div style={{ color: '#6366f1', fontSize: 10, marginTop: 3, fontFamily: 'monospace' }}>
                {typeof sig.value === 'number' ? sig.value.toFixed(3) : String(sig.value)}
              </div>
            )}
            {/* 上下文 */}
            {sig.observed && sig.context && (
              <div style={{
                color: '#4b5563', fontSize: 9, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={sig.context}>
                {sig.context}
              </div>
            )}
            {!sig.observed && (
              <div style={{ color: '#374151', fontSize: 9, marginTop: 2 }}>本次 tick 未激活</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== 块详情面板 ==============
function BlockDetailPanel({
  block, subsystems, signalsData,
}: { block: ManifestBlock; subsystems: Subsystem[]; signalsData: PerceptionSignalsData | null }) {
  if (block.id === 'perception') {
    return <SignalPanel signalsData={signalsData} />;
  }

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
          const natureBadge = mod.nature ? NATURE_BADGE[mod.nature] : '';
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
                {natureBadge && (
                  <span style={{ marginLeft: 'auto', fontSize: 11 }}>{natureBadge}</span>
                )}
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

// ============== Issues 面板 ==============
function IssuesPanel({ issues }: { issues?: ManifestIssue[] }) {
  if (!issues || issues.length === 0) return null;

  return (
    <div style={{
      padding: '12px 16px',
      background: 'rgba(0,0,0,0.3)',
      borderRadius: 8,
      border: '1px solid rgba(239,68,68,0.2)',
      marginTop: 12,
    }}>
      <div style={{ color: '#f87171', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        已知问题 ({issues.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {issues.map((issue, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span style={{
              padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700, flexShrink: 0,
              background: issue.severity === 'P0' ? 'rgba(239,68,68,0.2)' : 'rgba(249,115,22,0.2)',
              color: issue.severity === 'P0' ? '#ef4444' : '#f97316',
              border: `1px solid ${issue.severity === 'P0' ? 'rgba(239,68,68,0.3)' : 'rgba(249,115,22,0.3)'}`,
            }}>
              {issue.severity}
            </span>
            <div>
              <div style={{ color: '#d1d5db', fontSize: 12, fontWeight: 600 }}>{issue.title}</div>
              <div style={{ color: '#6b7280', fontSize: 10, marginTop: 2 }}>{issue.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== React Flow Level 2 子组件 ==============
function BrainFlowView({
  architectureData, subsystems,
  onNodeClick, onNodeDragStop,
}: {
  architectureData: ArchitectureData;
  subsystems: Subsystem[];
  onNodeClick: (nodeId: string) => void;
  onNodeDragStop: (nodeId: string, x: number, y: number) => void;
}) {
  const rfNodes: RFNode[] = architectureData.nodes.map(n => {
    const subsystem = subsystems.find(s => s.id === n.id);
    return {
      id: n.id,
      position: { x: n.pos_x, y: n.pos_y },
      type: 'brainNode',
      data: {
        label: n.label,
        nature: n.nature,
        blockColor: BLOCK_COLORS[n.block_id],
        status: subsystem?.status,
        todayCount: subsystem?.metrics.today_count,
      },
    };
  });

  const rfEdges: Edge[] = architectureData.connections.map(c => {
    const pathColor = PATHS[c.path_type]?.color || '#475569';
    return {
      id: `${c.from_node}-${c.to_node}`,
      source: c.from_node,
      target: c.to_node,
      animated: !c.is_broken,
      label: c.is_broken ? '⚠️ 断路' : undefined,
      style: {
        stroke: c.is_broken ? '#ef4444' : pathColor,
        strokeDasharray: c.is_broken ? '5 3' : undefined,
        strokeWidth: 2,
      },
      markerEnd: c.is_broken ? undefined : {
        type: MarkerType.ArrowClosed,
        color: pathColor,
      },
      labelStyle: { fill: '#ef4444', fontSize: 10 },
      labelBgStyle: { fill: 'rgba(0,0,0,0.5)' },
    };
  });

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, , onEdgesChange] = useEdgesState(rfEdges);

  return (
    <div style={{ width: '100%', height: 560, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        onNodeDragStop={(_, node) => onNodeDragStop(node.id, node.position.x, node.position.y)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        style={{ background: 'rgba(0,0,0,0.25)' }}
        minZoom={0.4}
        maxZoom={2}
      >
        <Background color="#1e293b" gap={20} />
        <Controls style={{ background: 'rgba(30,41,59,0.9)', border: '1px solid rgba(255,255,255,0.08)' }} />
      </ReactFlow>
    </div>
  );
}

// ============== 主组件 ==============
export default function SuperBrain() {
  const [data, setData] = useState<CognitiveMapData | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [signalsData, setSignalsData] = useState<PerceptionSignalsData | null>(null);
  const [architectureData, setArchitectureData] = useState<ArchitectureData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewLevel, setViewLevel] = useState<'overview' | 'detail'>('overview');
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/perception-signals');
      if (res.ok) {
        setSignalsData(await res.json());
      }
    } catch {
      // 静默失败，signals 为 null 时 SignalPanel 会显示加载状态
    }
  }, []);

  const fetchArchitecture = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/architecture');
      if (res.ok) setArchitectureData(await res.json());
    } catch {
      // 静默失败
    }
  }, []);

  const handleNodeDragStop = useCallback(async (nodeId: string, x: number, y: number) => {
    try {
      await fetch(`/api/brain/architecture/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pos_x: Math.round(x), pos_y: Math.round(y) }),
      });
      // 更新本地 state
      setArchitectureData(prev => prev ? {
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, pos_x: Math.round(x), pos_y: Math.round(y) } : n),
      } : prev);
    } catch {
      // 静默失败，位置会在下次 fetch 恢复
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    fetchArchitecture();
  }, [fetchArchitecture]);

  // 感知信号每 30s 刷新一次（运行感知需要查 DB，不要太频繁）
  useEffect(() => {
    if (selectedBlock === 'perception') {
      fetchSignals();
    }
  }, [selectedBlock, fetchSignals]);

  useEffect(() => {
    if (selectedBlock !== 'perception') return;
    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, [selectedBlock, fetchSignals]);

  // ESC 退出全屏
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  // 为每个节点查找所属块的颜色和 nature
  const getNodeBlockColor = useCallback((nodeId: string) => {
    if (!manifest) return undefined;
    const block = manifest.blocks.find(b => b.nodeIds.includes(nodeId));
    return block?.color;
  }, [manifest]);

  const getNodeNature = useCallback((nodeId: string) => {
    if (!manifest) return undefined;
    for (const block of manifest.blocks) {
      const mod = block.modules.find(m => m.id === nodeId);
      if (mod) return mod.nature;
    }
    return undefined;
  }, [manifest]);

  const selectedSubsystem = data?.subsystems.find(s => s.id === selected) || null;
  const selectedBlockData = manifest?.blocks.find(b => b.id === selectedBlock) || null;
  const activeCount = data?.subsystems.filter(s => s.status === 'active').length || 0;
  const idleCount = data?.subsystems.filter(s => s.status === 'idle').length || 0;
  const dormantCount = data?.subsystems.filter(s => s.status === 'dormant').length || 0;

  // 断路连接集合（Level 2 用，从 manifest 读取）
  const brokenSet = new Set(
    (manifest?.brokenConnections || []).map(c => `${c.from}→${c.to}`)
  );

  // ── Level 1 (overview) 布局 ──
  const BW = 180;
  const BH = 160;
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
    blockPositions['evolution'] = { x: startX, y: botY };
  }

  const evolutionW = evolutionBlock ? totalTopW : BW;

  function getBlockCenter(id: string, side: 'right' | 'left' | 'top' | 'bottom') {
    const pos = blockPositions[id];
    if (!pos) return { x: 0, y: 0 };
    const w = id === 'evolution' ? evolutionW : BW;
    const h = BH;
    if (side === 'right') return { x: pos.x + w, y: pos.y + h / 2 };
    if (side === 'left') return { x: pos.x, y: pos.y + h / 2 };
    if (side === 'top') return { x: pos.x + w / 2, y: pos.y };
    return { x: pos.x + w / 2, y: pos.y + h };
  }

  function isBlockActive(id: string) {
    if (!manifest || !data) return false;
    const block = manifest.blocks.find(b => b.id === id);
    if (!block) return false;
    return block.nodeIds.some(nid => data.subsystems.find(s => s.id === nid)?.status === 'active');
  }

  // 全屏容器样式
  const containerStyle: React.CSSProperties = isFullscreen ? {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: '#0d1117', color: '#e5e7eb',
    padding: '20px 24px', overflowY: 'auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  } : {
    minHeight: '100vh', background: '#0d1117', color: '#e5e7eb', padding: '20px 24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  return (
    <div ref={containerRef} style={containerStyle}>
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
            {data ? `${activeCount} active / ${idleCount} idle / ${dormantCount} dormant` : '加载中...'}
            {data?.snapshot_at && (
              <span style={{ marginLeft: 12 }}>
                {new Date(data.snapshot_at).toLocaleTimeString('zh-CN')}
              </span>
            )}
          </p>
        </div>

        {/* 控制栏 */}
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
          {/* 全屏按钮 */}
          <button
            onClick={() => setIsFullscreen(f => !f)}
            title={isFullscreen ? 'ESC 退出全屏' : '全屏'}
            style={{
              padding: '6px 10px', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6, color: '#9ca3af', fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            {isFullscreen ? '⊡' : '⛶'}
          </button>
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
            <svg viewBox={`0 0 ${svgW} 450`} width="100%" style={{ display: 'block' }}>
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
                const health = computeBlockHealth(block, manifest.issues);
                return (
                  <BlockCard key={block.id} block={block}
                    subsystems={data?.subsystems || []}
                    x={pos.x} y={pos.y} width={BW} height={BH}
                    health={health}
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
                const health = computeBlockHealth(evolutionBlock, manifest.issues);
                return (
                  <BlockCard block={evolutionBlock}
                    subsystems={data?.subsystems || []}
                    x={pos.x} y={pos.y} width={evolutionW} height={BH}
                    health={health}
                    onClick={() => {
                      setSelectedBlock(selectedBlock === 'evolution' ? null : 'evolution');
                    }}
                    isSelected={selectedBlock === 'evolution'}
                  />
                );
              })()}

              {/* 图例 */}
              <g>
                <line x1={20} y1={438} x2={40} y2={438} stroke="#ec4899" strokeWidth={1.5} opacity={0.6}
                  markerEnd="url(#arr-feedback)" />
                <text x={44} y={441} fill="#ec4899" fontSize={9} opacity={0.7}>反馈弧</text>
                <line x1={120} y1={438} x2={140} y2={438} stroke="#94a3b8" strokeWidth={1.5} opacity={0.6}
                  markerEnd="url(#arr-primary)" />
                <text x={144} y={441} fill="#94a3b8" fontSize={9} opacity={0.7}>主流</text>
                <line x1={220} y1={438} x2={240} y2={438} stroke="#eab308" strokeWidth={1}
                  strokeDasharray="4 2" opacity={0.6} markerEnd="url(#arr-fast_path)" />
                <text x={244} y={441} fill="#eab308" fontSize={9} opacity={0.7}>快速路径</text>
                <text x={400} y={441} fill="#22c55e" fontSize={9} opacity={0.7}>✅ 健康</text>
                <text x={450} y={441} fill="#f97316" fontSize={9} opacity={0.7}>⚠️ 警告</text>
                <text x={500} y={441} fill="#ef4444" fontSize={9} opacity={0.7}>🔴 断路</text>
                <text x={svgW - 20} y={441} textAnchor="end" fill="#4b5563" fontSize={9}>
                  点击感知层查看 16 个信号 · 切换"详情"看节点流图
                </text>
              </g>
            </svg>
          </div>

          {/* 块详情面板 */}
          {selectedBlockData && data && (
            <div style={{ marginTop: 12 }}>
              <BlockDetailPanel
                block={selectedBlockData}
                subsystems={data.subsystems}
                signalsData={signalsData}
              />
            </div>
          )}

          {/* Issues 面板 */}
          {manifest.issues && manifest.issues.length > 0 && (
            <IssuesPanel issues={manifest.issues} />
          )}
        </>
      )}

      {/* ─── Level 2: Detail (React Flow 节点流图) ─── */}
      {viewLevel === 'detail' && (
        <>
          {/* 路径图例 + nature 说明 */}
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
            <span style={{ color: '#d1d5db', fontSize: 11 }}>🔄 动态  📈 成长</span>
            <span style={{ color: '#ef4444', fontSize: 11 }}>⚠️ 断路连接标红</span>
            <span style={{ color: '#6b7280', fontSize: 11 }}>拖拽节点自动保存位置</span>
          </div>

          {architectureData ? (
            <BrainFlowView
              architectureData={architectureData}
              subsystems={data?.subsystems || []}
              onNodeClick={(nodeId) => setSelected(selected === nodeId ? null : nodeId)}
              onNodeDragStop={handleNodeDragStop}
            />
          ) : (
            <div style={{
              height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.25)', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.06)', color: '#9ca3af', fontSize: 14,
            }}>
              加载架构数据中...
            </div>
          )}

          {/* 节点钻取面板 */}
          {selected && (
            <div style={{ marginTop: 12 }}>
              <NodeDrillPanel
                nodeId={selected}
                manifest={manifest}
                subsystems={data?.subsystems || []}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
