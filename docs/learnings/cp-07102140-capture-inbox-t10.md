## 九要素T10：统一收件箱通电（2026-07-10）

capture_atoms 表 07-07 设计（928c6054）后结构完备但仅 1 条记录空转三天：handoff/learning/issue 产出后不进箱、四路分诊（紧急插队/挂Line backlog/变铁律/走OKR）从未实现。本 PR 通电三件事：三入口顺手推 atom（吞错不阻塞主流程）+ capture-triage 分诊 tick（便宜规则优先+LLM兜底）+ invariant-gate 四查 fail-closed 才准写 decisions category='invariant'。

### 根本原因
"先建表后接线"的账本只完成了 schema 不算通电——写入方、分诊消费方、写入闸门三者缺一都是空转，而空转的表在审计前没有任何机械信号暴露自己（与 T7 initiative_run_events 断供同病）。addendum 设计稿与真实代码还有四处漂移（source_type 列不存在 / tick-runner 已废弃应注册 scheduler-jobs / routes/issues.js 不存在 / saveHandoff 无运行时调用方），凭设计稿直接开工必踩。

### 下次预防
- [ ] 新表立项必须同 PR 交付"写入方+消费方+闸门"三件套，只交 schema 一律不算完成（DoD 写明进箱/出箱路径）
- [ ] 依据设计稿开工前先派探员核对涉及的列名/文件/注册点是否与代码一致，把偏差表写进 spec 再动手
- [ ] AI 产出直通账本（decisions/learnings）的写入路径必须前置校验闸（本次 invariant-gate 四查 fail-closed + prompt 围栏防注入），"先写后治理"已被 9.6 万垃圾行证伪
- [ ] 分诊/自动化留箱条目统一 `[triage:` 前缀标记并在 SELECT 排除，防 LLM 每轮重试烧钱；人工出路走 confirm 改判
