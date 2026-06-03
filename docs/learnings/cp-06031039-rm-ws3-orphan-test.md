# Learning：删页面漏删配套测试 → 远程孤儿测试拖红 main

分支: cp-06031039-rm-ws3-orphan-test
日期: 2026-06-03

## 现象

所有拉取最新 main 的 brain PR 的 brain-unit 全红，挂在
`sprints/tests/ws3/harness-stream-page.test.ts`（断言 `HarnessStreamPage.tsx` 文件存在 + 内容）。
该页面其实已被 #3258 删除，测试却还在跑 → 全员被这条孤儿测试卡住合并。

## 根本原因

#3258（War Room PR-C「删历史死页 + 合并 sprint 详情」）退役了
`apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`，但**只删了页面，没删它配套的测试**
`sprints/tests/ws3/harness-stream-page.test.ts`（#2986 引入的 WS3 TDD 测试，用 existsSync/readFileSync
直接对页面文件做断言）。该测试不是 co-located 在页面旁（在 sprints/tests/ws3/ 远程目录），
删页面时一眼扫不到 → 漏删。结果一条"测一个已不存在的文件存在"的死测试常驻 CI，把 main 拖红。

这类**跨目录引用已删文件的测试**最危险：删功能时本地 co-located 测试会一起删，但
sprints/tests/、e2e/ 等"远程"测试目录里对该文件的硬引用容易漏，且它们直到下一个 PR 拉新 main
才暴露（删除 PR 自己的 CI 可能因 base 较旧而没跑到/没红）。

## 下次预防

- 删除任何被测的源文件前，全仓 `git grep <文件名/组件名>` 一遍，把所有引用它的测试（含
  sprints/tests/、e2e/、apps/api 的 *.test）一并清理，不能只删 co-located 的那份。
- 退役页面/路由要成套删：页面文件 + 配套测试 + 路由注册 + 导航入口，缺一会留下不一致的死引用。
- TDD red-phase 测试（断言"某文件应存在"）一旦其目标被退役，必须同步删除，否则它从"红→应转绿"
  退化成"永远红"的孤儿，把整条 CI 拖死。

### checklist

- [ ] 删源文件前 `git grep` 全仓引用，连远程测试目录一起清
- [ ] 退役页面/路由成套删（页面+测试+路由+导航）
- [ ] 目标被退役的 red-phase 测试同步删除，别留永久红孤儿
