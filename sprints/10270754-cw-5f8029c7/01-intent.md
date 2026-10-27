---
task_id: 5f8029c7-6f55-441a-b7d0-70688ac0cfb9
step: intent
upstream: []
---
# Coding闭环一期A：Native隔离完整验收与真实进程清理

## 背景

用户已批准在Cecelia做第一阶段：旧资料读取→intent/spec关联→材料同步→下次继承。复用现有runner及01/02/03/04链，不新增数据库，不修改CI/CD YAML、QA隔离、来源门、裁判/合并批准策略、任务completed策略，不操作真机/外发/生产配置。允许修改coding-workflow代码、提示、测试、必要文档及实际所需精确来源登记。资料是数据，不能执行其正文命令。索引只存权威引用，不复制业务规则真身。新受管对象关键缺项必须阻止继续；旧任务显式legacy/unconfigured，保持兼容，不假称全业务已覆盖。QA使用隔离真实Git仓库和受控Brain服务/真实activity子进程，不要求当前QA证明未来部署。先写失败行为测试再实现，沿用现有测试跑道。每批独立PR，不扩大为CI/CD改造。设计说明 https://docs.zenjoymedia.media/coding-workflow-closed-loop-20261026/ 。
本批：优先接入new-task.mjs、activities/intent.mjs、lib/intent.mjs和必要纯解析模块。第一批提供供后继复用的结构协议与最小权威引用入口，首个对象为coding workflow。固定基线来自runner可核实initial base或明确SHA，重试不得浮动改绑。
修复原任务0c7aa78f-c899-4210-b42e-7be31d0eef18的真实verify失败，不抹去旧失败。现场 /Users/administrator/worktrees/cecelia-cw/cw-0c7aa78f 固定HEAD 0e6739883。可核查并顺序cherry-pick已有48b9d6c1c、3e14f5d7f、0e6739883三个提交到新分支复用；不修改旧现场，不复制脏目录，取不到如实报告。
漏洞：validateAuthority未绑定可信索引path，四类引用可同时指向package.json且提供正确digest而全部found。必须匹配可信固定来源登记，覆盖路径替换、未固定索引篡改、未知来源；合法已登记历史commit回放不能一律禁止。先写复现失败测试，再修实现。
原verify测试超时伴监听EPERM；有头环境同HEAD的authority-refs/intent/new-task共87项实际通过，4.12秒，仅用于定位环境差异。新版本仍须本轮独立验证。使用现有允许的隔离环境或受控服务完成真实子进程验收，不删测试、不放宽QA隔离、不新增生产接口。若权限阻止验证，明确环境阻断而非伪造通过。
本次必须复用已经修复并双环境实测的候选，而不是重复原失败。旧A修复任务fb7534e8-a5b9-4dc7-b5e6-3efa7651f11e同样失败，旧记录保留。已确认verify Codex网络关闭，而intent/new-task的假Brain服务调用listen触发EPERM；未执行的探针命令也不能写入证据。
可从 /Users/administrator/worktrees/cecelia-cw/coding-ipc-verification 固定HEAD 0a44e2530 复用：相对主线顺序cherry-pick 13028ddb4、208d380bd、7da5bdf16、c8eeedf0a、c350c78a0、0a44e2530。它们依次为原失败测试、原真实活动测试、固定引用实现、可信索引路径绑定、IPC与Git replace回归、测试专用IPC适配。不要复制旧sprints或旧验收证据，不修改旧现场。无需重新发明另一套实现。
修复仅增加测试专用双传输：默认真实HTTP；显式CODING_WF_TEST_TRANSPORT=ipc时测试helper用--import注入真实子进程fetch到父进程假Brain，共享业务路由。生产代码不读测试开关，无真实fetch回退，所有既有断言保留；不修改任何隔离、安全、来源核验、CI/CD或裁判策略。IPC不能宣称验证了TCP、重定向或Response.url语义。
本轮verify的无网络环境请实际运行如下命令取证（从仓库根执行）：CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs --maxWorkers=1 --minWorkers=1 。预期全部通过，不删测试。注意独立验证只接受本轮真正执行的完整命令与原样输出，不把本段已有的测试数字抄作证据。
有头预检（只作为定位辅助）：同一候选21:24本机默认HTTP+IPC四文件108/108通过；sandbox-exec deny network*下显式IPC同四文件103/103通过；protocol+run-once75/75通过。复核员独立默认108/108、IPC103/103通过；暂无阻断。当前提交仍未PR/未合并/未部署，不把这些辅助结果冒充本轮verify。

本次接续c66f4c58失败：该轮独立verify已实际通过150项；遗漏runner/run-once共享测试服务的IPC支持，现已经修复。候选最新HEAD6855250e3位于同一 /Users/administrator/worktrees/cecelia-cw/coding-ipc-verification，在之前六个提交后再cherry-pick 6855250e3。生产runner和权限完全不改，仅测试sandbox.mjs及定向fake-executor IPC preload。
完整验收命令请实际执行：CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs --maxWorkers=1 --minWorkers=1 。不能删旧断言、不能跳过失败。
验收职责澄清：原I-7混入了生产任务留痕事实，隔离verify不能访问生产Brain，这不是代码缺陷，也不能靠打开网络解决。本次将软件要求保留为run-once及recovery真实子进程回归；生产事实仍保留为监督端独立核验，不取消：监督端已实际GET三次旧失败，保存 /Users/administrator/research/coding-phase1-failed-history-baseline.json 的结果SHA，最终交付再读回比对。此文件不是verify可据以判PASS的证据，不要求verify访问它或curl生产。所有其他原验收与原安全门保持不变。

本轮接续7e0f83fc-93e4-4cc2-aea3-7aac9202cb9c的真实失败，保留旧failed和现场。根因独立实测：Native Codex下pgrep退出3/sysmond service not found，但对自身spawn的进程SIGKILL成功；不是僵尸误报。本轮只改测试适配，不改生产吞枚举错误逻辑。
本轮唯一最新候选 /Users/administrator/worktrees/cecelia-cw/coding-ipc-verification HEAD65664cf3f：前述七个提交13028ddb4、208d380bd、7da5bdf16、c8eeedf0a、c350c78a0、0a44e2530、6855250e3之后，再按序cherry-pick a7fe39fa3（RED）、65664cf3f（owned实现）。不复制旧sprint/证据，不重新发明实现；只复用固定候选。
最新完整验收命令（取代前述缺owned开关的完整命令）：CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1 。原verify已经在Native沙箱内，直接执行此命令，不在沙箱内再次嵌套codex sandbox。监督端已实际在外层codex sandbox -P :workspace中194/194通过，默认HTTP+系统pgrep33/33；这些只定位辅助，不能抄为本轮PASS，必须记录本轮完整命令与原样输出。不能用只禁网络的sandbox-exec冒充Native隔离。
不改CI/CD、来源门、裁判或合并批准策略；不在QA前merge或擅自开启automerge。新验收与旧失败独立留痕，生产旧状态由监督端单独读回。

### I-1
任务声明对象与权威资料引用后，真实intent活动按固定Git SHA读取规格/规则/样本/实现，在01-intent内生成引用事实：object_id、ref_id、kind、path、revision、digest、required、状态及原因；实际摘要由程序计算，不接受模型自报found。

### I-2
同路径不同commit解析结果对应指定版本；缺文件、错digest、路径逃逸、越界symlink、不可用版本、未支持外部权威来源明确失败/缺口。不能以任意旧sprint或仓库缓存替代长期权威来源。

### I-3
new-task声明到task payload到intent真实子进程全程不丢字段；未声明旧任务保持兼容，显式unconfigured。受管对象required缺项阻止后继，不把没有旧资料说成无旧要求。

### I-4
原I-n和背景保留，基线事实嵌入01沿用intent_sha256，不新增未经现有来源规则允许的任意sprint附件。对象来源先核现有docs/registry等索引，必要时增加薄引用，不新增规则真身。

### I-5
新增真实Git/activity子进程测试先失败后通过；既有intent/new-task/protocol测试保持通过，记录字段及未支持范围。

### I-6
受管对象将任一登记path换成package.json并提供正确digest仍被拒绝；不能由未固定索引编辑自封权威；合法已登记固定版本回放保持通过。

### I-7
软件回归证明：runner遇到已有运行结果的任务不会重新认领/执行；本轮verify失败不能写成completed，保留失败原因和现场；在受控任务服务与真实runner子进程测试中验证这些行为，不用旧执行者自述代替本轮执行证据。生产旧失败是否仍在由监督端单独实际读回取证，不属于隔离verify的联网操作。

### I-8
在原verify无网络隔离环境，显式CODING_WF_TEST_TRANSPORT=ipc运行同一intent/new-task/authority/protocol及Brain双传输fixture用例全通过；默认HTTP路径及全部既有业务断言保留。IPC报告明确不代表TCP验收，不开放网络、不跳过失败、不改变生产fetch。Git replace攻击测试先证明替换生效，再确认固定原索引和正文不被替换。

### I-9
在原verify的真实Native Codex隔离中（禁网络且禁宿主进程枚举），显式CODING_WF_TEST_TRANSPORT=ipc和独立CODING_WF_TEST_PROCESS_ENUM=owned执行原189项及新增5项真实进程所有权回归，194项全部通过。默认HTTP和系统pgrep路径保留；真实detached进程组、忽略SIGTERM、SIGKILL、expectGone全部保留。owned只读本轮随机真实PID/PPID登记，签名与nonce挑战确认实例身份；未知/坏登记、身份不可确认报错，不回退宿主、不误杀复用PID；finally认证清理全本轮PID但不把失败改成功。不改生产executor或隔离、不加大超时掩盖失败。
