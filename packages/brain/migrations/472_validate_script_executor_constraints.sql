-- Migration 472: 验证 471 里 NOT VALID 的两条约束
--
-- 471 把 tasks_executor_kind_check（加 script）与 tasks_task_type_check（加 script_run）用 NOT VALID
-- 登记（不扫存量行，避免在 ACCESS EXCLUSIVE 锁下扫高频写表）。本文件单独一个事务做 VALIDATE CONSTRAINT，
-- 持 SHARE UPDATE EXCLUSIVE 锁，不挡并发读写。
--
-- 存量行本来就只含旧值（新值 script / script_run 是纯增量放宽），VALIDATE 不应失败；
-- 若失败说明库里有既不在新白名单也不为 NULL 的历史值，需人工排查具体行后重跑。
-- 幂等：VALIDATE 对已验证的约束是空操作，CI 重放全部 migration 安全。

ALTER TABLE tasks VALIDATE CONSTRAINT tasks_executor_kind_check;
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_task_type_check;

INSERT INTO schema_version (version, description)
VALUES ('472', 'VALIDATE tasks_executor_kind_check + tasks_task_type_check（471 的 NOT VALID 收尾）')
ON CONFLICT (version) DO NOTHING;
