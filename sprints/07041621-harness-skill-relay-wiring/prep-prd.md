# 小改动 PrepPRD：N3 harness skill-relay 最小接线

> Brain task: 4609143f。Initiative: harness-skill-relay(主理人 2026-07-04 拍板)。

## 改什么
1. **scripts/harness-judge-cli.mjs**(新):runJudgeGate 的 thin CLI wrapper——harness-controller skill Step 5 调用。args: --task-id/--sprint-dir/--worktree/[--prompt-dir]/[--agent-verdict|默认读 worktree/.brain-result.json]/[--transcript-file]。stdout 输出 JSON {verdict,feedback,judged};exit 0=PASS,2=FAIL,1=错误。导出 main(argv,deps) 供单测注入 judgeGateFn
2. **executor.js**:_driveHarnessInitiative 顶部加分支——task.payload.orchestrator==='skill-relay' → _spawnSkillRelaySession:ensureHarnessWorktree → resolveAccount → prompt=loadSkillContent('harness-controller')+上下文头(HARNESS_TASK_ID/SPRINT_DIR/BRAIN_URL) → spawnDockerDetached(containerId=cecelia-relay-<task8>-<rand>,env 含 HARNESS_INITIATIVE_ID/GITHUB_TOKEN) → INSERT initiative_runs(phase=A_planning, orchestrator_version='v2', deadline_at=NOW()+6h) → return {ok:true,mode:'skill-relay'}。**不 compile 图不 invoke 图**

## 为什么改
skill-relay 链路的最后两块接线;双轨(不带 flag 的任务照旧走 LangGraph 图,零行为变化)。

## 关键复用
- callback fencing(#3526 之前 T3-A 合并?——否,T3 未合并!)——⚠️ 核实:fencing 在封存分支上没进 main!skill-relay session 容器退出的 execution-callback 会被 v1 callback-worker 处理(UPDATE tasks)——session 正常结束 exit 0 + harness-report 已回写 completed,callback 再写一次 completed 幂等无害;异常 exit 时 callback 标 failed 也是合理语义。**v1 消费链对单容器 session 模式无害,不需要 fencing**(与 T3 多容器模式不同)。记录此判断,N4 真跑时验证
- watchdog:initiative_runs phase=A_planning 在 overdue 扫描白名单内,deadline 6h 兜底

## 影响范围
executor.js 加一个早退分支(flag 不设=零变化);新增独立脚本。生产无 DB 迁移。

## 验收标准
- [ ] judge-cli:注入 fake judgeGateFn 的单测(PASS→exit0/FAIL→exit2/缺参→exit1/brain-result 默认读取)
- [ ] executor 分支:flag 命中→不 compile 图+spawn 被调(prompt 含 skill 内容标记)+initiative_runs INSERT(v2/deadline);flag 缺省→走原路径(回归断言)
- [ ] CI 全绿
