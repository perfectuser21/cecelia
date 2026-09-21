/**
 * openclaw-cron-ledger-check.mjs — 由 openclaw-cron-ledger-smoke.sh 调用。
 *
 * 拆成独立文件而不是内联 node -e：内联多行 SQL + 模板字符串在 bash 引号里
 * 极易写炸（本 smoke 第一版就炸在这），拆出来可单独跑、可读可调。
 */
import pg from 'pg';
import {
  parseOpenclawCrons, OPENCLAW_CONFIG_CMD, OPENCLAW_CRON_CMD,
} from '../../src/ops-collector.js';

let bad = 0;
const fail = (s) => { console.error('  ❌ ' + s); bad += 1; };
const ok = (s) => console.log('  ✅ ' + s);

// ① 落点不许写死（两度复发：hk-vps→us-vps 坏一次，us-vps→MMV 又坏一次）
for (const [name, cmd] of [['CONFIG', OPENCLAW_CONFIG_CMD], ['CRON', OPENCLAW_CRON_CMD]]) {
  if (!/\bmmv\b/.test(cmd)) fail(`${name} 未走 ssh 别名 mmv: ${cmd}`);
  else if (/docker exec/.test(cmd)) fail(`${name} 仍绑定某台机的容器: ${cmd}`);
  else if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(cmd)) fail(`${name} 写死了 IP: ${cmd}`);
  else if (/\b(hk-vps|us-vps)\b/.test(cmd)) fail(`${name} 写死了历史落点: ${cmd}`);
  else ok(`${name} 走别名、未写死落点`);
}

// ② 解析结果真写进真表并读得回
// 单测用 fakePool 只记 SQL 字符串，证明不了列类型/约束吃不吃得下这些值。
const rows = parseOpenclawCrons(JSON.stringify({
  jobs: [
    {
      id: 's1', name: 'smoke 晨报', enabled: true,
      schedule: { kind: 'cron', expr: '25 6 * * 1-5', tz: 'Asia/Shanghai' },
      lastRunStatus: 'error', state: { nextRunAtMs: 1789999999000 },
    },
    {
      id: 's2', name: 'smoke 禁用件', enabled: false,
      schedule: { kind: 'every', everyMs: 1800000 }, state: {},
    },
  ],
}));
if (rows.length !== 2) fail(`解析应得 2 行，实得 ${rows.length}`);

const pool = new pg.Pool({});
const INSERT = `INSERT INTO ops_schedule_entries
    (source, host_alias, label, kind, schedule_desc, next_run_utc, last_state, last_exit_code, active, updated_at)
  VALUES ('openclaw','smoke-mmv',$1,$2,$3,$4,$5,$6,TRUE,NOW())
  ON CONFLICT (source, host_alias, label) DO UPDATE SET
    kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc,
    next_run_utc=EXCLUDED.next_run_utc, last_state=EXCLUDED.last_state`;
for (const r of rows) {
  await pool.query(INSERT, [r.label, r.kind, r.schedule_desc, r.next_run_utc, r.last_state, r.last_exit_code]);
}

const { rows: back } = await pool.query(
  `SELECT label, kind, schedule_desc, last_state FROM ops_schedule_entries
    WHERE source='openclaw' AND host_alias='smoke-mmv' ORDER BY label`,
);
if (back.length !== 2) fail(`真表应读回 2 行，实得 ${back.length}`);
else ok('2 行真写进 ops_schedule_entries 并读得回');

const brief = back.find((x) => x.label === 'smoke 晨报');
if (!brief || brief.kind !== 'openclaw_cron'
    || !String(brief.schedule_desc).includes('25 6 * * 1-5')
    || brief.last_state !== 'error') {
  fail(`cron 行字段不对: ${JSON.stringify(brief)}`);
} else ok('cron 行的 kind/表达式/状态逐字段正确');

const off = back.find((x) => x.label === 'smoke 禁用件');
if (!off || off.last_state !== 'disabled') fail(`禁用件应标 disabled，实得 ${JSON.stringify(off)}`);
else ok('禁用的活也进台账并标 disabled');

// ③ 判据必须经**真 loader 的真 SELECT** 读到 soon-reset 所需的列。
// 0921 事故：seven_day_reset_at 建了列、采到了数据，但 LEDGER_SQL 漏了这列，
// judgeAccount 读到 undefined、豁免上产即死。单测手工构造 row、本 smoke 的 ②
// 段自插自读，两边都绕开了生产真正用的那条 SELECT——所以必须专门走一次 loader。
{
  const { createQuotaLedgerLoader } = await import('../../src/orchestrator/preflight/account-quota-ledger.js');
  const soon = new Date(Date.now() + 10 * 60_000).toISOString();
  await pool.query(
    `INSERT INTO ops_model_accounts
       (account_id, provider, five_hour_pct, seven_day_pct, seven_day_reset_at,
        host_alias, forwardable, forward_targets, status, consecutive_failures)
     VALUES ('claude-account1','claude',1,95,$1,'mmv',false,'[]'::jsonb,'ok',0)
     ON CONFLICT (account_id) DO UPDATE SET
       five_hour_pct=1, seven_day_pct=95, seven_day_reset_at=EXCLUDED.seven_day_reset_at,
       status='ok', consecutive_failures=0`,
    [soon],
  );
  const snap = await (createQuotaLedgerLoader({ pool }))();
  const v = snap.verdictFor('account1');
  if (v.verdict !== 'usable') {
    fail(`7d=95% 但 10 分钟后重置，应豁免为 usable，实得 ${JSON.stringify(v)}`
       + '（多半是 LEDGER_SQL 又漏了列）');
  } else ok('经真 loader 的真 SELECT，soon-reset 豁免生效');
}

await pool.query("DELETE FROM ops_model_accounts WHERE account_id='claude-account1'");
await pool.end();
process.exit(bad === 0 ? 0 : 1);
