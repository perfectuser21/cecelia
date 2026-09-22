// 秋米入口端到端 smoke：假 Notion（内存对象 + fetch 拦截）+ 真 Postgres（cecelia_test）。
// 六闸：
//  1 zh 委派行 → en 行建出（Description 以 [zh: 开头）
//  2 标记行入账 → tasks 出现 qiumi_task(queued, executor_kind=openclaw-agent,
//    payload.notion_page_id/notion_zh_page_id/tenant_id/headed_manual)，zh 任务号回写 brain:
//  3 同名第二条 zh 行也能入账（PR1 迁移（main 侧 459）的 dedup_by_notion_page 豁免，真库唯一索引实证）
//  4 人工把 zh 拖到「淘汰」→ projection_commands 出现 cancel_requested；applyProjectionCommands 后任务 cancelled
//  5 回写：zh 处于「阻塞」时不被覆盖；拖回机器态后 completed_no_pr → zh 已完成+勾选
//  6 对照组：zh 状态「收集」的行永不建 en 行、永不入账
//
// 为什么拦 fetch 而不是只注入 notionReq：入账走 notion-push-sync 的模块级 notionReq，
// 注入参数够不到它。拦 globalThis.fetch 是唯一能保证"整轮一个 Notion 都不打真网"的位置。
import pg from 'pg';
import { runGtdSyncOnce } from '../../src/notion-gtd-sync.js';
import { applyProjectionCommands } from '../../src/projection/commands.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const T = `[smoke] qiumi-entry ${process.pid}`;
const pages = new Map(); // id → page（假 Notion 存储）
let seq = 0;
// 每跑一次换一段前缀：页 id 就是路由账房的 source_id，确定性 id 会在第二次跑命中上一跑的
// Routing Receipt（append-only，删不掉），入账直接返回旧任务 → 闸3 假红。首字符钉死非 'c'，
// 避开假 Notion 按 'c69c' 前缀分库的判断。
const RUN = `a${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0')}`;
const mkId = () => `${RUN}-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const zhRow = (title, status) => {
  const id = mkId();
  pages.set(id, {
    id,
    db: 'zh',
    created_time: new Date().toISOString(),
    last_edited_time: new Date().toISOString(),
    properties: {
      '名称': { title: [{ plain_text: title }] },
      '备注': { rich_text: [] },
      '状态': { status: { name: status } },
      'OpenClaw任务号': { rich_text: [] },
      '优先级': { select: { name: '高' } },
      '预期完成日期': { date: null },
      '执行通道': { select: null },
      '执行 Agent / Workflow': { relation: [] },
      '使用 Skill': { relation: [] },
      'AI 业务任务': { relation: [] },
      '负责人': { people: [] },
      '归档': { checkbox: false },
    },
  });
  return id;
};
const plain = (a) => (a ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

function match(page, filter) {
  if (!filter) return true;
  if (filter.and) return filter.and.every((f) => match(page, f));
  if (filter.timestamp === 'created_time') return page.created_time >= filter.created_time.on_or_after;
  const p = page.properties[filter.property];
  if (filter.status) return p?.status?.name === filter.status.equals;
  if (filter.checkbox) return (p?.checkbox === true) === filter.checkbox.equals;
  if (filter.rich_text?.is_empty) return plain(p?.rich_text) === '';
  if (filter.rich_text?.starts_with) return plain(p?.rich_text).startsWith(filter.rich_text.starts_with);
  if (filter.rich_text?.contains) return plain(p?.rich_text).includes(filter.rich_text.contains);
  return false;
}

const toRich = (v) => (v.rich_text ? { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) } : null);

function handle(path, method, body) {
  const q = path.match(/^\/databases\/([^/]+)\/query$/);
  if (q) {
    const db = q[1].startsWith('c69c') ? 'zh' : 'en';
    return { results: [...pages.values()].filter((p) => p.db === db && match(p, body.filter)) };
  }
  if (path === '/pages' && method === 'POST') {
    const id = mkId();
    const db = body.parent.database_id.startsWith('c69c') ? 'zh' : 'en';
    const page = {
      id, db, created_time: new Date().toISOString(), last_edited_time: new Date().toISOString(), properties: {},
    };
    for (const [k, v] of Object.entries(body.properties)) {
      page.properties[k] = v.title
        ? { title: v.title.map((t) => ({ plain_text: t.text.content })) }
        : (toRich(v) ?? v);
    }
    pages.set(id, page);
    return { id };
  }
  const one = path.match(/^\/pages\/([^/?]+)/);
  if (one && method === 'GET') {
    const page = pages.get(one[1]);
    if (!page) throw new Error(`fake notion: 未知页 ${one[1]}（真库里混进了不属于本次 smoke 的行）`);
    return page;
  }
  if (one && method === 'PATCH') {
    const page = pages.get(one[1]);
    if (!page) throw new Error(`fake notion: 未知页 ${one[1]}`);
    for (const [k, v] of Object.entries(body.properties)) page.properties[k] = toRich(v) ?? v;
    page.last_edited_time = new Date().toISOString();
    return page;
  }
  if (/^\/blocks\//.test(path)) return { results: [] };
  throw new Error(`fake notion: ${method} ${path}`);
}

const NOTION_BASE = 'https://api.notion.com/v1';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith(NOTION_BASE)) throw new Error(`smoke 拦到非 Notion 出网请求: ${u}`);
  const data = handle(u.slice(NOTION_BASE.length), opts.method ?? 'GET', opts.body ? JSON.parse(opts.body) : null);
  return { ok: true, status: 200, json: async () => data };
};

const env = {
  QIUMI_SYNC_ENABLED: 'true',
  QIUMI_SYNC_SINCE: '2000-01-01T00:00:00.000Z',
  NOTION_TENANT_MAP: JSON.stringify({ 'c69c40c2-ba63-8271-badf-01c5410d8929': 'yueshengyun' }),
};
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => { throw new Error(m); };
const run = () => runGtdSyncOnce(pool, { token: 'fake', env });
const taskIdOfZh = async (zhPageId) => {
  const { rows } = await pool.query("SELECT id FROM tasks WHERE payload->>'notion_zh_page_id'=$1", [zhPageId]);
  if (!rows.length) fail(`找不到中文页 ${zhPageId} 对应的任务`);
  return rows[0].id;
};
// work_routing_receipts 是 append-only（触发器 reject_work_routing_receipt_mutation 拒 DELETE），
// 它的外键又钉着 tasks——本次跑的任务删不掉，只能归档：留痕可查，且不再进任何活跃集合。
// 删除动作一律不吞错：静默吞掉的清理失败正是上一版 smoke 第二次跑假红的来源。
const cleanup = async () => {
  await pool.query(
    `DELETE FROM projection_commands
      WHERE payload->>'source'='qiumi_owner_stop'
        AND entity_id IN (SELECT id FROM tasks WHERE title LIKE $1)`,
    [`${T}%`],
  );
  await pool.query(
    "UPDATE tasks SET status='archived', updated_at=NOW() WHERE title LIKE $1 AND status<>'archived'",
    [`${T}%`],
  );
};

try {
  await cleanup();
  const a = zhRow(`${T} 同名`, '委派');
  const b = zhRow(`${T} 同名`, '委派');
  zhRow(`${T} 收集行`, '收集');
  await run();

  // 闸1：zh→en 建行 + [zh: 占位
  const enRows = [...pages.values()].filter((p) => p.db === 'en');
  if (enRows.length !== 2 || !enRows.every((p) => plain(p.properties.Description.rich_text).startsWith('[zh:'))) {
    fail(`闸1 zh→en 建行：en 行数=${enRows.length}`);
  }
  pass('闸1 zh→en 建行 + [zh: 占位');

  // 闸2/3：入账字段 + 同名不撞
  if (!plain(pages.get(a).properties['OpenClaw任务号'].rich_text).startsWith('brain:')) fail('闸2 入账后 zh 任务号应为 brain:');
  const { rows } = await pool.query(
    'SELECT id, status, executor_kind, task_type, tenant_id, payload FROM tasks WHERE title=$1 ORDER BY created_at',
    [`${T} 同名`],
  );
  if (rows.length !== 2) fail(`闸3 同名两行入账（PR1 迁移 dedup_by_notion_page 豁免）：得到 ${rows.length}`);
  for (const r of rows) {
    if (r.status !== 'queued' || r.executor_kind !== 'openclaw-agent') fail(`闸2 状态/executor_kind：${r.status}/${r.executor_kind}`);
    if (r.task_type !== 'qiumi_task') fail(`闸2 task_type=${r.task_type}`);
    if (!r.payload.notion_page_id || !r.payload.notion_zh_page_id || r.payload.tenant_id !== 'yueshengyun' || r.payload.headed_manual !== true) {
      fail('闸2 payload 字段（notion_page_id/notion_zh_page_id/tenant_id/headed_manual）');
    }
    if (r.payload.dedup_by_notion_page !== 'true') fail('闸2 去重豁免键 dedup_by_notion_page 必须为字符串 true');
  }
  pass('闸2/3 入账字段 + 同名不撞');

  // 闸6：收集行永不参与
  if ([...pages.values()].some((p) => p.db === 'en' && plain(p.properties.Description.rich_text).includes('收集行'))) {
    fail('闸6 收集行被同步');
  }
  pass('闸6 收集/人工态不参与');

  // 闸4：淘汰 → cancel_requested → cancelled
  const taskA = await taskIdOfZh(a);
  pages.get(a).properties['状态'] = { status: { name: '淘汰' } };
  await run();
  const cmd = await pool.query(
    "SELECT command_type FROM projection_commands WHERE entity_id=$1 AND command_type='cancel_requested'",
    [taskA],
  );
  if (!cmd.rows.length) fail('闸4 淘汰未产出 cancel_requested');
  await applyProjectionCommands(pool);
  const after = await pool.query('SELECT status FROM tasks WHERE id=$1', [taskA]);
  if (after.rows[0].status !== 'cancelled') fail(`闸4 应用后应 cancelled，得到 ${after.rows[0].status}`);
  pass('闸4 急停淘汰→cancelled');

  // 闸5a：中文页处于人工态「阻塞」时，机器回写绝不覆盖
  const taskB = await taskIdOfZh(b);
  await pool.query("UPDATE tasks SET status='in_progress', updated_at=NOW() WHERE id=$1", [taskB]);
  pages.get(b).properties['状态'] = { status: { name: '阻塞' } };
  await run();
  if (pages.get(b).properties['状态'].status.name !== '阻塞') fail('闸5a 人工「阻塞」被机器覆盖');
  if (pages.get(b).properties['已完成']?.checkbox === true) fail('闸5a 人工「阻塞」行被勾完成');
  pass('闸5a 人工阻塞态不被覆盖');

  // 闸5b：拖回机器态后，completed_no_pr → 已完成 + 勾选 + 完成日期
  pages.get(b).properties['状态'] = { status: { name: '进行中' } };
  await pool.query(
    `UPDATE tasks SET status='completed_no_pr', completed_at=NOW(),
            result='{"receipt":{"finalAssistantVisibleText":"done"}}'::jsonb, updated_at=NOW() WHERE id=$1`,
    [taskB],
  );
  await run();
  const zhB = pages.get(b).properties;
  if (zhB['状态'].status.name !== '已完成' || zhB['已完成'].checkbox !== true || !zhB['完成日期']?.date?.start) {
    fail(`闸5b 回写已完成：状态=${zhB['状态'].status.name}`);
  }
  pass('闸5b 回写已完成+勾选+完成日期');

  console.log('ALL PASS');
} catch (err) {
  // 没有这个 catch，finally 里的 process.exit 会抢在默认错误打印之前退出，
  // 失败时只看得到最后一个 PASS——红得没有理由等于假红。
  console.error(`FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((e) => { console.error(`FAIL: 清理失败 ${e.message}`); process.exitCode = 1; });
  await pool.end();
  // task-updater / db.js 持有模块级 Pool，不显式退出会吊住进程
  process.exit(process.exitCode ?? 0);
}
