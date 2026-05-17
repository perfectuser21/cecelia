# Learning: Content Pipeline 4步→6步重构

## 变更概述
将 Brain content pipeline 从 4 阶段（research → generate → review → export）重构为 6 阶段（research → copywriting → copy-review → generate → image-review → export），文案和图片各自独立审核。

### 根本原因
原 4 步流程将文案和图片混合在一个 `content-generate` 步骤中生成，`content-review` 混合审核文案和图片，无法精准打回：
- 文案未定稿就开始出图，浪费计算资源
- 自检无法发现文案质量问题（需要独立 subagent 审查）
- review 失败打回时，文案和图片全部重做

### 下次预防
- [ ] 新增 pipeline 阶段时，同步更新 YAML 测试（content-pipeline-orchestrator-yaml.test.js）中的阶段映射关系
- [ ] `_createNextStage` 的 action 命名用 `replace('-', '_')` 只替换第一个连字符，多连字符的 task_type（如 `content-copy-review`）生成的 action 是 `created_content_copy-review`（不是全部下划线），测试期望值需匹配
- [ ] task-router 测试中的 task_type 列表必须与代码同步更新，否则 CI 会报 undefined 不等于 'xian'
