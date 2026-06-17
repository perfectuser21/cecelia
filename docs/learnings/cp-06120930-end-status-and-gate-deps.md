# Learning — harness 子图 END 终态补全 + ARTIFACT 门依赖/环境 fail-open

**分支**: cp-06120930-end-status-and-gate-deps
**日期**: 2026-06-12
**关联 run**: cf4f596c（问题1）/ 56b5cc39（问题2）

## 教训一：图的每条 END 边都是 API，必须写明确终态

### 根本原因

LangGraph 子图的 `status` channel 有默认值 `'queued'`。子图任意一条通向 END 的边，如果在 END 前
不显式写 `status`，终局 checkpoint 的 `status` 就停在 `'queued'`。父 `runSubTaskNode` 用
`compiled.getState()` 读子图终态时拿到 `'queued'`，被 Serial gate 误读为"没合并/还在飞"。

#3361 只补了 `contract_invalid` 那一条 END 的状态上浮，但子图还有 **no_pr / timeout / poll-closed /
merge 失败** 四类 END 路径同样不写 status——它们靠 `error`/`ci_status` 字段表达失败，却忘了
`status` 才是父图读的那个 channel。run cf4f596c 的 `fix0:c29dcc609` 线程正是走到
`next=[], status=queued` 的 no_pr 终局。

把 END 当成"反正会停"的隐式出口，而不是"必须返回明确终态"的 API，是根因。

### 下次预防

- [ ] 新增/改动任何 LangGraph 子图节点时，列出该节点所有 return 分支，标注哪些经路由通向 END；
      每条通向 END 的 return 必须显式写终态 channel（这里是 `status`），不依赖 channel 默认值。
- [ ] 建立 invariant 并测试：凡 set `state.error` 的节点同时 set 终态 status；非 error 终局路径
      显式写 status。用图级 `invoke` 集成测试断言终局 `status !== <channel 默认值>`。
- [ ] Review 子图时优先审 END 边而非节点内部逻辑——END 边是父图消费的契约面。

## 教训二：门的环境失败不能算被测者的失败

### 根本原因

ARTIFACT 门把 PR 分支 checkout 到 /tmp 临时 git worktree 跑 DoD `[ARTIFACT]` 命令。git worktree
不带 node_modules（每个 worktree 需各自 install），命令 `node -e "import('./src/harness-shared.js')"`
解析不到 `zod` → `Cannot find package 'zod'` → 门记为失败 → verdict=FAIL → 打回 generator。

但 generator 改不了"门自己的临时目录没装依赖"这件事——这是门的环境穷，不是实现没做。门的本职是
抓"实现没做"（真断言失败），把环境/依赖类错误也当被测者的失败，就会无限打回一个无辜的 generator。

### 下次预防

- [ ] 任何在隔离/临时目录跑被测命令的门，必须显式准备运行时环境（注入 `NODE_PATH` 指向宿主依赖，
      或 symlink node_modules），不能假设临时 checkout 自带依赖。
- [ ] 门对失败要分型：依赖/环境类错误（Cannot find package / MODULE_NOT_FOUND）fail-open 记
      warning 跳过；只有真断言失败才 FAIL。门的容错语义统一向 fail-open 靠（与既有 git fetch /
      合同读取 fail-open 一致）。
- [ ] 写门时先问："这条失败到底在指控谁？"——指控被测者才 FAIL，指控门自己的环境就跳过。
