/**
 * qiumi-cutover-guard.test.js — 秋米切换脚本的守卫（PR3 Task 6）。
 *
 * 守的是「切换这件事不能被悄悄删掉一步」：生产确认闸、在途清零、旧 cron 退役、
 * 存量 headed_manual 清理、排程台账更新、SINCE 写死。脚本是运维件，CI 跑不动它，
 * 唯一能自动化的就是对文本下断言。
 *
 * 断言集合抽成 assertCutoverGuards()，变异测试才是真的：把脚本里在途检查那行删掉的副本
 * 必须让同一组断言抛错（崩溃红 ≠ 断言红，见 feedback_mutation_test_the_guard）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../../');
const CUTOVER = path.join(ROOT, 'scripts/ops/qiumi-cutover.sh');
const INFLIGHT = path.join(ROOT, 'scripts/ops/qiumi-inflight-check.mjs');
const ALLOWLIST = path.join(ROOT, '../quality/smoke-allowlist.txt');
const RUNBOOK = path.resolve(ROOT, '../../docs/runbooks/qiumi-cutover.md');

const read = (p) => fs.readFileSync(p, 'utf8');

/** 只留代码行：注释里写什么顺序都不算数，顺序闸看的是真正会执行的那几行。 */
const stripComments = (text) => text
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** 取第 n 步的代码块（两个 `# ── step N` 分节标记之间），用来判断某段代码落在哪一步里。 */
export function stepBlock(text, n) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^# ──+ step ${n}`).test(l));
  if (start < 0) throw new Error(`qiumi-cutover.sh 找不到 step ${n} 分节标记`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^# ──+ step \d/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * 顺序闸（PR2 终审）：停旧 cron 必须排在打开同步开关之前。
 *
 * 并存期防双认领没有第二条防线——Notion 侧没有条件写，谁先看到委派行谁就认领。
 * 旧 cron（每 3 分钟一轮）与 Brain 同步循环同时开着，SINCE 之后新建的行两边都能领走。
 * 所以脚本里 step1 那段必须先于写 `QIUMI_SYNC_ENABLED=true` 的那行（影子跑同理，它不是并跑）。
 *
 * 锚点钉在代码上不是注释上：注释挪来挪去不该让守卫变色，把 step3 的代码块搬到 step1 前必须变红。
 */
export function assertCutoverOrder(text) {
  const code = stripComments(text);
  const step1At = code.indexOf('if run_step 1');
  const syncAt = code.search(/QIUMI_SYNC_ENABLED=true/);
  if (step1At < 0) throw new Error('qiumi-cutover.sh 缺少 step1 分支');
  if (syncAt < 0) throw new Error('qiumi-cutover.sh 缺少同步开关写入（QIUMI_SYNC_ENABLED=true）');
  if (step1At > syncAt) {
    throw new Error('qiumi-cutover.sh 顺序错：停旧 cron 必须排在打开 QIUMI_SYNC_ENABLED 之前');
  }
  // step4 也要过前两步那两道校验：单跑 `--step=4` 不验，就会在旧 cron 还活着的时候
  // 把存量任务的 headed_manual 摘掉——闸一摘，两边一起派真机。
  const step4 = stripComments(stepBlock(text, 4));
  for (const fn of ['require_cron_retired', 'require_inflight_cleared']) {
    if (!step4.includes(fn)) {
      throw new Error(`qiumi-cutover.sh step4 没有调用 ${fn}（单跑 step4 会绕过前两步）`);
    }
  }
}

/**
 * 回滚必须是机械动作，不是 runbook 里几行手敲的 ssh。
 *
 * 两个洞（终审）：step4 把存量行的 headed_manual 永久摘了，回滚后 Brain 照样派这些活，
 * 与复活的旧 cron 双跑真机；回滚只关派发不关同步，又和「cron 与同步循环同开必双认领」自相矛盾。
 * 所以脚本自己要能关两个开关、并把存量行重新上闸。
 */
export function assertRollback(text) {
  if (!/--rollback/.test(text)) throw new Error('qiumi-cutover.sh 缺少 --rollback 分支');
  for (const kv of ['QIUMI_SYNC_ENABLED=false', 'QIUMI_DISPATCH_ENABLED=false']) {
    if (!text.includes(kv)) throw new Error(`qiumi-cutover.sh 回滚没有写 ${kv}`);
  }
  // 钉在真正会执行的 SQL 字面量上，不是「文里提过 headed_manual=true」——
  // 注释里写一句「回滚会重新上闸」骗不过这条。
  if (!text.includes('{\\"headed_manual\\":true}')) {
    throw new Error('qiumi-cutover.sh 回滚没有把存量任务重新上闸（headed_manual=true 的 SQL）');
  }
  if (!/COALESCE\(payload->>'headed_manual','false'\) <> 'true'/.test(text)) {
    throw new Error('qiumi-cutover.sh 回滚上闸没有跳过已上闸的行');
  }
}

/**
 * SINCE 必须在 step1（停旧 cron 那一刻）取值并落盘，step3 只是把它读出来写进 env。
 *
 * 取值时刻错了会漏行：step1 停 cron 到 step3 写 env 之间新建的委派行，旧脚本已经不管了，
 * 而 Brain 侧 `created_time on_or_after SINCE` 又把它们挡在外面——两边都不收，永久丢失。
 */
export function assertSinceTakenAtStep1(text) {
  if (!/date -u/.test(stepBlock(text, 1))) {
    throw new Error('qiumi-cutover.sh step1 没有在停 cron 那一刻取 SINCE');
  }
  if (/date/.test(stepBlock(text, 3))) {
    throw new Error('qiumi-cutover.sh step3 不该再算时间——SINCE 只能读 step1 落盘的值');
  }
  if (!/exit 7/.test(stepBlock(text, 3))) {
    throw new Error('qiumi-cutover.sh step3 缺少「SINCE 状态文件不存在」的拒绝分支');
  }
}

/**
 * 在途检查的豁免名单：只有 Brain 侧自己写的号才算「不是旧脚本的活」。
 *
 * `relay-` 是旧脚本自己写、自己收的手机链前缀（notion-qiumi-delegate LIVE:243 写号、
 * 482-484 回收）。把它放进豁免，就会把旧脚本手上没干完的活读成「已清零」，
 * 然后切换照常往下走——这是最坏的一种假绿：检查通过了，活丢了。
 */
export function assertInflightFilter(text) {
  const filter = text.match(/^const BRAIN_SIDE_PREFIX = (.+);$/m)?.[1];
  if (!filter) throw new Error('qiumi-inflight-check.mjs 找不到 BRAIN_SIDE_PREFIX 过滤正则');
  for (const p of ['brain:', 'en:']) {
    if (!filter.includes(p)) throw new Error(`qiumi-inflight-check.mjs 豁免名单缺 ${p}`);
  }
  if (/relay/.test(filter)) {
    throw new Error('qiumi-inflight-check.mjs 不许豁免 relay-：那是旧脚本自己的在途活');
  }
}

/**
 * step1 取的 SINCE 必须当场就写进远端 .env，本机状态文件只是副本；step3 只负责保持。
 * 中间隔着等在途（最长 30min）和重建容器，值留在本机越久越容易被「重跑一下 step3」冲掉。
 */
export function assertSinceWrittenAtStep1(text) {
  if (!/QIUMI_SYNC_SINCE/.test(stepBlock(text, 1))) {
    throw new Error('qiumi-cutover.sh step1 取了 SINCE 却没当场写进 .env');
  }
}

/**
 * 退 6 那道闸不止验「旧 cron 停了」，还要验「在途真的清零过」。
 * 只验 cron 挡不住这种走法：跑了 step1、跳过 step2 直接 step3——旧脚本手上那批活还在跑，
 * 开关却已经开了。step2 清零时写 inflight_cleared_at，step3 缺它同样退 6。
 */
export function assertStep2Receipt(text) {
  if (!/inflight_cleared_at/.test(stepBlock(text, 2))) {
    throw new Error('qiumi-cutover.sh step2 清零后没有留 inflight_cleared_at 凭据');
  }
  if (!/inflight_cleared_at/.test(stepBlock(text, 3))) {
    throw new Error('qiumi-cutover.sh step3 没有校验 inflight_cleared_at（跳过 step2 就能开闸）');
  }
}

/** 切换脚本必须成立的六条。任一不成立即抛——变异副本靠这个函数抓。 */
export function assertCutoverGuards(text) {
  const must = [
    [/--confirm-prod/, '生产库确认闸'],
    [/qiumi-inflight-check\.mjs/, '在途清零检查'],
    [/notion-qiumi-delegate\.py/, '旧 cron 退役'],
    [/payload - 'headed_manual'/, '存量 queued 任务解闸'],
    [/ops_schedule_entries/, '排程台账更新'],
    [/QIUMI_DISPATCH_ENABLED/, '派发开关'],
    [/QIUMI_SYNC_SINCE/, '同步起点开关'],
    [/date -u/, '同步起点取执行时刻'],
    [/\|\| exit 1[\s\S]*\| crontab -/, 'crontab 读失败即止（绝不装空表）'],
    // 切换当下被三振 blocked 或急停 paused 的行，日后回 queued 时闸还在身上，
    // 只清 queued 等于把它们永久排除在派发之外。
    [/status IN \('queued', ?'blocked', ?'paused'\)/, '存量清理覆盖 queued/blocked/paused'],
  ];
  for (const [re, what] of must) {
    if (!re.test(text)) throw new Error(`qiumi-cutover.sh 缺少${what}（${re}）`);
  }
}

describe('qiumi-cutover.sh 守卫', () => {
  it('存在且含生产确认闸、在途检查、四步全套', () => {
    expect(() => assertCutoverGuards(read(CUTOVER))).not.toThrow();
  });

  it('变异：去掉在途检查的副本必须被同一组断言抓住', () => {
    const mutated = read(CUTOVER).replace(/^.*qiumi-inflight-check\.mjs.*$/gm, '');
    expect(() => assertCutoverGuards(mutated)).toThrow(/在途清零检查/);
  });

  it('变异：去掉生产确认闸的副本必须被抓住', () => {
    const mutated = read(CUTOVER).replace(/--confirm-prod/g, '');
    expect(() => assertCutoverGuards(mutated)).toThrow(/生产库确认闸/);
  });

  it('停旧 cron 排在打开 QIUMI_SYNC_ENABLED 之前', () => {
    expect(() => assertCutoverOrder(read(CUTOVER))).not.toThrow();
  });

  it('变异：把 step3 整块挪到 step1 之前必须被抓住（注释原地不动）', () => {
    const text = read(CUTOVER);
    const block = stepBlock(text, 3);
    // 只搬代码块，分节注释留在原处——注释骗不过顺序闸。
    const mutated = text.replace(block, '').replace('# ── step 1', `${block}\n# ── step 1`);
    expect(() => assertCutoverOrder(mutated)).toThrow(/顺序错/);
  });

  it('SINCE 在 step1 取值并落盘，step3 只读不算', () => {
    expect(() => assertSinceTakenAtStep1(read(CUTOVER))).not.toThrow();
  });

  it('变异：step1 不取 SINCE 的副本必须被抓住', () => {
    const text = read(CUTOVER);
    const mutated = text.replace(stepBlock(text, 1), stepBlock(text, 1).replace(/date -u/g, 'echo'));
    expect(() => assertSinceTakenAtStep1(mutated)).toThrow(/step1 没有在停 cron 那一刻取 SINCE/);
  });

  it('step1 取到 SINCE 当场写进 .env，step3 只保持', () => {
    expect(() => assertSinceWrittenAtStep1(read(CUTOVER))).not.toThrow();
  });

  it('变异：step1 只落本机不写 .env 的副本必须被抓住', () => {
    const text = read(CUTOVER);
    const mutated = text.replace(stepBlock(text, 1), stepBlock(text, 1).replace(/QIUMI_SYNC_SINCE/g, 'X'));
    expect(() => assertSinceWrittenAtStep1(mutated)).toThrow(/没当场写进 \.env/);
  });

  it('step3 的退 6 闸顺带验 step2：在途清零留凭据', () => {
    expect(() => assertStep2Receipt(read(CUTOVER))).not.toThrow();
  });

  it('变异：step2 不留清零凭据 / step3 不校验，都必须被抓住', () => {
    const text = read(CUTOVER);
    const noWrite = text.replace(stepBlock(text, 2), stepBlock(text, 2).replace(/inflight_cleared_at/g, 'X'));
    expect(() => assertStep2Receipt(noWrite)).toThrow(/step2 清零后没有留/);
    const noCheck = text.replace(stepBlock(text, 3), stepBlock(text, 3).replace(/inflight_cleared_at/g, 'X'));
    expect(() => assertStep2Receipt(noCheck)).toThrow(/step3 没有校验/);
  });

  it('回滚是机械动作：--rollback 关两个开关 + 存量重新上闸', () => {
    expect(() => assertRollback(read(CUTOVER))).not.toThrow();
  });

  it('变异：去掉 --rollback / 少关一个开关 / 不重新上闸，都必须被抓住', () => {
    const text = read(CUTOVER);
    expect(() => assertRollback(text.replace(/--rollback/g, '--xx'))).toThrow(/缺少 --rollback/);
    expect(() => assertRollback(text.replace(/QIUMI_SYNC_ENABLED=false/g, 'X')))
      .toThrow(/没有写 QIUMI_SYNC_ENABLED=false/);
    expect(() => assertRollback(text.replace('{\\"headed_manual\\":true}', '{}')))
      .toThrow(/没有把存量任务重新上闸/);
  });

  it('变异：step4 少一道前置校验必须被抓住', () => {
    const text = read(CUTOVER);
    const b4 = stepBlock(text, 4);
    for (const fn of ['require_cron_retired', 'require_inflight_cleared']) {
      const mutated = text.replace(b4, b4.replace(new RegExp(`\\s*${fn}\\b.*`, 'g'), ''));
      expect(() => assertCutoverOrder(mutated)).toThrow(new RegExp(`step4 没有调用 ${fn}`));
    }
  });

  it('变异：存量清理缩回只认 queued 必须被抓住', () => {
    const mutated = read(CUTOVER).replace(
      /status IN \('queued', ?'blocked', ?'paused'\)/g,
      "status='queued'",
    );
    expect(() => assertCutoverGuards(mutated)).toThrow(/存量清理覆盖 queued\/blocked\/paused/);
  });

  it('--rollback 只认 step3/step4，其它一律退 64', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiumi-rollback-scope-'));
    // 假 ssh：step3 --rollback 是唯一该放行的分支，不能让它真打到 us-vps。
    fs.writeFileSync(path.join(tmp, 'ssh'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(tmp, 'ssh'), 0o755);
    const run = (script, args) => spawnSync('bash', [script, ...args], {
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, CUTOVER_STATE_DIR: tmp },
      encoding: 'utf8',
    });

    // step1/step2 是正向动作（停 cron、等清零），配 --rollback 是自相矛盾的组合；
    // STEP=all 更糟——会把正向四步连着跑一遍。
    for (const args of [['--rollback'], ['--step=1', '--rollback'], ['--step=2', '--rollback']]) {
      expect(run(CUTOVER, args).status).toBe(64);
    }
    expect(run(CUTOVER, ['--step=3', '--rollback']).status).toBe(0);

    // 变异：把这道范围闸去掉，`--step=1 --rollback` 就会真去停 cron。
    const mutated = path.join(tmp, 'mutated.sh');
    fs.writeFileSync(mutated, read(CUTOVER).replace(/^if \[\[ \$ROLLBACK -eq 1 &&.*$/m, 'if false; then'));
    expect(run(mutated, ['--step=1', '--rollback']).status).not.toBe(64);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runbook 写明 step1-4 必须同机执行', () => {
    const s = read(RUNBOOK);
    expect(s).toMatch(/同机/);
    expect(s).toMatch(/CUTOVER_STATE_DIR/);
    // 换机的后果要写出来，不然读者不知道为什么非得同机
    expect(s).toMatch(/退 6\/7|退 6 \/ 7/);
  });

  it('runbook 回滚先关两个开关、复活 cron 排最后', () => {
    const s = read(RUNBOOK);
    const rollback = s.slice(s.indexOf('## 5.'));
    expect(rollback).toMatch(/--rollback/);
    expect(rollback).toMatch(/QIUMI_SYNC_ENABLED=false/);
    expect(rollback).toMatch(/QIUMI_DISPATCH_ENABLED=false/);
    // 复活 cron 必须排在「关开关 + 重新上闸」之后，否则中间那段两边同时活着。
    expect(rollback.indexOf('QIUMI_SYNC_ENABLED=false')).toBeLessThan(rollback.indexOf('retired-qiumi-cutover'));
    expect(rollback.indexOf('--rollback')).toBeLessThan(rollback.indexOf('retired-qiumi-cutover'));
  });

  it('runbook 标明 SINCE fail-closed 依赖 PR2 终版', () => {
    const s = read(RUNBOOK);
    // 「SINCE 缺失 fail-closed」这句话只在 PR2 终版（#5502）上才成立——PR2 中间版本缺
    // SINCE 会自钉当下，那条防线在它们上面不存在。runbook 必须写明这个依赖，
    // 否则照着它做切换的人会以为自己有一条其实不在的防线。
    expect(s).toMatch(/fail-closed/);
    expect(s).toMatch(/#5502/);
  });

  it('变异：把取值挪回 step3 的副本必须被抓住', () => {
    const text = read(CUTOVER);
    const b3 = stepBlock(text, 3);
    const mutated = text.replace(b3, `  NOW="$(date -u +%FT%TZ)"\n${b3}`);
    expect(() => assertSinceTakenAtStep1(mutated)).toThrow(/step3 不该再算时间/);
  });

  it('step3 自己也有顺序闸：旧 cron 未退役时拒绝开闸', () => {
    const s = read(CUTOVER);
    // 光靠 runbook 写「先停 cron」不算闸——脚本必须自己回 us-vps 验一遍，不过就退 6。
    expect(s).toMatch(/exit 6/);
    expect(s).toMatch(/必须先跑 --step=1/);
  });

  it('变异：去掉存量任务解闸 SQL 的副本必须被抓住', () => {
    const mutated = read(CUTOVER).replace(/payload - 'headed_manual'/g, '');
    expect(() => assertCutoverGuards(mutated)).toThrow(/存量 queued 任务解闸/);
  });

  it('step4 对非 _test/_scratch 库缺 --confirm-prod 必须非零退出', () => {
    const s = read(CUTOVER);
    // 判据是「库名后缀 + CONFIRM_PROD 标志」同时成立才放行，且不通过时 exit 非 0
    expect(s).toMatch(/_test\|_scratch/);
    expect(s).toMatch(/CONFIRM_PROD/);
    expect(s).toMatch(/exit 4/);
  });

  it('在途检查只滤 brain:/en:，relay- 必须计入在途', () => {
    // 断言钉在过滤正则本身，不是整份文件：注释里解释「为什么 relay 不豁免」是该留的。
    expect(() => assertInflightFilter(read(INFLIGHT))).not.toThrow();
    expect(read(INFLIGHT)).toMatch(/process\.exit\(/);
    expect(read(INFLIGHT)).toMatch(/OpenClaw任务号/);
  });

  it('变异：把 relay- 加回豁免名单必须被抓住', () => {
    const mutated = read(INFLIGHT).replace(
      /^const BRAIN_SIDE_PREFIX = .+;$/m,
      'const BRAIN_SIDE_PREFIX = /^(brain:|en:|relay-)/;',
    );
    expect(() => assertInflightFilter(mutated)).toThrow(/不许豁免 relay-/);
  });

  it('step4 生产闸实测：非测试库缺 --confirm-prod 退 4，给了 flag 才走到 psql', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiumi-cutover-guard-'));
    const marker = path.join(tmp, 'psql-called');
    // 假 psql 顶在 PATH 前：闸放行与否，看的是它有没有被调用过——不连任何数据库。
    fs.writeFileSync(path.join(tmp, 'psql'), `#!/bin/sh\necho called >> ${marker}\nexit 0\n`);
    fs.chmodSync(path.join(tmp, 'psql'), 0o755);
    // 假 ssh：step4 现在也验「旧 cron 已退役」，真 ssh 会打到 us-vps 去。
    // grep -qE 退 1 = 没有未注释的旧 cron 行 = 已退役。
    fs.writeFileSync(path.join(tmp, 'ssh'), '#!/bin/sh\ncase "$*" in *"grep -qE"*) exit 1 ;; *) exit 0 ;; esac\n');
    fs.chmodSync(path.join(tmp, 'ssh'), 0o755);
    // step4 的另一道前置：step2 的清零凭据
    const state = path.join(tmp, 'state');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'inflight_cleared_at'), '2026-09-23T00:00:00Z\n');
    const run = (args) => spawnSync('bash', [CUTOVER, ...args], {
      env: {
        ...process.env,
        PATH: `${tmp}:${process.env.PATH}`,
        DATABASE_URL: 'postgresql://u@localhost:5432/cecelia',
        CUTOVER_STATE_DIR: state,
      },
      encoding: 'utf8',
    });

    const refused = run(['--step=4']);
    expect(refused.status).toBe(4);
    expect(refused.stdout).toMatch(/非测试库/);
    expect(fs.existsSync(marker)).toBe(false);

    const allowed = run(['--step=4', '--confirm-prod']);
    expect(allowed.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);

    // 前置校验也得真挡：把 step2 的清零凭据抽走，step4 必须退 6 而不是照摘不误。
    fs.rmSync(path.join(state, 'inflight_cleared_at'));
    fs.rmSync(marker);
    const noReceipt = run(['--step=4', '--confirm-prod']);
    expect(noReceipt.status).toBe(6);
    expect(fs.existsSync(marker)).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('smoke 已登记 allowlist 且保持字母序', () => {
    const lines = read(ALLOWLIST).split('\n').filter(Boolean);
    const i = lines.indexOf('qiumi-routing-smoke.sh');
    expect(i).toBeGreaterThan(-1);
    expect(lines[i - 1] <= lines[i]).toBe(true);
    expect(lines[i + 1] === undefined || lines[i] <= lines[i + 1]).toBe(true);
  });

  it('runbook 写明影子跑、重建容器与回滚', () => {
    const s = read(RUNBOOK);
    expect(s).toMatch(/影子跑/);
    expect(s).toMatch(/重建容器/);
    expect(s).toMatch(/回滚/);
    // 重启不改 SINCE：改了会把已入账的历史再拉一遍
    expect(s).toMatch(/QIUMI_SYNC_SINCE/);
  });
});
