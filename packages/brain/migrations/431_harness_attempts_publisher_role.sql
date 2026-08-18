-- Migration 431: 把 publisher 补进 harness_attempts.role 约束。
--
-- Publisher 在设计上一直完整存在：dispatcher 的 publish:approved_ref 声明
-- role:'publisher'，它有自己的 objective（"Publish only the exact local candidate
-- authorized by the Judge and merge fence"），Generator 的 objective 明写
-- "Do not push or create a pull request; Publisher owns remote publication after
-- Judge PASS"，Judge 的 objective 也把 publisher_result 列为服务端后置项。
--
-- 但它的注册点有三处，此前漏了两处：
--   ① dispatcher 条目            —— 一直都有
--   ② fleet ROLE_WEIGHTS 容量权重 —— 缺失，已由 #4951 (1.273.83) 补上
--   ③ 本约束                      —— 缺失，即本 migration
--
-- 2026-08-18 run 40ed8a23 首次走到 publish 阶段（Judge 双 PASS → publish:approved_ref
-- allow），随即写 attempt 行时撞上本约束，run 直接终态：
--   kernel_process_fatal: new row for relation "harness_attempts"
-- 之所以到今天才暴露：在此之前从来没有 run 走到过 Judge PASS 之后。

ALTER TABLE harness_attempts
  DROP CONSTRAINT IF EXISTS harness_attempts_role_check;

ALTER TABLE harness_attempts
  ADD CONSTRAINT harness_attempts_role_check
  CHECK (role IN (
    'planner',
    'proposer',
    'reviewer',
    'generator',
    'evaluator',
    'judge',
    'reporter',
    'commander',
    'publisher'
  ));
