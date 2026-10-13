# 固定版本依赖验收

- [x] [BEHAVIOR] runtimeversiongraph 真实PG验证复合身份FK、类型约束、固定slot完整性、Workflow快照与Recipe一致、同契约换实现、配置代码独立换版、历史不变、影响只读、并发封存、安装幂等与结构漂移拒绝。
  Test: manual:bash -c "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_scratch} DB_HOST=${DB_HOST:-/tmp} DB_USER=${DB_USER:-administrator} npx vitest run --config vitest.integration.config.js src/lib/__tests__/runtime-version-graph.test.js"
