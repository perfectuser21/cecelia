/**
 * m7-scenarios.mjs — ledger-hygiene m7 探针场景验证（evaluator 直接执行的真执行 oracle）
 *
 * 真 Postgres + TEMP 影子表（session 级自动清理，不污染真实数据）。
 * DB 解析与 Brain 同源（db-config.js DB_DEFAULTS，铁律：写入侧/校验侧同一解析逻辑）。
 *
 * 用法: node m7-scenarios.mjs <window|exclusion|reset|copy>
 * 任一断言失败 exit 1。
 *
 * 防作弊设计：
 * - window 场景在旧口径（NOW()-24h）下必然 debt=0（假绿），只有改为"上一完整北京日"才 debt=1；
 * - exclusion 场景在旧口径（不排除自产）下必然 debt=0，只有排除 lane='ledger-hygiene' 才 debt=1。
 */
import { createRequire } from 'node:module';

const requireBrain = createRequire(new URL('../../../../packages/brain/package.json', import.meta.url));
let pg;
try {
  pg = requireBrain('pg');
} catch {
  console.error('FAIL: packages/brain 依赖未安装，请先 cd packages/brain && npm ci');
  process.exit(1);
}

const { computeMetrics, evaluateRatchet, raiseBreachAlerts } = await import(
  new URL('../../../../packages/brain/src/ledger-hygiene.js', import.meta.url)
);
const { DB_DEFAULTS } = await import(
  new URL('../../../../packages/brain/src/db-config.js', import.meta.url)
);

const scenario = process.argv[2];
const client = new pg.Client(DB_DEFAULTS);
await client.connect();

// TEMP 表影子真实表（LIKE INCLUDING ALL 复制默认值+唯一索引，pushCapture 的 ON CONFLICT 可用）
for (const t of ['captures', 'capture_atoms', 'issues', 'design_docs']) {
  await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL)`);
}

// 上一完整北京日 12:00（Asia/Shanghai 固定 UTC+8、无夏令时，从时区推导而非写死服务器本地时区）
const HOUR = 3600e3;
const nowShifted = new Date(Date.now() + 8 * HOUR);
const shMidnightUtcMs =
  Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth(), nowShifted.getUTCDate()) - 8 * HOUR;
const prevDayNoon = new Date(shMidnightUtcMs - 12 * HOUR).toISOString();

async function insertAtom({ createdAt, lane = null, targetType = 'learning', content = 'e2e atom' }) {
  await client.query(
    `INSERT INTO capture_atoms (content, target_type, lane, created_at) VALUES ($1, $2, $3, $4)`,
    [content, targetType, lane, createdAt]
  );
}

let failed = false;
function fail(msg, extra) {
  console.error('FAIL:', msg, extra !== undefined ? JSON.stringify(extra) : '');
  failed = true;
}

if (scenario === 'window') {
  // 仅"当前时刻"1 条非自产 atom：旧口径 NOW()-24h 会计入 → debt=0（假绿）；
  // 新口径统计窗=上一完整北京日，不含当前时刻 → 真实零产出，debt=1（击穿有效性保留）
  await insertAtom({ createdAt: new Date().toISOString() });
  const m = await computeMetrics(client);
  if (m.m7.enabled !== true) fail('m7 未激活（capture_atoms 有行时应激活）', m.m7);
  else if (m.m7.debt !== 1) fail(`统计窗未改为上一完整北京日：期望 debt=1，实际 debt=${m.m7.debt}`, m.m7.value);
  else console.log('OK window: 当前时刻 atom 不计入上一北京日窗，debt=1');
} else if (scenario === 'exclusion') {
  // 上一北京日仅 1 条探针自产 atom（lane='ledger-hygiene'）→ 排除后为 0 → debt=1（正确击穿，防自污染）
  await insertAtom({
    createdAt: prevDayNoon,
    lane: 'ledger-hygiene',
    targetType: 'issue',
    content: 'issue: [ledger-hygiene] 自产 atom（应被排除）',
  });
  const m1 = await computeMetrics(client);
  if (m1.m7.debt !== 1) fail(`自产 atom 未被排除：期望 debt=1，实际 ${m1.m7.debt}`, m1.m7.value);
  // 再插 1 条非自产 atom（同窗）→ debt=0（真实产出清偿）
  await insertAtom({ createdAt: prevDayNoon });
  const m2 = await computeMetrics(client);
  if (m2.m7.debt !== 0) fail(`非自产 atom 应清偿：期望 debt=0，实际 ${m2.m7.debt}`, m2.m7.value);
  if (!failed) console.log('OK exclusion: 仅自产 debt=1 → 加非自产 debt=0');
} else if (scenario === 'reset') {
  // 上一北京日有非自产 atom → debt=0 → 无击穿 → working_memory ratchet streak 复位为 0
  await insertAtom({ createdAt: prevDayNoon });
  const m = await computeMetrics(client);
  if (m.m7.debt !== 0) {
    fail(`前置失败：期望 debt=0，实际 ${m.m7.debt}`, m.m7.value);
  } else {
    const prev = { baseline: { m7: 0 }, last: { m7: 1 }, streaks: { m7: 2 }, baseline_date: '2026-08-01' };
    const { state, breaches } = evaluateRatchet({ m7: m.m7 }, prev, '2026-08-04');
    if (state.streaks.m7 !== 0) fail(`streak 未复位：期望 0，实际 ${state.streaks.m7}`);
    else if (breaches.length !== 0) fail(`debt=0 不应击穿，实际 breaches=${breaches.length}`);
    else console.log('OK reset: debt=0 时 streak 2 → 0 复位');
  }
} else if (scenario === 'copy') {
  // debt 持平（prevDebt=debt=1, streak=2 避免触发 Bark）→ issue 文案不写"上升"；
  // 同时验证探针自产 atom 带 lane='ledger-hygiene' 标识 + routed_to_table/routed_to_id 落库
  await raiseBreachAlerts(
    client,
    [{ key: 'm7', name: '自主循环零产出', prevDebt: 1, debt: 1, streak: 2 }],
    '2099-01-01'
  );
  const { rows: iss } = await client.query(
    `SELECT id, title, body FROM issues WHERE title LIKE '[ledger-hygiene] 自主循环零产出%'`
  );
  if (iss.length !== 1) {
    fail(`期望 1 条 issue，实际 ${iss.length}`);
  } else {
    const { title, body } = iss[0];
    const text = `${title} ${body || ''}`;
    if (text.includes('上升')) fail('debt 持平仍写「上升」', title);
    if (!title.startsWith('[ledger-hygiene] 自主循环零产出'))
      fail('issue title 前缀改变，破坏"每指标每日一条"频控依赖', title);
    if (!(text.includes('持平') || text.includes('连续第 2 天')))
      fail('文案缺"持平"或"连续第 N 天"如实表述', title);
    const { rows: atoms } = await client.query(
      `SELECT lane, routed_to_table, routed_to_id FROM capture_atoms WHERE target_type = 'issue'`
    );
    if (atoms.length !== 1) fail(`期望 1 条探针自产 atom，实际 ${atoms.length}`);
    else {
      if (atoms[0].lane !== 'ledger-hygiene') fail(`自产 atom 缺 lane 标识，实际 lane=${atoms[0].lane}`);
      if (atoms[0].routed_to_table !== 'issues' || !atoms[0].routed_to_id)
        fail('routed_to_table/routed_to_id 未落库（签名断裂未修）', atoms[0]);
    }
    if (!failed) console.log('OK copy: 持平文案无「上升」+ lane 标识 + routed_to 落库');
  }
} else {
  fail(`未知场景: ${scenario}（可选 window|exclusion|reset|copy）`);
}

await client.end();
process.exit(failed ? 1 : 0);
