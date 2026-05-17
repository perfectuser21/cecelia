# Learning: Harness Pipeline 全链路详情页

## 根本原因

前一轮实现（commit 0cd187290）创建了 `harness.js` 但遗漏了将其注册到 `routes.js`，导致 `/api/brain/harness/pipeline-detail` 端点返回 404。

## 修复内容

在 `packages/brain/src/routes.js` 中补充：
```js
import harnessRouter from './routes/harness.js';
router.use('/harness', harnessRouter);
```

## 下次预防

- [ ] 新建 Router 文件后必须同步检查 `routes.js` 是否有注册，否则端点永远 404
- [ ] Brain API 新端点写完后立即用 `curl localhost:5221/api/brain/...` 冒烟测试
- [ ] worktree 被意外删除后，用 `git worktree add <path> <branch>` 恢复，之前的提交不丢失
