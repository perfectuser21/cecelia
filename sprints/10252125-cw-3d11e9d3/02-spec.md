---
task_id: 3d11e9d3-3660-4412-afba-722c7a1936c3
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# QA 准备失败与保留现场：实现规格

### S-1
对应 I-1。产品只编辑 `packages/brain/scripts/coding-workflow/runner/README.md`，在文末追加标题“QA准备失败、保留现场与升级如何判读”。依据当前 `packages/brain/scripts/coding-workflow/runner/lib/pr-checkout.mjs`、`lib/pr-branch.mjs`、`lib/worktree.mjs` 写清：`preparePrWorktree` 先抓实际 `origin/<branch>`，分支未占用时普通 worktree 检出；占用时以所抓的 40 位 SHA、原仓 `origin` fetch URL 与 pushURL 建 `git clone --shared --no-checkout --no-hardlinks` 独立仓，在其中检出同名真实分支。共享对象不等于共享 refs/index；原失败工作树、原分支不可被覆盖。清理由 `.git/coding-workflow-pr-checkout.json` 的 schema、repo 实路径、worktree 实路径和分支归属共同决定；不明独立仓返回失败，普通 linked worktree 才走原 `git worktree remove` 路径。验证：对固定 HEAD 上述三个源码与最终 README 做只读、可失败的逐项静态断言；不存在任一必要分支或文档声称共享 index、删除原现场即失败。不运行导出的准备/清理函数。

### S-2
对应 I-2。仍只编辑上述 README。依据 `lib/qa-gate.mjs` 及 `lib/config.mjs` 的实际阈值来源，文档明确 `qa-<pr>.json` 的 `bad` 是准备或 evaluate 异常计数、`rounds` 是已形成的 QA 轮记录，`verdict=FAIL` 是 QA 语义结论、`judge` 是独立裁判结论、`escalated` 是交 coding commander 的升级记录，Commander `HUMAN` 另看真实终态。给出标明“示例数据、不是现场运行结果”的 `{"bad":1,"rounds":[]}` 和达到配置 `qaMaxBadStreak` 的升级示例；说明 `inPrWorktree` 受保护 `try/catch` 内异常才累计并在达到阈值时走 `qa_evaluator_broken`，不得泛化为任意 OS 异常均被捕获。失败语义：准备失败可留下 `bad`、日志与现场，达到阈值是升级待裁而非产品 FAIL/PASS/HUMAN；后续是否重试由既有控制器状态决定。输入对抗面：同名分支、重复异常、非法/未知归属及清理失败均不得在文档中导向强删或手改状态。验证：只读静态断言对照 `readState`、`inPrWorktree`、`escalate`、`report`、`judgeStep`、Commander 状态源码及示例 JSON 内存解析，逐项断言语义和阈值来源。

### S-3
对应 I-3。仍只编辑上述 README。补充 report 投递失败与本地 QA 状态、Brain task 状态、产品判定分别核账：`report` 的 Brain patch 失败只记录 HTTP 失败日志，不能将投递失败写成产品结果；正常恢复不删除原错误、失败尝试、GAN FORCED 和历史失败，不补写或追认旧样本。未知 marker/路径/归属或清理返回 false 时只读保留并升级排查，不给删目录、删分支、改状态、手动 ready 或生产操作命令。基线 README 的全部原始字节、模式及 A11/A12 原文顺序保留；新增节位于文末，原文允许保持顺序的非连续呈现，不要求复制旧 B12/未合并 PR 正文。验证：以固定基线 `git show 0bbee7b45e4ce79ed2752785fbdb0fd805357879:packages/brain/scripts/coding-workflow/runner/README.md` 与当前 README 做字节及 mode 对照，并只读搜索上述错误路径和保留措辞；静态断言必须能因删改关键句而失败。build 阶段先真实运行会失败的只读产品断言留 RED，再追加文档，再运行同一断言留 GREEN；这些当时的命令、完整输出、退出码由可信控制器保留，当前 QA 不补演过去 RED。

### S-4
对应 I-4。产品编辑文件仍只有 `packages/brain/scripts/coding-workflow/runner/README.md`。发布前 verify 以固定 `base_sha=0bbee7b45e4ce79ed2752785fbdb0fd805357879` 核 `git rev-list --parents --reverse <base>..HEAD`、`git diff --name-status <base> HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard` 的完整输出及退出码；先全仓枚举未跟踪项，再只按本任务真实 sprint 记录路径排除。核 README 基线原字节、mode 和顺序，以及 `.implementation-source-relations.json` 相对基线零差异；当前任务 sprint 记录单列证据范围，不读其它 sprint 报告，03-build 在 verify 时仅据本轮可信隐藏事实解释。发布前不验尚未发生的 publish/QA/judge/CI/merge/Learning/预览回收。发布后 QA/evaluate 固定同一个 initial base，对当前精确测试 HEAD 重新完整枚举 DAG，并对每个提交的每条父边执行 `git diff-tree -r --raw --no-renames -z <parent> <commit>`，取得全部变动路径及前后 blob/mode；再核全量终态差异、暂存区、工作区及全仓未跟踪项。逐父边清单与可信来源投影共同判归属；模型自产只许 README、真实本任务 Markdown 报告及可信控制器的准确来源增量，任何未知自产路径、mode/删除异常及改后 revert 均失败，不能从 final diff 简单减 main。真实调用方 shape：本规格不新增接口或脚本；QA 由 `lib/qa-gate.mjs` 向 `activities/evaluate.mjs` 以 JSON-stdio 传 `run_tag`、`task_id`、`worktree`、`sprint_dir`、`intent_ids`、`pr_number`、`round`、`head_sha`、`transcript_path` 等字段，QA 按该测试 HEAD 与工作树读文件，不自行构造生产 API 请求。验证：发布前原生 Git 命令当场核验；发布后按本轮可信来源投影与实际 Git 核对，投影缺失或不一致记不能验。

### S-5
对应 I-4，兼顾 I-1 至 I-3 的本轮证据归属。可信 publish/QA/Commander 控制器才可在 `.implementation-source-relations.json` 前部登记当前任务真实存在的合法 Markdown：publish 的 01/02/03/04 约定报告、QA 的本轮 `05-qa-report-rN.md`/`06-judge-rN.md`、Commander 的本轮 `07-commander-rN.md`；`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`、真实 sprint path，历史行不动、幂等且冲突拒绝。模型不得编辑、暂存或提交 manifest。可信 main 同步仅在 source gate 独立核实原 registration→stage→native 链、受保护 merge 凭证、真实 `gh pr view` 与 `git ls-remote` 前后采样、完整 DAG 的精确两父与共同基线、逐 blob/mode 全 tree 后，才可单独归属上游；上游触本任务 README 或报告、未知或缺证同步均拒。受保护 merge 事件只说明本地控制器 merge，推前第三次观察、撤销旧批准、push、最终远端 HEAD、正式 CI 和 GitHub merge 另核。每个新 HEAD 重新真实 QA、裁判、预览及正式 CI。QA 会话内只核本轮可信控制器给出的 `03-build.md`/`04-evidence.md` 临时隐藏事实与当前可见工作区，明确“完整恢复尚未发生”；不读保护凭证根、不重建隐藏报告。会话结束后控制器按原字节及 mode 恢复，独立裁判核本轮 task/round/test HEAD/session 的实际恢复保护凭证；缺证、变字节/mode、第三文件缺失即失败。本轮每次原生命令（失败、修正、重复、零字节输出）由控制器以完整命令、原生输出与退出码有序写入最终 05 全账，模型草稿原文及 FAIL/CANNOT_VERIFY 保真；旧失败与报告缺口不补写、不追认。实际合并、Brain 终态、Learning ID 与全文 hash 回读、下一实际 tick 停预览及清 pending 由外层 C01-C12 在发生后核验，A13 和 B13 各自完整闭环才计 2/2。验证：QA 只读当前 Git/投影/可见工作区；source gate、会话后裁判和外层终验各以其原生来源独立执行，不以 hash、exit 0、旧 PASS 或本轮 QA 自述代替。

## QA 场景

### Q-1
对应: I-1
前提: 本 PR 预览身份由控制器绑定当前精确测试 HEAD；QA 已取得该 HEAD 的只读仓库 checkout 和固定源码；无需业务数据。
操作: 在 checkout 中读取最终 README、`lib/pr-checkout.mjs`、`lib/pr-branch.mjs`、`lib/worktree.mjs`；运行只读 Node 断言，逐项查同名分支占用分支、fetch ref、40 位 SHA、clone 参数、origin/pushURL、checkout 分支、marker 归属、清理返回值与 README 对应叙述，并以删除一项关键匹配的内存文本验证断言会非零退出。
期望: 新节在文末；断言原样退出 0，删关键项的内存对抗退出非 0；文字明确共享对象与独立 refs/index，原失败现场不被覆盖，未知归属不宣称已清理。

### Q-2
对应: I-2
前提: 同 Q-1；示例 JSON 在 QA 命令内存中新建，不依赖环境已有 QA 状态。
操作: 读取最终 README、`lib/qa-gate.mjs`、`lib/config.mjs` 和 Commander 状态源码；用 `node -e` 在内存解析 README 示例 `bad=1, rounds=[]` 及阈值示例，并按源码静态断言 `try/catch`、`qaMaxBadStreak`、`qa_evaluator_broken`、`escalate`、`judge` 与 `report` 各自语义；故意从内存副本删去阈值来源再运行断言。
期望: 示例显式标“示例数据、不是现场运行结果”；`rounds=[]` 不判 QA FAIL/PASS，`bad` 到阈值只说明既有升级，不能推出 Commander HUMAN；源码断言原样通过、缺关键来源时非零，文档不宣称覆盖所有 OS 异常。

### Q-3
对应: I-3
前提: 同 Q-1；固定 initial base 可从真实 Git 历史只读取得，不能在 QA 人造基线或以生产替代。
操作: 只读查看 README 与 `lib/qa-gate.mjs` 的 `report`、`lib/pr-checkout.mjs` 的归属清理；用 `git show <固定initial base>:packages/brain/scripts/coding-workflow/runner/README.md` 和 `git ls-tree <固定initial base> -- packages/brain/scripts/coding-workflow/runner/README.md` 取得真实基线内容及 mode，运行只读字节和顺序断言；在内存改写一个旧段验证断言非零。查新增节对 report 投递、任务状态、历史失败、GAN FORCED 与清理失败的说明。
期望: 原 README 全部字节、mode 和既有段落顺序保存，A11/A12 内容未改；投递失败不等于产品或终态结论；未知归属/清理失败无强删、手改状态或生产指令；改写旧字节的对抗断言失败。若固定基线或历史事实缺失，Q-3 如实不能验，不重建。

### Q-4
对应: I-4
前提: 控制器提供本轮精确测试 HEAD、预览身份、固定 initial base、可信同步事实投影及本轮 03/04 临时隐藏事实；Git checkout 为当前 QA 工作树。任何来源缺失时如实不能验，不能凭旧轮记录补造。
操作: 在该 checkout 只读执行 `git rev-list --parents --reverse 0bbee7b45e4ce79ed2752785fbdb0fd805357879..HEAD`、`git diff --name-status 0bbee7b45e4ce79ed2752785fbdb0fd805357879 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，保存完整输出与退出码；对列出的每个提交，逐一取其所有父提交执行 `git diff-tree -r --raw --no-renames -z <parent> <commit>`，解析并保存每条父边的全部路径及前后 blob/mode，不只筛 README、报告和 manifest。先看全仓未跟踪名单，再按本任务实际流水线记录归属分类；据逐父边全路径清单及可信投影判定每次自产变更与同步归属，包括最终 diff 已消失的改后 revert；对声称同步的提交核两父、上游路径、全树归属及 source gate 给定结论，查上游是否曾碰本任务产品/报告或改后 revert。检查当前 README 与固定源码静态断言、当前可见工作区；只依据本轮隐藏事实解释 03/04 暂缺，记录恢复尚未发生。
期望: 当前 HEAD 的完整 DAG、全差异、暂存区、工作区和全仓未跟踪范围均可唯一归属；本任务产品只改 README，报告/manifest 增量符合本轮可信登记；同步仅在独立来源门全部证明时归上游，不能简单减 main。任何未知路径、错父、缺投影、越界或缺证均不能 PASS；QA 不读保护根、不自行恢复报告，也不要求在会话内证明未来的恢复、CI、合并、Learning 或清理。发布前 manifest 零差异和当时的工作区/RED 由当时 verify/build 原生命令及外层可信来源核验，Q-4 不重演；会话后完整恢复由独立裁判核，本轮全账和终态由相应控制器及外层 C01-C12 核。

## 铁律对照

- INV-02d8e749：S-2、S-5、Q-2、Q-4 覆盖（保留 QA、独立裁判及原闭环，不把升级当产品结论）。
- INV-696c9f96：S-2、Q-2 覆盖（coding commander 与独立裁判、产品 QA 分别判读）。
- INV-0dc6b84f：不适用：只追加运行判读文档，不更改执行模型或执行地。
- INV-ac7c8801：不适用：只追加运行判读文档，不配置 Claude 模型。
- INV-ff177feb：不适用：不新增或修改 smoke 脚本及其退出码。
- INV-e5ab4826：S-3、S-5、Q-3、Q-4 覆盖（任务账、运行账、Git 版本各核原生事实，不新设平行账本）。
- INV-3529e88f：S-4、S-5、Q-4 覆盖（固定 Git 与可信来源门机械核验，不靠模型措辞放行）。
- INV-09fb5c69：S-5、Q-4 覆盖（CI 绿和 exit 0 不替代产品 QA 与裁判）。
- INV-26886b60：S-5、Q-4 覆盖（实际合并须按精确 HEAD 与本轮裁决另核）。
- INV-dc18d43d：S-2、S-5、Q-2 覆盖（文档只解释既有机械状态，不发明新判态）。
- INV-1100cb8f：S-4、Q-4 覆盖（共享 CI 配置及 smoke allowlist 未获授权，不列入产品修改）。
- INV-26a1d06e：S-1、Q-1 覆盖（ref 存在性按源码的 `rev-parse --verify ...^{commit}` 对照）。
- INV-c906dd6c：S-3、Q-3 覆盖（断言须真失败，不能用无效测试命令的绿态代替）。
- INV-8d92f7b1：S-5、Q-4 覆盖（只认本轮实际 task、round、HEAD 和来源，不套旧样本现场）。
- INV-5e125909：S-2、Q-2 覆盖（阈值读取配置，不把示例数值写成现场常量）。
- INV-3c30394c：S-5、Q-4 覆盖（当前只读产品验收与外层真实运行终验分开，缺真凭证不报完成）。
- INV-564802ee：S-3、Q-3 覆盖（只读静态核验，不读取、记录或写入凭据）。

## 未覆盖真实链路

- 当前 QA 不执行产品 CLI、服务、模型、网络、生产 API 或真正建单；只验最终 README、固定源码、真实 Git 和可信投影的可失败只读断言，真实控制器运行结果由各阶段原生回执及外层终验负责。
- 发布前当时的暂存区、工作区、全仓未跟踪清单、RED 和 verify 原生命令只由当时控制器/verify 留证；发布后 Q-4 不能重建该现场，缺完整命令、输出、退出码时对应阶段不能通过。
- QA 会话结束后的 03/04 原字节与 mode 完整恢复、全账装配、正式 CI、实际合并、Brain 终态、Learning 回读及下一 tick 预览回收在本 QA 会话尚未发生；本轮 QA 只验当前可见状态，后续由独立裁判、控制器和外层 C01-C12 逐项核验。
- 若本轮可信同步事实投影或 source gate 凭证缺失，QA 只能验到当前 Git 差异与 README，无法把声称的 main 同步归属上游；必须报不能验，不读取保护根或补造凭证。
