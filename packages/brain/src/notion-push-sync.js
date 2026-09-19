import { notionReq, getToken } from './recurring-notion-sync.js';
import { createRoutedTask } from './work-routing-store.js';
import { execFileSync as nodeExecFileSync } from 'child_process';
import { sshTargetFor } from './machine-registry.js';
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { computeProgress } from './advancement-progress.js';
import { buildWorkflowPageBlocks } from './ops-collector.js';
import { pushRegisteredRows, resolveDbId } from './lib/notion-projection-engine.js';

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB  = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';
// AI Notes DB — decisions 用 Type=Decision，initiative_contracts 用 Type=Contract
const DECISIONS_DB           = '185c40c2-ba63-828c-973f-81a9c4582cd6';
const INITIATIVE_CONTRACTS_DB = '185c40c2-ba63-828c-973f-81a9c4582cd6';

// Notion 任务编排库（2026-09-13 双向·push 半边接线；库早已存在但 Brain 从未接）
const NOTION_TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';
// 排单分流 OpenClaw（2026-09-14 v2 数据驱动）：Tasks 库 relation「Workflow」「Agent」
// 指向运行舱四表的真实 Notion 行（workflows_db/graph_db，见 working_memory.ops_notion_dbs），
// pull 反查 ops_workflows/ops_agents.notion_id 拿 dispatch 人工列（migration 444）：
//   workflow.dispatch.webhook_url  = 派发入口（缺省回退 env.N8N_V4_WEBHOOK_URL）
//   agent.dispatch.template        = 租户任务模板文件名（OPENCLAW_DISPATCH_DIR 下）
// 禁止在代码里枚举执行方——排单可选项即两张 ops 表本身（决策：主理人 2026-09-14 纠正）。

export const TASK_STATUS_TO_NOTION = Object.freeze({
  queued: 'Delegated',
  in_progress: 'In Progress',
  blocked: 'Planned',
  completed: 'Done',
  failed: 'Cancelled',
  canceled: 'Cancelled',
  cancelled: 'Cancelled',
});

const SKILL_REGISTRY_DB  = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7';
const STEP_LINKS_DB      = '369c40c2-ba63-81e2-b95a-e5e3d0592676';

// 2026-09-13 实测修复：旧 6 个 ID 对 Notion API 全 404（页面早已不存在），
// 导致每条 brain/engine issue 推送 404 → isStaleRelationError 静默标已同步
// （notion_id 为空）= 无声丢弃。真 ID 取自 Sub Area 库
// 300c40c2-ba63-82d5-9ec1-81990d181950 实查（承诺地图分区），映射按 repo 区归就近价值区。
const SUB_AREA_NOTION_IDS = {
  brain:         '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d', // Cecelia
  engine:        '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d', // Cecelia
  cecelia:       '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d', // Cecelia
  'multi-agent': '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d', // Cecelia
  zenithjoy:     'cf5c40c2-ba63-82c8-a00a-015c593f6268', // ZenithJoy
  dashboard:     'a17c40c2-ba63-83e2-b922-8197b09af030', // Dashboard
};

function buildRichText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

/**
 * 把一条 decision 映射成 Notion AI Notes 库的 properties。
 * 纯函数 — 不打 Notion 网络，可独立确定性验证（合同 Golden Path Step 2 oracle）。
 *
 * - level → Level 属性
 * - scope → Scope 属性
 * - ability 的 notion_id → Ability relation（链到对应 ability 页）
 *
 * @param {object} decision  decisions 裸行（含 level/scope/topic/decision...）
 * @param {string|null} abilityNotionId  target ability 的 journey_features.notion_id
 * @param {object} schemaProps  可选：AI Notes 库的 properties schema（{ Level: {type}, Scope: {type} }）。
 *   用于把 Level/Scope 发成库实际属性类型（status vs select）—— 参照 Feature 库 Status 必须用
 *   status 类型的教训（发错类型 Notion 返回 400）。schema 取不到时回退 select。
 */
export function buildDecisionNotionProperties(decision = {}, abilityNotionId = null, schemaProps = {}) {
  const title = decision.topic
    || (decision.decision ? String(decision.decision).slice(0, 100) : '')
    || String(decision.id || '');
  const properties = {
    Title: { title: [{ text: { content: title } }] },
    Type: { select: { name: 'Decision' } },
  };
  // 按库实际属性类型发 Level/Scope；schema 缺失时默认 select（多数自定义属性为 select）
  const typedValue = (propName, value) =>
    schemaProps?.[propName]?.type === 'status'
      ? { status: { name: value } }
      : { select: { name: value } };
  if (decision.level) properties.Level = typedValue('Level', decision.level);
  if (decision.scope) properties.Scope = typedValue('Scope', decision.scope);
  // ability relation —— 属性名优先用 schema 里的 relation 字段名，回退 'Ability'
  if (abilityNotionId) {
    const relProp = Object.keys(schemaProps || {}).find(
      (k) => schemaProps[k]?.type === 'relation' && /abilit/i.test(k)
    ) || 'Ability';
    properties[relProp] = { relation: [{ id: abilityNotionId }] };
  }
  return properties;
}

// 404 "Could not find page" = stale relation ID，永久标记为已同步阻止无限重试
function isStaleRelationError(err) {
  return err.message && err.message.includes('Could not find page');
}

/**
 * 400 schema 不符 = notion_id 指向「错库」页面（legacy 遗留绑错库），
 * 属性名/类型对不上 → 解绑重建才是出路，重试一万次也不会成功。
 * 2026-09-16 实证：249 条 legacy 行每轮重试刷屏（269 次/2h 日志噪音）。
 */
function isWrongDatabaseError(err) {
  const m = err?.message || '';
  return /400/.test(m) && /is not a property that exists|is expected to be/.test(m);
}

async function logSyncError(pool, errMsg) {
  await pool.query(
    `INSERT INTO notion_sync_log (direction, records_synced, records_failed, error_message)
     VALUES ('to_notion', 0, 1, $1)`,
    [errMsg]
  ).catch(() => {});
}

async function pushJourneys(pool, token) {
  const { rows } = await pool.query(`
    SELECT j.*, a.notion_id AS area_notion_id
    FROM journeys j
    LEFT JOIN areas a ON a.id = j.area_id
    WHERE j.notion_synced_at IS NULL OR j.updated_at > j.notion_synced_at
    ORDER BY j.notion_synced_at NULLS FIRST, j.updated_at
    LIMIT 10
  `);
  if (rows.length === 0) return;
  const dbId = JOURNEY_DB || await resolveDbId(pool, 'journeys');
  await pushRegisteredRows(pool, token, {
    table: 'journeys', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'journey',
    buildProps: (j) => {
      const properties = {
        Name: { title: [{ text: { content: j.name } }] },
        Description: { rich_text: buildRichText(j.description) },
        'Journey Type': { select: { name: j.journey_type } },
        Maturity: { select: { name: j.maturity } },
        Status: { select: { name: j.status || 'active' } },
      };
      // E2E Test Path 字段在 Notion Journey DB 不存在，不推
      if (j.area_notion_id) properties['Area'] = { relation: [{ id: j.area_notion_id }] };
      return properties;
    },
  });
}
async function pushJourneyFeatures(pool, token) {
  const { rows } = await pool.query(`
    SELECT f.*, j.notion_id AS journey_notion_id, a.notion_id AS area_notion_id
    FROM journey_features f
    LEFT JOIN journeys j ON j.id = f.journey_id
    LEFT JOIN areas a ON a.id = f.area_id
    WHERE (f.notion_synced_at IS NULL OR f.updated_at > f.notion_synced_at)
      AND (f.journey_id IS NULL OR j.notion_id IS NOT NULL)
    ORDER BY f.notion_synced_at NULLS FIRST, f.updated_at
    LIMIT 10
  `);
  if (rows.length === 0) return;
  const dbId = FEATURE_DB || await resolveDbId(pool, 'journey_features');
  await pushRegisteredRows(pool, token, {
    table: 'journey_features', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'feature',
    buildProps: (f) => {
      const properties = {
        Name: { title: [{ text: { content: f.name } }] },
        // Kind: Notion select 选项首字母大写；DB 小写 → 映射，避免自动创建重复小写选项
        Kind: { select: { name: (f.kind || 'feature') === 'ability' ? 'Ability' : 'Feature' } },
        // Status: Notion Feature 库该属性是 status 类型（非 select）
        Status: { status: { name: f.status || 'planned' } },
      };
      if (f.thickness) properties['Thickness'] = { select: { name: f.thickness } };
      if (f.journey_notion_id) properties['Journey'] = { relation: [{ id: f.journey_notion_id }] };
      if (f.area_notion_id) properties['Area'] = { relation: [{ id: f.area_notion_id }] };
      if (f.unit_test_path) properties['Unit Test Path'] = { rich_text: buildRichText(f.unit_test_path) };
      return properties;
    },
  });
}
async function pushIssues(pool, token) {
  const { rows } = await pool.query(
    `SELECT * FROM issues
      WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
      ORDER BY notion_synced_at NULLS FIRST, updated_at LIMIT 10`);
  if (rows.length === 0) return;
  const dbId = ISSUES_DB || await resolveDbId(pool, 'issues');
  await pushRegisteredRows(pool, token, {
    table: 'issues', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'issue',
    buildProps: (issue) => {
      const properties = {
        Issue: { title: [{ text: { content: issue.title } }] },
        Priority: { select: { name: issue.priority || 'P2' } },
        Status: { status: { name: issue.status || 'In progress' } },
      };
      if (issue.sub_area && SUB_AREA_NOTION_IDS[issue.sub_area]) {
        properties['Sub Area'] = { relation: [{ id: SUB_AREA_NOTION_IDS[issue.sub_area] }] };
      }
      return properties;
    },
    buildChildren: (issue) => issue.body ? [{
      object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(issue.body) },
    }] : undefined,
  });
}
/**
 * Brain tasks → Notion Tasks 库（d5bc40c2）。
 * 三条纪律：
 *  1. 范围=活任务(queued/in_progress/blocked)+近7天终态，历史不进驾驶舱；
 *  2. 幂等指纹 notion_props.pushed_status——tasks.updated_at 被 tick 定时 touch
 *     不能当增量判据，status 未变不重推；
 *  3. 13483 条历史 notion_id 是旧时代遗产指向别处：仅当 notion_props 带本指纹
 *     才 PATCH，否则一律 create 新页并覆盖（防打错对象）。
 */
async function pushTasks(pool, token) {
  const { rows } = await pool.query(`
    SELECT id, title, status, priority, task_type, notion_id, notion_props
      FROM tasks
     WHERE (notion_props->>'pushed_status') IS DISTINCT FROM status
       AND (
         status IN ('queued','in_progress','blocked')
         OR (status IN ('completed','failed','canceled','cancelled')
             AND updated_at > NOW() - INTERVAL '7 days')
       )
     ORDER BY updated_at DESC
     LIMIT 10`);
  await pushTaskRows(pool, token, rows);
}

/** 可测内核：对给定行执行推送（导出仅供测试注入行数据） */
export async function pushTasksForTest(pool, token, rows) {
  return pushTaskRows(pool, token, rows);
}

async function pushTaskRows(pool, token, rows) {
  for (const t of rows) {
    try {
      const notionStatus = TASK_STATUS_TO_NOTION[t.status] || 'Planned';
      const properties = {
        Name: { title: [{ text: { content: `[${t.priority || 'P2'}] ${String(t.title || '').slice(0, 180)}` } }] },
        Status: { status: { name: notionStatus } },
        Description: { rich_text: buildRichText(`${t.task_type || 'task'} · brain:${t.id}`) },
      };
      const managed = t.notion_props && t.notion_props.pushed_status && t.notion_id;
      if (managed) {
        await notionReq(token, `/pages/${t.notion_id}`, 'PATCH', { properties });
        await pool.query(
          `UPDATE tasks SET notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('pushed_status', $2::text), notion_synced_at=NOW() WHERE id=$1`,
          [t.id, t.status],
        );
      } else {
        const page = await notionReq(token, '/pages', 'POST', {
          parent: { database_id: NOTION_TASKS_DB },
          properties,
        });
        await pool.query(
          `UPDATE tasks SET notion_id=$2, notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('pushed_status', $3::text), notion_synced_at=NOW() WHERE id=$1`,
          [t.id, page.id, t.status],
        );
      }
    } catch (err) {
      console.warn(`[notion-push-sync] task ${t.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
      // 我方页面被人在 Notion 删除(404)，或 legacy id 绑到错库(400 schema 不符)
      // → 清指纹与 id，下轮 create 重建到正确的库
      if ((/404/.test(err.message) && t.notion_props?.pushed_status) || isWrongDatabaseError(err)) {
        await pool.query(
          `UPDATE tasks SET notion_id=NULL, notion_props = notion_props - 'pushed_status' WHERE id=$1`,
          [t.id],
        ).catch(() => {});
      }
    }
  }
}

// 页面正文可拼接的 block 类型（rich_text 承载体）
const PAGE_CONTENT_BLOCK_TYPES = Object.freeze([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'code',
]);

/**
 * 拉取 Notion 页面正文（blocks API）作为任务 prompt（2026-09-17）。
 * 主理人把任务描述写在排单页正文里 → 送达执行体。
 * 只拼接文本类 block 的 rich_text plain_text，块间换行，截断 8000 字符。
 * 任何异常 console.warn 后返回 ''——正文是增强件，绝不阻塞排单主流程。
 */
export async function fetchNotionPageContent(token, pageId) {
  try {
    const resp = await notionReq(token, `/blocks/${pageId}/children?page_size=100`, 'GET');
    const lines = [];
    for (const block of resp?.results ?? []) {
      const type = block?.type;
      if (!PAGE_CONTENT_BLOCK_TYPES.includes(type)) continue;
      const text = (block[type]?.rich_text ?? [])
        .map((t) => t.plain_text ?? t.text?.content ?? '').join('');
      if (text.trim()) lines.push(text);
    }
    return lines.join('\n').slice(0, 8000);
  } catch (err) {
    console.warn(`[notion-pull] 页面正文拉取失败 ${pageId}（不阻塞排单）: ${err.message}`);
    return '';
  }
}

/**
 * Notion Tasks 库 → Brain 接手（双向·pull 半边，2026-09-14）。
 * 主理人在 Notion 新建行并把 Status 拖到 Delegated 即"排单"：
 *  · 只认 Status=Delegated 且 Description 不含 brain: 标记的页（幂等防重复接手）
 *  · 接手任务落 status='blocked'——map 扫描器未迁 us-vps 前 kernel 准入不通，
 *    直接 queued 会被 tick 抓去撞墙三连 autoblock；error_message 注明等待路由。
 *    map 刀落地后由 unblock 流程放行。
 *  · notion_props.pushed_status 写入=当前 status，防 pushTasks 反手改用户的 Delegated
 *  · Name 前缀 [P0-3] 解析 priority，缺省 P2；回执 `brain:<id> ✓已接管` PATCH 回页面
 */
async function pullNotionTasks(pool, token, opts = {}) {
  let resp;
  try {
    resp = await notionReq(token, `/databases/${NOTION_TASKS_DB}/query`, 'POST', {
      page_size: 20,
      filter: { property: 'Status', status: { equals: 'Delegated' } },
    });
  } catch (err) {
    console.warn(`[notion-pull] Tasks 库查询失败: ${err.message}`);
    return;
  }
  for (const page of resp?.results ?? []) {
    try {
      const props = page.properties ?? {};
      const name = (props.Name?.title ?? [])
        .map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
      const desc = (props.Description?.rich_text ?? [])
        .map((t) => t.plain_text ?? t.text?.content ?? '').join('');
      if (!name) continue;
      if (/brain:/.test(desc)) continue; // 已接手，幂等跳过
      if (/run:notion-/.test(desc)) continue; // OpenClaw 已派发，幂等跳过

      // Workflow relation 分流：选了真实业务 workflow 行 → 派 n8n 画布 + 入 workflow_run 账
      const wfRelation = (props.Workflow?.relation ?? [])[0]?.id ?? null;
      if (wfRelation) {
        // 排班员 v1a·时间窗：Plan Date 在未来 = 意图排期，到点后自然进派发流程
        const planStart = props['Plan Date']?.date?.start ?? null;
        if (planStart && new Date(planStart).getTime() > Date.now()) {
          await writeStatusReceipt(token, page, desc, `🕐 已排期 ${planStart}，到点自动派发`);
          continue;
        }
        await dispatchOpenClawFromNotion({
          pool, token, page, desc,
          pageContent: await fetchNotionPageContent(token, page.id),
          workflowNotionId: wfRelation,
          agentNotionId: (props.Agent?.relation ?? [])[0]?.id ?? null,
          env: opts.env ?? process.env,
          readTemplateFn: opts.readTemplateFn ?? defaultReadTemplate,
          fetchFn: opts.fetchFn ?? globalThis.fetch,
          execFn: opts.execFn,
        });
        continue;
      }

      const m = name.match(/^\[(P[0-3])\]\s*(.+)$/);
      const priority = m ? m[1] : 'P2';
      const title = m ? m[2] : name;
      // 页面正文=主理人写的任务描述/prompt（拉取失败返回 ''，回落固定文案）
      const pageContent = await fetchNotionPageContent(token, page.id);

      // 建任务必须走原子路由账房（task-creation-inventory 守卫），获得 Routing Receipt。
      // source_id=Notion 页 id → 账房自带幂等（同页重放拿回同一 task）。
      // 2026-09-14 实吃第一单踩出的四个路由参数（work-router 硬校验）：
      // source 枚举无 notion_tasks_db → 归 inbox（主理人收件箱语义）；
      // mutation_intent 必填（排单默认 write）；repo_hint 必须唯一匹配仓库事实。
      const routed = await createRoutedTask(pool, {
        source: 'inbox',
        source_id: page.id,
        title,
        description: pageContent.slice(0, 2000) || '来自 Notion Tasks 编排（主理人排单）',
        requested_task_type: 'dev',
        declared_change_kind: 'capability_change',
        mutation_intent: 'write',
        repo_hint: 'cecelia',
        metadata: { source: 'notion_tasks_db', notion_page_id: page.id },
        map_scope_hint: ['F2', 'execution_pool'],
        task: { priority, status: 'queued' },
      });
      const taskId = routed?.task?.id ?? routed?.task_id;
      if (!taskId) throw new Error('routed_task_id_missing');
      // 接手先落 blocked——map 扫描器未迁 us-vps 前 kernel 准入不通，直接 queued
      // 会被 tick 抓去三连 autoblock；同步写 notion 列与幂等指纹（防 pushTasks
      // 反手改用户设的 Delegated）。map 刀后由 unblock 放行。
      await pool.query(
        `UPDATE tasks SET status='blocked',
                blocked_at=NOW(),
                error_message='awaiting_execution_route: map 扫描器迁移后由 unblock 放行',
                notion_id=$2,
                notion_props = COALESCE(notion_props,'{}'::jsonb)
                  || jsonb_build_object('pushed_status','blocked','origin','notion'),
                updated_at=NOW()
          WHERE id=$1`,
        [taskId, page.id],
      );
      const receipt = `${desc ? desc + ' · ' : ''}brain:${taskId} ✓已接管`;
      await notionReq(token, `/pages/${page.id}`, 'PATCH', {
        properties: {
          Description: { rich_text: [{ type: 'text', text: { content: receipt.slice(0, 1900) } }] },
        },
      });
      console.log(`[notion-pull] 接手排单 "${title}" → task ${taskId}`);
    } catch (err) {
      console.warn(`[notion-pull] 页面 ${page?.id} 接手失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

/** 正式入口：由 legacy-notion-push-scheduler 与 push 并联周期调用 */
export async function runNotionTaskPull(pool) {
  const token = getToken();
  if (!token) return;
  await pullNotionTasks(pool, token);
  await syncOpenClawRuns(pool, token);
  await reapSshWorkflowRuns(pool, token);
}

// ssh 直派公共参数：execFile 数组形式，本地不经 shell（CodeQL js/command-line-injection 面）
const SSH_BASE_ARGS = Object.freeze([
  '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no',
]);
function defaultSshExec(args) {
  return nodeExecFileSync('ssh', args, { encoding: 'utf8', timeout: 30_000 });
}

// 状态回执尾巴（⚠/⏸/🕐/▶）可被下一轮覆盖——剥离后再拼，防 desc 滚雪球
const STATUS_TAIL_RE = /\s*·?\s*(?:▶ 已派发|⚠ 派发[未失][成败]|⏸ 排队|🕐 已排期)[\s\S]*$/;
function stripStatusTail(desc) {
  return String(desc || '').replace(STATUS_TAIL_RE, '').trim();
}

async function writeStatusReceipt(token, page, desc, status) {
  const base = stripStatusTail(desc);
  const receipt = `${base ? base + ' · ' : ''}${status}`;
  await notionReq(token, `/pages/${page.id}`, 'PATCH', {
    properties: {
      Description: { rich_text: [{ type: 'text', text: { content: receipt.slice(0, 1900) } }] },
    },
  });
}

function defaultReadTemplate(dir, file) {
  return JSON.parse(readFileSync(joinPath(dir, file), 'utf8'));
}

/**
 * OpenClaw 排单派发（relation 版）：Notion relation 页 id → 反查 ops_workflows /
 * ops_agents（notion_id 归一去杠比对）→ dispatch 人工列取入口与模板 →
 * 注入唯一 run_id（内嵌 pageid32 供终态反解）→ POST n8n webhook。
 * 一切缺配置都写 ⚠ 回执到页面（不含幂等标记，修好配置下轮自动重派）。
 */
async function dispatchOpenClawFromNotion({
  pool, token, page, desc, pageContent = '', workflowNotionId, agentNotionId, env, readTemplateFn, fetchFn, execFn: execFnIn,
}) {
  const norm = (id) => String(id).replace(/-/g, '');
  const failReceipt = async (why) => {
    await writeStatusReceipt(token, page, desc, `⚠ 派发未成(${String(why).slice(0, 80)})`);
    console.warn(`[notion-pull] OpenClaw 派发未成 page=${page.id}: ${why}`);
  };
  const { rows: wfRows } = await pool.query(
    `SELECT wf_id, name, dispatch FROM ops_workflows WHERE replace(notion_id::text,'-','') = $1 LIMIT 1`,
    [norm(workflowNotionId)],
  );
  const wf = wfRows[0];
  if (!wf) return failReceipt('workflow_not_in_ops：所选行不在 ops_workflows 账上');
  let agent = null;
  if (agentNotionId) {
    const { rows } = await pool.query(
      `SELECT name, dispatch FROM ops_agents WHERE replace(notion_id::text,'-','') = $1 LIMIT 1`,
      [norm(agentNotionId)],
    );
    agent = rows[0] ?? null;
    if (!agent) return failReceipt('agent_not_in_ops：所选行不在 ops_agents 账上');
  }
  const executorLabel = agent ? `${wf.name}·${agent.name}` : wf.name;
  // 排班员 v1b·在途互斥：同 workflow 已有 in_progress run（物理资源相同）→ 排队。
  // Delegated 行本身就是队列：不改 Status，下轮 pull 自动重试 = 资源释放自动放行。
  const { rows: busyRows } = await pool.query(
    `SELECT id, payload->>'run_id' AS run_id FROM tasks
      WHERE task_type='workflow_run' AND status='in_progress'
        AND payload->>'wf_id' = $1 LIMIT 1`,
    [wf.wf_id],
  );
  if (busyRows[0]) {
    // 文案禁写 run: 前缀——会命中 pull 幂等跳过正则 /run:notion-/，排队行永不重试（09-14 实证死锁）
    await writeStatusReceipt(token, page, desc,
      `⏸ 排队：${wf.name} 在途(${busyRows[0].run_id ?? busyRows[0].id})，完成后自动派发`);
    return;
  }
  // ssh 直派通道（决策 2026-09-15：任务自动填机器直接下派）——直驾线入口。
  // 派发=目标机 nohup 起后台批，exit code 落 ~/brain-runs/<run_id>.exit 由收割器回收。
  if (wf.dispatch?.channel === 'ssh') {
    const machine = wf.dispatch.machine;
    const command = wf.dispatch.command;
    if (!machine) return failReceipt(`no_machine：给 ops_workflows(${wf.wf_id}).dispatch 配 machine`);
    if (!command) return failReceipt(`no_command：给 ops_workflows(${wf.wf_id}).dispatch 配 command`);
    let target;
    try { target = sshTargetFor(machine); } catch (err) { return failReceipt(err.message); }
    const pageId32ssh = String(page.id).replace(/-/g, '');
    const runIdSsh = `notion-${pageId32ssh}-${Date.now()}`;
    const exitPath = `~/brain-runs/${runIdSsh}.exit`;
    const logPath = `~/brain-runs/${runIdSsh}.log`;
    // 页面正文=执行 prompt：base64 先写达目标机 prompt 文件（base64 经 ssh 传输零注入面），
    // command 里的 {PROMPT_FILE} 字面量替换为该路径；无占位符则 prompt 文件照写供 command 自取。
    let promptFile = null;
    let promptSetup = '';
    let effectiveCommand = command;
    if (pageContent) {
      promptFile = `~/brain-runs/${runIdSsh}.prompt`;
      const promptB64 = Buffer.from(pageContent).toString('base64');
      promptSetup = `printf '%s' '${promptB64}' | base64 -d > ${promptFile} && `;
      effectiveCommand = command.split('{PROMPT_FILE}').join(promptFile);
    }
    const remote = `mkdir -p ~/brain-runs && ${promptSetup}nohup sh -c '${effectiveCommand.replace(/'/g, `'\\''`)}; echo $? > ${exitPath}' > ${logPath} 2>&1 & echo DISPATCHED`;
    // execFile 参数数组：remote 作为 ssh 的单个 argv 传递，本地 shell 零解释
    // （dispatch.command 本就是"要执行的命令"数据行，写入权=运维权；这里只堵本地注入面）
    const sshArgs = [...SSH_BASE_ARGS, target, remote];
    const execFn = execFnIn ?? defaultSshExec;
    try {
      execFn(sshArgs);
    } catch (err) {
      return failReceipt(`ssh_dispatch_failed(${machine}): ${String(err.message).slice(0, 60)}`);
    }
    try {
      await createRoutedTask(pool, {
        source: 'inbox',
        source_id: runIdSsh,
        title: `[run] ${wf.name}@${machine}`,
        description: '来自 Notion 排单的直驾 run（ssh 直派）',
        mutation_intent: 'none',
        declared_domain: 'operations',
        requested_task_type: 'workflow_run',
        metadata: {
          run_id: runIdSsh, wf_id: wf.wf_id, channel: 'ssh', machine,
          notion_page_id: page.id, exit_path: `brain-runs/${runIdSsh}.exit`,
          ...(pageContent ? { prompt_preview: pageContent.slice(0, 500), prompt_file: promptFile } : {}),
        },
        task: { status: 'in_progress', priority: 'P2' },
      });
    } catch (err) {
      console.warn(`[notion-pull] ssh 直派入账失败（不阻塞）: ${err.message}`);
    }
    const baseSsh = stripStatusTail(desc);
    await notionReq(token, `/pages/${page.id}`, 'PATCH', {
      properties: {
        Description: { rich_text: [{ type: 'text', text: { content: `${baseSsh ? baseSsh + ' · ' : ''}▶ 已派发 ${wf.name}@${machine} run:${runIdSsh}`.slice(0, 1900) } }] },
        Status: { status: { name: 'In Progress' } },
      },
    });
    console.log(`[notion-pull] ssh 直派成功 ${wf.wf_id}@${machine} run=${runIdSsh}`);
    return;
  }
  const webhookUrl = wf.dispatch?.webhook_url || env.N8N_V4_WEBHOOK_URL;
  if (!webhookUrl) return failReceipt(`no_webhook_url：给 ops_workflows(${wf.wf_id}).dispatch 配 webhook_url`);
  const template = agent?.dispatch?.template || wf.dispatch?.default_template || null;
  if (!template) return failReceipt('no_template：给所选 Agent 的 ops_agents.dispatch 配 template（或 workflow 配 default_template）');
  const dispatchDir = env.OPENCLAW_DISPATCH_DIR || '/opt/openclaw/dispatch';
  let payload;
  try {
    payload = readTemplateFn(dispatchDir, template);
  } catch (err) {
    return failReceipt(`template_read_failed(${template}): ${err.message}`);
  }
  const pageId32 = String(page.id).replace(/-/g, '');
  const runId = `notion-${pageId32}-${Date.now()}`;
  payload = { ...payload, run_id: runId, attempt_id: 'a1' };
  if (pageContent) payload.prompt = pageContent.slice(0, 4000); // 页面正文=执行 prompt 随 webhook 送达
  let ok = false;
  let detail = '';
  try {
    const resp = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
    ok = !!resp?.ok;
    if (!ok) detail = `http_${resp?.status}`;
  } catch (err) {
    detail = err.message;
  }
  if (ok) {
    // 一切执行进 tasks 账（决策 2dbabb48）：run 入账 workflow_run（operations 路线，
    // 不解析 repo/branch），source_id=run_id 天然幂等；终态由 syncOpenClawRuns 回写。
    try {
      await createRoutedTask(pool, {
        source: 'inbox',
        source_id: runId,
        title: `[run] ${executorLabel}`,
        description: '来自 Notion 排单的业务流程 run',
        mutation_intent: 'none',
        declared_domain: 'operations',
        requested_task_type: 'workflow_run',
        metadata: {
          run_id: runId, wf_id: wf.wf_id, agent_name: agent?.name ?? null,
          notion_page_id: page.id,
        },
        task: { status: 'in_progress', priority: 'P2' },
      });
    } catch (err) {
      console.warn(`[notion-pull] workflow_run 入账失败（不阻塞派发）: ${err.message}`);
    }
  }
  const base = stripStatusTail(desc);
  const receipt = ok
    ? `${base ? base + ' · ' : ''}▶ 已派发 ${executorLabel} run:${runId}`
    : `${base ? base + ' · ' : ''}⚠ 派发失败(${detail.slice(0, 60)})，请重试或联系 Brain`;
  const properties = {
    Description: { rich_text: [{ type: 'text', text: { content: receipt.slice(0, 1900) } }] },
  };
  if (ok) properties.Status = { status: { name: 'In Progress' } };
  await notionReq(token, `/pages/${page.id}`, 'PATCH', { properties });
  console.log(`[notion-pull] OpenClaw 派发${ok ? '成功' : '失败'} ${executorLabel} run=${runId}`);
}

/**
 * ssh 直派收割器：轮询 in_progress 的 ssh 型 workflow_run，去目标机读
 * ~/brain-runs/<run_id>.exit —— 有 exit code 即收账（0→completed/Done，
 * 非零→failed/Cancelled）；无 exit 且开跑超 6 小时判 failed(timeout)。
 * 目标机零反向依赖：不需要它能回连 Brain，收割是 Brain 主动伸手。
 */
async function reapSshWorkflowRuns(pool, token, opts = {}) {
  const execFn = opts.execFn ?? defaultSshExec;
  let rows;
  try {
    ({ rows } = await pool.query(`
      SELECT id, payload->>'run_id' AS run_id, payload->>'machine' AS machine,
             payload->>'notion_page_id' AS notion_page_id,
             (created_at < NOW() - INTERVAL '6 hours') AS is_stale
        FROM tasks
       WHERE task_type='workflow_run' AND status='in_progress'
         AND payload->>'channel' = 'ssh'
       LIMIT 20`));
  } catch (err) {
    console.warn(`[notion-pull] ssh 收割查询失败: ${err.message}`);
    return;
  }
  for (const r of rows ?? []) {
    try {
      let exitCode = null;
      try {
        const target = sshTargetFor(r.machine);
        const out = execFn([...SSH_BASE_ARGS, target, `cat ~/brain-runs/${r.run_id}.exit 2>/dev/null || echo NO_EXIT`]);
        const trimmed = String(out).trim();
        if (/^\d+$/.test(trimmed)) exitCode = parseInt(trimmed, 10);
      } catch (err) {
        console.warn(`[notion-pull] ssh 收割 ${r.run_id} 探测失败: ${err.message}`);
      }
      let status = null;
      let note = '';
      if (exitCode !== null) {
        status = exitCode === 0 ? 'completed' : 'failed';
        note = `exit=${exitCode}`;
      } else if (r.is_stale) {
        // 时区案（2026-09-15）：判据在 SQL 内比较，禁 JS 解析无时区 created_at
        status = 'failed';
        note = 'timeout>6h';
      }
      if (!status) continue;
      await pool.query(
        `UPDATE tasks SET status=$2,
                result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('run_status', $3::text),
                updated_at=NOW()
          WHERE id=$1 AND status='in_progress'`,
        [r.id, status, note],
      );
      if (r.notion_page_id) {
        await notionReq(token, `/pages/${r.notion_page_id}`, 'PATCH', {
          properties: { Status: { status: { name: status === 'completed' ? 'Done' : 'Cancelled' } } },
        }).catch((err) => console.warn(`[notion-pull] ssh 收割回写 ${r.notion_page_id} 失败: ${err.message}`));
      }
      console.log(`[notion-pull] ssh 收割 ${r.run_id} → ${status}(${note})`);
    } catch (err) {
      console.warn(`[notion-pull] ssh 收割 ${r.run_id} 失败: ${err.message}`);
    }
  }
}

export async function reapSshWorkflowRunsForTest(pool, token, opts = {}) {
  return reapSshWorkflowRuns(pool, token, opts);
}

/** OpenClaw run 终态 → 反解 page id 推 Notion Status（Done/Cancelled） */
async function syncOpenClawRuns(pool, token) {
  let rows;
  try {
    ({ rows } = await pool.query(`
      SELECT run_id, status FROM ops_runs
       WHERE run_id LIKE 'notion-%'
         AND status IN ('success','completed','failed','error','cancelled')
         AND (stopped_at IS NULL OR stopped_at > NOW() - INTERVAL '2 days')
       LIMIT 20`));
  } catch (err) {
    console.warn(`[notion-pull] ops_runs 查询失败: ${err.message}`);
    return;
  }
  for (const r of rows ?? []) {
    const m = String(r.run_id).match(/^notion-([0-9a-f]{32})-/);
    if (!m) continue;
    const pageId = m[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const done = ['success', 'completed'].includes(r.status);
    // 事件账闭环：workflow_run task 随 run 终态收账（幂等：仅 in_progress 行）
    try {
      await pool.query(
        `UPDATE tasks SET status=$2,
                result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('run_status', $3::text),
                updated_at=NOW()
          WHERE task_type='workflow_run' AND status='in_progress'
            AND payload->>'run_id' = $1`,
        [r.run_id, done ? 'completed' : 'failed', r.status],
      );
    } catch (err) {
      console.warn(`[notion-pull] workflow_run task 收账失败 ${r.run_id}: ${err.message}`);
    }
    try {
      await notionReq(token, `/pages/${pageId}`, 'PATCH', {
        properties: { Status: { status: { name: done ? 'Done' : 'Cancelled' } } },
      });
    } catch (err) {
      console.warn(`[notion-pull] run 终态回写 ${pageId} 失败: ${err.message}`);
    }
  }
}

/** 可测导出 */
export async function syncOpenClawRunsForTest(pool, token) {
  return syncOpenClawRuns(pool, token);
}

/** 可测内核导出（直接注入 token） */
export async function pullNotionTasksForTest(pool, token, opts = {}) {
  return pullNotionTasks(pool, token, opts);
}

/**
 * Brain skill_registry → Notion Skill Registry 库（353c40c2）。
 *
 * 病根（2026-09-16 实测）：原实现是 insert-only（`WHERE notion_synced_at IS NULL`），
 * 首推之后 Brain 侧改 description/status/location 永远不会再同步，Notion 那行
 * 停在首次写入那一刻——这是 Notion 341 行 vs Brain 180 行账实分叉的机制原因之一。
 *
 * 修法照 pushTasks 的成熟模式（幂等指纹 + managed 才 PATCH）：
 *  1. 指纹 metadata.pushed_digest = md5(name|description|status|location)，
 *     SELECT 直接在 SQL 里比对，新行与内容变更行一并捞出，未变的不重推（防 Notion 限流）；
 *  2. 仅当 notion_id 与本指纹键同时存在（managed）才 PATCH，否则 create——
 *     历史 notion_id 可能是旧时代遗产指向别的库，盲 PATCH 会打错对象；
 *  3. 404（页面被人删）或错库 400 → 清 notion_id 与指纹，下轮 create 重建。
 *
 * 指纹写回用 jsonb 固定子键合并（`|| jsonb_build_object`），不整体覆盖 metadata——
 * metadata 同时装着 eval_score 等别的键（ops-collector.js 在读），整体覆盖会抹掉它们。
 */
const SKILL_DIGEST_SQL = `md5(
  coalesce(name,'') || '|' || coalesce(description,'') || '|' ||
  coalesce(status,'') || '|' || coalesce(location,'')
)`;

async function pushSkillRegistry(pool, token) {
  const { rows } = await pool.query(
    `SELECT id, name, description, location, status, notion_id, metadata,
            ${SKILL_DIGEST_SQL} AS pushed_digest
       FROM skill_registry
      WHERE (metadata->>'pushed_digest') IS DISTINCT FROM ${SKILL_DIGEST_SQL}
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 10`
  );
  for (const s of rows) {
    try {
      const properties = {
        Name:        { title: [{ text: { content: s.name } }] },
        Description: { rich_text: buildRichText(s.description) },
        Status:      { select: { name: s.status || 'active' } },
      };
      if (s.location) {
        properties['Source'] = { select: { name: s.location } };
      }
      const managed = Boolean(s.notion_id && s.metadata?.pushed_digest);
      if (managed) {
        await notionReq(token, `/pages/${s.notion_id}`, 'PATCH', { properties });
        await pool.query(
          `UPDATE skill_registry
              SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('pushed_digest', $2::text),
                  notion_synced_at = NOW()
            WHERE id = $1`,
          [s.id, s.pushed_digest]
        );
      } else {
        const page = await notionReq(token, '/pages', 'POST', {
          parent: { database_id: SKILL_REGISTRY_DB },
          properties,
        });
        await pool.query(
          `UPDATE skill_registry
              SET notion_id = $2,
                  metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('pushed_digest', $3::text),
                  notion_synced_at = NOW()
            WHERE id = $1`,
          [s.id, page.id, s.pushed_digest]
        );
      }
    } catch (err) {
      console.warn(`[notion-push-sync] skill ${s.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
      if ((/404/.test(err.message) && s.metadata?.pushed_digest) || isWrongDatabaseError(err)) {
        await pool.query(
          `UPDATE skill_registry SET notion_id = NULL, metadata = metadata - 'pushed_digest' WHERE id = $1`,
          [s.id]
        ).catch(() => {});
      }
    }
  }
}

// pushJourneySteps 已摘除（2026-09-19，决策 297ffee5）：journey_steps 自 2026-06-09 废弃只读，
// 主链却仍每 5 分钟往 AI Steps 推死数据。注册表 notion_projection_map 中该库标 archived/none。

async function pushJourneyStepLinks(pool, token) {
  // journey_step_links 无 updated_at：连接行只增不改，保持 IS NULL 增量
  const { rows } = await pool.query(`
    SELECT l.*, j.notion_id AS journey_notion_id, s.notion_id AS step_notion_id,
           j.name AS journey_name, s.name AS step_name
    FROM journey_step_links l
    LEFT JOIN journeys j ON j.id = l.journey_id
    LEFT JOIN journey_steps s ON s.id = l.step_id
    WHERE l.notion_synced_at IS NULL
      AND l.cell_kind IS NULL
      AND j.notion_id IS NOT NULL
      AND s.notion_id IS NOT NULL
    LIMIT 10
  `);
  if (rows.length === 0) return;
  const dbId = STEP_LINKS_DB || await resolveDbId(pool, 'journey_step_links');
  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${dbId}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }
  await pushRegisteredRows(pool, token, {
    table: 'journey_step_links', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'step_link',
    buildProps: (l) => {
      const properties = {
        Name:   { title: [{ text: { content: `${l.journey_name} — ${l.step_name}` } }] },
        Status: { select: { name: l.status || 'planned' } },
        ...('Order' in schemaProps && { Order: { number: l.step_order } }),
      };
      if (l.journey_notion_id) properties['Journey'] = { relation: [{ id: l.journey_notion_id }] };
      if (l.step_notion_id) properties['Step'] = { relation: [{ id: l.step_notion_id }] };
      return properties;
    },
  });
}
async function pushDecisions(pool, token) {
  // 三面定稿（决策 297ffee5）：AI Notes 是决策的机器镜子；「决策」库(f93e)是人写入口（PR②b 接 ingest）。
  // LEFT JOIN journey_features 取 target ability 的 notion_id，供映射成 Notion relation 链
  const { rows } = await pool.query(
    `SELECT d.*, jf.notion_id AS ability_notion_id
       FROM decisions d
       LEFT JOIN journey_features jf
         ON jf.id = d.target_id AND d.target_type = 'journey_feature'
      WHERE d.notion_synced_at IS NULL OR d.updated_at > d.notion_synced_at
      ORDER BY d.notion_synced_at NULLS FIRST, d.updated_at
      LIMIT 10`
  );
  if (rows.length === 0) return;
  const dbId = DECISIONS_DB || await resolveDbId(pool, 'decisions');
  // 取一次库 schema：Level/Scope/ability relation 等自定义属性只在库里真实存在时才发，
  // 否则 Notion 400「is not a property that exists」
  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${dbId}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }
  await pushRegisteredRows(pool, token, {
    table: 'decisions', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'decision',
    buildProps: (d) => {
      const mapped = buildDecisionNotionProperties(d, d.ability_notion_id, schemaProps);
      const properties = {};
      for (const [k, v] of Object.entries(mapped)) {
        if (k === 'Title' || k === 'Type' || k in schemaProps) properties[k] = v;
      }
      if (d.created_at) {
        properties.Date = { date: { start: d.created_at.toISOString?.() || d.created_at } };
      }
      return properties;
    },
    buildChildren: (d) => {
      const bodyLines = [
        d.decision && `**决策**: ${d.decision}`,
        d.reason && `**原因**: ${d.reason}`,
        d.category && `**分类**: ${d.category}`,
      ].filter(Boolean).join('\n\n');
      return bodyLines ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(bodyLines) } }] : [];
    },
  });
}
async function pushInitiativeContracts(pool, token) {
  const { rows } = await pool.query(
    `SELECT * FROM initiative_contracts
      WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
      ORDER BY notion_synced_at NULLS FIRST, updated_at LIMIT 10`);
  if (rows.length === 0) return;
  const dbId = INITIATIVE_CONTRACTS_DB || await resolveDbId(pool, 'initiative_contracts');
  await pushRegisteredRows(pool, token, {
    table: 'initiative_contracts', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'initiative_contract',
    buildProps: (ic) => {
      const title = `Contract ${String(ic.initiative_id).slice(0, 8)} v${ic.version}`;
      return {
        Title: { title: [{ text: { content: title } }] },
        Type: { select: { name: 'Contract' } },
        ...(ic.approved_at ? { Date: { date: { start: ic.approved_at.toISOString?.() || ic.approved_at } } } : {}),
      };
    },
    buildChildren: (ic) => {
      const bodyLines = [
        ic.status && `**状态**: ${ic.status}`,
        ic.review_rounds != null && `**GAN 轮次**: ${ic.review_rounds}`,
        ic.prd_content && `**Sprint PRD**:\n${ic.prd_content.slice(0, 1800)}`,
      ].filter(Boolean).join('\n\n');
      return bodyLines ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(bodyLines) } }] : [];
    },
  });
}
async function pushAdvancementItems(pool, token) {
  // 按 ability 聚合该 ability **全部**推进项的累积进度（非仅未同步子集）——
  // WHERE 子查询只用来判断"这个 ability 这一轮有没有变化值得推"，
  // 但 COUNT 必须覆盖全量行，否则 done/total 只反映本轮新增/变化的子集，
  // 会把之前已推的正确进度（如 2/4=50%）覆盖成错误的子集进度（如 0/1=0%）。
  const { rows } = await pool.query(`
    SELECT ai.ability_id, jf.notion_id AS ability_notion_id,
           COUNT(*) FILTER (WHERE ai.status='done')  AS done,
           COUNT(*) FILTER (WHERE ai.status='doing') AS doing,
           COUNT(*) FILTER (WHERE ai.status='todo')  AS todo
    FROM advancement_items ai
    JOIN journey_features jf ON jf.id = ai.ability_id
    WHERE jf.notion_id IS NOT NULL
      AND ai.ability_id IN (
        SELECT ability_id FROM advancement_items WHERE notion_synced_at IS NULL
      )
    GROUP BY ai.ability_id, jf.notion_id
    LIMIT 10
  `);
  if (rows.length === 0) return;

  // 取一次 Feature 库 schema：只有目标属性真实存在才 PATCH，避免对未建列的库 400
  // （同 pushDecisions 的 schema-check 安全模式）
  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${FEATURE_DB}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }
  const progressProp = Object.keys(schemaProps).find((k) => /advancement.*progress/i.test(k));

  for (const r of rows) {
    try {
      if (progressProp) {
        const { done, total, pct } = computeProgress({
          done: Number(r.done), doing: Number(r.doing), todo: Number(r.todo),
        });
        await notionReq(token, `/pages/${r.ability_notion_id}`, 'PATCH', {
          properties: {
            [progressProp]: { rich_text: buildRichText(`${done}/${total} 完成 (${pct}%)`) },
          },
        });
      }
      // 无论是否真的发了 PATCH（属性不存在时跳过），都标记已同步——
      // 属性缺失是"Notion 库未建列"的运维状态，不是"应无限重试"的瞬时错误
      // 已知限制（PR3 前提）：PATCH /api/brain/advancements/:itemId（routes/abilities.js）
      // 改 status 时不会把 notion_synced_at 重置回 NULL，所以已同步过的推进项状态再变化
      // 不会触发下一轮重新推送——这需要改 abilities.js 的 PATCH 端点（本 PR 范围外，不动
      // 现有三个 advancement 端点），留给 PR3 军师上游 producer 一并接线。
      await pool.query(
        `UPDATE advancement_items SET notion_synced_at=NOW() WHERE ability_id=$1 AND notion_synced_at IS NULL`,
        [r.ability_id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] advancement ability ${r.ability_id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

// ─── ops 运行舱两库（指挥舱 G1 S1 刀1，task 6fcb5356）───────────────────────────
// DB id 不硬编码：来自 working_memory key='ops_notion_dbs'（scripts/ops/create-ops-notion-dbs.js 一次性写入）。
// kv 缺失=库未创建（运维状态，静默跳过不刷错误）；value.disabled=true 为终止态（库被删，禁自动重建防平行库）。

export function isMissingDatabaseError(err) {
  return !!(err?.message && err.message.includes('Could not find database'));
}

// 合并单库「Ops 运行图谱」：一行=一个运行单元（agent 或排程），role/workflow/schedule 都是属性。
export function buildOpsUnitNotionProperties(u) {
  const p = {
    Name: { title: [{ text: { content: String(u.name).slice(0, 200) } }] },
    Source: { select: { name: u.source } },
    Machine: { select: { name: u.host_alias } },
    Status: { select: { name: u.status || 'active' } },
    Role: { select: { name: u.role || 'solo' } },
    Repeat: { checkbox: !!u.schedule_desc },          // 有调度=定时重复
  };
  // Suspicious（死排程）当前唯一数据源是 recurring_tasks，而 brain_recurring 因 notion_page_id
  // 已被 recurring-notion-sync 占用不推本库——故 Notion 图谱不设该列（避免恒 false 误导）。
  // 死排程识别在 /agent-ops/graph API 层保留（Dashboard 刀3 消费），Notion 是过渡展示子集。
  if (u.agent_type) p.Type = { rich_text: buildRichText(u.agent_type) };
  if (u.schedule_desc) p.Schedule = { rich_text: buildRichText(u.schedule_desc) };
  if (u.next_run_utc) p.NextRun = { date: { start: new Date(u.next_run_utc).toISOString() } };
  if (u.last_seen_at) p.LastSeen = { date: { start: new Date(u.last_seen_at).toISOString() } };
  // Members/Workflow 是同库 relation，需目标页 id → 第二阶段 buildOpsRelationProperties 补。
  // Kind 列已删（45/67 为空，信息量太低）。
  return p;
}

/**
 * 第二阶段：同库 relation 自关联。Members = 它编排谁（relation → 本库）；
 * Workflow（谁编排它）由 Notion dual_property 反向自动生成，不手工发——
 * 故共享 agent（如 dev 被 main+work-commander 编排）只需两个父各自发一次，
 * dev 那行的 Workflow 自动出现两个值，数据仍只存一份。
 * @param {{name:string, orchestrates?:string[]}} u
 * @param {Map<string,string>} idByName  agent 名 → 已建 Notion 页 id
 */
export function buildOpsRelationProperties(u, idByName) {
  const ids = (u.orchestrates || [])
    .map((child) => idByName.get(child))
    .filter(Boolean)                    // 下级页尚未建 → 跳过，不发 undefined id
    .map((id) => ({ id }));
  return { CanCall: { relation: ids } }; // 空数组=清掉历史残留关系
}


/** run 记录行（刀6）：一次执行 = 一行。crashed 无耗时则不发 Minutes（禁编造 0）。 */
export function buildOpsRunNotionProperties(r, wfName) {
  const when = r.started_at ? new Date(r.started_at) : null;
  const label = `${wfName || r.wf_id} · ${when ? when.toISOString().slice(5, 16).replace('T', ' ') : r.run_id}`;
  const p = {
    Name: { title: [{ text: { content: label.slice(0, 200) } }] },
    Status: { select: { name: r.status || 'unknown' } },
    RunId: { rich_text: buildRichText(String(r.run_id)) },
  };
  if (r.machine) p.Machine = { select: { name: r.machine } };
  if (r.mode) p.Mode = { select: { name: r.mode } };
  if (typeof r.duration_sec === 'number') p.Minutes = { number: Math.round(r.duration_sec / 60) };
  if (when) p.StartedAt = { date: { start: when.toISOString() } };
  return p;
}

async function getOpsNotionDbs(pool) {
  const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = 'ops_notion_dbs'`);
  return rows[0]?.value_json || null;
}

async function disableOpsPush(pool, errMsg) {
  await pool.query(
    `UPDATE working_memory SET value_json = value_json || '{"disabled":true}'::jsonb, updated_at = NOW()
     WHERE key = 'ops_notion_dbs'`);
  await logSyncError(pool, `[ops-push] Notion 库不可访问已停推（终止态，禁自动重建）: ${errMsg}`);
}

async function upsertOpsRows(pool, token, { table, dbId, rows, buildProps }) {
  // 委托统一引擎：指纹同不打 Notion；库不可达 → 停推（终止态，禁自动重建）
  await pushRegisteredRows(pool, token, {
    table, dbId, rows, buildProps, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError,
    onFatal: (err) => { if (isMissingDatabaseError(err)) { disableOpsPush(pool, err.message).catch(() => {}); return true; } return false; },
  });
}
/**
 * 运行舱专用推送入口（scheduler-jobs 的 ops-notion-push 调这个）。
 *
 * 为什么不复用 runNotionPushSync：那条链的唯一入口是 legacy-notion-push-scheduler，
 * 既没人 import 又要 NOTION_LEGACY_PUSH_ENABLED=true 才跑——等于整条链没接电
 * （2026-09-08 查实：Notion 运行舱四库停更两天就是这个原因）。而启用整条 legacy 链
 * 会连带推 journeys/issues/decisions 等 8 条已被有意停用的投影，风险不可控。
 * 故只把 ops 这一段接到现代调度层。
 */
export async function runOpsNotionPush(pool) {
  let token;
  try {
    token = getToken();
  } catch {
    return { ok: false, reason: 'no_token' };
  }
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.graph_db) return { ok: false, reason: 'not_configured' };
  if (dbs.disabled) return { ok: false, reason: 'disabled' };
  await pushOpsGraph(pool, token);
  return { ok: true };
}

// 合并推送：agent 行（带 role/workflow/合并调度）+ 孤儿排程行，全推同一个 graph_db。
async function pushOpsGraph(pool, token) {
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.graph_db || dbs.disabled) return;

  // 全局：算 orchestrated_by（child→[parents]）+ active schedule 索引（供 agent 行合并 + 孤儿判定）
  const allAgents = (await pool.query(`SELECT name, meta FROM ops_agents`)).rows;
  const orchestratedBy = new Map();
  for (const a of allAgents) {
    for (const child of a.meta?.orchestrates || []) {
      if (!orchestratedBy.has(child)) orchestratedBy.set(child, []);
      orchestratedBy.get(child).push(a.name);
    }
  }
  const allSched = (await pool.query(`SELECT * FROM ops_schedule_entries WHERE active = TRUE`)).rows;
  const schedByKey = new Map(allSched.map((s) => [`${s.source}|${s.host_alias}|${s.label}`, s]));
  const agentKeys = new Set((await pool.query(`SELECT source, host_alias, name FROM ops_agents`)).rows
    .map((a) => `${a.source}|${a.host_alias}|${a.name}`));

  // 1. agent 行（合并对应调度）
  const agentRows = (await pool.query(
    `SELECT * FROM ops_agents
     WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
     ORDER BY updated_at LIMIT 50`)).rows;
  await upsertOpsRows(pool, token, {
    table: 'ops_agents', dbId: dbs.graph_db, rows: agentRows,
    buildProps: (a) => {
      const orchestrates = a.meta?.orchestrates || [];
      const parents = orchestratedBy.get(a.name) || [];
      const sched = schedByKey.get(`${a.source}|${a.host_alias}|${a.name}`);
      return buildOpsUnitNotionProperties({
        source: a.source, host_alias: a.host_alias, name: a.name, agent_type: a.agent_type,
        status: a.status, last_seen_at: a.last_seen_at,
        role: orchestrates.length ? 'orchestrator' : (parents.length ? 'member' : 'solo'),
        orchestrated_by: parents,
        kind: sched?.kind ?? null, schedule_desc: sched?.schedule_desc ?? null, next_run_utc: sched?.next_run_utc ?? null,
      });
    },
  });

  // 2. 孤儿排程行（无对应 agent，如 gha）→ 独立行 role=scheduled
  const orphanRows = (await pool.query(
    `SELECT * FROM ops_schedule_entries
     WHERE active = TRUE AND (notion_synced_at IS NULL OR updated_at > notion_synced_at)
     ORDER BY updated_at LIMIT 50`)).rows
    .filter((s) => !agentKeys.has(`${s.source}|${s.host_alias}|${s.label}`));
  await upsertOpsRows(pool, token, {
    table: 'ops_schedule_entries', dbId: dbs.graph_db, rows: orphanRows,
    buildProps: (s) => buildOpsUnitNotionProperties({
      source: s.source, host_alias: s.host_alias, name: s.label, agent_type: 'schedule',
      status: 'active', role: 'scheduled', orchestrated_by: [],
      schedule_desc: s.schedule_desc, next_run_utc: s.next_run_utc,
    }),
  });

  // 3. relation 阶段：所有页建完后，给编排者补 Members（同库自关联）。
  // 必须在建页之后——relation 需要目标页的 notion_id。Workflow（反向）由 Notion 自动生成。
  await syncOpsMembersRelation(pool, token);
  await pushOpsWorkflows(pool, token);   // 业务流程库（刀4）
  await pushOpsRuns(pool, token);        // run 记录库（刀6）
  await pushOpsSkills(pool, token);      // 技能池（此前无任何推送代码，靠手动灌数据）
}

// ─── 技能池「Ops Skills」──────────────────────────────────
// 此前这个库只存在于 Notion：19 条 notion_id 是早前一次性手动脚本灌的，
// 仓库里没有任何代码维护它——与 Notion 停更同一类病（手动做的事没固化）。
async function pushOpsSkills(pool, token) {
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.skills_db || dbs.disabled) return;
  const rows = (await pool.query(
    `SELECT * FROM ops_skills
     WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
     ORDER BY updated_at LIMIT 50`)).rows;
  await upsertOpsRows(pool, token, {
    table: 'ops_skills', dbId: dbs.skills_db, rows,
    buildProps: buildOpsSkillNotionProperties,
  });
}

// ─── 业务流程库「Ops Workflows」（刀4）────────────────────────────────
// 与图谱库的区别：workflow=业务流程（智能获客8阶段），agent=执行资源。
// 主理人 2026-09-06 纠正：allowAgents 是"谁能召唤谁"的权限，不是 workflow。

export function buildOpsWorkflowNotionProperties(w) {
  const p = {
    Name: { title: [{ text: { content: String(w.name).slice(0, 200) } }] },
    Source: { select: { name: w.source || 'n8n' } },  // 采集器行未带 source 时按来源默认
    Active: { checkbox: w.active === true },
    Stages: { number: w.stage_count ?? 0 },
  };
  const stages = w.meta?.stages || [];
  if (stages.length) p.Flow = { rich_text: buildRichText(stages.join(' → ')) }; // 流程长什么样
  // 健康汇总（刀6）：无 run 数据时不发，避免显示假 0
  if (w.machine) p.Machine = { select: { name: w.machine } };
  if (typeof w.run_total === 'number') p.Runs = { number: w.run_total };
  if (typeof w.run_success_rate === 'number') p.SuccessRate = { number: w.run_success_rate };
  if (typeof w.run_avg_sec === 'number') p.AvgMinutes = { number: Math.round(w.run_avg_sec / 60) };
  if (w.last_run_at) p.LastRun = { date: { start: new Date(w.last_run_at).toISOString() } };
  if (w.last_run_status) p.LastStatus = { select: { name: w.last_run_status } };
  if (w.node_count != null) p.Nodes = { number: w.node_count };
  if (w.wf_id) p.WfId = { rich_text: buildRichText(w.wf_id) };
  // 活性（443）：看板要一眼看出"还会不会跑"，不能让人拿最后运行时间自己去减。
  // 起因：业务流程停跑 20.4 小时，四表全绿因为它们只答"跑过多少次"。
  if (w.liveness) {
    p.Liveness = { select: { name: LIVENESS_LABEL[w.liveness] || LIVENESS_LABEL.cold } };
    if (typeof w.silent_sec === 'number') {
      p.SilentFor = { rich_text: buildRichText(formatSilentFor(w.silent_sec)) };
    }
  }
  // 人工列（owner/note/priority/starred/enable_intent）一律不发：
  // Notion 是它们的真相源，推回去会把主理人刚改的冲掉。
  return p; // Agents（跨库 relation）第二阶段补
}

/** 活性灯：手机上扫一眼就能挑出红的 */
const LIVENESS_LABEL = {
  ok: '🟢 正常',
  warn: '🟡 放缓',
  dead: '🔴 失联',
  cold: '⚪ 数据不足',
};

/** 静默时长按量级换单位——固定用小时会出现"停了 0.0 小时"这种废话 */
export function formatSilentFor(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return `停了 ${Math.round(s)} 秒`;
  if (s < 3600) return `停了 ${Math.round(s / 60)} 分钟`;
  if (s < 86400) return `停了 ${(s / 3600).toFixed(1)} 小时`;
  return `停了 ${(s / 86400).toFixed(1)} 天`;
}

/**
 * 技能池机器列。人工列（Stage/Owner/Note/Priority/Starred）一律不发——
 * Stage 正是主理人推翻自动判定的地方，推回去就把人改的冲掉了。
 */
export function buildOpsSkillNotionProperties(s) {
  const p = {
    Name: { title: [{ text: { content: String(s.name ?? '').slice(0, 200) } }] },
    Source: { select: { name: s.source || 'openclaw' } },
    UsedBy: { number: Array.isArray(s.used_by) ? s.used_by.length : 0 },
  };
  if (s.generation != null) p.Generation = { number: s.generation };
  if (typeof s.eval_score === 'number') p.EvalScore = { number: s.eval_score };
  // 无运行数据的不发假 0——19 个 skill 里 17 个还没有阶段归因数据
  if (typeof s.runs === 'number') p.Runs = { number: s.runs };
  if (typeof s.run_success_rate === 'number') p.SuccessRate = { number: s.run_success_rate };
  if (typeof s.run_avg_sec === 'number') p.AvgSeconds = { number: s.run_avg_sec };
  if (s.disco_stage) p.DiscoStage = { select: { name: s.disco_stage } };
  // 判定依据必须一起给：只给档位不给理由，人没法判断该不该推翻它
  if (s.stage_reason) p.StageReason = { rich_text: buildRichText(String(s.stage_reason).slice(0, 500)) };
  // 探针未知（null）不发——false 会被误读成"已确认没有探针"
  if (typeof s.has_postcondition === 'boolean') p.HasProbe = { checkbox: s.has_postcondition };
  return p;
}

/** DisCo 合法档位——人工覆盖只认这三个，乱填一律忽略免得把档位写脏 */
const VALID_STAGES = new Set(['software3', 'disco', 'code']);

/**
 * 从 Notion 页面读回**人工列**。机器列即使人改了也一概不读——
 * 它们的真相源在 n8n/OpenClaw，下一轮推送会覆盖回去。
 * 空值读成 null（不是 undefined）：人主动清空一个字段必须能传达到 Brain。
 */
export function buildOpsManualReadback(page) {
  const props = page?.properties;
  if (!props || typeof props !== 'object') return {};
  const out = {};
  const text = (k) => {
    const rt = props[k]?.rich_text;
    if (!Array.isArray(rt)) return undefined;
    const v = rt.map((x) => x?.plain_text ?? '').join('').trim();
    return v || null;
  };
  const select = (k) => {
    if (!(k in props)) return undefined;
    return props[k]?.select?.name ?? null;
  };
  const check = (k) => (typeof props[k]?.checkbox === 'boolean' ? props[k].checkbox : undefined);

  const owner = text('Owner'); if (owner !== undefined) out.owner_manual = owner;
  const note = text('Note'); if (note !== undefined) out.note_manual = note;
  const org = text('Org'); if (org !== undefined) out.org_manual = org;
  const role = text('RoleManual'); if (role !== undefined) out.role_manual = role;
  const prio = select('Priority'); if (prio !== undefined) out.priority_manual = prio;
  const star = check('Starred'); if (star !== undefined) out.starred = star;
  const stage = select('Stage');
  if (stage !== undefined && (stage === null || VALID_STAGES.has(stage))) out.stage_manual = stage;
  const enabled = check('Enabled'); if (enabled !== undefined) out.enable_intent = enabled;
  return out;
}

/** 生效档位：人工优先，人工空则用自动判定值 */
export function effectiveStage(skill = {}) {
  return skill.stage_manual ?? skill.disco_stage ?? null;
}

/** workflow → 它用到的 agent（跨库 relation 指向图谱库） */
export function buildWorkflowAgentsRelation(w, agentIdByName) {
  const ids = (w.uses_agents || [])
    .map((n) => agentIdByName.get(n))
    .filter(Boolean)
    .map((id) => ({ id }));
  return { Agents: { relation: ids } };
}

async function pushOpsWorkflows(pool, token) {
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.workflows_db || dbs.disabled) return;
  const { rows } = await pool.query(
    `SELECT * FROM ops_workflows
     WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
     ORDER BY updated_at LIMIT 50`);
  const dbId = dbs.workflows_db || await resolveDbId(pool, 'ops_workflows');
  // 建页时带正文 children（流程图 mermaid + 阶段清单 + 画布构成）；raw 画布存 meta.raw_nodes
  await pushRegisteredRows(pool, token, {
    table: 'ops_workflows', dbId, rows, notionReq, logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'workflow',
    buildProps: (w) => buildOpsWorkflowNotionProperties(w),
    buildChildren: (w) => (w.meta?.canvas ? buildWorkflowPageBlocks(w.meta.canvas, w) : undefined),
    onFatal: (err) => { if (isMissingDatabaseError(err)) { disableOpsPush(pool, err.message).catch(() => {}); return true; } return false; },
  });
  // 跨库 relation：workflow → agent（需图谱库页 id）
  const agentIdByName = new Map(
    (await pool.query(`SELECT name, notion_id FROM ops_agents WHERE notion_id IS NOT NULL`)).rows
      .map((r) => [r.name, r.notion_id]));
  const withAgents = (await pool.query(
    `SELECT wf_id, uses_agents, notion_id FROM ops_workflows
     WHERE notion_id IS NOT NULL AND jsonb_array_length(uses_agents) > 0`)).rows;
  for (const w of withAgents) {
    try {
      const props = buildWorkflowAgentsRelation(w, agentIdByName);
      if (!props.Agents.relation.length) continue;
      await notionReq(token, `/pages/${w.notion_id}`, 'PATCH', { properties: props });
    } catch (err) {
      if (isMissingDatabaseError(err)) return;
      console.warn(`[notion-push-sync] workflow relation ${w.wf_id} 失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}


/**
 * run 推送（刀6）：只推**业务流程**的 run（有阶段的，日均 10-21 轮）；
 * 通道/触发器类（日均 154-234 次、4 秒一次）只在流程行上看汇总，不推明细——
 * 否则 2800 条 4 秒记录会把视线淹没（主理人 2026-09-06 定调）。
 */
async function pushOpsRuns(pool, token) {
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.runs_db || dbs.disabled) return;
  // ops_runs 无 updated_at：run 记录只增不改，保持 IS NULL 增量
  const { rows } = await pool.query(
    `SELECT r.*, w.name AS wf_name
     FROM ops_runs r
     JOIN ops_workflows w ON w.source = r.source AND w.wf_id = r.wf_id
     WHERE w.stage_count > 0 AND r.notion_synced_at IS NULL
     ORDER BY r.started_at DESC LIMIT 100`);
  if (rows.length === 0) return;
  const dbId = dbs.runs_db || await resolveDbId(pool, 'ops_runs');
  await upsertOpsRows(pool, token, {
    table: 'ops_runs', dbId, rows, buildProps: (r) => buildOpsRunNotionProperties(r, r.wf_name),
  });
}
/** 给有召唤权限的 agent 补 CanCall relation（同库自关联，反向=CalledBy）。目标页未建则下轮自愈。 */
async function syncOpsMembersRelation(pool, token) {
  const { rows } = await pool.query(
    `SELECT name, meta, notion_id FROM ops_agents WHERE notion_id IS NOT NULL`);
  const idByName = new Map(rows.map((r) => [r.name, r.notion_id]));
  const orchestrators = rows.filter((r) => (r.meta?.orchestrates || []).length > 0);
  for (const o of orchestrators) {
    try {
      const props = buildOpsRelationProperties({ name: o.name, orchestrates: o.meta.orchestrates }, idByName);
      if (!props.CanCall.relation.length) continue; // 下级页全未建，等下轮
      await notionReq(token, `/pages/${o.notion_id}`, 'PATCH', { properties: props });
    } catch (err) {
      if (isMissingDatabaseError(err)) return;      // 库没了，停推（终止态）
      console.warn(`[notion-push-sync] ops relation ${o.name} 失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

export async function runNotionPushSync(pool) {
  let token;
  try {
    token = getToken();
  } catch {
    return;
  }

  await pushJourneys(pool, token);
  await pushJourneyFeatures(pool, token);
  await pushIssues(pool, token);
  await pushTasks(pool, token);
  await pushSkillRegistry(pool, token);
  await pushJourneyStepLinks(pool, token);
  await pushDecisions(pool, token);
  await pushInitiativeContracts(pool, token);
  await pushAdvancementItems(pool, token);
  await pushOpsGraph(pool, token);
}
