## Brain {VERSION} — step_probes 对齐 workspace 探针最终形状：http filter/reduce/minus 保留 + source_sha256 文件级哈希（链 bf5088a3 棒2 后续，任务 14cd9e76，决策 702949b6）

- 病根：workspace PR #1982 定档的 `checks/social-keyword-leadgen.yaml`（schema.json）里 http 探针形状是 `{url, filter:{列:值}, reduce:count|field:<列>, minus?:{同形}}`，#5589 的 `normalizeProbe` 只认 `url`，会把 `filter/reduce/minus` 静默丢掉——落库的 spec 缺取数条件，棒3a 执行体拿不到
- `lib/step-probe-spec.js`：http 探针按 schema.json 归一化（url/filter 非空标量映射/reduce 正则/minus 同形可选），sql 与 http 都拒未知键（同 schema `additionalProperties:false`）；新增 `sourceSha256(text)`
- 哈希定档为两级并存：`spec_hash` 逐条 canonical JSON（哪条探针变了）+ 新列 `source_sha256` 整文件原文 sha256（与 probes-lib `loadChecks().sha256` 同口径，仓库那份是不是库里这版）；迁移 476 幂等加可空列 + hex64 CHECK，回滚脚本齐（475 已被棒3a #5590 占用）
- 路由：`POST /step-probes` 收 `source_sha256`（非 hex64 → 400 `STEP_PROBE_SOURCE_SHA_INVALID`，COALESCE 保留旧值）；`drift-check` 收 `source_sha256` → 回 `source_match`（同 workflow 多版本并存 = 半同步 = false）与 `registered_source_sha256`；GET 返回该列
- `scripts/sync-step-probes.mjs`：`loadProbesYaml` 附带 `source_sha256`，upsert 与 `--check` 都带上
- 用 workspace main 真 YAML 过归一化器：5 条探针（delivery×3 / scoring×2，全 warn）全部通过，文件 sha256 前缀 `c1356bdf9782` 与 workspace 侧一致；格子 ref = `probe:videos_readback,comments_readback,line_key_not_null` / `probe:pool_advanced,effective_count`
