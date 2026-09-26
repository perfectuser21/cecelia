# 交接单：验证层（活动后置条件横切件）六棒接力链 —— 09-26 立项到 09-27 生产接通

链根任务 `cf1bae42` · 决策 `702949b6`（立项）/ `95e29afd`（执行机读回）/ `280bd091`（callback 加 token）/ `374b5730`（获客路 4 步落库）/ `4f8460a6`（读回在 MMV）/ `55ca9214`（zenithjoy 生产 API 放行）/ `2ca30c4d`（钩子并入现网脚本，退役 v4）

## 一句话

体系里"活动发生了"有记录（task_runs / 账本 / 退出码），"活动做对了"没人判——缺的对象是 **步级后置条件（探针）**。本轮把它接进现有八个部件而不是新造第十个：YAML 声明（workspace）→ step_probes 注册表（Brain）→ cell.assertion_ref=`probe:k1,k2` → 执行机账本 stage 回执（带 observed）→ run.finished → business-probe-judge 比对 → journey_assertion_receipts(business_probe_runner) → cell 翻色 → 晨报/日报「断言红灯」行。

## 合并清单（15 个 PR，全部 main）

| 棒 | PR | 内容 |
|---|---|---|
| 0 | （数据）| journey afa6abca 按 60da58cf 落 4 步 + 7 个 stage cell（psql，POST /journey_steps 是 ON CONFLICT DO UPDATE 且无 PATCH） |
| 1-ws | zenithjoy #1981 | 账本 stage/finalize 回执 execution-callback；startTask 返回 brain_task_id |
| 1-brain | cecelia #5592 | execution-callback 挂 internalAuthOrLoopback + 限流；task_runs.result 保 stage/metrics/probes |
| 1-brain-2 | cecelia #5605 | in_progress + result.stage 的回执 = stage run 已结束（startRun→finishRun），任务不终态 |
| 2-ws | zenithjoy #1982 | checks/social-keyword-leadgen.yaml 五条探针 + schema + probes-lib |
| 2-brain | cecelia #5589 / #5594 | 迁移 474/476 step_probes（spec_hash + source_sha256）、GET/POST /step-probes、drift-check、sync-step-probes.mjs、classify 认 probe: |
| 3a | cecelia #5590 / #5596 | run.finished 事件、business-probe-judge、persistBusinessProbeReceipt、迁移 475 放开 CHECK、resolver 分支、只认 active 探针 |
| 3a-2 | cecelia #5603 | 无 anchor 时按 run_id 的 workflow 名兜底找探针，判定后回填锚点 |
| 3b | zenithjoy #1983 | verify-step.mjs 读回（sql 参数化 / 飞书 http 分页） |
| 3b-2 | zenithjoy #1984 | 读回改经 ssh 在 MMV 跑；videos_readback 去掉错误的 line_key 条件 |
| 3b-3 | zenithjoy #1985 | 钩子并入现网 harvest-cron.sh/batch2.sh（wfr_on 守卫），退役 v4 副本，删孤儿 escort 清理 |
| 4 | cecelia #5588 | 晨报/日报「断言红灯」行 |
| 补 | cecelia #5598 | codex-bridge 回调补 Bearer 头 |
| 补 | zenithjoy #1987 | escort 30s 复核改按 id（cron list 表格截断名字致假阳性） |

## 生产现状（09-27 07:15）

- Brain 生产 1.333.6，#5605 等 bump #5608 上产。step_probes 已灌 5 条并绑 stage:delivery / stage:scoring。
- zenithjoy 生产 API（HK :5200 = autopilot.zenjoymedia.media）已 promote 到 23b0cd8a（`promote-prod-hk.yml`）。
- xian-m4 `~/bin-harvest/`：harvest-cron.sh / batch2.sh / workflow-result.sh / wall-report.sh / ledger.mjs / checks/ 与 main 一致；v4 残留已删；crontab 原样 6 条。凭据 `~/.credentials/cecelia-internal.env`（1Password「Cecelia Internal Token」字段 credential）+ `brain.env`（引用前者）。
- MMV `~/.openclaw/leadgen-scripts/`：verify-step.mjs + checks/（读回在此执行，leadgen Postgres 只在 MMV 回环）。
- **xian-m1 未部署钩子**（悦升 YAML 未写，探针会打金诺表）；token/brain.env 已落。
- 西安两台 codex-bridge 已换主线代码带 Bearer 头并重启。
- 06:00 金诺批实证：Brain单 拿到 id ✅、账本 init ✅、stage 回执 4 行进 task_runs ✅；判定未触发（#5605/#5603 当时未上产）。**今晚 22:00 批 = 真正端到端首验**。

## 验收点（22:00 批之后）

1. m4 `harvest-cron.log`：`Brain单:` 有 id、`账本init/finalize: ok=1`、无 `WFR_WARN … skipped`、`escort复核命中`。
2. Brain：`task_runs` 中 run_id `social-keyword-leadgen-crontab-auto0927220*__a1.delivery` status=success 且 result.probes 三条 observed。
3. `journey_assertion_receipts WHERE executor_kind='business_probe_runner'` 出现 PASS/FAIL；`journey_step_links` stage:delivery 的 cell_status 翻色。
4. 次日晨报出现「断言红灯」行（warn → AMBER）或无红灯（全 PASS 不出行）。

## 遗留 / 后续

- 棒 5（任务 843cab7a）：观察 ≥3 天后——kr_verifiers / acceptance_checks / golden_path_run_receipts 退役；crystal 作 probe 类型；分拣/文案/触达补 YAML，触达升 error+fail-closed。
- 悦升线 YAML（换 table id）+ xian-m1 部署。
- 任务 e5852dc1：sync-credentials.sh 漏登记 Cecelia Internal Token；brain-deploy 缺文件时 openssl 另生成会造成分叉。
- 探针 YAML 漂移 AMBER 行需 workspace CI 跑 `sync-step-probes.mjs --check` 回报（Brain 读不到 workspace 仓）。
- device_job 镜像 `brain-device-job-mirror.ts:103/140` psql 直写 tasks 绕过 task_runs（棒 1 未修）。
- checks YAML 注释里残留 v4 行号（改则重登记）。
- Notion issue dda6de84：dev-mode-tool-guard 对 Agent isolation:worktree 的 `.claude/worktrees/` 路径无逃生口。
- **运营发现（非验证层）**：金诺号 crontab 三批（22/02/06）每批跑 4-5 小时互相衔接，后一批开跑时前一批仍占设备 → 06:00 批多数词 `discovery blocked`，每天白白空转一批。

## 踩坑（已入记忆 verification-layer-chain-launched.md）

Agent isolation:worktree 锁死 / 建单五坑 / 版本 bot 绕过 --disable-auto / bash-guard 对凭据路径连 `2>&1 |` 都拦 / zsh `$h:repos` 修饰符 / 影子跑拿不到设备 / v4 副本分叉 / 影子孤儿清理误杀生产 escort / gh workflow list 不显示 promote 工作流。
