---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: intent
upstream: []
---
# 运行回执判读手册：区分任务状态与最终合并

## 背景

这是实际运维手册补全，同时作为Codex常驻连续实跑验收。仅改 packages/brain/scripts/coding-workflow/runner/README.md 和流水线正常记录；不改程序、测试、开关、凭据或运行状态，不新增镜像单元测试。验收以真实读取最终README并用会失败的具体内容断言对照本次HEAD源码；无需启动/安装服务、浏览器、调用生产、账号、API或真正建单，不把dry-run当成功执行。spec只拟定验收，build先留红再写文档再真验证。QA原生输出逐字引用，禁止省略或修改命令输出；不更改任何验收器或门禁。新记录不得重写历史报告。 在现有README新增“运行回执如何判读”小节，准确说明status.mjs的--log-dir/--json、排序、running/completed/partial/failed/unreadable与ci_fix摘要。特别说明completed回执不等于PR已经合并，应继续核对GitHub最终head合并及Brain runner.phase/merge/qa_state终态（仅写诊断方法，本次不调用生产）。根据源码如实说明status会扫描非cifix的JSON，合法qa/commander状态JSON也可能显示unreadable，不能据此认定文件损坏或删除现场。保留现有安装与安全边界全文。 精确边界：summarizeReceipt对completed但无PR URL仍保留status=completed并附reason_code=pr_url_missing；formatStatus的completed行默认不打印该reason，因此不能从表格completed推断已有有效PR。文档应建议查看JSON并核实pr_url。 新版本的pr-sync-pending.json是终态回写待办，同样可能被status扫描为unreadable；文档应点名此文件，明确不能因此删除待办。

本次A4是新任务，不重试、修补或追认旧A、A2或A3。产品编辑范围：模型只能改 packages/brain/scripts/coding-workflow/runner/README.md，不改程序、仓库测试、开关、凭据或运行状态；流水线各阶段仍按原合同生成指定路径的真实 Markdown 报告，不得因产品仅文档而省略必要证据。唯一额外版本化元数据许可：可信 publish、QA、Commander 控制器可自动在 .implementation-source-relations.json 前部新增当前任务合法 Markdown 的准确来源行，owner_path 固定为 packages/brain/scripts/coding-workflow/runner/run-once.mjs，role 固定为 documentation，path 必须是本次任务实际 sprint 路径；记录与该增量同提交，历史条目逐字不动，幂等且冲突拒绝。模型禁止直接编辑、暂存或提交此 manifest，也不得更改 owner/role 或替其它任务登记。许可仅覆盖 publish 的 01-intent.md、01-invariants.md、02-spec.md、02-review.md、02-review-rN.md、02-response-rN.md、03-build.md、04-evidence.md，QA 本轮 05-qa-report-rN.md/06-judge-rN.md，以及 Commander 本轮 07-commander-rN.md；N 为真实正整数轮次，不得编造报告。非 Markdown 附件或其它必要原生证据保留并遵守原有门禁；若当前来源合同不支持，诚实失败留证，禁止删除、改名伪装或少产附件规避门禁。QA 原生命令与输出、失败历史、精确 HEAD 批准和正式 CI 均按原标准核验；本许可不弱化任何真实 QA 要求。

阶段合同：acceptance中的I1-I4是发布前verify能够当场核实的产品验收。所有范围比较固定使用base_sha=1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c，覆盖该基线到HEAD、暂存区、工作区及整个仓库枚举的未跟踪文件；不得改用浮动origin/main、仅最后一个提交或仅默认git diff。未跟踪文件先枚举整个仓库，仅按实际本任务流水线记录路径排除，不可先限定README路径而漏掉越界文件。verify只读01-intent及真实仓库/源码，不读取其它sprint报告；03-build在verify期间按设计被临时隐藏，不得以此判漏产。I4只验证此时可见的产品改动、基线README原文保留及受控manifest未改；尚未发生的publish、QA、judge、Commander、CI、merge、Learning和预览回收不属于发布前I4。流水线各阶段仍须真实执行并保存证据，后续报告和可信来源增量由对应控制器产生。项目外层独立观察者在它们实际发生后按原C01-C12逐项核验，包括原生命令/输出/退出码、精确HEAD、正式CI和实际合并、Brain终态、Learning回读与下一次tick停预览；未发生的阶段不得宣称通过，完整成功标准没有减少。
阶段间同一意图的解释：后续QA/evaluate继续核实README产品内容、真实CLI行为及许可范围；不得把I4的“发布前manifest零差异”再次施加于publish后的HEAD。发布后仅允许上文可信控制器按精确白名单产生的真实来源增量；仍须检查历史条目不变、路径/owner/role/当前任务绑定和最终HEAD，任何其它manifest变动仍失败。spec为后续QA写Q场景时必须区分这两个阶段的合法manifest状态；不得要求QA重新制造发布前状态，也不得将阶段区分理解为跳过真实产品QA或来源核验。

### I-1
最终README准确列出--log-dir和--json用法及按mtime倒序，与status.mjs源码一致；不存在目录/无回执结果[]只表示无记录，不能当健康证明。

### I-2
最终README对照status.mjs和lib/receipt.mjs解释running、completed、partial、failed、unreadable及ci_fix次数/last_result；unreadable不是删除文件依据，非回执JSON可能触发该分类。

### I-3
最终README明确回执completed与PR合并不同，最终成功需对应PR/head及Brain runner.phase=merged、merge.merged=true和QA终态；只读诊断不手工改批准/FAIL记录。所有产品修改限README。

### I-4
发布前当前阶段的范围验收：以固定base_sha=1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c比较到HEAD、暂存区、工作区及整个仓库未跟踪文件，产品改动只能是packages/brain/scripts/coding-workflow/runner/README.md；基线README原有全文逐字保留；.implementation-source-relations.json相对于该基线未改动。先枚举整个仓库未跟踪文件，再仅按实际本任务流水线记录路径排除；当前任务sprint内的流水线记录是独立证据范围，verify不读取其它sprint文件，也不在此验收尚未发生的发布/QA/CI/合并/Learning/预览回收；这些仍由后续阶段与外层C01-C12独立终验。 后续QA/evaluate不重用发布前manifest零差异作为发布后判据，而按上文可信控制器精确增量合同核实此时manifest、保留其它范围限制；前后两阶段均不豁免越界改动。
