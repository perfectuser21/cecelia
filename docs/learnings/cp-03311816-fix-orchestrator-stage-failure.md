# Learning: content pipeline 非审核阶段失败传播修复

## 背景

`STAGE_HANDLER_MAP` 中4个非审核阶段（research/copywriting/generate/export）的 handler 函数用 `_s` 占位符忽略了 `taskStatus` 参数，导致即使阶段执行失败（`{success:false}`）仍推进到下一阶段，pipeline 最终显示 `completed` 但无有效内容产出（无图片、调研数据全是占位符）。

### 根本原因

设计 STAGE_HANDLER_MAP 时，审核阶段（copy-review/image-review）因需要判断 PASS/FAIL 而正确传入了 `taskStatus`。非审核阶段假设"executor 完成即成功"，未考虑 executor 内部校验失败（如无 notebook_id、findings 为空、图片生成失败）时返回 `{success:false}` 的场景。orchestrator 收到 callback 时只要 task status 是 `failed`，就应该停止 pipeline，但旧代码的 handler 签名 `(ctx, _s, _f, db)` 直接丢弃了这个信息。

### 下次预防

- [ ] pipeline handler 的函数签名统一：所有阶段都必须显式接收并处理 `taskStatus` 参数，不允许用 `_s` 占位符丢弃
- [ ] 新增阶段时，代码审查检查点：是否有 `taskStatus === 'failed'` 的处理分支
- [ ] executor 层 `{success:false}` 必须对应 orchestrator 层的 pipeline failed 路径，两层要保持对称
