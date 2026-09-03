---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；Sprint 合同产物不计作实现范围。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge-guide.md` 是新增中文 Markdown，具有端点与鉴权、角色白名单、payload、派发失败回滚四个独立二级章节。
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');const hs=[...s.matchAll(/^## (.+)$/gm)].map(x=>x[1]);if(!/[\u4e00-\u9fff]/.test(s)||!['端点与鉴权','角色白名单','payload','派发失败回滚'].every(x=>hs.includes(x)))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 文档覆盖两个端点及鉴权
  动作: 阅读端点与鉴权章节并按说明区分创建、查询、loopback 与宿主/远端调用。
  预期观察: 两个端点用途清楚，宿主/远端必须携带 Bearer token，且没有远端免鉴权表述。
  等待预算: 0s
  留证: Vitest 对应测试输出与命令 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903092212-e4k3vc/tests/attempt-run-bridge-guide.test.ts -t "文档覆盖两个端点及鉴权" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 角色白名单是恰好九项的封闭集合
  动作: 将文档角色清单与生产模块导出的 `ALLOWED_ROLES` 比对。
  预期观察: 九项角色集合完全相等；缺项、多项、`commander` 或 `publisher` 均导致失败。
  等待预算: 0s
  留证: Vitest 集合差异输出与命令 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903092212-e4k3vc/tests/attempt-run-bridge-guide.test.ts -t "角色白名单是恰好九项的封闭集合" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: payload 必填集合严格等于三项
  动作: 解析 payload 章节的必填字段和 `base_sha` 可省略说明。
  预期观察: 必填集合仅为 `sprint_dir/base_repo/branch`，`base_sha` 不在必填集合且明确由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest payload 集合断言输出与命令 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903092212-e4k3vc/tests/attempt-run-bridge-guide.test.ts -t "payload 必填集合严格等于三项" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败回滚终态完整
  动作: 阅读派发失败回滚章节并核对 run、session、task 的终态顺序。
  预期观察: 文档逐字出现 `run→failed/session→closed/task→cancelled`，且无成功态替代串。
  等待预算: 0s
  留证: Vitest 回滚语义断言输出与命令 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903092212-e4k3vc/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚终态完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 实现 diff 仅有一页文档
  动作: 从冻结 implementation baseline 对候选 HEAD 执行封闭 diff 检查。
  预期观察: 排除本 sprint 合同产物后，变更和新增集合都严格等于 `docs/current/attempt-run-bridge-guide.md`。
  等待预算: 0s
  留证: git diff 文件清单与命令 exit code
  Test: manual:bash -c 'set -euo pipefail; BASE_SHA='"'"'1537048ba85b8ff2e713167d941de02b89673a02'"'"'; SPRINT_DIR='"'"'sprints/coding-harness-20260903092212-e4k3vc'"'"'; DOC='"'"'docs/current/attempt-run-bridge-guide.md'"'"'; git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null; CHANGED=$(git diff --name-only --diff-filter=ACMRTUXB "${BASE_SHA}...HEAD" -- . | awk -v prefix="${SPRINT_DIR}/" '"'"'index($0,prefix)!=1'"'"'); [ "$CHANGED" = "$DOC" ] || { echo "FAIL: 非合同变更集合=$CHANGED"; exit 1; }; ADDED=$(git diff --name-only --diff-filter=A "${BASE_SHA}...HEAD" -- . | awk -v prefix="${SPRINT_DIR}/" '"'"'index($0,prefix)!=1'"'"'); [ "$ADDED" = "$DOC" ] || { echo "FAIL: 非合同新增集合=$ADDED"; exit 1; }; echo OK'

## Invariant 映射

- PRD 铁律均不涉及本次纯文档实现路径；统一 N/A：本任务不改代码、调度、DB、CI、凭据或运行环境，且范围 oracle 会拒绝这些路径的任何变更。
- [规则5648] token 只以 `CECELIA_INTERNAL_TOKEN` 环境变量名出现，不含真实凭据。
- [规则5095] 文档明确两个端点使用 `internalAuthOrLoopback`，未声明无鉴权入口。
- [规则f200] 上述 manual oracle 必须由 evaluator 记录真实 exit code；目标解释器为 `npx vitest` 与 `bash`。

## 通过与失败语义

全部 ARTIFACT 与 BEHAVIOR 断言 exit 0 才通过；任一缺项、开放枚举、错误 payload 规则、回滚串错误或范围越界均非零退出并阻塞交付。
