# Universal Map Projection Engine — Knife 1 Contract Draft

**Sprint**：`sprints/08110815-universal-map-knife1/`  
**Task ID**：`8c6e3ff5-5a27-401a-8cfc-95a8836c7bb4`  
**PR 序号**：Knife 1/5  
**起草日期**：2026-08-11

## 范围

本 Knife 建立通用 Map Manifest 的版本化输入合同：

1. 完整 Manifest 的机器可读 Schema、运行时校验和全量错误返回。
2. 与 JSON 对象键顺序无关、与数组顺序有关的 canonical SHA-256 digest。
3. 不可变 draft、scope 内单调版本、digest 幂等提交和单 active 约束。
4. validate、submit、activate 三个统一写 API。
5. 激活与 Projector 同事务；Projector 未交付时稳定返回 503 并回滚。
6. 冻结 Cecelia v1 Manifest，作为第一个验收域输入。
7. Migration 402、Brain 版本同步和 scratch 真验火。

**明确排除**：事实归一化、确定性 Projector、Map 查询 API、ZenithJoy 第二域、Dashboard；分别由 Knife 2–5 交付。

## 输入合同

Manifest 顶层必须包含：

- `schema_version`
- `scope_key`
- `source_decision_id`
- `value_streams`
- `capabilities`
- `boundaries`
- `cross_cuts`
- `shared_prerequisite`

引用必须闭合，稳定 key 在各自集合中唯一，Boundary 依赖图不得成环。核心 Schema 不允许写入 Cecelia、ZenithJoy 或 F/G 等领域身份。

## 持久化合同

- 表：`map_manifest_versions`。
- `(scope_key, version)` 唯一；`(scope_key, digest)` 唯一。
- 同一 scope 最多一个 active。
- 已写入的 manifest、digest、版本和来源决策不可修改。
- 相同 digest 重复或并发提交返回同一版本；新 digest 分配下一个版本。
- 激活成功后旧 active 变为 superseded；Projector 失败则所有状态保持原样。

## HTTP 合同

| 端点 | 行为 |
|------|------|
| `POST /api/brain/map/manifests/validate` | 返回 canonical digest 或全部结构/语义错误，不访问数据库 |
| `POST /api/brain/map/manifests` | 提交不可变 draft；首次 201，digest 重复 200 |
| `POST /api/brain/map/manifests/:scope/:version/activate` | 同事务调用 Projector；当前 Knife 默认 503 fail-closed |

不存在 Value Stream、Capability、Boundary、Cross-cut 的独立写端点。

## 冻结 Cecelia v1

`packages/brain/config/map-manifests/cecelia.v1.json` 必须精确包含：

- 2 条 Value Stream
- 11 个 Capability
- 2 条 Boundary
- 7 项 Cross-cut
- Shared Prerequisite `applicable=false`
- `source_decision_id=4bc109e9-3b70-4b17-a1b4-bcd01bfae776`

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Schema | `packages/brain/src/lib/__tests__/map-manifest-schema.test.js` | 同一次校验返回全部重复 key | 实现前缺 Manifest Schema 与全量语义错误 |
| Canonical | `packages/brain/src/lib/__tests__/map-manifest-schema.test.js` | 忽略 object key 排列差异 | 实现前缺 canonical digest |
| Frozen input | `packages/brain/src/lib/__tests__/map-manifest-schema.test.js` | 冻结的 Cecelia v1 输入精确表达 2×11×2×7 | 实现前缺冻结 Manifest |
| Store | `packages/brain/src/__tests__/integration/map-manifest-store.integration.test.js` | 同一完整 manifest 并发提交只创建一个 draft | 实现前缺表与 store |
| Activation | `packages/brain/src/__tests__/integration/map-manifest-store.integration.test.js` | projector 与 active 切换同事务 | 实现前缺事务激活流程 |
| HTTP | `packages/brain/src/routes/__tests__/map-manifests.test.js` | 不存在局部 PATCH 或逐实体创建端点 | 实现前统一 Map Manifest 路由不存在 |
| Migration | `packages/brain/src/__tests__/migration-402-map-manifest.test.js` | 建立版本表 | 实现前 migration 402 不存在 |
| Smoke | `packages/brain/scripts/smoke/map-manifest-smoke.sh` | scratch 真实提交与 fail-closed 激活 | scratch schema 迁移前验火失败 |

## 验收

行为与证据以同目录 `contract-dod.md` 的 D1–D8 为准。除定向和完整 Brain 测试外，必须在 `cecelia_scratch` 真实提交两次冻结 Manifest，证明只生成一个 draft；激活返回 503，且不产生 active，结束后 fixture 清零。
