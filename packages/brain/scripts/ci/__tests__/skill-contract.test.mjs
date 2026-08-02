import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  checkEvaluator,
  checkReviewer,
  checkGenerator,
  checkProposer,
  REVIEWER_DIMENSIONS,
} from '../skill-contract-check.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
// __tests__ → ci → scripts → brain → packages → repo root
const ROOT = join(__dir, '..', '..', '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const evaluator = read('packages/workflows/skills/harness-evaluator/SKILL.md');
const evaluatorBody = evaluator.slice(evaluator.indexOf('# /harness-evaluator'));
const reviewer = read('packages/workflows/skills/harness-contract-reviewer/SKILL.md');
const generator = read('packages/workflows/skills/harness-generator/SKILL.md');
const proposer = read('packages/workflows/skills/harness-contract-proposer/SKILL.md');
const sharedJs = read('packages/brain/src/harness-shared.js');

describe('skill-contract — 5 类不变量守现网快照', () => {
  it('不变量1: evaluator 正文含 env_missing / B-1.6 / B-1.8 段（B-1.7 已下沉 Contract Gate 代码层，v1.16.0）', () => {
    const r = checkEvaluator(evaluator);
    // 仅看「段缺失」类不变量（排除 ws_id 残留项，由不变量2 单独守）
    expect(r.missing.filter((x) => x !== 'ws_id_residual')).toEqual([]);
  });

  it('不变量2: evaluator 正文（frontmatter 之后）无 ws_id 残留', () => {
    const r = checkEvaluator(evaluator);
    expect(r.missing).not.toContain('ws_id_residual');
    expect(r.ok).toBe(true);
  });

  it('不变量3: reviewer 7 维名与 harness-shared.js ReviewerOutputSchema 逐字一致', () => {
    expect(checkReviewer(reviewer).ok).toBe(true);
    // 7 维名同时必须出现在 schema 来源（逐字一致的比对锚点）
    for (const d of REVIEWER_DIMENSIONS) expect(sharedJs).toContain(d);
  });

  it('不变量4: generator 无可执行 gh pr merge', () => {
    expect(checkGenerator(generator).ok).toBe(true);
  });

  it('不变量5: proposer 含「领域验证规则」段', () => {
    expect(checkProposer(proposer).ok).toBe(true);
  });

  it('不变量6: evaluator 只产证据，不 commit/push PR 分支', () => {
    expect(evaluatorBody).toContain('Evaluator 禁止 commit/push');
    expect(evaluatorBody).not.toMatch(/\bgit\s+commit\b/);
    expect(evaluatorBody).not.toMatch(/\bgit\s+push\b/);
  });

  it('不变量7: evaluator 不操作 GitHub，只消费可信 exact-head 证据胶囊', () => {
    expect(evaluatorBody).toContain('HARNESS_EVIDENCE_CAPSULE_DIR');
    expect(evaluatorBody).toContain('github-evidence-capsule/v1');
    expect(evaluatorBody).toContain('expected_head_sha');
    expect(evaluatorBody).not.toMatch(/\bgh\s+(?:api|auth|pr|run|workflow)\b/);
  });

  it('不变量8: evaluator 只读可信阶段已限额解包并封存的文件', () => {
    expect(evaluatorBody).toContain('extracted_files');
    expect(evaluatorBody).not.toMatch(/\bzipfile\b|\.extractall\(|source\.read\(\)/);
    expect(evaluatorBody).not.toContain('EVIDENCE_UNPACK_DIR');
  });

  it('不变量9: local_api 模板自举空库和真实业务会话，不消费预存身份', () => {
    const localApiTemplate = proposer.slice(
      proposer.indexOf('### target_environment = local_api'),
      proposer.indexOf('### target_environment = mac_web'),
    );
    expect(localApiTemplate).toContain('${DB_URL:?');
    expect(localApiTemplate).toMatch(/migrat|schema bootstrap/i);
    expect(localApiTemplate).toMatch(/sign-up|signup|login/i);
    expect(localApiTemplate).toContain('mktemp');
    expect(localApiTemplate).not.toMatch(/psql\s+\$DB(?:\s|$)/);
    expect(localApiTemplate).not.toMatch(/AUTH_COOKIE|TENANT_ID/);
  });

  it('不变量10: proposer 保留 Android 真机 target 枚举', () => {
    expect(proposer).toContain('playground|android_realmachine');
  });
});
