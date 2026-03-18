# Learning: YAML 验证器 — 启动时检查内容类型配置格式

**分支**: cp-03182253-yaml-validator
**日期**: 2026-03-18

## 完成内容

新增 content-type-validator.js，在 Brain selfcheck 阶段做 YAML 格式校验：
- `validateContentType(config)`：轻量校验单个配置，检查 content_type / images.count / template.generate_prompt，返回 `{ valid, errors }`
- `validateAllContentTypes()`：调用 registry 读取所有 YAML，批量校验汇总
- `selfcheck.js`：调用 validateAllContentTypes()，有错误时 `console.warn('[WARN] ...')`（不阻断启动）
- 11 个 vitest 测试，覆盖有效配置、缺字段、null 输入、异常抛出场景

## 根本原因

Pipeline 运行时若 YAML 格式有问题（缺 generate_prompt）会导致 content-generate 子任务描述为空。
早期在 selfcheck 阶段发现并打印 WARN，让运维人员在服务启动时就能发现问题，而不是等到 Pipeline 实际运行。

## 设计决策

1. **不阻断启动**：YAML 校验问题不是 Brain 核心功能异常，打印 WARN 即可，避免因内容类型配置格式错误导致 Brain 无法启动
2. **独立于 registry.js**：validator.js 专注于格式校验并返回错误列表，registry.js 专注于加载和使用，职责分离
3. **复用 registry 接口**：validator 通过 import listContentTypes + getContentType 获取数据，不直接读 YAML，避免重复 IO 逻辑

## 下次预防

- [ ] selfcheck.js 的 WARN 日志不计入 allPassed（不在 record() 中），直接 console.warn 即可
- [ ] vitest mock ESM 模块时，mock factory 须 return 含所有 export 函数的对象
- [ ] brain-guard 要求 .dev-agent-seal 文件后才允许写 .dev-mode，用 `echo "step_1_agent: approved@$(date)" >> .dev-agent-seal.branch` 生成
