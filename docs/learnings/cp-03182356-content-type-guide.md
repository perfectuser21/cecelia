# Learning: 文档 + 新类型添加指南（PR5）

**分支**: cp-03182356-content-type-guide
**日期**: 2026-03-18

## 完成内容

- 新增 `docs/content-type-guide.md`：完整的内容类型添加指南，含 3 步流程、必填字段说明、完整示例
- 新增 `packages/brain/src/content-types/README.md`：目录说明，快速索引

## 根本原因

YAML 注册表体系建立后，新开发者不知道如何添加新内容类型。文档消除了这个认知障碍。

## 设计决策

1. **3 步结构**：创建文件 → 填字段 → 验证，最小化上手成本
2. **完整示例**：用 short-video 类型作为第二个示例，与 solo-company-case 形成对比
3. **README 做索引**：content-types/ 目录的 README 只放关键信息，详情链接到指南

## 下次预防

- [ ] 新增功能时同步更新文档，避免代码有但文档无的情况
- [ ] DoD 纯文档 PR 使用 `node --input-type=commonjs -e "..."` 检查文件存在，不用 `node -e` 避免 zsh 历史扩展问题
