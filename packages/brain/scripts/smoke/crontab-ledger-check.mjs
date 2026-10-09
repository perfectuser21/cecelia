/**
 * crontab-ledger-check.mjs — 由 crontab-ledger-smoke.sh 调用。
 *
 * 单测证明的是「这段文本解析对不对」；本 smoke 证明的是
 * 「解析结果真能落进真 PG 的 ops_schedule_entries 并原样读回来」——
 * 单测用的是 fakePool，只记 SQL 字符串，证明不了列类型/长度/唯一键吃不吃得下。
 */
import pg from 'pg';
import {
  parseCrontab, parseCrontabWithHost, CRONTAB_CMD_USVPS, CRONTAB_CMD_MMV, CRONTAB_HOST_EXPECT,
} from '../../src/ops-collector.js';

let bad = 0;
const fail = (s) => { console.error('  ❌ ' + s); bad += 1; };
const ok = (s) => console.log('  ✅ ' + s);

// ① 两条腿的取数命令必须自带落点证明，且打的不是同一台机
for (const [name, cmd] of [['us-vps', CRONTAB_CMD_USVPS], ['mmv', CRONTAB_CMD_MMV]]) {
  if (!/hostname/.test(cmd)) fail(`${name} 取数命令没带 hostname 自证: ${cmd}`);
  else if (!/crontab -l/.test(cmd)) fail(`${name} 取数命令没取 crontab: ${cmd}`);
  else ok(`${name} 取数命令自带 hostname 落点证明`);
}
if (CRONTAB_CMD_USVPS === CRONTAB_CMD_MMV) fail('两条腿命令相同，等于采两遍同一张表');
else ok('两条腿打不同机器');

// ①b 落点不符必须抛错——0921 上产即错：采到 MMV 的表却标成 us-vps
const MMV_OUT = 'aad17-2.macminivault.com\n*/3 * * * * /bin/true # smoke-x';
let threw = false;
try { parseCrontabWithHost(MMV_OUT, CRONTAB_HOST_EXPECT['us-vps']); } catch { threw = true; }
if (!threw) fail('采到 MMV 的表却被当成 us-vps 收下了（落点自证失效）');
else ok('落点不符立刻抛错，不入错机器的数据');

// ② 三类行分清：活的 / 被注释掉的活 / 纯说明
const SAMPLE = [
  '# 这是说明，不是活',
  'MAILTO=""',
  '*/30 * * * * /usr/bin/python3 /opt/openclaw/opc-objects-sync.py >> /var/log/a.log 2>&1',
  '#[retired-0921] 45 20 * * * docker restart openclaw-gateway # smoke-retired-job',
  '*/3 * * * * /usr/bin/python3 /opt/openclaw/notion-qiumi-delegate.py # smoke-delegate-job',
].join('\n');
const rows = parseCrontab(SAMPLE);
if (rows.length !== 3) fail(`应解析 3 条活，实得 ${rows.length}：${rows.map((r) => r.label).join(' | ')}`);
else ok('3 类行分清：说明与 env 行被跳过，两条活 + 一条停用被收');

const retired = rows.find((r) => r.label === 'smoke-retired-job');
if (!retired || retired.last_state !== 'disabled') fail(`被注释掉的活应标 disabled，实得 ${JSON.stringify(retired)}`);
else ok('被注释掉的活标 disabled（看不见的禁用等于悄悄少干活）');

// ③ 真写进真表并逐字段读回
const pool = new pg.Pool({});
const INSERT = `INSERT INTO ops_schedule_entries
    (source, host_alias, label, kind, schedule_desc, next_run_utc, last_state, last_exit_code, active, updated_at)
  VALUES ('crontab','smoke-us-vps',$1,$2,$3,$4,$5,$6,TRUE,NOW())
  ON CONFLICT (source, host_alias, label) DO UPDATE SET
    kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc,
    next_run_utc=EXCLUDED.next_run_utc, last_state=EXCLUDED.last_state`;
for (const r of rows) {
  await pool.query(INSERT, [r.label, r.kind, r.schedule_desc, r.next_run_utc, r.last_state, r.last_exit_code ?? null]);
}

const { rows: back } = await pool.query(
  `SELECT label, kind, schedule_desc, last_state FROM ops_schedule_entries
    WHERE source='crontab' AND host_alias='smoke-us-vps' ORDER BY label`,
);
if (back.length !== 3) fail(`真表应读回 3 行，实得 ${back.length}`);
else ok('3 行真写进 ops_schedule_entries 并读得回');

const dele = back.find((x) => x.label === 'smoke-delegate-job');
if (!dele || dele.kind !== 'crontab' || !String(dele.schedule_desc).includes('*/3 * * * *') || dele.last_state !== null) {
  fail(`活的行字段不对: ${JSON.stringify(dele)}`);
} else ok('活的行 kind/表达式/状态逐字段正确');

// ④ 同脚本多排期不得互相覆盖——label 是唯一键的一部分，撞名会静默只剩一条
const MULTI = [
  '10 22 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
  '35 3,9 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
  '30 16 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
].join('\n');
const multi = parseCrontab(MULTI);
for (const r of multi) {
  await pool.query(INSERT, [r.label, r.kind, r.schedule_desc, r.next_run_utc, r.last_state, null]);
}
const { rows: m } = await pool.query(
  `SELECT count(*)::int AS n FROM ops_schedule_entries
    WHERE source='crontab' AND host_alias='smoke-us-vps' AND label LIKE 'opc-kr-current.py%'`,
);
if (m[0].n !== 3) fail(`同脚本三条不同排期应各占一行，实得 ${m[0].n} 行（撞名互相覆盖了）`);
else ok('同脚本三条不同排期在真表里各占一行，没互相覆盖');

await pool.query("DELETE FROM ops_schedule_entries WHERE source='crontab' AND host_alias='smoke-us-vps'");
await pool.end();
process.exit(bad === 0 ? 0 : 1);
