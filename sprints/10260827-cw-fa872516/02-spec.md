---
task_id: fa872516-0694-46ed-b9f1-ce81763ca9b4
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### S-1
对应：I-1。仅修改 `packages/brain/scripts/coding-workflow/runner/README.md`：以固定 initial base `5f514a8523ef3f40fb671ff8f3a90947597d0628` 的 README 全部原始 bytes、mode、先后顺序为前缀，只在文末追加标题恰为 `## QA 修复的文件合同与验证方式` 的新节。新节准确说明 `runner/lib/qa-gate.mjs` 的 `qaFix` 用 `loadPrompt('qa-fix', ...)` 加载 `prompts/qa-fix.md`，再经 `runClaude` 交现行 provider 适配器执行；`runClaude` 是历史函数名，不要求 Claude 账号，Codex 通道由现行配置选择。修复者先读 `INTENT_PATH` 和 `SPEC_PATH`，两者共同约束允许的文件与操作；通用修复、验证要求不能扩大授权。不得复制未合并旧 B 内容或改程序、仓库测试、配置、开关、凭据、运行状态。

新增节的许可边界是闭集：本任务仅可编辑上述 README 文末新节；`qa-gate.mjs`、`lib/claude.mjs`、`prompts/qa-fix.md` 仅供只读核对；文档验证仅用合同许可的只读内容断言和内存对抗。代码 bug 的测试与修复仅在其原合同允许的文件和操作范围内进行。新增节任何位置不得再授予修改其他文件、运行产品 CLI、扩大验证操作或绕开冲突升级的权限；保留正确句子同时夹带相反授权也不合格。用户看到的新节须全文满足此边界。

验证：发布前 verify 与当前 QA 分别以 `git show 5f514a8523ef3f40fb671ff8f3a90947597d0628:packages/brain/scripts/coding-workflow/runner/README.md` 取得固定原文，并用二进制前缀断言核新 README 的开头 bytes 完全相同、尾部仅有一个本轮新节；用 `git ls-tree 5f514a8523ef3f40fb671ff8f3a90947597d0628 packages/brain/scripts/coding-workflow/runner/README.md` 与当前精确 HEAD 的 `git ls-tree` 比 mode。只读核 `qa-gate.mjs`、`lib/claude.mjs`、`prompts/qa-fix.md` 的上述调用与配置路径；按 S-1 至 S-4 独立审定新增节全文并固定为断言内联预期文本，逐字比较整个新增节，不能从被测 README 自动生成预期文本或只靠旧前缀、正向词句过关。

### S-2
对应：I-2。仍只改 `packages/brain/scripts/coding-workflow/runner/README.md` 的同一新节：写明文档及限定文件的合同许可验证是可失败的只读内容断言和内存破坏对抗；build 先在修复前真运行同一断言得 RED，再修复得 GREEN，保留原生命令、完整捕获输出、整数退出码以及失败、修正、重复、零输出。内存反例应把新增节缺失、关键语义被反转、范围被扩大等变体判失败；不能打印 `PASS` 代替断言。不得因通用 TDD 新增本合同禁止的测试、程序或配置，不得先提交越界文件再删除掩盖逐父历史；本文档任务不新增仓库测试，也不调用产品 CLI。

验证：build 原生账核同一只读 Node 断言对修复前 README 返回非零、修复后返回 0，并核内存变体均非零；当前 QA 在精确测试 HEAD 重新运行对新增节全文逐字比较的只读 Node 断言与内存变体。除删除、反转外，还须保留全部正确句子，在内存给新增节插入“修复需要时可修改 qa-gate.mjs”以及合同外操作许可，确认插入成功后用同一全文断言判非零；预期文本须先按 S-1 至 S-4 独立审定，不能由被测节复制生成。未变异成功属于验证无效，不判产品失败。发布前 RED/GREEN 的真实时序、命令、完整输出与退出码由当时控制器原生事件和 verify 留证，后续仅由独立 judge 历史来源门核，当前 QA 的重跑不得替代过去现场。对外文档的失败语义：断言非零或证据缺失就是未通过，可在本轮合法修复后重新验证；非法、超长、重复或并发输入不能成为扩展文件合同的理由，逐父范围与来源不明时失败关闭。

### S-3
对应：I-3。仍只改 `packages/brain/scripts/coding-workflow/runner/README.md` 的同一新节：明确代码 bug 在原合同允许范围先写失败测试，再修复并永久保留回归；文档分档不能免掉代码回归。若本次 QA 问题与原 intent/spec 或前轮裁决冲突、或许可范围内做不成，修复者不提交改动，最后独立一行输出 `RULING_CONFLICT: <本次条目> 与 <需求/规格条款或前轮条目> 矛盾：<各自要求>`，由既有控制器识别并升级，不自动放宽合同或裁决、不声称新增机械 allowlist；保留受保护路径与削弱测试检查。该规则只说明现有行为，不在本文档任务实现新的控制器语义。

验证：对新增节做只读内容断言，并在内存中分别删去“永久保留回归”、改成“文档任务也新增测试”、改成“冲突时仍提交”等反例，断言均失败；只读核 `prompts/qa-fix.md` 与 `runner/__tests__/qa-fix-contract-scope.test.mjs` 的现有合同和冲突路径。真实修复入口以 `runner/lib/qa-gate.mjs` 中 `loadPrompt('qa-fix', { QA_REPORT_PATH, INTENT_PATH, SPEC_PATH, QA_ISSUES, PRIOR_RULINGS })` 和 `runClaude` 为出处；它是内部提示词调用，不新增 HTTP 接口。失败语义为冲突时无修复提交并升级，超长或重复问题仍须逐条受原合同约束，不能借重复提交或并发修复越界。

### S-4
对应：I-4。仍只改 `packages/brain/scripts/coding-workflow/runner/README.md` 的同一新节：准确分开当前 QA 的静态/内存断言，与仅供独立 judge 使用的已登记 build/verify 原生历史。当前 QA 只读 `01-intent.md`、`02-spec.md`、固定源码、精确测试 HEAD 的 Git 事实及可信控制器给的有限来源投影；不读 03/04 正文或保护根，不重造发布前 index/worktree/untracked。控制器对 03/04 的临时隐藏只可按本 task/round/HEAD 的可信隔离投影识别，不能视为恢复完成。固定 initial base 到当前 HEAD 须审完整 DAG 每条父边的递归文件级 raw 路径/blob/mode、全 diff、当前 index/worktree/全仓 untracked；只允许本任务准确 Markdown 与可信控制器对合法 Markdown 的 `owner=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation` 精确 manifest 增量，旧 raw 历史与顺序保留。可信 main 同步须具备完整可信链、准确双父、实际 main ref、全 tree/source gate 证明，不得以浮动 main 或简单减去 main 的差异代替。发布前 verify 当场核固定基线至当时 HEAD 及 index/worktree/untracked，README 原 bytes/mode 前缀和 manifest 相对基线零差异；其非 Git 现场仅由当时原生命令的完整输出、退出码及独立外层门承担。当前 QA 仅核当前现场和合法来源，不以当前干净状态、hash、metadata、旧 PASS 或登记 hash 追认旧现场。judge-only `historical_execution` 须由真实已登记 stage/head/native 与 03/04 的真实完整恢复及受保护来源门核定，保留失败、修正、重复、零输出及 draft FAIL/CANNOT_VERIFY，不把 `aggregated_output` 说成任意子进程 stdout/stderr 完整分流；缺证记 UNKNOWN。后续恢复、精确批准 HEAD、正式 source/CI/preview、真实 MERGED、Brain/Learning 读回及下次 tick 回收，按冻结 C01-C12 在实际发生后由控制器和终态门核，未发生不得 PASS；代码/产品/可信 main 同步产生新 HEAD 须重新真实 QA、judge、CI、preview。若本轮合同允许仅 05/06 准确记录的纯登记提交，来源链须证明未改产品和旧历史，且 `approved.head` 合法绑定真实记录 HEAD，不声称模型测过该记录 HEAD，也不制造无限重验循环。

验证：当前 QA 先在精确测试 HEAD 执行 `git merge-base --is-ancestor 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD`，仅退出 0 才继续；非 0 即 FAIL/CANNOT_VERIFY，不以末端 tree 或 diff 相同替代。随后执行 `git rev-list --parents 5f514a8523ef3f40fb671ff8f3a90947597d0628..HEAD`，范围内无父节点不得跳过，须判 FAIL/CANNOT_VERIFY；对其余每个子提交的每个真实父提交运行 `git diff-tree -r --raw --no-abbrev <parent> <child>`，另执行 `git diff 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD --raw`、`git diff --cached --raw`、`git diff --raw`、`git ls-files --others --exclude-standard`，并按可信投影审逐项归属；固定 base 不是变量 main。发布前 verify 在当时 HEAD 也先核相同祖先关系，再对当时现场执行同一组原生命令并留完整结果；judge、控制器、终态门各在真实时点核各自来源、HEAD 与结果。文档对外失败语义是任何身份漂移、非法/超长来源字段、重复登记、并发造成的 HEAD 漂移或缺证都不能宣称通过，只能按对应阶段失败或 UNKNOWN 后重新从可信事实核验。

## QA 场景

### Q-1
对应: I-1
前提: 本 PR 预览环境已部署精确测试 HEAD；QA 从该 HEAD 只读取得 `01-intent.md`、`02-spec.md`、README、`runner/lib/qa-gate.mjs`、`lib/claude.mjs`、`prompts/qa-fix.md`；固定 base SHA 按 I-1 给定，不从生产数据生成。
操作: 在 PR 检出的仓库根目录只读对照上述三份源码中的真实调用；逐句审定 README 新节全文是否仅含 S-1 至 S-4 允许的文件和操作权限，将审定后的完整新节作为独立内联预期文本固定到 `node -e` 断言中，不从 README 反取预期。运行断言：按最后一个 `## QA 修复的文件合同与验证方式` 切节，核该标题仅出现一次且节位于 EOF、全文逐字等于预期，并核 `qaFix → loadPrompt('qa-fix') → runClaude/provider`、`INTENT_PATH` 与 `SPEC_PATH` 双重约束、历史函数名与 Codex 配置选择；不执行产品 CLI。
期望: 全文无额外文件或操作授权且断言退出 0；任一关系缺失、写反、夹带越界授权、只在旧前缀出现或新节不在文末时退出非零，QA 不报通过。

### Q-2
对应: I-2,I-3
前提: 只读使用当前精确测试 HEAD 的 README 与 `prompts/qa-fix.md`，不创建仓库测试或业务数据。
操作: 运行只读 `node -e` 断言，将 Q-1 独立审定的完整预期节内联为常量，对当前新节做全文逐字比较，并核“只读内容/内存对抗 RED→GREEN 且保存原生输出和退出码”“文档任务不新增仓库测试或产品 CLI”“代码 bug 在合同范围内先失败测试并永久保留回归”“冲突不提交并输出独立 `RULING_CONFLICT`”等语义。再按新节实际措辞在内存删除整节、反转“永久保留回归”“文档任务不新增合同禁止的测试”“冲突不提交”，并分别在全部正确句子仍在时插入“修复需要时可修改 qa-gate.mjs”和“验证时可运行产品 CLI”。每个反例先确认原文匹配、插入或替换成功且目标语义改变，再用同一全文断言检验。
期望: 原节断言为 0，有效内存反例均为非零；尤其保留正确句子但增加任一合同外授权也不能过关。未成功变异的反例判为验证无效，不能据此判产品失败。不产生文件或提交。此结果只证明当前文档可失败，不代替 build 当时 RED→GREEN 的原生历史，后者由 judge-only 来源门核。

### Q-3
对应: I-4
前提: 控制器提供本轮 task、round、精确测试 HEAD 和有限可信来源投影；固定 initial base 是 `5f514a8523ef3f40fb671ff8f3a90947597d0628`。03/04 若暂隐藏，仅以可信投影准确识别其临时删除；任何缺失的固定 Git 事实或来源事实如实不能验。
操作: 在本 PR 检出的仓库根目录只读运行 `git rev-parse HEAD`、`git cat-file -t 5f514a8523ef3f40fb671ff8f3a90947597d0628`，再运行 `git merge-base --is-ancestor 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD`；仅退出 0 才运行 `git rev-list --parents 5f514a8523ef3f40fb671ff8f3a90947597d0628..HEAD`。若范围内有无父节点则停止并报不能验；否则对每条父边运行 `git diff-tree -r --raw --no-abbrev <parent> <child>`，并运行 `git diff 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD --raw`、`git diff --cached --raw`、`git diff --raw`、`git ls-files --others --exclude-standard`。以 `git show <base>:packages/brain/scripts/coding-workflow/runner/README.md` 和 `git ls-tree` 核 README 原始 bytes/mode 为当前文件前缀且只新增本轮节；逐项对照可信来源投影核本任务 Markdown、精确 manifest 登记、03/04 暂隐藏和可能的可信 main 同步。
期望: base 确为可读提交且是当前精确 HEAD 的祖先，当前 HEAD 与本轮身份相同；所有父边递归 raw、全差异和现场文件均能逐项解释且无越界；README 固定前缀与 mode 未变。祖先核验非 0、范围内有无父节点、投影缺失、HEAD 漂移、父边未核、额外未跟踪文件或任何归属不明，均为 FAIL/CANNOT_VERIFY，即使最终 tree 或 diff 相同也不通过；不读取 03/04 正文、保护根或发布前报告，不把暂隐藏算恢复。

### Q-4
对应: I-4
前提: 可信控制器给出本轮固定 `env_url` 与精确测试 HEAD；该 URL 必须是字面量 `localhost` 或 `127.0.0.1` 且符合本轮预览能力。没有该可信 URL 则本场景不能验。
操作: 先只读校验 URL 主机与 origin，随后只对 `<预览环境>/api/brain/health` 发一次同源、禁重定向的 `GET`，不加伪造鉴权 header、不请求其他 API、外网或端口，也不执行产品 CLI；比对响应的 `git_sha` 与精确测试 HEAD，并核可信预览隔离标识。
期望: 身份 GET 确认本 PR 预览确实运行该 HEAD 且隔离；非 2xx、重定向、非本轮 origin、SHA/隔离不符均为不能验。该 GET 仅是预览身份核验，不是 README 产品 PASS，也不证明后续正式 CI、合并或回收。

## 铁律对照

- INV-3a390000：S-4、Q-4 覆盖；预览和后续正式验收未过不得晋级生产。
- INV-2fe86d34：S-4、Q-3 覆盖；运行事实与版本取受保护来源及精确 HEAD，不用标签代替。
- INV-b3a8bf82：S-4、Q-3 覆盖；合同、仓库实现、任务身份、原生运行账及版本记录各按原真身引用。
- INV-e5ab4826：S-4、Q-3 覆盖；沿用既有任务、运行和版本来源，不另建平行账本。
- INV-45cd3ec2：不适用：本轮不新建或修改 smoke guard；该条撤销了 INV-ff177feb 的 exit 1 口径。
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，且本轮不修改 smoke。
- INV-91e9abe3：S-1、Q-1 覆盖；准确说明本机 coding 通道依现行 provider 配置，函数历史名不决定账号。
- INV-3859041e：S-1、Q-1 覆盖；不把 qaFix 文档解释成恢复已关停的 Brain 桥接通道。
- INV-067867c8：S-1、Q-1 覆盖；文档不要求经已关停的 `:3457` 桥接调用 Claude。
- INV-696c9f96：S-1、Q-1 覆盖；沿用现有 coding workflow 与 commander 名称，不创设新角色。
- INV-02d8e749：S-4、Q-4 覆盖；当前产品 QA 与后续独立 judge、预览及正式门分阶段保留。
- INV-0dc6b84f：S-1、Q-1 覆盖；仅说明当前代码按配置选择通道，不改已拍板执行地或模型配置。
- INV-ac7c8801：不适用：该旧模型版本规定已由 INV-0dc6b84f 修订；本轮不改模型配置。
- INV-751f73be：S-1、Q-1 覆盖；文档不自动激活 Claude 或改变已封停通道。
- INV-42d6c346：S-4、Q-3 覆盖；来源不足与实现缺陷分开记录，不把证据缺失直接当产品通过。
- INV-a39272f7：S-2、S-4 覆盖；原生 RED/GREEN、命令、输出和退出码保留给对应来源门，不用压缩摘要替代。
- INV-8d92f7b1：S-4、Q-3 覆盖；固定本 task 基线和真实执行来源，不照抄旧任务历史。
- INV-26886b60：S-4 覆盖；若出现提前合并，仅后续终态门按实际合并 HEAD 与裁决身份核，不由当前 QA 预认。
- INV-dc18d43d：S-3、S-4 覆盖；文档只说明现有控制器机械闸，不能用模型自述改生命周期或账。
- INV-09fb5c69：S-4、Q-4 覆盖；CI 绿不代替当前 QA、裁判及最终交付范围核验。
- INV-3c30394c：S-4、Q-4 覆盖；真预览身份可验才认当前 QA 接缝，后续真实目标未发生不报完成。

## 未覆盖真实链路

- 发布前 build 的真实 RED→GREEN、verify 当场 index/worktree/全仓 untracked 与 manifest 零差异：当前 QA 只能验当前内容和 Git 历史；过去非 Git 现场缺当时原生命令、完整捕获输出、整数退出码及独立外层核验时，该阶段与终态不能通过。
- judge-only 已登记 build/verify 历史和 03/04 会话后原 bytes/mode 恢复：当前 QA 不读保护根或 03/04 正文；只能验可信有限来源投影，实际恢复和历史绑定待独立 judge、控制器来源门在发生后核。
- 正式 source/CI/preview、精确批准 HEAD、真实 MERGED、Brain/Learning 读回与下次 tick 回收：当前 QA 只验预览身份及本轮 README；各事实未发生或无可信回执时按冻结 C01-C12 留在后续控制器和终态门，不能以本轮 QA PASS 补证。
