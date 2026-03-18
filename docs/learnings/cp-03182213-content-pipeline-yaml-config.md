# Learning: content-pipeline 读取 YAML 配置

**分支**: cp-03182213-content-pipeline-yaml-config
**日期**: 2026-03-18

## 完成内容

修改 content-pipeline-orchestrator.js，集成 content-type-registry：
- `orchestrateContentPipelines`：读取 pipeline.payload.content_type，调用 getContentType() 验证，不存在则 pipeline 标 failed
- `advanceContentPipeline`：content-research→generate 时传递 images_count；content-generate→review 时传递 review_rules
- `_createNextStage`：content-generate 阶段使用 YAML template.generate_prompt 替换硬编码描述
- 新增 6 个 vitest 测试（vi.mock 覆盖 getContentType）

## 根本原因

Pipeline 代码原本硬编码生成描述和参数，无法适配不同内容类型。通过 YAML 注册表，每种内容类型可自定义生成提示词、图片数量、审查规则。

## 设计决策

1. **向后兼容**：payload 无 content_type 时照常运行，不破坏已有 pipeline
2. **早期失败**：content_type 不在注册表时，在 orchestrate 阶段（启动时）立即 failed，而非在 generate 阶段才报错
3. **配置透传**：content_type 从 pipeline → research → generate → review → export，每个子任务 payload 都含 content_type
4. **review_rules 透传**：review 子任务 payload 携带 YAML review_rules，供 content-review skill 使用
5. **generate_prompt 关键字替换**：`{keyword}` 占位符在写入 description 时替换为实际关键词

## 下次预防

- [ ] vitest mock ESM module 需要在 import 前用 vi.mock()，且 mock factory 必须 return 含目标函数的对象
- [ ] mock pool 的 query 函数需要按 SQL 内容区分返回值，多次调用同 SQL 时用 callCount 计数
- [ ] 父 pipeline 和子任务都需要 content_type，advanceContentPipeline 中从两个来源合并
- [ ] DoD Test 字段只接受三种格式：`tests/`（文件必须存在）、`contract:RCI_ID`、`manual:命令`（只允许 node/npm/curl/bash/psql 开头）。`packages/brain/src/__tests__/...` 路径不符合任何格式，必须改为 `manual:bash -c "cd packages/brain && npm test ..."` 形式
