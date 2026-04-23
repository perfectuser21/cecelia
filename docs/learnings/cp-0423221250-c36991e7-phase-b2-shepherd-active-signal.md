# Phase B2 — shepherd 活跃信号判定 Learning

## 做了什么
新建 `packages/brain/src/quarantine-active-signal.js`（60 行），扫 `.dev-mode.*`
文件 mtime 判 task 是否有活跃 interactive session。`quarantine.js:shouldQuarantineOnFailure`
前加活跃预检：有 interactive claude 在推进（mtime < 90s）→ skip quarantine。
async 传染 3 个函数（shouldQuarantineOnFailure / checkShouldQuarantine /
handleTaskFailure caller），现有 14 处测试调用点加 await。

## 根本原因
shepherd quarantine 只看 `failure_count >= 3` 一个维度，不区分"docker spawn 失败"
与"人类在独立 worktree 接管" —— 后者的 interactive session 无 checkpoint 无 container
PS，唯一通用信号是 `.dev-mode` 文件 mtime（Stop Hook / devloop-check 每轮写）。
Phase A 现场 Task 76530023 就被误杀。

## 下次预防
- [ ] 新加的决策点（quarantine / cleanup / gc）凡涉及"杀任务"都要加"活跃信号"预检
- [ ] async 传染要 grep 全仓（包括测试文件）— Phase B2 发现 21 处调用点，11 处需 await
- [ ] 活跃信号只读，不写 `.dev-mode/.dev-lock` 字段（stop-hook-cwd-as-key 规则）
- [ ] 数据源选择排他：checkpoint / docker / .dev-mode / last_attempt_at 各有覆盖盲区，设计 doc 明写排除理由

## 关键决策
**活跃信号只用 `.dev-mode.*` mtime**（排除 LangGraph checkpoints / docker PS /
last_attempt_at）。interactive /dev 不写 checkpoint，docker cidfile 路径不稳定，
last_attempt_at 失败也算 attempt。`.dev-mode` 是唯一既覆盖 harness 又覆盖 interactive
的通用信号，且 stop-dev.sh → devloop-check.sh 每次 Stop Hook 触发都刷 mtime。

**90s 窗口边界**：claude 深度 think 若 >90s 无 tool call 会被误 quarantine，
但 skip 非永久豁免（下次 failure 再判），语义安全。
