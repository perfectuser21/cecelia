# Bug PrepPRD：Brain派发死循环三源根治（Issue cc28d1af）

## 症状
research类任务无限"派发→秒失败→回队→再派"霸占每个tick；ci_patrol日报断供3天；每次合并PR自动部署后派发永久瘫痪需人工drain-cancel。

## 根因（0730排障实锤，四条边闭环）
1. cecelia-run.sh 经 ~/bin/cecelia-run 软链调用时 BASH_SOURCE 未解析→launcher路径=//scripts/claude-launch.sh→exit 127秒挂（#4327引入）
2. dispatcher autoblock 只数spawn失败且派发成功清零计数；callback侧classify成transient→handleTaskFailure skipCount=true requeue不计数
3. quarantine带release_at TTL被tick自动释放→回queued再循环
4. brain-deploy.sh drain 120s超时继续部署但从不drain-cancel；drain持久化working_memory新容器恢复→永久瘫痪

## 修法
- A cecelia-run.sh：解析软链推导repo根（dry-run与main两处launcher推导），根治exit 127
- B brain-deploy.sh：swap成功后无条件best-effort POST /tick/drain-cancel（新实例不继承pre-swap drain）
- C1 callback-processor/quarantine skipCount路径：payload.transient_requeue_count递增，≥5转quarantine（不再无限白嫖requeue）
- C2 quarantine auto-release：payload.quarantine_release_count递增，≥2不再自动释放（保持quarantined等人工）

## Regression Test 计划
- A：bash测试经软链调用dry-run断言launcher路径真实存在（现状必红）
- B：brain-deploy.sh dry-run输出含drain-cancel步骤断言（现状必红）
- C1/C2：vitest真Postgres路径断言计数递增与上限行为（现状必红）

## 验收标准
- [ ] failing test先commit(Red)，修复代码commit(Green)
- [ ] 真机验证：软链调用dry-run输出可执行路径；模拟循环任务5次transient后quarantined且不再自动释放
- [ ] CI全绿
