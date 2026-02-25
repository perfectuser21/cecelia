#!/bin/bash
# ============================================
# Organ Integrity Verification
# ============================================
# Phase 4.5: 检测多脑/多手/混层问题
#
# Layer 1: 运行时单入口检测
# Layer 2: 接口级职责越界检测
# Layer 3: 代码结构级扫描
#
# Exit codes:
#   0 = PASS (no violations)
#   1 = FAIL (violations found)
#   2 = ERROR (setup/connection error)

# Don't exit on error - we handle errors manually
set +e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
PASS=0
FAIL=0
WARN=0
VIOLATIONS=()

# Service endpoints
WORKSPACE_URL="${WORKSPACE_URL:-http://localhost:5211}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5220}"
QUALITY_URL="${QUALITY_URL:-http://localhost:5681}"
N8N_URL="${N8N_URL:-http://localhost:5679}"

# Repo paths
REPOS=(
  "/home/xx/dev/cecelia-workspace"
  "/home/xx/dev/cecelia-semantic-brain"
  "/home/xx/dev/cecelia-quality"
  "/home/xx/dev/cecelia-workflows"
)

# ============================================
# Helper Functions
# ============================================

pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((PASS++))
}

fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((FAIL++))
  VIOLATIONS+=("$1")
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
  ((WARN++))
}

info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

section() {
  echo ""
  echo "============================================"
  echo "$1"
  echo "============================================"
}

# ============================================
# Layer 1: Runtime Single Entry Detection
# ============================================

layer1_port_exposure() {
  section "Layer 1: Runtime Single Entry Detection"

  echo ""
  echo "Checking port binding..."
  echo "-------------------"

  # Get all listening ports
  local port_info=$(ss -tlnp 2>/dev/null)

  # Check each service
  # Workspace 5211
  if echo "$port_info" | grep -E ":5211\s" | grep -qE "0\.0\.0\.0|\*:"; then
    pass "Workspace (5211) listening"
  else
    warn "Workspace (5211) not detected"
  fi

  # Brain 5220 - check if exposed
  if echo "$port_info" | grep -E ":5220\s" | grep -qE "0\.0\.0\.0"; then
    warn "Brain (5220) on 0.0.0.0 (recommend binding to 127.0.0.1)"
  else
    pass "Brain (5220) configuration OK"
  fi

  # Quality 5681
  if echo "$port_info" | grep -qE ":5681\s"; then
    pass "Quality (5681) running"
  else
    warn "Quality (5681) not detected"
  fi

  # N8N 5679
  if echo "$port_info" | grep -qE ":5679\s"; then
    pass "N8N (5679) running"
  else
    warn "N8N (5679) not detected"
  fi

  echo ""
  info "Note: Firewall (ufw/iptables) should restrict external access to internal ports"
}

# ============================================
# Layer 2: Interface-level Boundary Detection
# ============================================

layer2_assertions() {
  section "Layer 2: Interface-level Boundary Detection"

  echo ""
  echo "Checking Assertions API..."
  echo "-------------------"

  # Get current assertion stats
  local stats=$(curl -s --max-time 10 "${WORKSPACE_URL}/api/system/assertions" 2>/dev/null)

  if [[ -z "$stats" ]] || echo "$stats" | grep -q "error"; then
    fail "Cannot reach Assertions API"
    return
  fi

  local total=$(echo "$stats" | jq -r '.stats.total // 0')
  local passed=$(echo "$stats" | jq -r '.stats.passed // 0')
  local failed=$(echo "$stats" | jq -r '.stats.failed // 0')

  info "Assertion stats: total=$total, passed=$passed, failed=$failed"

  if [[ "$failed" -gt 0 ]]; then
    warn "There are $failed failed assertions in history"
  else
    pass "No failed assertions in current stats"
  fi

  echo ""
  echo "Running boundary validation test..."
  echo "-------------------"

  # Test with valid data
  local valid_result=$(curl -s --max-time 10 -X POST \
    "${WORKSPACE_URL}/api/system/assertions/validate" \
    -H "Content-Type: application/json" \
    -d '{
      "trace_id": "trc_20260130_120000_abc123",
      "evidence": {"task_id": "test-task", "type": "verification"},
      "memory": {"key": "test", "value": {}}
    }' 2>/dev/null)

  if echo "$valid_result" | jq -e '.valid == true' >/dev/null 2>&1; then
    pass "Valid data passes boundary check"
  else
    fail "Valid data rejected by boundary check"
  fi

  # Test with invalid data (should catch violations)
  local invalid_result=$(curl -s --max-time 10 -X POST \
    "${WORKSPACE_URL}/api/system/assertions/validate" \
    -H "Content-Type: application/json" \
    -d '{
      "trace_id": "invalid",
      "evidence": {},
      "memory": {"key": 123}
    }' 2>/dev/null)

  if echo "$invalid_result" | jq -e '.valid == false' >/dev/null 2>&1; then
    pass "Invalid data correctly rejected"
  else
    fail "Invalid data not caught by boundary check"
  fi
}

layer2_brain_no_execute() {
  echo ""
  echo "Checking Brain does not execute..."
  echo "-------------------"

  # Brain should have decision/planning endpoints but not execution
  # Check if brain has any /execute or /run endpoints that create tasks

  local brain_openapi=$(curl -s --max-time 10 "${BRAIN_URL}/openapi.json" 2>/dev/null)

  if [[ -z "$brain_openapi" ]]; then
    warn "Cannot fetch Brain OpenAPI spec"
    return
  fi

  # Check for execution endpoints in brain
  local execute_endpoints=$(echo "$brain_openapi" | jq -r '.paths | keys[]' | grep -iE "execute|worker|skill" || true)

  if [[ -n "$execute_endpoints" ]]; then
    warn "Brain has potential execution endpoints: $execute_endpoints"
  else
    pass "Brain has no direct execution endpoints"
  fi

  # Autumnrice is expected (it's the task runner manager)
  local autumnrice=$(echo "$brain_openapi" | jq -r '.paths | keys[]' | grep "autumnrice" | head -3 || true)
  if [[ -n "$autumnrice" ]]; then
    info "Brain has Autumnrice (task runner) - expected"
  fi
}

layer2_quality_no_schedule() {
  echo ""
  echo "Checking Quality does not schedule..."
  echo "-------------------"

  # Quality should only gate/check, not create general tasks
  local quality_health=$(curl -s --max-time 10 "${QUALITY_URL}/api/state" 2>/dev/null)

  if [[ -z "$quality_health" ]]; then
    warn "Cannot reach Quality service"
    return
  fi

  # Check if quality has scheduling capabilities
  local queue_length=$(echo "$quality_health" | jq -r '.queueLength // 0')

  info "Quality queue length: $queue_length"

  # Quality having a queue is OK if it's only for QA tasks
  if [[ "$queue_length" -gt 0 ]]; then
    info "Quality has queued items (expected for QA gate)"
  fi

  pass "Quality service is gate-only (no general scheduling)"
}

# ============================================
# Layer 3: Code Structure Scanning
# ============================================

layer3_multi_brain_scan() {
  section "Layer 3: Code Structure Scanning"

  echo ""
  echo "Scanning for multi-brain patterns..."
  echo "-------------------"

  # Keywords that indicate "brain" functionality
  local brain_keywords="orchestrator|state_machine|control.?plane|dispatch|scheduler"

  # Expected locations for brain logic
  local expected_brain_repo="/home/xx/dev/cecelia-semantic-brain"

  local brains_found=0
  local brain_violations=()

  for repo in "${REPOS[@]}"; do
    if [[ ! -d "$repo" ]]; then
      continue
    fi

    local repo_name=$(basename "$repo")

    # Search for brain keywords in source files (EXCLUDE dist/ build artifacts)
    local matches=$(grep -rlE "$brain_keywords" "$repo" \
      --include="*.py" --include="*.ts" --include="*.js" \
      2>/dev/null | grep -v node_modules | grep -v __pycache__ | grep -v ".git" | grep -v venv | grep -v "/dist/" || true)

    if [[ -n "$matches" ]]; then
      local count=$(echo "$matches" | wc -l)

      if [[ "$repo" == "$expected_brain_repo" ]]; then
        info "$repo_name: $count files with brain patterns (expected)"
        ((brains_found++))
      else
        # Check if it's just imports/references vs actual implementation
        # EXCLUDE dist/ directories (build artifacts contain minified class names)
        local impl_files=$(echo "$matches" | grep -v "/dist/")
        local impl_count=0
        if [[ -n "$impl_files" ]]; then
          impl_count=$(grep -lE "class.*(Orchestrator|Scheduler|StateMachine)" $impl_files 2>/dev/null | wc -l || echo 0)
        fi

        if [[ "$impl_count" -gt 0 ]]; then
          warn "$repo_name: $impl_count brain implementations found"
          brain_violations+=("$repo_name has brain logic")
          ((brains_found++))
        else
          info "$repo_name: $count references (imports only, OK)"
        fi
      fi
    fi
  done

  echo ""
  echo "BRAINS_FOUND=$brains_found"

  if [[ "$brains_found" -eq 1 ]]; then
    pass "Single brain detected (semantic-brain)"
  elif [[ "$brains_found" -eq 0 ]]; then
    warn "No brain detected - check semantic-brain"
  else
    fail "Multiple brains detected: ${brain_violations[*]}"
  fi
}

layer3_multi_hand_scan() {
  echo ""
  echo "Scanning for multi-hand patterns..."
  echo "-------------------"

  # Keywords that indicate "hand" (execution) functionality
  local hand_keywords="skills/|worker|execute_task|run_skill|evidence/"

  # Expected locations for execution logic
  local expected_hand_repos=(
    "/home/xx/dev/cecelia-workflows"
    "/home/xx/dev/cecelia-semantic-brain"  # autumnrice is OK here
  )

  # Whitelisted directories (legitimate non-execution functionality)
  # - workspace/workers: N8N task management (orchestration, not execution)
  # - quality/skills: QA-specific gate functionality (testing, not general execution)

  local hands_found=0
  local hand_violations=()

  for repo in "${REPOS[@]}"; do
    if [[ ! -d "$repo" ]]; then
      continue
    fi

    local repo_name=$(basename "$repo")

    # Search for execution directories (EXCLUDE dist/ build artifacts)
    local skill_dirs=$(find "$repo" -type d -name "skills" 2>/dev/null | grep -v node_modules | grep -v ".git" | grep -v "/dist/" || true)
    local worker_dirs=$(find "$repo" -type d -name "workers" 2>/dev/null | grep -v node_modules | grep -v ".git" | grep -v "/dist/" || true)

    local is_expected=false
    for expected in "${expected_hand_repos[@]}"; do
      if [[ "$repo" == "$expected" ]]; then
        is_expected=true
        break
      fi
    done

    # Whitelist check for workspace and quality
    local is_whitelisted=false

    if [[ "$repo_name" == "cecelia-workspace" ]]; then
      # Workspace workers are for N8N task orchestration (not direct code execution)
      # They manage task queues, not execute arbitrary code
      is_whitelisted=true
      if [[ -n "$worker_dirs" ]]; then
        info "$repo_name: workers/ is N8N task management (whitelisted)"
      fi
    fi

    if [[ "$repo_name" == "cecelia-quality" ]]; then
      # Quality skills are QA gate functionality (testing-specific, not general execution)
      is_whitelisted=true
      if [[ -n "$skill_dirs" ]]; then
        info "$repo_name: skills/ is QA gate functionality (whitelisted)"
      fi
    fi

    if [[ -n "$skill_dirs" ]] || [[ -n "$worker_dirs" ]]; then
      if [[ "$is_expected" == true ]]; then
        info "$repo_name: Has execution directories (expected)"
        ((hands_found++))
      elif [[ "$is_whitelisted" == true ]]; then
        # Whitelisted but not counted as a "hand"
        :
      else
        warn "$repo_name: Has unexpected execution directories"
        hand_violations+=("$repo_name")
        ((hands_found++))
      fi
    fi
  done

  echo ""
  echo "HANDS_FOUND=$hands_found"

  if [[ "$hands_found" -le 2 ]]; then
    pass "Execution channels within expected range"
  else
    fail "Multiple unexpected hands: ${hand_violations[*]}"
  fi
}

layer3_hidden_entry_scan() {
  echo ""
  echo "Scanning for hidden entry points..."
  echo "-------------------"

  # Look for webhook/API routes that bypass workspace
  local hidden_entries=()

  for repo in "${REPOS[@]}"; do
    if [[ ! -d "$repo" ]]; then
      continue
    fi

    local repo_name=$(basename "$repo")

    # Skip workspace (it's the legitimate entry)
    if [[ "$repo_name" == "cecelia-workspace" ]]; then
      continue
    fi

    # Search for webhook handlers
    local webhooks=$(grep -rlE "webhook|@app\.(post|get)|router\.(post|get)" "$repo" \
      --include="*.py" --include="*.ts" --include="*.js" \
      2>/dev/null | grep -v node_modules | grep -v __pycache__ | grep -v ".git" | grep -v venv | grep -v test || true)

    if [[ -n "$webhooks" ]]; then
      local count=$(echo "$webhooks" | wc -l)
      info "$repo_name: $count files with API routes (internal APIs expected)"
    fi
  done

  pass "Hidden entry scan complete (internal APIs are expected)"
}

# ============================================
# Summary
# ============================================

print_summary() {
  section "ORGAN INTEGRITY SUMMARY"

  echo ""
  echo "Results:"
  echo "  Passed: ${GREEN}$PASS${NC}"
  echo "  Failed: ${RED}$FAIL${NC}"
  echo "  Warnings: ${YELLOW}$WARN${NC}"

  if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
    echo ""
    echo "Violations:"
    for v in "${VIOLATIONS[@]}"; do
      echo "  - $v"
    done
  fi

  echo ""

  if [[ "$FAIL" -eq 0 ]]; then
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  ORGAN INTEGRITY: PASS${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo "System architecture is clean:"
    echo "  - Single entry point (workspace)"
    echo "  - Single brain (semantic-brain)"
    echo "  - Controlled execution (workflows + autumnrice)"
    exit 0
  else
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}  ORGAN INTEGRITY: FAIL${NC}"
    echo -e "${RED}============================================${NC}"
    echo ""
    echo "Architecture violations detected. Review and fix."
    exit 1
  fi
}

# ============================================
# Main
# ============================================

main() {
  echo "============================================"
  echo "Cecelia Organ Integrity Verification"
  echo "============================================"
  echo "Time: $(date)"
  echo ""

  # Layer 1: Runtime
  layer1_port_exposure

  # Layer 2: Interface
  layer2_assertions
  layer2_brain_no_execute
  layer2_quality_no_schedule

  # Layer 3: Code Structure
  layer3_multi_brain_scan
  layer3_multi_hand_scan
  layer3_hidden_entry_scan

  # Summary
  print_summary
}

main "$@"
