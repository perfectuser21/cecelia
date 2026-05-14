# Learning — B32 Proposer 没 push contract branch

## 场景
W42 实证：proposer container exit=0 但 git push contract branch 没真到 GitHub origin。
Brain ContractViolation 检测到 branch 不存在 → retry 2 次，每次都同 bug，
整 initiative 在 2 min 内 fail。

## 根本原因
LLM 工艺不稳定。同一 proposer skill 在 W37-W41 都跑通了 git push，但 W42 偏漏跑。
ContractViolation retry 同 LLM 行为（让 LLM 重跑），等于把不稳定操作再跑 N 次，
N 越大失败概率越高，治标不治本。

更深层：LLM agent 系统的"关键 side effect"不能只靠 LLM 自己跑命令。
git push / DB write / 文件创建 — 这些是产品状态变更的关键节点，必须 brain（代码层）
verify 真发生 + 必要时 fallback 执行。

## 修法（B32）
inferTaskPlanNode 在 fetchAndShowOriginFile 前加 ls-remote 检查：
- origin/<propose_branch> 存在 → 跳过（正常路径）
- origin 没这个 branch → brain 用 execFile('git', ['push', 'origin', branch]) 代 push
  - worktree 内 commits 已在（proposer commit 成功了），只是没 push
  - brain 帮 push 即可
- push 失败 → log error，让原 ContractViolation 走原路径

通用模式：**LLM action + brain verify + brain fallback execute**。

### 根本原因
W42 实证 proposer container exit=0 但 git push 没 push contract branch 到 GitHub origin。
Brain ContractViolation retry 2 次仍同 bug，整任务 fail。
LLM 工艺不稳定 — 同一 proposer skill W37-W41 都过了但 W42 偏挂。不能依赖 LLM 100% 跑 git push 命令。

### 下次预防
- [ ] Brain 在 LLM 任务后必须 verify 关键 side effect 真发生（push 真到 origin / commit 真有 / PR 真创）
- [ ] LLM 漏跑命令时 brain 代为补跑（手术机器人原则：不依赖 LLM 100% compliance）
- [ ] ContractViolation retry 不够 — retry 同 LLM 行为，应该 brain 代为执行
- [ ] 通用模式：LLM action + brain verify + brain fallback execute

## 相关文件
- `packages/brain/src/workflows/harness-initiative.graph.js` — inferTaskPlanNode 加 B32 fallback
- `packages/brain/src/workflows/__tests__/b32-proposer-push-verify.test.js` — 3 静态断言
- `packages/brain/scripts/smoke/b32-proposer-push-verify-smoke.sh` — container 内 verify
