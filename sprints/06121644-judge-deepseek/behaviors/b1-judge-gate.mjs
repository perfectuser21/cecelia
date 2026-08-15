/**
 * b1-judge-gate.mjs — 独立裁判门行为验证（无外部依赖，CI 可跑）。
 * 注入 mock judgeFn 走完三权分立的关键路径，断言裁判优先 + 覆盖校验 + fail-open/closed。
 */
import { runJudgeGate } from '../../../packages/brain/src/harness-judge.js';

// listTestFilesFn 注入：让机械闸②（sprint 测试文件）通过，不依赖真实目录
const fakeListTestFiles = async () => ['fake.test.js'];
const noop = { writeFileFn: async () => {}, listTestFilesFn: fakeListTestFiles };
// behavior_tests 有效条目：让机械闸①通过（exit_code 有值，log_tail 空由 transcript 兜底）
const validBehaviorTests = [{ command: 'curl localhost', exit_code: 0, log_tail: 'HTTP/1.1 200 OK' }];
const evidence = (steps = ['step A', 'step B']) => async () => ({
  contractE2E: '## E2E\ncurl localhost',
  goldenPathSteps: steps,
  transcript: 'PASS: A\nPASS: B',
  brainResult: { verdict: 'PASS', behavior_tests: validBehaviorTests },
});

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
}

const origWarn = console.warn;
console.warn = () => {};

// 1) agent PASS + 裁判 PASS + 覆盖全 → 终判 PASS（merge 路）
let r = await runJudgeGate(
  { agentVerdict: 'PASS', agentFeedback: null, worktreePath: '/tmp/x', sprintDir: 's', instanceLabel: 'i1' },
  { judgeFn: async () => ({ verdict: 'PASS', coverage: [{ step: 'step A', passed: true }, { step: 'step B', passed: true }], feedback: null }), collectEvidence: evidence(), ...noop }
);
assert(r.verdict === 'PASS' && r.judged === true, 'agent PASS + 裁判 PASS 应终判 PASS');

// 2) agent PASS + 裁判 FAIL → 终判 FAIL，feedback 含裁判意见（裁判优先）
r = await runJudgeGate(
  { agentVerdict: 'PASS', agentFeedback: 'agent 自称都过了', worktreePath: '/tmp/x', sprintDir: 's', instanceLabel: 'i2' },
  { judgeFn: async () => ({ verdict: 'FAIL', coverage: [{ step: 'step A', passed: true }, { step: 'step B', passed: false }], feedback: '第二步缺真实证据' }), collectEvidence: evidence(), ...noop }
);
assert(r.verdict === 'FAIL' && /第二步缺真实证据/.test(r.feedback), 'agent PASS + 裁判 FAIL 应终判 FAIL 且带裁判意见');

// 3) 裁判 verdict=PASS 但 Golden Path 覆盖缺步 → 终判 FAIL
r = await runJudgeGate(
  { agentVerdict: 'PASS', agentFeedback: null, worktreePath: '/tmp/x', sprintDir: 's', instanceLabel: 'i3' },
  { judgeFn: async () => ({ verdict: 'PASS', coverage: [{ step: 'step A', passed: true }], feedback: null }), collectEvidence: evidence(['step A', 'step B']), ...noop }
);
assert(r.verdict === 'FAIL' && /缺步/.test(r.feedback), '覆盖缺步应终判 FAIL');

// 4) 裁判网络错（默认）→ fail-open 保留 agent verdict
r = await runJudgeGate(
  { agentVerdict: 'PASS', agentFeedback: null, worktreePath: '/tmp/x', sprintDir: 's', instanceLabel: 'i4' },
  { judgeFn: async () => { throw new Error('toapis HTTP 429'); }, collectEvidence: evidence(), ...noop }
);
assert(r.verdict === 'PASS' && r.judged === false && /429/.test(r.judgeError), '裁判网络错应 fail-open 保留 agent verdict');

// 5) JUDGE_STRICT → fail-closed 终判 FAIL
r = await runJudgeGate(
  { agentVerdict: 'PASS', agentFeedback: null, worktreePath: '/tmp/x', sprintDir: 's', instanceLabel: 'i5' },
  { judgeFn: async () => { throw new Error('timeout'); }, collectEvidence: evidence(), strict: true, ...noop }
);
assert(r.verdict === 'FAIL' && /fail-closed/.test(r.feedback), 'JUDGE_STRICT 裁判失败应 fail-closed FAIL');

// 6) agent FAIL → 不调裁判，直接透传
let called = false;
r = await runJudgeGate(
  { agentVerdict: 'FAIL', agentFeedback: 'happy FAIL', worktreePath: '/tmp/x', sprintDir: 's', instanceLabel: 'i6' },
  { judgeFn: async () => { called = true; return { verdict: 'PASS', coverage: [] }; }, collectEvidence: evidence(), ...noop }
);
assert(r.verdict === 'FAIL' && called === false, 'agent FAIL 应直接透传不调裁判');

console.warn = origWarn;
console.log('OK');
