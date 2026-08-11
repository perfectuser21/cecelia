# Red Evidence — 通道 1 归属判据尚未实现（当前 should-auto-merge.sh 仍按 PR 标题判定）

## bash oracle: decision-check.sh（against current title-based script）
FAIL owned 期望 SKIP: MERGE
PASS not_owned→MERGE: MERGE
PASS 非cp-*→SKIP: SKIP: 非 cp-* 分支（feature/manual-branch），不走通用 auto-merge

## bash oracle: failclosed-check.sh（against current title-based script）
FAIL fail-closed[5xx] 期望 SKIP，实际: MERGE
FAIL fail-closed[badjson] 期望 SKIP，实际: MERGE
FAIL fail-closed[timeout] 期望 SKIP，实际: MERGE

## 解读：owned→期望 SKIP 实得 MERGE、5xx/badjson/timeout→期望 SKIP 实得 MERGE，
## 证明脚本未做 Brain 归属求证与 fail-closed（红）。not_owned→MERGE / 非cp-*→SKIP 为守卫，绿属预期。
