# Learning: content-type YAML 固定 notebook_id + orchestrator 传参 + export 清空

## 背景

solo-company-case pipeline 的 research 阶段始终需要手动在前台填写 notebook_id，因为 YAML 中 `notebook_id` 为空字符串，orchestrator 创建 research 子任务时也未将 typeConfig 的 notebook_id 传入 payload。此外，每次 pipeline 完成后 notebook 内的 sources 会堆积，无法复用同一个工作区。

### 根本原因

content-type YAML 的 `notebook_id` 字段设计为"可配置"但默认为空，没有给出可用的默认值，导致功能静默失败——前台显示为空，用户必须手动填写。

`_startOnePipeline` 函数将 `typeConfig` 声明在 `if (content_type)` 块内部，导致外部作用域无法访问该变量，即使 YAML 有 notebook_id 值，也无法在创建 research 子任务时注入到 payload 中。

export 阶段完成后没有清理 notebook sources 的逻辑，导致每次运行 pipeline 都会在 notebook 中堆积 sources，无法将同一个 notebook 作为可复用的工作区。

### 下次预防

- [ ] content-type YAML 新增字段时，同步检查 orchestrator 是否需要将该字段传入子任务 payload
- [ ] YAML 中的可选配置字段应有合理默认值，不应留空（空值会导致功能静默失败）
- [ ] notebook 复用模式：每个 content-type 固定一个工作区 notebook，export 后自动清空 sources，避免重复配置
- [ ] 变量作用域问题：在函数顶部声明需要在多个条件分支中使用的变量，避免作用域陷阱
