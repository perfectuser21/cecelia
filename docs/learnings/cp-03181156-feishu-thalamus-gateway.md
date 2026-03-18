# Learning: Feishu 消息统一经过丘脑路由

**Branch**: cp-03181156-feishu-thalamus-gateway
**Date**: 2026-03-18

## 变更摘要

将 Feishu 消息处理路径改造为先经过丘脑（thalamus.js）路由，再决定调 handleChat 还是派发任务。丘脑成为真正的 Gateway。

## 改动文件

- `packages/brain/src/thalamus.js`：添加 `handle_chat` 到 ACTION_WHITELIST；更新 USER_MESSAGE 路由规则默认行为（普通对话默认 handle_chat，不是 create_task）
- `packages/brain/src/routes.js`：在 Feishu 私聊/群聊@mention 处理路径，handleChat 调用前插入丘脑路由拦截
- `packages/brain/src/__tests__/thalamus.test.js`：更新 ACTION_WHITELIST 数量基线 45→46

## 根本原因

Feishu 消息处理在丘脑存在前就已实现，一直直接调 handleChat，形成了历史债务。PR #1062 给丘脑注入了 Skills 地图和任务队列感知之后，丘脑已经有能力做路由决策，应当统一 Gateway。

## 架构影响

```
旧路径：Feishu消息 → routes.js → handleChat（直接）
新路径：Feishu消息 → routes.js → thalamusProcessEvent(USER_MESSAGE) →
          dispatch_task → createTask + 确认回复
          handle_chat/其他 → handleChat（原有逻辑，兜底）
```

## 下次预防

- [ ] 新增 action 到 ACTION_WHITELIST 时，同步更新 `thalamus.test.js` 的数量基线测试
- [ ] DoD test 用 `indexOf` 匹配函数名时，注意 import 行也会被匹配；用 `await functionName` 精确匹配调用点
- [ ] USER_MESSAGE 路由 prompt 的"默认行为"描述要仔细审查——错误的默认（create_task）会导致普通对话被当作任务派发
- [ ] 丘脑 fallback 必须是 try/catch 包裹，保证 LLM 调用失败时不影响正常对话流程
