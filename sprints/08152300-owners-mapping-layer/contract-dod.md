---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: MJ5 OWNERS 映射层刀1（Brain 读声明确定性投影，不猜归属）

**范围**: Brain OWNERS 读取器（kind=owners 新事实）+ 声明驱动确定性投影 + 冲突即报（/map/health 亮黄）+ cecelia MJ5 OWNERS 样板 + /map Level-2 声明驱动渲染 + 逻辑守卫单测。
**大小**: L

## 铁律映射（Invariant → 覆盖）

- INV-1 [不猜归属]：声明冲突即报不投影 → 由 B-04 proven-to-fire 覆盖（冲突态 owners 层 degraded + 非法 capability 不产出节点）。
- INV-2 [租户隔离] N/A：本刀不读写任何 per-tenant 业务数据表；投影只聚合照相层四类事实（test/api/db_schema/graph）与 OWNERS 声明，无租户维度。
- INV-3 [测试默认多租户] N/A：无租户数据面；逻辑守卫单测种入的是 OWNERS 声明与事实 fixture，非租户数据，无需 ≥2 租户串读断言。

## ARTIFACT 条目

- [ ] [ARTIFACT] OWNERS 读取器纯函数模块存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/owners-reader.js','utf8');if(!/parseOwnersDeclaration/.test(c)||!/resolveEffectiveDeclarations/.test(c)||!/detectOwnersConflicts/.test(c))process.exit(1)"

- [ ] [ARTIFACT] owners 扫描器存在
  Test: node -e "require('fs').accessSync('scripts/scan/scan-owners.js')"

- [ ] [ARTIFACT] fact-snapshot-header SNAPSHOT_KINDS 含 owners
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/fact-snapshot-header.js','utf8');if(!/SNAPSHOT_KINDS[^;]*owners/.test(c))process.exit(1)"

- [ ] [ARTIFACT] map-read-service REQUIRED_FACT_KINDS 含 owners
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/map-read-service.js','utf8');if(!/REQUIRED_FACT_KINDS[^;]*owners/.test(c))process.exit(1)"

- [ ] [ARTIFACT] cecelia MJ5 OWNERS 样板文件存在（两处）
  Test: node -e "const fs=require('fs');['packages/brain/src/map/OWNERS','apps/dashboard/src/pages/map/OWNERS'].forEach(p=>{if(!fs.readFileSync(p,'utf8').includes('cecelia/MJ5'))process.exit(1)})"

- [ ] [ARTIFACT] MapPage Level-2 渲染 owned_artifacts（声明驱动，非空 UUID）
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/planning/pages/MapPage.tsx','utf8');if(!/owned_artifacts/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本，manual:bash 内嵌单行命令）

- [ ] [BEHAVIOR] [L2] B-01: owners 扫描落 kind=owners 事实
  动作: 跑 owners 扫描器 scan-owners.js（repo=cecelia）
  预期观察: fact_snapshot_headers 出现 kind=owners AND repo=cecelia 行，row_count ≥ 2（样板目录数）
  等待预算: 0s
  留证: psql 查询 row_count 输出
  Test: manual:bash -c 'set -e; SCAN_REPO_NAME=cecelia node "$(git rev-parse --show-toplevel)/scripts/scan/scan-owners.js" >/dev/null 2>&1; N=$(psql "${MAP_DATABASE_URL:-postgres://cecelia@localhost:5432/cecelia}" -tAc "SELECT row_count FROM fact_snapshot_headers WHERE kind=\$\$owners\$\$ AND repo=\$\$cecelia\$\$" | head -1 | tr -d " "); [ "${N:-0}" -ge 2 ] && echo OK || { echo "FAIL row_count=$N"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: rebuild 后 /nodes/MJ5 出 owned_artifacts 归属样板文件
  动作: POST /map/rebuild scope=cecelia，再 GET /map/nodes/MJ5?scope=cecelia
  预期观察: owned_artifacts 含 packages/brain/src/map/radius.test.js，且每项 capability_key==MJ5
  等待预算: 0s
  留证: /nodes/MJ5 响应 owned_artifacts 数组
  Test: manual:bash -c 'set -e; curl -sf -X POST localhost:5221/api/brain/map/rebuild -H "Content-Type: application/json" -d "{\"scope_key\":\"cecelia\"}" >/dev/null; curl -sf "localhost:5221/api/brain/map/nodes/MJ5?scope=cecelia" | jq -e "([.owned_artifacts[].stable_ref]|index(\"packages/brain/src/map/radius.test.js\")) and (.owned_artifacts|all(.[]; .capability_key==\"MJ5\"))" >/dev/null && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 被声明文件从 unclaimed 移出
  动作: GET /map/unclaimed?scope=cecelia
  预期观察: 样板文件 packages/brain/src/map/radius.test.js 不再出现在 unclaimed 列表（已被 OWNERS 归属）
  等待预算: 0s
  留证: unclaimed 列表 jq 断言输出
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/map/unclaimed?scope=cecelia" | jq -e "([.unclaimed[].stable_ref]|index(\"packages/brain/src/map/radius.test.js\"))|not" >/dev/null && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: 冲突即报不投影（proven-to-fire，先见红再复绿）[接缝×2]
  动作: 写非法 capability 声明（cecelia/__NOT_A_REAL_CAP__）到 map/__tests__/OWNERS，扫描+rebuild，读 /health；随后清理并重扫重建复绿
  预期观察: 冲突态 /health.layers.owners.status==degraded 且 overall==degraded 且 owners_conflicts 含 reason_code=capability_not_in_manifest；非法 capability 不产出节点
  等待预算: 0s
  留证: /health 红态响应 JSON
  Test: manual:bash -c 'set -e; ROOT=$(git rev-parse --show-toplevel); C="$ROOT/packages/brain/src/map/__tests__/OWNERS"; printf "capability: cecelia/__NOT_A_REAL_CAP__\n" > "$C"; SCAN_REPO_NAME=cecelia node "$ROOT/scripts/scan/scan-owners.js" >/dev/null 2>&1; curl -sf -X POST localhost:5221/api/brain/map/rebuild -H "Content-Type: application/json" -d "{\"scope_key\":\"cecelia\"}" >/dev/null; H=$(curl -sf "localhost:5221/api/brain/map/health?scope=cecelia"); rm -f "$C"; SCAN_REPO_NAME=cecelia node "$ROOT/scripts/scan/scan-owners.js" >/dev/null 2>&1; curl -sf -X POST localhost:5221/api/brain/map/rebuild -H "Content-Type: application/json" -d "{\"scope_key\":\"cecelia\"}" >/dev/null; echo "$H" | jq -e ".layers.owners.status==\"degraded\" and .overall==\"degraded\" and ([.owners_conflicts[]|select(.reason_code==\"capability_not_in_manifest\")]|length>=1)" >/dev/null && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: owned_artifacts schema 完整且无禁用字段
  动作: GET /map/nodes/MJ5?scope=cecelia，校验 owned_artifacts 元素形状
  预期观察: 每项含 stable_ref/fact_kind/capability_key(string) + source==owners，且不含禁用键 files/artifacts
  等待预算: 0s
  留证: jq 结构断言输出
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/map/nodes/MJ5?scope=cecelia" | jq -e ".owned_artifacts|length>=1 and all(.[]; (.stable_ref|type==\"string\") and (.fact_kind|type==\"string\") and (.capability_key|type==\"string\") and .source==\"owners\" and (has(\"files\")|not) and (has(\"artifacts\")|not))" >/dev/null && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-06: error path — 未知 capability 404、缺 scope 400
  动作: GET /map/nodes/__NOPE__?scope=cecelia 与 GET /map/health（无 scope）
  预期观察: 未知 capability 返 404 且 error.code==MAP_NODE_NOT_FOUND；缺 scope 返 400
  等待预算: 0s
  留证: HTTP 状态码 + error.code 输出
  Test: manual:bash -c 'C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/map/nodes/__NOPE__?scope=cecelia"); [ "$C1" = "404" ] || { echo "FAIL nodes=$C1"; exit 1; }; C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/map/health"); [ "$C2" = "400" ] || { echo "FAIL health-noscope=$C2"; exit 1; }; curl -s "localhost:5221/api/brain/map/nodes/__NOPE__?scope=cecelia" | jq -e ".error.code==\"MAP_NODE_NOT_FOUND\"" >/dev/null && echo OK || { echo FAIL; exit 1; }'

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — Playwright mac_web）

- [ ] [BEHAVIOR:E2E] 用户在 /map 点 MJ5，Level-2 声明驱动渲染真实文件路径（非 UUID 串），截图可视化验证
  Screenshots:
    - 01-map-initial.png   期望：/map 页加载，价值流与 capability（含 MJ5 承诺地图）可见
    - 02-mj5-level2.png     期望：点 MJ5 后 Level-2「承诺地图」面板展开，事实锚点列表可见
    - 03-owned-paths.png    期望：事实锚点列表含真实文件路径（如 packages/brain/src/map/radius.test.js），非空、非 UUID 串
  期望：Playwright 断言 Level-2 面板可见且含样板文件路径文本；截图存入 ${SPRINT_DIR}/screenshots/
