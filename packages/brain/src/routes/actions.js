import { Router } from 'express';
import pool from '../db.js';
import { readFileSync } from 'fs';
import { createTask, updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks } from '../actions.js';
import { parseIntent, parseAndCreate, INTENT_TYPES, INTENT_ACTION_MAP, _extractEntities, _classifyIntent, _getSuggestedAction } from '../intent.js';
import { getPendingActions, approvePendingAction, rejectPendingAction, addProposalComment, selectProposalOption, _expireStaleProposals } from '../decision-executor.js';
import { _createProposal, _approveProposal, _rollbackProposal, _rejectProposal, _getProposal, _listProposals } from '../proposal.js';
import { _handleChat, _handleChatStream } from '../orchestrator-chat.js';
import { callLLM, _callLLMStream } from '../llm-caller.js';
import { ALLOWED_ACTIONS, checkIdempotency, saveIdempotency, internalLogDecision } from './shared.js';

const router = Router();

// 秋米 /decomp skill 内容
let _decompSkillContent = '';
try {
  _decompSkillContent = readFileSync(
    '/Users/administrator/perfect21/cecelia/packages/workflows/skills/decomp/SKILL.md', 'utf-8'
  );
  console.log('[autumnrice] decomp SKILL.md loaded:', _decompSkillContent.length, 'chars');
} catch (e) {
  console.warn('[autumnrice] decomp SKILL.md not found, using basic persona:', e.message);
}

// ==================== Pending Actions API（危险动作审批） ====================

/**
 * GET /api/brain/pending-actions
 * 获取待审批动作列表
 */
router.get('/pending-actions', async (req, res) => {
  try {
    const actions = await getPendingActions();
    res.json({ success: true, count: actions.length, actions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get pending actions', details: err.message });
  }
});

/**
 * GET /api/brain/pending-actions/:id
 * 获取单个 pending action 详情
 */
router.get('/pending-actions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM pending_actions WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, action: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get pending action', details: err.message });
  }
});

/**
 * PATCH /api/brain/pending-actions/:id/context
 * 更新 pending action 的 context 字段（UI 内联编辑用）
 * Body: { initiatives: string[] }
 */
router.patch('/pending-actions/:id/context', async (req, res) => {
  try {
    const { id } = req.params;
    const { initiatives } = req.body || {};
    if (!Array.isArray(initiatives)) {
      return res.status(400).json({ error: 'initiatives must be an array' });
    }
    const result = await pool.query(
      `UPDATE pending_actions
       SET context = context || jsonb_build_object('initiatives', $1::jsonb),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, context`,
      [JSON.stringify(initiatives), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, action: result.rows[0] });
  } catch (err) {
    console.error('[PATCH /pending-actions/:id/context]', err);
    res.status(500).json({ error: 'Failed to update context', details: err.message });
  }
});

/**
 * GET /api/brain/pending-actions/:id/versions
 * 查询同一 KR 的所有 okr_decomp_review 版本历史
 */
router.get('/pending-actions/:id/versions', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await pool.query(
      `SELECT context FROM pending_actions WHERE id = $1`,
      [id]
    );
    const ctx = current.rows[0]?.context || {};
    // 优先用 kr_id，没有则用 kr_title 匹配同一 KR 的所有版本
    let versions;
    if (ctx.kr_id) {
      versions = await pool.query(
        `SELECT id, context, status, created_at FROM pending_actions
         WHERE action_type = 'okr_decomp_review' AND context->>'kr_id' = $1
         ORDER BY created_at ASC`,
        [ctx.kr_id]
      );
    } else if (ctx.kr_title) {
      versions = await pool.query(
        `SELECT id, context, status, created_at FROM pending_actions
         WHERE action_type = 'okr_decomp_review' AND context->>'kr_title' = $1
         ORDER BY created_at ASC`,
        [ctx.kr_title]
      );
    } else {
      return res.json({ success: true, versions: [] });
    }
    res.json({ success: true, versions: versions.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get versions', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions
 * 创建新的 pending action（部门主管向 Cecelia 提案）
 * Body: { action_type, requester, context? }
 */
router.post('/pending-actions', async (req, res) => {
  try {
    const { action_type, requester, context } = req.body || {};
    if (!action_type || !requester) {
      return res.status(400).json({ error: 'action_type and requester are required' });
    }
    const result = await pool.query(`
      INSERT INTO pending_actions
        (action_type, params, context, status, source, comments)
      VALUES ($1, '{}', $2, 'pending_approval', 'repo-lead', '[]'::jsonb)
      RETURNING id, action_type, status, source, created_at
    `, [action_type, JSON.stringify({ requester, ...(context || {}) })]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create pending action', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/approve
 * 批准并执行待审批动作
 * Body: { reviewer?: string }
 */
router.post('/pending-actions/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer } = req.body || {};

    const result = await approvePendingAction(id, reviewer || 'api-user');

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve action', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/reject
 * 拒绝待审批动作
 * Body: { reviewer?: string, reason?: string }
 */
router.post('/pending-actions/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer, reason } = req.body || {};

    const result = await rejectPendingAction(id, reviewer || 'api-user', reason || '');

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject action', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/comment
 * 追加评论到提案对话
 * Body: { text: string, role?: 'user'|'cecelia' }
 */
router.post('/pending-actions/:id/comment', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, role } = req.body || {};

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await addProposalComment(id, text.trim(), role || 'user');
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/select
 * 选择提案选项并执行
 * Body: { option_id: string, reviewer?: string }
 */
router.post('/pending-actions/:id/select', async (req, res) => {
  try {
    const { id } = req.params;
    const { option_id, reviewer } = req.body || {};

    if (!option_id) {
      return res.status(400).json({ error: 'option_id is required' });
    }

    const result = await selectProposalOption(id, option_id, reviewer || 'dashboard-user');
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ success: true, execution_result: result.execution_result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to select option', details: err.message });
  }
});

/**
 * POST /api/brain/autumnrice/chat
 * 与秋米直接对话，讨论 OKR 拆解结果
 * Body: { pending_action_id: string, message: string }
 * 秋米加载 KR + 拆解上下文，回复用户，并将对话存入 pending_actions.comments
 */
router.post('/autumnrice/chat', async (req, res) => {
  try {
    const { pending_action_id, message } = req.body || {};

    if (!pending_action_id || !message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'pending_action_id and message are required' });
    }

    // 加载 pending_action（含拆解上下文和历史对话）
    const actionResult = await pool.query(
      `SELECT id, action_type, context, params, comments, status FROM pending_actions WHERE id = $1`,
      [pending_action_id]
    );
    if (actionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pending action not found' });
    }

    const action = actionResult.rows[0];
    if (action.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Pending action already processed' });
    }

    const ctx = action.context || {};
    const existingComments = Array.isArray(action.comments) ? action.comments : [];

    // 加载 KR OKR 上下文（注入秋米 prompt，提供历史参考）
    const krId = ctx.kr_id || null;
    let okrCtxBlock = '';
    if (krId) {
      try {
        // 先查 key_results，再查 objectives（向后兼容）
        let krRes = await pool.query(
          `SELECT id, title, status,
                  CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
                  objective_id AS parent_id
           FROM key_results WHERE id = $1`,
          [krId]
        );
        if (krRes.rows.length === 0) {
          krRes = await pool.query(
            `SELECT id, title, status, NULL::numeric AS progress, NULL::uuid AS parent_id
             FROM objectives WHERE id = $1`,
            [krId]
          );
        }
        if (krRes.rows.length > 0) {
          const kr = krRes.rows[0];
          let objTitle = '';
          if (kr.parent_id) {
            const objRes = await pool.query(
              `SELECT title FROM objectives WHERE id = $1`,
              [kr.parent_id]
            );
            if (objRes.rows[0]) objTitle = `\n**上级 Objective**：${objRes.rows[0].title}`;
          }
          const words = (kr.title || '').split(/[\s，。、\-_]+/).filter(w => w.length > 1).slice(0, 4);
          let simBlock = '';
          if (words.length > 0) {
            const lc = words.map((_, i) => `title ILIKE $${i + 2}`).join(' OR ');
            const sims = (await pool.query(
              `SELECT title, status,
                      CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress
               FROM key_results WHERE id!=$1 AND (${lc}) ORDER BY created_at DESC LIMIT 3`,
              [krId, ...words.map(w => `%${w}%`)]
            )).rows;
            if (sims.length > 0) simBlock = `\n**历史相似 KR**：\n${sims.map(s => `  - ${s.title}（${s.status}，${s.progress ?? 0}%）`).join('\n')}`;
          }
          okrCtxBlock = `${objTitle}${simBlock}`;
        }
      } catch (e) {
        console.warn('[autumnrice/chat] okr-context fetch failed:', e.message);
      }
    }

    // 构建秋米的 system prompt（聚焦 KR 定义质量讨论）
    const decompSkillBlock = _decompSkillContent
      ? `# 你的核心技能（/decomp Skill 完整版）\n\n${_decompSkillContent}\n\n---\n\n`
      : '';

    const systemPrompt = `${decompSkillBlock}你是秋米（autumnrice），Cecelia 系统中的 OKR 拆解专家。

当前正在讨论以下 KR（关键结果）的定义质量：

**KR**：${ctx.kr_title || '未知'}
${okrCtxBlock}

你的任务是帮助用户评估并确认这个 KR 的定义质量：
1. **量化指标**：这个 KR 是否有明确的 from/to 数值？是否可以客观验收？
2. **目标合理性**：结合历史相似 KR，目标是否激进但可达？周期是否合理？
3. **范围清晰度**：这个 KR 的边界是否清晰？和其他 KR 是否有重叠？
4. **可行性**：是否有支撑条件（技术可行、资源够用）？

如果用户对 KR 定义满意，引导他们点击左侧"确认放行 KR"按钮，之后系统将自动开始拆解。

## 重要能力：你可以触发重新拆解

**如果用户要求重新拆解**（说"重新拆"、"重拆"、"重做"、"再拆一次"等），你有能力触发重拆：
- 系统会自动检测这些关键词，重置 KR 状态，下一个 Tick 会启动新一轮完整拆解
- 你的回复应告诉用户："已为你触发重拆，系统正在重新分析，请稍等片刻"

注意：你是秋米，不是 Cecelia。直接以秋米的身份回应，保持专业、简洁、务实的风格。`;

    // 构建历史对话
    const historyParts = existingComments
      .filter(c => c.role === 'user' || c.role === 'autumnrice')
      .map(c => {
        const roleLabel = c.role === 'user' ? '用户' : '秋米';
        const content = c.text || c.content || '';
        return `${roleLabel}：${content}`;
      });

    const historyBlock = historyParts.length > 0
      ? `\n## 之前的对话\n${historyParts.join('\n\n')}\n\n`
      : '';

    const fullPrompt = `${systemPrompt}${historyBlock}\n## 用户最新消息\n${message.trim()}\n\n请回复用户（直接输出回复内容，不要输出"秋米："前缀）：`;

    // 调用 LLM（/autumnrice/chat 是对话接口，走 mouth 的模型配置）
    const { text: reply } = await callLLM('mouth', fullPrompt, {
      model: 'claude-sonnet-4-6',
      timeout: 90000,
      maxTokens: 800,
    });

    const now = new Date().toISOString();
    const userComment = { role: 'user', text: message.trim(), ts: now };
    const autumnriceComment = { role: 'autumnrice', text: reply, ts: now };

    // 存入 pending_actions.comments
    await pool.query(
      `UPDATE pending_actions SET comments = comments || $1::jsonb WHERE id = $2 AND status = 'pending_approval'`,
      [JSON.stringify([userComment, autumnriceComment]), pending_action_id]
    );

    // 重拆意图检测
    const REDECOMP_TRIGGERS = ['重新拆', '重拆', '重做', '重新分析', '重新规划', '再拆一次'];
    const isRedecomp = REDECOMP_TRIGGERS.some(kw => message.includes(kw));

    let redecompTriggered = false;
    if (isRedecomp) {
      // 优先用 context.kr_id，没有则用 kr_title 反查
      let resolvedKrId = ctx.kr_id || null;
      if (!resolvedKrId && ctx.kr_title) {
        // 先查 key_results，再查 objectives（向后兼容）
        let krResult = await pool.query(
          `SELECT id FROM key_results WHERE title = $1 LIMIT 1`,
          [ctx.kr_title]
        );
        if (krResult.rows.length === 0) {
          krResult = await pool.query(
            `SELECT id FROM objectives WHERE title = $1 LIMIT 1`,
            [ctx.kr_title]
          );
        }
        if (krResult.rows.length > 0) resolvedKrId = krResult.rows[0].id;
      }
      if (resolvedKrId) {
        await pool.query(
          `UPDATE key_results SET status='ready', updated_at=NOW() WHERE id=$1`,
          [resolvedKrId]
        );
        redecompTriggered = true;
        console.log(`[autumnrice/chat] redecomp triggered for KR: ${resolvedKrId}`);
      } else {
        console.warn(`[autumnrice/chat] redecomp: could not find KR for action ${pending_action_id}`);
      }
    }

    res.json({ success: true, reply, comment: autumnriceComment, redecomp_triggered: redecompTriggered });
  } catch (err) {
    console.error('[autumnrice/chat] Error:', err.message);
    res.status(500).json({ error: 'Failed to chat with autumnrice', details: err.message });
  }
});

// ==================== 动作执行 API（白名单 + 幂等） ====================

// POST /api/brain/snapshot — removed (perception.js deleted, createSnapshot no longer available)

/**
 * 通用 Action 处理器
 * 白名单检查 + 幂等性 + 自动记录决策
 */
async function handleAction(actionName, params, idempotencyKey, trigger = 'api') {
  // 1. 白名单检查
  const schema = ALLOWED_ACTIONS[actionName];
  if (!schema) {
    return { success: false, error: `Action '${actionName}' not allowed` };
  }

  // 2. 必填参数检查
  for (const field of schema.required) {
    if (params[field] === undefined) {
      return { success: false, error: `Missing required field: ${field}` };
    }
  }

  // 3. 幂等性检查
  const idempotency = checkIdempotency(idempotencyKey);
  if (idempotency.isDuplicate) {
    return { success: true, duplicate: true, previousResult: idempotency.previousResult };
  }

  // 4. 执行动作
  let result;
  try {
    switch (actionName) {
      case 'create-task':
        result = await createTask(params);
        break;
      case 'update-task':
        result = await updateTask(params);
        break;
      case 'batch-update-tasks':
        result = await batchUpdateTasks(params);
        break;
      case 'create-goal':
        result = await createGoal(params);
        break;
      case 'update-goal':
        result = await updateGoal(params);
        break;
      case 'set-memory':
        result = await setMemory(params);
        break;
      case 'trigger-n8n':
        result = await triggerN8n(params);
        break;
      default:
        result = { success: false, error: 'Unknown action' };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  // 5. 保存幂等键
  saveIdempotency(idempotencyKey, result);

  // 6. 记录决策日志（内部自动记录）
  await internalLogDecision(trigger, `Action: ${actionName}`, { action: actionName, params }, result);

  return result;
}

// 保留原有的快捷路由（内部调用统一处理器）
router.post('/action/create-task', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `create-task-${params.title}-${Date.now()}`;
  const result = await handleAction('create-task', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

/**
 * POST /api/brain/action/create-initiative
 * Create an Initiative (写入 projects 表, type='initiative', parent_id 指向 Project)
 * 秋米专用：拆解 KR 时创建 Initiative
 */
router.post('/action/create-initiative', async (req, res) => {
  try {
    const { name, parent_id, kr_id, decomposition_mode, description, plan_content, domain, owner_role } = req.body;

    if (!name || !parent_id) {
      return res.status(400).json({
        success: false,
        error: 'name and parent_id are required'
      });
    }

    const { createInitiative } = await import('../actions.js');
    const result = await createInitiative({
      name,
      parent_id,
      kr_id,
      decomposition_mode: decomposition_mode || 'known',
      description,
      plan_content,
      domain,
      owner_role
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create initiative',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/action/create-project
 * Create a Project (写入 projects 表, type='project')
 */
router.post('/action/create-project', async (req, res) => {
  try {
    const { name, description, repo_path, repo_paths, kr_ids, domain, owner_role } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const { createProject } = await import('../actions.js');
    const result = await createProject({
      name,
      description,
      repo_path,
      repo_paths,
      kr_ids,
      domain,
      owner_role,
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/action/create-scope
 * Create a Scope (写入 projects 表, type='scope')
 * Scope = 2-3 天的功能边界分组，介于 Project 和 Initiative 之间
 */
router.post('/action/create-scope', async (req, res) => {
  try {
    const { name, parent_id, description, domain, owner_role } = req.body;

    if (!name || !parent_id) {
      return res.status(400).json({
        success: false,
        error: 'name and parent_id are required'
      });
    }

    const { createScope } = await import('../actions.js');
    const result = await createScope({
      name,
      parent_id,
      description,
      domain,
      owner_role,
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create scope',
      details: err.message
    });
  }
});

router.post('/action/update-task', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `update-task-${params.task_id}-${params.status || params.priority}`;
  const result = await handleAction('update-task', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/batch-update-tasks', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `batch-${JSON.stringify(params.filter)}-${Date.now()}`;
  const result = await handleAction('batch-update-tasks', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/create-goal', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `create-goal-${params.title}-${Date.now()}`;
  const result = await handleAction('create-goal', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/update-goal', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `update-goal-${params.goal_id}-${params.status || params.progress}`;
  const result = await handleAction('update-goal', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/set-memory', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `set-memory-${params.key}`;
  const result = await handleAction('set-memory', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/trigger-n8n', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `trigger-n8n-${params.webhook_path}-${Date.now()}`;
  const result = await handleAction('trigger-n8n', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

/**
 * POST /api/brain/action/:actionName
 * 统一 Action 入口（catch-all，必须在所有具体路由之后注册）
 */
router.post('/action/:actionName', async (req, res) => {
  try {
    const { actionName } = req.params;
    const { idempotency_key, trigger, ...params } = req.body;

    // 生成幂等键（如果没提供）
    const key = idempotency_key || `${actionName}-${crypto.randomUUID()}`;

    const result = await handleAction(actionName, params, key, trigger || 'api');

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(500).json({ error: 'Action failed', details: err.message });
  }
});

// 注意：log-decision 不再对外暴露，由 handleAction 内部自动记录

// ==================== Query Status Handler ====================

/**
 * Execute a query_status intent by fetching relevant data
 */
async function executeQueryStatus(parsedIntent) {
  const entities = parsedIntent.entities || {};
  const result = { handler: 'queryStatus', data: {} };

  if (entities.module || entities.feature) {
    const searchTerm = entities.module || entities.feature;
    const tasks = await pool.query(`
      SELECT id, title, status, priority, updated_at
      FROM tasks
      WHERE title ILIKE $1 OR description ILIKE $1
      ORDER BY priority ASC, updated_at DESC
      LIMIT 20
    `, [`%${searchTerm}%`]);
    result.data.tasks = tasks.rows;
    result.data.query = `Tasks matching "${searchTerm}"`;
  } else {
    const [tasks, goals] = await Promise.all([
      pool.query(`
        SELECT id, title, status, priority, updated_at
        FROM tasks
        WHERE status NOT IN ('completed', 'cancelled')
        ORDER BY priority ASC, updated_at DESC
        LIMIT 20
      `),
      // 新 OKR 表：UNION ALL objectives + key_results（UUID 与旧 goals 相同）
      pool.query(`
        SELECT id, title, status, priority, progress
        FROM key_results
        WHERE status NOT IN ('completed', 'cancelled')
        UNION ALL
        SELECT id, title, status, priority, 0 AS progress
        FROM objectives
        WHERE status NOT IN ('completed', 'cancelled')
        ORDER BY priority ASC
        LIMIT 10
      `)
    ]);
    result.data.tasks = tasks.rows;
    result.data.goals = goals.rows;
    result.data.summary = {
      open_tasks: tasks.rows.length,
      active_goals: goals.rows.length
    };
    result.data.query = 'General status overview';
  }

  return result;
}

// ==================== Intent API（KR1 意图识别）====================

/**
 * POST /api/brain/intent/parse
 * Parse natural language input and return structured intent
 *
 * Request body:
 *   { input: "我想做一个 GMV Dashboard" }
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: {
 *       originalInput: "...",
 *       intentType: "create_project",
 *       confidence: 0.8,
 *       keywords: ["做一个"],
 *       projectName: "gmv-dashboard",
 *       tasks: [...],
 *       prdDraft: "..."
 *     }
 *   }
 */
router.post('/intent/parse', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const parsed = await parseIntent(input);

    res.json({
      success: true,
      parsed,
      intent_types: INTENT_TYPES
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to parse intent',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/intent/create
 * Parse intent and create resources (project, tasks) in database
 *
 * Request body:
 *   {
 *     input: "我想做一个 GMV Dashboard",
 *     options: {
 *       createProject: true,
 *       createTasks: true,
 *       goalId: null,
 *       projectId: null
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: {...},
 *     created: {
 *       project: {...},
 *       tasks: [...]
 *     }
 *   }
 */
router.post('/intent/create', async (req, res) => {
  try {
    const { input, options = {} } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const result = await parseAndCreate(input, options);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to parse and create',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/intent/types
 * Get available intent types
 */
router.get('/intent/types', (req, res) => {
  res.json({
    success: true,
    types: INTENT_TYPES,
    description: {
      create_project: '创建新项目（如：我想做一个 GMV Dashboard）',
      create_feature: '添加新功能（如：给登录页面加一个忘记密码功能）',
      create_goal: '创建目标（如：创建一个 P0 目标：提升系统稳定性）',
      create_task: '创建任务（如：添加一个任务：修复登录超时）',
      query_status: '查询状态（如：当前有哪些任务？）',
      fix_bug: '修复 Bug（如：修复购物车页面的价格显示问题）',
      refactor: '重构代码（如：重构用户模块的代码结构）',
      explore: '探索/调研（如：帮我看看这个 API 怎么用）',
      question: '提问（如：为什么这里会报错？）',
      unknown: '无法识别的意图'
    },
    action_map: INTENT_ACTION_MAP
  });
});

/**
 * POST /api/brain/intent/execute
 * Parse intent and automatically execute the mapped brain action
 *
 * Request body:
 *   { input: "创建一个 P0 目标：提升系统稳定性", dry_run: false }
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: { intentType, confidence, suggestedAction, ... },
 *     executed: { action: "create-goal", result: {...} }
 *   }
 */
router.post('/intent/execute', async (req, res) => {
  try {
    const { input, dry_run = false, confidence_threshold } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const parsed = await parseIntent(input);
    const actionMapping = INTENT_ACTION_MAP[parsed.intentType] || { action: null, handler: null };

    // Dry run: return parsed intent without executing
    if (dry_run) {
      return res.json({
        success: true,
        parsed,
        actionMapping,
        executed: null,
        message: 'Dry run - no action executed'
      });
    }

    // Confidence threshold check (default 0.4, configurable)
    const threshold = confidence_threshold ?? 0.4;
    if (parsed.confidence < threshold) {
      return res.json({
        success: true,
        parsed,
        actionMapping,
        executed: null,
        message: `Confidence ${parsed.confidence.toFixed(2)} below threshold ${threshold} - no action executed`
      });
    }

    // Path 1: Direct brain action (via handleAction for whitelist + idempotency + logging)
    if (parsed.suggestedAction) {
      const { action, params } = parsed.suggestedAction;
      const idempotencyKey = `intent-${action}-${crypto.randomUUID()}`;
      const result = await handleAction(action, params, idempotencyKey, 'intent-execute');

      return res.json({
        success: true,
        parsed,
        actionMapping,
        executed: { type: 'action', action, params, result }
      });
    }

    // Path 2: Handler-based execution
    if (actionMapping.handler) {
      let handlerResult;

      if (actionMapping.handler === 'queryStatus') {
        handlerResult = await executeQueryStatus(parsed);
      } else if (actionMapping.handler === 'parseAndCreate') {
        const createResult = await parseAndCreate(input);
        handlerResult = {
          handler: 'parseAndCreate',
          project: createResult.created.project,
          tasks: createResult.created.tasks
        };
      }

      if (handlerResult) {
        await internalLogDecision(
          'intent-execute',
          input.slice(0, 200),
          { handler: actionMapping.handler, intentType: parsed.intentType },
          handlerResult
        );

        return res.json({
          success: true,
          parsed,
          actionMapping,
          executed: { type: 'handler', handler: actionMapping.handler, result: handlerResult }
        });
      }
    }

    // No action or handler matched
    res.json({
      success: true,
      parsed,
      actionMapping,
      executed: null,
      message: 'No action or handler mapped for this intent type'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to execute intent',
      details: err.message
    });
  }
});

// ==================== Enhanced Intent API (PRD: Intent Enhancement) ====================

/**
 * POST /api/brain/parse-intent
 * Parse natural language input and return structured intent with entities
 * Enhanced version with phrase matching and entity extraction
 *
 * Request body:
 *   { input: "我想给用户管理模块添加批量导入功能" }
 *
 * Response:
 *   {
 *     success: true,
 *     intentType: "create_feature",
 *     confidence: 0.85,
 *     entities: { module: "用户管理", feature: "批量导入" },
 *     suggestedTasks: [...]
 *   }
 */
router.post('/parse-intent', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const parsed = await parseIntent(input);

    // Format response according to PRD specification
    res.json({
      success: true,
      intentType: parsed.intentType,
      confidence: parsed.confidence,
      keywords: parsed.keywords,
      matchedPhrases: parsed.matchedPhrases,
      entities: parsed.entities,
      projectName: parsed.projectName,
      suggestedTasks: parsed.tasks.map(t => ({
        title: t.title,
        priority: t.priority,
        description: t.description
      })),
      prdDraft: parsed.prdDraft
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to parse intent',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/intent-to-tasks
 * Convert intent directly to tasks in database
 *
 * Request body:
 *   {
 *     input: "我想给用户管理模块添加批量导入功能",
 *     options: {
 *       createProject: false,
 *       projectId: "uuid",
 *       goalId: "uuid"
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     intent: { type, confidence, entities },
 *     tasksCreated: [{ id, title, priority, status }]
 *   }
 */
router.post('/intent-to-tasks', async (req, res) => {
  try {
    const { input, options = {} } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    // Parse and create in database
    const result = await parseAndCreate(input, {
      createProject: options.createProject !== false,
      createTasks: true,
      projectId: options.projectId || null,
      goalId: options.goalId || null
    });

    res.json({
      success: true,
      intent: {
        type: result.parsed.intentType,
        confidence: result.parsed.confidence,
        entities: result.parsed.entities,
        keywords: result.parsed.keywords
      },
      projectUsed: result.created.project ? {
        id: result.created.project.id,
        name: result.created.project.name,
        created: result.created.project.created
      } : null,
      tasksCreated: result.created.tasks.map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status
      }))
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to convert intent to tasks',
      details: err.message
    });
  }
});

// ==================== Execution Callback API ====================

/**
 * POST /api/brain/execution-callback
 * Webhook endpoint for cecelia-run to report execution completion
 *
 * Request body:
 *   {
 *     task_id: "uuid",
 *     run_id: "run-xxx-timestamp",
 *     checkpoint_id: "cp-xxx",
 *     status: "AI Done" | "AI Failed",
 *     result: { ... },  // JSON result from cecelia-run
 *     pr_url: "https://github.com/...",  // optional
 *     duration_ms: 123456,
 *     iterations: 3
 *   }
 */

export default router;
