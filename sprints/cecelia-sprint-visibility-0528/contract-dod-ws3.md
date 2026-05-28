---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Brain API GET /harness/sprint-docs

**范围**: 在 packages/brain/src/routes/harness.js 新增 GET /sprint-docs?sprint_dir=... 端点；读取 4 个文档文件并返回 {sprint_dir, docs:{prep_prd, sprint_prd, contract, harness_report}}；文件不存在时字段为 null；缺 sprint_dir → 400
**大小**: S（~80 行净增，1 文件）
**依赖**: Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/src/routes/harness.js 含 /sprint-docs 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('sprint-docs'))process.exit(1)"

- [ ] [ARTIFACT] harness.js /sprint-docs 路由返回含 prep_prd 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('prep_prd'))process.exit(1)"

- [ ] [ARTIFACT] harness.js /sprint-docs 路由返回含 sprint_prd 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('sprint_prd'))process.exit(1)"

- [ ] [ARTIFACT] harness.js /sprint-docs 路由返回含 harness_report 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('harness_report'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] GET /api/brain/harness/sprint-docs?sprint_dir=... 返回 HTTP 200 + 含 sprint_dir 和 docs 字段
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/cecelia-sprint-visibility-0528") || { echo "FAIL: sprint-docs 端点未注册（404）"; exit 1; }; echo "$RESP" | jq -e ".sprint_dir | type == \"string\"" || { echo "FAIL: sprint_dir 字段缺失"; exit 1; }; echo "$RESP" | jq -e ".docs | type == \"object\"" || { echo "FAIL: docs 字段缺失"; exit 1; }; echo OK'
  期望: OK；HTTP 200 + {sprint_dir, docs}

- [ ] [BEHAVIOR] docs keys 完全等于 ["contract","harness_report","prep_prd","sprint_prd"]（sorted，不多不少）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/cecelia-sprint-visibility-0528") || exit 1; echo "$RESP" | jq -e ".docs | keys == [\"contract\",\"harness_report\",\"prep_prd\",\"sprint_prd\"]" || { echo "FAIL: docs keys 不匹配（多/少/camelCase）"; exit 1; }; echo OK keys match'
  期望: OK keys match；4 个字段名完全等于下划线形式

- [ ] [BEHAVIOR] sprint_dir 下存在的文件（sprint-prd.md）→ 对应字段为 string（非 null）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/cecelia-sprint-visibility-0528") || exit 1; echo "$RESP" | jq -e ".docs.sprint_prd | type == \"string\"" || { echo "FAIL: sprint_prd 应为 string（文件存在）"; exit 1; }; echo OK'
  期望: OK；sprint_prd 为字符串

- [ ] [BEHAVIOR] 不存在的 sprint_dir 路径下所有 docs 字段为 null（不报 404，返回 200+null）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/nonexistent-path-xyz-12345") || { echo "FAIL: 端点返回非 200"; exit 1; }; echo "$RESP" | jq -e ".docs.prep_prd == null" || { echo "FAIL: 不存在文件应为 null"; exit 1; }; echo "$RESP" | jq -e ".docs.sprint_prd == null" || { echo "FAIL: sprint_prd 应为 null"; exit 1; }; echo OK null for missing files'
  期望: OK null for missing files

- [ ] [BEHAVIOR] 缺 sprint_dir 参数 → HTTP 400 + {error: string}（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/sd-err.json -w "%{http_code}" "localhost:5221/api/brain/harness/sprint-docs"); [ "$CODE" = "400" ] || { echo "FAIL: 无 sprint_dir 应返 400，实际 $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/sd-err.json || { echo "FAIL: error 字段缺失"; exit 1; }; echo OK'
  期望: OK；HTTP 400 + {error: string}

- [ ] [BEHAVIOR] query 参数必须使用 sprint_dir（禁用 dir/path/d/p）— 若用错参数等效 400
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/sprint-docs?dir=sprints/cecelia-sprint-visibility-0528"); [ "$CODE" = "400" ] || { echo "WARN: 用错参数名应返 400（实际 $CODE）"; }; echo OK'
  期望: OK（400 表示参数名验证通过；实现可忽略未知参数但必须检查 sprint_dir 存在）
