---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在
  Test: `node -e "const t=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!t.includes('# attempt-run 桥接使用说明'))process.exit(1)"`

## Invariant 覆盖

- 分支一致：N/A，本合同不变更 Planner workspace；Proposer 使用服务端签发分支。
- 凭据安全：由 B-02 正负配对断言真实令牌不得出现。
- 日志脱敏：N/A，本次不新增日志或运行时输出。
- 端点鉴权：由 B-02 断言两个既有端点的 `internalAuthOrLoopback` 说明。
- 环境假设：由 B-02 只使用环境变量名称和安全占位符，不写死凭据。
- 真环境验证：N/A，纯文档，无生产接缝行为变更。
- 基线固定：由 B-05 使用 `a3639b56c04e7ced8fa1c1d623efa51ea25666a7` 的 canonical diff 断言。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 中文标题和四主题结构成对验收
  动作: 读取新说明文档并核对标题与四个主题章节
  预期观察: 中文标题及端点、鉴权、角色、payload/回滚主题均存在，英文标题或合并结构不存在
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-01 对应用例
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t "中文标题与四个主题章节完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-02: 端点用途和鉴权安全成对验收
  动作: 核对 POST/GET 用途、attempt-run id、internalAuthOrLoopback 和 Bearer 安全占位符
  预期观察: 正确用途与鉴权均命中，task/session id、远端匿名成功或疑似真实 token 均被拒绝
  等待预算: 0s
  留证: Vitest verbose 输出中的两个筛选用例
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t "POST 与 GET 用途|鉴权说明" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-03: 九角色与三必填字段封闭集合成对验收
  动作: 从文档章节现场解析角色和 payload 字段并同生产源码集合比较
  预期观察: 角色恰九项无重复，必填恰三项且 base_sha 可省略；别名、重复或必填性颠倒被拒绝
  等待预算: 0s
  留证: Vitest verbose 输出中的集合计数与 equality diff
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t "角色白名单现场列举|payload 现场列举" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: 三项失败回滚终态成对验收
  动作: 从文档现场解析 run/session/task 回滚状态
  预期观察: 恰有 run→failed、session→closed、task→cancelled，遗漏或错误状态被拒绝
  等待预算: 0s
  留证: Vitest verbose 输出中的三项数组比较
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t "派发失败现场列举" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-05: 固定基线产品范围与配对总数验收
  动作: 从权威实现基线审计产品 diff，并统计正负 oracle 配对
  预期观察: 产品改动只有目标文档，断言恰为八对十六项；任何代码/其他文档或缺对被拒绝
  等待预算: 0s
  留证: git diff 文件清单与 Vitest 配对计数输出
  Test: manual:bash -c 'test "$(git merge-base a3639b56c04e7ced8fa1c1d623efa51ea25666a7 HEAD)" = a3639b56c04e7ced8fa1c1d623efa51ea25666a7; npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t "唯一产品改动|正负 oracle 成对" --reporter=verbose'

## 断言封闭结论

八对、十六项正负 oracle 已两两配对；每个正向正确事实都有对应错误事实拒绝项。完整测试通过且固定基线产品 diff 精确为目标文档，才可判 done。
