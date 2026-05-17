# Learning: 最终清理

**日期**: 2026-04-02

### 根本原因
docs/reports/ 和 docs/learning/ 中积累了 v12 时期的过时文件。templates/ 中有 3 个无引用的模板。feature-registry.yml 有 3 个引用已删功能的条目。

### 下次预防
- [ ] 删除功能后，同时检查 docs/、templates/、feature-registry.yml 中的引用
