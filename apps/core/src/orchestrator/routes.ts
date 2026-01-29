/**
 * Orchestrator Chat API
 * 对话式任务拆解和系统交互
 */

import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Claude client
const anthropic = new Anthropic();

// 系统提示词
const SYSTEM_PROMPT = `你是 Orchestrator，一个智能任务管理助手。你可以：

1. 查看和分析系统状态（Projects、OKR、Tasks）
2. 帮用户拆解需求为具体任务
3. 设置优先级和关联 OKR
4. 回答关于项目进度的问题

回复格式要求：
- 简洁直接，不要啰嗦
- 如果要引用具体对象，用 [[type:id:name]] 格式，如 [[okr:abc123:Brain MVP]]
- 如果建议创建任务，在回复最后加上 actions 数组

回复 JSON 格式：
{
  "message": "你的回复文本，可以包含 [[okr:id:name]] 引用",
  "highlights": ["okr:abc123", "task:def456"],  // 要高亮的对象
  "actions": [  // 可选，建议的操作
    {
      "type": "create-task",
      "label": "创建任务: 设计登录 API",
      "params": { "title": "设计登录 API", "priority": "P1" }
    }
  ]
}`;

/**
 * POST /api/orchestrator/chat
 * 发送消息给 Orchestrator
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    // 获取系统状态
    const systemState = await getSystemState();

    // 构建消息
    const messages = [
      ...history.map((h: any) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content as string
      })),
      {
        role: 'user',
        content: `当前系统状态：
${JSON.stringify(systemState, null, 2)}

用户消息：${message}`
      }
    ];

    // 调用 Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages
    });

    // 解析回复
    const firstBlock = response.content[0];
    const content = firstBlock.type === 'text' ? firstBlock.text : '';
    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch {
      // 如果不是 JSON，包装成标准格式
      parsed = {
        message: content,
        highlights: [],
        actions: []
      };
    }

    res.json({
      success: true,
      response: parsed
    });
  } catch (error: any) {
    console.error('Orchestrator chat error:', error);
    res.status(500).json({
      error: 'Chat failed',
      details: error?.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/orchestrator/action
 * 执行 Orchestrator 建议的动作
 */
router.post('/action', async (req: Request, res: Response) => {
  try {
    const { type, params } = req.body;

    // 转发到 brain action API
    const actionUrl = `http://localhost:${process.env.PORT || 5212}/api/brain/action/${type}`;
    const actionRes = await fetch(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const result = await actionRes.json();
    res.json(result);
  } catch (error: any) {
    console.error('Orchestrator action error:', error);
    res.status(500).json({
      error: 'Action failed',
      details: error?.message || 'Unknown error'
    });
  }
});

/**
 * 获取系统状态摘要
 */
async function getSystemState() {
  const baseUrl = `http://localhost:${process.env.PORT || 5212}`;

  try {
    const [brainRes, projectsRes, goalsRes, tasksRes] = await Promise.all([
      fetch(`${baseUrl}/api/brain/status`),
      fetch(`${baseUrl}/api/tasks/projects`),
      fetch(`${baseUrl}/api/tasks/goals`),
      fetch(`${baseUrl}/api/tasks/tasks?status=queued,in_progress&limit=20`)
    ]);

    const [brain, projects, goals, tasks] = await Promise.all([
      brainRes.json() as Promise<any>,
      projectsRes.json() as Promise<any[]>,
      goalsRes.json() as Promise<any[]>,
      tasksRes.json() as Promise<any[]>
    ]);

    // 构建 OKR 树
    const objectives = goals.filter((g: any) => g.type === 'objective' || !g.parent_id);
    const keyResults = goals.filter((g: any) => g.type === 'key_result' || g.parent_id);

    const okrTrees = objectives.map((obj: any) => ({
      id: obj.id,
      title: obj.title,
      status: obj.status,
      priority: obj.priority,
      progress: obj.progress,
      keyResults: keyResults
        .filter((kr: any) => kr.parent_id === obj.id)
        .map((kr: any) => ({
          id: kr.id,
          title: kr.title,
          progress: kr.progress,
          weight: kr.weight
        }))
    }));

    return {
      focus: brain.daily_focus,
      projects: projects.slice(0, 10).map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status
      })),
      okrTrees: okrTrees.slice(0, 5),
      tasks: {
        total: brain.task_digest?.stats || {},
        top: tasks.slice(0, 10).map((t: any) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          goal_id: t.goal_id
        }))
      }
    };
  } catch (error) {
    console.error('Failed to get system state:', error);
    return { error: 'Failed to load state' };
  }
}

export default router;
