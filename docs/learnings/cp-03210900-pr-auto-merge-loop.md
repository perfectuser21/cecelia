# Learning: PR 自动合并闭环

## 背景
stop-dev.sh 和 devloop-check.sh 在检测到 CI 通过 + Stage 4 完成时，只输出 JSON 建议文本并返回 exit 2，导致 cecelia-run.sh 无限循环 sleep 2s 重试，永远无法真正合并 PR。

### 根本原因
设计时这两个脚本只负责"建议"操作（输出 JSON），期望调用方（Claude Code agent）解析 JSON 后执行合并。但实际上 cecelia-run.sh 收到 exit 2 只做 sleep + retry，agent 侧也不处理 JSON 中的合并指令，形成死循环。

### 下次预防
- [ ] 在 stop hook 中涉及状态转换的操作（如 PR 合并），必须由 stop hook 自己执行，而非通过 JSON 建议间接通信
- [ ] exit code 设计必须考虑调用方的行为：exit 2 = 继续循环，exit 1 = 失败终止，exit 0 = 成功结束
- [ ] 新增的 exit code 路径必须有对应的集成测试验证实际行为
- [ ] 避免"建议-执行"分离模式，改为"检查-执行"一体化模式

## 修复内容
1. stop-dev.sh: 条件满足时直接执行 `gh pr merge --squash --delete-branch`，成功 exit 0，失败 exit 1
2. devloop-check.sh: 同样直接执行合并，成功 return 0，失败 return 1
3. 更新 stop-hook-retry.test.ts 测试以匹配新的错误消息
