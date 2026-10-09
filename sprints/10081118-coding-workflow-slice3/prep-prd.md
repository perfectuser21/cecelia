# 小改动 PrepPRD：coding workflow 第三刀——build 写代码 + verify 独立验收

- Brain 任务：26218ea0-f5c7-45cf-8902-b79780a94b05
- 决策：896fb590、09ffb675（对标官方：干活与判分分开；验收拿真实产出说话）
- GP-Anchor: none(infra)

## 目标

coding 链从"想清楚并开 PR"扩到"写完代码并独立验收后开 PR"：

```
intent → spec → build → verify → chain_check → publish → report
01        02      03       04
```

## 改什么（packages/brain/scripts/coding-workflow/）

### 1. 抽公共 claude 调用 lib/claude.mjs

把 spec.mjs 里的 claude 子进程逻辑（进程组 detached、超时 SIGTERM→5s SIGKILL、执行器 SIGTERM 时整组收割、exit 后 1.5s grace 清后代并关管道、env 剥离 CLAUDECODE/CLAUDE_CODE_*/GIT_*、auth 判定、超时钳在 budget 内、运行前后越界写快照）抽成 `runClaude(...)`，spec / build / verify 共用。spec 现有测试必须全部继续通过（行为不变）。

### 2. build 活动（activities/build.mjs + prompts/build.md）

- 输入：上下文里的 task_id、worktree、sprint_dir、spec_file、spec 的 S-n 列表（由活动自己从 02-spec.md 解析）。
- `claude -p` 参数：`--permission-mode acceptEdits`，**允许 Bash**（要跑测试），但 `--disallowedTools "Bash(git push:*)" "Bash(gh:*)"`。
- prompt 要求：按 02-spec 的每条 S-n 以 TDD 实现（先失败测试后实现），在当前分支提交；最后写 `03-build.md`：frontmatter `task_id`、`step: build`、`upstream` 覆盖全部 `02-spec.md#S-n`；正文每条 `### B-n` 写对应 S-n、改动文件、新增测试、实际运行的测试命令与输出摘要、提交 SHA。不 push、不改 sprint 目录里其他文件。
- 程序后置检查：
  - 03-build.md 存在（运行前先删旧文件）；否则 fatal `build_report_missing`
  - HEAD 相对运行前前进了至少 1 个提交；否则 fatal `build_no_commit`
  - 运行后工作区不得有未提交改动（sprint 目录除外）；否则 fatal `build_uncommitted`
  - 越界写检查不适用（build 本来就要改代码）
- 失败映射：claude 鉴权 → needs_human `claude_auth`；超时 → retryable `claude_timeout`；其余非 0 → retryable `claude_failed`。
- outputs：`build_file: '03-build.md'`、`build_commits: [sha...]`。
- budget 2400s，max_attempts 1（重试会叠加半成品提交，不自动重试）。

### 3. verify 活动（activities/verify.mjs + prompts/verify.md + lib/evidence.mjs）

- **全新 claude 会话**，只给 01-intent.md 的路径和 worktree，不给 03-build.md（独立判分，不受干活方自述影响）。
- `claude -p` 参数：`--permission-mode acceptEdits`、允许 Bash（要真跑命令取证），禁 `Bash(git push:*)`、`Bash(git commit:*)`、`Bash(gh:*)`。
- prompt 要求：对 01-intent 的每条 I-n，设计并**真实运行**能证明是否达成的命令（测试、curl、psql、ffprobe 等），写 `04-evidence.md`：frontmatter `task_id`、`step: verify`、`upstream` 覆盖全部 `01-intent.md#I-n`；正文每条 `### E-n` 下必须有：`对应: I-n`、`verdict: PASS` 或 `verdict: FAIL`、一个 ```` ```command ```` 代码块（实际运行的命令）、一个 ```` ```output ```` 代码块（实际输出摘录，非空）。不得修改任何代码文件。
- 程序判定（lib/evidence.mjs `parseEvidence(text) -> { items: [{id, covers, verdict, command, output}], errors }`）：
  - 04 不存在 → fatal `evidence_missing`
  - 格式错误（缺 verdict/command/output、output 为空、对应的 I-n 不存在）→ fatal `evidence_invalid`
  - 任一 I-n 没有 E 条目覆盖 → fatal `evidence_incomplete`
  - 任一 verdict FAIL → fatal `verification_failed`，evidence 带失败条目（id、covers、command、output 摘要）
  - 运行后 sprint 目录外有新改动 → fatal `verify_out_of_scope_write`
  - 全 PASS → completed，outputs `evidence_file: '04-evidence.md'`、`verified_ids: [...]`
- budget 1200s，max_attempts 1。

### 4. md 链校验泛化（lib/md-chain.mjs）

链定义改为数据：

| 文件 | step | upstream 必须覆盖 |
|---|---|---|
| 01-intent.md | intent | （空） |
| 02-spec.md | spec | 01 的全部 I-n |
| 03-build.md | build | 02 的全部 S-n |
| 04-evidence.md | verify | 01 的全部 I-n |

`checkChain({dir, taskId, files})`：`files` 为本次应存在的链文件（chain_check 活动从上下文 `intent_file/spec_file/build_file/evidence_file` 得出；只有 01/02 的旧 sprint 仍可校验）。错误码沿用并新增 `<file>_not_covered:<ID>`（保留原 `intent_not_covered` 兼容）。

### 5. 契约

order 1–7：intent(setup) / spec(source) / build(source) / verify(batch_end) / chain_check(batch_end) / publish(batch_end) / report(finalize)。各活动失败类别如实声明。publish 的 PR 正文追加验收摘要（每条 I-n 的 verdict）。

## 测试

- 单测：lib/claude.mjs（复用并迁移 spec 现有进程/超时/取消/越界测试）、build（假 claude 四模式：正常提交并写 03 / 不提交 / 留未提交改动 / 不写 03）、verify（全 PASS / 一条 FAIL / 缺 output / 未覆盖 I-n / 越界写）、evidence 解析、md-chain 四文件链。
- 契约：真实 parseActivityContract 回归，七活动顺序与失败声明。
- 端到端（经执行器，假 claude/假 gh/临时 origin/假 Brain）：七活动 completed，PR 正文含验收摘要；另一用例 verify 判 FAIL 时链停在 verify（publish 不执行、report 仍执行），回执可见失败证据。

## 验收

- [ ] coding-workflow 全部测试通过；spec 既有测试无回退
- [ ] 两个端到端用例通过
- [ ] CI 必需检查全绿
