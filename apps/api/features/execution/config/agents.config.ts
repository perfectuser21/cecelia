// Cecelia Agent 配置

export interface CeceliaAgent {
  id: string;
  name: string;
  codename: string;
  icon: string;
  role: string;
  description: string;
  workflowKeywords: string[];
  status: 'active' | 'standby' | 'planned';
  gradient: {
    from: string;
    to: string;
    border: string;
  };
}

export const CECELIA_AGENTS: CeceliaAgent[] = [
  {
    id: 'spark',
    name: 'Spark',
    codename: '点燃执行',
    icon: 'Zap',
    role: '执行者',
    description: '解析 PRD 文档，拆解 Checkpoints，调用 Claude Code 执行代码任务',
    workflowKeywords: ['PRD Executor', 'prd-executor', 'Execute', 'Cecelia'],
    status: 'active',
    gradient: {
      from: 'from-blue-500',
      to: 'to-cyan-500',
      border: 'border-blue-500/30',
    },
  },
  {
    id: 'echo',
    name: 'Echo',
    codename: '协调反馈',
    icon: 'RefreshCw',
    role: '协调者',
    description: '监控执行状态，处理多阶段任务，分析结果并创建下一阶段',
    workflowKeywords: ['Coordinator', 'coordinator', 'Multi-stage', 'Callback'],
    status: 'active',
    gradient: {
      from: 'from-emerald-500',
      to: 'to-teal-500',
      border: 'border-emerald-500/30',
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    codename: '多维分析',
    icon: 'Diamond',
    role: '分析者',
    description: '多维度分析执行结果，提供智能决策建议',
    workflowKeywords: ['Analyzer', 'Analysis', 'Report'],
    status: 'planned',
    gradient: {
      from: 'from-violet-500',
      to: 'to-purple-500',
      border: 'border-violet-500/30',
    },
  },
];

export function getAgentById(id: string): CeceliaAgent | undefined {
  return CECELIA_AGENTS.find((agent) => agent.id === id);
}

export function matchAgentByWorkflow(workflowName: string): CeceliaAgent | null {
  for (const agent of CECELIA_AGENTS) {
    for (const keyword of agent.workflowKeywords) {
      if (workflowName.toLowerCase().includes(keyword.toLowerCase())) {
        return agent;
      }
    }
  }
  return null;
}
