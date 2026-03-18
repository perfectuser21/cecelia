# Learning: 内容类型注册表 YAML Schema 设计

**分支**: cp-03182139-content-type-registry-yaml
**日期**: 2026-03-18

## 完成内容

新增 YAML 驱动的内容类型注册表：
- `packages/brain/src/content-types/solo-company-case.yaml` — 第一个内容类型配置
- `packages/brain/src/content-types/content-type-registry.js` — 加载器，导出 getContentType/listContentTypes/loadAllContentTypes
- `packages/brain/src/__tests__/content-type-registry.test.js` — 8 个测试全部通过

## 根本原因

内容类型（solo-company-case）原本硬编码在 skill 中，扩展新类型需要改代码。
通过 YAML 注册表，新增类型只需新建一个 .yaml 文件。

## 设计决策

1. **目录即注册表**：`content-types/` 目录下的所有 .yaml 文件自动被 listContentTypes() 发现
2. **必填字段验证**：加载时检查 content_type/images/template/review_rules/copy_rules，无效配置立即报错
3. **content_type 与文件名一致性**：防止文件名与配置内容不匹配
4. **不存在返回 null**：getContentType 对不存在的类型返回 null（非抛出），符合 null-safe 模式
5. **全 ESM 模块**：使用 import.meta.url + fileURLToPath 解析 __dirname，符合 Brain 全 ESM 规范

## 下次预防

- [ ] js-yaml 已在 brain package.json 的 dependencies 中，无需额外安装
- [ ] Node v25 的 -e 参数中 `!` 会被 zsh 解释为历史扩展，DoD 验证命令应改为 heredoc 或临时文件
- [ ] worktree 中创建文件前需要先确认 tasks_created: true 写入 .dev-mode（branch-protect.sh 强制检查）
- [ ] .prd + .dod 需要放在 worktree 根目录（branch-protect.sh 就近检测），packages/ 子目录开发时不能只依赖 .prd.md
