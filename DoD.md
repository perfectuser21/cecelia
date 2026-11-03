# DoD：旧 Engine／Quality 包退役与有效能力归位

- [x] [BEHAVIOR] 根 DoD CLI 真实接受有效映射，拒绝空验收、假测试与缺文件；push 调用不依赖 Quality。
  Test: manual:node --test scripts/ci/__tests__/basic-dod-mapping.test.mjs
- [x] [BEHAVIOR] 发布和编码流程使用 Brain 的 Smoke 清单；隔离与写入防护保留，失败阻止放行。
  Test: manual:node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs
- [x] [BEHAVIOR] Goldset 新入口用原始 PNG、本地真实 HTTP 和原阈值拒绝无效模型回执。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/goldset-eval-cli.test.js
- [x] [BEHAVIOR] staging 实际子进程发现并执行迁后的路由回归，数据库失败真实返回500。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/staging-golden-smoke-cli.test.js src/__tests__/regression/relay-runs-endpoint.golden-smoke.test.ts
- [x] [BEHAVIOR] 旧 Quality 组件不再生成CI任务；旧命令非零退出，假通过证书不能复活。
  Test: manual:node --test scripts/ci/__tests__/basic-retired-quality-ci.test.mjs scripts/ci/__tests__/basic-retired-quality-certificate.test.mjs
- [x] [BEHAVIOR] Engine 包退役后，写入守卫、worktree、launcher 的实际行为由根开发工具入口验证，CI 不再创建旧组件。
  Test: manual:node scripts/dev/check.mjs
- [x] [BEHAVIOR] 必要 Codex runner 归 Brain，保持隔离、OAuth、argv 与真实工作目录保护；API 对退休 Engine 返回明确 410。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/codex-runner-owned-adapter.test.js
- [ ] [ARTIFACT] 迁移、删除与调用闭包独立复核，包锁及版本同步，正常 PR 验收。
  Test: manual:bash scripts/check-version-sync.sh
