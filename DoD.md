contract_branch: cp-harness-propose-r2-2cc0e0ee
sprint_dir: sprints/06110850-skill-drift-api

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Brain harness skill 快照漂移检测 API（GET /api/brain/harness/skill-drift）

**范围**: Brain 新增只读端点 `GET /api/brain/harness/skill-drift`，实读 SSOT（`SKILLS_SSOT_DIR`，默认 `~/perfect21/zenithjoy-skills`）与快照（`SKILLS_SNAPSHOT_DIR`，默认 `packages/workflows/skills/`）各 6 个 harness skill 的 SKILL.md frontmatter `version:`，返回逐项对比与 `any_drift`。仅检测不写文件、无 DB 写入、不含其他 skill、不含 Dashboard/告警。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] harness 路由文件含 skill-drift 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('skill-drift'))process.exit(1)"

- [ ] [ARTIFACT] 新端点回归测试已 commit 进 repo（永久 CI 回归，覆盖边界：文件缺失→null、无 version 行→null、改盘翻转）
  Test: node -e "const fs=require('fs');const d='packages/brain/src/routes/__tests__/';const f=fs.readdirSync(d).find(x=>x.includes('skill-drift'));if(!f)process.exit(1);const c=fs.readFileSync(d+f,'utf8');if(!(c.includes('drifted')&&c.includes('null')&&c.includes('any_drift')))process.exit(1)"

- [ ] [ARTIFACT] Sprint TDD 测试文件存在且关键断言未被删改（翻转标记 0.0.0-drift-test + keys 严格断言）
  Test: node -e "const c=require('fs').readFileSync('sprints/06110850-skill-drift-api/tests/skill-drift.test.ts','utf8');if(!(c.includes('0.0.0-drift-test')&&c.includes('any_drift')&&c.includes('snapshot_version')))process.exit(1)"

## BEHAVIOR 条目（journey_type = autonomous — 模式A：curl 真实 Brain localhost:5221，禁 playground）

> Golden Path 溯源：B1→Step 1，B2/B3/B4→Step 2，B5→Step 3，B6→Step 4，B7→Step 6；Step 5（改盘翻转）归模式B final-e2e（见 contract-draft.md ## E2E 验收 步骤 5），模式A 不重复改生产快照文件。
> 零实现自查：B1–B7 第一条命令均为 `curl -sf` GET 强制 2xx —— 路由未注册时 Brain 通用 404 handler 使 curl -sf 返非 0 → 全部 FAIL（真红，无 404-acceptable 旁路）。

- [ ] [BEHAVIOR] B1 — GET 返 200，skills 恰好 6 项且 name 集合精确等于 6 个 harness skill（Golden Path Step 1）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift) || exit 1; echo "$RESP" | jq -e ".skills | length == 6" || exit 1; echo "$RESP" | jq -e ".skills | map(.name) | sort == [\"harness-contract-proposer\",\"harness-contract-reviewer\",\"harness-evaluator\",\"harness-generator\",\"harness-planner\",\"harness-report\"]" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] B2 — 每项 4 字段齐全且类型正确（name string / drifted boolean / 两 version 为 string 或 null）（Golden Path Step 2）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift) || exit 1; echo "$RESP" | jq -e ".skills | all(has(\"name\") and has(\"ssot_version\") and has(\"snapshot_version\") and has(\"drifted\"))" || exit 1; echo "$RESP" | jq -e "(.any_drift | type == \"boolean\") and (.skills | all((.name | type == \"string\") and (.drifted | type == \"boolean\") and ((.ssot_version | type) as \$t | \$t == \"string\" or \$t == \"null\") and ((.snapshot_version | type) as \$u | \$u == \"string\" or \$u == \"null\")))" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] B3 — keys 完整性：顶层 keys 严格 == ["any_drift","skills"]，每项 keys 严格 == ["drifted","name","snapshot_version","ssot_version"]（Golden Path Step 2）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift) || exit 1; echo "$RESP" | jq -e "keys | sort == [\"any_drift\",\"skills\"]" || exit 1; echo "$RESP" | jq -e ".skills | all(keys | sort == [\"drifted\",\"name\",\"snapshot_version\",\"ssot_version\"])" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] B4 — 禁用字段反向检查：anyDrift/hasDrift/has_drift/drift/items/list/skillList/versions（顶层）与 ssotVersion/snapshotVersion/version_ssot/version_snapshot/is_drifted/isDrifted（项级）一律不出现（Golden Path Step 2）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift) || exit 1; echo "$RESP" | jq -e "(has(\"anyDrift\") or has(\"hasDrift\") or has(\"has_drift\") or has(\"drift\") or has(\"items\") or has(\"list\") or has(\"skillList\") or has(\"versions\")) | not" || exit 1; echo "$RESP" | jq -e ".skills | all((has(\"ssotVersion\") or has(\"snapshotVersion\") or has(\"version_ssot\") or has(\"version_snapshot\") or has(\"is_drifted\") or has(\"isDrifted\")) | not)" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] B5 — 内部一致性：any_drift == (任一 drifted)，且每项 drifted == (ssot_version != snapshot_version) 的真实对比（null != string 按 jq 语义为 true，覆盖 PRD 边界规则）（Golden Path Step 3）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift) || exit 1; echo "$RESP" | jq -e ".any_drift == (.skills | map(.drifted) | any)" || exit 1; echo "$RESP" | jq -e ".skills | all(.drifted == (.ssot_version != .snapshot_version))" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] B6 — 真实读盘交叉验证（防硬编码）：响应 snapshot_version 必须逐项等于 evaluator 独立 grep 快照 SKILL.md frontmatter 的实读值；SSOT 侧 all(.ssot_version != null) 必须成立（R1：SSOT 未 mount/解析错误 → 全 null 误报，真 FAIL 不兜底）（Golden Path Step 4 / E2E 4b）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift) || exit 1; for s in harness-planner harness-contract-proposer harness-contract-reviewer harness-generator harness-evaluator harness-report; do DISK_V=$(grep -m1 "^version:" "packages/workflows/skills/$s/SKILL.md" 2>/dev/null | sed "s/version:[[:space:]]*//" | tr -d " \""); if [ -n "$DISK_V" ]; then echo "$RESP" | jq -e --arg n "$s" --arg v "$DISK_V" ".skills[] | select(.name == \$n) | .snapshot_version == \$v" || exit 1; else echo "$RESP" | jq -e --arg n "$s" ".skills[] | select(.name == \$n) | .snapshot_version == null" || exit 1; fi; done; echo "$RESP" | jq -e ".skills | all(.ssot_version != null)" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] B7 — error path：GET 必须 2xx 的前提下，POST 同路径必须非 200（方法语义正确；绑定 GET 前置防零实现假绿）（Golden Path Step 6）
  Test: manual:bash -c 'curl -sf -o /dev/null localhost:5221/api/brain/harness/skill-drift || exit 1; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/harness/skill-drift); [ "$CODE" != "200" ] || exit 1; echo OK'
  期望: OK
