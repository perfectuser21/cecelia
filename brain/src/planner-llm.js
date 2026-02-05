/**
 * LLM-based Planner - Intelligent task decomposition using Claude
 *
 * This planner uses Claude Opus/Sonnet to intelligently break down
 * complex goals/requirements into actionable tasks.
 *
 * Usage:
 * - For complex/ambiguous requirements → use LLM planner
 * - For simple/well-defined tasks → use rule-based planner
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from './db.js';

// Initialize Anthropic client
let anthropic = null;

function getAnthropicClient() {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set in environment');
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

/**
 * Plan tasks for a Goal/KR using LLM
 *
 * @param {Object} goal - Goal or Key Result object
 * @param {Object} context - Additional context (projects, existing tasks, etc.)
 * @returns {Promise<Array>} - Array of task objects
 */
export async function planWithLLM(goal, context = {}) {
  const client = getAnthropicClient();

  // Prepare context for the LLM
  const contextStr = buildContextString(goal, context);

  // Call Claude API
  const response = await client.messages.create({
    model: context.useOpus ? 'claude-opus-4' : 'claude-sonnet-4',
    max_tokens: 4096,
    temperature: 0.3, // Lower temperature for more consistent planning
    messages: [{
      role: 'user',
      content: `你是一个专业的任务规划专家。请将以下目标拆解成具体的、可执行的任务。

${contextStr}

请输出JSON格式的任务列表，每个任务包含：
- title: 任务标题（简洁明确）
- description: 详细描述（包含验收标准）
- priority: P0/P1/P2（根据重要性和依赖关系）
- estimated_hours: 预估工时（数字）
- dependencies: 依赖的任务索引数组（如 [0, 1] 表示依赖第1和第2个任务）
- tags: 标签数组（如 ["backend", "api"]）

规则：
1. 任务要具体、可执行、可验证
2. 优先级要合理（P0=阻塞性，P1=重要，P2=普通）
3. 依赖关系要清晰
4. 总任务数控制在3-8个
5. 只输出JSON，不要其他文字

示例输出：
\`\`\`json
[
  {
    "title": "设计数据库schema",
    "description": "设计users表和tasks表，包含主键、索引、约束",
    "priority": "P0",
    "estimated_hours": 2,
    "dependencies": [],
    "tags": ["database", "design"]
  },
  {
    "title": "实现用户注册API",
    "description": "POST /api/users/register，验证邮箱格式，密码加密",
    "priority": "P1",
    "estimated_hours": 4,
    "dependencies": [0],
    "tags": ["backend", "api", "auth"]
  }
]
\`\`\`
`
    }]
  });

  // Parse response
  const tasks = parseTasksFromResponse(response);

  // Validate and enhance tasks
  return enhanceTasks(tasks, goal);
}

/**
 * Build context string for LLM
 */
function buildContextString(goal, context) {
  let str = `目标信息：
- 标题：${goal.title}
- 描述：${goal.description || '无'}
- 优先级：${goal.priority || 'P1'}
- 当前进度：${goal.progress || 0}%
`;

  if (goal.content) {
    try {
      const content = typeof goal.content === 'string'
        ? JSON.parse(goal.content)
        : goal.content;

      if (content.acceptance_criteria?.length > 0) {
        str += `\n验收标准：\n${content.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
      }

      if (content.context) {
        str += `\n背景：${content.context}`;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  if (context.projects?.length > 0) {
    str += `\n\n关联项目：\n${context.projects.map(p => `- ${p.name}: ${p.description || ''}`).join('\n')}`;
  }

  if (context.existingTasks?.length > 0) {
    str += `\n\n已存在的任务（避免重复）：\n${context.existingTasks.map(t => `- ${t.title}`).join('\n')}`;
  }

  return str;
}

/**
 * Parse tasks from Claude response
 */
function parseTasksFromResponse(response) {
  const text = response.content[0].text;

  // Extract JSON from response (handle code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const tasks = JSON.parse(jsonStr);
    if (!Array.isArray(tasks)) {
      throw new Error('Response is not an array');
    }
    return tasks;
  } catch (e) {
    console.error('Failed to parse LLM response:', text);
    throw new Error(`LLM response parsing failed: ${e.message}`);
  }
}

/**
 * Enhance and validate tasks
 */
function enhanceTasks(tasks, goal) {
  return tasks.map((task, index) => {
    // Validate required fields
    if (!task.title) {
      throw new Error(`Task ${index} missing title`);
    }

    // Set defaults
    return {
      title: task.title,
      description: task.description || '',
      priority: task.priority || goal.priority || 'P1',
      status: 'queued',
      goal_id: goal.id,
      project_id: goal.project_id || null,
      estimated_hours: task.estimated_hours || null,
      tags: task.tags || [],
      metadata: {
        dependencies: task.dependencies || [],
        planned_by: 'llm',
        planned_at: new Date().toISOString()
      }
    };
  });
}

/**
 * Determine if a goal needs LLM planning
 *
 * Returns true if:
 * - Goal has "complex" flag
 * - Goal description is long and detailed
 * - Goal has no clear sub-tasks
 * - User explicitly requests LLM planning
 */
export function shouldUseLLMPlanner(goal, context = {}) {
  // Explicit flag
  if (context.forceLLM) return true;
  if (context.forceRules) return false;

  // Check goal metadata
  try {
    const content = typeof goal.content === 'string'
      ? JSON.parse(goal.content)
      : goal.content;

    if (content?.use_llm_planner) return true;
    if (content?.complexity === 'complex') return true;
  } catch (e) {
    // Ignore
  }

  // Heuristic: long description suggests complexity
  const descLength = (goal.description || '').length;
  if (descLength > 300) return true;

  // Default: use rules for simplicity
  return false;
}

/**
 * Save planned tasks to database
 */
export async function savePlannedTasks(tasks, goal) {
  const results = [];

  for (const task of tasks) {
    const result = await pool.query(
      `INSERT INTO tasks
       (title, description, priority, status, goal_id, project_id, estimated_hours, tags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        task.title,
        task.description,
        task.priority,
        task.status || 'queued',
        task.goal_id,
        task.project_id,
        task.estimated_hours,
        JSON.stringify(task.tags || []),
        JSON.stringify(task.metadata || {})
      ]
    );

    results.push(result.rows[0]);
  }

  return results;
}

export default {
  planWithLLM,
  shouldUseLLMPlanner,
  savePlannedTasks
};
