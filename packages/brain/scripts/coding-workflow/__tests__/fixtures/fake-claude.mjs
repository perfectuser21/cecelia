#!/usr/bin/env node
// 假 claude：按 FAKE_CLAUDE_MODE 模拟 `claude -p <prompt> ...`。
// spec 用：ok | nofile | auth | fail | outside | sleep | linger | titled | noids | uncovered | noqa；
// build 用：build-ok（真实 git commit 并写 03-build.md）| build-nocommit | build-dirty（另留未提交改动）| build-noreport
// | build-amend（把改动 amend 进运行前的 HEAD）| build-badreport（03 的 upstream 只覆盖第一条 S-n）；
// verify 用：verify-pass | verify-fail（最后一条 FAIL）| verify-badformat（第一条缺 output）| verify-uncovered（只覆盖第一条 I-n）
// | verify-outside（全 PASS 但往 worktree 根写越界文件）| verify-reset（先 git reset --hard HEAD~1 再写全 PASS 的 04）
// | verify-fabricated（04 写了命令与输出，但对话记录里没执行过）| verify-bizauth（业务输出含 authentication failed 后非 0 退出）
// | verify-authresult（result 事件报鉴权错误后非 0 退出）| verify-cdprefix（全 PASS，证据命令带 cd <worktree> && 前缀）。verify-* 会在 stdout 输出 stream-json 的 tool_use/tool_result。
// spec_review 评审用（写 REVIEW_PATH）：review-approve | review-revise（始终 REVISE + R-1 针对 S-1）
// | review-until-fixed（02 含「已按评审修改」时 APPROVE，否则同 review-revise）| review-badformat（无 verdict 行）
// | review-outside（同 review-approve，另往 worktree 根写越界文件）；
// spec_review 改写用：revise-ok（保留 02 的 frontmatter 与全部 S-n，末尾 S-n 正文追加「已按评审修改 R-1」）| revise-delete（删掉 02）。
// prompt 含 `ROLE: spec_review` / `ROLE: spec_revise` 时输出 `FAKE_ROLE: <角色>` 一行供计数，
// FAKE_CLAUDE_MODE_REVIEW / FAKE_CLAUDE_MODE_REVISE 可单独指定该步模式。
// FAKE_CLAUDE_PID_FILE 指向文件时，启动即把自己的 pid 写进去（测试据此确认进程已被清理）。
// FAKE_CLAUDE_CHILD_PID_FILE 指向文件时，sleep / linger 模式额外起一个长睡孙进程并写入其 pid；
// FAKE_CLAUDE_CHILD_STDIO=ignore 时孙进程不继承输出管道，否则继承（握着管道）。
// linger：照常写出合法 02-spec.md 并退出 0，但留下孙进程。
// 越轨副作用（模拟工具闸失守，任一模式写完产物后执行）：FAKE_TAMPER_FILE 追加改写该文件；
// FAKE_SWITCH_BRANCH 切到新分支；FAKE_PUSH=1 把当前分支推到 origin；FAKE_DELETE_FILE 删除该文件。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
// 按 prompt 认出 build / verify 步骤：FAKE_CLAUDE_MODE_BUILD / FAKE_CLAUDE_MODE_VERIFY 可单独指定该步模式（端到端一次跑三步用）
// spec_review 的评审/改写会话按 ROLE 行认出：FAKE_CLAUDE_MODE_REVIEW / FAKE_CLAUDE_MODE_REVISE
// build 内 CI 门禁预检修复会话按 `ROLE: ci_precheck_fix` 认出：FAKE_CLAUDE_MODE_PRECHECK
//   precheck-fix（提交 src/precheck-fixed.txt）| precheck-noop（什么都不改）| precheck-sprint（改 02 并提交，越界）
const role = (prompt.match(/^ROLE: (spec_review|spec_revise|ci_precheck_fix)$/m) || [])[1];
const ROLE_STEPS = { spec_review: 'REVIEW', spec_revise: 'REVISE', ci_precheck_fix: 'PRECHECK' };
if (process.env.FAKE_PROMPT_LOG && role === 'ci_precheck_fix') fs.appendFileSync(process.env.FAKE_PROMPT_LOG, `${prompt}\n`);
const step = role ? ROLE_STEPS[role]
  : /^BUILD_PATH: /m.test(prompt) ? 'BUILD' : /^EVIDENCE_PATH: /m.test(prompt) ? 'VERIFY' : null;
const mode = (step && process.env[`FAKE_CLAUDE_MODE_${step}`]) || process.env.FAKE_CLAUDE_MODE || 'ok';

if (process.env.FAKE_CLAUDE_PID_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PID_FILE, String(process.pid));

// 孙进程：与真 claude 起的子工具进程一样（默认继承 stdio，握着父进程的输出管道）；60s 后自行退出，防测试泄漏
function spawnGrandchild() {
  if (!process.env.FAKE_CLAUDE_CHILD_PID_FILE) return;
  const stdio = process.env.FAKE_CLAUDE_CHILD_STDIO === 'ignore' ? 'ignore' : 'inherit';
  const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio });
  grandchild.unref(); // 孙进程不拖住假 claude 自身退出（linger 模式需要 claude 先退、孙进程留下）
  fs.writeFileSync(process.env.FAKE_CLAUDE_CHILD_PID_FILE, String(grandchild.pid));
}

// sleep：长睡且不写任何文件，模拟 claude 卡死（默认 SIGTERM 即可终止）
if (mode === 'sleep') {
  spawnGrandchild();
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (mode === 'auth') {
  process.stderr.write('Invalid API key · Please run /login\n');
  process.exit(1);
}
if (mode === 'fail') {
  process.stderr.write(`${process.env.FAKE_CLAUDE_TEXT || 'something went wrong'}\n`);
  process.exit(1);
}

const unset = (k) => process.env[k] ?? '<unset>';
if (role) console.log(`FAKE_ROLE: ${role}`);
console.log(`FAKE_ARGS: ${argv.filter((a) => a !== prompt).join(' ')}`);
console.log(`FAKE_CWD: ${process.cwd()}`);
console.log(`FAKE_ENV: CLAUDECODE=${unset('CLAUDECODE')} CLAUDE_CODE_ENTRYPOINT=${unset('CLAUDE_CODE_ENTRYPOINT')} GIT_DIR=${unset('GIT_DIR')}`);
console.log(`FAKE_CODING_WF_KEYS: ${Object.keys(process.env).filter((k) => k.startsWith('CODING_WF_')).sort().join(',') || 'none'}`);
console.log(`FAKE_GH_ENV:GH_TOKEN=${unset('GH_TOKEN')} GITHUB_TOKEN=${unset('GITHUB_TOKEN')} GH_ENTERPRISE_TOKEN=${unset('GH_ENTERPRISE_TOKEN')} GIT_TERMINAL_PROMPT=${unset('GIT_TERMINAL_PROMPT')}`);
console.log(`FAKE_GH_CONFIG_DIR: ${unset('GH_CONFIG_DIR')}`);
console.log(`FAKE_GH_CONFIG_EMPTY: ${Boolean(process.env.GH_CONFIG_DIR) && fs.existsSync(process.env.GH_CONFIG_DIR) && fs.readdirSync(process.env.GH_CONFIG_DIR).length === 0}`);
console.log(`FAKE_INTENT_PATH: ${(prompt.match(/^INTENT_PATH: (.+)$/m) || [])[1]}`);
console.log(`FAKE_PREV_ERRORS: ${(prompt.match(/^PREV_ERRORS: (.*)$/m) || [])[1]}`);
console.log(`FAKE_PROMPT_MENTIONS_BUILD: ${prompt.includes('03-build')}`);
for (let i = 0; i < 200; i += 1) console.log(`fake claude log line ${i}`);

if (mode === 'nofile') process.exit(0);

const field = (name) => (prompt.match(new RegExp(`^${name}: (.+)$`, 'm')) || [])[1];
const idList = (name) => (field(name) || '').split(',').map((s) => s.trim()).filter(Boolean);
const taskId = field('TASK_ID');
const frontmatter = (step, upstream) => `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: ${JSON.stringify(upstream)}\n---\n`;
const writeFile = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

// build-*：在当前分支真实提交一份代码+测试，再按 SPEC_IDS 写 03-build.md
function build() {
  let sha = '';
  if (mode === 'build-amend') {
    writeFile('src/feature.js', 'export const feature = () => 0;\n');
    git('add', '--', 'src');
    git('commit', '-q', '--amend', '-m', 'feat: amended');
    sha = git('rev-parse', 'HEAD').trim();
  } else if (mode !== 'build-nocommit') {
    // FAKE_BUILD_COMMITS：连续提交几次（默认 1）；FAKE_BUILD_EXTRA_FILE：额外一并提交的文件（相对 worktree）
    for (let i = 1; i <= Number(process.env.FAKE_BUILD_COMMITS || 1); i += 1) {
      writeFile('src/feature.js', `export const feature = () => ${i};\n`);
      writeFile('src/feature.test.js', `import { feature } from './feature.js'; // ${i}\n`);
      git('add', '--', 'src');
      if (process.env.FAKE_BUILD_EXTRA_FILE) {
        writeFile(process.env.FAKE_BUILD_EXTRA_FILE, `extra ${i}\n`);
        git('add', '--', process.env.FAKE_BUILD_EXTRA_FILE);
      }
      git('commit', '-q', '-m', `feat: build feature ${i}`);
    }
    sha = git('rev-parse', 'HEAD').trim();
  }
  if (mode === 'build-dirty') writeFile('src/dirty.js', 'uncommitted\n');
  if (mode === 'build-noreport') return;
  const ids = idList('SPEC_IDS');
  const upstream = (mode === 'build-badreport' ? ids.slice(0, 1) : ids).map((id) => `02-spec.md#${id}`);
  const sections = ids.map((id, i) => `### B-${i + 1}\n对应 ${id}；改动 src/feature.js；测试 src/feature.test.js；命令 npm test；提交 ${sha}\n`);
  writeFile(field('BUILD_PATH'), `${frontmatter('build', upstream)}# build\n\n${sections.join('\n')}`);
}

// 模拟 stream-json 对话记录里的一次 Bash 执行（tool_use + tool_result）
let toolSeq = 0;
function emitBash(command, result) {
  toolSeq += 1;
  const id = `toolu_${toolSeq}`;
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } }));
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: result }] } }));
}

// verify-*：按 INTENT_IDS 写 04-evidence.md，并为每条证据输出对应的执行记录（verify-fabricated 不输出）
function verify() {
  // verify-bizauth：业务命令输出里有 authentication failed，claude 以非鉴权原因非 0 退出
  if (mode === 'verify-bizauth') {
    emitBash('npm test', 'FAIL auth.test.js > login: authentication failed for user admin');
    console.log(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'max turns reached' }));
    process.exit(1);
  }
  // verify-authresult：claude 自身的 result 事件报鉴权错误
  if (mode === 'verify-authresult') {
    console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Invalid API key · Please run /login' }));
    process.exit(1);
  }
  console.log(`FAKE_BUILD_PRESENT: ${fs.existsSync(path.join(path.dirname(field('EVIDENCE_PATH')), '03-build.md'))}`);
  if (mode === 'verify-reset') git('reset', '-q', '--hard', 'HEAD~1');
  const ids = idList('INTENT_IDS');
  const covered = mode === 'verify-uncovered' ? ids.slice(0, 1) : ids;
  const fence = '```';
  const sections = covered.map((id, i) => {
    const failed = mode === 'verify-fail' && i === covered.length - 1;
    const command = `npm test -- ${id}`;
    const output = failed ? 'AssertionError: expected 500 to be 200' : `ok ${id} passed`;
    if (mode !== 'verify-fabricated') emitBash(command, `> vitest run ${id}\n${output}\n`);
    // verify-cdprefix：会话已在 worktree 里执行，写证据时补上 cd <当前目录> && 前缀（真实 claude 实测行为）
    const written = mode === 'verify-cdprefix' ? `cd ${process.cwd()} && ${command}` : command;
    const lines = [`### E-${i + 1}`, `对应: ${id}`, `verdict: ${failed ? 'FAIL' : 'PASS'}`, `${fence}command`, written, fence];
    if (!(mode === 'verify-badformat' && i === 0)) lines.push(`${fence}output`, output, fence);
    return `${lines.join('\n')}\n`;
  });
  writeFile(field('EVIDENCE_PATH'), `${frontmatter('verify', ids.map((id) => `01-intent.md#${id}`))}# 验收证据\n\n${sections.join('\n')}`);
  if (mode === 'verify-outside') fs.writeFileSync('stray.txt', 'out of scope\n');
}

const FIXED_MARK = '已按评审修改';

// review-*：按 SPEC_IDS 写 02-review.md
function review() {
  const specText = fs.readFileSync(field('SPEC_PATH'), 'utf8');
  const approve = mode === 'review-approve' || mode === 'review-outside'
    || (mode === 'review-until-fixed' && specText.includes(FIXED_MARK));
  const upstream = idList('SPEC_IDS').map((id) => `02-spec.md#${id}`);
  // 合同对抗 v2 格式：## 评分（5 维）+ 阻断问题需带场景与依据；结论由程序判
  const scores = (v) => `## 评分\n意图对齐: ${v}\n可验证: ${v}\n场景覆盖: ${v}\n回归风险: ${v}\n可执行: ${v}\n`;
  const body = mode === 'review-badformat'
    ? '# 评审\n\n看起来还行。\n'
    : approve
      ? `# 评审\n\n${scores(8)}`
      : `# 评审\n\n${scores(5)}\n### R-1\n针对: S-1\n严重度: 阻断\n场景: QA 按 S-1 验收时没有可运行的命令，无法判断是否达成\n依据: S-1 只写了"测试通过"\nS-1 需给出具体命令。\n`;
  writeFile(field('REVIEW_PATH'), `${frontmatter('spec_review', upstream)}${body}`);
  if (mode === 'review-outside') fs.writeFileSync('stray.txt', 'out of scope\n');
}

// revise-ok：02 末尾（最后一条 S-n 正文）追加一行改写标记，frontmatter 与 S-n 不动
function revise() {
  const specPath = field('SPEC_PATH');
  if (mode === 'revise-delete') {
    fs.rmSync(specPath, { force: true });
    return;
  }
  const text = fs.readFileSync(specPath, 'utf8');
  fs.writeFileSync(specPath, `${text.replace(/\n*$/, '\n')}${FIXED_MARK} R-1\n`);
}

function sideEffects() {
  if (process.env.FAKE_DELETE_FILE) fs.rmSync(process.env.FAKE_DELETE_FILE, { force: true });
  if (process.env.FAKE_TAMPER_FILE) fs.appendFileSync(process.env.FAKE_TAMPER_FILE, '\n篡改\n');
  if (process.env.FAKE_SWITCH_BRANCH) git('checkout', '-q', '-b', process.env.FAKE_SWITCH_BRANCH);
  if (process.env.FAKE_PUSH === '1') git('push', '-q', 'origin', `HEAD:refs/heads/${git('rev-parse', '--abbrev-ref', 'HEAD').trim()}`);
}

function precheckFix() {
  if (mode === 'precheck-fix') {
    writeFile('src/precheck-fixed.txt', 'fixed\n');
    git('add', '--', 'src/precheck-fixed.txt');
    git('commit', '-q', '-m', 'fix: CI 门禁预检');
  }
  if (mode === 'precheck-sprint') {
    const spec = path.join(field('SPRINT_DIR'), '02-spec.md');
    fs.appendFileSync(spec, '\n改了合同\n');
    git('add', '--', spec);
    git('commit', '-q', '-m', 'fix: 改合同');
  }
}

if (mode.startsWith('precheck-')) precheckFix();
else if (mode.startsWith('build-')) build();
else if (mode.startsWith('verify-')) verify();
else if (mode.startsWith('review-')) review();
else if (mode.startsWith('revise-')) revise();
else {
  const ids = idList('INTENT_IDS');
  // titled：标题行带说明文字（真实 claude 实测 c2afa8ba）；noids：没有 S-n 标题；uncovered：upstream 只覆盖第一条 I-n
  const heading = (i) => (mode === 'titled' ? `### S-${i + 1} 改 foo.js 的第 ${i + 1} 处` : mode === 'noids' ? `#### 规格 ${i + 1}` : `### S-${i + 1}`);
  const sections = ids.map((id, i) => `${heading(i)}\n对应 ${id}：改 foo.js，验证 npm test\n`);
  // QA 场景：每个 I-n 一条（noqa 模式不写，模拟漏写）
  // 审计 #10：02 必须登记未覆盖的真实链路（可写「无：理由」）
  if (mode !== 'nouncovered') sections.push('## 未覆盖真实链路\n\n无：测试替身，没有外部调用方');
  if (mode !== 'noqa') sections.push(`## QA 场景\n\n${ids.map((id, i) => `### Q-${i + 1}\n对应: ${id}\n操作: 用户按 ${id} 操作\n期望: 看到 ${id} 的结果\n`).join('\n')}`);
  // 铁律对照：prompt 给了 INVARIANTS_PATH 且清单里有 INV-n 时逐条写不适用（noinv 模式不写，模拟漏写）
  const invPath = field('INVARIANTS_PATH');
  const invIds = invPath && fs.existsSync(invPath) ? [...fs.readFileSync(invPath, 'utf8').matchAll(/^### (INV-[0-9a-f]{8})/gm)].map((m) => m[1]) : [];
  if (invIds.length > 0 && mode !== 'noinv') {
    sections.push(`## 铁律对照\n\n${invIds.map((id) => `- ${id}：不适用：这条约束的是别的业务线，本改动不涉及`).join('\n')}\n`);
  }
  const upstream = (mode === 'uncovered' ? ids.slice(0, 1) : ids).map((id) => `01-intent.md#${id}`);
  writeFile(field('SPEC_PATH'), `${frontmatter('spec', upstream)}# spec\n\n${sections.join('\n')}`);
  // outside：除合法 02-spec.md 外，再往 worktree 根（子进程 cwd）写一个越界文件
  if (mode === 'outside') fs.writeFileSync('stray.txt', 'out of scope\n');
  if (mode === 'linger') spawnGrandchild();
}
sideEffects();
