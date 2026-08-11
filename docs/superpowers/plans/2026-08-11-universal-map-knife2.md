# Universal Map Projection Engine — Knife 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development task by task.

**Goal:** 交付通用、确定性、可原子重建的 Map Projection Core，并让完整 Manifest 激活直接生成 active projection。

**Architecture:** 纯函数 projector 把已校验 Manifest 转成排序后的稳定节点与边；节点/边 ID 只由 `scope/type/key` 决定，projection digest 只由 canonical manifest digest、fact revisions、projector version 与结构决定。持久化层在 Manifest 激活的同一事务内写完整 run/nodes/edges，最后切 active run；失败时全部回滚。Projection 表只保存稳定引用、展示字段与非权威 attributes，不复制事实正文。

**Tech Stack:** Node.js ESM、PostgreSQL、Vitest、Supertest、Bash smoke。

---

### Task 1: Projection migration 与稳定关系合同

**Files:**
- Create: `packages/brain/migrations/405_map_projection_core.sql`
- Create: `packages/brain/migrations/rollback/405_map_projection_core.down.sql`
- Create: `packages/brain/src/__tests__/migration-405-map-projection.test.js`
- Create: `packages/brain/src/__tests__/integration/migration-405-map-projection.integration.test.js`

- [ ] 写 RED：三表、类型约束、active partial unique、run-scoped FK、digest 约束和级联删除。
- [ ] 运行 RED：`cd packages/brain && npx vitest run src/__tests__/migration-405-map-projection.test.js src/__tests__/integration/migration-405-map-projection.integration.test.js`
- [ ] 提交 RED：`test(brain): define map projection persistence contract`。
- [ ] 实现 migration 405，仅迁移 `cecelia_test` 与 `cecelia_scratch`，运行 GREEN。
- [ ] 提交 GREEN：`feat(brain): add rebuildable map projection tables`。

### Task 2: 纯确定性结构 Projector

**Files:**
- Create: `packages/brain/src/lib/map-projector.js`
- Create: `packages/brain/src/lib/__tests__/map-projector.test.js`

- [ ] 写 RED：精确 2 Value Stream、11 Capability、7 Cross-cut 节点；11 `contains`、2 `hands_off_to`、14 `serves`、4 `owned_by` 边；`applicable=false` 不造 prerequisite。
- [ ] 写 RED：同输入重复运行、对象 key 重排及 Manifest display name 改名时稳定 ID 保持；结构变化时 projection digest 改变。
- [ ] 运行 RED：`cd packages/brain && npx vitest run src/lib/__tests__/map-projector.test.js`。
- [ ] 提交 RED：`test(brain): define deterministic map projection topology`。
- [ ] 实现 canonical 排序、稳定 ID、Boundary/Cross-cut 规则和 projection digest；核心不得出现 Cecelia/ZenithJoy/F0/G1 领域常量。
- [ ] 运行 GREEN 并提交：`feat(brain): build deterministic map projections`。

### Task 3: 原子持久化与 Manifest 激活接线

**Files:**
- Create: `packages/brain/src/lib/map-projection-store.js`
- Create: `packages/brain/src/lib/__tests__/map-projection-store.test.js`
- Create: `packages/brain/src/__tests__/integration/map-projection-store.integration.test.js`
- Modify: `packages/brain/src/lib/map-manifest-store.js`
- Modify: `packages/brain/src/lib/__tests__/map-manifest-store.test.js`
- Modify: `packages/brain/src/routes/__tests__/map-manifests.test.js`

- [ ] 写 RED：成功激活产生唯一 active run；重复重建 digest 相同；第二版本激活 supersede 旧 run；中途节点/边写失败后旧 manifest/run 仍 active 且无半张图。
- [ ] 运行 RED：`cd packages/brain && npx vitest run src/lib/__tests__/map-projection-store.test.js src/__tests__/integration/map-projection-store.integration.test.js src/lib/__tests__/map-manifest-store.test.js src/routes/__tests__/map-manifests.test.js`。
- [ ] 提交 RED：`test(brain): define atomic map projection activation`。
- [ ] 实现 store，并把 `projectMapManifest` 设为 Manifest 激活默认 projector，移除正常路径 503。
- [ ] 运行 GREEN 并提交：`feat(brain): activate manifests with atomic projections`。

### Task 4: Scratch 真验火、版本与门禁

**Files:**
- Create: `packages/brain/scripts/smoke/map-projection-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Modify: `packages/brain/src/selfcheck.js`
- Modify: `packages/brain/src/__tests__/selfcheck.test.js`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `sprints/08111015-universal-map-knife2/contract-dod.md`

- [ ] 写 RED smoke：scratch 提交并激活一个完整 Manifest；DB 精确验证 2×11×2×7、Boundary 是边、Cross-cut 是节点、Shared Prerequisite 不造节点；清空并重建后 digest 相同。
- [ ] 提交 RED：`test(brain): define projection scratch acceptance`。
- [ ] Brain 升 `1.271.6`、schema floor 升 `405`，同步全部版本文件并登记 smoke allowlist。
- [ ] scratch GREEN：`DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-projection-smoke.sh`，连续两次通过且 fixture 清零。
- [ ] 跑定向、完整 Brain 回归、三项 DevGate、精确 DoD mapping、light evaluator、`git diff --check`。
- [ ] 请求代码审查；修复 Critical/Important 后 push、PR、全 CI、正常 merge。
- [ ] 自动生产部署后提交并激活冻结 Cecelia Manifest，真实 DB 验证 active projection，再进入 Knife 3。
