# 清退无消费者的旧夜间任务标记调度器

Task: 230d4015-60e7-44c1-a59b-0b7bed33989b
GP-Anchor: none(infra)

- [x] 真实启动函数不启动旧编排，现役 Tick、Notion 同步及目录恢复接线保留。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/server-dormant-boundaries.test.js
- [x] 真实状态 HTTP 保留停用封套与现役队列统计；历史日报原路由与 getter 只读取旧记录。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain src/routes/__tests__/briefing-read-api.test.js
- [x] 注册表只清退无消费者标签，普通任务资格与共享保护仍有效。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/task-type-registry.guard.test.js src/lib/__tests__/task-type-registry.test.js
- [x] 版本同步、事实与源码配置有效；旧专属 PG 入口随模块清退，GHA 夜间回归保留。
  Test: manual:node scripts/facts-check.mjs
  Test: manual:bash scripts/check-version-sync.sh
