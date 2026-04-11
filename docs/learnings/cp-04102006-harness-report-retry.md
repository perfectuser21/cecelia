### 根本原因

harness_report 任务在 execution.js 中没有回调处理分支，导致 session 崩溃（result=null）时 pipeline 静默失败，无法自动恢复。

### 下次预防

- [ ] 新增 harness 任务类型时，检查 execution.js 是否有对应回调分支
- [ ] DoD 验证命令的 200 字符窗口限制：console.error 消息需简洁（英文优先），避免中文长消息把 return 推出 200 字符边界
