---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: MJ5 OWNERS 映射层刀1（Brain 读目录级 OWNERS 声明并确定性投影）

**范围**: Brain OWNERS 声明读取器（kind=owners 事实）+ 地图按声明确定性投影（capability 名下挂 test/api/db_schema/graph 事实）+ 冲突即报进 health 不投影 + cecelia 仓自贴 OWNERS 样板 + `/map` Level-2 声明驱动渲染 + 逻辑守卫单测先红后绿。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] cecelia 样板 OWNERS 声明文件存在且声明 cecelia/MJ5
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/map/OWNERS','utf8');if(!/capability:\s*cecelia\/MJ5/.test(c))process.exit(1)"

- [ ] [ARTIFACT] owners 扫描器脚本存在（写 kind=owners 事实）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('scripts/scan/scan-owners.mjs'))process.exit(1)"

- [ ] [ARTIFACT] OWNERS 声明解析/归属决议模块存在（含 conflict/scope/validity 逻辑）
  Test: node -e "const cp=require('child_process');const o=cp.execSync('git ls-files packages/brain/src').toString();if(!/owners/i.test(o))process.exit(1)"

- [ ] [ARTIFACT] 冲突投影集成测试存在（真 PG，proven-to-fire）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('sprints/08152300-owners-mapping-layer/tests/owners-projection-conflict.integration.test.ts'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，测活 Brain localhost:5221；postgres:false → 全程 curl，不用 attempt 级 psql）

- [ ] [BEHAVIOR] [L2] B-01: owners 扫描后 kind=owners 快照可从 /map/health 观测
  动作: 运行 owners 扫描（scan-owners.mjs --scope cecelia），再 GET /api/brain/map/health?scope=cecelia
  预期观察: 响应 owners.snapshot.kind=="owners"、row_count>=1、source_revision 为字符串（照相层新鲜度哨兵已写）
  等待预算: 0s
  留证: health owners.snapshot JSON 输出
  Test: manual:bash -c 'node scripts/scan/scan-owners.mjs --scope cecelia 2>/dev/null || bash scripts/scan/run-all-scans.sh cecelia 2>/dev/null || true; curl -sf localhost:5221/api/brain/map/health?scope=cecelia | jq -e ".owners.snapshot.kind==\"owners\" and (.owners.snapshot.row_count>=1) and (.owners.snapshot.source_revision|type==\"string\")" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: rebuild 后 MJ5 名下出现按 OWNERS 声明归属的 artifact
  动作: POST /api/brain/map/rebuild {scope_key:cecelia}，再 GET /api/brain/map/nodes/MJ5?scope=cecelia
  预期观察: owned_artifacts 非空（>=1）且含 packages/brain/src/map/ 前缀事实（声明驱动，非扫描猜测）
  等待预算: 0s
  留证: nodes/MJ5 owned_artifacts JSON 输出
  Test: manual:bash -c 'curl -sf -X POST localhost:5221/api/brain/map/rebuild -H "Content-Type: application/json" -d "{\"scope_key\":\"cecelia\"}" | jq -e ".rebuilt==true" >/dev/null || { echo FAIL_REBUILD; exit 1; }; curl -sf localhost:5221/api/brain/map/nodes/MJ5?scope=cecelia | jq -e "(.owned_artifacts|length)>=1 and ([.owned_artifacts[].stable_ref]|any(test(\"packages/brain/src/map/\")))" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 投影后 unclaimed_count 相对 rebuild 前严格下降
  动作: rebuild 前后各 GET /api/brain/map/unclaimed?scope=cecelia，比较 unclaimed_count
  预期观察: 样板目录事实被归属后 after < before（无主清单变短）
  等待预算: 0s
  留证: before/after 计数
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/map/unclaimed?scope=cecelia | jq ".unclaimed_count" > /tmp/mj5_before; curl -sf -X POST localhost:5221/api/brain/map/rebuild -H "Content-Type: application/json" -d "{\"scope_key\":\"cecelia\"}" >/dev/null; curl -sf localhost:5221/api/brain/map/unclaimed?scope=cecelia | jq ".unclaimed_count" > /tmp/mj5_after; B=$(cat /tmp/mj5_before); A=$(cat /tmp/mj5_after); [ "$A" -lt "$B" ] || { echo "FAIL before=$B after=$A"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1 [不猜归属]: 无 OWNERS 覆盖的路径投影后仍无主（unclaimed 依旧 > 5000）
  动作: rebuild 后 GET /api/brain/map/unclaimed?scope=cecelia
  预期观察: cecelia 仅贴样板目录 → 绝大多数事实仍无主，unclaimed_count > 5000（照相层永不定归属）
  等待预算: 0s
  留证: unclaimed_count 数值
  Test: manual:bash -c 'curl -sf -X POST localhost:5221/api/brain/map/rebuild -H "Content-Type: application/json" -d "{\"scope_key\":\"cecelia\"}" >/dev/null; U=$(curl -sf localhost:5221/api/brain/map/unclaimed?scope=cecelia | jq ".unclaimed_count"); [ "$U" -gt 5000 ] || { echo "FAIL unclaimed=$U 疑似越权投影"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 [冲突即报]: /map/health 已接线 owners.conflicts 数组与 owners.status（干净样板态 conflicts 为空）
  动作: GET /api/brain/map/health?scope=cecelia
  预期观察: owners.conflicts 为数组类型、owners.status 为字符串（冲突通道已接线）；干净态 conflicts 为空、status=="ok"
  等待预算: 0s
  留证: health.owners JSON
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/map/health?scope=cecelia | jq -e "(.owners.conflicts|type==\"array\") and (.owners.status|type==\"string\")" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: error path — 未知 capability 返 404、缺 scope 返 400
  动作: GET /nodes/UNKNOWN_CAP_ZZZ?scope=cecelia 与 GET /health（缺 scope）
  预期观察: 未知节点返 404（MAP_NODE_NOT_FOUND）；缺 scope 返 400（MAP_SCOPE_REQUIRED），均不 5xx
  等待预算: 0s
  留证: 两次 HTTP 状态码
  Test: manual:bash -c 'curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/map/nodes/UNKNOWN_CAP_ZZZ?scope=cecelia" | grep -qx 404 || { echo FAIL_404; exit 1; }; curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/map/health" | grep -qx 400 || { echo FAIL_400; exit 1; }; echo OK'

## INV 覆盖补充（铁律 → 断言）

- [ ] [BEHAVIOR] [L2] INV-3 [key 合法性] 声明 capability key 不在 active manifest → 进 conflicts 不投影（纯逻辑单测真跑担保红→绿）
  动作: 运行 resolver 单测中 key 合法性用例
  预期观察: 该用例通过（unknown_capability 进 conflicts，assignments 为空）
  等待预算: 0s
  留证: vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/08152300-owners-mapping-layer/tests/owners-declaration-resolver.test.ts -t "manifest 打空" --reporter=basic 2>&1 | grep -qiE "[1] passed|Test Files[[:space:]]+1 passed" || { echo FAIL; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] INV-4 [子覆盖父] 子目录 OWNERS 覆盖父级作用域（纯逻辑单测真跑担保红→绿）
  动作: 运行 resolver 单测中子覆盖父用例
  预期观察: 该用例通过（最深声明生效，父级不重复归属）
  等待预算: 0s
  留证: vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/08152300-owners-mapping-layer/tests/owners-declaration-resolver.test.ts -t "子目录 OWNERS 覆盖父级" --reporter=basic 2>&1 | grep -qiE "[1] passed|Test Files[[:space:]]+1 passed" || { echo FAIL; exit 1; }; echo OK'
- INV-5 [禁平行账本] N/A：本刀不改 journey_step_links / GP 封版 11 要素；由既有 map.test.js + zenithjoy `npm run test:product-map` CI 绿担保。
- INV-6 [planner 分支纪律] N/A：proposer 使用注入的 $PROPOSE_BRANCH，不自行 checkout 业务分支。

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e mac_web Playwright 跑）

- [ ] [BEHAVIOR:E2E:screenshot] evaluator 验收后 /map Level-2 声明驱动渲染截图已存入 ${SPRINT_DIR}/screenshots/
  Screenshots:
    - map-01-initial.png    期望：/map 页正常加载，Level-1/Level-2 结构可见
    - map-02-mj5-level2.png  期望：MJ5 名下 Level-2 出现声明驱动的真实文件路径文本（含 map），非裸 UUID 串
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：截图与描述一致 + 后端 /nodes/MJ5 owned_artifacts 非空交叉验证通过（见 contract-draft.md E2E Step 6b）
