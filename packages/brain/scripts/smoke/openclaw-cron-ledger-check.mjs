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

await pool.end();
process.exit(bad === 0 ? 0 : 1);
