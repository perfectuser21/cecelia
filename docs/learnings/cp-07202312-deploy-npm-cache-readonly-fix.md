## 生产部署连续失败根治——deploy-local.sh npm ci缺--cache（2026-07-20）

Alex 问"为什么我的代码合并了但没生效"，排查发现生产 Brain 从今天凌晨起，`Brain CI Deploy (Gate 3)` workflow 连续多次失败，导致 PR #4135、#4138 合并后生产版本一直停在 1.267.20 没更新。

用 systematic-debugging 走完整流程排查：先看 GH Actions 失败日志只有一句"deploy-local.sh exited code=1"（不含具体原因，因为脚本实际在宿主机后台执行，GH Actions 只轮询状态），转向宿主机部署日志目录（`~/.perfect21/cecelia-deploy-main/logs/`，不是我一开始以为的主开发仓库路径），找到真实错误：`npm error enoent ENOENT: no such file or directory, mkdir '/Users/administrator/.npm'`。

第一次假设错了：以为是宿主机全局 npm 缓存目录缺失（本次会话早前确实修过一次，是磁盘清理误删的），但验证发现宿主机 `~/.npm` 其实一直存在且可写，两次手动重跑还是同样报错。往下深挖才发现：`deploy-local.sh` 的 npm ci 实际是被 **`cecelia-node-brain` 容器内**的 Brain 进程 spawn 执行的，不是在宿主机 shell 里跑。用 `docker exec` 进容器直接验证：容器内 `$HOME=/Users/administrator`，这个目录是**只读挂载点**，只有 `.claude`/`.codex-team1`/`.credentials` 等个别子目录被单独挂成可写，`.npm` 从来没被挂载过，容器内 `mkdir` 直接报 `Read-only file system`。

修法：npm ci 加 `--cache "$MAIN_ROOT/.npm-cache"`（指向 bind-mounted 且可写的项目目录），跟同一个脚本文件里 40 行之后的 Dashboard npm install 步骤保持一致——那一步早就正确带了 `--cache`，注释也写明了原因，只是当初新加 Brain 依赖同步这一步时没人把同样的教训对齐过去。

### 根本原因
1. 部署脚本里两处几乎相同的 npm 调用（Brain 依赖同步 vs Dashboard 构建），一处已经吸取过"容器内默认路径不可写"的教训并正确处理，另一处是后加的、没人回头检查是否也要同样处理——**同一份文件内部的一致性没被系统性检查过，只查了"这次改动本身对不对"，没查"这个脚本里还有没有类似写法没对齐"**。
2. 排查过程走了弯路：GH Actions 日志本身信息量很少（只有退出码，没有真实 stderr），必须知道"实际执行日志落在哪个路径"才能看到根因——这个路径本身（`cecelia-deploy-main` 而非常规开发仓库）不是一眼能猜到的，是从 Brain 源码里 spawn 逻辑读出来的。
3. 第一次假设（宿主机缓存缺失）看似合理（因为本次会话早前真的修过一次类似问题），但没有先验证就直接下结论去"修复"，浪费了一轮重跑——后来才意识到宿主机和容器是两个完全独立的文件系统，"宿主机修好了"跟"容器里能用"没有任何因果关系。

### 下次预防
- [ ] 排查"某条命令在生产环境失败"类问题时，第一步先确认这条命令**实际在哪个执行上下文里跑**（宿主机 shell？哪个容器？哪个用户？），不要想当然套用"我刚修过类似问题"的经验——本次教训是宿主机和容器是完全独立的文件系统，同名路径不代表同一个东西
- [ ] 同一个部署/运维脚本文件里，如果一处已经因为踩坑加了特殊处理（如 `--cache` 指向项目本地目录），review 或者新增类似步骤时应该主动检查"文件里其他相似调用是不是也该照做"，不要等下次真的踩同一个坑才发现
- [ ] GH Actions workflow 只是轮询状态的壳，真实错误日志落在宿主机文件系统的具体路径——遇到"CI 报错信息很短、看不出细节"时，先去找真正执行的地方留没留更完整的日志，而不是对着一句"exit code=1"瞎猜
