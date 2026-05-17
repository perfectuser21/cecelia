# Learning: 5路agent审计扫尾

**日期**: 2026-04-02

### 根本原因
5路并行agent深度审计发现：verify-step.sh 还在写seal文件（孤儿代码）、install-hooks.sh/impact-check.sh 功能过时、feature-registry.yml 4个条目引用已删功能导致 paths/ 自动生成包含过时内容、docs 2个文件过时。

### 下次预防
- [ ] 删功能时用 grep -rl 全仓搜索所有引用（包括 feature-registry.yml 的条目）
- [ ] paths/ 自动生成后验证：不应包含已删功能关键词
