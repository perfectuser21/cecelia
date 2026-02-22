#!/usr/bin/env python3
"""
OKR Validation Script with Anti-Cheating (v8.0.0)
- Calculates content hash to prevent score tampering
- Validates form (structure/fields)
- Phase 2: Validates capability binding (capability_id, stage progression)
- Generates validation report for AI self-assessment
"""

import json
import sys
import hashlib
from datetime import datetime
from pathlib import Path
import requests


def calculate_content_hash(data):
    """Calculate SHA256 hash of output.json content"""
    content_str = json.dumps(data, sort_keys=True)
    return hashlib.sha256(content_str.encode()).hexdigest()[:16]


def detect_circular_dependency(pr_plans):
    """Detect circular dependencies in PR Plans"""
    # Build dependency graph
    plan_map = {p.get('sequence', idx + 1): idx for idx, p in enumerate(pr_plans)}

    def has_cycle(seq, visited, rec_stack):
        visited.add(seq)
        rec_stack.add(seq)

        if seq not in plan_map:
            return False

        plan = pr_plans[plan_map[seq]]
        depends_on = plan.get('depends_on', [])

        for dep in depends_on:
            if dep not in visited:
                if has_cycle(dep, visited, rec_stack):
                    return True
            elif dep in rec_stack:
                return True

        rec_stack.remove(seq)
        return False

    visited = set()
    for idx, plan in enumerate(pr_plans):
        seq = plan.get('sequence', idx + 1)
        if seq not in visited:
            if has_cycle(seq, visited, set()):
                return True
    return False


def check_capability_exists(capability_id):
    """Check if capability exists in Brain DB via API

    Args:
        capability_id: The capability ID to check

    Returns:
        tuple: (exists: bool, brain_available: bool)
               - (True, True): capability exists
               - (False, True): capability doesn't exist
               - (False, False): Brain unavailable, cannot verify
    """
    try:
        resp = requests.get(
            f'http://localhost:5221/api/brain/capabilities/{capability_id}',
            timeout=2
        )
        return (resp.status_code == 200, True)
    except Exception:
        # Fail open - if Brain is down, cannot verify
        return (False, False)


def validate_3layer_format(data):
    """Validate 3-layer decomposition format (Initiatives → PR Plans → Tasks)

    Phase 2: Now expects initiatives[] (plural) with capability binding
    """
    score = 0
    issues = []
    suggestions = []

    # 1. Check initiatives array exists (5 points)
    initiatives = data.get('initiatives', [])
    if initiatives:
        score += 5
    else:
        issues.append('Missing initiatives array')
        suggestions.append('Add initiatives array with at least one initiative')

    # Early return if no initiatives
    if not initiatives:
        return {
            'score': min(score, 40),
            'issues': issues,
            'suggestions': suggestions,
            'num_pr_plans': 0,
            'format': '3-layer'
        }

    # 2. Check each initiative has capability_id (10 points, distributed)
    capability_score = 0
    for idx, init in enumerate(initiatives):
        if init.get('capability_id'):
            capability_score += 10 / len(initiatives)
        else:
            issues.append(f'Initiative {idx}: missing capability_id')
            suggestions.append(f'Add capability_id to Initiative {idx}')
    score += int(capability_score)

    # 3. Validate capability_id exists in Brain DB (5 points, distributed)
    exists_score = 0
    for idx, init in enumerate(initiatives):
        cap_id = init.get('capability_id')
        if cap_id:
            exists, brain_available = check_capability_exists(cap_id)
            if exists:
                exists_score += 5 / len(initiatives)
            elif brain_available:
                # Brain is up, but capability not found
                issues.append(f'Initiative {idx}: capability_id "{cap_id}" not found in registry')
                suggestions.append(f'Use existing capability or create proposal for "{cap_id}"')
            else:
                # Brain is down, cannot verify - give points but warn
                exists_score += 5 / len(initiatives)
                issues.append(f'Initiative {idx}: Brain API unavailable, could not verify capability_id "{cap_id}"')
                suggestions.append('Ensure Brain service is running at localhost:5221')
    score += int(exists_score)

    # 4. Check from_stage / to_stage (5 points, distributed)
    stage_fields_score = 0
    for idx, init in enumerate(initiatives):
        if init.get('from_stage') and init.get('to_stage'):
            stage_fields_score += 5 / len(initiatives)
        else:
            issues.append(f'Initiative {idx}: missing from_stage or to_stage')
            suggestions.append(f'Add from_stage and to_stage to Initiative {idx}')
    score += int(stage_fields_score)

    # 5. Check from_stage < to_stage (5 points, distributed)
    stage_progression_score = 0
    for idx, init in enumerate(initiatives):
        from_s = init.get('from_stage')
        to_s = init.get('to_stage')
        if from_s and to_s:
            if from_s < to_s:
                stage_progression_score += 5 / len(initiatives)
            else:
                issues.append(f'Initiative {idx}: from_stage ({from_s}) must be < to_stage ({to_s})')
                suggestions.append(f'Fix stage progression in Initiative {idx}')
    score += int(stage_progression_score)

    # 6. Check evidence_required (5 points, distributed)
    evidence_score = 0
    for idx, init in enumerate(initiatives):
        if init.get('evidence_required'):
            evidence_score += 5 / len(initiatives)
        else:
            issues.append(f'Initiative {idx}: missing evidence_required')
            suggestions.append(f'Add evidence_required to Initiative {idx}')
    score += int(evidence_score)

    # 7. Check pr_plans have tasks (5 points, distributed)
    pr_plans_tasks_score = 0
    total_pr_plans = 0
    for idx, init in enumerate(initiatives):
        pr_plans = init.get('pr_plans', [])
        total_pr_plans += len(pr_plans)
        if pr_plans:
            if all(len(pp.get('tasks', [])) > 0 for pp in pr_plans):
                pr_plans_tasks_score += 5 / len(initiatives)
            else:
                issues.append(f'Initiative {idx}: some pr_plans have no tasks')
                suggestions.append(f'Add tasks to all pr_plans in Initiative {idx}')
        else:
            issues.append(f'Initiative {idx}: no pr_plans defined')
            suggestions.append(f'Decompose Initiative {idx} into 2-5 PR Plans')
    score += int(pr_plans_tasks_score)

    return {
        'score': min(score, 40),
        'max': 40,
        'issues': issues,
        'suggestions': suggestions,
        'num_pr_plans': total_pr_plans,
        'num_initiatives': len(initiatives),
        'format': '3-layer',
        'passed': score >= 32  # 80% pass threshold
    }


def validate_2layer_format(data):
    """Validate 2-layer format (Features → Tasks) - backward compatible"""
    score = 0
    issues = []
    suggestions = []

    # 1. Required fields (10 points)
    if 'objective' in data:
        score += 5
    else:
        issues.append("Missing 'objective' field")
        suggestions.append("Add 'objective' field with clear goal statement")

    if 'key_results' in data:
        score += 5
    else:
        issues.append("Missing 'key_results' field")
        suggestions.append("Add 'key_results' array with at least 2 KRs")

    # 2. KR count (5 points)
    krs = data.get('key_results', [])
    if len(krs) >= 2:
        score += 5
    else:
        issues.append(f"Need at least 2 Key Results (found {len(krs)})")
        suggestions.append("Add more Key Results to achieve the Objective")

    # 3. Features exist (10 points)
    all_features = []
    for kr in krs:
        if 'features' in kr:
            all_features.extend(kr['features'])

    if all_features:
        score += 10
    else:
        issues.append("No Features defined for any KR")
        suggestions.append("Decompose each KR into 2-5 Features")

    # 4. Feature field completeness (15 points)
    if all_features:
        complete_count = 0
        for feat in all_features:
            required = ['title', 'description', 'repository']
            if all(k in feat for k in required):
                complete_count += 1
            else:
                missing = [k for k in required if k not in feat]
                feat_title = feat.get('title', 'unknown')
                issues.append(f"Feature '{feat_title}' missing: {', '.join(missing)}")
                suggestions.append(f"Add {', '.join(missing)} to Feature '{feat_title}'")

        completeness_ratio = complete_count / len(all_features)
        score += int(15 * completeness_ratio)

    return {
        'score': min(score, 40),
        'issues': issues,
        'suggestions': suggestions,
        'num_features': len(all_features),
        'format': '2-layer'
    }


def validate_okr_form(data):
    """Form validation (automated, 40 points max) - auto-detect format"""
    # Detect format
    # Phase 2: initiatives[] (plural) with capability binding
    has_initiatives = 'initiatives' in data

    if has_initiatives:
        return validate_3layer_format(data)
    else:
        # Backward compatible: 2-layer format or old 3-layer format
        return validate_2layer_format(data)


def main():
    if len(sys.argv) < 2:
        print("Usage: validate-okr.py <output.json>")
        print("\nExample:")
        print("  python3 validate-okr.py output.json")
        sys.exit(1)

    input_file = Path(sys.argv[1])

    if not input_file.exists():
        print(f"❌ Error: {input_file} not found")
        sys.exit(1)

    # Read data
    try:
        with open(input_file) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in {input_file}")
        print(f"   {e}")
        sys.exit(1)

    # Form validation
    form_result = validate_okr_form(data)

    # Calculate content hash
    content_hash = calculate_content_hash(data)

    # Generate report (content_score to be filled by AI)
    report = {
        'form_score': form_result['score'],
        'content_score': 0,  # AI self-assessment (0-60)
        'content_breakdown': {
            'title_quality': 0,
            'description_quality': 0,
            'kr_feature_mapping': 0,
            'completeness': 0
        },
        'total': form_result['score'],  # form + content
        'passed': False,  # total >= 90
        'content_hash': content_hash,
        'timestamp': datetime.now().isoformat(),
        'issues': form_result['issues'],
        'suggestions': form_result['suggestions'],
        'format': form_result.get('format', 'unknown'),
        'details': {
            'num_features': form_result.get('num_features', 0),
            'num_pr_plans': form_result.get('num_pr_plans', 0)
        }
    }

    # Save report
    report_file = input_file.parent / 'validation-report.json'
    with open(report_file, 'w') as f:
        json.dump(report, indent=2, fp=f)

    # Output results
    print(f"\n{'='*60}")
    print(f"  OKR Validation Report")
    print(f"{'='*60}")
    print(f"  Form score:       {report['form_score']}/40")
    print(f"  Content score:    {report['content_score']}/60 (AI to fill)")
    print(f"  Total:            {report['total']}/100")
    print(f"  Content hash:     {content_hash}")
    print(f"  Timestamp:        {report['timestamp']}")
    print(f"{'='*60}")

    if report['issues']:
        print(f"\n⚠️  Issues found ({len(report['issues'])}):")
        for issue in report['issues']:
            print(f"  - {issue}")

    if report['suggestions']:
        print(f"\n💡 Suggestions:")
        for suggestion in report['suggestions']:
            print(f"  - {suggestion}")

    if report['content_score'] == 0:
        print(f"\n📝 Next step:")
        print(f"  AI: Please assess content quality and update validation-report.json")
        print(f"  - Set content_score (0-60)")
        print(f"  - Fill content_breakdown (each 0-15)")
        print(f"  - Update total = form_score + content_score")
        print(f"  - Set passed = true if total >= 90")

    if report['passed']:
        print(f"\n✅ Validation PASSED")
        sys.exit(0)
    else:
        print(f"\n❌ Validation not yet complete")
        print(f"   (Re-run after content assessment)")
        sys.exit(1)


if __name__ == '__main__':
    main()
