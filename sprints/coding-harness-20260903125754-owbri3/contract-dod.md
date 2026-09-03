---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；Sprint 合同产物除外。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文 Markdown 文档具有标题和四个独立二级章节
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['# attempt-run 桥接使用说明','## 端点与鉴权','## 角色白名单','## payload 字段','## 派发失败自动回滚'])if(!s.includes(x))process.exit(1);if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 实现差异严格等于唯一新增文档
  Test: bash -c 'set -euo pipefail; BASE_SHA='"'"'b99c580d7fe8ca4cbf0ee834e13c91df02b57369'"'"'; SPRINT_DIR='"'"'sprints/coding-harness-20260903125754-owbri3'"'"'; EXPECTED='"'"'docs/current/attempt-run-bridge-guide.md'"'"'; ACTUAL=$(git diff --name-only "${BASE_SHA}...HEAD" -- | grep -v "^${SPRINT_DIR}/" | sort); [ "$ACTUAL" = "$EXPECTED" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者可区分创建、查询与远端鉴权
  动作: 阅读“端点与鉴权”节并核对两个端点、用途和 Bearer 要求。
  预期观察: POST 被说明为创建，GET 被说明为按 id 查询；宿主或远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，且没有免鉴权误导。
  等待预算: 0s
  留证: Vitest“端点与鉴权正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "端点与鉴权正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单是恰好九项的封闭集合
  动作: 逐项读取“角色白名单”并与生产 `ALLOWED_ROLES` 比对。
  预期观察: 清单不多不少恰为九个唯一角色；增加、删除或重复任一角色均被拒绝。
  等待预算: 0s
  留证: Vitest“九项角色封闭集合正负 oracle”集合差异输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "九项角色封闭集合正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填集合严格等于三项
  动作: 按“payload 字段”节组装请求字段。
  预期观察: 仅 `sprint_dir`、`base_repo`、`branch` 标为必填；`base_sha` 标为可省略且由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest“payload 字段正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "payload 字段正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚终态完整且不可替换
  动作: 阅读“派发失败自动回滚”节并核对四对象终态链。
  预期观察: 文档逐字给出 `run→failed/session→closed/task→cancelled`；把任一终态替换成成功或活跃态均失败。
  等待预算: 0s
  留证: Vitest“失败回滚正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "失败回滚正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-05: 中文说明包含四个可定位章节
  动作: 打开新文档并按二级标题定位四类信息。
  预期观察: 中文正文和四节均存在；任一标题改名或缺失均失败。
  等待预算: 0s
  留证: Vitest“中文文档与四节正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "中文文档与四节正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-06: 产品实现范围严格只有一页新增文档
  动作: 从冻结实现基线计算 HEAD 差异，并排除本 Sprint 合同产物。
  预期观察: 差异集合逐字等于 `docs/current/attempt-run-bridge-guide.md`；空集合或加入任何代码、测试、配置、既有文档均失败。
  等待预算: 0s
  留证: Vitest“实现 diff 仅有一页文档正负 oracle”输出及 git diff 清单
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "实现 diff 仅有一页文档正负 oracle" --reporter=verbose'

## Invariant 映射

- [ ] INV-1 端点鉴权：文档明确两端点使用 `internalAuthOrLoopback`，宿主/远端必须携带 Bearer。Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('internalAuthOrLoopback')||!s.includes('Bearer CECELIA_INTERNAL_TOKEN'))process.exit(1)"
- [ ] INV-2 凭据安全：仅出现环境变量名，不出现疑似真实 Bearer 值。Test: bash -c '! git diff b99c580d7fe8ca4cbf0ee834e13c91df02b57369...HEAD -- docs/current/attempt-run-bridge-guide.md | grep -E "Bearer[[:space:]]+[A-Za-z0-9_./+=-]{24,}"'
- [ ] INV-3 禁止写死：N/A，本任务只记录生产契约字面值，不新增环境坐标或运行假设。
- [ ] INV-4 真环境验证：N/A，纯文档交付，不修改或声称验证运行接缝。
- [ ] INV-5 Planner 分支：N/A，本角色在服务端签发的 proposer 分支，未修改 Planner 分支。
