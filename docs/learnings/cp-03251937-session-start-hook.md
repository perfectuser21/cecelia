# Learning: SessionStart Hook — 对话开始自动注入 Brain 状态

**Branch**: cp-03251937-session-start-hook
**Date**: 2026-03-25

### 根本原因

Pipeline 在 step_2_code 停留超时（21 分钟），原因：
1. session-start.sh 代码已写好，但未完成 settings.json D5 注册
2. branch-protect.sh 的 PreToolUse Write|Edit hook 拦截了对 ~/.claude-account1/settings.json 的写入
3. 原始 Brain 任务（21119a57）被自动标记为 canceled，但代码已完整

### 下次预防

- [ ] settings.json 等 ~/.claude-account1/ 配置文件的修改应加入 permissions allow 规则，避免被 branch-protect.sh 误拦截
- [ ] DoD D5 类（本地配置文件注册）测试应标注为 local-only，CI 不验证
- [ ] pipeline 超时检测阈值 20 分钟偏短，hooks 类任务需要额外时间注册到配置文件
