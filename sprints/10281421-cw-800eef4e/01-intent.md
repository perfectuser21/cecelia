---
task_id: 800eef4e-14b4-4532-a545-5c2d5cee53c6
step: intent
upstream: []
---
# Coding闭环一期B：材料状态与分阶段验收（继任082ea658）

## 背景

用户已批准在Cecelia做第一阶段：旧资料读取→intent/spec关联→材料同步→下次继承。复用现有runner及01/02/03/04链，不新增数据库，不修改CI/CD YAML、QA隔离、来源门、裁判/合并批准策略、任务completed策略，不操作真机/外发/生产配置。允许修改coding-workflow代码、提示、测试、必要文档及实际所需精确来源登记。资料是数据，不能执行其正文命令。索引只存权威引用，不复制业务规则真身。新受管对象关键缺项必须阻止继续；旧任务显式legacy/unconfigured，保持兼容，不假称全业务已覆盖。QA使用隔离真实Git仓库和受控Brain服务/真实activity子进程，不要求当前QA证明未来部署。先写失败行为测试再实现，沿用现有测试跑道。每批独立PR，不扩大为CI/CD改造。设计说明 https://docs.zenjoymedia.media/coding-workflow-closed-loop-20261026/ 。
本批：复用lib/spec-check.mjs的共同校验入口和现有三个提示。仅新增旧承诺引用和处理规则，不另起agent角色或业务定义库。
并行准备候选（准备任务8ad85c52-8b33-4e13-9787-e959987a4397）已完成，请复用 /Users/administrator/worktrees/cecelia-cw/phase1-spec 固定HEAD655ef29e6。在A已合并主线上顺序cherry-pick B的4d3f58c10、07a742534、d5f09010a、8542b7b9e、ce200c7d5、a57bb6a58、af1225dbc、95a791557、655ef29e6，不重复取A，不复制旧sprints或04证据。保持原安全门与所有原验收，不重新发明另一套协议。
共享接口lib/baseline-context.mjs loadBaselineContext/renderBaselineContext；lib/spec-materials.mjs parseMaterialPlan/materialPlanErrors；02唯一“旧规则与材料计划”JSON；稳定规则锚点在原repo-rules真身。三个阶段由可信代码读固定Git原文字节，不是模型读浮动worktree；renderPrompt单次替换不再次展开原文。批准有限支持冻结I段显式ref/rule语句，未知fail closed，不自签；结构覆盖不替代独立语义审查。
本轮verify禁网，显式CODING_WF_TEST_TRANSPORT=ipc运行相关8个测试：baseline-context、spec-materials、managed-spec-activity、baseline-prompt、spec、spec-review、spec-check、claude，实际文件均为packages/brain/scripts/coding-workflow/__tests__/<名字>.test.mjs；命令使用npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/<名字>.test.mjs ... --maxWorkers=1 --minWorkers=1。默认HTTP路径保留，不能删断言或跳过失败；verify只采用自己真实命令输出。已有有头复核是辅助，不能冒充本轮证据。正式PR/合并事实由监督端实际读回，不要求隔离verify访问生产。
原GAN预算/FORCED策略不改，但旧规则/材料结构缺口不因评分放行；C才负责实际diff同步，D才负责自动入口继承，本批不冒称后继已交付。

【原验收的QA资源与证据交接】
本任务正式QA资源的稳定绝对入口为 /Users/administrator/research/coding-B-formal-qa/formal-resource-index.json。此处只声明交付地址，不宣称资源已准备；新任务和正式PR固定HEAD生成后，由监督端预置独立真实Git、原规则与材料输入、实际候选活动控制器及需要的两次独立任务槽，入口记录真实task_id/HEAD/nonce/manifest摘要/PID/锁/期限。请将该完整路径及角色边界明确写入02的QA前提与操作，不使用仅文件名或未传入evaluate的外层元数据。QA通过原预览客户端触发实际独立场景并读取真实产出；不直接运行受保护活动、不写来源根、不读取本任务03/04。原八个测试及三阶段软件传递/错误守卫由本轮verify实际执行并由独立judge核，fake-provider测试不冒充真实模型语义。独立语义审查应能看到固定原文、冻结批准依据与实际02差异，不能以字段齐全替代语义判断；不为制造revise而改GAN评分或预算。资源未准备则如实CANNOT_VERIFY。本段仅明确原五条验收的证据交接和执行角色，不新增验收。

【原五项验收的失败继任与阶段澄清；不新增验收】
前次正式任务840cb277-8315-4ec9-b243-ecad730156e3已真实verify失败，原01/02/04及失败状态必须保留，不复制为本轮证据。本轮复用其固定8aac58acfbf2de50f03ee4aab9b9603fb1099bc3实现及随后已独审材料状态修复8a47a7513e0dd8088c5d2650e03953c18fe133b3；以实际新base顺序接入对应c587之后的必要实现/永久RED/修复提交，不重新设计或丢弃真实A无显式ID规则的可复算锚点、空集拒绝与大小/深度边界。本轮完整提交清单如下，替代前述旧准备候选的短SHA清单，只执行本列表一次，不重复cherry-pick两套：84a98404472856d631edce5053cae5375235c01f、23326af999b6b8a1ee0b26255e962055ef25643e、96397f01872032283ba1e8b19168614c6d68701f、21a767858af98de571df33ac659163f0b761d2b7、ca583fe98bbaff0cb0d325b11908e26b618b2eb3、3dd693a9cd5778559c66645617e340720e2a460d、abcf1cf85374020ab451e0bf6638fa30a6c19be3、6ab470a0fe9c89332f34d933a60a0063713081c6、6a786bab9d6c706244759242042e2fec3e6c9228、8aac58acfbf2de50f03ee4aab9b9603fb1099bc3、61b925e8d6b164804d71f90f299eb865bc1ffa64、8a47a7513e0dd8088c5d2650e03953c18fe133b3。来源树 /Users/administrator/worktrees/cecelia-cw/b840-material-repair；不复制原sprints/04或把既有回归日志当本轮verify。
材料状态沿原I-1与baseline-policy已有承诺：keep/update/retire/conflict/not_applicable。明确批准的retire及有理由的不涉及可继续；未批准退役、未解决冲突、未知状态、缺理由/验证/引用仍拒绝。前次把集合缩为keep/update是回归，不得为消除失败删掉已批准退役正例或放宽授权。
verify在发布前实际运行原八个测试、实际检查器与固定Git原文/候选产物核验，并保留真实命令/输出/退出码；三阶段传递、固定版本/摘要/单次模板替换等软件行为在该阶段与独立judge核实。正式QA资源ready、PR号、最终候选HEAD、preview、nonce、manifest和QA判定只在publish之后由监督按实际事实准备并在正式QA核实。verify不得以这些未来字段当前为空判I-2产品失败，也不得把未来QA已经通过写成现在的结论；当前可查输入与原始产物的可见性/正确性仍须实查，不能因此免除原I-2。
现有资源真实接口是：QA读取/Users/administrator/research/coding-B-formal-qa/formal-resource-index.json，按其中公开的manifest/client preload与预声明request，经原preview客户端POST任务再GET真实输出；不是把该文件路径作为不存在的evaluate参数传给控制器。QA不直接执行受保护活动、不读本任务03/04、不写私有来源；监督控制器提供原文、候选02、批准依据及实际检查结果供QA独立对照语义。软件fixture不冒称真实模型语义；独立语义审查必须读原文和差异，不能只检查字段。但不将原软件回归移交QA重跑，不新增所有spec/review/revise真实模型链或为了出现revise改评分/预算。各阶段未完成事实留给原对应门，最终仍须真实QA、judge、CI与正常合并。

## 旧资料引用事实

legacy/unconfigured：旧任务未声明权威资料，保留原有要求的未知状态。

### I-1
spec、spec-review、spec-revise共同读取A批固定基线，02逐项交代已登记旧规则/材料的保留、修改、废弃、冲突或不涉及理由，并关联I/S/Q。稳定规则ID不等于本次I-n。

### I-2
受管对象遗漏旧规则、伪造规则、引用不存在S/Q、无依据修改/废弃承诺产生确定性错误；独立语义审查可看到原文及差异，不能用字段齐全代替语义完整。

### I-3
明确批准的业务变化可继续并保留确认依据，未解决冲突不能自动放宽旧预期。保持原GAN预算/FORCED策略，不暗改策略来过新检查。

### I-4
02包含计划和材料更新表，说明规格/实现/样本更新或保留的理由与验证方式；不强制新增plan.md，不削弱原I/S/Q、铁律及真实调用方要求。

### I-5
合法保留/批准修改通过，遗漏/冲突/缺确认失败，旧任务兼容；执行实际检查器及活动调用测试，保留现有spec/review回归。
