---
task_id: cdb32573-9ece-405a-823e-c6c327765564
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 裁判历史执行证据与本轮 QA：只读责任边界

### S-1
对应：I-1。只在 `packages/brain/scripts/coding-workflow/runner/README.md` 的现有末尾追加一个小节，原字节、mode、顺序全部保持。根据 `packages/brain/scripts/coding-workflow/runner/lib/source-provenance.mjs`、`packages/brain/scripts/coding-workflow/lib/record-provenance.mjs` 写明：`sourceFacts` 仅返回公共的已验证来源投影与可信同步；`judgeSourceFacts` 在真实 judge 上下文里才增加 `historical_execution`。`verifiedHistoricalExecutions` 严格绑定同 task、sprint、真实 worktree 和固定当前 HEAD，03/04 必须经 `registrationFor` 与 `validateStage` 结合原 Git 字节、mode、提交、manifest 和受保护阶段事件核验；哈希或模型自述均不能推出曾执行。不得修改上述源码或 `.implementation-source-relations.json`，后者的合法文档关系由可信控制器在后续登记阶段处理。

验证：发布前用可失败的 `node` 只读断言比较固定基线 `8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d` 的 README Buffer 与 mode，要求新文件以前者为精确前缀且只多文末小节；对新增文本逐句断言 `sourceFacts`、`judgeSourceFacts`、`verifiedHistoricalExecutions` 与固定源码职责一致。先对未追加文本运行同一断言得到真实非零 RED，追加后再运行得零退出 GREEN；控制器保留原生完整命令、输出及退出码。README 是只读手册，没有新增接口或命令行输入；文中所述来源读取失败语义是拒绝证明而非空账或 PASS，缺失、伪造、重复登记均不可重试成既成历史。

### S-2
对应：I-2。仍只追加同一 README 小节，按固定 `packages/brain/scripts/coding-workflow/lib/record-provenance-history.mjs` 准确解释：每个 build/verify stage 的 `native_ids` 按原顺序逐项投影为 `natives`，包括非零退出、失败会话、重复命令和零字节 `aggregated_output`；每项列出原生 `code`、`timed_out`、`terminated`、`success`、`terminal_event`、`stdout_sha256`、`stdout_bytes`、`error_event_seen` 及已完成命令的原字符串、聚合输出、退出码。`execution_complete` 仅表示该次 native 的终止事件为 `turn.completed`、无 error 事件、进程退出 0、未超时/终止且 stdin 状态满足条件，并与 `native.success` 一致；它不判产品 PASS。缺 native、JSONL 未知事件、命令结果不完整、未终止或身份错配均失败关闭，不把缺账当空账；不投影 reasoning，也不宣称 `aggregated_output` 是任意子进程 stdout/stderr 的完整分流。

验证：本轮 QA 以 README 与上述源码做可失败的字段及否定语义断言，并在内存中给 `historicalExecutionProjection` 喂含失败 native、同命令重复、空输出和不完整 JSONL 的临时对象，检查保序、保失败与拒绝不完整输入；不写任何受保护历史目录。

### S-3
对应：I-3。README 明确三层责任：本轮 QA 只读 `01-intent.md`、`02-spec.md`、固定源码、当前精确测试 HEAD 的 Git 事实和可信控制器给出的有限来源投影；可运行真正会失败的静态断言及内存反例。QA 期间 03/04 由控制器临时隐藏；本轮隔离投影仅允许把所绑定的这两条暂时删除识别为隔离状态，不代表会话后已恢复，也不豁免其它工作区差异。QA 不读 03/04 正文或保护根，不重造发布前 index/worktree/untracked，不手工补投或追认旧失败。旧 build/verify 是否真实执行，只由其当时的受保护原生事件、合法登记和后续 judge-only 读取及独立外层门判定；`historical_execution` 不属于当前 QA 命令或产品 PASS。文档还须说明 draft 的 FAIL/CANNOT_VERIFY 不编译为 PASS、不能以旧 PASS/登记哈希/当前 HEAD/exit0 代替历史现场。

验证：本轮 QA 对文档与 `packages/brain/scripts/coding-workflow/activities/evaluate.mjs`、`packages/brain/scripts/coding-workflow/runner/lib/judge-gate.mjs`、`packages/brain/scripts/coding-workflow/lib/qa-isolation.mjs`、`packages/brain/scripts/coding-workflow/lib/record-provenance.mjs` 做可失败断言和内存破坏对抗。真实历史的 `stage/head/native`、03/04 完整恢复由后续 judge 和会话后控制器独立核；当前 QA 不读取或替代这些原件。失败语义：来源不齐、隔离未恢复或反例能误判时标 FAIL/CANNOT_VERIFY，不补写来源、不重跑过去现场。

### S-4
对应：I-4。README 写清发布前 verify 与发布后 QA 的时间边界。verify 当场从固定 initial base 到当时 HEAD 检查完整 DAG 每条父边、全 diff、index、worktree、全仓 untracked；README 原字节与 mode 精确前缀加文末新增节，manifest 相对固定 base 零差异，并由当时原生命令完整输出和退出码承担。后续 QA 只核当前精确测试 HEAD：固定 base 到 HEAD 的完整 DAG、每个父边的 raw 路径/blob/mode、当前 index/worktree/untracked，以及本 task 合法 Markdown 与可信控制器精确前插的 owner=`packages/brain/scripts/coding-workflow/runner/run-once.mjs`、role=`documentation` 的登记增量；旧 raw 历史及顺序必须保留。当前工作区仅将可信控制器本轮隔离投影所列、绑定 task/round/HEAD 的 03/04 删除视为预期暂隐藏；其它差异仍逐项按来源与范围核验，未匹配或越界则失败关闭。合法 main 同步必须有独立可信链、准确双父及真实 main ref、全树/source gate 证明，不能简单扣除 main 或把 base 改成浮动 main。QA 不把发布前 manifest 零差异要求重施于登记后的 HEAD，也不把当前干净状态当过去工作区证据。03/04 原字节/mode 恢复、source/正式 CI/preview、精确批准 HEAD、真实 MERGED、Brain/Learning 回读和下次 tick 回收由相应会话后控制器与终态门在实际发生后按冻结 C01-C12 核验；新产品/源码 HEAD 须重走真实 QA、judge、CI、preview。若合同允许仅本轮 05/06 纯登记提交，必须严格证明仅该轮记录、产品及旧历史未改并把 approved.head 绑定实际登记 HEAD，不伪称模型测过登记 HEAD，也不陷入无限重验登记循环。

验证：verify 当场执行 `git rev-list --parents 8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d..HEAD`、逐父 `git diff-tree --raw --no-commit-id -r`、`git diff --cached --raw`、`git diff --raw`、`git ls-files --others --exclude-standard` 与 README Buffer/mode、manifest 的固定基线断言，保留全部输出与退出码。发布后 QA 对同一固定 base、当前 HEAD 和当前仓库重新运行只读检查，逐提交归属结合可信来源投影，不用旧快照；终态证据由相应控制器在发生时核。

## QA 场景

### Q-1
对应: I-1,I-3
前提: 可信控制器提供本轮固定测试 HEAD、有限来源投影及 `env_url`；本场景在 PR 预览环境的隔离数据库副本和当前检出工作树执行，不依赖既有业务数据。
操作: 先确认 `env_url` 字面 host 是 `localhost` 或 `127.0.0.1`，仅对其同源的 `<预览环境>/api/brain/health` 发一次不跟随重定向的只读 GET，核响应 `git_sha` 等于固定测试 HEAD。然后只读打开 README 和固定 `source-provenance.mjs`、`record-provenance.mjs`，运行 `node --input-type=module -e` 可失败断言：README 新节明确 `sourceFacts` 不含 `historical_execution`、`judgeSourceFacts` 才含该字段，并明确真实 judge 上下文、同 task/sprint/worktree/HEAD、03/04 的登记与阶段 Git 绑定；再以内存反例将“仅有相同 SHA”“QA 投影带历史原生”“缺登记”分别作为错误描述输入断言均不能被文档规则认可。该健康 GET 只是预览身份核验，不算产品 smoke 或 PASS。
期望: 健康响应与 HEAD 相符，断言退出 0；任一身份不符、断言不成立或反例被认可则非零并判 FAIL/CANNOT_VERIFY。QA 不请求其他 API，不读 03/04 或保护根，不扫端口或伪造 header。

### Q-2
对应: I-2
前提: 同 Q-1 的当前固定源码；在 QA 命令进程内构造临时 JSONL 与 stage/proof 对象，不依赖真实旧会话。
操作: 运行 `node --input-type=module -e` 动态导入 `packages/brain/scripts/coding-workflow/lib/record-provenance-history.mjs`，在内存中给 `historicalExecutionProjection` 提供两条合法 build/verify stage，每条按 `native_ids` 放入两次 native：先放 `turn.failed`、非零 exit、`error` 事件、同一命令与零字节聚合输出，后放成功会话；断言 `natives` 原顺序、两次结果、`stdout_sha256`/`stdout_bytes`/`error_event_seen`、`execution_complete` 值与源码一致。再分别去掉末次 `turn.completed`、命令 `exit_code`、一个 native id 或改错 stage 身份，断言调用抛错；只读核 README 对 reasoning、子进程 stdout/stderr、exit0 与产品 PASS 的否定语义。
期望: 合法内存账完整保留失败、重复和零输出；坏账全部拒绝，README 不作超出聚合捕获的完整性或产品成功声明。任何坏账被吞成空账即 FAIL。

### Q-3
对应: I-3
前提: 同 Q-1；本轮 QA 只收到可信控制器的当前来源投影，不收到 03/04 正文或保护根。QA 读取 01/02、README 与固定源码。
操作: 用只读 `node --input-type=module -e` 静态断言 README 把 QA 当前命令与 judge-only `historical_execution` 分开，声明 03/04 暂隐藏不等于恢复、旧 build/verify 不由 QA 重跑；在内存中依次把过去 PASS、登记 SHA、当前干净工作区、空输出、失败/非零会话伪装为“历史执行已 PASS”，按文档判据逐项断言均不得通过。检查文中把历史证据验证交给注册/阶段门与后续 judge，把会话后恢复交控制器。
期望: 原生断言退出 0；任一伪装能成立即 FAIL。QA 不读取过去非 Git 现场，不写报告以外的业务或来源文件，不把旧 FAIL/CANNOT_VERIFY 改成 PASS。

### Q-4
对应: I-4
前提: 只读核实固定 initial base `8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d` 是实际 Git 对象；测试 HEAD 由控制器固定。若任一事实不存在，如实 CANNOT_VERIFY，不创建 base 或重写历史。当前 QA 工作树与预览 HEAD 一致。
操作: 在 QA 工作树执行 `git cat-file -e 8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d^{commit}`、`git rev-parse HEAD`、`git rev-list --parents 8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d..HEAD`；对输出的每个 commit 的每个 parent 执行 `git diff-tree --raw --no-commit-id -r <parent> <commit>`，核 path/blob/mode 和归属；执行 `git diff --cached --raw`、`git diff --raw`、`git ls-files --others --exclude-standard` 枚举当前全仓现场。将 `git diff --raw` 中仅限本轮 03/04 的删除与可信控制器隔离投影逐项比对：投影须为本 task、round、测试 HEAD 的 `hidden` 状态，列出准确路径及 HEAD blob/mode，且工作区确实缺这两文件；其余 index/worktree/untracked 差异逐项验归属，未匹配项失败。用只读 Node Buffer/mode 断言固定 base README 是当前 README 的精确前缀，差异仅为末尾新增小节；检查 manifest 从固定 base 至 HEAD 只有可信控制器本任务合法 Markdown 的精确 documentation 前插，旧 raw/顺序保留；若有 main 同步，核可信双父、actual main ref、全树/source gate 投影，不按浮动 main 简单减差。对 README 文本另断言发布前零 manifest 与发布后合法登记两个阶段未混同。
期望: 全部当前事实可由 Git、工作树和本轮可信隔离投影只读核对且范围合法才判本场景 PASS；仅匹配的 03/04 暂时删除不算越界，隔离投影缺失、身份不符、其它越界差异或缺可信同步均不能用旧 PASS/哈希抵消。发布前非 Git 现场的完整原生命令、输出、退出码仍由当时 verify 独立承担；03/04 恢复由会话后控制器及终态门核，本场景不伪造重建，也不在发布后要求 manifest 相对 base 为零。

## 铁律对照

- INV-b3a8bf82：S-1、S-3、Q-3 覆盖；定义、运行事实和版本来源各归原有账，不把文档、QA 投影当历史运行真身。
- INV-e5ab4826：S-1、S-4、Q-4 覆盖；沿现有树、仓库、任务、运行、版本坐标说明来源，不新建平行账本。
- INV-02d8e749：S-3、S-4、Q-1 覆盖；保留 CI 后、合并前的真实 QA 与独立裁判责任，不以来源摘要缩减验收。
- INV-3a390000：S-4、Q-4 覆盖；候选未过真实 QA/正式门禁不宣称可晋级。
- INV-2fe86d34：S-1、S-2、Q-2 覆盖；运行事实来自原生记录，哈希或同步状态不等于执行成功。
- INV-dc18d43d：S-1、S-3、Q-3 覆盖；文档只解释既有机械来源门，不让模型自述或手工补投成为验收判据。
- INV-26886b60：S-4、Q-4 覆盖；实际合并 HEAD 必与真实 QA/judge 锚点核对，历史文档不替代流程完整性。
- INV-09fb5c69：S-3、Q-3 覆盖；CI 绿不代替逐条产品 QA。
- INV-6d11717d：S-2、Q-2 覆盖；空账、静默跳过或 CI 绿不被写成实际执行证据。
- INV-45cd3ec2：不适用：此次只追加 README，不新增或修改 smoke 脚本及生产写入 guard；该条已撤销 INV-ff177feb。
- INV-ff177feb：不适用：已由 INV-45cd3ec2 撤销，且此次不改 smoke。

## 未覆盖真实链路

- 发布前旧 index/worktree/untracked 不是发布后可重建事实；本轮 QA 只验当前 HEAD 与当前全仓现场，过去现场由当时 verify 的原生命令、完整输出、退出码及外层门承担，缺证不能给该阶段或终态 PASS。
- 本轮 QA 不读受保护 03/04 原文与历史原生账；只验 README、固定源码及内存反例，已登记 build/verify 的历史真实性由实际 judge-only 来源读取独立判定，缺证为 UNKNOWN。
- 03/04 会话后原字节/mode 恢复、本轮记录完整登记、正式 source/CI/preview、批准 HEAD 与 MERGED、Brain/Learning 回读及下次 tick 回收尚未发生；当前 QA 不宣称已验，分别由实际控制器门与终态验收按冻结 C01-C12 核实。
