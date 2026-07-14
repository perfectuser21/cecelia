# Sprint PRD：ci-poll.sh CI 全绿时死循环修复

sprint_id: 07141110-ci-poll-green-fix
journey_type: bug_fix
target_environment: local_api

---

## 背景

`packages/workflows/skills/scripts/ci-poll.sh` 是 controller 2.3.0+ 的 CI 轮询 SSOT。
CI 全绿时脚本不退出，无限 `sleep 30` 轮询，直到 relay 6h watchdog 将任务标 failed。

根因：第 18-19 行 `grep -c` 在 0 匹配时退出码为 1，触发 `|| echo 0` 重复输出，
导致变量值为多行字符串 `"0\n0"`，后续整数比较报 `integer expression expected`，
全绿分支永远无法进入。

---

## Invariant 约束

1. **只修 ci-poll.sh 计数逻辑**：仅修改 FAILED/PENDING 赋值方式，使其恒为单行整数
2. **不改退出码协议**：0=全绿，10=有失败，11=BEHIND，协议不变
3. **不改轮询间隔**：`sleep 30` 保持不变
4. **不动调用方 skill**：不修改任何引用 ci-poll.sh 的上游 skill 文件
5. **测试必须 stub gh**：测试不得真调 GitHub API，必须通过 PATH 前置 fake gh 脚本实现隔离
6. **保持 `set -euo pipefail` 语义**：修复后不得破坏 strict mode

---

## 累积 FR

### FR-1：failing test 先提交（复现 bug）
- 在 `packages/workflows/skills/scripts/__tests__/` 下创建测试文件
- stub gh：`pr checks` 返回全 pass 内容，`pr view` 返回 `{"mergeStateStatus":"CLEAN"}`
- 用 `timeout 5` 包裹调用，断言脚本在当前有 bug 的版本下不能在 5s 内以退出码 0 结束
- 此 commit 必须早于修复 commit

### FR-2：修复 FAILED/PENDING 计数逻辑
- 将 `grep -c ... || echo 0` 替换为安全写法，确保变量值恒为单行整数
- 推荐：`FAILED=$(echo "$CHECKS" | grep -c "fail" || true)` 配合默认值，或改用 `grep | wc -l`
- 修复后整数比较不再报 `integer expression expected`

### FR-3：全绿场景测试通过（exit 0）
- stub gh 输出全 pass checks（无 fail/pending/in_progress/queued 行）
- `mergeStateStatus` 为 `CLEAN`
- 脚本在首轮即打印 `CI_GREEN` 并以退出码 0 退出

### FR-4：失败场景测试通过（exit 10）
- stub gh `pr checks` 输出含 `fail` 行
- 脚本以退出码 10 退出

### FR-5：回归测试永久进 CI
- 测试文件纳入 `packages/workflows/` 对应的 CI workflow
- CI 全绿后合并

---

## NFR

NFR: N/A

---

## 验收标准

| 场景 | 预期结果 |
|------|----------|
| stub 全 pass + CLEAN | exit 0，stderr 含 `CI_GREEN` |
| stub 含 fail 行 | exit 10 |
| 修复后 CI pipeline | 全绿 |

---

## 文件范围

- 修改：`packages/workflows/skills/scripts/ci-poll.sh`（仅计数行）
- 新增：`packages/workflows/skills/scripts/__tests__/ci-poll.test.sh`（或同级 bats/bash 测试）
