/**
 * contract-gate.test.js — 确定性 gate 逐规则回归（对 repo 内永久 fixtures）。
 *
 * 覆盖 contract-draft Step 1-7 + Test Contract 第 1 行：
 *  6 类作弊命中 / 干净通过 / env_missing / 域规则 / 豁免留痕 / 边界 + fail-closed。
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runContractGate,
  evaluateContractText,
  isTautology,
  isNegativeFailAssertion,
  isStatusCodeOracle,
  hasCaptureThenAssert,
  isAggregateDbProbeWithoutWindow,
  formatGateReport,
  RULES,
  ENV_CAPABILITY,
} from '../contract-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, 'fixtures', 'contract-gate');

const SIX_CHEAT_RULES = [
  'weak-oracle/curl-no-jq',
  'cheat/mock-env',
  'cheat/exit-0-fallback',
  'cheat/or-true',
  'weak-oracle/file-existence-only',
  'weak-oracle/tautology',
];

describe('runContractGate — 作弊样本（cheat）', () => {
  it('非零判定 ok=false 且命中 ≥6 条，6 类 ruleId 全覆盖', async () => {
    const r = await runContractGate(path.join(FX, 'cheat'));
    expect(r.ok).toBe(false);
    const hitRuleIds = r.hits.map((h) => h.ruleId);
    for (const rule of SIX_CHEAT_RULES) {
      expect(hitRuleIds, `规则 ${rule} 应命中`).toContain(rule);
    }
    // 未豁免命中 ≥6（对应 CLI 的 HIT 行 ≥6）
    const unexempted = r.hits.filter((h) => !h.exempted);
    expect(unexempted.length).toBeGreaterThanOrEqual(6);
    // 每条命中含规则名 + 行号 + 摘录 + feedback
    for (const h of unexempted) {
      expect(h.ruleId).toBeTruthy();
      expect(typeof h.line).toBe('number');
      expect(h.excerpt).toBeTruthy();
      expect(h.feedback).toBeTruthy();
    }
  });
});

describe('runContractGate — 干净样本（clean）', () => {
  it('无命中、无 env_missing → ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'clean'));
    expect(r.ok).toBe(true);
    expect(r.hits.filter((h) => !h.exempted)).toHaveLength(0);
    expect(r.envMissing).toHaveLength(0);
  });
});

describe('runContractGate — 工具 preflight（env-missing）', () => {
  it('引用 docker/ffprobe → env_missing 含工具名，ok=false', async () => {
    const r = await runContractGate(path.join(FX, 'env-missing'));
    expect(r.ok).toBe(false);
    const tools = r.envMissing.map((e) => e.tool);
    expect(tools).toContain('docker');
    expect(tools).toContain('ffprobe');
    for (const e of r.envMissing) {
      expect(typeof e.line).toBe('number');
      expect(e.excerpt).toBeTruthy();
    }
  });
});

describe('runContractGate — 领域规则（db-no-window）', () => {
  it('DB 写入无时间窗 → 命中 domain/db-no-time-window', async () => {
    const r = await runContractGate(path.join(FX, 'db-no-window'));
    expect(r.ok).toBe(false);
    expect(r.hits.map((h) => h.ruleId)).toContain('domain/db-no-time-window');
  });
});

describe('runContractGate — 误报逃生口（exempt）', () => {
  it('gate-allow 豁免单条规则：命中被标 exempted、exemption.matched=true、整体 ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'exempt'));
    const fileHit = r.hits.find((h) => h.ruleId === 'weak-oracle/file-existence-only');
    expect(fileHit).toBeTruthy();
    expect(fileHit.exempted).toBe(true);
    const ex = r.exemptions.find((e) => e.ruleId === 'weak-oracle/file-existence-only');
    expect(ex).toBeTruthy();
    expect(ex.matched).toBe(true);
    expect(ex.reason).toBeTruthy();
    // 唯一命中被豁免后无其他命中 → ok=true
    expect(r.ok).toBe(true);
  });
});

describe('runContractGate — 边界 + fail-closed', () => {
  it('空合同（无可验断言）→ structural/no-assertion，ok=false', async () => {
    const r = await runContractGate(path.join(FX, 'empty'));
    expect(r.ok).toBe(false);
    expect(r.hits.map((h) => h.ruleId)).toContain('structural/no-assertion');
  });

  it('不存在的目录 → throw（fail-closed，绝不静默放行）', async () => {
    await expect(runContractGate('/nonexistent/contract-gate/path')).rejects.toThrow();
  });

  it('缺 fixtureDir 参数 → throw（fail-closed）', async () => {
    await expect(runContractGate('')).rejects.toThrow();
  });
});

describe('数据化规则表 + 环境能力清单（单一来源）', () => {
  it('RULES 覆盖 6 类作弊 + 域规则，每条含 id/description/detect/feedback', () => {
    const ids = RULES.map((r) => r.id);
    for (const rule of [...SIX_CHEAT_RULES, 'domain/db-no-time-window']) {
      expect(ids).toContain(rule);
    }
    for (const r of RULES) {
      expect(typeof r.detect).toBe('function');
      expect(typeof r.feedback).toBe('function');
      expect(r.description).toBeTruthy();
    }
  });

  it('环境能力清单：docker/ffprobe/playwright 不可用，curl/jq/psql 可用', () => {
    expect(ENV_CAPABILITY.unavailable).toEqual(
      expect.arrayContaining(['docker', 'ffprobe', 'playwright'])
    );
    expect(ENV_CAPABILITY.available).toEqual(
      expect.arrayContaining(['curl', 'jq', 'psql'])
    );
  });
});

describe('isTautology — 精确性（防误伤真实断言）', () => {
  it('echo PASS | grep PASS → true（同义反复）', () => {
    expect(isTautology('echo PASS | grep PASS')).toBe(true);
  });
  it('X=ok; [ "$X" = ok ] → true（自赋值后比较同值）', () => {
    expect(isTautology('X=ok; [ "$X" = ok ] && echo done')).toBe(true);
  });
  it('echo "$OUT" | grep "weak-oracle/curl-no-jq" → false（grep 真实期望值，非同义反复）', () => {
    expect(isTautology('echo "$OUT" | grep -qE "weak-oracle/curl-no-jq"')).toBe(false);
  });
  it('echo PASS | grep FAIL → false（字面量不同）', () => {
    expect(isTautology('echo PASS | grep FAIL')).toBe(false);
  });
});

describe('cheat/or-true — 负向测试（预期失败）惯用法不误伤', () => {
  it('生产 fixture：cmd && { echo FAIL; exit N; } || true 整段 → 无 cheat/or-true，ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'or-true-negative'));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('cheat/or-true');
    expect(r.ok).toBe(true);
  });

  it('exit 1 负向断言行不命中 or-true', () => {
    const r = evaluateContractText(
      '  Test: manual:bash -c \'node check.mjs && { echo "FAIL: 应失败"; exit 1; } || true\''
    );
    expect(r.hits.map((h) => h.ruleId)).not.toContain('cheat/or-true');
  });

  it('多语句块 + exit "$N" 变体不命中 or-true', () => {
    const r = evaluateContractText(
      '  Test: manual:bash -c \'gate "$D" && { echo FAIL; rm -rf "$T"; exit "$N"; } || true\''
    );
    expect(r.hits.map((h) => h.ruleId)).not.toContain('cheat/or-true');
  });

  it('真吞错（无前置负向断言结构）仍命中 or-true', () => {
    const r1 = evaluateContractText("  Test: manual:bash -c 'assert_output || true'");
    expect(r1.hits.map((h) => h.ruleId)).toContain('cheat/or-true');
    const r2 = evaluateContractText("  Test: manual:bash -c 'grep -q foo file || true'");
    expect(r2.hits.map((h) => h.ruleId)).toContain('cheat/or-true');
  });

  it('多行 {} 复杂变体（块跨行）保守命中 or-true（作者用 gate-allow 豁免）', () => {
    // 块与 || true 不同行 → 行级匹配识别不到负向结构 → fail-closed 命中
    const r = evaluateContractText("  Test: manual:bash -c 'cmd; } || true'");
    expect(r.hits.map((h) => h.ruleId)).toContain('cheat/or-true');
  });

  it('isNegativeFailAssertion 精确性', () => {
    expect(isNegativeFailAssertion('cmd && { echo FAIL; exit 1; } || true')).toBe(true);
    expect(isNegativeFailAssertion('cmd && { echo FAIL; exit "$N"; } || true')).toBe(true);
    expect(isNegativeFailAssertion('cmd && { echo FAIL; return 2; } || true')).toBe(true);
    // exit 0 不是负向断言（那是兜底） → 不豁免
    expect(isNegativeFailAssertion('cmd && { echo x; exit 0; } || true')).toBe(false);
    // 无 && {...} 块的真吞错 → 不豁免
    expect(isNegativeFailAssertion('assert_output || true')).toBe(false);
  });
});

describe('evaluateContractText — 纯文本入口（不读盘）', () => {
  it('可直接对文本判定，命中 mock-env', () => {
    const r = evaluateContractText("Test: manual:bash -c 'MOCK_X=1 node a.js'");
    expect(r.hits.map((h) => h.ruleId)).toContain('cheat/mock-env');
  });
});

describe('硬化回归（code review findings — 防误杀/防绕过）', () => {
  it('H-1：工具名出现在 URL/镜像名子串里不算 env_missing（防误杀正常合同）', () => {
    const r = evaluateContractText(
      "  Test: manual:bash -c 'curl https://playwright.dev/docs | jq -e .ok && echo docker.io/img'"
    );
    expect(r.envMissing).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('H-1：真把 docker/ffprobe 当命令跑 → 仍命中 env_missing', () => {
    const r = evaluateContractText("  Test: manual:bash -c 'docker run x ffprobe /a.mp4'");
    expect(r.envMissing.map((e) => e.tool)).toEqual(
      expect.arrayContaining(['docker', 'ffprobe'])
    );
    expect(r.ok).toBe(false);
  });

  it('env-missing 可被 gate-allow 豁免（逃生口对 env 同样生效）', () => {
    const text = [
      'gate-allow: env-missing 该步骤本地 evaluator 用 mock 跑，docker 仅文档示例',
      "  Test: manual:bash -c 'docker run x ffprobe /a.mp4'",
    ].join('\n');
    const r = evaluateContractText(text);
    expect(r.envMissing.every((e) => e.exempted)).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.exemptions.find((e) => e.ruleId === 'env-missing').matched).toBe(true);
  });

  it('M-2：未闭合 ```bash 围栏 → 其后散文不被当命令（不因散文里的 || true 自锁）', () => {
    const text = ['```bash', '本段是未闭合围栏后的散文：不要用 || true 吞错', '（缺闭合栏）'].join(
      '\n'
    );
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).not.toContain('cheat/or-true');
  });

  it('M-3：块内 ```js 伪闭合不能藏掉后续真命令（防作弊绕过）', () => {
    const text = ['```bash', 'echo hi', '```js', 'MOCK_TOKEN=x node run.js', '```'].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).toContain('cheat/mock-env');
  });

  it('M-4：散文句中的 "Test:" 不被当命令扫描（防误命中）', () => {
    const r = evaluateContractText('Run the Test: section manually || true to skip.');
    expect(r.hits.map((h) => h.ruleId)).not.toContain('cheat/or-true');
  });
});

describe('盲区 A：反斜杠续行多行 pipeline（逻辑行归一后 curl-no-jq 不误报）', () => {
  it('生产 fixture（run c0e2546b Step 1）：curl 续行后 | jq -e → 无 curl-no-jq，ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'multiline-curl-jq'));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
    expect(r.ok).toBe(true);
  });

  it('归一前（物理行）等价输入会误报，归一后（同逻辑语句）不报', () => {
    // 纯文本入口：续行 \ 把 curl 与 jq -e 拆到两物理行，逻辑上是一条 pipeline
    const text = [
      '```bash',
      'curl -sf -X POST localhost:5221/api/x \\',
      "  | jq -e '.url | type == \"string\"' > /dev/null \\",
      '  || { echo "FAIL"; exit 1; }',
      '```',
    ].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
    expect(r.ok).toBe(true);
  });

  it('续行后仍无任何 oracle 的裸 curl → 照抓 curl-no-jq（不放水）', () => {
    const text = [
      '```bash',
      'curl -sf http://localhost:5221/api/posts \\',
      '  -H "Accept: application/json"',
      '```',
    ].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).toContain('weak-oracle/curl-no-jq');
    // 报告行号锚定到逻辑语句的起始物理行（curl 行），而非续行
    const hit = r.hits.find((h) => h.ruleId === 'weak-oracle/curl-no-jq');
    expect(hit.line).toBe(2);
  });
});

describe('盲区 B：curl -w %{http_code} 状态码 oracle（curl-no-jq 放行）', () => {
  it('生产 fixture（run c0e2546b cleanup）：-w %{http_code} + 码断言 → 无 curl-no-jq，ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'status-code-oracle'));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
    expect(r.ok).toBe(true);
  });

  it('isStatusCodeOracle 精确性（引号变体兼容）', () => {
    expect(isStatusCodeOracle('curl -s -o /dev/null -w "%{http_code}" url')).toBe(true);
    expect(isStatusCodeOracle("curl -s -o /dev/null -w '%{http_code}' url")).toBe(true);
    expect(isStatusCodeOracle('curl -s -o /dev/null -w %{http_code} url')).toBe(true);
    expect(isStatusCodeOracle('curl -s -o /dev/null --write-out "%{http_code}" url')).toBe(true);
    // 无 -w / 无 %{http_code} → 不是状态码 oracle
    expect(isStatusCodeOracle('curl -s http://localhost/api')).toBe(false);
    expect(isStatusCodeOracle('curl -w "%{time_total}" url')).toBe(false);
  });

  it('单行状态码 oracle 直接放行', () => {
    const r = evaluateContractText(
      '  Test: manual:bash -c \'CODE=$(curl -s -o /dev/null -w "%{http_code}" url); [ "$CODE" = "200" ]\''
    );
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
  });
});

describe('逻辑行归一 — #3351 负向测试 + 既有规则在多行场景仍正确', () => {
  it('多行负向测试 fixture（cmd \\ && {...} \\ || true）→ 无 cheat/or-true，ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'multiline-negative'));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('cheat/or-true');
    expect(r.ok).toBe(true);
  });

  it('归一不给作弊者拆词绕过：test \\ -f 拆两行仍命中 file-existence-only', () => {
    const text = ['```bash', 'test \\', '  -f /tmp/out.mp4', '```'].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).toContain('weak-oracle/file-existence-only');
  });

  it('归一不给作弊者拆词绕过：MOCK_X=1 \\ node 拆两行仍命中 mock-env', () => {
    const text = ['```bash', 'MOCK_X=1 \\', '  node a.js', '```'].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).toContain('cheat/mock-env');
  });

  it('归一不给作弊者拆词绕过：assert \\ || true 拆两行仍命中 or-true（非负向结构）', () => {
    const text = ['```bash', 'assert_output \\', '  || true', '```'].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).toContain('cheat/or-true');
  });
});

describe('钝点 A：capture-then-assert 跨语句 oracle（curl-no-jq 放行）', () => {
  it('生产 fixture（run fa2b3e21）：RESP=$(curl) 捕获 + 下一句 jq -e 断言 → 无 curl-no-jq，ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'capture-then-assert'));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
    expect(r.ok).toBe(true);
  });

  it('反例 fixture：裸 RESP=$(curl) 后 K 行无断言 → 仍命中 curl-no-jq，ok=false（不放水）', async () => {
    const r = await runContractGate(path.join(FX, 'capture-no-assert'));
    expect(r.hits.map((h) => h.ruleId)).toContain('weak-oracle/curl-no-jq');
    expect(r.ok).toBe(false);
  });

  it('纯文本：捕获后下一句 [ "$CODE" 比较 ] 也算断言（放行）', () => {
    const text = [
      '```bash',
      'OUT=$(curl -sf localhost:5221/api/x)',
      '[ "$OUT" = "ok" ] || { echo FAIL; exit 1; }',
      '```',
    ].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
  });

  it('纯文本：捕获后 grep -q 断言（放行）', () => {
    const text = [
      '```bash',
      'BODY=$(curl -sf localhost/api/posts)',
      'echo "$BODY" | grep -q "published"',
      '```',
    ].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
  });

  it('变量名精确匹配：捕获 RESP 却断言无关 $OTHER → 不放行（防假放行）', () => {
    const text = [
      '```bash',
      'RESP=$(curl -sf localhost/api/x)',
      'echo "$OTHER" | jq -e ".ok"',
      '```',
    ].join('\n');
    const r = evaluateContractText(text);
    expect(r.hits.map((h) => h.ruleId)).toContain('weak-oracle/curl-no-jq');
  });

  it('K 窗外的断言不放行（断言落在第 7 条逻辑语句，超出 K=5）', () => {
    const logicalLines = [
      { content: 'RESP=$(curl -sf url)' }, // index 0
      { content: 'echo a' },
      { content: 'echo b' },
      { content: 'echo c' },
      { content: 'echo d' },
      { content: 'echo e' }, // index 5 (第 5 条之后)
      { content: 'echo "$RESP" | jq -e ".ok"' }, // index 6 — 超窗
    ];
    expect(hasCaptureThenAssert('RESP=$(curl -sf url)', { logicalLines, index: 0 })).toBe(false);
  });

  it('hasCaptureThenAssert 精确性：非捕获形态 / 无 ctx → false', () => {
    expect(hasCaptureThenAssert('curl -sf url', { logicalLines: [], index: 0 })).toBe(false);
    expect(hasCaptureThenAssert('RESP=$(curl url)', undefined)).toBe(false);
  });
});

describe('钝点 B：db-no-time-window 只打聚合/存在性探测，不误伤定点读/写语句', () => {
  it('生产 fixture（run fa2b3e21）：INSERT...RETURNING + WHERE id 定点读 → 无 db-no-time-window，ok=true', async () => {
    const r = await runContractGate(path.join(FX, 'db-point-read'));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('domain/db-no-time-window');
    expect(r.ok).toBe(true);
  });

  it('既有 fixture（真 count 无时间窗）→ 仍命中（不放水）', async () => {
    const r = await runContractGate(path.join(FX, 'db-no-window'));
    expect(r.hits.map((h) => h.ruleId)).toContain('domain/db-no-time-window');
  });

  it('isAggregateDbProbeWithoutWindow 分型精确性', () => {
    // 聚合无时间窗 → 命中
    expect(
      isAggregateDbProbeWithoutWindow("psql \"$DB\" -c \"SELECT count(*) FROM posts WHERE status='sent'\"")
    ).toBe(true);
    expect(isAggregateDbProbeWithoutWindow('psql "$DB" -c "SELECT sum(amount) FROM orders"')).toBe(
      true
    );
    // 主键等值定点读 → 放行
    expect(
      isAggregateDbProbeWithoutWindow('psql "$DB" -tAc "SELECT status FROM journey_features WHERE id=\'$ID\'"')
    ).toBe(false);
    expect(
      isAggregateDbProbeWithoutWindow('psql "$DB" -tAc "SELECT x FROM t WHERE task_id = 5"')
    ).toBe(false);
    // 写语句（INSERT...RETURNING / UPDATE / DELETE）→ 放行
    expect(
      isAggregateDbProbeWithoutWindow('psql "$DB" -tAc "INSERT INTO t (a) VALUES (1) RETURNING id"')
    ).toBe(false);
    expect(isAggregateDbProbeWithoutWindow('psql "$DB" -c "UPDATE t SET a=1 WHERE id=2"')).toBe(
      false
    );
    // 已带时间窗 → 放行
    expect(
      isAggregateDbProbeWithoutWindow(
        "psql \"$DB\" -c \"SELECT count(*) FROM posts WHERE created_at > NOW() - interval '5 minutes'\""
      )
    ).toBe(false);
    // 无主键等值的存在性探测（status 非主键）→ 保守命中（fail-closed）
    expect(
      isAggregateDbProbeWithoutWindow("psql \"$DB\" -c \"SELECT 1 FROM posts WHERE status='sent'\"")
    ).toBe(true);
    // 聚合即便同句含写，聚合读仍跨历史 → 命中
    expect(
      isAggregateDbProbeWithoutWindow('psql "$DB" -c "INSERT INTO t VALUES(1); SELECT count(*) FROM t"')
    ).toBe(true);
    // 非 psql → 不适用
    expect(isAggregateDbProbeWithoutWindow('echo "SELECT count(*) FROM t"')).toBe(false);
  });
});

describe('formatGateReport — 逃生口提示头部', () => {
  it('有命中时报告头部含 gate-allow 通用提示', () => {
    const r = evaluateContractText("  Test: manual:bash -c 'MOCK_X=1 node a.js'");
    const report = formatGateReport(r, 'contract-dod.md');
    expect(report).toMatch(/gate-allow:/);
    expect(report).toMatch(/cheat\/mock-env/); // 命中清单仍在
  });

  it('干净合同（无命中）报告为空串，不输出提示头部', async () => {
    const r = await runContractGate(path.join(FX, 'clean'));
    expect(formatGateReport(r, 'contract-dod.md')).toBe('');
  });
});
