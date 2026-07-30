---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Draft PR #4457 累计冲突与 CodeQL 收敛

**范围**: 仅既有 PR #4457；不新建 PR、不 merge、不 deploy。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 33 路径 oracle manifest 的 schema、不可变 ID、完整 argv/观察与语义哈希精确匹配合同。
  gate-allow: weak-oracle/file-existence-only 此命令读取 JSON 后校验 schema、33 个唯一 path/ID、每行 argv/观察与冻结语义 SHA-256，非仅存在性检查。
  Test: node -e "const fs=require('fs'),c=require('crypto'),p='sprints/07301245-kernel-pr4457-refresh/conflict-oracle-manifest.json',x=JSON.parse(fs.readFileSync(p,'utf8')),sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;x.subjects.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const ids=x.subjects.map(v=>v.oracle_id),paths=x.subjects.map(v=>v.path),h=c.createHash('sha256').update(JSON.stringify(sort(x))).digest('hex');if(x.schema_version!==1||paths.length!==33||new Set(paths).size!==33||new Set(ids).size!==33||ids.slice().sort().join(',')!==Array.from({length:33},(_,i)=>'C'+String(i+1).padStart(2,'0')).join(',')||x.subjects.some(v=>v.stage!=='generator-pre-push'||!v.cwd||!Array.isArray(v.argv)||!v.argv.length||!v.expected_observation.includes('exit_code=0'))||h!=='ed69d150c7e7f0ae4e5b759964e7cbbb4f35ee489ad3e5e62ae5cb114133bb01')process.exit(1)"
- [ ] [ARTIFACT] evidence 内容通过 schema、冻结 SHA/ID/digest、33/77/3 exact subject sets，并由四个 actor/time boundary 执法七个 phase。
  Test: bash -c 'set -euo pipefail; V=sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs; E=sprints/07301245-kernel-pr4457-refresh/evidence; node "$V" review-gate --stage controller-review-gate --exact-head-receipt "$E/exact-head-receipt.json" --evaluator-receipt "$E/evaluator-receipt.json" --audit-end "$E/audit-end.json"'

## 阶段负向合同

既有 8 个 `it()` 用例内必须隔离覆盖错误 stage、错误 actor role、缺 prerequisite receipt、伪造 exit/log、digest mismatch、跨阶段 lineage reuse 与倒序 receipt 时间戳。每个负向断言必须同时要求非零退出和稳定错误码 `ERR_STAGE_MISMATCH`、`ERR_ACTOR_ROLE`、`ERR_PREREQUISITE_RECEIPT`、`ERR_EVIDENCE_FABRICATED`、`ERR_DIGEST_MISMATCH`、`ERR_LINEAGE_REUSE` 或 `ERR_CHRONOLOGY_REVERSED`；缺 verifier 文件或 Node 加载失败不得算通过。`exact-head-receipt.json` 只能由 CI runner 在只读 verifier exit=0 且 stdout/evidence digest、3 个 required check-run、final-head CodeQL、final SHA、CI lineage 全匹配后签名产出；verifier 不写任何 receipt。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 冻结身份与全部 subject 精确匹配 [接缝×2]
  动作: 真读三个 Git commit、merge-tree、check-run annotations 与 branch protection 后运行 freeze verifier
  预期观察: stdout/evidence 逐项枚举 33 个冲突路径、77 条 annotation subject key、三个 required-check subject，并 exact-set 匹配冻结身份与 hash
  等待预算: 120s
  留证: `evidence/freeze.json`、`codeql-freeze.json`、原始 API URL 与 stdout
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs freeze --stage generator-pre-push'

- [ ] [BEHAVIOR] [L2] B-02: 全部 33 个冲突路径完成内容与行为验证
  动作: 整合冻结 main，逐行执行 conflict ledger 指定的真实模块 oracle，再运行 conflicts verifier
  预期观察: 33 个 path 各自输出三方/final blob、处置、真实 oracle argv/exit_code；集合 exact-set 相等，32 content 加 1 modify/delete，无 unresolved
  等待预算: 900s
  留证: `evidence/conflict-resolution.json`、每路径 argv/exit_code/log_tail
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs conflicts --stage generator-pre-push'

- [ ] [BEHAVIOR] [L3] B-03: 全部 77 条 CodeQL annotation 收敛 [接缝×2]
  动作: generator-pre-push 对 check-run 90774353140 的 77 个 subject key 逐条分类处置；final-head 重查留给 ci-exact-head
  预期观察: 77 个 subject 各自输出 path/line/rule/severity/disposition；7 critical、59 high、11 medium 全部唯一覆盖，无 unclassified/dismissed/扫描缩小，且本阶段不伪造 final-head 结果
  等待预算: 1800s
  留证: `evidence/codeql-disposition.json`、final CodeQL URL 与 stdout
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs codeql --stage generator-pre-push'

- [ ] [BEHAVIOR] [L2] B-04: 累计 Kernel Harness 行为与 atomic truth 保持
  动作: 运行 QuickCheck、node:test 双登记、OKR cecelia_test、migration 369-381、上一轮 blocker 与冲突表内全部行为 oracle
  预期观察: 33 个 conflict subject 对应的行为 oracle及命名回归均由真实解释器执行且 exit 0；atomic truth 保持 true/false/false/0/99
  等待预算: 1200s
  留证: `evidence/regressions.json` 的 argv/interpreter/exit_code/log_tail
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs regressions --stage generator-pre-push'

- [ ] [BEHAVIOR] [L3] B-05: 三个 required checks 绑定同一最终 SHA [接缝×2]
  动作: CI 在最终 push receipt 后等待三个 exact context 终态，同时重查 final-head CodeQL，再以 ci-exact-head stage 运行 verifier
  预期观察: push receipt SHA 等于 CI head；strict=true，三个 context 均 SUCCESS；final-head CodeQL 无冻结 unresolved subject；只读 verifier exit=0 后仅由 CI runner 核对 stdout/evidence digest、final SHA 与 CI lineage并签名输出 exact-head receipt
  等待预算: 1800s
  留证: `evidence/exact-head.json`、check-run URL 与 final SHA
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs exact-head --stage ci-exact-head --receipt sprints/07301245-kernel-pr4457-refresh/evidence/push-receipt.json'

- [ ] [BEHAVIOR] [L3] B-06: evaluator 在同一最终 SHA 真跑 [接缝×2]
  动作: 独立 evaluator 在 exact-head SUCCESS 后执行合同并产出 receipt；只读 verifier 验证，不得自建 receipt
  预期观察: evaluator lineage 独立且 role/stage 正确；顶层及每条 behavior 都含真实 argv/exit_code/log_tail 且为 0，所有 evidence_sha 等于 final head
  等待预算: 1800s
  留证: `evidence/evaluator.json` 与 behavior_tests log tail
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs evaluator --stage evaluator-receipt --receipt sprints/07301245-kernel-pr4457-refresh/evidence/evaluator-receipt.json'

- [ ] [BEHAVIOR] [L3] B-07: 审计窗内无新 PR 无 merge 无 deploy [接缝×2]
  动作: controller 在 exact-head/evaluator receipt 与 audit-end 齐备后运行只读 review-gate，按闭区间分页真读 PR/merge/auto-merge/deployments
  预期观察: 机械满足 audit_start <= generator evidence <= push < exact-head < evaluator <= audit_end；receipt prerequisite/evidence/stdout digest 链、actor role、stage、唯一 final SHA 和各阶段动态 lineage exact-match 且无跨阶段复用；#4457 仍 Draft OPEN；main 不含 final head；归因的新 PR、merge、auto-merge、deployment 均为 0
  等待预算: 120s
  留证: `evidence/audit-baseline.json`、`audit-end.json`、原始分页响应摘要
  Test: manual:bash -c 'node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs review-gate --stage controller-review-gate --exact-head-receipt sprints/07301245-kernel-pr4457-refresh/evidence/exact-head-receipt.json --evaluator-receipt sprints/07301245-kernel-pr4457-refresh/evidence/evaluator-receipt.json --audit-end sprints/07301245-kernel-pr4457-refresh/evidence/audit-end.json'

## Invariant 映射

- INV-01 agents 列名：N/A，不触达 agents 表。
- INV-02 status 枚举：适用；冲突若改状态值须全仓枚举回归。
- INV-03 watchdog orphan：N/A，不改该状态机。
- INV-04 通知语义字段：适用；若冲突触达通知必须断言 sent/accepted。
- INV-05 dep-audit：适用；先核 `fixAvailable`，禁止白名单。
- INV-06 relay 心跳：适用；长 CI 等待持续 heartbeat。
- INV-07 测试毕业门：适用；真跑 lint-tdd-commit-order/check-test-coverage。
- INV-08 manual exit code/解释器：适用；逐项留证。
- INV-09 manual node expansion：适用；逐条真跑。
- INV-10/11/21/41/46 smoke 铁律：适用；QuickCheck/smoke 真跑。
- INV-12/13/14 扫描周期/付费去重/时间常数：N/A，不新增对应设计。
- INV-15 theater/Android：N/A，本任务 local_api。
- INV-16 target_environment payload：适用，固定 local_api。
- INV-17 judge receipt shape：适用，顶层和逐行为均含 exit_code/log_tail。
- INV-18 DB varchar：N/A，不新增 DB 写入。
- INV-19 复活退役功能：N/A。
- INV-20 false/null 失败分支：适用，冲突触达时保留显式失败。
- INV-22 journey_features stale：N/A。
- INV-23 controller report 闸：适用，不只看 worker exit 0。
- INV-24 host 白名单：N/A。
- INV-25 headed payload/分支：适用，只用既有 PR 分支。
- INV-26 退役数据：N/A。
- INV-27 catch 吞错：适用，触达后台 job 时保留失败指标。
- INV-28/29 表写入方/新 job 消费方：N/A。
- INV-30 多设备 UI：N/A。
- INV-31 git_sha unknown：适用，exact-head/终验同一策略。
- INV-32 rev-parse：适用，使用 `--verify <ref>^{commit}`。
- INV-33 真实 worktree生产资源：适用，禁止 deploy/tag 副作用。
- INV-34/35 部署失败/生产自报：N/A，本 sprint 禁 deploy。
- INV-36 lint-test-quality await：适用。
- INV-37 Test Contract 四列：适用。
- INV-38 Red 精确 add：适用。
- INV-39 source inspection：适用，但源码字符串不能替代行为 oracle。
- INV-40 scheduler SSOT：N/A。
- INV-42 generator 禁 merge：适用。
- INV-43 shell 环境继承：适用，参数显式传入。
- INV-44 历史合同核实：适用，本轮采用 controller machine facts。
- INV-45 共享 CI 默认禁区：适用，仅冻结冲突/真实 CodeQL 所需可改。
- INV-47 brain smoke：适用，触达 brain/src 时 smoke 必跑。
- INV-48 task_type 七点：N/A。
- INV-49/50/51 宿主服务：N/A。
- INV-52 单 slot 串行：适用，单 ws1 写入。
- INV-53 禁写死环境假设：适用，动态 PR/CI 真读。
- INV-54 真环境才 done：适用，GitHub/CodeQL/CI 真验。
- INV-55 多租户：N/A，不触达租户数据。
- INV-56 凭据安全：适用，token 不进 git/log。
- INV-57 日志脱敏：适用。
- INV-58 API 鉴权：N/A，不新增端点。
- INV-59 租户隔离：N/A。
