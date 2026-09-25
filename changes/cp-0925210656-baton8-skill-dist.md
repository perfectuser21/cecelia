## Brain {VERSION} — Skill 分发：清单哈希 + 漂移检测 + 同步脚本入库（链 bf5088a3 棒8，任务 1141f101，决策 105a5868）

- 病根（09-25 只读探测实证）：MMV `~/.claude/skills` 顶层几乎全是指向 zenithjoy-skills 的符号链接，MMV 本机 cron 用 `rsync -az`（无 `-L`）把链接原样拷到跑场机——M1 上 133/133 悬空、M4 126 悬空，「条目数 135=135」的对齐是假的，经跑场池下放的会话实际没有可用 skill；cron 无 `--delete`、无校验、不在仓库，M4 还多 11 个旧残留；真身自己也有 29 个悬空链接
- 清单：`lib/skill-manifest.sh`（纯 bash，经 ssh 送到目标机执行，us-vps 零执行）逐 skill 按内容算稳定哈希（跟随符号链接；忽略 `.git`/`.DS_Store`/`node_modules`/`__pycache__`；mtime 不参与），悬空链接单列 `broken` 且不进 `tree_hash`；`lib/skill-manifest.js` 解析并重算 tree_hash（输出被截断即判 invalid）、比对出 missing/extra/changed/broken；`scripts/skill-manifest.sh` 薄包装
- 漂移检测 job `skill-dist-drift`：30min 自 gate，真身 MMV 直连、跑场机 xian-m4/xian-m1 经 mmv 跳板（`SKILL_DRIFT_RUNNERS` 可配、别名严格校验），各机各两目录（`~/.claude/skills`、`~/.codex-gwremote/skills`）并行取清单，每条 exec 显式 45s timeout + maxBuffer；结果写 `working_memory.skill_manifest_drift`。ssh 失败/超时=`unreachable`、输出无效=`invalid`，都是「未核对」，不产生 missing、不计入漂移（防「探不到=零个=全漂移」假警）；真身取不到整轮不出逐机 diff
- 晨报/日报：晨报新增 🟡 AMBER「skill 分发漂移」一行、日报新增同名板块（沿棒 7 形状）；检测数据超 6h 未刷新也 AMBER；无数据/读取失败不出、不拖垮
- 同步脚本 `scripts/skill-sync-to-runners.sh`：默认 `--dry-run`（核对清单 + `rsync -n` 预演），`--apply` 才真同步，`--prune` 才 `--delete`；`rsync -azL` 送真内容并镜像到 `~/.codex-gwremote/skills`；同步后重算两处清单，与真身不一致退 1、目标不可达退 2；只同步有内容的 skill（真身悬空链接点名告警）。**本 PR 不替换本机 cron**
- 测试：清单脚本 22 项（mtime/改一字节/忽略集/符号链接/悬空/目录缺失）+ 漂移 job 25 项（改/删/多/悬空/dir_missing/unreachable/invalid/真身不可达/gate/命令带 timeout/列表上限）+ 同步脚本 10 项（假 ssh 映射本地目录 + 真 rsync：dry-run 不写、apply 把悬空链接换成真内容、prune 才删、幂等、不可达退 2）+ 接线 7 项；smoke `skill-dist-drift-smoke.sh` 登记 allowlist
