# Learning: fix(executor): syncOrphanTasksOnStartup 孤儿改 requeue

**分支**: cp-03171225-f9e611c5-4c05-40cf-b551-04f036  
**日期**: 2026-03-17

## 根本原因

`syncOrphanTasksOnStartup` 将所有 in_progress 孤儿任务无条件标记为 `failed`，没有区分：
- **Brain 重启中断**的任务（进程被 kill，但任务本身没问题，应重新排队）
- **真实失败**的任务（已经超过重试限制或有已知错误信息）

## 修复方案

在孤儿检测路径中加入条件判断：

```js
const canRetry = watchdogRetryCount < QUARANTINE_AFTER_KILLS && !hasExistingError;
if (canRetry) {
  // requeue → status='queued', watchdog_retry_count++
} else {
  // 保持原 failed 逻辑
}
```

## 下次预防

- [ ] 任何"无条件 fail"的逻辑都应加 retry/error 判断
- [ ] `QUARANTINE_AFTER_KILLS` 是函数内常量，需要跨函数引用时在局部声明同名值，注释说明来源
- [ ] Brain 重启影响面的测试用例需覆盖三路径：可重试 / 超限 / 已有错误
