---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 金标集 v0 + LLM 判定器 eval 通过率棘轮进 CI

**范围**: 金标集 v0 fixtures（5 类标注）+ eval 脚本（真跑出通过率）+ 棘轮阈值持久化（单调只升）+ CI eval job 接线 + 4 条纯代码不变量。**不含**：扩 v1、换判定器模型、Dashboard 展示。
**大小**: M
**target_environment**: local_api（postgres=false → node/vitest + 文件核对，无 psql/无 HTTP）

## ARTIFACT 条目

- [ ] [ARTIFACT] eval 主体模块存在且导出契约 API
  Test: node -e "const m=require('node:fs').readFileSync('packages/quality/eval/gold-eval.mjs','utf8');['loadGoldSet','classifyToOutcome','readThreshold','applyRatchet','memoizeClassify','lintSkillContracts','runEval'].forEach(n=>{if(!m.includes(n))process.exit(1)})"
  期望: exit 0

- [ ] [ARTIFACT] eval CLI 入口存在
  Test: node -e "require('node:fs').accessSync('packages/quality/eval/run-eval.mjs')"
  期望: exit 0

- [ ] [ARTIFACT] 金标集 v0 fixtures manifest 存在且五类标注齐全
  Test: node -e "const m=JSON.parse(require('node:fs').readFileSync('packages/quality/eval/fixtures/gold-set-v0/manifest.json','utf8'));if(m.items.length!==5)process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 棘轮阈值文件存在且为数字
  Test: node -e "const t=JSON.parse(require('node:fs').readFileSync('packages/quality/eval/ratchet-threshold.json','utf8'));if(typeof t.pass_rate_threshold!=='number')process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] skill-contracts.json fixture 存在（契约完备性 lint 数据源）
  Test: node -e "const c=JSON.parse(require('node:fs').readFileSync('packages/quality/eval/skill-contracts.json','utf8'));if(!Array.isArray(c)||c.length<1)process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，[L2] 服务端真验；postgres=false 无 psql，全部 node/vitest 实测）

- [ ] [BEHAVIOR] [L2] B-01: 金标集 v0 加载五类标注（用户列表页=true 其余=false）
  动作: 跑冻结契约测试中金标集加载用例
  预期观察: 5 条标注齐全，g1-user-list=true，其余四类=false
  等待预算: 0s
  留证: vitest 输出末 5 行进 log_tail
  Test: manual:bash -c 'npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t "返回 5 类标注" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: 判定器逐条判读算出真实通过率（INV-1 真时钟 / INV-3 实跑）
  动作: 从仓库根真跑 node packages/quality/eval/run-eval.mjs 读 stdout JSON
  预期观察: total=5，pass_rate 为 [0,1] 实数，keys 完整（gate/items/pass_rate/passed/ratcheted/threshold/total）
  等待预算: 30s
  留证: run-eval stdout JSON 进 evidence
  Test: manual:bash -c 'OUT=$(node packages/quality/eval/run-eval.mjs); echo "$OUT" | jq -e ".total==5 and (.pass_rate|type==\"number\") and (.pass_rate>=0) and (.pass_rate<=1)" && echo "$OUT" | jq -e "keys==[\"gate\",\"items\",\"pass_rate\",\"passed\",\"ratcheted\",\"threshold\",\"total\"]"'

- [ ] [BEHAVIOR] [L2] B-03: 棘轮不许降——阈值高于通过率时 eval 非零退出（INV-2 不写死环境）
  动作: 读当前 pass_rate，用 EVAL_THRESHOLD_OVERRIDE 抬到其上再跑 eval
  预期观察: eval 退出码非 0（棘轮拒绝降级）
  等待预算: 30s
  留证: 退出码 + gate=fail JSON 进 log_tail
  Test: manual:bash -c 'PR=$(node packages/quality/eval/run-eval.mjs | jq -r ".pass_rate"); OVER=$(node -e "console.log(Number(process.argv[1])+0.01)" "$PR"); EVAL_THRESHOLD_OVERRIDE="$OVER" node packages/quality/eval/run-eval.mjs; test $? -ne 0'

- [ ] [BEHAVIOR] [L2] B-04: 视觉 null 必 fail-closed（不当 pass 放行）
  动作: 跑 fail-closed 冻结用例（classifyToOutcome null + 真实 arbitrateContractAppeal 非布尔→null + runEval null 计失败）
  预期观察: null 判 fail 且 failClosed=true，真实判定器非布尔返回 upheld===null
  等待预算: 0s
  留证: vitest 输出进 log_tail
  Test: manual:bash -c 'npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t "fail-closed" --reporter=basic && npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t "计入失败率而非放行" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: 缓存命中零视觉调用（防成本回归，调用计数==0）
  动作: 跑 memoizeClassify 缓存命中冻结用例，同 id 二次判读
  预期观察: 底层判定器第二次零调用（calls 保持 1）
  等待预算: 0s
  留证: vitest 输出进 log_tail
  Test: manual:bash -c 'npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t "缓存命中" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-06: 空金标集防假绿——eval 非零退出
  动作: 指向仅含空 items 的临时 fixtures 目录跑 eval
  预期观察: eval 退出码非 0（gold_set_empty）
  等待预算: 15s
  留证: 退出码进 log_tail
  Test: manual:bash -c 'D=$(mktemp -d); echo "{\"version\":\"v0\",\"items\":[]}" > "$D/manifest.json"; EVAL_FIXTURES_DIR="$D" node packages/quality/eval/run-eval.mjs; RC=$?; rm -rf "$D"; test $RC -ne 0'

- [ ] [BEHAVIOR] [L2] B-07: 契约完备性 lint——缺 pre/post/side_effects 即 fail
  动作: 跑 lintSkillContracts 冻结用例 + 仓库 skill-contracts.json fixture lint 全绿
  预期观察: 缺任一字段判 ok=false 列出 missing；仓库 fixture lint 全绿
  等待预算: 0s
  留证: vitest 输出进 log_tail
  Test: manual:bash -c 'npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t "lintSkillContracts" --reporter=basic && npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t "fixture lint 全绿" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-08: CI eval job 已接线（防「有脚本没接 CI」假绿）
  动作: node 解析 .github/workflows 全部 yaml，查是否有 run 步骤执行 run-eval.mjs
  预期观察: 至少一个 workflow 真实执行 eval 入口
  等待预算: 0s
  留证: 命中 workflow 文件名进 log_tail
  Test: manual:bash -c 'node -e "const fs=require(\"fs\"),d=process.cwd()+\"/.github/workflows/\";const files=fs.readdirSync(d).filter(f=>/\\.ya?ml$/.test(f));const hit=files.filter(f=>fs.readFileSync(d+f,\"utf8\").includes(\"run-eval.mjs\"));if(!hit.length)process.exit(1);console.log(\"eval job wired in:\"+hit.join(\",\"))"'

## Invariant 覆盖（铁律映射，Step 1.3）

- INV-1 [真环境done]：eval 为真跑出通过率的可执行时钟 → 由 B-02 覆盖
- INV-2 [禁写死环境]：阈值/fixtures 参数化不写死 → 由 B-03/B-06 覆盖
- INV-3 [验证实跑]：全部 BEHAVIOR 命令实跑确认 exit code（已本地实跑确认 RED）
- INV-6 [凭据安全/日志脱敏]：eval 离线运行不落 API key，stdout JSON 无凭据字段 → 由 B-02 输出核对
- INV-4 [Red精确add] / INV-5 [禁自merge] / [单slot串行] / [多租户]/[租户隔离]/[端点鉴权]：N/A — 本 sprint 无并发调度/租户/HTTP 端点改动，Red commit 只精确 add tests 路径，merge 交 CI 兜底
