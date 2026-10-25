---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: intent
upstream: []
---
# 回执常见误读与核账示例：补全只读FAQ

## 背景

这是实际运维手册补全，同时作为Codex常驻连续实跑验收。仅改 packages/brain/scripts/coding-workflow/runner/README.md 和流水线正常记录；不改程序、测试、开关、凭据或运行状态，不新增镜像单元测试。验收以真实读取最终README并用会失败的具体内容断言对照本次HEAD源码；无需启动/安装服务、浏览器、调用生产、账号、API或真正建单，不把dry-run当成功执行。spec只拟定验收，build先留红再写文档再真验证。本轮实际原生命令、完整输出和真实退出码由可信控制器完整保留并编入最终05报告的有序原生全账（含失败、修正、重复及零字节输出）；模型原始草稿完整保留，模型的PASS/FAIL/CANNOT_VERIFY语义结论不得被编译改成PASS。若草稿自己填写output，必须与本轮真实原生记录完整一致，不允许改写后自动纠正。报告无需手抄全部历史失败；旧失败及原始证据继续原样保留，不能删除、补写或追认；不更改任何验收器或门禁。新记录不得重写历史报告。 在现有README末尾纯追加“回执常见误读与核账示例”FAQ，不重复创建或重写已合并A11的“运行回执如何判读”小节。保留整份绑定基线README所有原始字节、模式及先后顺序；本次只在文末追加新内容。FAQ用明确标为“示例数据、不是现场运行结果”的小型JSON/文本样例说明：①不存在/空目录的[]不是健康证明；--log-dir和--json及mtime倒序如何读；②带last_event是running，completed/partial/failed/unreadable的区分，partial/failed首个非completed/skipped活动与最后attempt原因优先级；③completed缺PR URL仍completed，JSON reason_code=pr_url_missing、pr_url=null，文本completed行不打印该原因；④ci_fix次数和last_result、无记录null，合法qa/commander/pr-sync-pending等非回执JSON可能unreadable，不能据此删除待办/状态文件；⑤terminal.mjs会在发布后先把task.status写completed并将runner.phase标awaiting_qa（QA关时awaiting_manual_merge），而非证明已合并；应只读核实际GitHub PR/head、runner.phase=merged、result.merge.merged=true及其head、qa_state终态，Learning确认和下一实际tick预览回收分别核验，不能从completed或一个哈希越级推断全链成功；⑥结合deps.mjs说明前置completed只是必要输入，PR URL存在且无result.merged===true捷径时仍须GitHub MERGED；OPEN/未知等待、CLOSED拒绝，且源码对无PR URL或result.merged===true存在直接就绪分支，不能写成所有前置必经GitHub。FAQ可用new-task.mjs的--dry-run只校验不创建作“预检≠成功”的交叉提示，明确base_sha预检仅40位小写hex格式、不核提交存在性，不扩写成另一个提交任务章节。只用静态可失败断言对照当前固定源码和README；JSON样例只作内存数据解析，不执行样例中的shell命令、不运行new-task、不调用生产或真正建单。

本次A12是新任务，不重试、修补或追认旧A、A2、A3、A4、A5、A6或A7或A8或A9。产品编辑范围：模型只能改 packages/brain/scripts/coding-workflow/runner/README.md，不改程序、仓库测试、开关、凭据或运行状态；流水线各阶段仍按原合同生成指定路径的真实 Markdown 报告，不得因产品仅文档而省略必要证据。唯一额外版本化元数据许可：可信 publish、QA、Commander 控制器可自动在 .implementation-source-relations.json 前部新增当前任务合法 Markdown 的准确来源行，owner_path 固定为 packages/brain/scripts/coding-workflow/runner/run-once.mjs，role 固定为 documentation，path 必须是本次任务实际 sprint 路径；记录与该增量同提交，历史条目逐字不动，幂等且冲突拒绝。模型禁止直接编辑、暂存或提交此 manifest，也不得更改 owner/role 或替其它任务登记。许可仅覆盖 publish 的 01-intent.md、01-invariants.md、02-spec.md、02-review.md、02-review-rN.md、02-response-rN.md、03-build.md、04-evidence.md，QA 本轮 05-qa-report-rN.md/06-judge-rN.md，以及 Commander 本轮 07-commander-rN.md；N 为真实正整数轮次，不得编造报告。非 Markdown 附件或其它必要原生证据保留并遵守原有门禁；若当前来源合同不支持，诚实失败留证，禁止删除、改名伪装或少产附件规避门禁。QA 原生命令与输出、失败历史、精确 HEAD 批准和正式 CI 均按原标准核验；本许可不弱化任何真实 QA 要求。

阶段合同：acceptance中的I1-I4是发布前verify能够当场核实的产品验收。所有范围比较固定使用base_sha=05f28a953a9fa184ed53619eba2127a203edab0e，覆盖该基线到HEAD、暂存区、工作区及整个仓库枚举的未跟踪文件；不得改用浮动origin/main、仅最后一个提交或仅默认git diff。未跟踪文件先枚举整个仓库，仅按实际本任务流水线记录路径排除，不可先限定README路径而漏掉越界文件。verify只读01-intent及真实仓库/源码，不读取其它sprint报告；03-build在verify期间按设计被临时隐藏，不得以此判漏产。I4只验证此时可见的产品改动、基线README原文保留及受控manifest未改；尚未发生的publish、QA、judge、Commander、CI、merge、Learning和预览回收不属于发布前I4。流水线各阶段仍须真实执行并保存证据，后续报告和可信来源增量由对应控制器产生。项目外层独立观察者在它们实际发生后按原C01-C12逐项核验，包括原生命令/输出/退出码、精确HEAD、正式CI和实际合并、Brain终态、Learning回读与下一次tick停预览；未发生的阶段不得宣称通过，完整成功标准没有减少。
阶段间同一意图的解释：后续QA/evaluate继续核实README产品内容、真实CLI行为及许可范围；不得把I4的“发布前manifest零差异”再次施加于publish后的HEAD。发布后仍完整枚举固定initial base到当前HEAD的所有差异、暂存区、工作区及整个仓库未跟踪文件；initial base就是本计划固定base_sha，始终不变，不改用浮动main、最近merge-base、最后一个提交或仅本任务相对main的差异。逐提交和逐路径严格区分本任务自产变更与下述实际可信控制器main同步；完整差异必须保留并说明，不能简单从final diff减去main差异。
本任务自产变更仍只允许README产品编辑和上文真实流水线报告及可信来源增量：原README字节及先后顺序保留、历史报告不改，模型禁止编辑/暂存/提交manifest，登记的path/owner/role/任务绑定和历史条目要求不变。其它程序、测试、配置或任何未知自产修改均失败；先改后revert也不能因最终字节相同而放行。
唯一新增的发布后归属合同是可信控制器main同步，且只有以下事实全部成立才可单独归属为上游而不冒充本任务自产变更：从固定initial base到最终HEAD的完整DAG逐提交有依据；每个同步提交精确两个父，第一父是此前已核本任务HEAD，第二父是独立实际main ref事实绑定的固定完整SHA，唯一共同基线及前后身份一致；不得用本地同名ref、模型说明或hash相等冒充真实main。原registration→stage→native来源链和独立受保护merge凭证必须由可信source gate逐项严格核验，绑定当前task/sprint、controller实际源码身份、固定输入、原登记ID、精确父和实际tree。merge由可信控制器最终提交，不由模型提交受保护文件；缺凭证、错身份、未完成或事后补造均失败。
这里的独立 main ref 事实是可信控制器在本地合并前、合并完成后采集的 gh pr view 与 git ls-remote 原生响应及摘要；前后身份一致只指这些采样时点，不代表远端锁或持续不变。受保护 merge 事件的 evidence_scope 为 local_controller_merge_only，不证明 push、auto 已关闭、QA/CI 通过或 GitHub 已合并。推前第三次观察 remote_pre_push、旧批准撤销及 push 结果另由实际 ci_fix 回执核验，最终远端 head、正式检查和合并仍按 C04–C06 独立读取。
每个同步的完整Git tree必须逐blob和mode核验：上游非本任务路径保留该真实main原文、模式及合法删除；本任务README与既有报告完整保留第一父的实际字节和模式；manifest只接受可信控制器以真实main完整有序历史为底、携带本任务已证明来源增量的确定性结果。不能复活main已删除的无关历史来源，不能丢失本任务必要登记；同path异值、重复、未知字段、越界行均拒。这里对上游manifest历史变化的单独归属只限真实可信同步，不授权模型修改历史或重写报告。上游任一新增提交只要触及本任务产品README或本任务报告，即使随后revert也拒绝同步；不支持任意产品冲突解决。任何路径、提交、权限/模式或删除无法唯一归属、任何未受证明的同步均失败，不以最终树碰巧相等代替过程证明。
QA仍独立从固定 initial base 完整枚举提交DAG、逐路径差异、暂存区、工作区和全仓未跟踪文件，并验README许可范围；可信 source gate 则重验最早真实 intent 输入HEAD起的同步链、每次两父/共同基线、上游历史路径、全tree、受保护merge事件及原 registration→stage→native 关联。两类检查均通过才可归属同步；来源投影不能代替前一类产品/范围检查。
QA与裁判使用控制器提供的可信同步事实投影，并结合实际Git内容、固定完整差异和真实产品CLI核验；不直接读取保护凭证根，不相信模型自述，也不把投影/哈希当作执行成功。投影缺失、不完整或与Git/当前HEAD不一致时如实不能验，不自行补造或重跑控制器。该同步归属不替代README产品验收、03/04隔离及完整恢复证据、报告原生命令/输出/退出码或来源门。每次同步产生的新HEAD必须重新真实QA、裁判、预览和正式CI，撤销旧批准，不复用旧head检查。spec为后续QA写Q场景时必须区分发布前零差异、发布后自产来源增量和严格可信同步，不能要求重造发布前状态，也不能减少任一验收。
这是全新A12的初始合同，不是旧失败样本豁免；旧A、A2、A3、A4、A5、A6或A7或A8或A9保持失败，不修复或追认。本次C01-C12原标准全部保留：A12与B两条均完整闭环后C12才PASS。

控制器临时隔离的范围与证据：verify期间控制器临时隐藏03-build.md；后续QA/evaluate期间控制器临时隐藏当前任务03-build.md和04-evidence.md，结束后须按原字节和文件模式恢复。这只是工作区临时隔离，不是允许模型删除、修改这些报告，也不宣称Git历史内容不可读。QA只能依据本轮可信控制器提供的隐藏事实解释这两个暂缺路径；裁判必须核实绑定当前任务、轮次、测试HEAD、原生会话及实际完整恢复的保护凭证。缺证、恢复不完整、内容或模式变化、第三文件缺失、模型自己重建报告及其它越界一律不能据此通过。不得用历史轮次或模型自述替代本轮凭证；明确产品合同冲突仍须如实报告。原有README内容应保持原字节及先后顺序，允许在其间插入新小节，不能把原文必须连续出现作为新增要求；不得删除或改写原文。

初始 spec 必须完整保留的 Q-4 每轮证据及阶段边界约束（新任务从首次 spec 起生效）：
旧样本 A6 已自然 HUMAN，保持失败，不重试、修补或追认。A6 的实际 Commander 第 1 次采用合法 spec pure append 澄清：旧轮报告/当时模型输入缺少三次失败执行的完整命令、输出和退出码，所以旧轮裁判 FAIL 保留；原始受保护 native 实际仍保留，不能把“旧报告未完整引用”说成原生记录不存在。新任务不能补写或改判旧样本、旧轮报告；后续只允许生成当前合法路径的新轮真实报告，不新增任何历史编辑授权。
每轮 Q-4 独立核验本轮固定完整 HEAD、固定 initial base、完整 DAG 及全仓差异和本轮可信来源投影。所有当前轮实际执行（包括失败、修正、重复及重测）均须由可信控制器以真实原生命令、完整输出和退出码进入最终05报告的完整有序原生全账；零字节输出也保留，不能省略失败或以摘要替代完整输出。模型无需手抄该全账或全部历史失败；原始草稿完整保留，条目只绑定本轮实际执行，自己提供的输出必须完整验真，语义FAIL/CANNOT_VERIFY不因控制器装配变成PASS。原生接口的aggregated_output仅按实际捕获字节留证，不冒称已证明任意子命令未截断的stdout/stderr。当前轮任一缺证、来源投影缺失或与 Git/当前 HEAD 不符，照旧不能验收。历史 FAIL/CANNOT_VERIFY 与其原因完整保留，只能如实注明旧轮报告证据缺口，不能靠重跑、推测或改旧报告声称已补齐；历史缺口本身不自动替代下一轮当前固定 HEAD 的独立结论。任何历史执行造成的产品、范围或来源问题仍须按真实当前 Git 和完整 DAG 核实，不因“新一轮”而豁免。
spec 为 Q-4 配套写清 S-5：QA 会话内只核实本轮可信控制器提供的 03-build.md、04-evidence.md 临时隐藏事实及当前可见工作区；QA 明确记录完整恢复尚未发生，不预先宣称恢复已完成，不要求 QA 当场证明未来事实。QA 不读取保护凭证根，不自行重建隐藏报告，不相信模型自述。控制器在 QA 会话结束后按原字节和文件模式恢复，独立裁判再核实绑定本轮任务、轮次、测试 HEAD、原生会话及实际完整恢复的保护凭证；缺证、恢复不完整、内容/模式变化或第三文件缺失照旧失败。该会话后凭证仍是完整闭环必要条件，不是 QA 会话内当前 Q-4 可见事实结论的前置事实；QA 当前可见范围结论不能充当实际恢复或完整验收通过。
本澄清从新任务初始 description/spec 起生效，保留 I1-I4、固定 initial base 全 DAG/全仓范围、保护根隐私、真实 registration→stage→native/source proof 及严格 main 同步合同，不修改冻结 C01-C12。每次新 HEAD 均须重新真实 QA、裁判、预览和正式 CI；正式 CI、实际合并、Brain 终态、Learning 及下一实际 tick 预览回收仍分别真实核验，不能提前宣称完成。

旧A7、A8、A9保持原失败记录，不补报告、不改状态、不追认、不计成功。冻结C01-C12原标准逐字保持，完整DAG、逐blob/mode全tree来源核验、03/04隔离与恢复、精确HEAD正式CI、真实merge、Learning全文回读和下一实际tick预览回收均不减少。控制器全账及保护凭证是事实来源，不替代产品验收，exit0/回执/哈希均不能自动判产品PASS。

历史与新样本身份：A11/PR6634已发生的全闭环通过记录保持原样；旧B/PR6635已自然HUMAN（qa_evaluator_broken/infra_escalation）并保持失败，旧OPEN PR内容不视为main内容，不合并/复制该失败PR来冒本轮产品或证据，不复用失败UUID/PR，不补写、修改或追认其旧报告。本轮是全新A12与全新B12两个任务/PR/原生运行，A11历史通过不能替代A12或B12信用。

本轮阶段责任澄清（不改变冻结验收）：spec/spec_review只拟定当前阶段可执行验收，不运行产品验证。build先保留会真实失败的产品断言/原生RED，再追加文档并执行真实验证；不能以新增镜像测试或复制实现替代。发布前verify在它当时的真实工作区，以固定initial base核I1–I4、暂存/工作区和全仓未跟踪清单；03-build的临时隐藏只按该阶段可信事实解释。发布后的QA核当前精确测试HEAD、实际preview身份、当前README产品与完整初始base DAG/全仓差异，并对照本轮可信来源投影区分已许可记录/manifest增量及严格可信main同步；不将“发布前manifest零差异”再要求为发布后事实，也不让后续QA checkout/reset/删除文件去重造历史工作区或补演过去verify。过去RED/verify/各阶段执行是否发生只能据真实当时原生命令/完整输出/exit及可信来源事实核实，缺证仍不能验，不靠未来重跑补造。当前QA的03-build/04-evidence按本轮可信隐藏事实解释，会话内明确恢复尚未发生，不读取保护根、不自行重建，也不提前断言未来恢复完成。会话结束后的可信控制器必须按原字节/模式真实完整恢复，独立裁判再核本轮task/round/testhead/session绑定的实际恢复保护凭证；任一缺证/变更/第三路径异常仍失败。每轮全部真实native（失败、重复、修正、零字节输出）须由控制器进入完整有序全账；模型草稿与FAIL/CANNOT_VERIFY语义保真。新HEAD重新真实QA/裁判/预览/CI；实际GitHub merge、Brain终态、Learning ID+全文hash读回及下一实际gate tick停预览/清pending只由外层只读观察在自然发生后核验，不由文档任务主动触发。纯docs按既有规则说明无有效API回归smoke的事实，不伪造smoke或把本段当预览身份/真实QA的豁免。

新一对只有A12与B12均完整C02–C11真实通过才可计2/2及C12，A11旧成功不替代其中任何一条。冻结C01–C12逐字保留，所有历史原件不改。

### I-1
最终README准确列出--log-dir和--json用法及按mtime倒序，与status.mjs源码一致；不存在目录/无回执结果[]只表示无记录，不能当健康证明。 新增文末“回执常见误读与核账示例”FAQ，用标为非现场结果的[]/running等示例说明这些误读；不重复或重写A11原小节。

### I-2
最终README对照status.mjs和lib/receipt.mjs解释running、completed、partial、failed、unreadable及ci_fix次数/last_result；unreadable不是删除文件依据，非回执JSON可能触发该分类。 FAQ必须有completed缺PR的JSON与文本对照、partial/failed原因选择及ci_fix/非回执JSON误读例；静态逐项与固定源码一致，不能用样例冒实际运行证据。

### I-3
最终README明确回执completed与PR合并不同，最终成功需对应PR/head及Brain runner.phase=merged、merge.merged=true和QA终态；只读诊断不手工改批准/FAIL记录。所有产品修改限README。 FAQ准确区分terminal先写completed/awaiting_qa（或awaiting_manual_merge）、真实合并及后续Learning/预览回收；deps就绪的无PR/result.merged捷径与GitHub分支如实说明；new-task预检不是提交成功。发布前README须以整份基线原文为字节前缀，仅文末追加FAQ。

### I-4
发布前当前阶段的范围验收：以固定base_sha=05f28a953a9fa184ed53619eba2127a203edab0e比较到HEAD、暂存区、工作区及整个仓库未跟踪文件，产品改动只能是packages/brain/scripts/coding-workflow/runner/README.md；基线README原有全文逐字保留；.implementation-source-relations.json相对于该基线未改动。先枚举整个仓库未跟踪文件，再仅按实际本任务流水线记录路径排除；当前任务sprint内的流水线记录是独立证据范围，verify不读取其它sprint文件，也不在此验收尚未发生的发布/QA/CI/合并/Learning/预览回收；这些仍由后续阶段与外层C01-C12独立终验。 后续QA/evaluate不重用发布前manifest零差异作为发布后判据；仍固定initial base完整枚举全量差异、暂存区、工作区和整个仓库未跟踪文件，逐提交区分本任务自产变更与上文严格可信控制器main同步。本任务产品仍只限README，真实报告/manifest自产增量仍受原精确合同约束；只有QA独立完成固定initial base完整DAG及全仓范围验收，并且可信source gate对精确两父、独立main ref事实、逐blob/mode全tree、受保护merge凭证与原source chain全部核验通过的同步才可单独归属上游。QA使用可信投影及实际Git核实，不读保护根；上游触本任务产品/报告、改后revert、未知或缺证同步均拒，不能从final diff简单减main或改initial base。新HEAD重新QA/裁判/预览/CI，原C01-C12不减。 控制器临时隐藏和完整恢复仅按上述固定路径和本轮真实凭证核实，不豁免任何内容、模式或越界变化。README原文保留按原字节与先后顺序判定，允许插入新增小节，禁止删除或改写。
