# cecelia-playground

W19 Walking Skeleton 测试床。本子项目刻意保持极薄，给 Cecelia harness pipeline 提供一个"外部代码改动对象"——后续 W19+ task 由 generator container push PR 给这里加 endpoint，evaluator container 自起 server 真验证。

## 跟 cecelia core 的关系

完全独立子项目。Brain / Engine / Workspace **不依赖** playground。playground 也不感知 brain。这是刻意的解耦：harness 测协议层时不能让"亲爹打亲爹"环路（详见 `docs/handoffs/2026-05-10-w19-walking-skeleton-playground-handoff-prd.md` §10）。

## 启动

```bash
cd playground
npm install
npm test            # 单测
npm start           # 起 server（默认 :3000）
```

## 端点

- `GET /health` → `{ "ok": true }`

W19 task 会增加 `GET /sum?a=N&b=M`（不在 bootstrap 范围）。
