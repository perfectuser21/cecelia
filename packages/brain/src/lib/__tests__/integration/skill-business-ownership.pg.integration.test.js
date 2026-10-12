import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { privateFixtureDatabase } from "../../../__tests__/fixtures/private-fixture-db.js";
import { readSkillBusinessOwnership } from "../../skill-business-ownership.js";
it("真PG只读快照继承planned节点固定共享绑定，引用撤销和版本错配不污染归属", async () => {
  const f = await privateFixtureDatabase("skillownership", async (db) => {
    await db.query(`CREATE TABLE areas(id uuid PRIMARY KEY,name text,parent_area_id uuid);
   CREATE TABLE value_streams(id uuid PRIMARY KEY,name text,parent_journey_id uuid,area_id uuid,capability_code text,status text);
   CREATE TABLE capabilities(LIKE value_streams INCLUDING ALL);
   CREATE TABLE workflows(id uuid PRIMARY KEY,name text,capability_id uuid,status text,current_definition_version_id uuid);
   CREATE TABLE activities(id uuid PRIMARY KEY,status text,current_definition_version_id uuid);
   CREATE TABLE workflow_activity_refs(id uuid PRIMARY KEY,workflow_id uuid,activity_id uuid,active boolean,sequence_no int,activity_definition_version_id uuid,source_ref text,source_repo text,source_path text,source_commit text);
   CREATE TABLE workflow_definition_versions(id uuid PRIMARY KEY,workflow_id uuid,payload jsonb,source_repo text,source_path text,source_commit text);
   CREATE TABLE activity_definition_versions(id uuid PRIMARY KEY,activity_id uuid,payload jsonb,source_repo text,source_path text,source_commit text);`);
  });
  try {
    const [area, vs, cap, a, av, skill] = Array.from({ length: 6 }, () =>
        randomUUID(),
      ),
      repo = "perfectuser21/zenithjoy-workspace",
      revision = "a".repeat(40),
      digest = "b".repeat(64),
      path = ".agents/skills/multi-platform-publish/SKILL.md";
    await f.db.query("INSERT INTO areas VALUES($1,$2,NULL)", [
      area,
      "新媒体部",
    ]);
    await f.db.query(
      "INSERT INTO value_streams VALUES($1,'内容生产',NULL,$2,NULL,'active')",
      [vs, area],
    );
    await f.db.query(
      "INSERT INTO capabilities VALUES($1,'发布',$2,NULL,'publish','planned')",
      [cap, vs],
    );
    await f.db.query("INSERT INTO activities VALUES($1,'planned',$2)", [a, av]);
    const binding = {
      kind: "skill",
      status: "verified",
      validation_scope: "reference_only",
      repo,
      path,
      revision,
      digest: `sha256:${digest}`,
    };
    await f.db.query(
      "INSERT INTO activity_definition_versions VALUES($1,$2,$3,$4,$5,$6)",
      [
        av,
        a,
        { activity_id: a, implementation_bindings: [binding] },
        repo,
        "activities/preflight.yaml",
        revision,
      ],
    );
    const refs = [];
    for (let i = 0; i < 2; i++) {
      const [w, wv, r] = Array.from({ length: 3 }, () => randomUUID());
      refs.push(r);
      await f.db.query("INSERT INTO workflows VALUES($1,$2,$3,'active',$4)", [
        w,
        `发布${i}`,
        cap,
        wv,
      ]);
      await f.db.query(
        "INSERT INTO workflow_activity_refs VALUES($1,$2,$3,true,1,$4,NULL,$5,$6,$7)",
        [r, w, a, av, repo, "contracts/publish.yaml", revision],
      );
      await f.db.query(
        "INSERT INTO workflow_definition_versions VALUES($1,$2,$3,$4,$5,$6)",
        [
          wv,
          w,
          {
            workflow_id: w,
            capability_id: cap,
            activities: [
              { reference_id: r, activity_id: a, activity_version_id: av },
            ],
          },
          repo,
          "contracts/publish.yaml",
          revision,
        ],
      );
    }
    const registry = [
      {
        id: skill,
        content_digest: digest,
        metadata: { source_identity: { repo, path, revision, digest } },
      },
    ];
    await f.db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let out = await readSkillBusinessOwnership(f.db, registry);
    expect(out.get(skill).status).toBe("shared");
    expect(out.get(skill).areas).toEqual([{ id: area, name: "新媒体部" }]);
    expect(out.get(skill).paths).toHaveLength(2);
    await f.db.query("ROLLBACK");
    await f.db.query(
      "UPDATE workflow_activity_refs SET active=false WHERE id=$1",
      [refs[0]],
    );
    out = await readSkillBusinessOwnership(f.db, registry);
    expect(out.get(skill).status).toBe("mapped");
    expect(out.get(skill).paths).toHaveLength(1);
    await f.db.query(
      "UPDATE activities SET current_definition_version_id=$1 WHERE id=$2",
      [randomUUID(), a],
    );
    out = await readSkillBusinessOwnership(f.db, registry);
    expect(out.get(skill).status).toBe("mapped");
    await f.db.query("UPDATE workflow_activity_refs SET activity_definition_version_id=$1 WHERE id=$2", [randomUUID(), refs[1]]);
    out = await readSkillBusinessOwnership(f.db, registry);
    expect(out.get(skill).status).toBe("unknown");
    expect(out.get(skill).paths).toEqual([]);
  } finally {
    await f.close();
  }
}, 20000);
