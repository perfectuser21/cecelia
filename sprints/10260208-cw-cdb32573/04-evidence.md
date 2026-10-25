---
task_id: cdb32573-9ece-405a-823e-c6c327765564
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
node -e 'const fs=require("fs"),a=require("assert");const d=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/lib/source-provenance.mjs","utf8"),p=fs.readFileSync("packages/brain/scripts/coding-workflow/lib/record-provenance.mjs","utf8");for(const x of ["sourceFacts","judgeSourceFacts","verifiedHistoricalExecutions","registrationFor","validateStage","historical_execution","task、sprint、真实 worktree","固定的当前 HEAD"])a.ok(d.includes(x),x);const publicBody=s.split("export function sourceFacts(")[1].split("export function judgeSourceFacts(")[0];a.ok(publicBody.includes("provenanceProjection(proof)")&&!publicBody.includes("historical_execution"));a.ok(s.includes("const historical = verifiedHistoricalExecutions")&&s.includes("historical_execution: historical"));a.ok(/active\.stage !== .judge./.test(p)&&p.includes("registrationFor(c, record, c.head, all)"));console.log("I-1 README与固定源码断言通过")'
```

```output
I-1 README与固定源码断言通过
```

### E-2
对应: I-2
verdict: PASS

```command
node -e 'const fs=require("fs"),a=require("assert");const d=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),s=fs.readFileSync("packages/brain/scripts/coding-workflow/lib/record-provenance-history.mjs","utf8");for(const x of ["native_ids","原顺序","turn.failed","非零退出","重复命令","零字节","stdout_sha256","stdout_bytes","error_event_seen","execution_complete","不包含 `reasoning`","不宣称任意子进程 stdout/stderr"])a.ok(d.includes(x),x);for(const x of ["stage.native_ids.map","stdout_sha256: hash(native.stdout)","stdout_bytes: Buffer.byteLength(native.stdout)","error_event_seen: parsed.error","native_success_mismatch","session_incomplete","result_incomplete","event_unknown","current_native_failed"])a.ok(s.includes(x),x);a.ok(!/commands.push\(\{[^}]*reasoning/.test(s));console.log("I-2 原生账与失败关闭断言通过")'
```

```output
I-2 原生账与失败关闭断言通过
```

### E-3
对应: I-3
verdict: PASS

```command
node --input-type=module -e 'import fs from "node:fs";import assert from "node:assert/strict";import {historicalExecutionProjection} from "./packages/brain/scripts/coding-workflow/lib/record-provenance-history.mjs";const d=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["QA 不读 03/04 正文或保护根","内存反例","不重造发布前 index/worktree/untracked","不手工补投或追认旧失败","judge-only","draft 的 FAIL/CANNOT_VERIFY 不编译为 PASS"])assert.ok(d.includes(x),x);assert.throws(()=>historicalExecutionProjection({status:"unverified",head:"0".repeat(40)},[],[]),/history_proof_invalid/);assert.throws(()=>historicalExecutionProjection({status:"verified",head:"0".repeat(40)},[{record:{},stage:{},registration:{}},{}],[]),/history_stage_binding/);console.log("I-3 QA边界静态断言与内存反例通过")'
```

```output
I-3 QA边界静态断言与内存反例通过
```

### E-4
对应: I-4
verdict: PASS

```command
node -e 'const fs=require("fs"),a=require("assert"),cp=require("child_process");const base="8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d",p="packages/brain/scripts/coding-workflow/runner/README.md",m=".implementation-source-relations.json",g=(...x)=>cp.execFileSync("git",x);const old=g("show",base+":"+p),now=fs.readFileSync(p),head=g("show","HEAD:"+p);a.ok(now.equals(head),"worktree README differs from HEAD");a.ok(now.subarray(0,old.length).equals(old),"base prefix differs");a.ok(now.length>old.length,"no append");a.ok(now.subarray(old.length).toString().startsWith("\n## 历史执行证据与本轮 QA 的责任边界\n"),"section position");a.ok(g("show",base+":"+m).equals(g("show","HEAD:"+m)),"manifest differs");a.equal(g("ls-tree",base,p).toString().slice(0,6),g("ls-tree","HEAD",p).toString().slice(0,6));a.ok(/固定 initial base/.test(now.toString())&&/发布后 manifest 可含/.test(now.toString()));console.log("I-4 README基线前缀/末尾追加/模式及manifest零差异通过");console.log("base_bytes="+old.length+" head_bytes="+now.length+" mode=100644")'
```

```output
I-4 README基线前缀/末尾追加/模式及manifest零差异通过
base_bytes=17967 head_bytes=23226 mode=100644
```

### E-5
对应: I-4
verdict: PASS

```command
node -e 'const a=require("assert"),cp=require("child_process"),g=(...x)=>cp.execFileSync("git",x,{encoding:"utf8"}),base="8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d",head=g("rev-parse","HEAD").trim(),dag=g("rev-list","--parents",base+".."+head).trim(),raw=g("diff-tree","-r","--raw",base,head).trim(),changed=g("diff","--name-only",base,head).trim(),idx=g("diff","--cached","--raw").trim(),wt=g("diff","--raw").trim(),untracked=g("ls-files","--others","--exclude-standard").trim().split("\n");a.equal(dag,head+" "+base);a.ok(raw.endsWith("\tpackages/brain/scripts/coding-workflow/runner/README.md"));a.equal(changed,"packages/brain/scripts/coding-workflow/runner/README.md");a.equal(idx,"");a.equal(wt,"");a.ok(untracked.every(x=>x.startsWith("sprints/10260208-cw-cdb32573/")));console.log("DAG="+dag);console.log("RAW="+raw);console.log("INDEX=empty WORKTREE=empty");console.log("UNTRACKED="+untracked.join(","))'
```

```output
DAG=37d827df4efbceb4c308cb3bde58649697b934c8 8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d
RAW=:100644 100644 5f271505cff98f4d9943d4cc42c1b0a7a99e7365 66e0b30550907c3735833366a590f7630bd2def4 M	packages/brain/scripts/coding-workflow/runner/README.md
INDEX=empty WORKTREE=empty
UNTRACKED=sprints/10260208-cw-cdb32573/01-intent.md,sprints/10260208-cw-cdb32573/01-invariants.md,sprints/10260208-cw-cdb32573/02-response-r1.md,sprints/10260208-cw-cdb32573/02-review-r1.md,sprints/10260208-cw-cdb32573/02-review-r2.md,sprints/10260208-cw-cdb32573/02-review.md,sprints/10260208-cw-cdb32573/02-spec.md
```

