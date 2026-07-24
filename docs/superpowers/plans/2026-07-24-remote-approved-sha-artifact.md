# Remote approved-SHA artifact implementation plan

1. Add a regression test with a bare remote and a consumer clone that has not
   fetched the approved commit.
2. Prove the test fails because the consumer cannot resolve the SHA locally.
3. Add exact-SHA fetch-and-retry to `readGitArtifact`.
4. Run the focused orchestrator tests and version gates.
5. Bump Brain to 1.267.70, publish a hotfix PR, deploy, and rerun the fire drill.
