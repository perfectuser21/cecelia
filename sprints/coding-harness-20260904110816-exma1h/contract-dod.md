---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于唯一允许路径
  Test: test -f docs/current/attempt-run-bridge-usage.md && grep -q '[一-龥]' docs/current/attempt-run-bridge-usage.md

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 候选范围是封闭单文件集合
  动作: 将 Runner 注入的候选 SHA 与冻结实现基线比较
  预期观察: 排除冻结 Sprint 工件后只新增目标 Markdown 文档
  等待预算: 0s
  留证: `/tmp/attempt-run-scope.txt`
  Test: manual:bash -c 'BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd; CANDIDATE_SHA="${CANDIDATE_SHA:?}"; git diff --name-status --no-renames "$BASE_SHA" "$CANDIDATE_SHA" -- . ":(exclude)sprints/coding-harness-20260904110816-exma1h/**" > /tmp/attempt-run-scope.txt; test "$(wc -l < /tmp/attempt-run-scope.txt | tr -d " ")" -eq 1; grep -Fx $'"'"'A\tdocs/current/attempt-run-bridge-usage.md'"'"' /tmp/attempt-run-scope.txt'

- [ ] [BEHAVIOR] [L2] B-02: 端点鉴权与四节内容完整
  动作: 读取候选目标文档并执行冻结合同测试
  预期观察: 中文、四节、POST/GET、鉴权、payload、回滚全部通过
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "文档四节、中文、端点鉴权、九角色、payload 与回滚映射完整"'

- [ ] [BEHAVIOR] [L2] B-03: 九角色逐项列出后按封闭集合计数
  动作: 解析角色白名单章节的 Markdown 列表
  预期观察: 恰好九项且与生产权威角色逐项同集；缺项、多项、别名均失败
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "角色白名单恰好九项且任何缺项、多项或别名都失败"'

- [ ] [BEHAVIOR] [L2] B-04: 十二个内容 oracle 均有负向 oracle
  动作: 对文档逐一注入端点、鉴权、角色、payload 和回滚错误变体
  预期观察: 12 个错误变体全部被合同校验拒绝
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "每个正向内容 oracle 的对应负向变体都被拒绝"'

- [ ] [BEHAVIOR] [L2] INV-1: 端点鉴权铁律未回退
  动作: 检查说明明确非回环调用必须携带内部 Bearer token
  预期观察: `internalAuthOrLoopback` 与 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 同时存在
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "文档四节、中文、端点鉴权、九角色、payload 与回滚映射完整"'

- [ ] [BEHAVIOR] [L2] INV-2: 分支权威不受本 Sprint 影响
  动作: 对候选相对冻结基线执行 canonical Git 范围检查
  预期观察: 不存在 orchestrator、workspace 或分支逻辑改动
  等待预算: 0s
  留证: `/tmp/attempt-run-scope.txt`
  Test: manual:bash -c 'BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd; CANDIDATE_SHA="${CANDIDATE_SHA:?}"; git diff --name-status --no-renames "$BASE_SHA" "$CANDIDATE_SHA" -- . ":(exclude)sprints/coding-harness-20260904110816-exma1h/**" > /tmp/attempt-run-scope.txt; grep -Fx $'"'"'A\tdocs/current/attempt-run-bridge-usage.md'"'"' /tmp/attempt-run-scope.txt; test "$(wc -l < /tmp/attempt-run-scope.txt | tr -d " ")" -eq 1'

- [ ] [BEHAVIOR] [L2] INV-3: 凭据隔离不受本 Sprint 影响
  动作: 验证唯一产品变更为不含真实凭据的 Markdown 文档
  预期观察: 文档只引用环境变量名，不出现 Bearer token 字面值
  等待预算: 0s
  留证: Node 校验输出
  Test: manual:bash -c 'node -e '"'"'const fs=require("fs");const s=fs.readFileSync("docs/current/attempt-run-bridge-usage.md","utf8");if(!s.includes("$CECELIA_INTERNAL_TOKEN")||/Bearer [A-Za-z0-9_-]{20,}/.test(s))process.exit(1)'"'"''
