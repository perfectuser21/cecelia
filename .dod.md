# 轻盈底座接入 B 站既有私密作品核验

Task: a41629e2-dc29-42cf-a49b-7948ef73276c
GP-Anchor: none(infra)

- [x] 固定 BVID、真机身份、只读合同和精确 xian-m4 安装发布才可入单，原 Commander 和 101–104 不会领取。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js
- [x] 同一运行的只读原生清单归档为一个 Activity span，原 worker 单次结算，未证实或证据不匹配拒绝完成。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js
- [x] 仅放行与冻结来源 SHA 一致的 staging 环境。候选与生产各限一单，固定任务 worker 拒绝其他任务的领取结果和待发回执。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/worker.test.mjs
