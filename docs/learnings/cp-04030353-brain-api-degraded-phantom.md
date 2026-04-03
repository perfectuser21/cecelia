# Learning: CURRENT_STATE.md 占位符导致 Self-Drive 幽灵任务

## 根本原因

`CURRENT_STATE.md` 初始为占位符状态（`Brain API | (待更新)`），仅在每次 PR 合并后由 `/dev Stage 4` 更新。当系统首次启动或长时间未合并 PR 时，占位符内容会被 Self-Drive LLM 误读为"Brain API 状态未知/降级"，导致重复创建"诊断修复 Brain API degraded"任务。

## 下次预防

- [ ] `readCurrentState()` 在检测到 `(待更新)` 或 `初始占位` 时立即返回 null
- [ ] LLM 收到 null 时看到 `无数据（CURRENT_STATE.md 尚未生成）` 而非误导性占位符
- [ ] 新系统部署或迁移后，手动运行 `bash scripts/write-current-state.sh` 初始化状态文件
