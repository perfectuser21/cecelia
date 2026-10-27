---
task_id: b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6", "02-spec.md#S-7", "02-spec.md#S-8", "02-spec.md#S-9"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 5
场景覆盖: 7
回归风险: 7
可执行: 7

### R-1
针对: S-1, S-4, Q-1, I-4
严重度: 阻断
场景: QA 按 Q-1 建单并等外部控制器完成 intent 后，从新 01 算出 SHA-256，却在允许读取的任务 API 和新 01 中找不到该次活动的 `outputs.intent_sha256`，无法验收两者是否相等。
依据: `packages/brain/scripts/coding-workflow/activities/intent.mjs` 只把摘要放进活动返回值的 `outputs`；`lib/protocol.mjs` 的 `runActivity` 将该结果写到子进程 stdout；`runner/lib/terminal.mjs` 的任务结果只写 runner 摘要。Q-1 的操作仅列 GET 任务、新 01 原字节和 Git 原字节，没有该次 intent 活动结果的独立可读来源。
说明: 在 Q-1 指明 QA 实际可取得的本次 intent 原生结果及其任务 ID、场景 nonce 和文件归属校验，再比较其中的 `outputs.intent_sha256` 与新 01 原字节摘要；由 QA 外控制器提供只读的已封存结果即可，无需新增历史快照接口或让 QA 写来源文件。
