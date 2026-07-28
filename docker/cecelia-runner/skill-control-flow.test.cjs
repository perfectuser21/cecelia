const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const REPO = resolve(__dirname, '../..');

function skill(name) {
  return readFileSync(
    resolve(REPO, `packages/workflows/skills/${name}/SKILL.md`),
    'utf8',
  );
}

test('planner captures the checked-out branch before building its raw result', () => {
  const source = skill('harness-planner');
  const checkout = source.indexOf('git checkout -b "cp-');
  const branchCapture = source.indexOf('BRANCH=$(git branch --show-current)', checkout);
  const plannerCapture = source.indexOf('PLANNER_BRANCH="$BRANCH"', checkout);
  const writer = source.indexOf('# planner-result-writer:start');

  assert.notEqual(checkout, -1);
  assert.ok(branchCapture > checkout, 'BRANCH must be captured after the real checkout');
  assert.ok(plannerCapture > branchCapture, 'PLANNER_BRANCH must use the captured branch');
  assert.ok(writer > plannerCapture, 'the writer must run after both branch variables are captured');
});

test('generator marks MAX_FIXES exhaustion as FAILED before leaving the CI loop', () => {
  const source = skill('harness-generator');
  const exhausted = source.indexOf('if [ "$FIX_COUNT" -ge "$MAX_FIXES" ]; then');
  const branchEnd = source.indexOf('\n    fi', exhausted);
  const body = source.slice(exhausted, branchEnd);

  assert.notEqual(exhausted, -1);
  assert.match(body, /GENERATOR_VERDICT=FAILED/);
  assert.match(body, /FAILURE_REASON=/);
  const breakStatement = body.indexOf('\n      break');
  assert.ok(
    body.indexOf('GENERATOR_VERDICT=FAILED') < breakStatement,
    'FAILED must be set before break',
  );
  assert.ok(
    body.indexOf('FAILURE_REASON=') < breakStatement,
    'failure reason must be set before break',
  );
});

test('report recomputes concerns and rewrites the result after Phase B verification', () => {
  const source = skill('harness-report');
  const phaseB = source.indexOf('### Phase B 核验');
  const afterPhaseB = source.slice(phaseB);
  const recompute = afterPhaseB.indexOf('CONCERNS=""');
  const concernRead = afterPhaseB.indexOf('.report-concerns', recompute);
  const verdict = afterPhaseB.indexOf('VERDICT="DONE_WITH_CONCERNS"', concernRead);
  const rewrite = afterPhaseB.indexOf('write_report_result', verdict);

  assert.notEqual(phaseB, -1);
  assert.notEqual(recompute, -1, 'Phase B must recompute concerns from current evidence');
  assert.ok(concernRead > recompute, 'Phase B must include its latest concern file');
  assert.ok(verdict > concernRead, 'Phase B must recompute the final verdict');
  assert.ok(rewrite > verdict, 'Phase B must rewrite the raw result after recomputation');
});
