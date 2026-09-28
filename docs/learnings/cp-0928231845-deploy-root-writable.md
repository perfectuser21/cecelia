## 部署根只读子挂载让部署静默卡死（2026-09-28）

### 根本原因
- brain 容器把部署根 `/root/cecelia` 可写挂载，又在同路径把 `packages/workflows` 叠成只读（本意是防大脑误改技能 SSOT）。
- 部署根守卫在容器内对部署根做 `git checkout -f` + `reset --hard`；只要提交改到 `packages/workflows/`，git 就无法替换只读文件，守卫拒绝部署。
- 这个目录很少改（上次 08-06），所以潜伏了一个多月；09-27 改词表正本后 Gate3 连续失败，Deploy 状态接口写着 failed 但没有告警。

### 下次预防
- [ ] 部署根内的任何路径都不做只读子挂载；要保护的内容用代码层面的写权限控制，不靠挂载。
- [ ] Gate3 连续失败应告警（另立任务），不能只停在 CI 红点。
- [ ] 手修法：宿主机 `git checkout -f main && git reset --hard origin/main` 后重跑 Gate3。
