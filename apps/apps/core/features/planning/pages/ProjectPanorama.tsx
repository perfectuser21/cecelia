import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, X, Menu, Maximize, RefreshCw, Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://dashboard.zenjoymedia.media';

interface WorkflowNode {
  id: string;
  x: number;
  y: number;
  name: string;
  type: 'trigger' | 'action' | 'logic' | 'output';
  input?: string;
  output?: string;
  logic?: string;
}

interface WorkflowEdge {
  from: string;
  to: string;
}

interface ArchNode {
  id: string;
  x: number;
  y: number;
  name: string;
  desc?: string;
  status: 'completed' | 'in_progress' | 'not_started';
  type: 'core' | 'product' | 'dashboard' | 'feature' | 'workflow';
  hasChildren?: boolean;
  version?: string;
  current?: boolean;
}

interface ArchEdge {
  from: string;
  to: string;
}

interface Milestone {
  date: string;
  label: string;
}

interface LayerData {
  title: string;
  subtitle?: string;
  version?: string;
  scriptPath?: string;
  isLeaf?: boolean;
  milestones?: Milestone[];
  nodes?: ArchNode[];
  edges?: ArchEdge[];
  workflowNodes?: WorkflowNode[];
  workflowEdges?: WorkflowEdge[];
}

const nodeTypeLabels: Record<string, string> = { trigger: '触发器', action: '动作', logic: '逻辑', output: '输出' };

const typeDescriptions: Record<string, string> = {
  core: '核心系统',
  product: '产品模块',
  dashboard: '前端界面',
  feature: '功能模块',
  workflow: 'n8n 工作流',
  service: 'Docker 服务',
  project: '项目',
};

// 数据
const allData: Record<string, LayerData> = {
  'root': {
    title: '全景图',
    subtitle: '项目整体架构',
    nodes: [
      { id: 'core', x: 100, y: 140, name: 'Autopilot Core', desc: '开发内核', status: 'in_progress', type: 'core', hasChildren: true },
      { id: 'product', x: 300, y: 140, name: 'ZenithJoy Autopilot', desc: '产品', status: 'in_progress', type: 'product', hasChildren: true },
      { id: 'dashboard', x: 520, y: 50, name: 'Dashboard', desc: '前端', status: 'in_progress', type: 'dashboard', hasChildren: true },
      { id: 'task-queue', x: 520, y: 120, name: '任务队列', desc: '查看任务', status: 'not_started', type: 'dashboard' },
      { id: 'content-publish', x: 520, y: 210, name: 'Content Publish', desc: '9平台', status: 'not_started', type: 'feature', hasChildren: true },
      { id: 'data-collection', x: 520, y: 280, name: 'Data Collection', desc: '6平台', status: 'not_started', type: 'feature', hasChildren: true },
      { id: 'monitor', x: 520, y: 350, name: 'Monitor', desc: '监控', status: 'not_started', type: 'feature', hasChildren: true },
    ],
    edges: [
      { from: 'core', to: 'product' },
      { from: 'product', to: 'dashboard' },
      { from: 'product', to: 'task-queue' },
      { from: 'product', to: 'content-publish' },
      { from: 'product', to: 'data-collection' },
      { from: 'product', to: 'monitor' },
    ],
  },

  'core': {
    title: 'Autopilot Core',
    subtitle: '开发内核',
    version: 'v1.4',
    milestones: [
      { date: '1/10', label: 'Core v2.0 - 24h稳定运行' },
      { date: '2/15', label: 'Core v3.0 - 生物自愈系统' },
    ],
    nodes: [
      { id: 'task-dispatcher', x: 60, y: 80, name: 'Task Dispatcher', desc: '调度', status: 'completed', type: 'core', hasChildren: true, version: 'v2.0' },
      { id: 'executor', x: 60, y: 170, name: 'Executor', desc: '执行', status: 'completed', type: 'core', hasChildren: true, version: 'v2.0' },
      { id: 'completion-sync', x: 240, y: 125, name: 'Completion Sync', desc: '同步', status: 'in_progress', type: 'core', hasChildren: true, version: 'v1.4', current: true },
      { id: 'feature-validator', x: 420, y: 80, name: 'Feature Validator', desc: '验证', status: 'not_started', type: 'core', version: 'v1.5' },
      { id: 'quality-check', x: 420, y: 170, name: 'Quality Check', desc: '质检', status: 'not_started', type: 'core', version: 'v1.5' },
      { id: 'auto-repair', x: 600, y: 125, name: 'Auto Repair', desc: '自愈', status: 'not_started', type: 'core', version: 'v3.0' },
    ],
    edges: [
      { from: 'task-dispatcher', to: 'completion-sync' },
      { from: 'executor', to: 'completion-sync' },
      { from: 'completion-sync', to: 'feature-validator' },
      { from: 'completion-sync', to: 'quality-check' },
      { from: 'feature-validator', to: 'auto-repair' },
      { from: 'quality-check', to: 'auto-repair' },
    ],
  },

  'task-dispatcher': {
    title: 'Task Dispatcher',
    subtitle: '任务调度器',
    version: 'v2.0',
    nodes: [
      { id: 'td-poll', x: 60, y: 100, name: 'Notion 轮询', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'td-depend', x: 220, y: 60, name: '依赖检查', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'td-parallel', x: 220, y: 140, name: '并行控制', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'td-assign', x: 380, y: 100, name: '任务分配', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
    ],
    edges: [
      { from: 'td-poll', to: 'td-depend' },
      { from: 'td-poll', to: 'td-parallel' },
      { from: 'td-depend', to: 'td-assign' },
      { from: 'td-parallel', to: 'td-assign' },
    ],
  },

  'td-poll': {
    title: 'Notion 轮询',
    subtitle: '每5分钟检查一次有没有新任务',
    scriptPath: '/dispatcher/poll.sh',
    isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '定时启动', type: 'trigger', input: '无', output: '启动信号', logic: '每 5 分钟自动启动一次\n\n就像闹钟一样，定时响\n不管有没有任务都会响' },
      { id: 'n2', x: 220, y: 100, name: '去 Notion 找任务', type: 'action', input: '启动信号', output: '任务清单', logic: '去 Notion 的 Tasks 数据库找任务\n\n找的条件：\n1. 状态是 "Next Action"（准备好要做的）\n2. 勾选了 "AI Task"（是 AI 要做的）\n3. 属于 "AI Systems" 这个 Area\n\n时间早的排前面' },
      { id: 'n3', x: 390, y: 100, name: '过滤掉记录类', type: 'logic', input: '任务清单', output: '编程任务清单', logic: '只保留真正要执行的任务：\n✓ Workflow 类型\n✓ Backend 类型\n✓ Frontend 类型\n\n过滤掉 AI Assist 类型\n因为那是"已经做完的记录"\n不是"要去做的任务"' },
      { id: 'n4', x: 560, y: 100, name: '给每个任务编号', type: 'logic', input: '编程任务清单', output: '带编号的任务', logic: '给每个任务一个唯一编号\n\n这个编号叫 run_id\n后面用来追踪这个任务的执行情况' },
      { id: 'n5', x: 730, y: 100, name: '发给下一步', type: 'output', input: '带编号的任务', output: '→ 依赖检查 + 并行控制', logic: '同时发给两个检查：\n\n1. 依赖检查 - 看前置任务做完没\n2. 并行控制 - 看还有没有空位\n\n两个都通过才能执行' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },

  'td-depend': {
    title: '依赖检查',
    subtitle: '检查前置任务有没有做完',
    scriptPath: '/dispatcher/depend.sh',
    isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '一个任务', logic: '从轮询那边收到任务\n一次检查一个' },
      { id: 'n2', x: 200, y: 100, name: '看 Blocked by', type: 'action', input: '一个任务', output: '依赖列表', logic: '看任务的 "Blocked by" 字段\n\n这个字段关联了"必须先做完"的任务\n比如：任务B 必须等 任务A 做完' },
      { id: 'n3', x: 370, y: 50, name: '检查任务依赖', type: 'logic', input: '依赖列表', output: '是否满足', logic: '检查每个依赖的任务：\n它的状态是不是 "Completed"？\n\n全部都完成了 → ✓ 通过\n有任何一个没完成 → ✗ 不通过' },
      { id: 'n4', x: 370, y: 150, name: '检查项目依赖', type: 'logic', input: '一个任务', output: '是否满足', logic: '检查任务所属项目的依赖：\n依赖的项目是不是都完成了？\n\n这是更高层级的依赖\n比如：B项目 必须等 A项目 做完' },
      { id: 'n5', x: 540, y: 100, name: '综合判断', type: 'logic', input: '两个检查结果', output: '能不能执行', logic: '两个检查都通过 → 可以执行\n任何一个不通过 → 不能执行，等下次' },
      { id: 'n6', x: 710, y: 100, name: '告诉下一步', type: 'output', input: '能不能执行', output: '→ 任务分配', logic: '能执行 → 发给任务分配\n不能执行 → 跳过，等下一轮检查' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n2', to: 'n4' }, { from: 'n3', to: 'n5' }, { from: 'n4', to: 'n5' }, { from: 'n5', to: 'n6' }],
  },

  'td-parallel': {
    title: '并行控制',
    subtitle: '控制同时执行的任务数量',
    scriptPath: '/dispatcher/parallel.sh',
    isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '任务清单', logic: '从轮询那边收到任务\n可能是多个' },
      { id: 'n2', x: 200, y: 100, name: '数一下正在跑的', type: 'action', input: '任务清单', output: '各类型数量', logic: '去 Notion 数一下：\n现在有几个任务正在执行？\n\n按类型分开数：\nWorkflow: 2个在跑\nBackend: 1个在跑\nFrontend: 0个在跑' },
      { id: 'n3', x: 390, y: 100, name: '算还有几个空位', type: 'logic', input: '各类型数量', output: '各类型空位', logic: '⚠️ 重要规则：\n\nWorkflow: 最多同时跑 3 个\nBackend: 最多同时跑 2 个\nFrontend: 最多同时跑 1 个\n\n空位 = 上限 - 正在跑的\n\n比如 Workflow: 3-2 = 还能跑 1 个' },
      { id: 'n4', x: 580, y: 100, name: '选出能跑的', type: 'logic', input: '任务 + 空位', output: '能执行的任务', logic: '每种类型只选"空位数"个任务\n时间早的优先\n\n比如 Workflow 有5个等着：\n但只有1个空位\n→ 只选时间最早的那1个\n→ 其他4个下次再说' },
      { id: 'n5', x: 770, y: 100, name: '发给下一步', type: 'output', input: '能执行的任务', output: '→ 任务分配', logic: '把选出来的任务发给任务分配\n没被选中的下次轮询再处理' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },

  'td-assign': {
    title: '任务分配',
    subtitle: '把任务分配给对应的执行器',
    scriptPath: '/dispatcher/assign.sh',
    isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '一个任务', logic: '收到通过了检查的任务\n这些任务可以开始执行了' },
      { id: 'n2', x: 200, y: 100, name: '看是什么类型', type: 'logic', input: '一个任务', output: '类型', logic: '看任务的 Coding Type：\n\nWorkflow → 发给 Workflow 执行器\nBackend → 发给 Backend 执行器\nFrontend → 发给 Frontend 执行器' },
      { id: 'n3', x: 370, y: 50, name: 'Workflow 执行器', type: 'action', input: 'Workflow 任务', output: '已发送', logic: '把任务发给 Workflow 执行器\n\n它会：\n1. 读懂任务内容\n2. 生成 n8n 工作流\n3. 做完了回报结果' },
      { id: 'n4', x: 370, y: 100, name: 'Backend 执行器', type: 'action', input: 'Backend 任务', output: '已发送', logic: '把任务发给 Backend 执行器\n\n它会：\n1. 读懂任务内容\n2. 写后端代码\n3. 跑测试\n4. 做完了回报结果' },
      { id: 'n5', x: 370, y: 150, name: 'Frontend 执行器', type: 'action', input: 'Frontend 任务', output: '已发送', logic: '把任务发给 Frontend 执行器\n\n它会：\n1. 读懂任务内容\n2. 写前端代码\n3. 做完了回报结果' },
      { id: 'n6', x: 560, y: 100, name: '更新 Notion', type: 'action', input: '已发送', output: '完成', logic: '更新 Notion 里的状态：\n\n状态改成 "In Progress"\n填上任务编号 run_id\n\n这样下次轮询就不会重复处理' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n2', to: 'n4' }, { from: 'n2', to: 'n5' }, { from: 'n3', to: 'n6' }, { from: 'n4', to: 'n6' }, { from: 'n5', to: 'n6' }],
  },

  'executor': {
    title: 'Executor',
    subtitle: '执行器',
    version: 'v2.0',
    nodes: [
      { id: 'exec-workflow', x: 60, y: 60, name: 'Workflow 执行器', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'exec-backend', x: 60, y: 140, name: 'Backend 执行器', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'exec-frontend', x: 260, y: 60, name: 'Frontend 执行器', desc: 'n8n workflow', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'exec-check', x: 260, y: 140, name: 'Check 执行器', desc: 'n8n workflow', status: 'in_progress', type: 'workflow', hasChildren: true, current: true },
    ],
    edges: [],
  },

  'exec-backend': {
    title: 'Backend 执行器', subtitle: '执行后端开发任务', scriptPath: '/executor/backend.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '任务内容', logic: '收到后端开发任务\n任务内容是 Markdown 格式' },
      { id: 'n2', x: 200, y: 100, name: '理解任务', type: 'logic', input: '任务内容', output: '任务要求', logic: '从任务内容里提取：\n\n1. 要做什么（任务目标）\n2. 具体要求是什么\n3. 怎么算做完（验收标准）' },
      { id: 'n3', x: 370, y: 100, name: '让 AI 写代码', type: 'action', input: '任务要求', output: 'AI 在跑', logic: '在服务器上启动 Claude Code\n\nClaude 会：\n1. 理解要求\n2. 写后端代码\n3. 写测试代码\n\n这一步是后台运行的\n启动后就不用等了' },
      { id: 'n4', x: 540, y: 60, name: '跑测试', type: 'logic', input: '代码写完', output: '测试结果', logic: 'Claude 写完代码后会自动跑测试：\n\n1. 检查代码规范 ✓/✗\n2. 检查类型对不对 ✓/✗\n3. 跑测试用例 ✓/✗\n\n全部通过 = 成功\n任何一个失败 = 失败' },
      { id: 'n5', x: 540, y: 140, name: '保存日志', type: 'action', input: '执行过程', output: '日志文件', logic: '把执行过程保存下来\n\n方便你以后查看：\n- 做了什么\n- 改了哪些文件\n- 有没有报错' },
      { id: 'n6', x: 710, y: 100, name: '汇报结果', type: 'output', input: '测试结果 + 日志', output: '→ Completion Sync', logic: '把结果告诉 Completion Sync：\n\n成功 → 状态改成 Waiting，等你验收\n失败 → 状态改成 AI Failed，需要处理' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n3', to: 'n5' }, { from: 'n4', to: 'n6' }, { from: 'n5', to: 'n6' }],
  },

  'exec-frontend': {
    title: 'Frontend 执行器', subtitle: '执行前端开发任务', scriptPath: '/executor/frontend.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '任务内容', logic: '收到前端开发任务' },
      { id: 'n2', x: 200, y: 100, name: '理解任务', type: 'logic', input: '任务内容', output: '任务要求', logic: '提取：\n1. 要做什么页面/组件\n2. 长什么样\n3. 验收标准' },
      { id: 'n3', x: 370, y: 100, name: '让 AI 写代码', type: 'action', input: '任务要求', output: 'AI 在跑', logic: 'Claude 会：\n1. 写 React 组件\n2. 写样式\n3. 更新路由（如需要）' },
      { id: 'n4', x: 540, y: 60, name: '检查能不能编译', type: 'logic', input: '代码写完', output: '编译结果', logic: '检查：\n1. 能不能编译成功\n2. 代码规范对不对\n3. 类型对不对' },
      { id: 'n5', x: 540, y: 140, name: '保存日志', type: 'action', input: '执行过程', output: '日志文件', logic: '保存执行过程' },
      { id: 'n6', x: 710, y: 100, name: '汇报结果', type: 'output', input: '结果', output: '→ Completion Sync', logic: '成功 → Waiting\n失败 → AI Failed' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n3', to: 'n5' }, { from: 'n4', to: 'n6' }, { from: 'n5', to: 'n6' }],
  },

  'exec-workflow': {
    title: 'Workflow 执行器', subtitle: '执行 n8n 工作流开发任务', scriptPath: '/executor/workflow.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '任务内容', logic: '收到 Workflow 开发任务' },
      { id: 'n2', x: 200, y: 100, name: '理解任务', type: 'logic', input: '任务内容', output: '任务要求', logic: '提取：\n1. 要做什么工作流\n2. 触发条件是什么\n3. 有哪些步骤' },
      { id: 'n3', x: 370, y: 100, name: '让 AI 生成', type: 'action', input: '任务要求', output: 'AI 在跑', logic: 'Claude 会：\n1. 生成 n8n 工作流\n2. 导入到 n8n\n3. 验证连接正确' },
      { id: 'n4', x: 540, y: 100, name: '8项质检', type: 'logic', input: '工作流', output: '质检结果', logic: '8项检查：\n1. 工作流存在\n2. 评分达标\n3. 没有敏感信息\n4. 连接正常\n...' },
      { id: 'n5', x: 710, y: 100, name: '汇报结果', type: 'output', input: '质检结果', output: '→ Completion Sync', logic: '通过 → Waiting\n不通过 → AI Failed' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },

  'exec-check': {
    title: 'Check 执行器', subtitle: '验证整个 Feature 是否完成', scriptPath: '/executor/check.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到任务', type: 'trigger', input: '无', output: '任务内容', logic: '收到 Feature 验证任务' },
      { id: 'n2', x: 200, y: 100, name: '找到所有子任务', type: 'action', input: 'Feature ID', output: '子任务列表', logic: '找出这个 Feature 下的所有任务\n确认都已经完成' },
      { id: 'n3', x: 370, y: 100, name: '跑完整测试', type: 'action', input: '子任务列表', output: '测试结果', logic: '跑整个 Feature 的测试：\n1. 单元测试\n2. 集成测试\n3. 端到端测试' },
      { id: 'n4', x: 540, y: 100, name: '验证结果', type: 'logic', input: '测试结果', output: '是否通过', logic: '检查：\n✓ 所有测试通过\n✓ 覆盖率达标\n✓ 没有错误' },
      { id: 'n5', x: 710, y: 100, name: '汇报结果', type: 'output', input: '验证结果', output: '→ Completion Sync', logic: '通过 → 整个 Feature 完成\n不通过 → 需要修复' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },

  'completion-sync': {
    title: 'Completion Sync', subtitle: '把执行结果同步回 Notion', version: 'v1.4',
    milestones: [{ date: '1/5', label: 'v1.5 - 飞书通知' }],
    nodes: [
      { id: 'cs-webhook', x: 60, y: 100, name: 'Webhook 接收', desc: '', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'cs-status', x: 220, y: 60, name: '状态更新', desc: '', status: 'completed', type: 'workflow', hasChildren: true },
      { id: 'cs-log', x: 220, y: 140, name: '日志写入', desc: '', status: 'in_progress', type: 'workflow', hasChildren: true, current: true },
      { id: 'cs-notify', x: 380, y: 100, name: '通知', desc: '', status: 'not_started', type: 'workflow' },
    ],
    edges: [{ from: 'cs-webhook', to: 'cs-status' }, { from: 'cs-webhook', to: 'cs-log' }, { from: 'cs-status', to: 'cs-notify' }, { from: 'cs-log', to: 'cs-notify' }],
  },

  'cs-webhook': { title: 'Webhook 接收', subtitle: '接收执行器的结果', scriptPath: '/completion/webhook.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '等待结果', type: 'trigger', input: '无', output: '执行结果', logic: '等待执行器完成后发来结果' },
      { id: 'n2', x: 220, y: 100, name: '验证来源', type: 'logic', input: '执行结果', output: '验证后的结果', logic: '确认是我们的执行器发来的\n不是别人伪造的' },
      { id: 'n3', x: 410, y: 100, name: '解析内容', type: 'logic', input: '验证后的结果', output: '解析后的数据', logic: '提取：\n- 任务ID\n- 成功还是失败\n- 测试结果\n- 日志位置' },
      { id: 'n4', x: 600, y: 100, name: '分发处理', type: 'output', input: '解析后的数据', output: '→ 状态更新 + 日志', logic: '同时发给：\n1. 状态更新 - 改 Notion\n2. 日志写入 - 保存文件' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },

  'cs-status': { title: '状态更新', subtitle: '更新 Notion 里的任务状态', scriptPath: '/completion/status.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到结果', type: 'trigger', input: '无', output: '执行结果', logic: '从 Webhook 那边收到结果' },
      { id: 'n2', x: 200, y: 100, name: '判断成败', type: 'logic', input: '执行结果', output: '成功/失败', logic: '看 status 是 success 还是 failed' },
      { id: 'n3', x: 370, y: 60, name: '成功处理', type: 'action', input: '成功', output: 'Waiting', logic: '状态改成 Waiting\n\n意思是：\nAI 做完了，等你验收' },
      { id: 'n4', x: 370, y: 140, name: '失败处理', type: 'action', input: '失败', output: 'AI Failed', logic: '状态改成 AI Failed\n\n意思是：\nAI 执行失败，需要处理' },
      { id: 'n5', x: 540, y: 100, name: '更新 Notion', type: 'action', input: '新状态', output: '完成', logic: '把新状态写回 Notion' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n2', to: 'n4' }, { from: 'n3', to: 'n5' }, { from: 'n4', to: 'n5' }],
  },

  'cs-log': { title: '日志写入', subtitle: '保存执行日志', scriptPath: '/completion/log.sh', isLeaf: true,
    workflowNodes: [
      { id: 'n1', x: 50, y: 100, name: '收到日志', type: 'trigger', input: '无', output: '日志内容', logic: '从 Webhook 收到日志内容' },
      { id: 'n2', x: 220, y: 100, name: '整理格式', type: 'logic', input: '日志内容', output: '格式化日志', logic: '加上时间戳\n整理成方便阅读的格式' },
      { id: 'n3', x: 410, y: 100, name: '保存文件', type: 'action', input: '格式化日志', output: '文件路径', logic: '保存到服务器上\n每个任务一个文件夹' },
      { id: 'n4', x: 600, y: 100, name: '更新索引', type: 'action', input: '文件路径', output: '完成', logic: '更新索引文件\n方便以后查找' },
    ],
    workflowEdges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },

  'content-publish': { title: 'Content Publish', subtitle: '9平台发布', milestones: [{ date: '1/20', label: 'v1.0 - 首批3平台' }],
    nodes: [
      { id: 'pub-dy', x: 60, y: 50, name: '抖音', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-xhs', x: 60, y: 110, name: '小红书', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-wx', x: 60, y: 170, name: '微信', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-wb', x: 180, y: 50, name: '微博', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-zh', x: 180, y: 110, name: '知乎', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-bili', x: 180, y: 170, name: 'B站', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-ks', x: 300, y: 50, name: '快手', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-sph', x: 300, y: 110, name: '视频号', desc: '', status: 'not_started', type: 'feature' },
      { id: 'pub-tt', x: 300, y: 170, name: '头条', desc: '', status: 'not_started', type: 'feature' },
    ], edges: [],
  },

  'data-collection': { title: 'Data Collection', subtitle: '6平台采集', milestones: [{ date: '1/31', label: 'v1.0 - Dad交付' }],
    nodes: [
      { id: 'data-dy', x: 60, y: 70, name: '抖音', desc: '', status: 'not_started', type: 'feature' },
      { id: 'data-xhs', x: 60, y: 140, name: '小红书', desc: '', status: 'not_started', type: 'feature' },
      { id: 'data-wb', x: 180, y: 70, name: '微博', desc: '', status: 'not_started', type: 'feature' },
      { id: 'data-zh', x: 180, y: 140, name: '知乎', desc: '', status: 'not_started', type: 'feature' },
      { id: 'data-bili', x: 300, y: 70, name: 'B站', desc: '', status: 'not_started', type: 'feature' },
      { id: 'data-ks', x: 300, y: 140, name: '快手', desc: '', status: 'not_started', type: 'feature' },
    ], edges: [],
  },

  'monitor': { title: 'Monitor', subtitle: '监控系统',
    nodes: [
      { id: 'mon-health', x: 60, y: 100, name: '健康检查', desc: '', status: 'not_started', type: 'feature' },
      { id: 'mon-report', x: 200, y: 60, name: '日报', desc: '', status: 'not_started', type: 'feature' },
      { id: 'mon-alert', x: 200, y: 140, name: '告警', desc: '', status: 'not_started', type: 'feature' },
      { id: 'mon-fix', x: 340, y: 100, name: '自动修复', desc: '', status: 'not_started', type: 'feature' },
    ],
    edges: [{ from: 'mon-health', to: 'mon-report' }, { from: 'mon-health', to: 'mon-alert' }, { from: 'mon-alert', to: 'mon-fix' }],
  },

  'dashboard': { title: 'Dashboard', subtitle: '前端界面',
    nodes: [
      { id: 'ui-overview', x: 60, y: 70, name: '全景页', desc: '', status: 'in_progress', type: 'dashboard', current: true },
      { id: 'ui-tasks', x: 60, y: 140, name: '任务页', desc: '', status: 'not_started', type: 'dashboard' },
      { id: 'ui-logs', x: 180, y: 70, name: '日志页', desc: '', status: 'not_started', type: 'dashboard' },
      { id: 'ui-monitor', x: 180, y: 140, name: '监控页', desc: '', status: 'not_started', type: 'dashboard' },
    ], edges: [],
  },

  'product': { title: 'ZenithJoy Autopilot', subtitle: '产品架构',
    nodes: [
      { id: 'prod-dash', x: 60, y: 100, name: 'Dashboard', desc: '', status: 'in_progress', type: 'product', hasChildren: true },
      { id: 'prod-api', x: 200, y: 60, name: 'API Server', desc: '', status: 'not_started', type: 'product' },
      { id: 'prod-n8n', x: 200, y: 140, name: 'n8n', desc: '', status: 'in_progress', type: 'product' },
      { id: 'prod-db', x: 340, y: 100, name: 'Database', desc: '', status: 'not_started', type: 'product' },
    ],
    edges: [{ from: 'prod-dash', to: 'prod-api' }, { from: 'prod-api', to: 'prod-db' }, { from: 'prod-n8n', to: 'prod-api' }],
  },
};

// 深色主题优化的颜色
const typeColors: Record<string, { fill: string; bg: string; border: string }> = {
  core: { fill: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
  product: { fill: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)' },
  dashboard: { fill: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.35)' },
  feature: { fill: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)' },
  workflow: { fill: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.35)' },
  service: { fill: '#f472b6', bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.35)' },
  project: { fill: '#818cf8', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.35)' },
  trigger: { fill: '#fbbf24', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)' },
  action: { fill: '#60a5fa', bg: 'rgba(96,165,250,0.15)', border: 'rgba(96,165,250,0.4)' },
  logic: { fill: '#a78bfa', bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.4)' },
  output: { fill: '#34d399', bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.4)' },
};
const statusColors: Record<string, string> = { completed: '#34d399', in_progress: '#60a5fa', not_started: '#64748b' };

// 主画布节点尺寸
const NODE_W = 180, NODE_H = 64;
// 预览区节点尺寸（约90%）
const PREVIEW_NODE_W = 160, PREVIEW_NODE_H = 56;

// 维度定义
type ViewDimension = 'blueprint' | 'runtime' | 'code' | 'dataflow' | 'workspace';

const dimensionLabels: Record<ViewDimension, { name: string; desc: string }> = {
  blueprint: { name: '蓝图', desc: '我想做什么' },
  runtime: { name: '运行', desc: '机器人们在干嘛' },
  code: { name: '代码', desc: '我的项目们' },
  dataflow: { name: '数据流', desc: '任务怎么流转' },
  workspace: { name: '工作区', desc: 'Claude 协作' },
};

// 工作区类型定义
interface WorkspaceNode extends ArchNode {
  createdAt?: number;
  updatedAt?: number;
}

interface WorkspaceData {
  nodes: WorkspaceNode[];
  edges: ArchEdge[];
  title: string;
  subtitle: string;
  lastUpdated: number;
}

// 静态数据（蓝图维度）
const blueprintData = allData;

interface ProjectPanoramaProps {
  embedded?: boolean;
  hideControls?: boolean;
}

export default function ProjectPanorama({ embedded = false, hideControls = false }: ProjectPanoramaProps) {
  // 当前维度
  const [dimension, setDimension] = useState<ViewDimension>('blueprint');
  const [path, setPath] = useState<string[]>(['root']);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [hovered, setHovered] = useState<ArchNode | null>(null);
  const [selected, setSelected] = useState<ArchNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [flowZoom, setFlowZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  // 动态数据（运行/代码/数据流维度共用）
  const [dynamicData, setDynamicData] = useState<Record<string, LayerData> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // 工作区数据
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [newNodeName, setNewNodeName] = useState('');

  // 连线编辑状态
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectingMousePos, setConnectingMousePos] = useState({ x: 0, y: 0 });

  // 根据维度选择数据源
  const getDataSource = (): Record<string, LayerData> => {
    if (dimension === 'blueprint') return blueprintData;
    if (dimension === 'workspace' && workspaceData) {
      return {
        'workspace-root': {
          title: workspaceData.title,
          subtitle: workspaceData.subtitle,
          nodes: workspaceData.nodes,
          edges: workspaceData.edges,
        },
      };
    }
    return dynamicData || {};
  };
  const allDataSource = getDataSource();

  // 画布平移和缩放
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // 框选状态
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxStart, setBoxStart] = useState({ x: 0, y: 0 });
  const [boxEnd, setBoxEnd] = useState({ x: 0, y: 0 });

  // 批量移动步长
  const MOVE_STEP = 20;

  // 从 API 获取动态数据
  const fetchDynamicData = useCallback(async (forceRefresh = false) => {
    try {
      setIsLoading(true);
      const url = forceRefresh
        ? `${API_BASE}/api/v1/panorama/refresh`
        : `${API_BASE}/api/v1/panorama`;

      const res = await fetch(url, {
        method: forceRefresh ? 'POST' : 'GET',
      });

      if (!res.ok) throw new Error('Failed to fetch data');

      const data = await res.json();

      if (data.allData) {
        setDynamicData(data.allData);
        setLastUpdated(data.lastUpdated);
      }
    } catch {
      // Dynamic data fetch failed silently
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 从 API 获取工作区数据
  const fetchWorkspaceData = useCallback(async () => {
    try {
      setIsWorkspaceLoading(true);
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace`);
      if (!res.ok) throw new Error('Failed to fetch workspace');
      const data = await res.json();
      setWorkspaceData(data);
    } catch {
      // Workspace data fetch failed silently
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, []);

  // 保存工作区数据
  const saveWorkspace = useCallback(async (updates: Partial<WorkspaceData>) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to save workspace');
      const data = await res.json();
      if (data.workspace) setWorkspaceData(data.workspace);
    } catch {
      // Save workspace failed silently
    }
  }, []);

  // 添加节点到工作区
  const addWorkspaceNode = useCallback(async (name: string) => {
    if (!name.trim()) return;
    const newNode: WorkspaceNode = {
      id: `node-${Date.now()}`,
      name: name.trim(),
      x: 60 + (workspaceData?.nodes.length || 0) % 4 * 210,
      y: 60 + Math.floor((workspaceData?.nodes.length || 0) / 4) * 100,
      status: 'not_started',
      type: 'feature',
    };
    const nodes = [...(workspaceData?.nodes || []), newNode];
    await saveWorkspace({ nodes });
    setNewNodeName('');
  }, [workspaceData, saveWorkspace]);

  // 删除工作区节点
  const deleteWorkspaceNode = useCallback(async (nodeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace/node/${nodeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete node');
      await fetchWorkspaceData();
    } catch {
      // Delete node failed silently
    }
  }, [fetchWorkspaceData]);

  // 更新工作区节点
  const updateWorkspaceNode = useCallback(async (nodeId: string, updates: Partial<WorkspaceNode>) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace/node/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update node');
      await fetchWorkspaceData();
    } catch {
      // Update node failed silently
    }
  }, [fetchWorkspaceData]);

  // 清空工作区
  const clearWorkspace = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to clear workspace');
      await fetchWorkspaceData();
    } catch {
      // Clear workspace failed silently
    }
  }, [fetchWorkspaceData]);

  // 添加连线
  const addWorkspaceEdge = useCallback(async (from: string, to: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace/edge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) throw new Error('Failed to add edge');
      await fetchWorkspaceData();
    } catch {
      // Add edge failed silently
    }
  }, [fetchWorkspaceData]);

  // 删除连线
  const deleteWorkspaceEdge = useCallback(async (from: string, to: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/workspace/edge`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) throw new Error('Failed to delete edge');
      await fetchWorkspaceData();
    } catch {
      // Delete edge failed silently
    }
  }, [fetchWorkspaceData]);

  // 开始连线
  const startConnecting = useCallback((nodeId: string) => {
    setConnectingFrom(nodeId);
  }, []);

  // 完成连线
  const finishConnecting = useCallback(async (toNodeId: string) => {
    if (connectingFrom && connectingFrom !== toNodeId) {
      await addWorkspaceEdge(connectingFrom, toNodeId);
    }
    setConnectingFrom(null);
  }, [connectingFrom, addWorkspaceEdge]);

  // 取消连线
  const cancelConnecting = useCallback(() => {
    setConnectingFrom(null);
  }, []);

  // 各维度的根节点 ID
  const dimensionRootIds: Record<ViewDimension, string> = {
    blueprint: 'root',           // 蓝图用静态数据的 root
    runtime: 'runtime-root',     // 运行：机器人状态
    code: 'code-root',           // 代码：项目列表
    dataflow: 'dataflow-root',   // 数据流：任务流转
    workspace: 'workspace-root', // 工作区：Claude 协作
  };

  // 切换维度时加载数据
  const switchDimension = useCallback((newDim: ViewDimension) => {
    setDimension(newDim);
    setPath([dimensionRootIds[newDim]]);
    setSelected(null);
    setHovered(null);
    setSelectedNode(null);
    setSelectedNodes(new Set());
    setCanvasZoom(1);
    setCanvasPan({ x: 0, y: 0 });
    setIsEditing(false);
    setEditingNode(null);
    setIsConnecting(false);
    setConnectingFrom(null);

    // 加载对应维度数据
    if (newDim === 'workspace') {
      fetchWorkspaceData();
    } else if (newDim !== 'blueprint' && !dynamicData) {
      fetchDynamicData();
    }
  }, [dynamicData, fetchDynamicData, fetchWorkspaceData]);

  const currentId = path[path.length - 1];
  const currentData = allDataSource[currentId];
  const previewNode = hovered || selected;
  const previewData = previewNode?.hasChildren ? allDataSource[previewNode.id] : null;

  // 自动布局：检测并修复重叠节点
  const autoLayoutNodes = useCallback((nodes: ArchNode[]): Record<string, { x: number; y: number }> => {
    if (!nodes || nodes.length === 0) return {};

    const GRID_X = NODE_W + 30;  // 节点宽度 + 间距 = 210
    const GRID_Y = NODE_H + 36;  // 节点高度 + 间距 = 100
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(nodes.length))));

    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((node, i) => {
      positions[node.id] = {
        x: 60 + (i % cols) * GRID_X,
        y: 60 + Math.floor(i / cols) * GRID_Y,
      };
    });
    return positions;
  }, []);

  // 检测节点是否有重叠
  const hasOverlap = useCallback((nodes: ArchNode[]): boolean => {
    if (!nodes || nodes.length < 2) return false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = Math.abs(nodes[i].x - nodes[j].x);
        const dy = Math.abs(nodes[i].y - nodes[j].y);
        if (dx < NODE_W && dy < NODE_H) return true;
      }
    }
    return false;
  }, []);

  // 获取节点位置（优先使用用户拖拽位置，其次检测重叠后自动布局）
  const getNodePos = useCallback((node: ArchNode) => {
    const savedPos = nodePositions[`${currentId}-${node.id}`];
    if (savedPos) return savedPos;

    // 如果当前层有重叠，使用自动布局
    if (currentData?.nodes && hasOverlap(currentData.nodes)) {
      const autoPos = autoLayoutNodes(currentData.nodes);
      return autoPos[node.id] || { x: node.x, y: node.y };
    }

    return { x: node.x, y: node.y };
  }, [nodePositions, currentId, currentData, hasOverlap, autoLayoutNodes]);

  const goTo = (nodeId: string) => { if (allDataSource[nodeId]) { setPath([...path, nodeId]); setSelected(null); setHovered(null); setSelectedNode(null); setFlowZoom(1); setSidebarOpen(false); setSelectedNodes(new Set()); } };
  const goBack = () => { if (path.length > 1) { setPath(path.slice(0, -1)); setSelected(null); setHovered(null); setSelectedNode(null); setFlowZoom(1); setSidebarOpen(false); setSelectedNodes(new Set()); } };
  const goToLevel = (i: number) => { setPath(path.slice(0, i + 1)); setSelected(null); setHovered(null); setSelectedNode(null); setFlowZoom(1); setSidebarOpen(false); setSelectedNodes(new Set()); };

  // 切换节点选中状态（用于 Ctrl+Click）
  const toggleNodeSelection = (nodeId: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // 全选当前层的所有节点
  const selectAllNodes = () => {
    if (currentData?.nodes) {
      setSelectedNodes(new Set(currentData.nodes.map(n => n.id)));
    }
  };

  // 清空选择
  const clearSelection = () => {
    setSelectedNodes(new Set());
  };

  // 批量移动选中的节点
  const moveSelectedNodes = (dx: number, dy: number) => {
    if (selectedNodes.size === 0) return;
    setNodePositions(prev => {
      const next = { ...prev };
      selectedNodes.forEach(nodeId => {
        const node = currentData?.nodes?.find(n => n.id === nodeId);
        if (node) {
          const key = `${currentId}-${nodeId}`;
          const pos = next[key] || { x: node.x, y: node.y };
          next[key] = { x: pos.x + dx, y: pos.y + dy };
        }
      });
      return next;
    });
  };

  // 屏幕坐标转SVG坐标（考虑画布平移和缩放）
  const screenToSvg = (clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgP = pt.matrixTransform(ctm.inverse());
    // 反向应用画布变换，得到内容坐标
    return {
      x: (svgP.x - canvasPan.x) / canvasZoom,
      y: (svgP.y - canvasPan.y) / canvasZoom
    };
  };

  // 画布缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (currentData?.isLeaf) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setCanvasZoom(z => Math.min(3, Math.max(0.3, z * delta)));
  }, [currentData?.isLeaf]);

  // 开始框选或平移
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target !== svgRef.current && (e.target as Element).tagName !== 'rect') return;

    // 取消连线模式
    if (connectingFrom) {
      cancelConnecting();
      return;
    }

    // 关闭侧边栏
    if (sidebarOpen) setSidebarOpen(false);

    const svgP = screenToSvg(e.clientX, e.clientY);

    // 空格键或中键：平移
    if (e.button === 1 || e.shiftKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - canvasPan.x, y: e.clientY - canvasPan.y });
    } else if (e.button === 0) {
      // 左键：框选
      setIsBoxSelecting(true);
      setBoxStart(svgP);
      setBoxEnd(svgP);
    }
  };

  // 框选/平移移动
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setCanvasPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (isBoxSelecting) {
      setBoxEnd(screenToSvg(e.clientX, e.clientY));
    }
  }, [isPanning, panStart, isBoxSelecting]);

  // 结束框选/平移
  const handleCanvasMouseUp = useCallback(() => {
    if (isBoxSelecting && currentData?.nodes) {
      // 计算框选范围内的节点
      const minX = Math.min(boxStart.x, boxEnd.x);
      const maxX = Math.max(boxStart.x, boxEnd.x);
      const minY = Math.min(boxStart.y, boxEnd.y);
      const maxY = Math.max(boxStart.y, boxEnd.y);

      // 只有框选范围大于10px才算有效框选
      if (Math.abs(boxEnd.x - boxStart.x) > 10 || Math.abs(boxEnd.y - boxStart.y) > 10) {
        const nodesInBox = currentData.nodes.filter(node => {
          const pos = getNodePos(node);
          const cx = pos.x + NODE_W / 2;
          const cy = pos.y + NODE_H / 2;
          return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
        });
        if (nodesInBox.length > 0) {
          setSelectedNodes(new Set(nodesInBox.map(n => n.id)));
        }
      }
    }
    setIsBoxSelecting(false);
    setIsPanning(false);
  }, [isBoxSelecting, boxStart, boxEnd, currentData, getNodePos]);

  // 重置视图
  const resetView = () => {
    setCanvasZoom(1);
    setCanvasPan({ x: 0, y: 0 });
  };

  // 进入全屏时确保导航栏关闭
  const toggleFullscreen = () => {
    setIsFullscreen(f => {
      if (!f) setSidebarOpen(false); // 进入全屏时关闭侧边栏
      return !f;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 不在输入框时才处理快捷键
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.key === 'Escape') {
        if (selectedNodes.size > 0) clearSelection();
        else if (selectedNode) setSelectedNode(null);
        else if (sidebarOpen) setSidebarOpen(false);
        else if (isFullscreen) setIsFullscreen(false);
        else if (path.length > 1) goBack();
      }
      // F 键切换全屏
      if (e.key === 'f' || e.key === 'F') {
        if (!selectedNode) toggleFullscreen();
      }
      // Ctrl+A 全选
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAllNodes();
      }
      // 方向键移动选中的节点
      if (selectedNodes.size > 0 && !currentData?.isLeaf) {
        const step = e.shiftKey ? MOVE_STEP * 3 : MOVE_STEP; // Shift 加速
        if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelectedNodes(-step, 0); }
        if (e.key === 'ArrowRight') { e.preventDefault(); moveSelectedNodes(step, 0); }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveSelectedNodes(0, -step); }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSelectedNodes(0, step); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [path, selectedNode, sidebarOpen, isFullscreen, selectedNodes, currentData]);

  const handleMouseDown = (e: React.MouseEvent, node: ArchNode) => {
    e.stopPropagation();
    if (!svgRef.current) return;
    const pt = svgRef.current.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const svgP = pt.matrixTransform(ctm.inverse());
    const pos = getNodePos(node);
    setDragging(node.id);
    setDragOffset({ x: svgP.x - pos.x, y: svgP.y - pos.y });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const svgP = pt.matrixTransform(ctm.inverse());
    setNodePositions(p => ({ ...p, [`${currentId}-${dragging}`]: { x: svgP.x - dragOffset.x, y: svgP.y - dragOffset.y } }));
  }, [dragging, dragOffset, currentId]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  const getFlowWidth = () => {
    if (!currentData?.workflowNodes) return 900;
    const maxX = Math.max(...currentData.workflowNodes.map(n => n.x));
    return Math.max(maxX + 200, 900);
  };

  // 预览小地图 - 固定高度，横向滚动
  const renderPreviewMap = (data: LayerData) => {
    if (!data?.nodes) return null;
    const { nodes, edges } = data;
    const PW = PREVIEW_NODE_W, PH = PREVIEW_NODE_H;
    const GAP = 12;  // 节点间距
    const ROWS = 3;  // 固定3行
    const FIXED_HEIGHT = GAP + ROWS * (PH + GAP);  // 自动计算高度

    // 横向排列：先填满一行再换行（1 2 3 在上，4 5 6 在下）
    const COLS = Math.ceil(nodes.length / ROWS);  // 每行几个
    const layoutNodes = nodes.map((n, i) => ({
      ...n,
      lx: GAP + (i % COLS) * (PW + GAP),           // 列 = i % 列数
      ly: GAP + Math.floor(i / COLS) * (PH + GAP), // 行 = i / 列数
    }));

    const totalWidth = Math.max(...layoutNodes.map(n => n.lx + PW)) + GAP;

    return (
      <div style={{ width: '100%', height: FIXED_HEIGHT, overflowX: 'auto', overflowY: 'hidden', borderRadius: 12, background: 'rgba(30,41,59,0.5)' }}>
        <svg width={Math.max(totalWidth, 400)} height={FIXED_HEIGHT} style={{ display: 'block' }}>
          {edges?.map((e, i) => {
            const from = layoutNodes.find(n => n.id === e.from);
            const to = layoutNodes.find(n => n.id === e.to);
            if (!from || !to) return null;
            return <line key={i} x1={from.lx + PW} y1={from.ly + PH/2} x2={to.lx} y2={to.ly + PH/2} stroke="#475569" strokeWidth={1.5} />;
          })}
          {layoutNodes.map(n => {
            const tc = typeColors[n.type] || typeColors.feature;
            return (
              <g key={n.id} transform={`translate(${n.lx}, ${n.ly})`}>
                <rect width={PW} height={PH} rx={8} fill={tc.bg} stroke={tc.border} strokeWidth={1} />
                <rect width={3} height={PH} rx={1.5} fill={tc.fill} />
                <circle cx={16} cy={PH/2} r={4} fill={statusColors[n.status]} />
                <text x={28} y={PH/2+4} fill="#e2e8f0" fontSize={11} fontWeight={500}>{n.name.length > 12 ? n.name.slice(0, 12) + '..' : n.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    // 根据 isFullscreen 或 embedded 切换样式
    <div
      className={
        embedded
          ? "flex w-full h-full"  // 嵌入模式：填满父容器
          : isFullscreen
            ? "fixed inset-0 z-50 flex"
            : "flex -m-8 rounded-none"  // 抵消父容器的 p-8
      }
      style={{
        // 嵌入模式使用透明背景，由父容器控制背景色
        ...(embedded ? {} : {
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        }),
        // 非嵌入非全屏模式：占满内容区（100vh - 顶部栏64px）
        ...(!embedded && !isFullscreen ? { height: 'calc(100vh - 64px)' } : {})
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 左侧信息栏 - 只在全屏模式下显示 */}
      {isFullscreen && (
        <div className={`absolute left-0 top-0 bottom-0 z-20 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-full w-64 bg-slate-900/95 backdrop-blur-xl border-r border-slate-700/50 flex flex-col">
            <div className="p-4 border-b border-slate-700/50 flex justify-between items-center">
              <span className="text-sm font-semibold text-slate-200">导航</span>
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 路径导航 */}
            <div className="p-4 border-b border-slate-700/50">
              <div className="text-xs text-slate-500 mb-3">当前位置</div>
              {path.map((id, i) => (
                <div key={id} onClick={() => i < path.length - 1 && goToLevel(i)}
                  style={{ marginLeft: i * 12 }}
                  className={`py-1.5 px-2 rounded-lg mb-1 text-sm cursor-pointer transition-colors ${
                    i === path.length - 1
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}>
                  {i > 0 && <span className="text-slate-600 mr-1">└</span>}
                  {allDataSource[id]?.title}
                </div>
              ))}
            </div>

            {/* 里程碑 */}
            {currentData?.milestones && currentData.milestones.length > 0 && (
              <div className="p-4 border-b border-slate-700/50">
                <div className="text-xs text-slate-500 mb-3">里程碑</div>
                {currentData.milestones.map((m, i) => (
                  <div key={i} className={`p-2 rounded-lg mb-2 ${i === 0 ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-slate-800/50'}`}>
                    <span className={`text-xs font-semibold ${i === 0 ? 'text-amber-400' : 'text-slate-400'}`}>{m.date}</span>
                    <span className={`text-xs ml-2 ${i === 0 ? 'text-amber-300' : 'text-slate-500'}`}>{m.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 图例 */}
            <div className="p-4 mt-auto">
              <div className="text-xs text-slate-500 mb-3">图例</div>
              <div className="space-y-2">
                {(['core', 'product', 'dashboard', 'feature', 'workflow'] as const).map(type => (
                  <div key={type} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ background: typeColors[type].fill }} />
                    <span className="text-xs text-slate-400">{typeDescriptions[type]}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <div className="flex gap-3">
                  {([['completed', '完成'], ['in_progress', '进行'], ['not_started', '待做']] as const).map(([s, label]) => (
                    <div key={s} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: statusColors[s] }} />
                      <span className="text-xs text-slate-500">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 侧边栏展开按钮 - 只在全屏模式下显示 */}
      {isFullscreen && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-4 top-4 z-10 p-2.5 rounded-xl bg-slate-800/80 backdrop-blur border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700/80 transition-all shadow-lg"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}


      {/* 主内容区 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部导航 */}
        <div className={`h-14 flex items-center gap-3 ${embedded ? 'px-4' : 'px-16'}`}>
          {/* 维度切换标签 */}
          <div className="flex items-center gap-1 p-1 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            {(Object.keys(dimensionLabels) as ViewDimension[]).map(dim => (
              <button
                key={dim}
                onClick={() => switchDimension(dim)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  dimension === dim
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
                title={dimensionLabels[dim].desc}
              >
                {dimensionLabels[dim].name}
              </button>
            ))}
          </div>

          {/* 分隔线 */}
          <div className="w-px h-6 bg-slate-700/50" />

          {path.length > 1 && (
            <button onClick={goBack} className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-300 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:bg-slate-700/50 transition-colors">
              <ChevronLeft className="w-4 h-4" />
              返回
            </button>
          )}
          <div className="flex items-center gap-2 text-sm">
            {path.map((id, i) => (
              <React.Fragment key={id}>
                {i > 0 && <ChevronRight className="w-4 h-4 text-slate-600" />}
                <button
                  onClick={() => i < path.length - 1 && goToLevel(i)}
                  className={`px-2 py-1 rounded ${i === path.length - 1 ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {allDataSource[id]?.title}
                </button>
              </React.Fragment>
            ))}
            {currentData?.version && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">
                {currentData.version}
              </span>
            )}
          </div>

          {/* 工具栏 */}
          <div className="flex items-center gap-2 ml-auto">
            {/* 工作区工具栏 */}
            {dimension === 'workspace' && (
              <div className="flex items-center gap-2">
                {/* 添加节点输入框 */}
                <div className="flex items-center gap-1 px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                  <input
                    type="text"
                    value={newNodeName}
                    onChange={e => setNewNodeName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addWorkspaceNode(newNodeName)}
                    placeholder="新节点名称..."
                    className="w-32 bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    onClick={() => addWorkspaceNode(newNodeName)}
                    disabled={!newNodeName.trim()}
                    className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    添加
                  </button>
                </div>
                {/* 编辑模式开关 */}
                <button
                  onClick={() => { setIsEditing(!isEditing); setIsConnecting(false); setConnectingFrom(null); }}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    isEditing
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 bg-slate-800/50 border border-slate-700/50 hover:text-slate-200'
                  }`}
                >
                  {isEditing ? '退出编辑' : '编辑模式'}
                </button>
                {/* 连线模式开关 */}
                <button
                  onClick={() => { setIsConnecting(!isConnecting); setIsEditing(false); setConnectingFrom(null); }}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    isConnecting
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 bg-slate-800/50 border border-slate-700/50 hover:text-slate-200'
                  }`}
                >
                  {isConnecting ? (connectingFrom ? '选择目标...' : '选择起点...') : '连线模式'}
                </button>
                {/* 清空 */}
                {workspaceData?.nodes && workspaceData.nodes.length > 0 && (
                  <button
                    onClick={() => {
                      if (confirm('确定清空工作区？')) clearWorkspace();
                    }}
                    className="px-2 py-1.5 text-xs text-red-400 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:bg-red-500/10 hover:border-red-500/30"
                  >
                    清空
                  </button>
                )}
                {/* 刷新 */}
                <button
                  onClick={fetchWorkspaceData}
                  disabled={isWorkspaceLoading}
                  className="p-1.5 text-slate-400 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:text-slate-200 disabled:opacity-50"
                  title="刷新工作区"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isWorkspaceLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            )}
            {/* 数据源指示器 - 只在运行/代码/数据流维度显示 */}
            {dimension !== 'blueprint' && dimension !== 'workspace' && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                ) : (
                  <div className={`w-2 h-2 rounded-full ${dynamicData ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                )}
                <span className="text-xs text-slate-400">
                  {dynamicData ? '实时' : '未加载'}
                </span>
                <button
                  onClick={() => fetchDynamicData(true)}
                  disabled={isLoading}
                  className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-50"
                  title="刷新数据"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            )}
            {/* 架构图工具 - 只在架构图模式显示 */}
            {!currentData?.isLeaf && currentData?.nodes && (
              <>
                {/* 缩放控制 */}
                <div className="flex items-center gap-1 px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                  <button onClick={() => setCanvasZoom(z => Math.max(0.3, z * 0.8))} className="p-1 text-slate-400 hover:text-slate-200">
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-400 w-12 text-center">{Math.round(canvasZoom * 100)}%</span>
                  <button onClick={() => setCanvasZoom(z => Math.min(3, z * 1.25))} className="p-1 text-slate-400 hover:text-slate-200">
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button onClick={resetView} className="p-1 text-slate-400 hover:text-slate-200 ml-1" title="重置视图">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <button
                  onClick={selectAllNodes}
                  className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:bg-slate-700/50 transition-colors"
                >
                  全选 ({currentData.nodes.length})
                </button>
                {selectedNodes.size > 0 && (
                  <span className="px-2 py-1 text-xs bg-blue-500/20 text-blue-300 rounded-lg border border-blue-500/30">
                    已选 {selectedNodes.size}
                  </span>
                )}
                {/* 分隔线 */}
                <div className="w-px h-6 bg-slate-700/50 mx-1" />
              </>
            )}
            {/* 全屏按钮 - 非嵌入模式显示 */}
            {!embedded && (
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:bg-slate-700/50 transition-colors"
                title={isFullscreen ? "退出全屏 (Esc)" : "进入全屏 (F)"}
              >
                {isFullscreen ? <X className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                {isFullscreen ? '退出' : '全屏'}
              </button>
            )}
          </div>
        </div>

        {/* 中间画布区 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {currentData?.isLeaf ? (
            // 最底层：工作流详情
            <div className="h-full overflow-auto p-6">
              <div className="max-w-5xl mx-auto">
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-white mb-1">{currentData.title}</h2>
                  <p className="text-slate-400">{currentData.subtitle}</p>
                  {currentData.scriptPath && (
                    <code className="inline-block mt-2 px-3 py-1 text-xs bg-slate-800/80 text-slate-300 rounded-lg font-mono border border-slate-700/50">
                      {currentData.scriptPath}
                    </code>
                  )}
                </div>

                {/* 流程图 */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-slate-400">执行流程 (点击节点查看详情)</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setFlowZoom(z => Math.max(0.5, z - 0.1))} className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50">
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <span className="text-xs text-slate-500 w-12 text-center">{Math.round(flowZoom * 100)}%</span>
                      <button onClick={() => setFlowZoom(z => Math.min(1.5, z + 0.1))} className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50">
                        <ZoomIn className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div
                    className="overflow-x-auto bg-slate-900/50 rounded-xl p-4 border border-slate-700/30 cursor-grab active:cursor-grabbing"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#475569 transparent'
                    }}
                    onMouseDown={e => {
                      const el = e.currentTarget;
                      const startX = e.pageX - el.offsetLeft;
                      const scrollLeft = el.scrollLeft;
                      const onMove = (ev: MouseEvent) => {
                        el.scrollLeft = scrollLeft - (ev.pageX - el.offsetLeft - startX);
                      };
                      const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                      };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    }}
                  >
                    <svg width={getFlowWidth() * flowZoom} height={260 * flowZoom} style={{ display: 'block', minWidth: getFlowWidth() * flowZoom }}>
                      <g transform={`scale(${flowZoom})`}>
                        {currentData.workflowEdges?.map((e, i) => {
                          const from = currentData.workflowNodes?.find(n => n.id === e.from);
                          const to = currentData.workflowNodes?.find(n => n.id === e.to);
                          if (!from || !to) return null;
                          return <line key={i} x1={from.x + 150} y1={from.y + 50} x2={to.x} y2={to.y + 50} stroke="#475569" strokeWidth={2} />;
                        })}
                        {currentData.workflowNodes?.map(n => {
                          const tc = typeColors[n.type] || typeColors.action;
                          const isSel = selectedNode?.id === n.id;
                          return (
                            <g key={n.id} transform={`translate(${n.x}, ${n.y})`} onClick={() => setSelectedNode(isSel ? null : n)} style={{ cursor: 'pointer' }}>
                              {isSel && <rect x={-4} y={-4} width={158} height={108} rx={12} fill="none" stroke="#fbbf24" strokeWidth={3} />}
                              <rect width={150} height={100} rx={10} fill={tc.bg} stroke={tc.border} strokeWidth={isSel ? 2 : 1.5} />
                              <rect width={5} height={100} rx={2.5} fill={tc.fill} />
                              <text x={18} y={28} fill="#f1f5f9" fontSize={13} fontWeight={600}>{n.name}</text>
                              <text x={18} y={48} fill="#94a3b8" fontSize={11}>{nodeTypeLabels[n.type]}</text>
                              <text x={18} y={70} fill="#cbd5e1" fontSize={10}>{n.logic?.split('\n')[0]?.slice(0, 18)}</text>
                              <text x={18} y={86} fill="#64748b" fontSize={9}>{n.logic?.split('\n')[1]?.slice(0, 20)}</text>
                            </g>
                          );
                        })}
                      </g>
                    </svg>
                  </div>

                  {/* 滚动提示 */}
                  <div className="text-xs text-slate-600 mt-2 text-center">
                    ← 拖拽或滚动查看更多 →
                  </div>

                  {/* 图例 */}
                  <div className="flex gap-6 mt-3">
                    {(['trigger', 'action', 'logic', 'output'] as const).map(t => (
                      <div key={t} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded" style={{ background: typeColors[t].fill }} />
                        <span className="text-xs text-slate-400">{nodeTypeLabels[t]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 节点详情 */}
                {selectedNode && (
                  <div className="bg-slate-900/50 rounded-xl p-6 relative border border-slate-700/30">
                    <button onClick={() => setSelectedNode(null)} className="absolute top-4 right-4 p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200">
                      <X className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-4 h-4 rounded" style={{ background: typeColors[selectedNode.type]?.fill }} />
                      <h3 className="text-lg font-semibold text-white">{selectedNode.name}</h3>
                      <span className="px-2 py-1 text-xs rounded-lg border" style={{ background: typeColors[selectedNode.type]?.bg, borderColor: typeColors[selectedNode.type]?.border, color: typeColors[selectedNode.type]?.fill }}>{nodeTypeLabels[selectedNode.type]}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/30">
                        <div className="text-sm font-medium text-blue-400 mb-2">输入</div>
                        <div className="text-slate-200">{selectedNode.input || '无'}</div>
                      </div>
                      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/30">
                        <div className="text-sm font-medium text-emerald-400 mb-2">输出</div>
                        <div className="text-slate-200">{selectedNode.output || '无'}</div>
                      </div>
                    </div>
                    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/30">
                      <div className="text-sm font-medium text-amber-400 mb-3">这一步做什么</div>
                      <div className="text-slate-200 whitespace-pre-wrap leading-relaxed">{selectedNode.logic}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // 架构图
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              style={{ cursor: isPanning ? 'grabbing' : isBoxSelecting ? 'crosshair' : dragging ? 'grabbing' : 'default' }}
              onWheel={handleWheel}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={e => { handleCanvasMouseMove(e); handleMouseMove(e); }}
              onMouseUp={() => { handleCanvasMouseUp(); handleMouseUp(); }}
              onMouseLeave={() => { handleCanvasMouseUp(); handleMouseUp(); }}
            >
              <defs>
                <pattern id="grid" width={30 * canvasZoom} height={30 * canvasZoom} patternUnits="userSpaceOnUse">
                  <path d={`M ${30 * canvasZoom} 0 L 0 0 0 ${30 * canvasZoom}`} fill="none" stroke="rgba(71,85,105,0.15)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* 主内容组 - 应用缩放和平移 */}
              <g transform={`translate(${canvasPan.x}, ${canvasPan.y}) scale(${canvasZoom})`}>
              {/* 工作区空状态 */}
              {dimension === 'workspace' && (!currentData?.nodes || currentData.nodes.length === 0) && (
                <g transform="translate(200, 150)">
                  <rect x={-150} y={-80} width={300} height={160} rx={16} fill="rgba(30,41,59,0.8)" stroke="rgba(71,85,105,0.5)" strokeWidth={1} strokeDasharray="4 2" />
                  <text x={0} y={-20} fill="#94a3b8" fontSize={14} textAnchor="middle">工作区是空的</text>
                  <text x={0} y={10} fill="#64748b" fontSize={12} textAnchor="middle">在上方输入名称添加节点</text>
                  <text x={0} y={40} fill="#64748b" fontSize={12} textAnchor="middle">或等待 Claude 推送架构方案</text>
                </g>
              )}
              {currentData?.edges?.map((e, i) => {
                const from = currentData.nodes?.find(n => n.id === e.from), to = currentData.nodes?.find(n => n.id === e.to);
                if (!from || !to) return null;
                const fp = getNodePos(from), tp = getNodePos(to);
                const pathD = `M ${fp.x + NODE_W} ${fp.y + NODE_H/2} C ${(fp.x + NODE_W + tp.x)/2} ${fp.y + NODE_H/2}, ${(fp.x + NODE_W + tp.x)/2} ${tp.y + NODE_H/2}, ${tp.x} ${tp.y + NODE_H/2}`;
                const isWorkspaceEditing = dimension === 'workspace' && isEditing;
                return (
                  <g key={i}>
                    {/* 点击区域（更宽，便于点击） */}
                    {isWorkspaceEditing && (
                      <path
                        d={pathD}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          if (confirm(`删除连线 ${from.name} → ${to.name}?`)) {
                            deleteWorkspaceEdge(e.from, e.to);
                          }
                        }}
                      />
                    )}
                    <path d={pathD} fill="none" stroke={isWorkspaceEditing ? '#ef4444' : '#475569'} strokeWidth={2} pointerEvents="none" />
                  </g>
                );
              })}
              {/* 连线预览 */}
              {dimension === 'workspace' && isConnecting && connectingFrom && hovered && connectingFrom !== hovered.id && (() => {
                const fromNode = currentData?.nodes?.find(n => n.id === connectingFrom);
                if (!fromNode) return null;
                const fp = getNodePos(fromNode);
                const tp = getNodePos(hovered);
                return (
                  <path
                    d={`M ${fp.x + NODE_W} ${fp.y + NODE_H/2} C ${(fp.x + NODE_W + tp.x)/2} ${fp.y + NODE_H/2}, ${(fp.x + NODE_W + tp.x)/2} ${tp.y + NODE_H/2}, ${tp.x} ${tp.y + NODE_H/2}`}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                  />
                );
              })()}
              {currentData?.nodes?.map(node => {
                const pos = getNodePos(node);
                const tc = typeColors[node.type] || typeColors.feature;
                const isHov = hovered?.id === node.id, isSel = selected?.id === node.id;
                const isMultiSel = selectedNodes.has(node.id);
                const canDrill = node.hasChildren && allDataSource[node.id];
                return (
                  <g key={node.id} transform={`translate(${pos.x}, ${pos.y}) ${isHov && !dragging ? 'scale(1.04)' : ''}`}
                    style={{ transition: dragging ? 'none' : 'transform 0.15s', transformOrigin: `${NODE_W/2}px ${NODE_H/2}px` }}
                    onMouseDown={e => handleMouseDown(e, node)}
                    onMouseEnter={() => !dragging && setHovered(node)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={e => {
                      e.stopPropagation();
                      // 工作区连线模式
                      if (dimension === 'workspace' && isConnecting) {
                        if (!connectingFrom) {
                          startConnecting(node.id);
                        } else {
                          finishConnecting(node.id);
                        }
                        return;
                      }
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl+Click: 切换多选
                        toggleNodeSelection(node.id);
                      } else {
                        // 普通点击：单选
                        setSelected(isSel ? null : node);
                        if (selectedNodes.size > 0) clearSelection();
                      }
                    }}
                    onDoubleClick={() => canDrill && goTo(node.id)}
                  >
                    {/* 连线起点高亮 */}
                    {dimension === 'workspace' && isConnecting && connectingFrom === node.id && (
                      <>
                        <rect x={-8} y={-8} width={NODE_W+16} height={NODE_H+16} rx={16} fill="none" stroke="rgba(16,185,129,0.3)" strokeWidth={1} />
                        <rect x={-4} y={-4} width={NODE_W+8} height={NODE_H+8} rx={12} fill="none" stroke="#10b981" strokeWidth={2} />
                      </>
                    )}
                    {/* 多选高亮 - 柔和蓝色光晕 */}
                    {isMultiSel && (
                      <>
                        <rect x={-8} y={-8} width={NODE_W+16} height={NODE_H+16} rx={16} fill="none" stroke="rgba(96,165,250,0.3)" strokeWidth={1} />
                        <rect x={-4} y={-4} width={NODE_W+8} height={NODE_H+8} rx={12} fill="none" stroke="rgba(96,165,250,0.7)" strokeWidth={1.5} />
                      </>
                    )}
                    {/* 单选/悬停高亮 */}
                    {(isHov || isSel) && !isMultiSel && connectingFrom !== node.id && <rect x={-4} y={-4} width={NODE_W+8} height={NODE_H+8} rx={12} fill="none" stroke={isSel ? '#fbbf24' : '#60a5fa'} strokeWidth={2} />}
                    <rect width={NODE_W} height={NODE_H} rx={10} fill={isMultiSel ? 'rgba(96,165,250,0.08)' : node.current ? 'rgba(96,165,250,0.15)' : tc.bg} stroke={isMultiSel ? 'rgba(96,165,250,0.5)' : tc.border} strokeWidth={isMultiSel ? 1.5 : node.current ? 2 : 1.5} style={{ cursor: dragging === node.id ? 'grabbing' : 'grab' }} />
                    <rect width={4} height={NODE_H} rx={2} fill={tc.fill} />
                    <circle cx={18} cy={NODE_H/2} r={5} fill={statusColors[node.status]} />
                    {/* 使用 foreignObject 实现文字自动换行 */}
                    <foreignObject x={28} y={node.desc ? 6 : 12} width={NODE_W - 48} height={NODE_H - 12}>
                      <div style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#f1f5f9',
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: node.desc ? 1 : 2,
                        WebkitBoxOrient: 'vertical' as const,
                        wordBreak: 'break-all'
                      }}>{node.name}</div>
                      {node.desc && (
                        <div style={{
                          fontSize: 10,
                          color: '#94a3b8',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>{node.desc}</div>
                      )}
                    </foreignObject>
                    {canDrill && <text x={NODE_W-14} y={NODE_H-12} fill="#64748b" fontSize={14}>→</text>}
                    {node.current && <g transform={`translate(${NODE_W-32}, ${NODE_H-16})`}><rect width={26} height={12} rx={3} fill="#60a5fa" /><text x={13} y={9} fill="#fff" fontSize={8} textAnchor="middle" fontWeight={500}>NOW</text></g>}
                    {/* 工作区编辑模式下的删除按钮 */}
                    {dimension === 'workspace' && isEditing && (
                      <g
                        transform={`translate(${NODE_W - 20}, 4)`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`删除节点 "${node.name}"?`)) {
                            deleteWorkspaceNode(node.id);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle r={8} fill="rgba(239, 68, 68, 0.2)" stroke="rgba(239, 68, 68, 0.5)" strokeWidth={1} />
                        <text x={0} y={4} fill="#ef4444" fontSize={12} textAnchor="middle" fontWeight="bold">×</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* 框选矩形 - 放在 transform 组内 */}
              {isBoxSelecting && (
                <g pointerEvents="none">
                  {/* 外发光 */}
                  <rect
                    x={Math.min(boxStart.x, boxEnd.x) - 2 / canvasZoom}
                    y={Math.min(boxStart.y, boxEnd.y) - 2 / canvasZoom}
                    width={Math.abs(boxEnd.x - boxStart.x) + 4 / canvasZoom}
                    height={Math.abs(boxEnd.y - boxStart.y) + 4 / canvasZoom}
                    fill="none"
                    stroke="rgba(96, 165, 250, 0.2)"
                    strokeWidth={4 / canvasZoom}
                    rx={6 / canvasZoom}
                  />
                  {/* 主边框 */}
                  <rect
                    x={Math.min(boxStart.x, boxEnd.x)}
                    y={Math.min(boxStart.y, boxEnd.y)}
                    width={Math.abs(boxEnd.x - boxStart.x)}
                    height={Math.abs(boxEnd.y - boxStart.y)}
                    fill="rgba(96, 165, 250, 0.06)"
                    stroke="rgba(96, 165, 250, 0.5)"
                    strokeWidth={1.5 / canvasZoom}
                    strokeDasharray={`${4 / canvasZoom} ${2 / canvasZoom}`}
                    rx={4 / canvasZoom}
                  />
                </g>
              )}
              </g>
            </svg>
          )}
        </div>

        {/* 底部预览区 - 恢复原设计 */}
        {!currentData?.isLeaf && (
          <div className={`transition-all duration-300 border-t border-slate-700/50 bg-slate-900/80 backdrop-blur ${previewData ? 'h-80' : 'h-14'}`}>
            {previewData && previewNode ? (
              <div className="h-full p-5 flex gap-6">
                {/* 左侧：节点信息 */}
                <div className="w-48 flex-shrink-0">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded" style={{ background: typeColors[previewNode.type]?.fill }} />
                    <span className="font-semibold text-white">{previewNode.name}</span>
                  </div>
                  {previewNode.desc && <p className="text-sm text-slate-400 mb-3">{previewNode.desc}</p>}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="px-2 py-1 text-xs rounded-lg" style={{ background: statusColors[previewNode.status] + '20', color: statusColors[previewNode.status] }}>
                      {previewNode.status === 'completed' ? '已完成' : previewNode.status === 'in_progress' ? '进行中' : '未开始'}
                    </span>
                    {previewNode.version && <span className="px-2 py-1 text-xs bg-purple-500/20 text-purple-300 rounded-lg border border-purple-500/30">{previewNode.version}</span>}
                  </div>
                  <button onClick={() => goTo(previewNode.id)} className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-colors">
                    进入 →
                  </button>
                </div>

                {/* 右侧：预览地图 */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-500 mb-2">下一层预览</div>
                  <div className="h-[calc(100%-24px)]">{renderPreviewMap(previewData)}</div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center gap-4 text-slate-500 text-sm">
                {selectedNodes.size > 0 ? (
                  <>
                    <span className="text-blue-400">已选 {selectedNodes.size} 个节点</span>
                    <span>方向键移动 · Shift加速 · Esc取消</span>
                    <button onClick={clearSelection} className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded">
                      清除选择
                    </button>
                  </>
                ) : (
                  <span>拖拽框选 · ⌘/Ctrl+点击多选 · 滚轮缩放 · Shift+拖拽平移 · 双击进入</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
