import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const BUNDLE_FILES=Object.freeze(['scripts/native-agent/bundle.mjs','scripts/native-agent/config.mjs','scripts/native-agent/store.mjs','scripts/native-agent/process.mjs','scripts/native-agent/worker.mjs','scripts/native-agent/cli.mjs','scripts/coding-workflow/lib/codex-auth.mjs','src/orchestrator/activity-supervisor-state.cjs']);
export const sha256=x=>createHash('sha256').update(x).digest('hex');
export function computeBundleDigest(brainRoot){
 const root=fs.realpathSync(brainRoot);
 return sha256(JSON.stringify(BUNDLE_FILES.map(file=>{const full=path.join(root,file),s=fs.lstatSync(full);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(full)!==full)throw Error('native_agent_bundle_source_invalid');return [file,sha256(fs.readFileSync(full))];})));
}
