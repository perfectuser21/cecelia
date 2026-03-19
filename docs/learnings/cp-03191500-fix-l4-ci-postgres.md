# Learning: L4 CI PostgreSQL ECONNREFUSED 修复

## 日期
2026-03-19

## 分支
cp-03191500-fix-l4-ci-postgres

### 根本原因

L4 CI 的 Brain Integration Tests 在 `node src/migrate.js` 步骤报 `ECONNREFUSED`，三个叠加原因：

1. **环境变量传递不可靠**：`DB_PORT` 通过 `$GITHUB_ENV` 在 "Set up PostgreSQL" 步骤导出，理论上后续步骤可读取。但在 self-hosted macOS runner 上，shell 初始化脚本（`.zshrc`/`.bash_profile`）可能干扰 `GITHUB_ENV` 的加载，导致 `DB_PORT` 为空，Node.js 的 `db-config.js` 回退到默认 5432 端口——而实际 PostgreSQL 运行在 5500+ 的动态端口上。

2. **缺少 pg_isready 守卫**：migrate 步骤直接运行 `node src/migrate.js`，没有先验证 PostgreSQL 是否真正就绪。虽然 "Set up PostgreSQL" 步骤内部有 `pg_isready` 循环，但在步骤间存在时间窗口——PostgreSQL 可能在步骤切换的 shell 初始化期间短暂不可达。

3. **ipcs 解析格式假设 macOS**：清理脚本用 `grep '^m '` 解析 `ipcs -m` 输出，这是 macOS 特有格式。如果 runner 环境迁移到 Linux，共享内存清理会静默失败，遗留的 SysV 段可能导致后续 PostgreSQL 启动失败。

### 下次预防

- [ ] CI 中所有需要数据库连接的步骤，必须在 `env:` 块中显式声明 `DB_PORT: ${{ env.DB_PORT }}`，不依赖隐式 GITHUB_ENV 传递
- [ ] 数据库操作前必须有 `pg_isready` 守卫步骤，不用固定 `sleep`
- [ ] 平台相关的命令（`ipcs`/`lsof`）必须用 `uname` 判断并分支处理
- [ ] 环境变量为空时必须有防御性回退逻辑（从原始参数重新计算）
