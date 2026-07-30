---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Draft PR #4457 累计冲突与 CodeQL 收敛

**范围**: 仅既有 PR #4457；不新建 PR、不 merge、不 deploy。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `evidence/freeze.json` 含冻结 SHA、32 冲突、77 CodeQL fingerprint 与 required checks。
  Test: node -e "const x=require('./sprints/07301245-kernel-pr4457-refresh/evidence/freeze.json');if(x.start_sha!=='8f2137d0f5ad7091699f42635ea76c35e0765bd9'||x.main_sha!=='264482fadd87dc8bf6e7d4534c156ee28e276ccf'||x.conflicts.length!==32||x.codeql.length!==77)process.exit(1)"
- [ ] [ARTIFACT] `evidence/conflict-resolution.json`、`codeql-disposition.json`、`exact-head.json`、`evaluator.json` 均存在且绑定 SHA。
  Test: node -e "const fs=require('fs');for(const f of ['conflict-resolution.json','codeql-disposition.json','exact-head.json','evaluator.json'])JSON.parse(fs.readFileSync('sprints/07301245-kernel-pr4457-refresh/evidence/'+f,'utf8'))"
- [ ] [ARTIFACT] verifier 与 Red/Green 证据脚本存在。
  Test: node -e "const fs=require('fs');const p='sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs';if(!fs.readFileSync(p,'utf8').includes('verify'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 冻结清单精确绑定起点与计数 [接缝×2]
  动作: 从真实 git object 与冻结 CodeQL run/SARIF 生成清单，并执行 freeze verifier
  预期观察: 两个冻结 SHA 精确匹配，32 个冲突与 77 个告警均唯一；当前 33/761 差异不会被静默接受，且差异存在时后续 phase 被阻断
  等待预算: 60s
  留证: `evidence/freeze.json` 与 verifier stdout
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs freeze && jq -e ".freeze_approved==true and (.conflicts|length==32)" sprints/07301245-kernel-pr4457-refresh/evidence/freeze.json'

- [ ] [BEHAVIOR] [L2] B-02: 冲突处置与累计行为证明完整
  动作: 在既有分支整合冻结 main 后执行 conflicts verifier 及冻结回归命令
  预期观察: 32 项各有唯一处置，QuickCheck、node:test 双登记、OKR cecelia_test、migration 369-381 与四项 blocker oracle 均 exit 0
  等待预算: 300s
  留证: `evidence/conflict-resolution.json` 与逐命令 exit code/log tail
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs conflicts'

- [ ] [BEHAVIOR] [L3] B-03: 77 个 CodeQL 告警逐项收敛 [接缝×2]
  动作: 下载冻结 CodeQL 原始结果并执行 codeql verifier
  预期观察: 77 个 fingerprint 唯一分类处置，无未分类、dismiss 或扫描范围缩小
  等待预算: 120s
  留证: `evidence/codeql-disposition.json`、原始 run URL 与 verifier stdout
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs codeql'

- [ ] [BEHAVIOR] [L2] B-04: atomic truth 与安全不变量保持
  动作: 对最终 diff、truth 证据和门禁配置执行 invariants verifier
  预期观察: atomic truth 仍为 true/false/false/0/99，且禁止项计数为零
  等待预算: 30s
  留证: `evidence/atomic-truth.json` 与 verifier stdout
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs invariants'

- [ ] [BEHAVIOR] [L3] B-05: required checks 全部绑定最终 SHA [接缝×2]
  动作: 从 GitHub 读取 PR 最终 head 与 required checks 后执行 exact-head verifier
  预期观察: 所有 required check 的 headSha 等于最终 head，missing/failed/stale 均为零
  等待预算: 1800s
  留证: `evidence/exact-head.json`、check URLs 与最终 SHA
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs exact-head'

- [ ] [BEHAVIOR] [L3] B-06: evaluator 在同一最终 SHA 真跑 [接缝×2]
  动作: evaluator 在 final SHA 执行全部合同命令并验证标准 judge receipt shape
  预期观察: 顶层和每条 behavior 均含 exit_code/log_tail 且 exit_code=0，证据 SHA 无分叉
  等待预算: 1800s
  留证: `evidence/evaluator.json` 与 behavior_tests log_tail
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs evaluator'

- [ ] [BEHAVIOR] [L3] B-07: PR 始终停在 Draft OPEN 人工审阅门 [接缝×2]
  动作: 从 GitHub 真读 PR #4457 状态并执行 review-gate verifier
  预期观察: PR 仍 Draft、OPEN、autoMerge=null、原 head branch；没有新 PR、merge 或 deploy
  等待预算: 60s
  留证: GitHub PR JSON、审计事件与 verifier stdout
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs review-gate'

## Invariant 映射

- INV-01 真实 agents 列名：N/A，本 sprint 不新增或修改 agents 表字段；若冲突触达相关 SQL，先以真实 schema 验证。
- INV-02 status 枚举全仓复查：适用，冲突处置 verifier 必须对状态枚举 diff 做全仓回归。
- INV-03 watchdog orphan 恢复：N/A，不改该状态机。
- INV-04 通知语义字段：N/A，不改通知/写库成功判定。
- INV-05 dep-audit advisory：适用，真实 advisory 先核对 fixAvailable，禁白名单绕过。
- INV-06 headed relay 心跳：适用，长 CI 等待必须维持 relay heartbeat。
- INV-07 测试毕业门：适用，rename 后真实运行 lint-tdd-commit-order 与 check-test-coverage。
- INV-08 manual oracle exit code/解释器：适用，evaluator receipt 强制逐项记录。
- INV-09 manual node shell expansion：适用，每条命令真跑，禁止只 bash -n。
- INV-10/11/21/41/46 smoke 铁律：适用，冻结 smoke/QuickCheck 回归必须真实通过。
- INV-12 多轮扫描真实时间：N/A，本 sprint 不设计扫描状态机。
- INV-13 外部付费调用去重：N/A，不新增付费调用。
- INV-14 跨模块时间常数：N/A，不新增时间常数。
- INV-15 theater/Android 路由：N/A，本 sprint 明确 local_api 且不含 Android 能力。
- INV-16 target_environment payload：适用，固定 local_api 并由 evaluator 核对。
- INV-17 Brain judge receipt shape：适用，顶层及每条 behavior 均含 exit_code/log_tail。
- INV-18 DB varchar 截断：N/A，不新增 DB 写路径。
- INV-19 复活退役功能查历史：N/A，不复活功能。
- INV-20 false/null 失败分支：适用，冲突中若触达此契约必须保留显式失败处理。
- INV-22 journey_features stale：N/A，不改 report/ability 收账。
- INV-23 controller report 闸：适用，evaluator/judge 证据不得只看 worker exit 0。
- INV-24 host 白名单 headed 场景：N/A，不改 host 白名单。
- INV-25 headed payload/分支命名：适用，既有 PR branch 固定且不可新建 PR。
- INV-26 退役数据实锤：N/A，不做退役。
- INV-27 catch 吞错计数：适用，若冲突触达后台 job 必须保持失败指标。
- INV-28 表名写入方认领：N/A，不建表。
- INV-29 新后台 job 消费方：N/A，不新增 job。
- INV-30 多设备类型/UI：N/A，不新增设备展示字段。
- INV-31 git_sha unknown 语义一致：适用，exact-head 与终验对同一 SHA fail-closed。
- INV-32 rev-parse verify commit：适用，所有 ref 检查使用 `--verify <ref>^{commit}`。
- INV-33 真实 worktree 生产资源：适用，回归不得触碰 deploy/tag/生产状态。
- INV-34 部署失败禁 warning：N/A，本 sprint 禁 deploy。
- INV-35 生产实体自报：N/A，不做部署判变。
- INV-36 lint-test-quality await：适用，新增测试按仓库质量门约束。
- INV-37 Test Contract 四列：适用，contract-draft 已使用固定四列。
- INV-38 Red commit 精确 add：适用，只提交 sprint tests 与合同精确路径。
- INV-39 调度接线 source inspection：N/A，本 sprint 不新增调度接线，且行为验收不得用文本自证替代真实回归。
- INV-40 scheduler jobs SSOT：N/A，不新增 cron。
- INV-42 generator 禁 merge：适用，生成器仅更新既有分支，merge 权不在 generator。
- INV-43 headed shell 环境继承：适用，所有必要上下文通过显式参数/evidence，不假设继承。
- INV-44 历史合同需核真实派发：适用，本合同已真读 PR #4457 当前状态并记录差异。
- INV-45 共享 CI 文件默认禁区：适用，只有冻结冲突/真实 CodeQL 所需才可改，集成者串行收口。
- INV-47 feat+brain smoke：适用，若最终改 Brain src，smoke 与 allowlist 登记必须同时满足。
- INV-48 新 task_type 七点：N/A，不新增 task_type。
- INV-49 服务双信号：N/A，不新增/判断常驻服务。
- INV-50/51 LaunchDaemon/巡检：N/A，不新增宿主服务。
- INV-52 单 slot 串行：适用，本 sprint 一个实现任务，写操作由单一集成者串行。
- INV-53 禁写死环境假设：适用，GitHub/CI 状态均实时读取，不写死动态结论。
- INV-54 真环境验证才 done：适用，GitHub PR/CodeQL/CI 接缝必须真目标验证。
- INV-55 多租户：N/A，不触达租户数据。
- INV-56 凭据安全：适用，GitHub token 仅由环境/gh auth 提供，不写日志或 git。
- INV-57 日志脱敏：适用，evidence 不保存凭据/PII。
- INV-58 端点鉴权：N/A，不新增 API endpoint。
- INV-59 租户隔离：N/A，不触达租户查询或写入。
