# CI/CD Pipeline Setup

## Overview

This document describes the CI/CD pipeline for the cecelia-workflows repository, ensuring automated validation, testing, and deployment of workflows.

## GitHub Actions Workflow

The CI/CD pipeline is implemented using GitHub Actions and should be placed in `.github/workflows/ci.yml`.

### Pipeline Stages

1. **Validate** - JSON syntax, registry structure, naming conventions
2. **Test** - Template validation, integration tests
3. **Security** - Secret scanning, permission checks
4. **Lint** - Code quality checks
5. **Version** - Version management verification
6. **Documentation** - Documentation completeness
7. **Deploy Staging** - Automatic deployment to staging (develop branch)
8. **Deploy Production** - Manual deployment to production (main branch)
9. **Notify** - Status notifications

### Workflow Configuration

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  workflow_dispatch:

env:
  NODE_VERSION: '20'
  PYTHON_VERSION: '3.11'

jobs:
  validate:
    name: Validate Workflows
    runs-on: ubuntu-latest
    # ... (full configuration in ci.yml template)

  test-templates:
    name: Test Workflow Templates
    runs-on: ubuntu-latest
    needs: validate
    # ...

  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    needs: validate
    # ...

  lint:
    name: Lint Code
    runs-on: ubuntu-latest
    needs: validate
    # ...

  version-check:
    name: Version Management
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    # ...

  documentation:
    name: Documentation Check
    runs-on: ubuntu-latest
    # ...

  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: [validate, test-templates, security-scan, lint]
    if: github.ref == 'refs/heads/develop' && github.event_name == 'push'
    # ...

  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: [validate, test-templates, security-scan, lint]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment:
      name: production
    # ...

  notify:
    name: Send Notifications
    runs-on: ubuntu-latest
    needs: [deploy-staging, deploy-production]
    if: always()
    # ...
```

## Validation Checks

### JSON Validation
- Validates all JSON files for syntax errors
- Checks workflow structure integrity
- Verifies registry consistency

### Naming Convention
- Workflows must follow: `{type}-{name}.json`
- Types: `flow`, `unit`, `template`
- Names: lowercase with hyphens

### Version Checking
- Ensures version bumps for modified workflows
- Validates semantic versioning
- Tracks version history

## Security Measures

### Secret Scanning
```bash
# Pattern detection for common secrets
grep -rE "(api[_-]?key|password|secret|token|bearer|private[_-]?key)"
```

### Permission Verification
- Scripts must be executable
- Sensitive files must have restricted permissions
- No hardcoded credentials

## Deployment Process

### Staging Deployment (Automatic)
1. Triggered on push to `develop`
2. Runs all validation tests
3. Deploys to staging N8N
4. Runs integration tests
5. Notifies team

### Production Deployment (Manual Approval)
1. Triggered on push to `main`
2. Requires manual approval
3. Creates backup
4. Deploys to production N8N
5. Verifies deployment
6. Notifies Brain

## Local Testing

### Pre-commit Hooks

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Validate JSON files
for file in $(git diff --cached --name-only | grep "\.json$"); do
    if ! python -m json.tool "$file" > /dev/null 2>&1; then
        echo "❌ Invalid JSON: $file"
        exit 1
    fi
done

# Check for secrets
if git diff --cached | grep -E "(api[_-]?key|password|secret|token)"; then
    echo "⚠️ Potential secret detected. Please review."
    exit 1
fi
```

### Local Validation Script

```bash
#!/bin/bash
# scripts/validate-local.sh

echo "Running local validation..."

# JSON validation
find . -name "*.json" -type f | while read -r file; do
    python -m json.tool "$file" > /dev/null || exit 1
done

# Registry check
python -c "
import json
with open('workflow-registry.json', 'r') as f:
    registry = json.load(f)
print(f'✅ Registry valid with {len(registry[\"workflows\"])} workflows')
"

# Shellcheck
for script in scripts/*.sh; do
    shellcheck "$script" || true
done

echo "✅ Local validation complete"
```

## Environment Variables

### Required Secrets in GitHub

```yaml
# Repository Secrets
N8N_API_KEY: <n8n-api-key>
BRAIN_API_KEY: <brain-api-key>
DEPLOY_SSH_KEY: <deployment-ssh-key>
SLACK_WEBHOOK_URL: <slack-webhook-url>
```

### Environment Configuration

```yaml
# Staging Environment
N8N_URL: http://staging-n8n:5679
BRAIN_URL: http://staging-brain:5221

# Production Environment
N8N_URL: http://localhost:5679
BRAIN_URL: http://localhost:5221
```

## Monitoring CI/CD

### GitHub Actions Dashboard
- View pipeline status
- Check job logs
- Monitor duration trends
- Track failure rates

### Metrics to Track
- Build success rate
- Deployment frequency
- Mean time to recovery
- Test coverage
- Security scan results

## Rollback Procedures

### Automatic Rollback
```yaml
- name: Health Check
  id: health
  run: |
    if ! curl -f http://n8n-api/health; then
      echo "Health check failed"
      exit 1
    fi

- name: Rollback on Failure
  if: failure() && steps.health.outcome == 'failure'
  run: |
    echo "Rolling back deployment..."
    ./scripts/rollback.sh
```

### Manual Rollback
```bash
# Restore from backup
./scripts/restore-workflows.sh <backup-timestamp>

# Or revert git commit
git revert HEAD
git push origin main
```

## Best Practices

### Branch Strategy
- `main` - Production-ready code
- `develop` - Integration branch
- `feature/*` - Feature development
- `hotfix/*` - Emergency fixes

### Commit Messages
```
feat: Add new workflow for X
fix: Correct webhook handler error
docs: Update integration guide
chore: Bump version to 1.2.3
refactor: Simplify callback logic
test: Add template validation tests
```

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] JSON validation passed
- [ ] Local tests passed
- [ ] Integration tests passed

## Checklist
- [ ] Version bumped (if applicable)
- [ ] Documentation updated
- [ ] No secrets in code
- [ ] Follows naming conventions
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| JSON validation fails | Check syntax with `jq` or `python -m json.tool` |
| Version conflict | Ensure version bump in registry |
| Deployment timeout | Check N8N connectivity |
| Secret detected | Remove and use environment variables |
| Permission denied | Check script permissions with `chmod +x` |

### Debug Commands

```bash
# Test GitHub Actions locally
act push -W .github/workflows/ci.yml

# Validate workflow file
yamllint .github/workflows/ci.yml

# Check JSON syntax
jq empty workflow-registry.json

# Test deployment script
./scripts/deploy.sh --dry-run
```

## Maintenance

### Weekly Tasks
- Review failed pipelines
- Update dependencies
- Check security advisories

### Monthly Tasks
- Analyze pipeline performance
- Optimize slow jobs
- Update documentation

### Quarterly Tasks
- Review and update pipeline
- Audit security practices
- Plan improvements