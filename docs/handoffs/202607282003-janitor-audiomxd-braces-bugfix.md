# Handoff：fix(janitor): brace audiomxd_pid to avoid bash multibyte parsing bug

- task_id: unknown（对话内临时排查延伸出的 bug 修复，未走 Brain task 注册）
- initiative_id: N/A
- journey_id: 91c17939-225c-4491-92f3-67d8b0ace4d9（工厂 · F4 故障自愈）
- verdict: PASS
- created_at: 2026-07-28T12:03:00.000Z

## 完成了什么
- 承接同一 session 的 janitor audiomxd watchdog 交付（zenithjoy-skills#168）：用户要求"不光要挂，还要验证跑不跑得通"，现场用真实卡死的 audiomxd 进程跑了一遍 `--mode frequent`，发现 kill 成功但日志行乱码
- systematic-debugging 定位真根因：**bash 对未加花括号的 `$var` 紧贴无分隔符的多字节 UTF-8 字符（如全角"（"）会解析出错**——变量值整个丢失、紧跟字符被截断首字节，严重时甚至把截断字节并入变量名触发 `unbound variable`。已确认这不是 homebrew bash 5.3.15 的版本回归——**系统自带 `/bin/bash` 3.2.57（2007年老版本）同样复现**，是 bash 长期存在的通用行为，非某个版本的 bug
- 修法：`$audiomxd_pid` → `${audiomxd_pid}`（花括号是语义上永远安全的根治写法）
- 走完整 TDD 流程：先写行为级回归测试（真实执行 janitor.sh 里的那行代码，不是静态 grep）确认先红（0通过/3失败，含 unbound variable 崩溃）→ 修复 → 确认全绿（3通过/0失败）
- PR [zenithjoy-skills#169](https://github.com/perfectuser21/zenithjoy-skills/pull/169) 已合并，并已 `git pull` 到实际运行 cron 的生产 checkout（`/Users/administrator/perfect21/zenithjoy-skills`），非仅停留在 GitHub main
- 决策记录：`53bea3c4`
- 补充教训：**PR 合并到 GitHub main ≠ 已生效**——本地实际运行的 checkout 需要单独 `git pull` 才会真正生效，这个环节之前在部署 #168 时漏掉过一次，被用户当场问出来才发现并补上

## 没完成什么
- 未扫描整个代码库是否还有其他脚本存在同样的"变量紧贴全角字符无分隔符"隐患模式（本次只确认了 janitor.sh 自身没有其他实例，未做仓库级排查）
- 这个 bash 解析陷阱目前只记在 decisions（`53bea3c4`），没有沉淀成 lint 规则或 shellcheck 类工具的自动检测（如果未来还有人写类似代码会重蹈覆辙）

## 下一步建议
- 有精力时可以全仓库 grep 一遍 `\$[a-zA-Z_][a-zA-Z0-9_]*[^\x00-\x7F]`（未加花括号变量紧跟非ASCII字符）模式，看还有没有类似隐患
- 可以考虑把这条 bash 陷阱写成一条通用的 shell 编码规范（比如加进某个 shellcheck 自定义规则或代码规范文档），避免只停留在 decisions 里没人主动查

## 数据源（下一个大脑要加载的）
- decisions `53bea3c4`（这次 bash 陷阱的根因记录）
- decisions `96b8d893`（janitor watchdog 原始小改动决策）
- journey_features `c7506c67`（audiomxd 蓝牙路由死循环兜底哨兵，挂在"工厂·F4故障自愈"下）
- zenithjoy-skills PR #168（原始功能）+ #169（本次 bug 修复）

## 关键决策引用
- `53bea3c4` — bash 未加花括号变量紧贴多字节字符的解析陷阱
- `96b8d893` — janitor watchdog 小改动

## 产物指针
- https://github.com/perfectuser21/zenithjoy-skills/pull/169
- sprint_dir: N/A
- branch: cp-0728195546-janitor-audiomxd-braces-fix（已合并，worktree 已清理）
