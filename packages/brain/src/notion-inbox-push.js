/**
 * notion-inbox-push.js — F5 呈报+裁决窄口回读
 *
 * 两半：
 *   1. 呈报面：pending_review capture_atoms → Notion 个人收件箱（含 AI摘要/建议去向/置信度/需拍板）
 *   2. 裁决窄口：仅读白名单结构化字段（✅放行/❌不放行/✏️批注），消费即清+幂等锚点
 *
 * 决策: efa578b8（异步指挥模式）+ 4c595c84（裁决窄口）
 *
 * fail-closed 规则：
 *   - Notion API 失败 → 不执行任何动作，不抛出
 *   - 字段解析失败/非白名单 → 不执行任何动作
 *   - 散文/自由文本字段 → 永不回读
 *   - 已消费条目 → 幂等跳过
 */
import { notionReq, getToken } from './recurring-notion-sync.js';

// 裁决 select 选项白名单（严格匹配，任何其他值视为未裁决）
const VERDICT_APPROVE = '✅放行';
const VERDICT_REJECT  = '❌不放行';
const VERDICT_COMMENT = '✏️批注';
const VERDICT_PENDING = '待裁决';

export const WHITELIST_VERDICTS = new Set([VERDICT_APPROVE, VERDICT_REJECT, VERDICT_COMMENT]);

// 向外导出给测试用
export const VERDICT_MAP = {
  [VERDICT_APPROVE]: 'approve',
  [VERDICT_REJECT]:  'reject',
  [VERDICT_COMMENT]: 'comment',
};

const BATCH_PUSH_LIMIT  = 10;
const BATCH_READ_LIMIT  = 20;
const MAX_SUMMARY_LEN   = 500;
const MAX_CONTENT_LEN   = 1000;

function buildRichText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

function plainText(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map(t => t.plain_text || '').join('');
}

/**
 * 从 capture_atom content 生成 AI 摘要（简单截断，无 LLM 调用——避免嵌套 AI 成本）。
 * 实际部署后可替换为轻量 LLM 摘要；接口不变。
 */
function generateSummary(content) {
  if (!content) return '';
  const text = String(content).trim();
  // 取第一个换行前或前 MAX_SUMMARY_LEN 字符
  const firstLine = text.split('\n')[0].trim();
  return firstLine.slice(0, MAX_SUMMARY_LEN) || text.slice(0, MAX_SUMMARY_LEN);
}

/**
 * 根据 capture_atom target_type/content 推断建议去向。
 * 返回字符串 select 选项值。
 */
function inferSuggestedDir(atom) {
  const { target_type, target_subtype, content = '' } = atom;
  if (target_type === 'learning') return '存档/归知';
  if (target_type === 'issue')    return '立即处理';
  if (target_type === 'handoff')  return '传递下游';
  if (/fail|error|dead|kill/i.test(content)) return '立即处理';
  return '择期决策';
}

/**
 * 判断是否需要主理人拍板（需拍板类：花钱/架构/优先级调整）。
 */
function detectNeedsApproval(atom) {
  const { content = '', target_subtype = '' } = atom;
  const flags = [
    /budget|quota|费用|花钱|预算/i.test(content),
    /architecture|arch_review|架构/i.test(content),
    /priority|优先级|P0/i.test(content),
    /quarantine_pattern/i.test(target_subtype),
  ];
  return flags.some(Boolean);
}

/**
 * 获取或自动建 Notion 个人收件箱 DB。
 *
 * 优先级：
 *   1. env NOTION_PERSONAL_INBOX_DB_ID
 *   2. working_memory key 'notion_personal_inbox_db_id'
 *   3. 自动建库（parent: NOTION_INBOX_PARENT_PAGE_ID 或默认父页）
 *
 * 返回 DB ID 字符串，失败返回 null（调用者 fail-closed）。
 */
export async function getOrCreateInboxDb(pool, token) {
  // 1. 环境变量
  if (process.env.NOTION_PERSONAL_INBOX_DB_ID) {
    return process.env.NOTION_PERSONAL_INBOX_DB_ID;
  }

  // 2. working_memory
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'notion_personal_inbox_db_id' LIMIT 1`
    );
    if (rows[0]?.value_json?.db_id) return rows[0].value_json.db_id;
  } catch (e) {
    console.warn('[notion-inbox] working_memory 读失败:', e.message);
  }

  // 3. 自动建库
  const parentPageId = process.env.NOTION_INBOX_PARENT_PAGE_ID || '342c40c2-ba63-8390-b2d0-01db940f1a6e';
  try {
    const db = await notionReq(token, '/databases', 'POST', {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: '🎯 Cecelia 收件箱' } }],
      properties: {
        名称:     { title: {} },
        摘要:     { rich_text: {} },
        建议去向: { select: { options: [
          { name: '立即处理',  color: 'red' },
          { name: '择期决策',  color: 'yellow' },
          { name: '传递下游',  color: 'blue' },
          { name: '存档/归知', color: 'gray' },
        ] } },
        置信度:   { number: { format: 'percent' } },
        需拍板:   { checkbox: {} },
        裁决:     { select: { options: [
          { name: VERDICT_PENDING, color: 'default' },
          { name: VERDICT_APPROVE, color: 'green'   },
          { name: VERDICT_REJECT,  color: 'red'     },
          { name: VERDICT_COMMENT, color: 'yellow'  },
        ] } },
        批注:     { rich_text: {} },
        来源类型: { select: { options: [
          { name: 'capture_atom',   color: 'blue'   },
          { name: 'morning_report', color: 'purple' },
          { name: 'contract',       color: 'orange' },
        ] } },
        来源ID:   { rich_text: {} },
      },
    });

    const dbId = db.id;
    await pool.query(
      `INSERT INTO working_memory (key, value_json, expires_at)
       VALUES ('notion_personal_inbox_db_id', $1::jsonb, NULL)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`,
      [JSON.stringify({ db_id: dbId })]
    ).catch(() => {});
    console.log('[notion-inbox] 自动建库成功:', dbId);
    return dbId;
  } catch (err) {
    console.warn('[notion-inbox] 自动建库失败:', err.message);
    return null;
  }
}

/**
 * 呈报面：将 pending_review capture_atoms 推送到 Notion 个人收件箱。
 * 每次最多推 BATCH_PUSH_LIMIT 条，幂等（idempotency_key = 'atom:' + atom.id）。
 */
export async function pushCapturesToNotionInbox(pool) {
  let token;
  try { token = getToken(); } catch { return; }

  const dbId = await getOrCreateInboxDb(pool, token);
  if (!dbId) return;

  const { rows: atoms } = await pool.query(`
    SELECT ca.*, c.content AS capture_content
    FROM capture_atoms ca
    LEFT JOIN captures c ON c.id = ca.capture_id
    WHERE ca.status = 'pending_review'
      AND NOT EXISTS (
        SELECT 1 FROM notion_inbox_items nii
        WHERE nii.idempotency_key = 'atom:' || ca.id::text
          AND nii.status IN ('pushed', 'consumed')
      )
    ORDER BY ca.created_at ASC
    LIMIT $1
  `, [BATCH_PUSH_LIMIT]);

  for (const atom of atoms) {
    const idempotencyKey = `atom:${atom.id}`;
    const content = atom.content || atom.capture_content || '';
    const summary = generateSummary(content);
    const suggestedDir = inferSuggestedDir(atom);
    const needsApproval = detectNeedsApproval(atom);
    const confidence = parseFloat(atom.confidence) || 0.7;

    try {
      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: dbId },
        properties: {
          名称:     { title: buildRichText(summary || content.slice(0, 100)) },
          摘要:     { rich_text: buildRichText(summary) },
          建议去向: { select: { name: suggestedDir } },
          置信度:   { number: confidence },
          需拍板:   { checkbox: needsApproval },
          裁决:     { select: { name: VERDICT_PENDING } },
          来源类型: { select: { name: 'capture_atom' } },
          来源ID:   { rich_text: buildRichText(atom.id) },
        },
        children: content ? [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: buildRichText(content.slice(0, MAX_CONTENT_LEN)) },
        }] : [],
      });

      await pool.query(
        `INSERT INTO notion_inbox_items
           (source_type, source_id, notion_page_id, ai_summary, suggested_dir, confidence,
            needs_approval, status, pushed_at, idempotency_key)
         VALUES ('capture_atom', $1, $2, $3, $4, $5, $6, 'pushed', now(), $7)
         ON CONFLICT (idempotency_key) DO UPDATE
           SET notion_page_id = EXCLUDED.notion_page_id,
               status = 'pushed',
               pushed_at = now(),
               updated_at = now()`,
        [atom.id, page.id, summary, suggestedDir, confidence, needsApproval, idempotencyKey]
      );
    } catch (err) {
      console.warn(`[notion-inbox] atom ${atom.id} 推送失败: ${err.message}`);
      await pool.query(
        `INSERT INTO notion_inbox_items
           (source_type, source_id, status, idempotency_key)
         VALUES ('capture_atom', $1, 'failed', $2)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [atom.id, idempotencyKey]
      ).catch(() => {});
    }
  }
}

/**
 * 从 Notion 页面 properties 中解析裁决字段（fail-closed）。
 *
 * 白名单：裁决 select 属性仅接受 ✅放行 / ❌不放行 / ✏️批注。
 * 任何其他值（待裁决/空/散文）→ 返回 null（不执行任何动作）。
 * 批注内容来自 批注 rich_text 属性，而非散文页面正文。
 *
 * @param {object} props  Notion page.properties
 * @returns {{ verdict: 'approve'|'reject'|'comment', comment?: string } | null}
 */
export function parseVerdictFromProps(props) {
  if (!props || typeof props !== 'object') return null;

  // 只读 select 类型的裁决字段
  const verdictProp = props['裁决'];
  if (!verdictProp || verdictProp.type !== 'select') return null;

  const selectedName = verdictProp.select?.name;
  if (!selectedName || !WHITELIST_VERDICTS.has(selectedName)) return null;

  const verdict = VERDICT_MAP[selectedName];
  if (!verdict) return null;

  // 读批注字段（仅 rich_text，散文正文不读）
  let comment = null;
  if (verdict === 'comment') {
    const commentProp = props['批注'];
    if (commentProp?.type === 'rich_text') {
      comment = plainText(commentProp.rich_text).trim() || null;
    }
    // 若无批注内容则仍返回 comment 裁决（让调用方处理）
  }

  return { verdict, comment: comment || null };
}

/**
 * 执行裁决：approve → 状态流转+decisions留痕；reject → 驳回；comment → 建修订任务。
 * 消费即清：消费后更新 consumed_at + status='consumed'（幂等）。
 */
async function executeVerdict(pool, item, parsedVerdict) {
  const { verdict, comment } = parsedVerdict;

  if (verdict === 'approve') {
    // capture_atom → confirmed
    await pool.query(
      `UPDATE capture_atoms SET status = 'confirmed', updated_at = now() WHERE id = $1::uuid`,
      [item.source_id]
    ).catch(() => {});

    // decisions 留痕（决策 4c595c84 要求）
    const topic = `Notion收件箱放行: ${item.ai_summary || item.source_id}`;
    await pool.query(
      `INSERT INTO decisions (topic, decision, reason, category, trigger, author, made_by, status)
       VALUES ($1, $2, $3, 'agent_ops', 'notion_inbox', 'notion', 'user', 'active')
       ON CONFLICT DO NOTHING`,
      [
        topic.slice(0, 200),
        `放行 capture_atom ${item.source_id}，建议去向: ${item.suggested_dir || '未知'}`,
        `主理人在 Notion 收件箱标记 ✅放行，幂等键: ${item.idempotency_key}`,
      ]
    ).catch(() => {});

  } else if (verdict === 'reject') {
    await pool.query(
      `UPDATE capture_atoms SET status = 'dismissed', updated_at = now() WHERE id = $1::uuid`,
      [item.source_id]
    ).catch(() => {});

  } else if (verdict === 'comment') {
    // 建修订任务
    const revisionTitle = `[修订] ${item.ai_summary || item.source_id}`;
    const desc = comment
      ? `主理人批注: ${comment}\n\n原 capture_atom: ${item.source_id}`
      : `主理人标记需修订，capture_atom: ${item.source_id}`;

    await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       VALUES ($1, $2, 'dev', 'queued', 'P2', $3::jsonb)`,
      [
        revisionTitle.slice(0, 200),
        desc,
        JSON.stringify({ source: 'notion_inbox_comment', capture_atom_id: item.source_id, notion_page_id: item.notion_page_id }),
      ]
    ).catch(() => {});
  }
}

/**
 * 裁决窄口回读：轮询已推 Notion 收件箱，消费白名单结构化裁决字段。
 *
 * fail-closed：
 *   - Notion API 失败 → 跳过
 *   - 字段解析失败 → 跳过
 *   - 散文/非 select → 跳过
 *   - 需拍板但未点 ✅ → 跳过
 */
export async function readNotionInboxVerdicts(pool) {
  let token;
  try { token = getToken(); } catch { return; }

  const { rows: items } = await pool.query(`
    SELECT * FROM notion_inbox_items
    WHERE status = 'pushed'
      AND notion_page_id IS NOT NULL
      AND consumed_at IS NULL
    ORDER BY pushed_at ASC
    LIMIT $1
  `, [BATCH_READ_LIMIT]);

  for (const item of items) {
    try {
      const page = await notionReq(token, `/pages/${item.notion_page_id}`, 'GET');
      const props = page?.properties;
      if (!props) continue;

      const parsed = parseVerdictFromProps(props);
      if (!parsed) continue;

      // 需拍板 flag：未点 ✅ 放行则不执行（决策 4c595c84 要求）
      if (item.needs_approval && parsed.verdict !== 'approve') continue;

      // 幂等：先标记 consumed 再执行，防止重入
      const { rowCount } = await pool.query(
        `UPDATE notion_inbox_items
         SET status = 'consumed', verdict = $1, verdict_comment = $2, consumed_at = now(), updated_at = now()
         WHERE id = $3 AND status = 'pushed'`,
        [parsed.verdict, parsed.comment, item.id]
      );
      if (rowCount === 0) continue; // 已被并发消费

      await executeVerdict(pool, item, parsed);

    } catch (err) {
      console.warn(`[notion-inbox] item ${item.id} 裁决回读失败: ${err.message}`);
    }
  }
}
