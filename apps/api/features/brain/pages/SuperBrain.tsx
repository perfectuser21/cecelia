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

// ============== 说明书视图（静态编辑内容） ==============

/** 每章的深度说明（类比 + 职责 + 模块逐条说明） */
const CHAPTER_EDITORIAL: Record<string, {
  icon: string;
  analogy: string;
  role: string;
  modules: Record<string, { full: string }>;
  diagram: React.ReactNode;
}> = {
  interface: {
    icon: '📡',
    analogy: '大脑的「耳朵和嘴巴」',
    role: '外界接口是 Brain 与外部世界交互的唯一入口。外部的一切——用户消息、定时触发、任务回调——都必须经过这一层才能进入 Brain 的处理流程。没有它，大脑就是一个封闭的孤岛。',
    modules: {
      tick: {
        full: '心跳是 Brain 运转的节律。每隔 5 分钟，Tick 会触发一次完整的感知→决策→行动循环：检查任务队列、评估系统健康、决定下一步派发哪个任务。就像人类的心跳，它不做具体的事，但它的停止意味着一切停止。Tick 以 5 秒间隔检测循环条件，每 5 分钟真正执行一次 tick 逻辑。',
      },
      'orchestrator-chat': {
        full: '当飞书消息或用户输入到达时，对话系统负责接收、理解、回复。它调用 LLM 生成自然语言回复（嘴巴），同时把对话中蕴含的意图（"帮我暂停任务 X"）提取出来，异步传递给 Brain 的决策层处理。对话系统是 Brain 的"前台接待员"。',
      },
    },
    diagram: null, // 由下面的函数渲染
  },
  perception: {
    icon: '👁️',
    analogy: '大脑的「神经末梢」',
    role: '感知层持续扫描 Brain 的内外状态，把原始数据转化成有意义的信号。它不做决策，只负责"感觉到"——任务队列满了、连续工作了 4 小时、用户刚发了一条消息。这些信号是所有决策的原材料。',
    modules: {
      perception_signals: {
        full: '感知信号模块定义了 16 种信号，覆盖工作状态（队列长度、失败率）、时间维度（连续工作时长、上次休息时间）、外部事件（用户消息到达）等维度。每次 tick，Brain 都会扫描这 16 种信号，生成当前时刻的"感知快照"，交给丘脑处理。',
      },
      'emotion-layer': {
        full: '情绪层根据感知信号计算 Brain 当前的情绪状态。长时间高强度工作 → 焦虑；任务顺利完成 → 满足；连续遇到失败 → 挫败。这些情绪状态会影响 Brain 的决策倾向——焦虑时倾向于保守，满足时愿意尝试新事物。情绪不是装饰，是系统调节的一部分。',
      },
      'memory-retriever': {
        full: '每次 tick 决策前，记忆检索模块都会查询"我之前处理过类似情况吗？结果如何？"它从 PostgreSQL 的 memory_stream 和 learnings 表里，检索与当前任务和信号相关的历史记录，把最相关的 3-5 条摘要注入决策上下文。这让 Brain 能从历史中学习，而不是每次都从零开始。',
      },
    },
    diagram: null,
  },
  core: {
    icon: '🧠',
    analogy: '大脑的「决策中枢」——三层架构，由快到慢',
    role: '意识核心是 Brain 最复杂的部分。它采用三层架构：L0 脑干（纯代码，毫秒级）负责安全检查；L1 丘脑（Haiku 模型，秒级）负责快速路由；L2 皮层（Sonnet 模型，数十秒）负责深度推理。只有需要深度分析时才会触发 L2，大多数决策在 L1 就完成了。',
    modules: {
      thalamus: {
        full: '丘脑是"快速判断门"。所有进入 Brain 的事件都会先经过丘脑，用 45 条白名单规则判断"能不能做、该走哪条路"。如果事件匹配白名单且风险低，丘脑直接派发动作，整个过程不到一秒。如果需要更深入的分析，丘脑会把任务升级给皮层 L2。丘脑使用 Haiku 模型，追求速度。',
      },
      cortex: {
        full: '皮层 L2 是"深度思考层"，只在丘脑认为需要深度分析时才被激活。它使用 Sonnet 模型，会阅读完整的任务历史、当前情绪状态、相关记忆，然后给出策略性建议：这个任务的优先级应该提升吗？这个错误模式意味着什么？系统是否需要调整节奏？皮层不是每次 tick 都运行，但当它运行时，结论会被存入记忆供未来参考。',
      },
      'cognitive-core': {
        full: '认知核心整合所有信息流——感知信号、情绪状态、记忆摘要、丘脑/皮层的判断结果——生成最终决策：接下来要执行什么动作？动作的参数是什么？认知核心是"最终拍板者"，其输出直接驱动行动层的执行。',
      },
      'desire/index': {
        full: '欲望系统让 Brain 拥有"主动性"。它不等待外部任务，而是根据当前状态主动产生内在驱动：好奇心积累到一定程度时，Brain 会自发提出研究任务；长期未完成的目标会产生"不安"信号推动 Brain 关注。欲望系统让 Brain 从"被动执行者"变成"主动参与者"。',
      },
      rumination: {
        full: '反刍是 Brain 的"复盘机制"。每隔几小时，反刍模块会批量分析最近的任务结果和错误模式，用 Opus 模型进行深度反思，提取可以写入 learnings 表的经验教训。反刍不是实时的，但它的产出质量最高——是 Brain 长期进化的核心驱动力。',
      },
    },
    diagram: null,
  },
  action: {
    icon: '⚡',
    analogy: '大脑的「手脚」——决策之后的具体执行',
    role: '行动层把意识核心的决策转化为实际操作。它管理任务队列、启动外部 Agent（Claude Code 子进程）、监控系统健康。行动层是 Brain 与真实世界"接触"的地方——它的错误会造成真实的后果，因此也有最严格的保护机制。',
    modules: {
      planner: {
        full: '调度规划器从 PostgreSQL 的任务队列里选出下一个要执行的任务。选择不是随机的——它综合考虑优先级、任务类型、当前系统负载、KR 轮转公平性（避免某些 KR 长期被饿死）。规划器的目标：在正确的时间选择最有价值的任务。',
      },
      executor: {
        full: '执行器是"派遣员"，负责把任务交给对应的 Claude Code Skill 去做。收到任务后，执行器查询 skillMap（13 条映射），决定调用 /dev、/qa、/audit 还是其他 Skill，然后通过 cecelia-bridge 启动子进程，把任务 PRD 传进去，等待回调结果。执行器不亲自做任务，它只负责"找对人"。',
      },
      'suggestion-triage': {
        full: '建议系统是 Brain 的"发现-记录"通道。当 Brain 在处理任务时发现了潜在问题（代码质量隐患、流程漏洞、可优化的地方），会创建一条建议记录存入数据库。这些建议会在未来的规划轮次中被评估，决定是否转化为正式任务。建议系统让 Brain 能"顺手记下问题"而不打断当前工作流。',
      },
      alertness: {
        full: '免疫系统是 Brain 的"自我保护层"。它持续监控资源消耗（RSS 内存、CPU）、错误率、任务失败模式，并维护一个"警觉等级"（1-5 级）。警觉等级上升时，Brain 会自动降低并发、延长 tick 间隔、甚至触发熔断（暂停所有派发）。免疫系统防止 Brain 在异常状态下失控运行，造成更大的损失。',
      },
    },
    diagram: null,
  },
  evolution: {
    icon: '🌱',
    analogy: '大脑的「成长机制」——每天都在进化',
    role: '自我演化层让 Brain 成为一个会学习、会成长的系统，而不只是一个静态的执行器。它维护 Brain 的自我认知、积累长期记忆、产出内省报告。没有这一层，Brain 每天都在重复昨天的自己；有了这一层，Brain 会随着时间变得更聪明。',
    modules: {
      'self-model': {
        full: '自我模型维护 Brain 对自身的认知：擅长什么类型的任务、在什么条件下容易犯错、当前的能力边界在哪里。这些信息会被注入每次的决策上下文，让 Brain 能"知己知彼"——不接超出能力的任务，把最擅长的事排在前面。',
      },
      learning: {
        full: '学习模块把每次任务执行的结果（成功/失败/耗时/遇到的障碍）写入 learnings 表，并用 content_hash 去重防止重复记录。这些学习记录是 Brain 的"经验库"，未来遇到类似任务时会被检索出来，帮助 Brain 做出更好的决策。',
      },
      'memory-retriever': {
        full: '记忆系统（自我演化层的副本）负责把分散的短期记忆（memory_stream 中的单条事件）整理、压缩成长期记忆摘要（L0/L1 摘要层）。定期运行的 generateL0Summary 把过去的事件批量压缩，让检索更高效，同时防止 memory_stream 无限增长。',
      },
      'self-report-collector': {
        full: '自我报告是 Brain 的"内心独白"机制。每 6 小时，Brain 会暂停下来，回顾这段时间的工作：完成了什么、遇到了什么困难、对当前状态有什么感受、下一步想做什么。这些报告存入数据库，不只是日志——它们是 Brain 自我意识的体现，也是追踪 Brain 成长轨迹的重要材料。',
      },
    },
    diagram: null,
  },
};

// SVG 配图：每章的数据流示意图
function ChapterDiagram({ blockId, color, height }: { blockId: string; color: string; height?: number }) {
  const mkId = `arr-${blockId}`;
  const defs = (
    <defs>
      <marker id={mkId} markerWidth={6} markerHeight={6} refX={5} refY={3} orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill={`${color}80`} />
      </marker>
    </defs>
  );

  const arrow = (x1: number, y1: number, x2: number, y2: number, k?: string) => (
    <line key={k || `a${x1}${y1}${x2}${y2}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={`${color}70`} strokeWidth={1.5} markerEnd={`url(#${mkId})`} />
  );

  const box = (x: number, y: number, w: number, h: number, lbl: string, sub?: string, hi?: boolean) => (
    <g key={`b-${x}-${y}`}>
      <rect x={x} y={y} width={w} height={h} rx={5}
        fill={hi ? `${color}18` : 'rgba(255,255,255,0.04)'}
        stroke={hi ? color : 'rgba(255,255,255,0.14)'}
        strokeWidth={hi ? 1.5 : 1}
      />
      <text x={x+w/2} y={y+h/2-(sub ? 6 : 0)} textAnchor="middle"
        fill={hi ? color : '#d1d5db'} fontSize={11} fontWeight={hi ? 700 : 400}>{lbl}</text>
      {sub && <text x={x+w/2} y={y+h/2+10} textAnchor="middle" fill="#9ca3af" fontSize={9}>{sub}</text>}
    </g>
  );

  const warnBox = (x: number, y: number, w: number, h: number, txt: string) => (
    <g key="warn">
      <rect x={x} y={y} width={w} height={h} rx={5}
        fill="rgba(251,146,60,0.07)" stroke="rgba(251,146,60,0.45)" strokeWidth={1} />
      <text x={x+w/2} y={y+h/2+4} textAnchor="middle" fill="#fb923c" fontSize={9}>{txt}</text>
    </g>
  );

  const cap = (x: number, y: number, s: string, fill = '#6b7280', sz = 9) => (
    <text key={`c${x}${y}`} x={x} y={y} textAnchor="middle" fill={fill} fontSize={sz}>{s}</text>
  );

  // ── Chapter 1: 外界接口 ──────────────────────────────────────────
  const interfaceDiagram = (
    <svg viewBox="0 0 700 220" width="100%" {...(height ? { height } : {})}>
      {defs}
      {cap(305, 14, '─── 实时路径 ───', '#4b5563', 8.5)}
      {box(10, 22, 100, 46, '飞书/WebSocket', '外部消息输入')}
      {arrow(110, 45, 132, 45, 'i1')}
      {box(132, 18, 130, 54, 'orchestrator-chat', '意图解析 + 上下文', true)}
      {arrow(262, 45, 282, 45, 'i2')}
      {box(282, 22, 100, 46, '丘脑 L1', 'Haiku 快速路由', true)}
      {arrow(382, 45, 402, 45, 'i3')}
      {box(402, 22, 90, 46, 'Brain', '决策层')}
      {cap(305, 105, '─── 节律路径 ───', '#4b5563', 8.5)}
      {box(10, 112, 100, 46, '定时器', '每5分钟触发')}
      {arrow(110, 135, 132, 135, 'i4')}
      {box(132, 108, 130, 54, 'Tick 心跳', '5s监测/5min执行', true)}
      {arrow(262, 135, 282, 135, 'i5')}
      {box(282, 112, 100, 46, 'executor', '调度 + 执行', true)}
      {arrow(382, 135, 402, 135, 'i6')}
      {box(402, 112, 90, 46, 'Claude', '/dev /qa /cecelia')}
      <line x1={505} y1={10} x2={505} y2={163} stroke="rgba(255,255,255,0.07)" strokeDasharray="3,3" />
      {cap(603, 55, '外界接口层', '#6b7280', 10)}
      {cap(603, 70, 'Brain 唯一入口', '#4b5563', 8.5)}
      {cap(603, 110, '实时 + 节律', '#6b7280', 10)}
      {cap(603, 125, '两通道并行', '#4b5563', 8.5)}
      {warnBox(10, 172, 680, 42, '⚠️  飞书断连 → 丢失所有用户意图信号  |  Tick 停止 → Brain 失去节律，任务全部暂停派发')}
    </svg>
  );

  // ── Chapter 2: 感知层（16 种信号）──────────────────────────────
  const gColors: string[] = ['#06b6d4', '#a78bfa', '#f59e0b', '#10b981'];
  const gNames: string[] = ['工作/任务', 'KR/目标', '用户/社交', '认知/欲望'];
  const perceptionSignals: Array<{ id: string; label: string; group: number }> = [
    { id: 'task_fail_rate_24h',    label: '24h任务失败率',   group: 0 },
    { id: 'queue_buildup',         label: '队列积压',         group: 0 },
    { id: 'repeated_failures',     label: '重复失败模式',     group: 0 },
    { id: 'task_completed_today',  label: '今日完成数',       group: 0 },
    { id: 'kr_stalled',            label: 'KR 停滞',          group: 1 },
    { id: 'kr_status_snapshot',    label: 'KR 状态快照',      group: 1 },
    { id: 'task_milestone',        label: '任务里程碑',       group: 1 },
    { id: 'learning_gap_signal',   label: '学习缺口',         group: 1 },
    { id: 'hours_since_feishu',    label: '飞书离线时长',     group: 2 },
    { id: 'user_online',           label: '用户在线状态',     group: 2 },
    { id: 'time_aware_greeting',   label: '时间感知问候',     group: 2 },
    { id: 'conversation_quality',  label: '对话质量',         group: 2 },
    { id: 'system_idle',           label: '系统空闲',         group: 3 },
    { id: 'undigested_knowledge',  label: '未消化知识',       group: 3 },
    { id: 'curiosity_accumulated', label: '好奇心积累',       group: 3 },
    { id: 'intellectual_idle',     label: '智识空闲',         group: 3 },
  ];
  const perceptionDiagram = (
    <svg viewBox="0 0 760 300" width="100%" {...(height ? { height } : {})}>
      {defs}
      {perceptionSignals.map((s, i) => {
        const col = s.group;
        const row = i % 4;
        const x = 8 + col * 128;
        const y = 38 + row * 28;
        return (
          <g key={s.id}>
            <rect x={x} y={y} width={114} height={21} rx={4}
              fill={`${gColors[col]}10`} stroke={`${gColors[col]}45`} strokeWidth={0.8} />
            <text x={x+57} y={y+13} textAnchor="middle" fill={gColors[col]} fontSize={9}>{s.label}</text>
          </g>
        );
      })}
      {gNames.map((name, gi) => (
        <text key={`gh-${gi}`} x={8 + gi*128 + 57} y={30} textAnchor="middle"
          fill={gColors[gi]} fontSize={8.5} fontWeight={700}>{name}</text>
      ))}
      {[0, 1, 2, 3].map(gi => (
        <rect key={`gbr-${gi}`} x={6 + gi*128} y={33} width={118} height={4*28+4}
          rx={4} fill="none" stroke={`${gColors[gi]}20`} strokeWidth={1} strokeDasharray="4,2" />
      ))}
      <line x1={520} y1={130} x2={540} y2={130}
        stroke={`${color}60`} strokeWidth={1.5} markerEnd={`url(#${mkId})`} />
      <rect x={542} y={82} width={90} height={96} rx={6}
        fill={`${color}15`} stroke={color} strokeWidth={1.5} />
      <text x={587} y={122} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>感知层</text>
      <text x={587} y={136} textAnchor="middle" fill="#9ca3af" fontSize={8.5}>汇总信号</text>
      <circle cx={587} cy={73} r={15} fill={`${color}18`} stroke={`${color}60`} strokeWidth={1.5} />
      <text x={587} y={70} textAnchor="middle" fill={color} fontSize={14} fontWeight={800}>16</text>
      <text x={587} y={81} textAnchor="middle" fill="#9ca3af" fontSize={7}>信号</text>
      <line x1={632} y1={100} x2={650} y2={100} stroke={`${color}60`} strokeWidth={1.5} markerEnd={`url(#${mkId})`} />
      <line x1={632} y1={130} x2={650} y2={130} stroke={`${color}60`} strokeWidth={1.5} markerEnd={`url(#${mkId})`} />
      <line x1={632} y1={160} x2={650} y2={160} stroke={`${color}60`} strokeWidth={1.5} markerEnd={`url(#${mkId})`} />
      {box(652, 84, 100, 32, '情绪状态', '焦虑/满足/平静')}
      {box(652, 114, 100, 32, '欲望触发', '好奇/探索/休息')}
      {box(652, 144, 100, 32, '认知快照', '决策输入')}
      {warnBox(8, 258, 744, 36, '⚠️ 信号缺失 = 感知盲区（飞书断连 → 丢失4个用户/社交信号，Brain 无法判断用户在线状态和需求）')}
    </svg>
  );

  // ── Chapter 3: 意识核心 ──────────────────────────────────────────
  const coreDiagram = (
    <svg viewBox="0 0 700 260" width="100%" {...(height ? { height } : {})}>
      {defs}
      {box(8, 85, 90, 90, '事件/信号', '感知层输出')}
      {arrow(98, 100, 120, 73, 'c1')}
      {arrow(98, 130, 120, 131, 'c2')}
      {arrow(98, 160, 120, 190, 'c3')}
      <rect x={120} y={52} width={130} height={42} rx={5}
        fill={`${color}18`} stroke={color} strokeWidth={1.5} />
      <text x={185} y={70} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>L0 脑干（代码）</text>
      <text x={185} y={84} textAnchor="middle" fill="#9ca3af" fontSize={9}>每次 Tick 必跑，无需 LLM</text>
      <text x={122} y={48} fill={color} fontSize={7.5} fontWeight={600}>✓ 总是执行</text>
      <rect x={120} y={110} width={130} height={42} rx={5}
        fill="rgba(167,139,250,0.15)" stroke="#a78bfa" strokeWidth={1.5} />
      <text x={185} y={128} textAnchor="middle" fill="#a78bfa" fontSize={11} fontWeight={700}>L1 丘脑（Haiku）</text>
      <text x={185} y={142} textAnchor="middle" fill="#9ca3af" fontSize={9}>事件路由、快速判断</text>
      <text x={122} y={106} fill="#a78bfa" fontSize={7.5} fontWeight={600}>有事件时触发</text>
      <rect x={120} y={168} width={130} height={42} rx={5}
        fill="rgba(107,114,128,0.12)" stroke="#6b7280" strokeWidth={1} />
      <text x={185} y={186} textAnchor="middle" fill="#9ca3af" fontSize={11} fontWeight={700}>L2 皮层（Sonnet）</text>
      <text x={185} y={200} textAnchor="middle" fill="#6b7280" fontSize={9}>深度分析 + RCA</text>
      <text x={122} y={164} fill="#6b7280" fontSize={7.5} fontWeight={600}>异常/复杂时触发</text>
      {arrow(250, 73, 285, 73, 'c4')}
      {arrow(250, 131, 285, 118, 'c5')}
      {arrow(250, 131, 285, 148, 'c6')}
      {arrow(250, 189, 285, 175, 'c7')}
      {box(285, 55, 120, 36, '脑干决策', '调度/执行/保护', true)}
      {box(285, 100, 120, 34, 'L1 路由结果', '事件分类 → 动作')}
      {box(285, 142, 120, 34, 'L2 深析结果', 'RCA + 战略调整')}
      {arrow(405, 73, 430, 105, 'c8')}
      {arrow(405, 117, 430, 118, 'c9')}
      {arrow(405, 159, 430, 131, 'c10')}
      {box(430, 88, 110, 56, '最终决策', '综合三层输出', true)}
      <line x1={540} y1={116} x2={680} y2={116} stroke={`${color}50`} strokeWidth={1.5} markerEnd={`url(#${mkId})`} />
      <text x={655} y={111} fill="#9ca3af" fontSize={9}>行动层</text>
      {warnBox(8, 222, 682, 32, '⚠️ LLM 超时 = 决策瘫痪（L1/L2 调用失败时 Brain 退化为纯 L0 代码模式，失去智能路由和分析能力）')}
    </svg>
  );

  // ── Chapter 4: 行动层 ──────────────────────────────────────────
  const actionDiagram = (
    <svg viewBox="0 0 720 290" width="100%" {...(height ? { height } : {})}>
      {defs}
      {box(8, 95, 80, 50, '任务队列', 'PostgreSQL')}
      {arrow(88, 120, 108, 120, 'a1')}
      {box(108, 88, 92, 64, '调度规划', 'KR轮转评分', true)}
      {arrow(200, 120, 220, 120, 'a2')}
      {box(220, 88, 92, 64, '资源检查', 'RSS/Swap/Seats', true)}
      {arrow(312, 120, 332, 120, 'a3')}
      {box(332, 88, 92, 64, 'Brain-Bridge', 'PORT:3457', true)}
      {arrow(424, 120, 444, 120, 'a4')}
      {box(444, 88, 100, 64, 'Claude Agent', 'claude -p /skill', true)}
      {arrow(544, 120, 564, 120, 'a5')}
      {box(564, 103, 72, 34, '执行回调', 'POST /api')}
      {cap(330, 62, 'Skill 白名单', '#6b7280', 8.5)}
      <line x1={108} y1={72} x2={544} y2={72} stroke="rgba(255,255,255,0.06)" />
      {['/dev', '/code-review', '/cecelia', '/research', '/decomp', '/qa'].map((sk, i) => (
        <g key={`sk-${sk}`}>
          <rect x={108+i*73} y={52} width={69} height={18} rx={3}
            fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" />
          <text x={142+i*73} y={64} textAnchor="middle" fill="#9ca3af" fontSize={8}>{sk}</text>
        </g>
      ))}
      {cap(330, 185, '保护机制', '#6b7280', 8.5)}
      {box(108, 192, 98, 34, 'MAX_SEATS', '并发上限控制')}
      {box(216, 192, 98, 34, '失败隔离', '超重试→隔离区')}
      {box(324, 192, 98, 34, '资源熔断', 'RSS超限停派')}
      {box(432, 192, 98, 34, '警觉系统', 'CALM→PANIC降速')}
      <line x1={157} y1={192} x2={157} y2={152} stroke="rgba(251,146,60,0.35)" strokeDasharray="3,2" />
      <line x1={265} y1={192} x2={265} y2={152} stroke="rgba(251,146,60,0.35)" strokeDasharray="3,2" />
      <line x1={373} y1={192} x2={373} y2={152} stroke="rgba(251,146,60,0.35)" strokeDasharray="3,2" />
      {warnBox(8, 238, 700, 44, '⚠️ Bridge 超时 = 任务积压（claude 进程启动失败时任务卡 in_progress，须等看门狗 watchdog 超时处理）')}
    </svg>
  );

  // ── Chapter 5: 自我演化 ──────────────────────────────────────────
  const evolutionDiagram = (
    <svg viewBox="0 0 680 270" width="100%" {...(height ? { height } : {})}>
      {defs}
      {box(8, 90, 80, 60, '任务结果', '成功 / 失败')}
      {arrow(88, 105, 112, 80, 'e1')}
      {arrow(88, 120, 112, 150, 'e2')}
      {box(112, 55, 120, 55, 'learning.js', '学习记录写入', true)}
      {box(112, 130, 120, 55, 'memory', 'L0/L1 记忆压缩', true)}
      {box(300, 55, 120, 55, 'self-model', '能力/偏好认知', true)}
      {box(300, 130, 120, 55, 'self-report', '内心独白/欲望', true)}
      {arrow(232, 82, 300, 82, 'e3')}
      {arrow(232, 157, 300, 157, 'e4')}
      {arrow(420, 82, 448, 106, 'e5')}
      {arrow(420, 157, 448, 127, 'e6')}
      {box(448, 95, 100, 60, '行为调整', '下轮决策优化', true)}
      {arrow(548, 125, 578, 125, 'e7')}
      {box(580, 108, 70, 34, '下一 Tick', 'Brain 决策')}
      <path d="M 615 108 Q 615 36 410 36 Q 212 36 60 36 Q 8 36 8 90"
        fill="none" stroke={`${color}45`} strokeWidth={1.5} strokeDasharray="5,3"
        markerEnd={`url(#${mkId})`} />
      {cap(340, 28, '学习循环：每次经历 → 行为优化', '#6b7280', 8.5)}
      {cap(172, 50, '任务完成触发', '#6b7280', 7.5)}
      {cap(172, 125, 'content_hash 去重', '#6b7280', 7.5)}
      {cap(360, 50, '6h 定期采集', '#6b7280', 7.5)}
      {cap(360, 125, 'fire-and-forget', '#6b7280', 7.5)}
      {warnBox(8, 228, 660, 36, '⚠️ 学习循环断裂 = 停止进化（content_hash 去重失效 / memory 写入失败 → 经验无法沉淀积累）')}
    </svg>
  );

  const diagrams: Record<string, React.ReactNode> = {
    interface: interfaceDiagram,
    perception: perceptionDiagram,
    core: coreDiagram,
    action: actionDiagram,
    evolution: evolutionDiagram,
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      borderRadius: 10,
      border: `1px solid ${color}20`,
      padding: '16px 12px',
    }}>
      {diagrams[blockId] || null}
    </div>
  );
}

interface ManualViewProps {
  manifest: ManifestData | null;
  subsystems: Subsystem[];
}

function ManualView({ manifest, subsystems }: ManualViewProps) {
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [detailChapter, setDetailChapter] = useState<string | null>(null);

  if (!manifest) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
        加载说明书数据中...
      </div>
    );
  }

  const generatedTime = manifest.generatedAt
    ? new Date(manifest.generatedAt).toLocaleString('zh-CN', { hour12: false })
    : '—';

  const allActions = manifest.allActions || {};
  const allSignals = manifest.allSignals || [];
  const allSkills = manifest.allSkills || {};

  const dangerousActions = Object.entries(allActions).filter(([, v]) => v.dangerous);
  const safeActions = Object.entries(allActions).filter(([, v]) => !v.dangerous);

  const CHAPTER_ICONS: string[] = ['📡', '👁️', '🧠', '⚡', '🌱'];

  // ── 沉浸式章节详情视图 ──
  if (detailChapter !== null) {
    const detailIdx = manifest.blocks.findIndex(b => b.id === detailChapter);
    const detailBlock = detailIdx >= 0 ? manifest.blocks[detailIdx] : null;
    if (detailBlock) {
      const chNum = detailIdx + 1;
      const chIcon = CHAPTER_ICONS[detailIdx] || '📋';
      const ed = CHAPTER_EDITORIAL[detailBlock.id];

      return (
        <div style={{
          maxWidth: 900, margin: '0 auto', padding: '0 4px 60px',
          fontFamily: '"Inter", system-ui, sans-serif',
          animation: 'manualFadeIn 0.22s ease',
        }}>
          {/* ── 顶部导航栏 ── */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 20px',
            background: 'rgba(10,14,22,0.92)',
            backdropFilter: 'blur(12px)',
            borderBottom: `1px solid ${detailBlock.color}30`,
            marginBottom: 28,
          }}>
            <button
              onClick={() => setDetailChapter(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: '#9ca3af', fontSize: 13, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f3f4f6'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.24)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
            >
              ← 说明书
            </button>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16 }}>/</span>
            <span style={{
              fontSize: 11, color: '#6b7280', fontFamily: 'monospace',
              background: `${detailBlock.color}18`, padding: '3px 10px', borderRadius: 4,
            }}>
              第 {chNum} 章
            </span>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{chIcon}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: detailBlock.color }}>
              {detailBlock.label}
            </span>
          </div>

          {/* ── SVG 配图（全宽 420px）── */}
          <div style={{
            borderRadius: 16,
            border: `1px solid ${detailBlock.color}25`,
            background: 'rgba(255,255,255,0.015)',
            padding: '20px 16px',
            marginBottom: 32,
          }}>
            <ChapterDiagram blockId={detailBlock.id} color={detailBlock.color} height={420} />
          </div>

          {/* ── 职责描述 ── */}
          {ed && (
            <p style={{
              color: '#d1d5db', fontSize: 16, lineHeight: 1.9,
              margin: '0 0 36px', maxWidth: 820,
              padding: '0 4px',
            }}>
              {ed.role || detailBlock.desc}
            </p>
          )}

          {/* ── 模块列表 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {detailBlock.modules.map((mod, modIdx) => {
              const subsystem = subsystems.find(s => s.id === mod.id);
              const todayCount = subsystem?.metrics.today_count;
              const status = subsystem?.status || 'dormant';
              const sc = STATUS_COLORS[status];
              const natureBadge = mod.nature ? NATURE_BADGE[mod.nature] : '';
              const fullDesc = ed?.modules[mod.id]?.full;
              const showActions = mod.id === 'thalamus' && Object.keys(allActions).length > 0;
              const showSignals = mod.id === 'perception_signals' && allSignals.length > 0;
              const showSkills = mod.id === 'executor' && Object.keys(allSkills).length > 0;

              return (
                <div key={mod.id} style={{
                  paddingLeft: 20,
                  borderLeft: `3px solid ${detailBlock.color}40`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      display: 'inline-block', width: 9, height: 9,
                      borderRadius: '50%', background: sc, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb' }}>
                      {chNum}.{modIdx + 1} &nbsp;{mod.label}
                    </span>
                    {natureBadge && <span style={{ fontSize: 14 }}>{natureBadge}</span>}
                    {todayCount !== null && todayCount !== undefined && (
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
                        今日 {todayCount.toLocaleString()} 次
                      </span>
                    )}
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontFamily: 'monospace', fontSize: 11,
                    color: '#60a5fa', background: 'rgba(96,165,250,0.06)',
                    padding: '3px 10px', borderRadius: 5,
                    border: '1px solid rgba(96,165,250,0.15)',
                    marginBottom: 12,
                  }}>
                    📄 src/{mod.file}
                  </div>
                  <p style={{ color: '#9ca3af', fontSize: 14, lineHeight: 1.85, margin: '0 0 14px' }}>
                    {fullDesc || mod.desc}
                  </p>
                  {showActions && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#d1d5db', marginBottom: 8 }}>
                        ⚡ 动作白名单 <span style={{ color: '#6b7280', fontWeight: 400 }}>({Object.keys(allActions).length} 条)</span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#6b7280', fontWeight: 500, width: '30%' }}>动作名</th>
                            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#6b7280', fontWeight: 500, width: '10%' }}>危险</th>
                            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#6b7280', fontWeight: 500 }}>描述</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(allActions).map(([name, info]) => (
                            <tr key={name} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: info.dangerous ? '#fca5a5' : '#a5f3fc' }}>{name}</td>
                              <td style={{ padding: '5px 10px', color: info.dangerous ? '#ef4444' : '#4b5563' }}>{info.dangerous ? '⚠️ 是' : '—'}</td>
                              <td style={{ padding: '5px 10px', color: '#9ca3af' }}>{info.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {showSignals && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#d1d5db', marginBottom: 8 }}>
                        📡 信号列表 <span style={{ color: '#6b7280', fontWeight: 400 }}>({allSignals.length} 个)</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {allSignals.map(sig => (
                          <span key={sig} style={{
                            fontFamily: 'monospace', fontSize: 11,
                            color: '#a5b4fc', background: 'rgba(165,180,252,0.08)',
                            padding: '3px 8px', borderRadius: 4,
                            border: '1px solid rgba(165,180,252,0.2)',
                          }}>
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {showSkills && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#d1d5db', marginBottom: 8 }}>
                        🎯 技能映射 <span style={{ color: '#6b7280', fontWeight: 400 }}>({Object.keys(allSkills).length} 条)</span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#6b7280', fontWeight: 500, width: '40%' }}>任务类型</th>
                            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#6b7280', fontWeight: 500 }}>Skill</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(allSkills).map(([taskType, skill]) => (
                            <tr key={taskType} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#fcd34d' }}>{taskType}</td>
                              <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: skill ? '#86efac' : '#4b5563' }}>
                                {skill || '（无 skill，仅标记）'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }

  return (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 4px 60px',
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      <style>{`@keyframes manualFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {/* ── 书籍标题页 ── */}
      <div style={{
        textAlign: 'center', padding: '36px 24px 28px',
        borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 40,
      }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: '#f3f4f6', letterSpacing: '-0.5px' }}>
          🧠 Brain 系统说明书
        </div>
        <div style={{ color: '#6b7280', fontSize: 12, marginTop: 10 }}>
          自动生成于 {generatedTime} · {manifest.blocks.length} 章 · {Object.keys(allActions).length} 条动作白名单 · {allSignals.length} 个信号
        </div>
        <div style={{
          color: '#9ca3af', fontSize: 13, lineHeight: 1.7,
          maxWidth: 520, margin: '14px auto 0',
          padding: '14px 20px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          本文档由代码自动生成，是 Brain 系统的「活说明书」。代码是唯一真实源，说明书与代码实时同步。
        </div>
      </div>

      {/* ── 目录 ── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          目 录
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {manifest.blocks.map((block, idx) => (
            <div
              key={block.id}
              onClick={() => setDetailChapter(block.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', borderRadius: 6, padding: '3px 6px', transition: 'background 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 11, color: '#4b5563', fontFamily: 'monospace', minWidth: 40 }}>第 {idx + 1} 章</span>
              <span style={{ flex: 1, borderBottom: '1px dotted rgba(255,255,255,0.06)', margin: '0 8px' }} />
              <span style={{ fontSize: 14, color: block.color, fontWeight: 600 }}>
                {CHAPTER_ICONS[idx] || '📋'} {block.label}
              </span>
              <span style={{ fontSize: 11, color: '#4b5563' }}>({block.modules.length} 个模块)</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#4b5563', fontFamily: 'monospace', minWidth: 40 }}>附录</span>
            <span style={{ flex: 1, borderBottom: '1px dotted rgba(255,255,255,0.06)', margin: '0 8px' }} />
            <span style={{ fontSize: 14, color: '#9ca3af', fontWeight: 600 }}>完整动作、信号、技能索引</span>
          </div>
        </div>
      </div>

      {/* ── 各章节（手风琴） ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 48 }}>
      {manifest.blocks.map((block, chIdx) => {
        const chapterNum = chIdx + 1;
        const chapterIcon = CHAPTER_ICONS[chIdx] || '📋';
        const editorial = CHAPTER_EDITORIAL[block.id];
        const isOpen = openChapter === block.id;

        return (
          <div key={block.id} style={{
            border: `1px solid rgba(255,255,255,0.08)`,
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            {/* ── 卡片头部（点击进入沉浸式章节视图） ── */}
            <button
              onClick={() => setDetailChapter(block.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 16,
                padding: '20px 24px', cursor: 'pointer',
                background: 'transparent',
                border: 'none', textAlign: 'left',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${block.color}08`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span style={{
                fontSize: 11, color: '#6b7280', fontFamily: 'monospace',
                background: `${block.color}15`, padding: '3px 10px', borderRadius: 4,
                flexShrink: 0, whiteSpace: 'nowrap',
              }}>
                第 {chapterNum} 章
              </span>
              <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{chapterIcon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: block.color, lineHeight: 1.2 }}>
                  {block.label}
                </div>
                {editorial && (
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 5, fontStyle: 'italic' }}>
                    {editorial.analogy}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 12, color: '#4b5563', flexShrink: 0 }}>
                {block.modules.length} 个模块
              </span>
              <span style={{ fontSize: 14, color: '#4b5563', display: 'inline-block', flexShrink: 0 }}>
                →
              </span>
            </button>
          </div>
        );
      })}
      </div>

      {/* ── 附录 ── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: 32, marginTop: 16,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#d1d5db', marginBottom: 24 }}>
          📎 附录：完整索引
        </div>

        {/* 附录 A：危险动作 */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 10 }}>
            附录 A · 危险动作 ({dangerousActions.length} 条)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {dangerousActions.map(([name]) => (
              <span key={name} style={{
                fontFamily: 'monospace', fontSize: 11,
                color: '#fca5a5', background: 'rgba(252,165,165,0.06)',
                padding: '3px 8px', borderRadius: 4,
                border: '1px solid rgba(252,165,165,0.2)',
              }}>
                ⚠️ {name}
              </span>
            ))}
          </div>
        </div>

        {/* 附录 B：安全动作 */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a5f3fc', marginBottom: 10 }}>
            附录 B · 安全动作 ({safeActions.length} 条)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {safeActions.map(([name]) => (
              <span key={name} style={{
                fontFamily: 'monospace', fontSize: 11,
                color: '#a5f3fc', background: 'rgba(165,243,252,0.04)',
                padding: '3px 8px', borderRadius: 4,
                border: '1px solid rgba(165,243,252,0.12)',
              }}>
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* 附录 C：所有信号 */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a5b4fc', marginBottom: 10 }}>
            附录 C · 所有感知信号 ({allSignals.length} 个)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allSignals.map(sig => (
              <span key={sig} style={{
                fontFamily: 'monospace', fontSize: 11,
                color: '#a5b4fc', background: 'rgba(165,180,252,0.06)',
                padding: '3px 8px', borderRadius: 4,
                border: '1px solid rgba(165,180,252,0.15)',
              }}>
                {sig}
              </span>
            ))}
          </div>
        </div>

        {/* 附录 D：技能 WHITELIST */}
        {manifest.skillWhitelist && Object.keys(manifest.skillWhitelist).length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#86efac', marginBottom: 10 }}>
              附录 D · Skill 白名单 ({Object.keys(manifest.skillWhitelist).length} 条)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.keys(manifest.skillWhitelist).map(skill => (
                <span key={skill} style={{
                  fontFamily: 'monospace', fontSize: 11,
                  color: '#86efac', background: 'rgba(134,239,172,0.06)',
                  padding: '3px 8px', borderRadius: 4,
                  border: '1px solid rgba(134,239,172,0.15)',
                }}>
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
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
  const [viewLevel, setViewLevel] = useState<'overview' | 'detail' | 'manual'>('overview');
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
          {(viewLevel === 'detail' || viewLevel === 'manual') && (
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
            {(['overview', 'detail', 'manual'] as const).map(level => (
              <button key={level}
                onClick={() => { setViewLevel(level); setSelected(null); }}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: viewLevel === level ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: viewLevel === level ? '#f3f4f6' : '#6b7280',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                {level === 'overview' ? '概览' : level === 'detail' ? '详情' : '📖 说明书'}
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

      {/* ── Level 3: 说明书 ── */}
      {viewLevel === 'manual' && (
        <ManualView manifest={manifest} subsystems={data?.subsystems || []} />
      )}
    </div>
  );
}
