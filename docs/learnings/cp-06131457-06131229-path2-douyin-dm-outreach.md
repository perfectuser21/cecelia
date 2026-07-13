# Learning — 抖音私信主动触达 thin v1

## 运行指标

- GAN 轮次：3（Round 3 全 7 维 ≥7 → APPROVED 收敛）
- Evaluator Fix 次数：3（oracle 完整性 R1→R3 逐轮加强：禁用字段反向 guard + data keys 完整性 + 4 处 weak-oracle 修复）
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/760（OPEN，未合并）
- Sprint Dir：sprints/06131229-path2-douyin-dm-outreach

## 发现的问题

### [INFRA] 基础设施问题（本次主阻塞）

- **xian-rog 自托管 runner 下载 GitHub Actions 超时反复卡 CI**：`preflight-xian-rog`×2 + `job2 Agent 启动路径 listen_chat dryrun` 三个 job 失败，根因均为下载 `actions/setup-node@v4`（codeload.github.com）100s HttpClient 超时；runner 已配代理 `100.86.118.99:7890` 仍超时。这是国内 self-hosted runner 拉 GitHub 资源的典型网络问题，**非本 PR 代码缺陷**——所有真实代码 CI（API/Agent/Dashboard/Golden Path 1&4）全绿。
  - 预防：self-hosted job 预拉取/缓存常用 actions（actions/checkout、setup-node）到本地 runner tool-cache；或用国内镜像源；或将 setup-node 换成 runner 自带 node + 跳过下载；或容器化该 job 用预装镜像。建议建 Notion Issue（recurring infra，sub-area=zenithjoy/multi-agent）。

- **Report 执行环境无 Brain/DB**：本次 harness-report 在 Linux sandbox 运行，localhost:5221（Brain）与 5432（Postgres）均不可达、无 DATABASE_URL → Phase A 全部 Brain 回写与 Phase B db-update 状态同步无法执行。
  - 预防：report agent 启动时先探测 Brain 可达性，不可达则明确进入「降级模式」（只产本地产物 + 标记 BLOCKED），并把待补同步登记到可恢复队列，而非静默 WARN 后假装完成。

### [DESIGN] 设计缺陷

- **harness-report skill 默认 `merged:true` 与现实脱节**：skill 在 evaluator PASS 后即假定 PR 已合并并回写 `status=completed/merged:true`。但 evaluator PASS 只代表代码通过评审，PR 仍 OPEN 且可能被 CI（尤其 self-hosted infra）卡住。Report 不应无条件写 merged:true。
  - 预防：Step 1 回写前先 `gh pr view --json state,mergedAt` 核实；未合并则写 `status=in_review` 而非 completed，避免污染 Brain 任务状态与 OKR 进度。

### [PROMPT] Prompt 类问题

- （无）

### [BUG] 代码缺陷

- （无；evaluator 非阻塞观察：draft Step1 用 interval '60 seconds' vs dod BEHAVIOR '5 minutes'，皆有效时间窗非矛盾，落地 smoke.sh 时统一即可；Endpoint1 声明 FEISHU_NOT_BOUND 但 error-path 只测 3 错码，加厚时补测。）

## 下次预防清单

- [ ] self-hosted runner（xian-rog/xian-pc）job 预缓存 actions，规避 codeload 下载超时
- [ ] report agent 先核 PR merged 状态再决定写 completed 还是 in_review
- [ ] report agent 先探测 Brain 可达，不可达则降级 + 登记待补同步
- [ ] 落地 golden-path-2-dm-smoke.sh 时统一 60s vs 5min 时间窗描述
- [ ] DM error-path 加厚时补测 FEISHU_NOT_BOUND 错码
