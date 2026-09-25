# Skill 分发机制：清单哈希 + 漂移检测 + 同步脚本入库

日期：2026-09-25　任务：Brain 1141f101（链 bf5088a3 第 8 棒）　决策：105a5868（C 档，报备即做）

## 0. 结论

MMV `~/.claude/skills` 是 skill 真身（非 git 仓库内容，见 §1）。现有同步是 MMV 本机 crontab 一行（`# skill-sync-to-runners`，未入库）。09-25 实测发现它**同步的是坏的**：

| 事实（只读探测，2026-09-25） | 后果 |
|---|---|
| MMV 的 135 个条目里 133 个是指向 `/Users/administrator/perfect21/zenithjoy-skills/<name>` 的**符号链接** | 真内容在符号链接目标里 |
| cron 用 `rsync -az`（无 `-L`），把符号链接**原样**拷到 M1/M4 | M1 上 133/133 个条目是悬空链接（目标路径在 M1 不存在），M4 126 个悬空 |
| 之前用「条目数 135=135」判对齐 | 数量对得上，内容为零：经跑场池下放的会话**没有可用 skill** |
| cron 无 `--delete`，无校验，行不在仓库 | M4 多 11 个旧残留，漂移无人知 |

所以本棒的核心不是「再加一个数数的检测」，而是：**清单按内容（跟随符号链接）算哈希**，悬空链接单独标 `broken`，同步改 `rsync -L` 送真内容。

## 1. 清单（manifest）

一份实现：`scripts/skill-manifest.sh`（纯 bash + find + sha256，macOS bash 3.2 / Linux 通用，无 node/jq 依赖）。Brain 镜像只拷 `packages/brain/src/`，job 要在运行时读到它并经 ssh 送到跑场机执行，所以 `packages/brain/Dockerfile` 加一行 `COPY scripts/skill-manifest.sh ./scripts/`（同 `extract-contract-e2e.cjs` 先例），job 按「容器 /app/scripts → 仓库根 scripts」两处找。不放进 `src/`：island-gate 会把 src 下无 import 出/入边的新文件判孤岛。

输出一行 JSON：`{"version":1,"dir":…,"host":…,"count":N,"skills":{name:sha256},"broken":[name…],"tree_hash":sha256}`。

- 单个 skill 哈希 = sha256( 按相对路径字节序排序的 `相对路径<TAB>文件sha256\n` )；跟随符号链接（`find -L`）；忽略路径分量为 `.git` / `.DS_Store` / `node_modules` / `__pycache__` 的项（最后一个是 09-25 真机 dry-run 在 M4 skill-creator 上实测到的：python skill 运行时自生成字节码，不排除会永久假漂移）；mtime、权限位不参与。
- 顶层条目：非隐藏的目录或指向目录的符号链接才算 skill；悬空符号链接进 `broken`；隐藏项与普通文件忽略。
- `tree_hash` = sha256( 全部有内容 skill 的 `name<TAB>skill哈希\n` 行整体排序 )，悬空项不进 tree_hash（真身自己有 29 个悬空链接，进了会让任何目标永远对不齐）。JS 侧 `verifyTreeHash` 重算，输出被截断/篡改即判 invalid，不当真。
- 目录不存在：输出 `{"version":1,"error":"dir_missing",…}` 退出码 3。

## 2. 漂移检测 job（PR 内新增 `skill-dist-drift`）

**us-vps 零执行**：Brain 只经 ssh 读，不在 us-vps 算哈希。脚本文本 base64 后随命令送到目标机 `bash -s` 执行，只回传 ~10KB JSON。

- 真身（MMV）：`ssh mmv`；跑场机：`ssh mmv 'ssh <别名> …'`（us-vps 上只保证有 `mmv` 别名，跑场机别名以 MMV 的 `~/.ssh/config` 为准，不在代码里写 IP/用户名）。默认跑场机 `xian-m4,xian-m1`，`SKILL_DRIFT_RUNNERS` 覆盖（HK 不是会话跑场机，默认不含）。
- 每台跑场机检两个目录：`~/.claude/skills` 与 `~/.codex-gwremote/skills`（都应等于真身）。
- 采集一律 `defaultExecAsync`（显式 timeout 45s + maxBuffer 128MB，不阻塞事件循环），各机并行，总耗时 ≈ 单机超时。
- 每机每目录状态：`ok` / `drift`（缺 missing、多 extra、哈希不同 changed、悬空 broken）/ `dir_missing`（算漂移，ssh 通了目录真没有）/ `unreachable`（ssh 失败或超时）/ `invalid`（输出不可解析或 tree_hash 对不上）。**`unreachable`/`invalid` 是「未核对」，绝不当成零个 skill 去算全漂移**。真身取不到时整轮标 `truth_unavailable`，不产生任何逐机 diff。
- 自 gate 30min（读 `skill_manifest_drift.checked_at`），结果写 `working_memory.skill_manifest_drift`；调度轮 60s 都会调用，哨兵活性尺子默认 60s；JOBS 中放在 `ops-collector` 之后、`scheduler-liveness` 之前。

## 3. 晨报 / 日报

沿棒 7 的形状：`lib/skill-dist-report.js` 导出 `readSkillDistState` / `renderSkillDistLine`（晨报一行）与 `renderSkillDistSection`（日报板块「skill 分发漂移」）。有漂移、有未核对（unreachable/invalid）、真身取不到、或数据超过 6h 未刷新 → 🟡 AMBER；无数据（job 从未跑）→ 不出。真身自己的悬空链接（MMV 实测 29 个）只在日报板块点名，不让晨报常亮（它是真身自己的清理待办，不是分发漂移）。读取 best-effort，失败不拖垮晨报/日报。

## 4. 同步脚本 `scripts/skill-sync-to-runners.sh`

替代那行 cron 的逻辑，但**本棒不替换 cron**。默认 `--dry-run`：算真身与各目标 manifest，打印漂移，并 `rsync -n` 列出将改的文件；`--apply` 才真 rsync；`--prune` 才带 `--delete`。

- `rsync -azL`（送真内容而不是悬空链接），排除 `.git` `.DS_Store` `node_modules` `__pycache__`（与 manifest 忽略集一致，也保护目标上的 `~/.claude/skills/.git` 不被 `--delete` 删）。
- 真身里的悬空链接不参与同步：脚本先在临时目录里建一份只含「有内容 skill」的符号链接视图再 rsync（不用 `--exclude` 排悬空名，否则目标上同名残留被排除规则保护、`--prune` 删不掉），并在输出里点名。
- 同步后：目标 `~/.claude/skills` → 镜像到 `~/.codex-gwremote/skills`（同 cron 第二跳）→ 两处重算 manifest，与真身 `tree_hash` 不一致退出 1；目标 ssh 不通退出 2（不当零个）。
- 目标用 ssh 别名（默认 `xian-m4 xian-m1`，`SKILL_SYNC_TARGETS` 覆盖）；`SKILL_SYNC_SSH` 可换 ssh 可执行文件（测试注入）。

## 5. M4 残留（只在文档列，本棒不删）

见 handoff：M4 上有 11 个真身没有的目录（旧快照残留）+ 工作区残留 skills 目录；清理是破坏性操作，由主会话/主理人执行。上线后 `--apply --prune` 一次即可把 `~/.claude/skills` 与 `~/.codex-gwremote/skills` 收敛到真身。

## 6. 测试策略

单测 + 集成，**不真发 ssh**：
- 脚本行为（临时目录夹具，真跑 bash）：同内容不同 mtime 哈希相同；改一字节该 skill 与 tree_hash 变；忽略集；符号链接跟随（与真目录同哈希）；悬空链接进 broken；目录缺失退出 3；`@home` 展开。
- 纯逻辑：`parseManifestOutput`（含 tree_hash 校验、噪声行容忍）、`compareManifests`（missing/extra/changed/broken）、渲染。
- job：注入假执行器——改一个 skill → 该机 drift；删一个 → AMBER；同内容不同 mtime → ok；ssh 失败/超时 → `unreachable` 且**不产生 missing**；真身不可达 → `truth_unavailable`；30min 自 gate；命令必带 timeout。
- 同步脚本：注入假 ssh（映射到本地目录树）+ 真 rsync：dry-run 不写；apply 把悬空链接替换成真内容；无 `--prune` 不删多余项、有则删；同步后不一致退出 1；目标不可达退出 2。
