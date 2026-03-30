# Learning: PR Review Fail-Closed + Stop Hook 孤儿无限打回

**分支**: cp-03301336-pr-review-fail-closed-stophook-fix
**日期**: 2026-03-30
**Engine 版本**: 13.64.0

---

### 根本原因

**Bug 1 (pr-review.yml fail-open)**：
`curl` 调用 OpenRouter API 失败时，fallback 到 `|| echo '{"error":{"message":"API 调用失败"}}'`，`jq` 提取 `.choices[0].message.content` 为 null，fallback 到 `.error.message` 字符串。`detect-review-issues.js` 扫描不到 🔴，job 以 exit 0 通过。结果：PR 在完全零审查的情况下合并。

**Bug 2 (stop-dev.sh 孤儿 exit 0)**：
`.dev-lock` 存在但 `.dev-mode` 丢失时，`_ORPHAN_COUNT -gt 5` 分支执行 `rm -f ... && exit 0`，Stage 4 cleanup 全部跳过。任何能让 `.dev-mode` 消失 5 次的异常都能绕过整个完成条件检查。

### 下次预防

- [ ] 所有调用外部 API 的 CI job，失败路径必须是 `exit 1`（fail-closed），不能是 fallback 字符串
- [ ] Stop Hook 的任何路径，只要 dev 状态未明确完成，就永远 `exit 2`，绝不 `exit 0`
- [ ] "重试 N 次后放行" 这类逻辑在安全门禁中是反模式，禁止使用

### 变更摘要

1. `pr-review.yml`：单次调用 → `MAX_RETRY=3` while 循环，API_ERROR 检测，无有效响应时 `exit 1`
2. `stop-dev.sh`：删除整个 `_ORPHAN_COUNT -gt 5` if 块（含 `exit 0`），孤儿状态无上限永远 `exit 2`
3. 新增测试：`packages/engine/tests/workflows/pr-review-fail-closed.test.ts`
