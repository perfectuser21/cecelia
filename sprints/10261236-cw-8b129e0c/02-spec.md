---
task_id: 8b129e0c-96bc-492a-9d8d-ce04260caa6c
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### S-1
对应：I-1。仅修改 `packages/brain/scripts/coding-workflow/runner/README.md`：在固定 initial base `7724d4f246453d6a90b5c451e63d80fbb586628d` 的实际 README 完整原文之后，追加唯一标题 `## QA 修复后的批准、合并和收账边界` 的新节；旧 bytes、mode、A14/A15 节及先后顺序均保持原样，不复制未合并旧 B 的内容。新节准确写出 `lib/terminal.mjs` 的 `finishSuccess` 在正常 `completed` 写回成功且 `cfg.automerge` 允许时提前调用 `gh pr ready`：QA 开启后仍仅为 `awaiting_qa`，QA 关闭时为人工处理，ready 不代表批准或合并。写出 `lib/merge-gate.mjs` 在精确 QA+独立 judge 批准、required 检查全绿、可信 source 通过且仓库允许自动合并后才对草稿再次 ready；ready 前后 `gh pr view` 核 OPEN、精确批准 head 和 draft 状态，ready 自身无 head CAS，最后 `gh pr merge --squash --delete-branch --match-head-commit <approved.head>` 才有 GitHub 侧 CAS；仓库 `automerge=false` 则 `awaiting_human`。真实调用方 shape：本改动只有人和 coding workflow 文档读者，无新接口或脚本调用方；所述既有调用形态出自 `runner/lib/terminal.mjs`、`runner/lib/merge-gate.mjs`，分别是 `gh pr ready <PR URL/编号>`、`gh pr view <编号> --json headRefOid,isDraft,state`、`gh pr merge <编号> --squash --delete-branch --match-head-commit <SHA>`，不新增鉴权或请求体。失败语义与输入对抗面：ready 失败、前后 GET 失败/身份变化、非法或漂移的 head、重复或并发操作均不得写成已批准/已合并，按既有门保留待核或失败；文档不授予重试、跳过 CAS 的权限。验证：对新增小节运行真正可失败的 Node 只读断言，检查每个上述条件及其先后关系；以内存副本删除“非批准”、颠倒 ready/批准、删除前后 GET 或 match-head-commit，断言各反例均非零；修复前同一断言必须真实 RED，修复后真实 GREEN。

### S-2
对应：I-2。仍只修改上述 README 新节。分别定义 QA 真正测试的 `tested_head`、允许纯本轮记录提交后经受保护来源链改绑的 `approved.head`、合并前实际 PR `headRefOid`、以及 GitHub squash 生成的 `mergeCommit.oid`；前三者在合法时可有不同发生时点，squash SHA 不是被 QA 测试的分支 HEAD，也不是执行证据。代码/产品改动或可信 main 同步产生新 HEAD 必须重新真实 QA、judge、CI、preview；仅合同允许的本轮 05/06 准确记录提交，须证明只含本轮记录、产品与旧历史未改，才可把批准绑定实际记录 HEAD，不能声称模型测过记录 HEAD，也不制造无限“QA 再登记”循环。完整 initial base→当前 HEAD 的所有父边、路径/blob/mode、全差异、index、worktree、全仓 untracked 均要审；同步仅在完整可信来源链、准确双父、实际 main ref、全 tree/source gate 通过时归属上游，不能从浮动 main 减差。现有 `merge-gate.mjs` 会用 `changedSinceApproval` 排除 main 的提交，并在剩余文件仅为记录时尝试 `verifyMergeSource` 后改绑；这只是现行实现，不是新 HEAD 的 QA/judge/preview 结果。`source-merge-proof.mjs` 对 QA 后的 main 同步以 `qa_before_sync` 拒绝旧 QA 轮次，不能凭来源证明放行；同步后的最终 HEAD 须由后续控制器实际取得新 QA、judge、CI、preview 结果并按新轮次批准，终态门逐项核同一 HEAD，缺一不准合并或判 PASS。真实调用方 shape：文档读者按现有 `runner/lib/source-merge-proof.mjs`、`runner/lib/source-provenance.mjs` 和 `runner/lib/merge-gate.mjs` 的来源/合并门理解这些字段，不新增调用入口。失败语义与输入对抗面：HEAD 漂移、重复登记、伪造记录、非法/超长来源字段、并发变更或来源缺失时不能沿用旧 HEAD 信用，当前验收失败关闭，历史缺证标 UNKNOWN；只可从可信事实复核。验证：只读断言检查四种 SHA 身份、重验/窄例外及逐父审计语义；在内存副本中把 squash SHA 等同批准 SHA、把 main 同步直接扣除、允许代码 HEAD 沿用旧 QA，均应失败。

### S-3
对应：I-3。仍只修改上述 README 新节。按 `runner/lib/pr-sync.mjs`、`runner/lib/merge-gate.mjs`、`runner/lib/merge-learning.mjs`、`runner/lib/pr-closure.mjs` 的现有责任说明：实际 MERGED 后，`recordMerged` 在 Brain PATCH 返回 `ok` 时即清 `receipt_pending=false`，PATCH 前的 `syncTask` GET 与 PATCH 响应均不是 PATCH 后独立读回；后续终态门须另行 GET 核精确合并回执，不能以该 false 值代证。`learning_pending` 只在 Learning ID 与全文哈希独立读回后清除；Brain `status=completed` 或单个 `runner.phase=merged` 不等于完整闭环；核 `merge.merged=true`、精确合并 head、handoff、Learning 返回的每个 ID 与全文 SHA-256 读回，Learning 未知/部分成功不自动重发；preview stop 要确认返回 `stopped=true`，pending 的清理与预览回收由下次实际 tick 核实。历史 FAIL/HUMAN、修复失败、错误恢复与未确认待办不得抹除或改写为 PASS。区分 PR head 和 GitHub `mergeCommit.oid`。真实调用方 shape：既有 runner 调 Brain 的 task PATCH、Learning POST/GET，以及预览 stop，出处为上述源码；本次仅记载既有行为，无新请求、header 或鉴权约定。失败语义与输入对抗面：回写/读回失败、重复收账、部分 Learning、并发合并状态变化时保留 pending 或 UNKNOWN，不自动重发不幂等的 Learning，也不从单字段推断成功。验证：只读断言检查 pending、next tick、ID+全文 hash、preview stop、handoff 和失败历史；内存反例将 completed 单字段写成闭环、删除 ID/hash 读回或抹去旧失败，均应失败；README 基线 bytes/mode 前缀另用 `git show <fixed-base>:<path>` 与当前文件字节比较。

### S-4
对应：I-4。仍只修改上述 README 新节，按 01 的原阶段保留完整责任：build 在修改前运行可失败只读内容断言留真实 RED，追加后同一断言真实 GREEN，并保留失败、修正、重复、零输出的原生命令/输出/整数退出码；发布前 verify 当场以固定 initial base 审完整 DAG、每条父边文件级 raw 路径/blob/mode、全 diff/index/worktree/全仓 untracked，README 原 bytes/mode 前缀及 manifest 相对 base 零差异，不能用发布后现况补证。当前 QA 只读 01/02、固定源码、精确测试 HEAD 的 Git 事实与可信有限来源投影；仅本轮 task/round/HEAD 精确绑定的 03/04 暂隐藏可解释，不读 03/04 正文或保护根；用可失败静态断言与内存破坏对抗核新节，并重新审完整逐父 DAG、当前 index/worktree/untracked。独立 judge 才消费真实 `judge-only historical_execution`，逐项绑定已登记 build/verify 的 stage/head/native 原命令、完整捕获输出和整数退出码，核 03/04 原 bytes/mode 的真实完整恢复；聚合输出不冒称任意 child stdout/stderr 全量，draft FAIL/CANNOT 不编译为 PASS，缺证 UNKNOWN。后续控制器与终态门在实际发生后独立核冻结 C01-C12 的恢复、source、正式 CI/preview、精确批准 HEAD、MERGED、Brain/Learning 读回与下次 tick 回收；main 同步若产生新 HEAD，不能把 `verifyMergeSource` 或 `requiredState` 视为新 QA/judge/preview，须在新 HEAD 上真实完成并核对这些结果，缺证则阻断终态；纯本轮合法记录提交仅按 S-2 的窄例外处理，不能借已完成 A 的信用。真实调用方 shape：仅既有控制器/QA/judge 读取文档和可信来源投影，出处为 `runner/README.md` 现有“历史执行证据与本轮 QA 的责任边界”及 `runner/lib/source-merge-proof.mjs`；无新增 API/CLI。失败语义与输入对抗面：来源错配、缺历史输出、隔离越界、重复/并发登记时相应阶段失败或 UNKNOWN，禁止补造现场、伪造 PASS、重跑旧阶段替代历史。验证：真实可失败只读断言检查各阶段谓词、命令与责任归属；内存反例把发布前非 Git 现场交给当前 QA、让 QA 读 03/04、把 hash 当原生命令或把未来终态提前判 PASS，均应失败。

## QA 场景

### Q-1
对应: I-1
前提: PR 预览环境已起 Brain；当前测试 HEAD、固定 initial base 由 QA 只读核实。无业务测试数据。
操作: 用本轮可信控制器给出的固定 `env_url`，先验证字面主机只能是 `localhost` 或 `127.0.0.1` 且保持同 origin；只读 GET `<预览环境>/api/brain/health`，禁跟随跨源重定向，仅核响应 `git_sha` 等于测试 HEAD 且为隔离预览。随后在当前 checkout 运行真实 Node 只读内容断言读取 README 新节和 `terminal.mjs`、`merge-gate.mjs` 固定源码，逐项核 S-1 的两次 ready、前后 GET、最终 match-head-commit、人工仓分流；对内存副本分别删“非批准”、删前后 GET、删 CAS，再运行同一断言。
期望: 身份 GET 只证明预览身份，不算产品 PASS；原文断言 exit 0，三种破坏副本均非零。新节把早期 ready 与批准后 ready 分开，并且没有把 ready 或 `completed` 写成合并。

### Q-2
对应: I-2,I-4
前提: 当前测试 HEAD 是本轮固定 Git HEAD；initial base 只能是 `7724d4f246453d6a90b5c451e63d80fbb586628d`。03/04 的暂隐藏仅可依赖可信控制器给出的本 task/round/HEAD 隔离投影；若来源未提供则该部分不能验。
操作: 在当前 checkout 只读运行 `git rev-parse --verify 7724d4f246453d6a90b5c451e63d80fbb586628d^{commit}`、`git merge-base --is-ancestor 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD`、`git rev-list --parents 7724d4f246453d6a90b5c451e63d80fbb586628d..HEAD`；对该输出的每条父边运行 `git diff-tree -r --raw --no-abbrev <parent> <child>`，另运行 `git diff --raw 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD`、`git diff --cached --raw`、`git diff --raw`、`git ls-files --others --exclude-standard`，逐项核实际路径/blob/mode/归属。只读断言新节明确四种 SHA、产品新 HEAD 重验、纯本轮记录提交的严格来源例外及 main 同步证明，并对照 `merge-gate.mjs` 与 `source-merge-proof.mjs` 核 QA 后同步不会凭旧轮次直接准入；用内存副本将 squash SHA 当测试 SHA、把同步简单减 main、把来源证明当作新 HEAD 的 QA/judge/preview，再运行断言。
期望: 固定 base 确为祖先；所有父边和当前三类现场均有完整审计，只有本任务合法 Markdown、可信精确 manifest 增量及经完整证明的同步可通过；03/04 仅准确暂隐藏可解释。原文断言 exit 0，三种破坏副本非零；任何 Git/来源事实缺失或越界都不能 PASS，不能以当前工作区补证发布前现场。

### Q-3
对应: I-3
前提: 当前 checkout 的固定 base README 可由 Git 只读读取；不依赖实际已合并 PR 或现存 Learning。
操作: 运行 Node 只读命令取 `git show 7724d4f246453d6a90b5c451e63d80fbb586628d:packages/brain/scripts/coding-workflow/runner/README.md` 的原始 bytes 与 `git ls-tree` mode，对当前 README 检查其原字节为精确前缀、mode 相同，且只在文末出现新节；再读新节与 `pr-sync.mjs`、`merge-gate.mjs`、`merge-learning.mjs`、`pr-closure.mjs`，断言 pending、next tick、Learning ID+全文 hash、preview stopped、handoff、旧失败保留均被准确描述。把内存副本改成“Brain completed 即全闭环”“`receipt_pending=false` 即 Brain 已独立读回”和“Learning POST 成功无需读回”分别复验。
期望: 原 bytes/mode 及 A14/A15 实际基线内容完整保留；原文断言 exit 0，三种破坏副本非零；Brain PATCH 后读回须由后续终态门实际 GET 核实；未发生的合并、Learning/preview 回收只列为后续责任，当前 QA 不伪造业务记录。

### Q-4
对应: I-4
前提: QA 仅有 01/02、固定源码、当前 HEAD Git 事实和可信有限来源投影；无须也不得重建发布前工作区。
操作: 从当前 checkout 运行 Node 只读阶段断言，检查新节将 build RED/GREEN、发布前 verify 原生现场、当前 QA 静态及内存反例、judge-only 历史来源、会话后恢复与终态 C01-C12 分配到原发生阶段；把内存副本分别改成“QA 读取 03/04 正文”“过去 PASS/hash 证明发布前命令”“未来登记/合并已 PASS”，重跑断言。QA 不执行产品 CLI、不读 03/04 或保护根、不 POST 任何 API。
期望: 原文断言 exit 0，三种反例非零。发布前与 judge/控制器的历史、未来条件保持在规格里，但当前 QA 不越权代验；缺可信事实时明确不能验，不能从旧 A、旧 PASS 或当前 HEAD 推断通过。

## 铁律对照

- INV-3a390000：S-4、Q-4 覆盖；候选预览及正式 CI 未真实通过前不宣称生产晋级。
- INV-45cd3ec2：不适用：本任务不新增、修改或执行带生产写入保护的 smoke；已撤销的 INV-ff177feb 不作为现行退出码要求。
- INV-ff177feb：不适用：该条已被 INV-45cd3ec2 撤销，本任务不碰 smoke guard。
- INV-696c9f96：S-1、S-4 覆盖；沿用现有 coding runner、QA 和独立 judge 的准确角色，不创造新指挥体系。
- INV-02d8e749：S-1、S-4、Q-4 覆盖；QA、judge、正式 CI/preview 与合并门责任均保留，不以文档或旧信用缩减验收。
- INV-0dc6b84f：不适用：本任务只写 README，不改模型选择或执行地。
- INV-ac7c8801：不适用：本任务只写 README，不改模型选择或执行地。
- INV-e8230eb5：S-1、Q-1 覆盖；生成与文档阶段不自行合并，合并归真实控制器门。
- INV-26886b60：S-2、S-4、Q-2 覆盖；提前合并或 head 漂移不得借旧 verdict，必须核实际 PR head 与批准来源。
- INV-09fb5c69：S-4、Q-4 覆盖；CI 绿不能顶替 QA/evaluator 与独立裁判。
- INV-8d92f7b1：S-4、Q-4 覆盖；本轮事实以固定 base、实际 Git 与可信来源核实，不照搬旧 sprint 的执行历史。
- INV-dc18d43d：S-4、Q-4 覆盖；文档只解释现有机械来源门，不把 LLM 叙述当生命周期事实。
- INV-5e125909：S-2、Q-1、Q-2 覆盖；预览 URL 取本轮可信投影，Git 比较固定实际 base，不写死服务地址或假设 HEAD。
- INV-3c30394c：S-4、Q-1、Q-4 覆盖；真实预览仅做身份 GET，未发生的合并/回读接缝交后续真实环境核验。
- INV-564802ee：S-4、Q-1 覆盖；预览身份不读取、不伪造或记录凭据。
- INV-50954d28：不适用：不新增或修改 API 端点；预览 health 只读身份核验沿用现有桥授权。

## 判定点

- 预览身份｜候选: URL 字符串或只读 health 精确 SHA/隔离身份｜所选: 本轮可信固定 env_url 的同源 health GET｜依据: URL 本身不能证明部署版本，当前 QA 又只获准此只读请求｜误判后果: 把错误版本当本轮预览。
- 合并闭环｜候选: Brain completed 单字段或 GitHub MERGED 加精确 head、Brain/Learning 读回与下次 tick 回收｜所选: 后者由实际终态门逐项核｜依据: completed 早于合并，squash SHA 与 PR head 不同｜误判后果: 未合并或待办未清被报为全闭环。

## 未覆盖真实链路

- 发布前 build RED/GREEN 与 verify 当时的 index/worktree/全仓 untracked、原生命令完整输出及整数退出码：当前 QA 仅验当前 HEAD、文档静态语义与当前 Git 现场；历史由当时原生账、独立 judge 和外层门核，缺证不能通过。
- 03/04 会话后原 bytes/mode 完整恢复及 `judge-only historical_execution` 的真实登记绑定：当前 QA 只接有限来源投影且不读 03/04；恢复后由独立 judge 核，缺证记 UNKNOWN。
- 正式 source/CI/preview、精确批准 HEAD、实际 GitHub MERGED/squash SHA、Brain 与 Learning ID+全文 hash 读回、预览 stop 和下次 tick pending 回收：当前 QA 只验 README 叙述与预览身份 GET；实际发生后由控制器与终态门按冻结 C01-C12 核，未发生不能 PASS。
- 读代码发现的需求外存量行为或其它调用方校验：本轮仅追加指定 README 小节，建议另立任务。
