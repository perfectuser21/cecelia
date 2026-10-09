## Brain {VERSION} — coding harness：QA 通过后 CI 修复改了代码须撤销通过、重新 QA 与裁判

- 4ac5fa39 首跑发现：QA 与独立裁判通过后已开自动合并，此时 CI 修复再推代码改动会不经复验直接合并。现在 CI 修复推送后若 PR 已通过 QA 且改动不只是 changes/ 版本碎片 → 撤销通过（qa-<pr>.json revoked 留痕）、`gh pr merge --disable-auto` 关自动合并，新 head 在 CI 绿后重新过真人 QA 与独立裁判；只补版本碎片则保留通过。
