/**
 * CORE-INV-03 — P0 铁律「FIXED 不当 PASS 直通」proven-to-fire 断言。
 *
 * 真实语义（harness-evaluator-verdict-bug 决策）：Evaluator 会输出 "FIXED"，
 * 把 FIXED 归一为 PASS 是【允许的】；但归一 ≠ 直通——merge 仍必须经 judge 复核，
 * 不得 FIXED（或任何 evaluate verdict）绕过 judge 直接 merge。
 *
 * 守卫落点：packages/brain/src/orchestrator/gates.js
 *  - isPassVerdict：FIXED 归一存在
 *  - mergeGate：唯一 merge 权威——evaluate PASS/FIXED + judge PASS 双裁决 + SHA 锚定，缺一必拒
 *
 * 三断言齐 = 铁律成立：
 *  1. isPassVerdict('FIXED') === true（归一存在，删掉会让 FIXED 卡死 fix loop）
 *  2. evaluate=FIXED 而 judge 缺席 → mergeGate 必拒（FIXED 不直通）
 *  3. 双裁决齐（evaluate FIXED + judge PASS，SHA 匹配）才 allow
 *
 * CI 干净环境兼容：gates.js 只依赖同目录 constants.js（零外部依赖），node 内建即可跑。
 */
import { isPassVerdict, mergeGate } from '../../../packages/brain/src/orchestrator/gates.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('== CORE-INV-03 FIXED 归一但不直通 merge（gates.js 双裁决门禁）==');

// 1) FIXED→PASS 归一存在（这是刻意设计，不是 bug）
check("isPassVerdict('FIXED') === true（归一存在）", isPassVerdict('FIXED') === true);
check("isPassVerdict('PASS') === true", isPassVerdict('PASS') === true);
check("isPassVerdict('FAIL') === false", isPassVerdict('FAIL') === false);

// 2) FIXED 无 judge 复核必拒（铁律核心：不直通）
const noJudge = mergeGate({
  evaluateVerdict: { verdict: 'FIXED', pr_head_sha: 'x' },
  judgeVerdict: null,
  prHeadSha: 'x',
  reviewRequired: false,
  reviewApproved: false,
});
check(
  'evaluate=FIXED 而 judge 缺席 → mergeGate 必拒',
  noJudge.allow === false,
  `got ${JSON.stringify(noJudge)}`
);
check(
  '拒绝原因 = judge_verdict_missing（拒在 judge 门，不是别处碰巧拒）',
  noJudge.reason === 'judge_verdict_missing',
  `got reason=${noJudge.reason}`
);

// 2b) judge verdict 是 stale SHA（旧 commit 的 PASS）同样必拒
const staleJudge = mergeGate({
  evaluateVerdict: { verdict: 'FIXED', pr_head_sha: 'x' },
  judgeVerdict: { verdict: 'PASS', pr_head_sha: 'OLD' },
  prHeadSha: 'x',
  reviewRequired: false,
  reviewApproved: false,
});
check(
  'judge verdict SHA 过期（stale）→ mergeGate 必拒',
  staleJudge.allow === false && staleJudge.reason === 'stale_judge_verdict',
  `got ${JSON.stringify(staleJudge)}`
);

// 3) 双裁决齐（evaluate FIXED + judge PASS，SHA 匹配）才 allow
const bothPass = mergeGate({
  evaluateVerdict: { verdict: 'FIXED', pr_head_sha: 'x' },
  judgeVerdict: { verdict: 'PASS', pr_head_sha: 'x' },
  prHeadSha: 'x',
  reviewRequired: false,
  reviewApproved: false,
});
check(
  '双裁决齐（FIXED 归一 + judge PASS）→ allow',
  bothPass.allow === true && bothPass.reason === 'all_gates_passed',
  `got ${JSON.stringify(bothPass)}`
);

if (failures > 0) {
  console.error(`== CORE-INV-03 FAIL（${failures} 项）— 铁律「FIXED 不直通 merge」守卫被破坏 ==`);
  process.exit(1);
}
console.log('== CORE-INV-03 PASS ==');
