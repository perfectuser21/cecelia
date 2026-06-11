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
