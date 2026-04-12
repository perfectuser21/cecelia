### 根本原因

为 pipeline-detail 端点添加 system_prompt_content 字段，读取对应 skill 的 SKILL.md 文件内容。
SKILL.md 位于 `~/.claude-account1/skills/{skill-name}/SKILL.md`，需要 os.homedir() 构建路径。
task_type → skill 名映射集中管理在 TASK_TYPE_TO_SKILL 常量中，sprint/harness 两种前缀均覆盖。

### 下次预防

- [ ] 修改 Brain routes 后需临时复制到主仓库并重启服务才能验证 BEHAVIOR 测试
- [ ] homedir() 导入需要从 'os' 模块，不要忘记添加 import
