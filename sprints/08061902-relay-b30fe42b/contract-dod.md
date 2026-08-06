---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: headed-smoke-test（relay 链路冒烟：smoke-artifact 落地）

**范围**: 仅在 `sprints/08061902-relay-b30fe42b/` 落 `smoke-artifact.json` 一个最小可断言工件 + jq 三字段断言；零产品代码改动（packages/*、apps/* 不动）
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke-artifact.json 存在且含 smoke_tag 字面值
  Test: node -e "const c=require('fs').readFileSync('sprints/08061902-relay-b30fe42b/smoke-artifact.json','utf8');if(!c.includes('claude-headed-dispatch-local-31156-4267'))process.exit(1)"

- [ ] [ARTIFACT] tests/smoke-artifact.test.ts 存在且覆盖三字段断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08061902-relay-b30fe42b/tests/smoke-artifact.test.ts','utf8');if(!(c.includes('task_id')&&c.includes('smoke_tag')&&c.includes('mode')))process.exit(1)"

- [ ] [ARTIFACT] INV-独享路径 合同 E2E 脚本与负向断言使用 mktemp 会话独享路径（无共享 /tmp 固定文件名）
  Test: node -e "const c=require('fs').readFileSync('sprints/08061902-relay-b30fe42b/contract-draft.md','utf8');if(!c.includes('mktemp'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous / target_environment = local_api）

> 本 sprint 无 HTTP/DB（PRD 范围限定禁止新端点与 DB 写入），BEHAVIOR 全部为本地真实文件断言——对真实落盘工件执行，工件未落地时每条必 FAIL（真红自查通过）。

- [ ] [BEHAVIOR] 工件存在且为合法 JSON 顶层对象（Golden Path Step 2 的可观测输出）
  Test: manual:bash -c 'node -e "const o=JSON.parse(require(\"fs\").readFileSync(\"sprints/08061902-relay-b30fe42b/smoke-artifact.json\",\"utf8\"));if(typeof o!==\"object\"||o===null||Array.isArray(o))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] task_id 字段与 task payload 字面相等（Golden Path Step 2）
  Test: manual:bash -c 'jq -e ".task_id == \"b30fe42b-86c7-412e-9e05-eb08ac26488e\"" sprints/08061902-relay-b30fe42b/smoke-artifact.json'
  期望: exit 0

- [ ] [BEHAVIOR] smoke_tag 字段与 payload 值字面相等，含大小写（Golden Path Step 2）
  Test: manual:bash -c 'jq -e ".smoke_tag == \"claude-headed-dispatch-local-31156-4267\"" sprints/08061902-relay-b30fe42b/smoke-artifact.json'
  期望: exit 0

- [ ] [BEHAVIOR] mode 字段字面等于 headed（Golden Path Step 2）
  Test: manual:bash -c 'jq -e ".mode == \"headed\"" sprints/08061902-relay-b30fe42b/smoke-artifact.json'
  期望: exit 0

- [ ] [BEHAVIOR] schema 封闭性——顶层 keys 完全等于预期集合，禁止多塞字段（Golden Path Step 4）
  Test: manual:bash -c 'jq -e "keys == [\"mode\",\"smoke_tag\",\"task_id\"]" sprints/08061902-relay-b30fe42b/smoke-artifact.json'
  期望: exit 0

- [ ] [BEHAVIOR] error path——篡改 smoke_tag 的副本执行同一断言必 FAIL（负向自证防假绿，临时文件走 mktemp 会话独享路径，Golden Path Step 4）
  Test: manual:bash -c 'TMPD=$(mktemp -d "${TMPDIR:-/tmp}/smoke-dod-b30fe42b-XXXXXX"); jq ".smoke_tag = \"tampered\"" sprints/08061902-relay-b30fe42b/smoke-artifact.json > "$TMPD/bad.json"; if jq -e ".smoke_tag == \"claude-headed-dispatch-local-31156-4267\"" "$TMPD/bad.json"; then rm -rf "$TMPD"; exit 1; fi; rm -rf "$TMPD"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 工件随分支 commit 留痕——git 索引可查（Golden Path Step 3）
  Test: manual:bash -c 'git ls-files --error-unmatch sprints/08061902-relay-b30fe42b/smoke-artifact.json >/dev/null && echo OK'
  期望: OK

## 铁律清单 → Invariant 覆盖映射

- [进程兜底] N/A：本 sprint 不启动/管理任何进程，不触及 watchdog 分类逻辑
- [phase回写] N/A：phase-event 回写属 relay 框架既有职责（harness-controller/Brain 侧），本合同交付物为静态工件，不改该路径
- [冲突先解] N/A：不改 PR/CI 处理逻辑；本 sprint PR 若遇 CONFLICTING 按该铁律操作，属流程执行而非合同断言对象
- [建单查重] N/A：不触及 capture_atoms/建单路由
- [自指排除] N/A：不产出守卫/探针统计数据
- [日历窗口] N/A：无时间窗口断言（无 DB 计数，纯字面文件断言，不存在 NOW()-interval 滑动窗）
- [独享路径] 已覆盖：见 ARTIFACT 条目 INV-独享路径 + BEHAVIOR error path 条目命令本体（mktemp 会话独享路径，用后清理）
- [结构核查] N/A：本 sprint 端到端验证成本极低（本地 jq），直接真跑，无需 source-code inspection 旁证
- [DB同源] N/A：零数据库连接（PRD 范围限定禁止 DB 写入）
- [核对列名] N/A：不涉及 agents 表及任何 DB 字段
- [枚举复查] N/A：无 status 枚举断言
- [安全重跑] N/A：不改 watchdog/requeue 逻辑；断言全部幂等，run 重跑安全性由该铁律既有机制保障
