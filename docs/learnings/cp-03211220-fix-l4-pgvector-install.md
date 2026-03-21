## L4 pgvector PGDG 预编译包修复（2026-03-21）

### 根本原因

ubuntu-latest 自带的 postgresql-common（257）和 PGDG 仓库的版本（290）冲突，导致 `apt-get install postgresql-server-dev-all` 失败（exit 100）。源码编译 pgvector 依赖这个包，所以所有 Integration shard 全挂。

### 下次预防

- [ ] ubuntu CI 安装 PostgreSQL 时统一用 PGDG 仓库，不混用系统默认源
- [ ] pgvector 优先用预编译包（postgresql-N-pgvector），避免源码编译的依赖链
