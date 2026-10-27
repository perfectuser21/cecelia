---
task_id: b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132
step: intent
upstream: []
---
# coding一期A：恢复正确验收对象与控制器执行的真实QA链

## 背景

用户已授权持续完成coding闭环一期A。原A任务5f8029c7-6f55-441a-b7d0-70688ac0cfb9/PR6657保留真实CI与source_provenance_missing升级，不覆盖、不抹去。产品候选已通过真正Native194及正式CI，但普通git merge绕开受控同步，四个merge缺真实controller receipt，独立QA在evaluate前正确拒绝。不得为过去merge补签、伪造观察或改来源门。
本次只恢复诚实执行链：从固定可信main 6e9076aab2002e301304256b4936e2790f9de8e7新建本任务分支，由现有runner完整执行intent→spec→review/revise→build→verify→chain-check→report→publish，并在原QA/独立judge后才允许正常合并。全部9条原验收逐字保留。保留原失败历史，不能把旧通过抄成新证据。
复用固定候选e526517009e3a9523900dacd600b4228fca6d297的已审产品文件（列表如下），不重新发明实现。只能取真实Git原字节；不得复制旧sprints、旧manifest、旧DoD或旧验收文件，不得继承原无receipt的merge历史。新01/02/03/04及来源事件全部由本轮可信控制器真实产生；新manifest关系只用原登记程序。
先核原RED与实现提交：13028ddb4、208d380bd、7da5bdf16、c8eeedf0a、c350c78a0、0a44e2530、6855250e3、a7fe39fa3、65664cf3f。按现行TDD要求保留真实行为失败回归；本次复用最终实现，不将模块缺失报错伪称业务RED。处理冲突时最终产品原字节必须与固定e526候选一致，未经证据不得扩范围。
全程保持当前main，后续候选已经排好合并窗口。不得普通git merge/rebase/force改历史；如确需同步，只走原createSourceMerge可信控制器；遇上游与任务路径重叠需明确停止该同步，不伪造受控事件。不能修改CI/CD YAML、隔离、来源门、裁判/批准策略或completed策略。
本轮独立verify在真正Native环境实际执行完整命令：CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1 。verify内不再嵌套codex sandbox；监督端外层检查才用codex sandbox -P :workspace。默认HTTP与系统pgrep路径保留，真实detached/忽略TERM/KILL/expectGone不删除，未知/坏签名继续拒绝。
I-7生产旧任务状态由监督端独立读回，禁网verify只核软件运行与恢复行为，不访问生产Brain、不把背景文件当PASS证据。正式CI、来源门、preview、QA与judge均必须针对本轮固定HEAD，不以本段历史数字替代。
产品路径：
docs/registry/coding-workflow-authority.json
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs
packages/brain/scripts/coding-workflow/__tests__/fixtures/brain-fetch-preload.mjs
packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs
packages/brain/scripts/coding-workflow/__tests__/helpers/procs.mjs
packages/brain/scripts/coding-workflow/__tests__/helpers/run-activity.mjs
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs
packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs
packages/brain/scripts/coding-workflow/activities/intent.mjs
packages/brain/scripts/coding-workflow/lib/authority-refs.mjs
packages/brain/scripts/coding-workflow/lib/intent.mjs
packages/brain/scripts/coding-workflow/new-task.mjs
packages/brain/scripts/coding-workflow/runner/README.md
packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/executor-ipc-preload.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/fake-executor.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/helpers/owned-processes.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs
packages/brain/scripts/coding-workflow/runner/run-once.mjs
packages/brain/scripts/smoke/coding-workflow-runner-smoke.sh
本次还保留04ad910f-8c5f-4b9d-b31c-962128f2dc0b真实verification_failed，不修改其01/02/04或状态。该轮22产品路径逐blob等于固定e526且194项通过；本轮仍须自己真跑，历史通过不替代本轮。现已查明两个验收对象错误与一个QA执行角色冲突，以下只澄清原9验收的证据对象，不放宽条目：
I-4的功能对象是候选真实intent在独立场景新生成的01及其outputs.intent_sha256，不是本任务最初由旧main生成的bootstrap01；本任务bootstrap01保持受保护。既有intent.test的“受管任务按固定 Git commit 写引用事实与文件摘要”和“payload.acceptance 优先：只写 payload 的条目”真实子进程覆盖新01背景/I-n/引用事实与计算摘要，完整回归须实际跑并核断言，不数旧01的sha字符串冒充验证。
I-5按原合同允许复用已审实现并核原阶段行为RED，不新增“本轮必须有RED提交”或“每个activity首次RED”要求。原真实运行记录/Users/administrator/.cecelia/coding-workflow-runner/0c7aa78f-c899-4210-b42e-7be31d0eef18.json，原字节sha256=1d989c24cd8d7e69e1e567e7380726decda006b0fa780af4f93f81180aa4c37a。独立verify应自行JSON解析activities.find(a=>a.key==='build').attempts[].transport.stderr原JSONL：item93测试变更→item94同authority-refs.test真实Git的jump/secret.md断言expected authority_non_regular_file实际authority_file_missing，exit1→item95只改authority-refs实现→item96同命令2tests通过exit0→item98测试提交3e14f5d7f06c0ee2b8b335eda6d6856834918045→item115实现提交0e67398830dece34fced35c4dd81793dc131a42b。以原Git对象核当前同断言确实保留，并真跑本轮全部Git/activity/new-task/protocol回归。只证明这条真实先失败后修复及当前回归，不声称所有功能首次TDD；缺模块或网络EPERM不算业务RED。不读coding-workflow-provenance保护根、不把监督摘要当自己执行命令。
恢复原QA授权：隔离真实Git和受控任务服务/真实activity子进程，不假定正式预览自带runner。QA角色是客户端，活动由QA外可信控制器真实运行并正常封存，QA不直接运行受管intent、不写任何来源根/git元数据/业务产物。当前Native保护来源目录是正确门禁，不能改HOME/origin、禁用来源、改隔离或把产物藏进截图目录来绕过。
正式产品QA仍只访问本任务新PR固定HEAD的真实预览Brain，不能以旧6657/e526预览或夹具health冒充。本次预检仅证明可行操作形态：控制器预建隔离真实Git及固定索引、唯一nonce和精确任务/payload allowlist、固定候选入口；QA用固定/opt/homebrew/opt/node@24/bin/node v24.21.0及仓库undici6.29.1标准Agent({connect:{socketPath}})+setGlobalDispatcher，以--import加载经原允许preview Unix桥运行真实new-task POST/独立GET；不覆写fetch、不删代理配置、不扩大网络。控制器在QA外只处理这些精确场景任务，正常运行固定候选真实intent，结果经原任务API读回，QA只读独立场景真实01并重算SHA及背景/I-n/各ref事实。活动完成不冒充整workflow completed。标准客户端传输配置与临时Git/场景输入由控制器预先准备，QA不自行写脚本/改代码。任务登记后由监督端准备此入口并提供真实路径/固定HEAD；未准备时如实CANNOT_VERIFY，不捏造已存在能力。受控夹具诊断记录在research/coding-qa-undici-probe/controller-chain，仅是能力探针，不能作为正式QA产品PASS。
原I-5/I-7/I-8/I-9中明确属于历史TDD、软件回归、禁网Native及进程清理的证明仍由本轮实际verify与独立judge现有historicalExecutionProjection核验，QA不读03/04/保护回执、不拿单测当自己的操作，也不把这些验收改成“预览必须重建完整runner”。QA真实产品场景聚焦真实建单到引用解析、新01原字节、错误引用拒绝、旧任务兼容；独立judge仍逐I核足全部指定证据，不能以相邻场景代替。原9验收逐字不变、全门禁仍保留。

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
