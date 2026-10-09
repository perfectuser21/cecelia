---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Crystal 第4件:结晶判官（结晶台账 + 三态判决 + 每日结晶报告）

**范围**: packages/brain 后端 — 结晶判官定时任务 + `runCrystalJudge()`；结晶台账/判决/报告/locator 四表（migration 433）；三态判决纯函数引擎；证据留存规范；registry 回写；Brain 查询端点。第一批被告 = OpenClaw leadgen 八格。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] migration `packages/brain/migrations/433_crystal_judge.sql` 建四表（crystal_ledger / crystal_verdict / crystal_report / crystal_locator_registry）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/433_crystal_judge.sql','utf8');for(const t of ['crystal_ledger','crystal_verdict','crystal_report','crystal_locator_registry'])if(!c.includes(t))process.exit(1)"

- [ ] [ARTIFACT] 路由模块 `packages/brain/src/routes/crystal.js` 存在且已挂进 routes.js（`router.use('/crystal'`）
  Test: node -e "const fs=require('fs');fs.accessSync('packages/brain/src/routes/crystal.js');const r=fs.readFileSync('packages/brain/src/routes.js','utf8');if(!/router\.use\('\/crystal'/.test(r))process.exit(1)"

- [ ] [ARTIFACT] scheduler-jobs.js 注册每日 `crystal-judge` 定时任务（走同一 runCrystalJudge）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/scheduler-jobs.js','utf8');if(!c.includes('crystal-judge'))process.exit(1)"

- [ ] [ARTIFACT] 判官模块 `packages/brain/src/crystal-judge.js` 只写 crystal_* 表（NFR 数据完整性：源只读）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/crystal-judge.js','utf8');if(!c.includes('crystal_ledger')||!c.includes('crystal_verdict')||!c.includes('crystal_report'))process.exit(1);if(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(execution_entity|adjudication|postcondition)/i.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous / local_api，测真实 Brain + 真 Postgres）

- [ ] [BEHAVIOR] [L2] B-01: 触发判官后结晶台账八格落库（真 Postgres 时间窗）
  动作: POST /api/brain/crystal/run（空 body）触发判官，随后 psql 计数本轮台账行
  预期观察: crystal_ledger 在 5 分钟时间窗内恰有 8 行（OpenClaw 八格各一行）
  等待预算: 0s（判官同步执行）
  留证: psql count 输出（应为 8）
  Test: manual:bash -c 'curl -sfS -X POST http://localhost:5221/api/brain/crystal/run -H "content-type: application/json" -d "{}" | jq -e ".ok==true" >/dev/null; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM crystal_ledger WHERE created_at > NOW() - interval '"'"'5 minutes'"'"'" | grep -qx 8'

- [ ] [BEHAVIOR] [L2] B-02: 每日结晶报告端点返回八格建议（三态 + 依据 + 六项指标）
  动作: 触发判官后 GET /api/brain/crystal/report
  预期观察: suggestions 长度 8，每格 verdict ∈ {keep_llm,promote,demote}、basis 非空、metrics 含六项指标 key
  等待预算: 0s
  留证: report 端点 JSON（jq 断言输出）
  Test: manual:bash -c 'curl -sfS -X POST http://localhost:5221/api/brain/crystal/run -H "content-type: application/json" -d "{}" | jq -e ".ok==true" >/dev/null; curl -sfS http://localhost:5221/api/brain/crystal/report | jq -e "(.suggestions|length)==8 and all(.suggestions[]; (.verdict|test(\"^(keep_llm|promote|demote)$\")) and .basis and (.metrics|has(\"n_runs\") and has(\"success_rate\") and has(\"token_cost\") and has(\"latency_ms\") and has(\"new_branch_rate\") and has(\"broken_count\")))"'

- [ ] [BEHAVIOR] [L2] B-03: N<20 的格判决必为 keep_llm（数据不足不晋升）
  动作: 触发判官后 GET report，检查所有 metrics.n_runs<20 的格
  预期观察: 不存在「n_runs<20 却非 keep_llm」的格
  等待预算: 0s
  留证: report 端点 jq 断言输出
  Test: manual:bash -c 'curl -sfS -X POST http://localhost:5221/api/brain/crystal/run -H "content-type: application/json" -d "{}" | jq -e ".ok==true" >/dev/null; curl -sfS http://localhost:5221/api/brain/crystal/report | jq -e "all(.suggestions[]; (.metrics.n_runs < 20 and .verdict != \"keep_llm\") | not)"'

- [ ] [BEHAVIOR] [L2] B-04: 每格有且仅有 1 条判决（无重复判决）
  动作: 触发判官后 psql 按 grid_key 分组查重
  预期观察: crystal_verdict 本轮无任何 grid_key 出现 >1 次
  等待预算: 0s
  留证: psql 查重计数（应为 0）
  Test: manual:bash -c 'curl -sfS -X POST http://localhost:5221/api/brain/crystal/run -H "content-type: application/json" -d "{}" | jq -e ".ok==true" >/dev/null; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM (SELECT grid_key FROM crystal_verdict WHERE created_at > NOW() - interval '"'"'5 minutes'"'"' GROUP BY grid_key HAVING count(*) > 1) d" | grep -qx 0'

- [ ] [BEHAVIOR] [L2] B-05: registry 回写复合键 model|app_version|density（真 Postgres 读回）
  动作: POST /api/brain/crystal/locator 写回定位，随后 psql 按复合键读回
  预期观察: ok==true，且 crystal_locator_registry 本轮时间窗内命中该复合键 1 行
  等待预算: 0s
  留证: curl ok + psql count（应为 1）
  Test: manual:bash -c 'curl -sfS -X POST http://localhost:5221/api/brain/crystal/locator -H "content-type: application/json" -d "{\"model\":\"claude\",\"app_version\":\"4.1.8\",\"density\":\"1.0\",\"locator\":{\"x\":1}}" | jq -e ".ok==true" >/dev/null; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM crystal_locator_registry WHERE model='"'"'claude'"'"' AND app_version='"'"'4.1.8'"'"' AND density='"'"'1.0'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'" | grep -qx 1'

- [ ] [BEHAVIOR] [L2] B-06: 证据文件名缺 trial+timestamp → 400
  动作: POST /api/brain/crystal/evidence/validate 传不合规文件名 nogood.png
  预期观察: HTTP 400（拒绝无 trial/timestamp 的证据名）
  等待预算: 0s
  留证: curl http_code（应为 400）
  Test: manual:bash -c 'curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/crystal/evidence/validate -H "content-type: application/json" -d "{\"filename\":\"nogood.png\"}" | grep -qx 400'

- [ ] [BEHAVIOR] [L2] B-07: 合规证据文件名（带 trial+timestamp）→ 200 并解析出 trial
  动作: POST evidence/validate 传 og1__trial3__20260905T221000Z.png
  预期观察: ok==true 且 trial==3
  等待预算: 0s
  留证: curl JSON（jq 断言输出）
  Test: manual:bash -c 'curl -sfS -X POST http://localhost:5221/api/brain/crystal/evidence/validate -H "content-type: application/json" -d "{\"filename\":\"og1__trial3__20260905T221000Z.png\"}" | jq -e ".ok==true and .trial==3"'

- [ ] [BEHAVIOR] [L1] INV-1 判定层不蒸馏：判定层技能永不出 promote（即使全部晋升条件满足）
  动作: 跑冻结判决引擎单测「judgment layer never harden」用例
  预期观察: 判定层入参 → verdict=keep_llm，vitest 该用例通过
  等待预算: 0s
  留证: vitest 退出码
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts -t "judgment layer never harden keep_llm" --no-color'

- [ ] [BEHAVIOR] [L1] INV-2 探针强制：无 postcondition 的技能不许入库晋升
  动作: 跑冻结判决引擎单测「no postcondition even if metrics qualify」用例
  预期观察: has_postcondition=false 且指标达标 → verdict=keep_llm，vitest 该用例通过
  等待预算: 0s
  留证: vitest 退出码
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts -t "keep_llm no postcondition even if metrics qualify probe mandatory" --no-color'

- [ ] [BEHAVIOR] [L2] INV-3 registry 是数据：定位 registry 复合键 model|app_version|density 缺一即拒
  动作: POST /api/brain/crystal/locator 只传 model（缺 app_version/density）
  预期观察: HTTP 400（复合键必须完整，禁半键落库）
  等待预算: 0s
  留证: curl http_code（应为 400）
  Test: manual:bash -c 'curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/crystal/locator -H "content-type: application/json" -d "{\"model\":\"claude\"}" | grep -qx 400'

- [ ] [BEHAVIOR] [L2] INV-4 证据留痕：复用已存在文件名 → 409（禁覆盖）
  动作: POST evidence/validate 传 filename 与 existing 命中同名
  预期观察: HTTP 409（禁复用文件名覆盖）
  等待预算: 0s
  留证: curl http_code（应为 409）
  Test: manual:bash -c 'curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/crystal/evidence/validate -H "content-type: application/json" -d "{\"filename\":\"og1__trial3__20260905T221000Z.png\",\"existing\":[\"og1__trial3__20260905T221000Z.png\"]}" | grep -qx 409'

- [ ] [BEHAVIOR] [L1] INV-5 固化优先级 = 频率 × 失败率
  动作: 跑冻结单测「crystallize priority equals frequency times failure rate」用例
  预期观察: crystallizePriority({n_runs,success_rate}) == n_runs*(1-success_rate)，vitest 该用例通过
  等待预算: 0s
  留证: vitest 退出码
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts -t "crystallize priority equals frequency times failure rate" --no-color'

- INV-6 [DIRTY路由]: N/A — 该铁律约束 harness PR 与 main 冲突时路由 generator-fix，属 harness 调度层，本 sprint（结晶判官后端）不触及 PR/rebase 路由，无对应交付物。

## 完成标准

- [ ] 冻结单测 `sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts` 先 Red 后 Green（TDD 顺序）
- [ ] 全部 [ARTIFACT] / [BEHAVIOR] 在真实 Brain(localhost:5221) + 真 Postgres 上通过
- [ ] DevGate 三项（facts-check / version-sync / dod-mapping）通过；Brain version bump
- [ ] PR 合并后回写 Brain tasks/{task_id} status=completed
