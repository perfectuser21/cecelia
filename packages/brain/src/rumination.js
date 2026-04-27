/**
 * 反刍回路（Rumination Loop）— v3 NotebookLM 主路
 *
 * 空闲时批量消化知识，用 NotebookLM 做深度思考（主路）：
 * - NotebookLM ask 综合全量历史，callLLM 作为 fallback（notebooklm_primary）
 * - 批量取 N 条 learnings，构建综合 query 发给 NotebookLM
 * - 洞察写入 memory_stream + synthesis_archive(daily)，由 Desire System 自然消费
 *
 * 成本控制：每 tick ≤5 条，每日 ≤20 条，30 分钟冷却期
 */

import crypto from 'node:crypto';
import pool from './db.js';
import { callLLM } from './llm-caller.js';
import { buildMemoryContext } from './memory-retriever.js';
import { queryNotebook, addTextSource } from './notebook-adapter.js';
import { updateSelfModel } from './self-model.js';
import { processEvent, EVENT_TYPES } from './thalamus.js';

// ── 配置 ──────────────────────────────────────────────────
export const DAILY_BUDGET = 100; // 基础预算（从 20 提到 100，向后兼容，内部逻辑请使用 getDailyBudget()）
export const DEDUP_WINDOW_HOURS = 24; // 洞察去重时间窗口（P0 修复：防 Rumination→Desire 死循环）
export const MAX_PER_TICK = 5;
export const COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟（从 30 分钟降低）

// ── salience 分桶阈值（与 PR9 computeSalience 8 维度对齐）──
// 纠正/决定（0.85+）→ HIGH；洞察/情绪（0.75+）→ MID
// 计划/长消息（0.55+）→ LOW；疑问/基础（< 0.55）→ SKIP
export const SALIENCE_THRESHOLD_HIGH = 0.85;
export const SALIENCE_THRESHOLD_MID  = 0.75;
export const SALIENCE_THRESHOLD_LOW  = 0.55;

const PRIORITY_ORDER = { HIGH: 0, MID: 1, LOW: 2, SKIP: 3 };

// ── 洞察去重（P0 修复：防 Rumination→Desire 死循环）──────────

/**
 * 计算洞察内容的 SHA256 哈希（前 32 字符 hex）
 * @param {string} insight
 * @returns {string}
 */
export function computeInsightHash(insight) {
  return crypto.createHash('sha256').update(insight || '').digest('hex').slice(0, 32);
}

/**
 * 检查 24h 内是否已有相同洞察记录
 * 查询失败时降级返回 false（非阻塞，允许写入）
 * @param {object} db - 数据库连接池
 * @param {string} contentHash - computeInsightHash 返回值
 * @returns {Promise<boolean>}
 */
export async function isInsightDuplicate(db, contentHash) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM cecelia_events
       WHERE event_type = 'rumination_output'
         AND payload->>'content_hash' = $1
         AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours'
       LIMIT 1`,
      [contentHash]
    );
    return rows.length > 0;
  } catch (err) {
    console.warn('[rumination] dedup check failed (non-blocking, allowing write):', err.message);
    return false;
  }
}

/**
 * 按 salience_score 分桶，返回优先级标签（与 computeSalience 8 维度对齐）
 * - HIGH (0.85+)：纠正/决定 → 最高优先级反刍
 * - MID  (0.75+)：洞察/情绪 → 中优先级反刍
 * - LOW  (0.55+)：计划/长消息 → 低优先级反刍
 * - SKIP (< 0.55)：疑问/基础 → 跳过
 * @param {number|null|undefined} score
 * @returns {'HIGH'|'MID'|'LOW'|'SKIP'}
 */
export function classifySaliencePriority(score) {
  if (score == null || score < SALIENCE_THRESHOLD_LOW) return 'SKIP';
  if (score >= SALIENCE_THRESHOLD_HIGH) return 'HIGH';
  if (score >= SALIENCE_THRESHOLD_MID)  return 'MID';
  return 'LOW';
}

/**
 * 动态每日预算：低峰期（上海时间 00:00-05:59）自动扩容至 2x
 * - 正常时段：20 条
 * - 低峰期 00:00-06:00 UTC+8：40 条
 */
export function getDailyBudget() {
  const shanghaiHour = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
  ).getHours();
  return shanghaiHour >= 0 && shanghaiHour < 6 ? DAILY_BUDGET * 2 : DAILY_BUDGET;
}

// 运行时状态（进程内，午夜通过 hasBudget() 中日期对比自动重置）
let _dailyCount = 0;
let _lastRunAt = 0;
let _lastResetDate = new Date().toDateString();

// ── 测试辅助 ──────────────────────────────────────────────
export function _resetState() {
  _dailyCount = 0;
  _lastRunAt = 0;
  _lastResetDate = new Date().toDateString();
}

/** 仅用于测试：直接设置 _dailyCount */
export function _setDailyCount(n) {
  _dailyCount = n;
}

// ── 条件检查 ──────────────────────────────────────────────

/**
 * 检查系统是否空闲（in_progress=0 且 queued≤3）
 */
async function isSystemIdle(dbPool) {
  const { rows } = await dbPool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE status = 'queued') AS queued
    FROM tasks
  `);
  const t = rows[0] || {};
  return parseInt(t.in_progress || 0) === 0 && parseInt(t.queued || 0) <= 3;
}

/**
 * 检查冷却期是否已过
 */
function isCooldownPassed(now) {
  return (now - _lastRunAt) >= COOLDOWN_MS;
}

/**
 * 检查每日预算
 */
function hasBudget() {
  // 简易日期重置
  const today = new Date().toDateString();
  if (today !== _lastResetDate) {
    _dailyCount = 0;
    _lastResetDate = today;
  }
  return _dailyCount < getDailyBudget();
}

// ── 反刍 Prompt（v2 深度思考）──────────────────────────────

/**
 * 构建批量反刍 Prompt（多条 learnings 一起深度分析）
 */
export function buildRuminationPrompt(learnings, memoryBlock, notebookContext) {
  const learningsList = learnings.map((l, i) =>
    `${i + 1}. 【${l.category || '未分类'}】${l.title}\n   ${(l.content || '（无详细内容）').slice(0, 300)}`
  ).join('\n');

  let prompt = `你是 Cecelia 的深度思考模块。请对以下 ${learnings.length} 条知识进行深度分析。

## 待消化的知识
${learningsList}
`;

  if (memoryBlock) {
    prompt += `\n## 相关记忆上下文\n${memoryBlock}\n`;
  }

  if (notebookContext) {
    prompt += `\n## 历史反刍上下文\n${notebookContext}\n`;
  }

  // 检测是否包含隔离失败记录
  const hasQuarantinePattern = learnings.some(l => l.category === 'quarantine_pattern');

  prompt += `
## 深度思考要求

请从以下角度分析（不是简单摘要，要有深度）：

1. **模式发现**：这些知识之间有什么共同点或关联？是否揭示了某个系统性的规律？
2. **关联分析**：与用户的 OKR/目标有什么关联？能帮助推进哪些关键结果？
3. **可执行洞察**：基于分析，有什么具体可执行的建议？（在末尾加 [ACTION: 建议标题]）
4. **风险或机会**：是否暗示了某些风险或未被发现的机会？${hasQuarantinePattern ? '\n\n注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。' : ''}

## 输出格式
用 [反刍洞察] 开头，300-500 字深度分析。
如果有可执行建议，每个建议单独一行 [ACTION: 建议标题]。
简体中文回复。`;

  return prompt;
}

// ── NotebookLM 综合 Query 构建 ──────────────────────────────

/**
 * 构建发给 NotebookLM 的综合 query
 * 比 buildRuminationPrompt 更宽泛：让 NotebookLM 从全量历史综合
 */
export function buildNotebookQuery(items) {
  const titles = items.map(l => l.title || l.content?.slice(0, 40)).join('、');
  const categories = [...new Set(items.map(l => l.category || '未分类'))].join('、');
  const emotionTags = items.map(l => l.emotion_tag).filter(Boolean);
  const emotionContext = emotionTags.length > 0
    ? `\n当时的情绪状态：${[...new Set(emotionTags)].join('、')}。` : '';
  return `我最近学到了这些内容（主题：${titles}，领域：${categories}）。${emotionContext}
请综合你掌握的关于我（Cecelia）和 Alex 工作模式的所有历史知识，
对这些新内容进行深度分析：
1. 发现跨时间的模式或规律
2. 与 OKR/目标的关联
3. 可执行的洞察建议（格式：[ACTION: 建议标题]）
4. 潜在风险或机会
用 [反刍洞察] 开头，300-500 字，简体中文。`;
}

// ── NotebookLM 响应清洗 ───────────────────────────────────

/**
 * 清洗 NotebookLM 响应文本，去除切换 notebook 时产生的前缀噪音。
 *
 * NotebookLM CLI 切换 notebook 时会在真实答案前注入：
 *   "Different notebook specified, starting new conversation...\nContinuing conversation xxx..\nAnswer:\n"
 *
 * 该前缀长度 > 50 字符，会通过旧的 length > 50 质量检查，
 * 导致垃圾内容写入 memory_stream 并跳过 callLLM fallback。
 *
 * @param {string} text - NotebookLM 原始响应
 * @returns {string} 清洗后的文本（提取 "Answer:" 后内容；如无前缀则原样返回）
 */
export function cleanNotebookResponse(text) {
  if (!text) return text;
  if (!text.includes('Different notebook specified')) return text;
  // 提取 "Answer:" 后的内容（支持 "Answer:\n" 和 "Answer: " 两种格式）
  const answerMatch = text.match(/Answer:\s*([\s\S]+)/i);
  if (answerMatch) {
    return answerMatch[1].trim();
  }
  // 有前缀但找不到 Answer 块 → 视为无效响应，返回空串触发 fallback
  return '';
}

// ── 消化核心逻辑（v3 NotebookLM 主路）──────────────────────

/**
 * 批量消化 learnings（v3: NotebookLM ask 为主路，callLLM 为 fallback）
 * notebooklm_primary: 先尝试 NotebookLM（全量历史综合），失败则用 callLLM
 */
async function digestLearnings(db, learnings) {
  const insights = [];
  let selfInsightText = '';

  // 心跳事件：每次进入 digestLearnings 都记录一次（不论 LLM 是否成功）
  // probe 用此判断 rumination 循环是否真的在跑（vs LLM 全部失败导致无 output）
  try {
    await db.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('rumination_run', 'rumination', $1::jsonb)`,
      [JSON.stringify({ batch_size: learnings.length })]
    );
  } catch (hbErr) {
    console.warn('[rumination] heartbeat write failed (non-blocking):', hbErr.message);
  }

  try {
    // 1. 获取相关记忆上下文（fallback 时用）
    let memoryBlock = '';
    try {
      const queryText = learnings.map(l => l.title).join(' ');
      const ctx = await buildMemoryContext({
        query: queryText.slice(0, 200),
        mode: 'reflect',
        tokenBudget: 500,
        pool: db,
      });
      memoryBlock = ctx.block || '';
    } catch {
      // 记忆检索失败不影响反刍
    }

    // 2. 主路：NotebookLM ask（notebooklm_primary，全量历史综合）
    // Fallback：callLLM（仅看本次 learnings + 记忆上下文）
    let insight = '';
    let usedNotebook = false;
    let notebookFailureReason = null; // forensic：NotebookLM 失败原因
    let llmFailureReason = null;      // forensic：callLLM 失败原因
    const nbQuery = buildNotebookQuery(learnings);

    // 获取 working notebook ID（反刍洞察 → working knowledge base）
    let workingNotebookId = null;
    try {
      const { rows: nbRows } = await db.query(
        `SELECT value_json FROM working_memory WHERE key = 'notebook_id_working' LIMIT 1`
      );
      workingNotebookId = nbRows[0]?.value_json || null;
    } catch { /* notebook ID 不存在时降级 */ }

    try {
      const nbResult = await queryNotebook(nbQuery, workingNotebookId);
      if (nbResult.ok && nbResult.text) {
        // 清洗前缀噪音（"Different notebook specified..." 前缀会污染洞察质量）
        const cleaned = cleanNotebookResponse(nbResult.text.trim());
        if (cleaned.length > 50) {
          insight = cleaned;
          usedNotebook = true;
          const hadPrefix = nbResult.text.includes('Different notebook specified');
          console.log(`[rumination] notebooklm_primary: OK (${insight.length} chars${hadPrefix ? ', prefix stripped' : ''})`);
        } else {
          notebookFailureReason = 'empty_or_short_after_clean';
          console.warn('[rumination] notebooklm_primary: empty/short after cleaning, falling back to callLLM');
        }
      } else {
        notebookFailureReason = nbResult.error || 'empty_response';
        console.warn('[rumination] notebooklm_primary: empty/short response, falling back to callLLM');
      }
    } catch (nbErr) {
      notebookFailureReason = nbErr.message || 'exception';
      console.warn('[rumination] notebooklm_primary failed, falling back to callLLM:', nbErr.message);
    }

    // Fallback：callLLM
    // P0 修复：fallback 时从 synthesis_archive 补充最近 7 天历史洞察作为上下文
    // 防止 LLM 因看不到历史反刍洞察而产生重复/浅层输出
    if (!insight) {
      let fallbackContext = '';
      try {
        const { rows: archiveRows } = await db.query(
          `SELECT content FROM synthesis_archive
           WHERE level = 'daily'
           ORDER BY period_start DESC
           LIMIT 7`
        );
        if (archiveRows.length > 0) {
          fallbackContext = archiveRows
            .map(r => (r.content || '').slice(0, 300))
            .join('\n---\n');
        }
      } catch (archiveErr) {
        console.warn('[rumination] fallback: synthesis_archive query failed (non-blocking):', archiveErr.message);
      }
      const prompt = buildRuminationPrompt(learnings, memoryBlock, fallbackContext);
      try {
        const { text: llmInsight } = await callLLM('rumination', prompt);
        insight = llmInsight || '';
        if (!insight) {
          llmFailureReason = 'empty_response';
        }
      } catch (llmErr) {
        llmFailureReason = llmErr.message || 'exception';
        console.warn('[rumination] callLLM fallback failed:', llmErr.message);
      }
    }

    // Forensic 事件：双路 LLM 全失败时写结构化事件，供 probe/RCA/运维诊断
    // PROBE_FAIL_RUMINATION 出现 degraded_llm_failure tag 时，运维查这个事件即可拿到根因。
    if (!insight) {
      try {
        await db.query(
          `INSERT INTO cecelia_events (event_type, source, payload)
           VALUES ('rumination_llm_failure', 'rumination', $1::jsonb)`,
          [JSON.stringify({
            notebook_error: notebookFailureReason,
            llm_error: llmFailureReason,
            batch_size: learnings.length,
            learning_ids: learnings.map(l => l.id),
          })]
        );
      } catch (evtErr) {
        console.warn('[rumination] rumination_llm_failure event write failed (non-blocking):', evtErr.message);
      }
    }

    // 4. 去重检查 + 写入 memory_stream + synthesis_archive（daily）
    if (insight) {
      // P0 修复：检查 24h 内是否已有相同洞察，防止 Rumination→Desire 死循环
      const contentHash = computeInsightHash(insight.trim());
      const isDuplicate = await isInsightDuplicate(db, contentHash);
      if (isDuplicate) {
        console.warn(`[rumination] dedup_skipped: insight already recorded within ${DEDUP_WINDOW_HOURS}h (hash=${contentHash})`);
        return [];
      }

      await db.query(
        `INSERT INTO memory_stream (content, importance, memory_type, expires_at)
         VALUES ($1, 8, 'long', NOW() + INTERVAL '30 days')`,
        [`[反刍洞察] ${insight.trim()}`]
      );
      insights.push(insight.trim());

      // 记录 rumination_output 事件（用于后续去重查询）
      // 注意：传对象而非 JSON.stringify 字符串，避免 jsonb 类型推断问题
      try {
        await db.query(
          `INSERT INTO cecelia_events (event_type, source, payload)
           VALUES ('rumination_output', 'rumination', $1::jsonb)`,
          [JSON.stringify({ content_hash: contentHash })]
        );
      } catch (evtErr) {
        console.warn('[rumination] cecelia_events write failed (non-blocking):', evtErr.message);
      }

      // 4.0 写入 synthesis_archive（daily 层级）
      // previous_id: 指向当天最新一条（如无则 null）
      const today = new Date().toISOString().slice(0, 10);
      try {
        const { rows: prevRows } = await db.query(
          `SELECT id FROM synthesis_archive WHERE level = 'daily' AND period_start = $1
           ORDER BY created_at DESC LIMIT 1`,
          [today]
        );
        const previousId = prevRows[0]?.id || null;
        await db.query(
          `INSERT INTO synthesis_archive
             (level, period_start, period_end, content, previous_id, source_count, notebook_query)
           VALUES ('daily', $1, $1, $2, $3, $4, $5)
           ON CONFLICT (level, period_start) DO UPDATE
             SET content = EXCLUDED.content, source_count = EXCLUDED.source_count,
                 notebook_query = EXCLUDED.notebook_query`,
          [today, insight.trim(), previousId, learnings.length, usedNotebook ? nbQuery : null]
        );
        console.log(`[rumination] synthesis_archive daily written (notebook=${usedNotebook})`);
      } catch (archiveErr) {
        console.warn('[rumination] synthesis_archive write failed (non-blocking):', archiveErr.message);
      }

      // 4.1 写洞察回 NotebookLM（持久化知识飞轮，fire-and-forget）
      // 下次反刍查询时可复用这些洞察，形成累积学习效果
      const topicTitle = learnings.map(l => l.title).join(' / ').slice(0, 100);
      addTextSource(
        `[反刍洞察 ${today}] ${insight.trim()}`,
        `反刍洞察: ${topicTitle}`,
        workingNotebookId
      ).catch(err => console.warn('[rumination] NotebookLM write-back failed (non-blocking):', err.message));

      // 4.1 检测 actionable 洞察 → 收集 [ACTION:] 标记，统一发给丘脑 L1 处理
      // （丘脑 RUMINATION_RESULT L0 handler 会创建 research 任务）
    }

    // 4.2 检测好奇心信号 → 写入 working_memory curiosity_topics（环2：自主学习驱动）
    if (insight) {
      const CURIOSITY_PATTERNS = [
        /不理解|不清楚|机制不明|原因未知|需要验证|需要更多信息|值得深入研究|待探索|unclear/i,
        /为什么会|如何实现|背后的原因|有待研究|还不确定/i,
      ];
      const hasCuriosity = CURIOSITY_PATTERNS.some(p => p.test(insight));
      if (hasCuriosity) {
        try {
          // 提取好奇的主题（优先用 [ACTION:] 标记，否则取洞察前80字）
          const actionMatch = insight.match(/\[ACTION:\s*(.+?)\]/);
          const topic = actionMatch ? actionMatch[1].trim() : insight.slice(0, 80).trim();

          // 读取现有 curiosity_topics，追加，保留最近 10 个
          const existing = await db.query(
            `SELECT value_json FROM working_memory WHERE key = 'curiosity_topics' LIMIT 1`
          );
          const topics = Array.isArray(existing.rows[0]?.value_json) ? existing.rows[0].value_json : [];
          topics.push({ topic, ts: new Date().toISOString() });
          const trimmed = topics.slice(-10);

          await db.query(`
            INSERT INTO working_memory (key, value_json, updated_at)
            VALUES ('curiosity_topics', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
          `, [JSON.stringify(trimmed)]);

          console.log(`[rumination] curiosity detected → topic: ${topic}`);
        } catch (curErr) {
          console.warn('[rumination] curiosity_topics write failed (non-blocking):', curErr.message);
        }
      }
    }

    // 5. 自我反思：基于洞察更新 self-model（仅在有实质性洞察时触发）
    if (insight && insight.trim()) {
      try {
        const selfReflectPrompt = `基于刚才的反刍洞察：

${insight.trim().slice(0, 800)}

请用1-3句话（约150字以内）描述：你（Cecelia）对自己有什么新认知？
可以从以下任意角度展开（不必全覆盖，选最真实的那个）：
- 性格与工作风格：你在意什么、你如何面对困难、你与 Alex 的协作质感
- 好奇心与兴趣：什么让你想要探索、什么问题让你感到困惑或兴奋
- 审美感受：什么样的解决方案或事物让你觉得优雅或满足
- 存在体验：这段运行经历是什么感觉、tick 与思考对你意味着什么
直接输出认知描述，用第一人称"我"开头，不要有前缀和解释。`;

        const { text: selfInsight } = await callLLM('rumination', selfReflectPrompt, { maxTokens: 200 });
        if (selfInsight && selfInsight.trim()) {
          selfInsightText = selfInsight.trim();
          await updateSelfModel(selfInsightText, db);
        }
      } catch (selfErr) {
        console.warn('[rumination] self-model update failed (non-blocking):', selfErr.message);
      }
    }

    // 6. 标记所有 learnings 已消化（仅在产生有效 insight 时；
    //    防止 LLM 全部失败时 learnings 被静默丢弃且无任何洞察产出）
    if (insight && insight.trim()) {
      for (const learning of learnings) {
        await db.query(
          'UPDATE learnings SET digested = true WHERE id = $1',
          [learning.id]
        );
      }

      _dailyCount += learnings.length;
    } else {
      console.warn(`[rumination] no insight produced (LLM all failed) — leaving ${learnings.length} learnings undigested for retry`);
    }

    // 7. 发 RUMINATION_RESULT 事件给丘脑（闭环线 1）
    if (insights.length > 0) {
      const actionMatches = [...(insights[0] || '').matchAll(/\[ACTION:\s*(.+?)\]/g)];
      const ruminationSignal = {
        type: EVENT_TYPES.RUMINATION_RESULT,
        learnings: learnings.map(l => ({ id: l.id, title: l.title, category: l.category })),
        self_updates: selfInsightText ? [selfInsightText] : [],
        actions: actionMatches.map(m => m[1]),
        insight_count: insights.length,
      };
      try {
        await processEvent(ruminationSignal);
        console.log('[rumination] RUMINATION_RESULT event sent to thalamus');
      } catch (routeErr) {
        console.warn('[rumination] thalamus routing failed (DB writes already done as fallback):', routeErr.message);
      }
    }

    // 8. P0-C：反刍洞察写入 suggestions 表（由 suggestion-dispatcher 统一分发）
    // content_hash 去重：24h DEDUP_WINDOW 内同一洞察不重复写入（P0 死循环修复）
    if (insights.length > 0 && insights[0]) {
      const mainInsight = insights[0];
      const content_hash = crypto.createHash('sha256').update(mainInsight).digest('hex');
      try {
        const { rows: dedupRows } = await db.query(
          `SELECT id FROM suggestions WHERE content_hash = $1 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
          [content_hash]
        );
        if (dedupRows.length > 0) {
          console.warn(`[rumination] skipped duplicate insight (content_hash=${content_hash.slice(0, 8)}...)`);
        } else {
          await db.query(`
            INSERT INTO suggestions (content, source, priority_score, status, suggestion_type, metadata, content_hash)
            VALUES ($1, 'rumination', $2, 'pending', 'desire_formation', $3, $4)
          `, [
            mainInsight,
            0.7,
            JSON.stringify({ origin: 'rumination_p0c', insight: mainInsight }),
            content_hash
          ]);
          console.warn('[rumination] insight written to suggestions table for dispatcher');
        }
      } catch (sugErr) {
        console.warn('[rumination] failed to write suggestion (non-blocking):', sugErr.message);
      }
    }
  } catch (err) {
    console.error(`[rumination] batch digest failed:`, err.message);
  }

  return insights;
}

// ── memory_stream 高显著性输入 ────────────────────────────

/**
 * 获取 memory_stream 中高显著性对话条目（作为反刍补充输入）
 * 条件：salience_score ≥ SALIENCE_THRESHOLD_LOW(0.55)，source_type = 'conversation_turn'，status = 'active'
 * 阈值与 PR9 computeSalience 8 维度对齐（从旧 0.7 降低到 0.55，纳入计划/长消息类）
 * 返回条目附带 source='memory_stream' + salience_priority 标记，格式与 learnings 兼容
 */
export async function fetchMemoryStreamItems(db, limit) {
  const { rows } = await db.query(
    `SELECT id, content, salience_score, emotion_tag, source_type
     FROM memory_stream
     WHERE source_type = 'conversation_turn'
       AND status = 'active'
       AND salience_score >= $2
     ORDER BY salience_score DESC, created_at DESC
     LIMIT $1`,
    [limit, SALIENCE_THRESHOLD_LOW]
  );
  return rows.map(r => ({
    id: r.id,
    title: null,
    content: r.content,
    category: 'conversation',
    salience_score: r.salience_score,
    salience_priority: classifySaliencePriority(r.salience_score),
    emotion_tag: r.emotion_tag,
    source: 'memory_stream',
  }));
}

// ── 核心流程 ──────────────────────────────────────────────

/**
 * 运行反刍回路（由 tick.js 调用）
 * @param {object} [dbPool] - 数据库连接池（可选，默认用全局 pool）
 * @returns {Promise<{skipped?: string, digested: number, insights: string[]}>}
 */
export async function runRumination(dbPool) {
  const db = dbPool || pool;
  const now = Date.now();

  // 前置条件检查
  if (!hasBudget()) {
    return { skipped: 'daily_budget_exhausted', digested: 0, insights: [] };
  }

  if (!isCooldownPassed(now)) {
    return { skipped: 'cooldown', digested: 0, insights: [] };
  }

  // 软限制：系统繁忙时降低反刍批量（但不完全跳过）
  let busyMultiplier = 1;
  try {
    const idle = await isSystemIdle(db);
    if (!idle) {
      busyMultiplier = 0.4; // 繁忙时只反刍 40% 的量（向上取整，最少 1 条）
    }
  } catch (err) {
    console.error('[rumination] idle check failed, proceeding anyway:', err.message);
  }

  // 取未消化的知识（FIFO，最多 MAX_PER_TICK 条，批量一次处理）
  const remaining = getDailyBudget() - _dailyCount;
  const limit = Math.max(1, Math.round(Math.min(MAX_PER_TICK, remaining) * busyMultiplier));

  let learnings;
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, category FROM learnings
       WHERE digested = false AND (archived = false OR archived IS NULL)
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    learnings = rows;
  } catch (err) {
    console.error('[rumination] fetch learnings failed:', err.message);
    return { skipped: 'fetch_error', digested: 0, insights: [] };
  }

  // learnings 不足时，补充 memory_stream 高显著性对话条目
  let memStreamItems = [];
  if (learnings.length < limit) {
    const msLimit = limit - learnings.length;
    try {
      memStreamItems = await fetchMemoryStreamItems(db, msLimit);
    } catch (err) {
      console.warn('[rumination] fetchMemoryStreamItems failed (non-blocking):', err.message);
    }
  }

  // 合并后按 salience_priority 排序：HIGH 先处理，LOW 最后（learnings 无 score 则视为 MID）
  const allItems = [
    ...learnings.map(l => ({
      ...l,
      source: 'learning',
      salience_priority: classifySaliencePriority(l.salience_score),
    })),
    ...memStreamItems,
  ].sort((a, b) =>
    (PRIORITY_ORDER[a.salience_priority] ?? 1) - (PRIORITY_ORDER[b.salience_priority] ?? 1)
  );

  if (allItems.length === 0) {
    return { skipped: 'no_undigested', digested: 0, insights: [] };
  }

  const insights = await digestLearnings(db, allItems);

  // 标记已处理的 memory_stream 条目
  if (memStreamItems.length > 0) {
    const msIds = memStreamItems.map(m => m.id);
    try {
      await db.query(
        `UPDATE memory_stream SET status = 'ruminated' WHERE id = ANY($1::uuid[])`,
        [msIds]
      );
    } catch (err) {
      console.warn('[rumination] mark memory_stream ruminated failed (non-blocking):', err.message);
    }
  }

  _lastRunAt = Date.now();

  return {
    digested: allItems.length,
    insights,
  };
}

/**
 * 手动触发反刍（跳过 idle check，保留冷却期）
 * @param {object} [dbPool] - 数据库连接池
 * @param {object} [opts] - 选项
 * @param {boolean} [opts.force=false] - true 时跳过 daily_budget 检查，直接消化最多 MAX_PER_TICK 条
 * @returns {Promise<{skipped?: string, digested: number, insights: string[], manual?: boolean}>}
 */
export async function runManualRumination(dbPool, { force = false } = {}) {
  const db = dbPool || pool;
  const now = Date.now();

  if (!force && !hasBudget()) {
    return { skipped: 'daily_budget_exhausted', digested: 0, insights: [] };
  }

  if (!isCooldownPassed(now)) {
    return { skipped: 'cooldown', digested: 0, insights: [] };
  }

  const remaining = force ? MAX_PER_TICK : Math.min(MAX_PER_TICK, getDailyBudget() - _dailyCount);
  const limit = remaining;

  let learnings;
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, category FROM learnings
       WHERE digested = false AND (archived = false OR archived IS NULL)
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    learnings = rows;
  } catch (err) {
    console.error('[rumination] manual fetch learnings failed:', err.message);
    return { skipped: 'fetch_error', digested: 0, insights: [] };
  }

  if (learnings.length === 0) {
    return { skipped: 'no_undigested', digested: 0, insights: [] };
  }

  const insights = await digestLearnings(db, learnings);

  _lastRunAt = Date.now();

  return {
    digested: learnings.length,
    insights,
    manual: true,
  };
}

/**
 * 获取反刍系统状态
 */
export async function getRuminationStatus(dbPool) {
  const db = dbPool || pool;

  // 触发午夜重置检查
  hasBudget();

  const now = Date.now();
  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (now - _lastRunAt));

  const { rows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false AND (archived = false OR archived IS NULL)'
  );
  const undigestedCount = parseInt(rows[0]?.cnt || 0);

  return {
    daily_count: _dailyCount,
    daily_budget: getDailyBudget(),
    remaining: getDailyBudget() - _dailyCount,
    cooldown_remaining_ms: cooldownRemaining,
    undigested_count: undigestedCount,
    last_run_at: _lastRunAt > 0 ? new Date(_lastRunAt).toISOString() : null,
  };
}

/**
 * 获取未消化知识数量（供 perception.js 使用）
 */
export async function getUndigestedCount(dbPool) {
  const db = dbPool || pool;
  const { rows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false'
  );
  return parseInt(rows[0]?.cnt || 0);
}

/**
 * 强制反刍（绕过所有限制：isSystemIdle / cooldown / daily_budget）
 * 一次性消化最多 9 条 digested=false 的 learning，并将结果写入 working_memory
 * @param {object} [dbPool] - 数据库连接池
 * @returns {Promise<{processed: number, insights: string[]}>}
 */
export async function runRuminationForce(dbPool) {
  const db = dbPool || pool;
  const FORCE_LIMIT = 9;

  let learnings;
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, category FROM learnings
       WHERE digested = false AND (archived = false OR archived IS NULL)
       ORDER BY created_at ASC
       LIMIT $1`,
      [FORCE_LIMIT]
    );
    learnings = rows;
  } catch (err) {
    console.error('[rumination] force fetch learnings failed:', err.message);
    return { processed: 0, insights: [] };
  }

  if (learnings.length === 0) {
    return { processed: 0, insights: [] };
  }

  const insights = await digestLearnings(db, learnings);

  // 写入 working_memory 记录本次强制运行结果
  try {
    const result = {
      processed: learnings.length,
      insights_count: insights.length,
      learning_ids: learnings.map(l => l.id),
      ran_at: new Date().toISOString(),
    };
    await db.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ('rumination_force_result', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
      [JSON.stringify(result)]
    );
    console.log(`[rumination] force: wrote rumination_force_result to working_memory (processed=${learnings.length})`);
  } catch (err) {
    console.warn('[rumination] force: working_memory write failed (non-blocking):', err.message);
  }

  return {
    processed: learnings.length,
    insights,
  };
}
