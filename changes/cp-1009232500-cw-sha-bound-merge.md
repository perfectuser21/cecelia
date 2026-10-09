## Brain {VERSION} — coding harness 合并门绑定 head SHA + 真实 CI 时序回放测试

- 决策 a1fdbc51 第②步（对应旧 harness「merge 前 head == 锚定 SHA」硬检查）：QA 与独立裁判通过不再开 GitHub 自动合并，只「批准」验收记录推送后的 head（qa-<pr>.json approved.head）。新合并门 runner/lib/merge-gate.mjs 每轮最先跑：当前 head 就是批准的 head、且该 head 上规定的必需检查全部登记全绿 → `gh pr merge --squash --match-head-commit <head>`。批准后分支又出现提交：只碰 changes/、sprints/ 或只是从 main 合入 → 改绑新 head；动了其他文件 → 撤销批准（revoked 留痕），新 head 重新 QA + 裁判。
- 第③步：新增真实 CI 时序回放测试（fixtures/real-timing-6139.json，取自 PR #6139 的 GitHub check-runs 真实登记时刻），逐轮回放 runner，断言必需检查未全部登记全绿前不开 QA；已验证该测试在首跑旧逻辑下于 13:29:48 那一轮报红。
