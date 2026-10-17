---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1","02-spec.md#Q-2","02-spec.md#Q-3","02-spec.md#Q-4"]
---
# QA 报告（第 8 轮，环境 http://localhost:5301）

TESTED_HEAD: `52e2106ed03b255f18fa834ff33cf1315944e307`。本轮产品是本地 CLI 与 README 文档，Q-1～Q-3 按合同无需请求预览 API 或打开页面。控制器来源事实仅作阶段身份背景，不作产品证据。

### T-1
对应: Q-1
verdict: PASS
空目录及不存在目录均得到 `[]` 和带实际路径的中文提示；新旧顺序正确，README 断言通过。
```command
set -e
D=$(mktemp -d)
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D/missing" --json
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D/missing"
printf 'CLI退出码=%s\n' "$?"
node -e 'const fs=require("fs"),p=process.argv[1],r=JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}});for(const [n,t] of [["older",1000000000],["newer",1000000100]]){const f=p+"/"+n+".json";fs.writeFileSync(f,r);fs.utimesSync(f,t,t)}' "$D"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json | jq -e 'length==2 and .[0].task_id=="newer" and .[1].task_id=="older" and all(.[];.status=="completed")'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","倒序","不证明服务健康"])if(!s.includes(x))throw Error(x);console.log("README 断言通过")'
```
```output
[]
CLI退出码=0
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.foXX9WUVVL）
CLI退出码=0
[]
CLI退出码=0
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.foXX9WUVVL/missing）
CLI退出码=0
[{"task_id":"newer","mtime":"2001-09-09T01:48:20.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/12","ci_fix":null},{"task_id":"older","mtime":"2001-09-09T01:46:40.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/12","ci_fix":null}]
CLI退出码=0
true
README 断言通过
```
原生命令整体退出码: 0

### T-2
对应: Q-2
verdict: PASS
独立重建九个被扫描文件及一个 cifix 文件；两种输出的状态、原因及本地 ci_fix 摘要符合期望。
```command
set -e
D=$(mktemp -d)
node -e 'const f=require("fs"),d=process.argv[1],w=(n,v)=>f.writeFileSync(d+"/"+n+".json",JSON.stringify(v));w("run",{last_event:"work"});w("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"first"},{reason_code:"collect_timeout"}]}]});w("failed",{status:"failed"});w("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});w("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});w("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])w(n,{state:"valid_json_not_receipt"});f.writeFileSync(d+"/broken.json","{broken")' "$D"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json | jq -e 'length==9 and (map(.task_id)|index("cifix-37")==null) and (map(select(.task_id=="run"))|.[0].status=="running") and (map(select(.task_id=="partial"))|.[0].reason_code=="collect_timeout") and (map(select(.task_id=="failed"))|.[0].reason_code=="run_failed") and ([.[]|select(.task_id=="ok" or .task_id=="non-github")]|all(.[];.status=="completed" and .ci_fix.attempts==2 and .ci_fix.last_result=="passed")) and ([.[]|select(.task_id=="qa" or .task_id=="commander" or .task_id=="pr-sync-pending" or .task_id=="broken")]|all(.[];.status=="unreadable"))'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","域名","attempts","last_result"])if(!s.includes(x))throw Error(x);console.log("README 断言通过")'
```
```output
[{"task_id":"broken","mtime":"2026-10-17T05:14:22.711Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-17T05:14:22.711Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander","mtime":"2026-10-17T05:14:22.711Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa","mtime":"2026-10-17T05:14:22.711Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"non-github","mtime":"2026-10-17T05:14:22.711Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"ok","mtime":"2026-10-17T05:14:22.711Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"failed","mtime":"2026-10-17T05:14:22.711Z","status":"failed","failed_activity":null,"reason_code":"run_failed","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-17T05:14:22.711Z","status":"partial","failed_activity":"collect","reason_code":"collect_timeout","pr_url":null,"ci_fix":null},{"task_id":"run","mtime":"2026-10-17T05:14:22.711Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
CLI退出码=0
broken  unreadable  2026-10-17T05:14:22.711Z  failed_activity=- reason_code=-
pr-sync-pending  unreadable  2026-10-17T05:14:22.711Z  failed_activity=- reason_code=-
commander  unreadable  2026-10-17T05:14:22.711Z  failed_activity=- reason_code=-
qa  unreadable  2026-10-17T05:14:22.711Z  failed_activity=- reason_code=-
non-github  completed  2026-10-17T05:14:22.711Z  https://example.invalid/pull/37  ci_fix=2次 last=passed
ok  completed  2026-10-17T05:14:22.711Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed
failed  failed  2026-10-17T05:14:22.711Z  failed_activity=- reason_code=run_failed
partial  partial  2026-10-17T05:14:22.711Z  failed_activity=collect reason_code=collect_timeout
run  running  2026-10-17T05:14:22.711Z  failed_activity=- reason_code=-
CLI退出码=0
true
README 断言通过
```
原生命令整体退出码: 0

### T-3
对应: Q-3
verdict: PASS
缺 PR URL 的 completed 在 JSON 保留 `pr_url_missing`，普通行不显示原因；README 明确最终合并另行核对。
```command
set -e
D=$(mktemp -d)
node -e 'const f=require("fs"),d=process.argv[1];f.writeFileSync(d+"/missing-pr.json",JSON.stringify({status:"completed",outputs:{}}));f.writeFileSync(d+"/with-pr.json",JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}))' "$D"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json | jq -e 'length==2 and ([.[]|select(.task_id=="missing-pr")]|.[0]|.status=="completed" and .reason_code=="pr_url_missing" and .pr_url==null) and ([.[]|select(.task_id=="with-pr")]|.[0]|.status=="completed" and .pr_url=="https://github.com/example/repo/pull/38" and .ci_fix==null)'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["pr_url_missing","pr_url=null","--json","当前 head","实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态","历史 FAIL"])if(!s.includes(x))throw Error(x);console.log("README 断言通过")'
```
```output
[{"task_id":"with-pr","mtime":"2026-10-17T05:14:26.396Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null},{"task_id":"missing-pr","mtime":"2026-10-17T05:14:26.396Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
CLI退出码=0
with-pr  completed  2026-10-17T05:14:26.396Z  https://github.com/example/repo/pull/38
missing-pr  completed  2026-10-17T05:14:26.396Z
CLI退出码=0
true
README 断言通过
```
原生命令整体退出码: 0

### T-4
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已核固定 HEAD、完整 DAG 列表、最终路径差异、暂存区/工作区/全仓未跟踪列表，以及逐父边原生 raw 路径。但尚未完成 S-6/S-7 要求的每个旧/新 blob 全量字节和模式校验、每条可见路径的逐次内容断言、manifest 每次历史原文保留与新增行核验、规格纯追加核验、可信 main 同步全 tree 归属核验。因此不能排除中途越界或错误归属，不能判 I-4 通过。本轮 03/04 临时隐藏事实来自控制器；完整恢复尚未发生，留待会话后独立裁判核实。

```command
git rev-parse HEAD
```
```output
52e2106ed03b255f18fa834ff33cf1315944e307
```
原生命令整体退出码: 0

```command
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD
```
```output
178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25
53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d
f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01
200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f
ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7
8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21
a36edb98dcf000ff653236e7674cac6117e30652 8fa7a1c035bd76335c99fe71ed7450d5832b49e8
eb96ceb14f76a1572145644d5defc1fec6a49f1b a36edb98dcf000ff653236e7674cac6117e30652
6e0b4202c1b659de1bf99ad62d42c73d09dca6bc eb96ceb14f76a1572145644d5defc1fec6a49f1b
6f6b6af1ad459f88536235f94a8f585fdead34d5 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc
acc49fa52b4ed059df42560a54663e6f34ad7ff7 6f6b6af1ad459f88536235f94a8f585fdead34d5
15c90a4a0021a40170e46aeacf6fddc91d563cf0 acc49fa52b4ed059df42560a54663e6f34ad7ff7
52e2106ed03b255f18fa834ff33cf1315944e307 15c90a4a0021a40170e46aeacf6fddc91d563cf0
```
原生命令整体退出码: 0

```command
git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD
```
```output
M	.brain-versions
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10170325-ci-budget-headroom.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
M	packages/brain/scripts/coding-workflow/runner/README.md
A	sprints/10170627-cw-5190fd91/01-intent.md
A	sprints/10170627-cw-5190fd91/01-invariants.md
A	sprints/10170627-cw-5190fd91/02-response-r1.md
A	sprints/10170627-cw-5190fd91/02-response-r2.md
A	sprints/10170627-cw-5190fd91/02-review-r1.md
A	sprints/10170627-cw-5190fd91/02-review-r2.md
A	sprints/10170627-cw-5190fd91/02-review-r3.md
A	sprints/10170627-cw-5190fd91/02-review.md
A	sprints/10170627-cw-5190fd91/02-spec.md
A	sprints/10170627-cw-5190fd91/03-build.md
A	sprints/10170627-cw-5190fd91/04-evidence.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r1.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r2.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r3.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r4.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r5.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r6.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r7.md
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/06-judge-r3.md
A	sprints/10170627-cw-5190fd91/06-judge-r4.md
A	sprints/10170627-cw-5190fd91/06-judge-r5.md
A	sprints/10170627-cw-5190fd91/06-judge-r6.md
A	sprints/10170627-cw-5190fd91/06-judge-r7.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
A	sprints/10170627-cw-5190fd91/07-commander-r2.md
```
原生命令整体退出码: 0

```command
git diff --cached --name-status
```
```output

```
原生命令整体退出码: 0

```command
git diff --name-status
```
```output
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
```
原生命令整体退出码: 0

```command
git ls-files --others --exclude-standard
```
```output

```
原生命令整体退出码: 0

首次逐父边命令在 zsh 中未正确拆分合并提交的两个父 SHA，退出码 128；随后在 bash 中原样重跑，退出码 0。
```command
set -e
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD | while read -r commit parents; do
  for parent in $parents; do
    printf '父边 %s -> %s\n' "$parent" "$commit"
    git diff --no-ext-diff --no-renames --raw --full-index "$parent" "$commit" --
    printf 'git退出码=%s\n' "$?"
  done
done
```
```output
父边 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 178f61849d85be5a9370f23c033e48ae006cfe25
:100644 100644 6e6eb65f6 3e8eea166 M	packages/brain/scripts/coding-workflow/runner/README.md
git退出码=0
父边 178f61849d85be5a9370f23c033e48ae006cfe25 -> 42943dfe5fc3f0680291322a5440bcd46159cbeb
:100644 100644 b4d00c4f7 24de93e04 M	.implementation-source-relations.json
:000000 100644 000000000 3a1529d7a A	sprints/10170627-cw-5190fd91/01-intent.md
:000000 100644 000000000 2276b9f0b A	sprints/10170627-cw-5190fd91/01-invariants.md
:000000 100644 000000000 f89998664 A	sprints/10170627-cw-5190fd91/02-response-r1.md
:000000 100644 000000000 677402ca4 A	sprints/10170627-cw-5190fd91/02-response-r2.md
:000000 100644 000000000 8b068bd99 A	sprints/10170627-cw-5190fd91/02-review-r1.md
:000000 100644 000000000 7c80b836b A	sprints/10170627-cw-5190fd91/02-review-r2.md
:000000 100644 000000000 e6922e12a A	sprints/10170627-cw-5190fd91/02-review-r3.md
:000000 100644 000000000 e6922e12a A	sprints/10170627-cw-5190fd91/02-review.md
:000000 100644 000000000 9827a68e9 A	sprints/10170627-cw-5190fd91/02-spec.md
:000000 100644 000000000 0d96f5637 A	sprints/10170627-cw-5190fd91/03-build.md
:000000 100644 000000000 46a81734e A	sprints/10170627-cw-5190fd91/04-evidence.md
git退出码=0
父边 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 53cdf746c0c7f446cb7b6987e170d76248999f1d
:100644 100644 765a3cb61 f3d261425 M	.brain-versions
:100644 100644 b4d00c4f7 ffadfb933 M	.implementation-source-relations.json
:100644 100644 c61152020 a4b46caf2 M	DEFINITION.md
:100644 000000 616784532 000000000 D	changes/cp-10170325-ci-budget-headroom.md
:100644 100644 f6a79a39a aaeb525fd M	package-lock.json
:100644 100644 765a3cb61 f3d261425 M	packages/brain/VERSION
:100644 100644 bd0894471 ecb84839f M	packages/brain/package-lock.json
:100644 100644 5451dac02 b6a3c1c89 M	packages/brain/package.json
git退出码=0
父边 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d -> f9460639ab0b5e2cd7b05f4f109db13a51b64f01
fatal: bad revision '42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d'
```
原生命令整体退出码: 128

```command
set -e
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD | while read -r commit parents; do
  for parent in $parents; do
    printf '父边 %s -> %s\n' "$parent" "$commit"
    git diff --no-ext-diff --no-renames --raw --full-index "$parent" "$commit" --
    printf 'git退出码=%s\n' "$?"
  done
done
```
```output
父边 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 178f61849d85be5a9370f23c033e48ae006cfe25
:100644 100644 6e6eb65f6 3e8eea166 M	packages/brain/scripts/coding-workflow/runner/README.md
git退出码=0
父边 178f61849d85be5a9370f23c033e48ae006cfe25 -> 42943dfe5fc3f0680291322a5440bcd46159cbeb
:100644 100644 b4d00c4f7 24de93e04 M	.implementation-source-relations.json
:000000 100644 000000000 3a1529d7a A	sprints/10170627-cw-5190fd91/01-intent.md
:000000 100644 000000000 2276b9f0b A	sprints/10170627-cw-5190fd91/01-invariants.md
:000000 100644 000000000 f89998664 A	sprints/10170627-cw-5190fd91/02-response-r1.md
:000000 100644 000000000 677402ca4 A	sprints/10170627-cw-5190fd91/02-response-r2.md
:000000 100644 000000000 8b068bd99 A	sprints/10170627-cw-5190fd91/02-review-r1.md
:000000 100644 000000000 7c80b836b A	sprints/10170627-cw-5190fd91/02-review-r2.md
:000000 100644 000000000 e6922e12a A	sprints/10170627-cw-5190fd91/02-review-r3.md
:000000 100644 000000000 e6922e12a A	sprints/10170627-cw-5190fd91/02-review.md
:000000 100644 000000000 9827a68e9 A	sprints/10170627-cw-5190fd91/02-spec.md
:000000 100644 000000000 0d96f5637 A	sprints/10170627-cw-5190fd91/03-build.md
:000000 100644 000000000 46a81734e A	sprints/10170627-cw-5190fd91/04-evidence.md
git退出码=0
父边 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 53cdf746c0c7f446cb7b6987e170d76248999f1d
:100644 100644 765a3cb61 f3d261425 M	.brain-versions
:100644 100644 b4d00c4f7 ffadfb933 M	.implementation-source-relations.json
:100644 100644 c61152020 a4b46caf2 M	DEFINITION.md
:100644 000000 616784532 000000000 D	changes/cp-10170325-ci-budget-headroom.md
:100644 100644 f6a79a39a aaeb525fd M	package-lock.json
:100644 100644 765a3cb61 f3d261425 M	packages/brain/VERSION
:100644 100644 bd0894471 ecb84839f M	packages/brain/package-lock.json
:100644 100644 5451dac02 b6a3c1c89 M	packages/brain/package.json
git退出码=0
父边 42943dfe5fc3f0680291322a5440bcd46159cbeb -> f9460639ab0b5e2cd7b05f4f109db13a51b64f01
:100644 100644 765a3cb61 f3d261425 M	.brain-versions
:100644 100644 24de93e04 c4f2bb176 M	.implementation-source-relations.json
:100644 100644 c61152020 a4b46caf2 M	DEFINITION.md
:100644 000000 616784532 000000000 D	changes/cp-10170325-ci-budget-headroom.md
:100644 100644 f6a79a39a aaeb525fd M	package-lock.json
:100644 100644 765a3cb61 f3d261425 M	packages/brain/VERSION
:100644 100644 bd0894471 ecb84839f M	packages/brain/package-lock.json
:100644 100644 5451dac02 b6a3c1c89 M	packages/brain/package.json
git退出码=0
父边 53cdf746c0c7f446cb7b6987e170d76248999f1d -> f9460639ab0b5e2cd7b05f4f109db13a51b64f01
:100644 100644 ffadfb933 c4f2bb176 M	.implementation-source-relations.json
:100644 100644 6e6eb65f6 3e8eea166 M	packages/brain/scripts/coding-workflow/runner/README.md
:000000 100644 000000000 3a1529d7a A	sprints/10170627-cw-5190fd91/01-intent.md
:000000 100644 000000000 2276b9f0b A	sprints/10170627-cw-5190fd91/01-invariants.md
:000000 100644 000000000 f89998664 A	sprints/10170627-cw-5190fd91/02-response-r1.md
:000000 100644 000000000 677402ca4 A	sprints/10170627-cw-5190fd91/02-response-r2.md
:000000 100644 000000000 8b068bd99 A	sprints/10170627-cw-5190fd91/02-review-r1.md
:000000 100644 000000000 7c80b836b A	sprints/10170627-cw-5190fd91/02-review-r2.md
:000000 100644 000000000 e6922e12a A	sprints/10170627-cw-5190fd91/02-review-r3.md
:000000 100644 000000000 e6922e12a A	sprints/10170627-cw-5190fd91/02-review.md
:000000 100644 000000000 9827a68e9 A	sprints/10170627-cw-5190fd91/02-spec.md
:000000 100644 000000000 0d96f5637 A	sprints/10170627-cw-5190fd91/03-build.md
:000000 100644 000000000 46a81734e A	sprints/10170627-cw-5190fd91/04-evidence.md
git退出码=0
父边 f9460639ab0b5e2cd7b05f4f109db13a51b64f01 -> f3dbd423fab3eddea650ac361d4651f393cfd40f
:100644 100644 c4f2bb176 f3d532f65 M	.implementation-source-relations.json
:000000 100644 000000000 766cc68f7 A	sprints/10170627-cw-5190fd91/05-qa-report-r1.md
git退出码=0
父边 f3dbd423fab3eddea650ac361d4651f393cfd40f -> 200baf82ef92f25d8b10031b52596b1e24fb70a7
:100644 100644 9827a68e9 51450ee5e M	sprints/10170627-cw-5190fd91/02-spec.md
git退出码=0
父边 200baf82ef92f25d8b10031b52596b1e24fb70a7 -> ea0573f2d1e2a95f5cb7727a70c581d325b1fd21
:100644 100644 f3d532f65 f0d372e0c M	.implementation-source-relations.json
:000000 100644 000000000 fc178a6a8 A	sprints/10170627-cw-5190fd91/07-commander-r1.md
git退出码=0
父边 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 -> 8fa7a1c035bd76335c99fe71ed7450d5832b49e8
:100644 100644 f0d372e0c eab6aa5c1 M	.implementation-source-relations.json
:000000 100644 000000000 05e0b0b9c A	sprints/10170627-cw-5190fd91/05-qa-report-r2.md
:000000 100644 000000000 51c02fb04 A	sprints/10170627-cw-5190fd91/06-judge-r2.md
git退出码=0
父边 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 -> a36edb98dcf000ff653236e7674cac6117e30652
:100644 100644 eab6aa5c1 4d1cf2084 M	.implementation-source-relations.json
:000000 100644 000000000 80d07eb72 A	sprints/10170627-cw-5190fd91/05-qa-report-r3.md
:000000 100644 000000000 19cf8a904 A	sprints/10170627-cw-5190fd91/06-judge-r3.md
git退出码=0
父边 a36edb98dcf000ff653236e7674cac6117e30652 -> eb96ceb14f76a1572145644d5defc1fec6a49f1b
:100644 100644 51450ee5e ac6a959af M	sprints/10170627-cw-5190fd91/02-spec.md
git退出码=0
父边 eb96ceb14f76a1572145644d5defc1fec6a49f1b -> 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc
:100644 100644 4d1cf2084 c310edb1c M	.implementation-source-relations.json
:000000 100644 000000000 8557e2041 A	sprints/10170627-cw-5190fd91/07-commander-r2.md
git退出码=0
父边 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc -> 6f6b6af1ad459f88536235f94a8f585fdead34d5
:100644 100644 c310edb1c 7959d010b M	.implementation-source-relations.json
:000000 100644 000000000 87fb6a1d5 A	sprints/10170627-cw-5190fd91/05-qa-report-r4.md
:000000 100644 000000000 d160e5c15 A	sprints/10170627-cw-5190fd91/06-judge-r4.md
git退出码=0
父边 6f6b6af1ad459f88536235f94a8f585fdead34d5 -> acc49fa52b4ed059df42560a54663e6f34ad7ff7
:100644 100644 7959d010b 12c7a90aa M	.implementation-source-relations.json
:000000 100644 000000000 688569245 A	sprints/10170627-cw-5190fd91/05-qa-report-r5.md
:000000 100644 000000000 2d9eb07b6 A	sprints/10170627-cw-5190fd91/06-judge-r5.md
git退出码=0
父边 acc49fa52b4ed059df42560a54663e6f34ad7ff7 -> 15c90a4a0021a40170e46aeacf6fddc91d563cf0
:100644 100644 12c7a90aa c41636011 M	.implementation-source-relations.json
:000000 100644 000000000 06675ebe4 A	sprints/10170627-cw-5190fd91/05-qa-report-r6.md
:000000 100644 000000000 6d491ef52 A	sprints/10170627-cw-5190fd91/06-judge-r6.md
git退出码=0
父边 15c90a4a0021a40170e46aeacf6fddc91d563cf0 -> 52e2106ed03b255f18fa834ff33cf1315944e307
:100644 100644 c41636011 1e5b7a23f M	.implementation-source-relations.json
:000000 100644 000000000 041d7d6d3 A	sprints/10170627-cw-5190fd91/05-qa-report-r7.md
:000000 100644 000000000 c2060875f A	sprints/10170627-cw-5190fd91/06-judge-r7.md
git退出码=0
```
原生命令整体退出码: 0

### X-1
对应: Q-2
场景: 首次文档断言误要求 README 包含合成回执文件名 `non-github`；这是测试断言超出合同。完整保留首次失败，T-2 已删去该错误关键词并独立重跑。
verdict: PASS
```command
set -e
D=$(mktemp -d)
node -e 'const f=require("fs"),d=process.argv[1],w=(n,v)=>f.writeFileSync(d+"/"+n+".json",JSON.stringify(v));w("run",{last_event:"work"});w("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"first"},{reason_code:"collect_timeout"}]}]});w("failed",{status:"failed"});w("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});w("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});w("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])w(n,{state:"valid_json_not_receipt"});f.writeFileSync(d+"/broken.json","{broken")' "$D"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
printf 'CLI退出码=%s\n' "$?"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json | jq -e 'length==9 and (map(.task_id)|index("cifix-37")==null) and (map(select(.task_id=="run"))|.[0].status=="running") and (map(select(.task_id=="partial"))|.[0].reason_code=="collect_timeout") and (map(select(.task_id=="failed"))|.[0].reason_code=="run_failed") and ([.[]|select(.task_id=="ok" or .task_id=="non-github")]|all(.[];.status=="completed" and .ci_fix.attempts==2 and .ci_fix.last_result=="passed")) and ([.[]|select(.task_id=="qa" or .task_id=="commander" or .task_id=="pr-sync-pending" or .task_id=="broken")]|all(.[];.status=="unreadable"))'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","non-github","域名","attempts","last_result"])if(!s.includes(x))throw Error(x);console.log("README 断言通过")'
```
```output
[{"task_id":"broken","mtime":"2026-10-17T05:14:20.838Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-17T05:14:20.838Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander","mtime":"2026-10-17T05:14:20.838Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa","mtime":"2026-10-17T05:14:20.837Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"non-github","mtime":"2026-10-17T05:14:20.837Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"ok","mtime":"2026-10-17T05:14:20.837Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"failed","mtime":"2026-10-17T05:14:20.837Z","status":"failed","failed_activity":null,"reason_code":"run_failed","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-17T05:14:20.837Z","status":"partial","failed_activity":"collect","reason_code":"collect_timeout","pr_url":null,"ci_fix":null},{"task_id":"run","mtime":"2026-10-17T05:14:20.837Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
CLI退出码=0
broken  unreadable  2026-10-17T05:14:20.838Z  failed_activity=- reason_code=-
pr-sync-pending  unreadable  2026-10-17T05:14:20.838Z  failed_activity=- reason_code=-
commander  unreadable  2026-10-17T05:14:20.838Z  failed_activity=- reason_code=-
qa  unreadable  2026-10-17T05:14:20.837Z  failed_activity=- reason_code=-
non-github  completed  2026-10-17T05:14:20.837Z  https://example.invalid/pull/37  ci_fix=2次 last=passed
ok  completed  2026-10-17T05:14:20.837Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed
failed  failed  2026-10-17T05:14:20.837Z  failed_activity=- reason_code=run_failed
partial  partial  2026-10-17T05:14:20.837Z  failed_activity=collect reason_code=collect_timeout
run  running  2026-10-17T05:14:20.837Z  failed_activity=- reason_code=-
CLI退出码=0
true
[eval]:1
const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","non-github","域名","attempts","last_result"])if(!s.includes(x))throw Error(x);console.log("README 断言通过")
                                                                                                                                                                                                                                                                                                   ^

Error: non-github
    at [eval]:1:298
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```
原生命令整体退出码: 1

## 结论

Q-1～Q-3 的本地 CLI 与文档行为通过。Q-4 只能判 `CANNOT_VERIFY`；本轮没有足够证据宣布整体验收通过。第 7 轮裁判指出的逐次内容和完整证据缺口仍未补齐。

