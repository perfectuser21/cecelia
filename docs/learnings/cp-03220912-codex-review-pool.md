# Learning: Codex 独立审查加固

**Branch**: cp-03220912-codex-review-pool
**Date**: 2026-03-22
**PR**: #1323

## 背景

spec_review / code_review_gate 设计上是独立 Codex 第三方审查，但实际上从未真正生效。

---

## 根本原因

### 问题 1：CLI 调用错误

`triggerCodexReview` 使用 `claude --dangerously-skip-permissions -p` 启动进程，
但这是 Claude Code CLI 的参数，不是 Codex CLI。
Codex CLI 正确用法：`codex exec -c 'approval_policy="never"' "<prompt>"`

### 问题 2：Prompt 内容空洞

`buildPrompt` 只把 task.title 拼进去，没有读取实际文件内容：
- spec_review：未读 Task Card 文件 → Codex 看不到需求
- code_review_gate：未执行 `git diff` → Codex 看不到代码改动

### 问题 3：无结果回调

`triggerCodexReview` 是 fire-and-forget，没有 stdout 捕获，
没有 `child.on('exit')` 处理，Brain 永远收不到 verdict。
devloop-check 等待超时（15 分钟）后才会 auto-PASS，
导致每个 PR 都等 15 分钟。

### 问题 4：SKILL.md 依赖不存在的 PR

code-review-gate SKILL.md 中用 `gh pr diff <pr_number>` 获取 diff，
但 Stage 2（code 阶段）还没有 PR，导致审查无法执行。

---

## 修复方案

1. **spawn 参数**：`['exec', '-c', 'approval_policy="never"', promptContent]`
2. **buildPrompt**：读取 Task Card 文件内容 / 执行 `git diff origin/main..HEAD`
3. **stdout + 回调**：
   ```js
   child.stdout.on('data', d => stdout += d)
   child.on('exit', async (code) => {
     const verdict = parseJsonVerdict(stdout)
     await fetch(brainUrl + '/api/brain/execution-callback', { ... })
   })
   ```
4. **独立资源池**：`/tmp/codex-review-locks/` MAX=2，不影响 dev 动态池
5. **SKILL.md**：`gh pr diff` → `git diff origin/main..HEAD`

---

## 下次预防

- [ ] 新增 executor 派发路径时必须验证：CLI 参数、stdout 捕获、exit 回调、Brain 回调
- [ ] review 类 task 在 brain-register 时注册 triggerCodexReview 作为执行路径
- [ ] SKILL.md 中的 shell 命令必须在 Stage 对应的环境中实际可执行（Stage 2 无 PR）
- [ ] verify-step DoD 测试中字符串窗口（slice）应用绝对位置匹配替代滑动窗口
