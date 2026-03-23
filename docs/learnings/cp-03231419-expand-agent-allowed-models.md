## 扩展 Brain 器官 allowed_models 白名单（2026-03-23）

### 根本原因

PR #1422 新增 codex/* 和 gpt-5.4-* 系列模型时，只更新了 `reflection` 器官的 `allowed_models`，
漏掉了其余 6 个大脑器官（thalamus/cortex/mouth/memory/rumination/narrative）。
模型注册表新增模型后，每个允许使用该模型的器官都必须同步更新白名单，这两个步骤是强绑定关系。

### 下次预防

- [ ] 向模型注册表 MODELS 数组新增模型时，同步检查所有 AGENTS 的 allowed_models——如需使用新模型，必须逐一更新白名单
- [ ] 在 `model-registry.js` 顶部注释里标注：「新增 MODELS 条目后，检查所有 AGENTS 的 allowed_models 是否需要同步」
- [ ] 写 model-registry 相关 PR 时，DoD 增加一条：「所有允许使用该模型的 AGENTS 白名单已更新」
