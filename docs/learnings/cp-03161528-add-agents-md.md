---
version: 1.0.0
created: 2026-03-16
branch: cp-03161528-add-agents-md
---

# Learning: 添加 AGENTS.md 时直接在 main 上写文件

## 根本原因

误判 AGENTS.md 为"纯文档"（类似 DEFINITION.md），直接在 main 分支创建文件，跳过了 /dev 流程。实际上这些文件会进 git，属于必须走 /dev 的变更。

## 下次预防

- [ ] 任何新文件创建前，先问"这个文件会进 git 吗？" → 会 → /dev 优先
- [ ] AGENTS.md、.agent-knowledge/ 等配置类文档和 DEFINITION.md 性质不同——DEFINITION.md 是参考文档，AGENTS.md 是系统配置，更应该走 /dev
- [ ] 用户发现问题时不要辩解，直接承认并走正确流程补救
