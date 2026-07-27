-- Migration 365: executor_kind 增加 'kernel-process'
--
-- 背景：Kernel v1 的执行体是 Brain 容器内的裸 Node 进程（launchKernelProcess），
-- 不是 cecelia-relay-* 容器。此前这类任务被打成 relay-container，探活走 docker ps
-- 恒返回 dead（事故 51836fb2 / run 13d41c64：controller 心跳比判死时刻晚 4 分 16 秒）。
--
-- 329 建列时的 CHECK 只列了五类，必须放宽才能落 kernel-process。
-- 存量行不动：判活侧 resolveLivenessKind() 已按 payload.harness_runtime 纠正，
-- 这里只让新派发能把正确的值写进库。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_executor_kind_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_executor_kind_check
    CHECK (executor_kind IS NULL OR executor_kind IN (
      'brain-local',
      'relay-container',
      'kernel-process',
      'headed-session',
      'bridge',
      'external-worker'
    ));

INSERT INTO schema_version (version, description)
VALUES ('365', 'Allow kernel-process in tasks.executor_kind (Kernel v1 bare node process)')
ON CONFLICT (version) DO NOTHING;
