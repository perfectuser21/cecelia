---
task_id: df525426-c735-44d1-abee-82023053fd93
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账规格

### S-1

对应：I-1。只改 `packages/brain/scripts/coding-workflow/runner/README.md`，在文末追加标题为 `## 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账` 的本任务新小节；以固定 initial base `0bd461e8c80fc5db202e2570eeee77d0c9cdce58` 的该文件原 bytes、mode、段落顺序作为不可改前缀，保留当前已合并的 A14 节，不复制未合并旧 B 文本。准确写出两条入口：`lib/terminal.mjs` 的 `finishSuccess` 在 Brain `completed` 写入成功且 `cfg.automerge` 为真后调用 `gh pr ready <pr_url>`，`cfg.qaGate` 为真时 `runner.phase=awaiting_qa`，这次 ready 仅解除草稿、不表示批准或合并；QA 关闭时为 `awaiting_manual_merge`、需人工处理。`lib/merge-gate.mjs` 仅在精确 QA 与独立 judge 批准的 head、required 全绿、可信 source 通过及仓库允许自动合并后，对仍为 draft 的 PR 再尝试 ready；其前后 `gh pr view --json headRefOid,isDraft,state` 必须确认 OPEN、批准 head 和布尔 draft，ready 本身无 head CAS，最终 `gh pr merge --squash --delete-branch --match-head-commit <approved.head>` 才有 GitHub CAS。`repoAutomerge=false` 走 `awaiting_human`，不得描述成自动合并。失败语义写明 ready 失败、前后读回不一致、head 漂移、required/source 失败时不报合并成功，按现有门禁停止、撤销批准或升级；人工仓保留人工合并责任。输入对抗面写明重复 ready 可遇到已非 draft，状态与 head 并发变化必须重新读回，不能凭 URL、旧批准或 ready 返回码越过 merge CAS。验证：对 README 运行可失败的只读 Node 内容断言，要求双入口、全部门槛及失败语义同现有 `terminal.mjs`、`merge-gate.mjs` 对齐；内存删除任一关键限定后断言必须失败，原文件断言成功。

### S-2

对应：I-2。只改同一 README 追加小节。明确四种身份：QA 当轮实际测试的 `tested_head`；仅本轮 05/06 合法纯登记提交、经受保护来源链精确核实后可改绑的 `approved.head`；最终 PR `headRefOid`；GitHub squash 后独立的 `mergeCommit` SHA。不可把 squash SHA、登记哈希、旧 head 的 QA/CI 结果当作新 head 的执行证据。固定 initial base 不浮动；完整 `initial base→当前 HEAD` DAG 先确认 HEAD 等于 `tested_head` 且固定 base 是其祖先，再对每个提交的每条父边核 raw path/blob/mode、全差异，最后核当前 index/worktree/全仓 untracked；本任务仅允许 README 合法追加和控制器对本任务 Markdown 的准确 `documentation` manifest 前插，旧 raw 和顺序不变。真实 main 同步只在完整可信链、准确双父、actual main ref、全树及 source gate 均有证据时归属；不能简单从差异中减 main。任何代码、产品或可信 main 同步产生新 HEAD 都要求该新 HEAD 的真实 QA、judge、正式 CI 与 preview；仅合同允许的本轮 05/06 纯登记新 HEAD 可由真实 protected source 链严格证明内容边界并合法改绑，不声称 QA 模型测过登记 HEAD，也不制造无限登记循环。失败语义：HEAD 或来源不能对齐时标未证实、阻止晋级；输入对抗面：伪造记录文件名、重复登记、缺父边、并发 head 变化均不能凭哈希放行。验证：只读 `git rev-parse --verify '0bd461e8c80fc5db202e2570eeee77d0c9cdce58^{commit}'`、HEAD 与 `tested_head` 比对、`git merge-base --is-ancestor 0bd461e8c80fc5db202e2570eeee77d0c9cdce58 HEAD`、`git rev-list --parents 0bd461e8c80fc5db202e2570eeee77d0c9cdce58..HEAD`、对各父边执行 `git diff-tree --raw`；祖先判定非零即拒绝将该范围解释为固定 base 至测试 HEAD，并对文中四种 SHA 作互不混同的可失败静态断言。

### S-3

对应：I-3。只改同一 README 追加小节。按 `lib/merge-gate.mjs`、`lib/merge-learning.mjs`、`lib/pr-sync.mjs` 的现行顺序写出：真实 MERGED 后先记 `receipt_pending`、`learning_pending`；Brain 回写 `result.merge.merged=true`、实际 head、`runner.phase=merged` 和终态 handoff；Learning 的非幂等 POST 至多尝试一次，先记 `learning_attempted/unknown`，响应 ID 个数、唯一性及正文逐条 SHA-256 读回确认后才清 `learning_pending`；未知/部分成功不自动重发。回执失败留 pending，下一次真实 tick 继续收账；preview stop 和 pending 清理亦须实际发生后独立核实。`status=completed` 或仅 `receipt_pending=false` 都不是全链成功，旧 FAIL/HUMAN/错误恢复及其原生历史不得抹除。区分 PR head 与 squash `mergeCommit`；不得把 `s.merged.head` 冒充 mergeCommit。失败语义：Learning 未确认、Brain 回写失败、预览未回收均保持未闭环并留痕，人工处理可读原状态；输入对抗面：重复 tick、响应丢失或重复 Learning ID 不重复 POST，不靠单字段判成功。验证：对 README 做只读可失败断言并以内存替换 `learning_pending`、`previewstop`、`handoff` 等关键限定词验证断言确实会失败；检查原 A14 与 base 前缀 bytes/mode 未动。

### S-4

对应：I-4。只改同一 README 追加小节，用阶段表或短段明确：build 先真跑可失败只读断言 RED，再追加文档，同断言 GREEN，完整原生失败、修正、重复、零输出由控制器留账；发布前 verify 当场用固定 initial base 核完整 DAG、各父边 raw、全 diff、index/worktree/全仓 untracked，README 原 bytes/mode 与 manifest 零差异按当时现场核；当前产品 QA 只读 01/02、固定源码、当前测试 HEAD、可信有限来源投影，执行真实可失败静态断言和内存破坏对抗，并重新核当前 DAG、index/worktree/untracked。QA 不读 03/04 正文或保护根，不用旧 PASS/哈希追认发布前非 Git 现场；03/04 暂隐藏只在可信投影精确绑定 task/round/HEAD/blob/mode 时作隔离解释，不能当已恢复。judge-only `historical_execution` 只核已登记 build/verify 的 stage/head/native 原命令、聚合输出、整数退出码与完整失败/重复/零输出，并核实际恢复的 03/04；`aggregated_output` 不冒称任意 child stdout/stderr 完整。外层在发布、正式 source/CI/preview、精确批准 HEAD、真实 MERGED、Brain/Learning 回读、下次 tick 回收实际发生后按冻结 C01-C12 独立终验；未发生或缺证为 UNKNOWN/CANNOT_VERIFY，草稿 FAIL/CANNOT 不升格 PASS，A 的旧信用不替代 B。验证：只读断言逐阶段职责及禁读边界；以内存删除阶段限定、把历史命令写成 QA 当前命令、把 pending 改成 PASS 等反例证明断言会失败。上述历史、发布和终态责任保留在对应真实控制器门，不交当前 QA 重做。

## QA 场景

### Q-1

对应: I-1

前提: 本 PR 预览环境已由可信控制器提供本轮固定 `env_url` 和精确 `tested_head`；QA 只读 GET `<预览环境>/api/brain/health`，须为 literal `localhost` 或 `127.0.0.1` 的同 origin 且 `git_sha` 等于 `tested_head`，不跟重定向、不调用其他 API。README 位于当前精确测试 HEAD 的工作树。该 GET 只核预览身份，不算文档验收。

操作: 在预览版本对应的只读检出运行 `node --input-type=module -e 'import{readFileSync}from"node:fs";import{strict as a}from"node:assert";const all=readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),t=all.slice(all.lastIndexOf("## 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账"));const required=["finishSuccess","gh pr ready","awaiting_qa","approved.head","headRefOid,isDraft,state","--match-head-commit","awaiting_human","head CAS","前后","required","source"];const check=s=>{for(const x of required)a.ok(s.includes(x),x)};check(t);for(const x of ["--match-head-commit","awaiting_human"])a.throws(()=>check(t.replace(x,"")),{name:"AssertionError"},x)'`；命令只在内存删除两处文本并分别要求检查函数失败，不落盘。人工核对双入口条件、失败语义和人工仓路径。

期望: 整条命令 exit 0，表示原文检查通过且两种内存破坏各自触发 AssertionError；任一破坏未触发异常时整条命令非零退出。README 可读出早期 ready 与批准后 ready 的条件、失败处理和人工仓路径。若预览身份 GET 失败或 SHA 不符，场景为不能验，不以静态断言冒充预览身份。

### Q-2

对应: I-2, I-4

前提: 可信控制器给出固定 initial base `0bd461e8c80fc5db202e2570eeee77d0c9cdce58`、本轮精确 `tested_head`、仅含已验证公共事实的来源投影及本轮 03/04 隔离投影；缺失即如实不能验，不编造历史或登记。QA 工作树为该精确 HEAD，仍需核当前现场。

操作: 在只读检出运行 `git rev-parse --verify '0bd461e8c80fc5db202e2570eeee77d0c9cdce58^{commit}'`、`git rev-parse --verify HEAD`，比对 HEAD 与可信投影中的精确 `tested_head`；然后运行 `git merge-base --is-ancestor 0bd461e8c80fc5db202e2570eeee77d0c9cdce58 HEAD`，仅在退出 0 时运行 `git rev-list --parents 0bd461e8c80fc5db202e2570eeee77d0c9cdce58..HEAD`；按列出的每个提交及每条父边执行 `git diff-tree --raw <父SHA> <子SHA>`，同时运行 `git diff 0bd461e8c80fc5db202e2570eeee77d0c9cdce58 HEAD --raw`、`git diff --cached --raw`、`git diff --raw`、`git ls-files --others --exclude-standard`。只读核固定 base 的 README blob bytes/mode 是当前 README 的精确前缀，当前额外内容仅文末本任务小节；核全仓变动及 manifest 的本任务 Markdown `owner=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation` 精确前插是否有可信投影支持，旧 raw 顺序保留。用 Node 只读检查 README 同时区分 `tested_head`、`approved.head`、`headRefOid`、`mergeCommit`，并在内存删除其中任一身份说明，预期断言失败。

期望: HEAD 等于精确 `tested_head` 且祖先判定原生 exit 0 后，才能将后续范围输出解释为固定 base 至测试 HEAD 的 DAG；判定非零即拒绝该解释，不能凭 `rev-parse`、`rev-list` 成功放行。完整 DAG 每条父边与全差异、index/worktree/untracked 都有可核结果；只接受精确本任务合法 Markdown、可信登记与符合完整 source proof 的同步。03/04 仅可按投影精确解释暂隐藏，其余差异失败关闭。README 原文断言通过、内存破坏失败；无来源、父边或身份事实时明确不能验，不用干净 HEAD 推出发布前现场已通过。

### Q-3

对应: I-3

前提: 同 Q-1 的预览身份及当前精确 HEAD；不制造真实合并或 Learning 历史。

操作: 在只读检出打开 README 文末新小节，逐项查找 `receipt_pending`、`learning_pending`、`learning_attempted`、`learning_ids`、`SHA-256`、`runner.phase=merged`、`handoff`、`preview`、`next tick`、`mergeCommit`；运行 `node --input-type=module -e 'import{readFileSync}from"node:fs";import{strict as a}from"node:assert";const all=readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),t=all.slice(all.lastIndexOf("## 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账"));const required=["receipt_pending","learning_pending","learning_attempted","learning_ids","SHA-256","handoff","mergeCommit"];const check=s=>required.every(x=>s.includes(x));a.ok(check(t));for(const x of required)a.equal(check(t.split(x).join("")),false,x)'`。人工核对原文对 `completed`、Learning 未确认、preview 未回收、旧 FAIL/HUMAN 的描述。

期望: 原文和命令通过；每个内存删词反例被拒绝。页面/文档不会声称 Brain completed、pending 单字段或 squash SHA 已证明全闭环；真实 Learning ID 与正文读回、preview stop 和次 tick 回收由后续控制器在实际发生后核，不由当前 QA 伪造。

### Q-4

对应: I-4

前提: 同 Q-2 的可信固定来源、精确 HEAD、隔离投影；历史 build/verify 原生记录仅由后续 judge-only 来源门提供，当前 QA 无权读取 03/04 正文或保护根。

操作: 在只读检出读取 README 新小节，运行 `node --input-type=module -e 'import{readFileSync}from"node:fs";import{strict as a}from"node:assert";const all=readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),t=all.slice(all.lastIndexOf("## 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账"));const xs=["build","verify","QA","judge-only","C01-C12","03/04","aggregated_output","CANNOT_VERIFY"];const ok=s=>xs.every(x=>s.includes(x));a.ok(ok(t));for(const x of xs)a.equal(ok(t.split(x).join("")),false,x)'`；再按 Q-2 的当前 Git 命令和可信投影核 QA 当前可观察的全范围。人工核对发布前、历史 judge、会话后恢复、终态门分别由哪个真实阶段承担。

期望: 原文断言 exit 0、删词反例全部被拒绝；QA 仅报告当前 HEAD 的内容与完整 Git 事实，不将历史 native、旧 PASS 或暂隐藏误当当前执行。发布前 index/worktree/untracked、03/04 恢复及 C01-C12 终态门缺原生证据时，对应阶段保持未通过，不据本场景给总 PASS。

## 铁律对照

- INV-818af041：S-1、Q-1 覆盖；使用现有 GitHub、Git、QA 和来源门术语，不另造研发层级。
- INV-3a390000：S-4、Q-4 覆盖；正式 CI/preview 和终态门未真过不得宣称晋级。
- INV-2fe86d34：S-3、Q-3 覆盖；运行与 Learning 成功依据真实回执和读回，不用状态标签替代。
- INV-b3a8bf82：S-2、S-3、Q-2 覆盖；任务、运行、版本与 Git 来源各保留自己的权威事实。
- INV-e5ab4826：S-2、Q-2 覆盖；追加现有手册并引用既有账与来源门，不另立平行账本。
- INV-02d8e749：S-1、S-4、Q-4 覆盖；保留 QA、judge、CI、预览及合并前门槛。
- INV-3529e88f：S-4、Q-4 覆盖；可失败机械断言和可信原生来源承担验收，不靠自述。
- INV-113a9330：S-1、S-4、Q-1 覆盖；预览 `git_sha` 不明或不匹配时统一不能验。
- INV-26a1d06e：S-2、Q-2 覆盖；固定 base ref 用 `git rev-parse --verify ...^{commit}` 核实。
- INV-dc18d43d：S-4、Q-4 覆盖；文档只说明既有程序门与阶段责任，不把文案当新门禁。
- INV-3c30394c：S-3、S-4、Q-3、Q-4 覆盖；真实 GitHub、Brain、Learning、preview 未核实前不报全链完成。
- INV-45cd3ec2：不适用：本任务不新建或修改 smoke、guard、退出码。
- INV-ff177feb：不适用：该条已由 INV-45cd3ec2 撤销，且本任务不碰 smoke。

## 未覆盖真实链路

- 发布前 build 的 RED/GREEN 与 verify 当时全仓、index、worktree、untracked 原生现场：当前 QA 只验当前 HEAD 和 Git 历史；旧现场须由当时控制器原生命令完整输出、退出码及外层门核实，缺则不能验。
- 历史 build/verify 登记、native 全账和 03/04 原 bytes/mode 恢复：当前 QA 只验隔离投影；会话后由受保护来源门及 judge-only `historical_execution` 核实，缺则不能验。
- GitHub 真实 ready、required、source、精确批准 HEAD、合并及 squash `mergeCommit`：当前 QA 只验文档和固定 Git 事实；实际发生后由控制器及终态门读回，不能在预览 QA 伪造历史。
- Brain 终态 handoff、Learning 真 POST 后 ID 与全文 hash 读回、preview stop、下次 tick pending 回收：当前 QA 只验说明与现有源码；实际发生后由控制器和 C01-C12 终态门核实，未发生不 PASS。
