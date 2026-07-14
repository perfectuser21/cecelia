# DoD 合同：ci-poll.sh CI 全绿时死循环修复

sprint_id: 07141110-ci-poll-green-fix
contract_version: v1.0
date: 2026-07-14

---

## 行为断言（BEHAVIOR）

- [x] [BEHAVIOR] CI 全绿时（stub gh：全 pass + CLEAN），ci-poll.sh 首轮退出码 0，stderr 含 CI_GREEN
- [x] [BEHAVIOR] CI 有失败时（stub gh：含 fail 行），ci-poll.sh 退出码 10
- [x] [BEHAVIOR] BEHIND 时（stub gh：mergeStateStatus=BEHIND），ci-poll.sh 退出码 11
- [x] [BEHAVIOR] FAILED 变量和 PENDING 变量赋值后均为单行整数（不含换行符），`[ "$VAR" -gt 0 ]` 不报 integer expression expected
- [x] [BEHAVIOR] 修复保持 set -euo pipefail 语义，脚本不因赋值行报错退出
- [x] [BEHAVIOR] bug 复现测试（FR-1）：修复前版本在全绿 stub 场景下，timeout 5 无法在 5s 内以退出码 0 退出（验证 failing test 先于修复 commit 存在）
- [x] [BEHAVIOR] `|| echo 0` 已替换为 `|| true`，grep -c 0 匹配场景不再追加额外输出行

---

## 验收命令

manual:bash cd /workspace && bash packages/workflows/skills/scripts/__tests__/ci-poll.test.sh

---

## FR 完成清单

- [x] **FR-1**：failing test 先提交（复现 bug）
  - 测试文件路径：`packages/workflows/skills/scripts/__tests__/ci-poll.test.sh`
  - stub gh 返回全 pass + CLEAN，timeout 5 断言 bug 版本不以退出码 0 退出
  - 此 commit 早于修复 commit

- [x] **FR-2**：修复 FAILED/PENDING 计数逻辑
  - 将 `|| echo 0` 替换为 `|| true`
  - 变量值恒为单行整数

- [x] **FR-3**：全绿场景测试通过（exit 0）
  - stub：全 pass checks + mergeStateStatus=CLEAN
  - 首轮打印 CI_GREEN，exit 0

- [x] **FR-4**：失败场景测试通过（exit 10）
  - stub：含 fail 行
  - exit 10

- [x] **FR-5**：回归测试纳入 CI
  - 测试文件纳入 `packages/workflows/` CI workflow

---

## Invariant 验证

| # | 约束 | 状态 |
|---|------|------|
| 1 | 只修改 FAILED/PENDING 赋值逻辑，不改其他行 | [x] |
| 2 | 退出码协议不变：0=全绿，10=有失败，11=BEHIND | [x] |
| 3 | `sleep 30` 轮询间隔不变 | [x] |
| 4 | 不修改任何上游 skill 文件 | [x] |
| 5 | 测试全程 stub gh，不得真调 GitHub API | [x] |
| 6 | 修复后 `set -euo pipefail` 语义不被破坏 | [x] |

---

## 测试覆盖范围说明

本 DoD 通过 stub gh 脚本验证核心逻辑，真实 GitHub API 路径不在本 sprint 验收范围内（详见 contract-draft.md §未覆盖真实链路清单）。
