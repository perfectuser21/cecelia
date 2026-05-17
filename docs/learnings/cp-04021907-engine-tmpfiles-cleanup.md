# Learning: Engine 临时文件/archive/备份清理

**日期**: 2026-04-02
**分支**: cp-04021907-engine-tmpfiles-cleanup

## 背景

Engine 包内有 136 个 git tracked 的垃圾文件：108 个 .tmp-scl-* 测试临时目录、25 个 .archive/ 废弃文件、
regression-contract.yaml.bak 备份等。这些文件不该被 git 跟踪。

### 根本原因

1. .tmp-scl-* 是 Sprint Contract Loop 测试创建的临时目录，vitest 未在 afterAll 中清理
2. .archive/ 目录是手动归档旧代码，但没有加入 .gitignore
3. .gitignore 缺少 .tmp-scl-*、.archive/、*.bak 规则

### 下次预防

- [ ] .gitignore 必须覆盖所有临时/测试目录模式（.tmp-*、.archive/、*.bak）
- [ ] 测试框架 afterAll 必须清理创建的临时文件
