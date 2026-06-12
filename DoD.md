# Task Card — 修 readPrFromGitState 的 gh 调用缺 cwd（Protocol v2 兜底失效）

## 背景 / PRD（用户语言）

Harness run 的 Protocol v2 兜底（不依赖 LLM stdout 提取 pr_url）在 Brain 容器里彻底失效：
generator 明明把活全干完了、PR 也开了（run badaf654：$10.85、PR #3367 OPEN、TDD 三 commit），
只因最终消息缺 verdict JSON 走兜底，兜底里 `gh pr list` 在容器 cwd=/app（非 git 仓库）下报
"not a git repository" 被静默 catch 吞掉返回 null → 整个 run 被误判 no_pr 终败。

期望：兜底里的 gh 调用显式指定 worktree 为工作目录（git 仓库），能正常取到 PR URL；
且兜底失败时至少在日志里 warn 出原因，不再静默吞错。

## 成功标准

- 兜底路径 `readPrFromGitState` 的 gh 调用显式以 worktree（git 仓库）为工作目录，守护进程下能正确取到 PR URL
- 兜底失败时日志可见错误原因（console.warn 带 err.message），便于排障，但保持返回 null 语义不打断 pipeline

## BEHAVIOR 条目（被测 = 真实 packages/brain/src；CI manual:node 读真实源码断言；行为深测见 vitest 套件）

- [x] [BEHAVIOR] `readPrFromGitState` 的 gh 调用显式传 `cwd: worktreePath`（git rev-parse 仍用 -C 不变）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-shared.js','utf8');const m=c.match(/execFn\('gh',[\s\S]*?\{([\s\S]*?)\}\)/);if(!m)process.exit(2);if(!/cwd:\s*worktreePath/.test(m[1]))process.exit(3);console.log('OK gh has cwd=worktreePath')"

- [x] [BEHAVIOR] 兜底 catch 不再静默吞错：`catch (err)` 块含 `console.warn` 带 `err.message`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-shared.js','utf8');const i=c.indexOf('export async function readPrFromGitState');const j=c.indexOf('export async function readVerdictFile');const body=c.slice(i,j);if(!/catch\s*\(\s*err\s*\)/.test(body))process.exit(2);if(!/console\.warn\([\s\S]*?err\.message/.test(body))process.exit(3);console.log('OK catch warns err.message')"

> 行为深测（happy 取到 pr_url、gh 调用 opts.cwd===worktreePath、execFile 抛错时 warn 被调用且带
> err.message、空分支/detached/空 PR/异常均返回 null）由 vitest 套件
> `packages/brain/src/__tests__/harness-shared.test.js`（20 用例）在 brain-ci 测试 job 中执行。
