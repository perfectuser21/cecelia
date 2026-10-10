## Brain {VERSION} — coding harness：判定点写库改用 made_by=system（生产约束不允许 ai）

- #6200 合同对抗把判定点写进 Brain decisions 时用的是 made_by=ai，但生产约束 decisions_made_by_check（迁移 193）只允许 user/cecelia/system，判定点在生产必然写入 500、触发 judgments_write_failed。原测试的假 Brain 不校验这个约束，所以没发现。
- 金丝雀 4（PR #6232）的 QA 场景照这个真实调用方用了 ai，PR 顺手加迁移放开 ai，被独立裁判判为超范围（J-2）——问题出在调用方，不该改约束。
- 改为 made_by=system（机器写入）；测试假 Brain 按生产约束校验 made_by。
