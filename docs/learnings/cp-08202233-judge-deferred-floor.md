# Learning: 裁判=PASS 终判 FAIL 第三半——结构性 server-owned 检查不能靠合同白名单

### 根本原因
- 三方协议缺口：judge prompt 教裁判标 deferred ↔ validateCoverage 只认合同
  verification_stage.deferred_checks 白名单 ↔ proposer 从不生成该白名单（r31 合同全文
  0 次 deferred）→ 白名单恒空 → 裁判正确延后的 server-owned 步骤全落 failed →
  FAIL(evidence_insufficient) → recollect 同形 → 止损闸停人审。
- 深层：host_docker_inspect/judge_verdict/publisher_result/all_gates_passed/
  server_required_assertions/completed_role_chain 是**每个 run 都由服务端执行**的结构性
  事实，让每份合同重复声明 = 把机械判定建立在 LLM（proposer）自愿配合之上——正是
  judge-deferred 前两半（#4948/#4949）同款病根的第三处表现。

### 下次预防
- LLM 链条上「A 角色教了规则、B 机械层不认、C 角色从不生成授权」的三方协议要整链核对，
  修任何一端前先画三方矩阵——本病 prompt(2026-08 早已写) 与 validateCoverage(白名单制)
  各自正确，缺口在 proposer 输出面。
- 同一专名的双语境（后置断言本体 vs 取证缺口指控）：机械放行必须双条件
  （专名命中 + 裁判延后声明），修死锁前先找"这个词还会出现在哪种该 FAIL 的句子里"
  ——527 用例就是现成的反例库。
- [ ] r31 人审 approve 后验证新判定把 coverage 判 deferred → PASS → publisher 放行

### 证据
- run 1e27d4da 两轮 judge decision（agent=PASS, judge=PASS, coverage_ok=false）
- 真实 entry：deferred:false 字段 + "DEFERRED —" 写在 evidence（ce703092 形态重演）
- orchestrator_decision_log: evidence_insufficient_after_recollect（止损闸生效）
