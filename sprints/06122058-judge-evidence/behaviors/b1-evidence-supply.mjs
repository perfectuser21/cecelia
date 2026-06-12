/**
 * b1-evidence-supply.mjs — 裁判证据供给行为验证（无外部依赖，CI 可跑）。
 *
 * #3372 配套缺口：裁判此前只拿到 callback 4KB tail（运动员自述），无命令输出 → 保守判 FAIL 烧轮。
 * 本验证断言 Brain 侧把 evaluator 完整 stdout 转录（#3345 forensics 文件）喂进裁判证据，
 * 并断言裁判 prompt 声明「含命令 stdout 即视为执行证据」同时保留「证据缺失→FAIL」红线。
 */
import {
  resolveStdoutFile,
  extractAgentTranscript,
  collectEvidence,
  buildJudgePrompt,
  runJudgeGate,
} from '../../../packages/brain/src/harness-judge.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
}

const origWarn = console.warn;
const origLog = console.log;
console.warn = () => {};
console.log = () => {};

// 1) resolveStdoutFile：同 task 前缀里挑最新 mtime 的 .stdout
const TASK = '01f31f66-aaaa';
const f = await resolveStdoutFile(
  { promptDir: '/p', taskId: TASK },
  {
    listDirFn: async () => [`${TASK}.old.stdout`, `${TASK}.new.stdout`, `other.x.stdout`, `${TASK}.x.prompt`],
    statFn: async (p) => ({ mtimeMs: p.includes('.new.') ? 2000 : 1000 }),
  }
);
assert(f === `/p/${TASK}.new.stdout`, 'resolveStdoutFile 应挑最新 mtime 的同 task .stdout');

// 2) extractAgentTranscript：单对象 JSON → 取 .result；NDJSON/文本 → 原样
assert(
  extractAgentTranscript(JSON.stringify({ result: 'vitest 5 passed exit=0' })) === 'vitest 5 passed exit=0',
  'extractAgentTranscript 应从单对象 JSON 取 .result'
);
const nd = '{"type":"tool_result","content":"+ vitest\\n5 passed"}\n{"type":"result"}';
assert(extractAgentTranscript(nd) === nd, 'extractAgentTranscript 对 NDJSON 应原样返回（保留命令输出）');

// 3) collectEvidence：据 promptDir/taskId 读 forensics，填 agentStdout（比 callback tail 全）
const ev = await collectEvidence(
  { worktreePath: '/tmp/x', sprintDir: 's', transcript: '只有 4KB tail', promptDir: '/p', taskId: 't1' },
  {
    readFileFn: async (p) => {
      if (String(p).endsWith('.stdout')) return JSON.stringify({ result: '完整转录：step1 stdout=ok exit=0' });
      throw new Error('ENOENT');
    },
    listDirFn: async () => ['t1.zz.stdout'],
    statFn: async () => ({ mtimeMs: 1 }),
  }
);
assert(ev.agentStdout === '完整转录：step1 stdout=ok exit=0', 'collectEvidence 应把 forensics stdout 填入 agentStdout');
assert(ev.transcript === '只有 4KB tail', 'collectEvidence 仍保留 callback transcript');

// 4) collectEvidence fail-open：forensics 缺失 → agentStdout 空，transcript 仍在
const ev2 = await collectEvidence(
  { worktreePath: '/tmp/x', sprintDir: 's', transcript: 'tail only', promptDir: '/p', taskId: 't1' },
  { readFileFn: async () => { throw new Error('ENOENT'); }, listDirFn: async () => [] }
);
assert(ev2.agentStdout === '' && ev2.transcript === 'tail only', 'forensics 缺失应 fail-open 退回 transcript');

// 5) buildJudgePrompt：含 agentStdout 段 + 接受命令 stdout 即证据规则 + 保留缺失红线
const p = buildJudgePrompt({
  contractE2E: 'curl X', goldenPathSteps: ['步骤1'], agentVerdict: 'PASS',
  transcript: 'tail', agentStdout: '完整：+ vitest / 5 passed', brainResult: { verdict: 'PASS' },
});
assert(p.includes('完整：+ vitest / 5 passed'), 'prompt 应含 agentStdout 段');
assert(p.includes('即视为该步已执行的证据'), 'prompt 应声明含命令 stdout 即证据');
assert(p.includes('确实缺失某步的执行输出'), 'prompt 应保留「证据缺失→FAIL」红线');

// 6) runJudgeGate 端到端：promptDir/taskId 透传 collectEvidence，agentStdout 进 judgeFn
let sawPromptDir = null, sawTaskId = null, sawAgentStdout = null;
const r = await runJudgeGate(
  { worktreePath: '/tmp/x', sprintDir: 's', agentVerdict: 'PASS', transcript: 't', promptDir: '/pd', taskId: 'tk' },
  {
    collectEvidence: async (ctx) => {
      sawPromptDir = ctx.promptDir; sawTaskId = ctx.taskId;
      return { contractE2E: '## E2E', goldenPathSteps: ['A'], transcript: 't', agentStdout: 'AGENT-FULL', brainResult: { verdict: 'PASS' } };
    },
    judgeFn: async (input) => { sawAgentStdout = input.agentStdout; return { verdict: 'PASS', coverage: [{ step: 'A', passed: true }], feedback: null }; },
    writeFileFn: async () => {},
  }
);
assert(sawPromptDir === '/pd' && sawTaskId === 'tk', 'runJudgeGate 应把 promptDir/taskId 透传 collectEvidence');
assert(sawAgentStdout === 'AGENT-FULL', 'agentStdout 应进 judgeFn 输入');
assert(r.verdict === 'PASS', '双 PASS + 覆盖全 → 终判 PASS');

console.warn = origWarn;
console.log = origLog;
console.log('OK');
