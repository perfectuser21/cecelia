#!/usr/bin/env node
/**
 * harness-judge-cli — runJudgeGate（packages/brain/src/harness-judge.js）的 thin CLI wrapper。
 * harness-controller skill Step 5 调用：独立裁判是 merge 唯一权威的一半（另一半是 evaluator）。
 *
 * 用法：
 *   node scripts/harness-judge-cli.mjs --task-id <id> --sprint-dir <dir> --worktree <path> \
 *     [--agent-verdict PASS|FAIL|FIXED] [--agent-feedback <text>] [--prompt-dir <dir>] [--transcript-file <path>]
 *
 * --agent-verdict 缺省时从 <worktree>/.brain-result.json 读（evaluator 写入）。
 * FIXED 按 PASS 归一（evaluator 前科语义，memory: harness-evaluator-verdict-bug）。
 * stdout 最后一行 = JSON {verdict, feedback, judged}；exit 0=PASS / 2=FAIL / 1=用法或执行错误。
 * 逻辑零改动：judge 语义（DeepSeek + Golden Path 覆盖校验、fail-open/JUDGE_STRICT）全在 runJudgeGate。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = '用法: node scripts/harness-judge-cli.mjs --task-id <id> --sprint-dir <dir> --worktree <path> [--agent-verdict V] [--agent-feedback T] [--prompt-dir D] [--transcript-file F]';

export function parseCliArgs(argv) {
  const args = {};
  const map = {
    '--task-id': 'taskId',
    '--sprint-dir': 'sprintDir',
    '--worktree': 'worktree',
    '--agent-verdict': 'agentVerdict',
    '--agent-feedback': 'agentFeedback',
    '--prompt-dir': 'promptDir',
    '--transcript-file': 'transcriptFile',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = map[argv[i]];
    if (key) args[key] = argv[++i];
  }
  for (const required of ['taskId', 'sprintDir', 'worktree']) {
    if (!args[required]) throw new Error(`${USAGE}\n缺少必填参数（${required}）`);
  }
  return args;
}

/** FIXED 归一 PASS（前科语义）；judge 只对 PASS 复核，非 PASS 由 runJudgeGate 透传 */
function normalizeVerdict(v) {
  return v === 'FIXED' ? 'PASS' : v;
}

export async function main(argv, deps = {}) {
  const log = deps.log || console.log;
  const readFileFn = deps.readFileFn || readFile;

  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  try {
    // agent verdict：显式参数优先，缺省读 evaluator 落盘的 .brain-result.json
    let agentVerdict = args.agentVerdict;
    let agentFeedback = args.agentFeedback || null;
    let brainResult = null;
    try {
      const raw = await readFileFn(path.join(args.worktree, '.brain-result.json'), 'utf8');
      brainResult = JSON.parse(raw);
      if (!agentVerdict) agentVerdict = brainResult.verdict;
      if (!agentFeedback) agentFeedback = brainResult.feedback || null;
    } catch (err) {
      if (!agentVerdict) {
        console.error(`无 --agent-verdict 且 .brain-result.json 不可读（${err.message}）——judge 没有可复核对象`);
        return 1;
      }
    }
    agentVerdict = normalizeVerdict(agentVerdict);

    let transcript = null;
    if (args.transcriptFile) {
      try { transcript = await readFileFn(args.transcriptFile, 'utf8'); } catch { /* 无转录不阻塞，judge 证据链自行 fail-open */ }
    }

    const judgeGateFn = deps.judgeGateFn
      || (await import('../packages/brain/src/harness-judge.js')).runJudgeGate;

    const result = await judgeGateFn({
      agentVerdict,
      agentFeedback,
      transcript,
      brainResult,
      worktreePath: args.worktree,
      sprintDir: args.sprintDir,
      instanceLabel: `judge-cli-${args.taskId.slice(0, 8)}`,
      promptDir: args.promptDir || null,
      taskId: args.taskId,
    });

    log(JSON.stringify(result));
    return result.verdict === 'PASS' ? 0 : 2;
  } catch (err) {
    console.error(`judge 执行失败: ${err.message}`);
    return 1;
  }
}

// 直跑入口（被 import 时不执行——测试安全）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
