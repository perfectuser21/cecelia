# Agent与Skill身份验收

- [x] [BEHAVIOR] runtimesourceidentity 真实PG验证稳定UUID、来源链接唯一、非Agent拒绝、固定Git版本不可变、同名未核实、路径和摘要检查、映射审计同事务、安装冲突和生产拒写、两连接旧快照拒写。
  Test: manual:bash -c "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_scratch} DB_HOST=${DB_HOST:-/tmp} DB_USER=${DB_USER:-administrator} npx vitest run --config vitest.integration.config.js src/lib/__tests__/runtime-identities.test.js"
