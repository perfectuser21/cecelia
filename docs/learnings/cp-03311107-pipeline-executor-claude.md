# Learning - content pipeline executor 接通 Claude CLI

**Branch**: cp-03311107-pipeline-executor-claude
**PR**: #1735

### 根本原因

`content-pipeline-executors.js` 中 4 个阶段（executeCopywriting / executeCopyReview / executeGenerate / executeImageReview）一直使用本地模板和静态规则生成内容。

配置页面（ContentTypeConfigPage）虽然提供了 `generate_prompt`、`review_prompt`、`image_prompt`、`image_review_prompt` 字段，但各 executor 函数从未读取这些配置，导致用户在配置页配置的 prompt 对 pipeline 执行无任何影响。

最终 solo-company-case 等 YAML 配置中的品牌声音定义、审核规则、图片策划指令全部被忽略，pipeline 产出与预期 prompt 完全脱节。

### 修复方案

- 添加 `runClaude(prompt, outputFormat, timeout)` helper（使用 `spawnSync` 避免 shell 注入）
- 各函数优先读取 `typeConfig.template.<stage>_prompt`，替换 `{keyword}` / `{findings}` / `{copy}` 等占位符
- Claude 调用失败时有 fallback（静态规则 / 占位文件），不阻断 pipeline
- `executeCopywriting` 注入 `task.payload.review_feedback` 支持 rerun 改进

### 下次预防

- [ ] 新建 executor 阶段时，必须检查 `typeConfig.template` 中是否有对应 prompt 字段，不要用本地字符串拼接
- [ ] 使用 `spawnSync` 而非 `execSync` 拼 shell 命令，避免 prompt 中的引号/特殊字符引发 shell 注入
- [ ] `review_feedback` rerun 机制：copyreview 失败时，记录 `issues` 到下一次 copywriting 的 payload
