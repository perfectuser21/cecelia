# Cecelia Workflows - Complete Setup Guide

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Initial Setup](#initial-setup)
4. [Workflow Development](#workflow-development)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [Operations](#operations)
8. [Troubleshooting](#troubleshooting)
9. [API Reference](#api-reference)
10. [Best Practices](#best-practices)

## Overview

Cecelia Workflows is the autonomous workflow management system that integrates with Cecelia Brain for intelligent task scheduling and execution. This repository manages all N8N workflows, staff configurations, and automation protocols.

### Key Features

- 🤖 **Autonomous Management** - Self-managing workflow lifecycle
- 🧠 **Brain Integration** - AI-powered scheduling and optimization
- 📊 **Real-time Monitoring** - Performance metrics and health tracking
- 🔄 **Version Control** - Git-based workflow versioning
- 🚀 **CI/CD Pipeline** - Automated testing and deployment
- 🔒 **Security First** - Secret management and access control

## Architecture

### System Components

```mermaid
graph TB
    subgraph "Cecelia Ecosystem"
        B[Brain - Intelligence]
        W[Workflows - Automation]
        N[N8N - Execution Engine]
        PG[PostgreSQL - State]
    end

    subgraph "External"
        GH[GitHub - Version Control]
        CT[Cloudflare Tunnel]
        API[External APIs]
    end

    B <--> W
    W <--> N
    B <--> PG
    N <--> PG
    W <--> GH
    N <--> API
    N <--> CT
```

### Directory Structure

```
cecelia-workflows/
├── .github/workflows/          # CI/CD pipelines
├── n8n/                        # N8N workflow definitions
│   ├── workflows/
│   │   ├── cecelia/           # Core system workflows
│   │   ├── media/             # Media automation
│   │   └── tools/             # Utility workflows
│   ├── templates/             # Workflow templates
│   └── capability_mapping.json # Capability registry
├── staff/                      # Staff configurations
│   └── workers.config.json    # Worker definitions
├── protocols/                  # Automation protocols
├── scripts/                    # Management scripts
├── monitoring/                 # Monitoring configs
├── docs/                      # Documentation
├── templates/                 # Workflow templates
├── deploy/                    # Deployment scripts
├── workflow-registry.json     # Central registry
└── WORKFLOW_MANAGEMENT.md     # Management guide
```

## Initial Setup

### Prerequisites

- Git configured with GitHub access
- Docker installed for N8N
- PostgreSQL database running
- Node.js 20+ for Brain integration
- Python 3.11+ for scripts

### Installation Steps

#### 1. Clone Repository

```bash
# Clone the repository
git clone https://github.com/perfectuser21/cecelia-workflows.git
cd cecelia-workflows

# Set up Git configuration
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

#### 2. Environment Configuration

```bash
# Create environment file
cat > .env << EOF
# N8N Configuration
N8N_URL=http://localhost:5679
N8N_API_KEY=your-n8n-api-key

# Brain Configuration
BRAIN_URL=http://localhost:5221
BRAIN_API_KEY=your-brain-api-key

# Database Configuration
DATABASE_URL=postgresql://cecelia:password@localhost:5432/cecelia

# Monitoring
GRAFANA_URL=http://localhost:3000
PROMETHEUS_URL=http://localhost:9090
EOF

# Set permissions
chmod 600 .env
```

#### 3. Install Dependencies

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies (if needed)
npm install

# Make scripts executable
chmod +x scripts/*.sh
```

#### 4. Database Setup

```bash
# Run migrations
psql $DATABASE_URL < migrations/001_workflow_tables.sql

# Verify setup
psql $DATABASE_URL -c "SELECT * FROM workflow_registry;"
```

#### 5. N8N Configuration

```bash
# Import initial workflows
./scripts/import-to-n8n.sh

# Verify N8N connection
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
     $N8N_URL/api/v1/workflows
```

#### 6. Brain Registration

```bash
# Register workflows with Brain
./scripts/register-workflows.sh

# Verify registration
curl -H "X-Brain-API-KEY: $BRAIN_API_KEY" \
     $BRAIN_URL/api/brain/workflows
```

## Workflow Development

### Creating a New Workflow

#### 1. Define Workflow Metadata

```json
{
  "id": "RD-NEW-feature",
  "name": "New Feature Workflow",
  "version": "1.0.0",
  "department": "research",
  "trigger_type": "webhook",
  "priority": "P2"
}
```

#### 2. Implement in N8N

1. Open N8N interface
2. Create new workflow
3. Add nodes and logic
4. Test thoroughly
5. Export to JSON

#### 3. Register Workflow

```bash
# Add to registry
./scripts/add-workflow.sh RD-NEW-feature

# Version control
git add .
git commit -m "feat: Add new feature workflow"
git push origin develop
```

### Workflow Templates

Use templates as starting points:

```bash
# Copy template
cp templates/workflow-template-webhook.json \
   n8n/workflows/cecelia/new-webhook-handler.json

# Customize the workflow
vim n8n/workflows/cecelia/new-webhook-handler.json

# Register
./scripts/register-workflow.sh new-webhook-handler
```

## Testing

### Local Testing

```bash
# Validate JSON syntax
./scripts/validate-workflows.sh

# Test specific workflow
./scripts/test-workflow.sh RD-AUTO-code-review

# Run integration tests
npm test
```

### Staging Testing

```bash
# Deploy to staging
./deploy/deploy.sh staging

# Run staging tests
./scripts/test-staging.sh

# Monitor results
curl $STAGING_URL/api/workflows/health
```

## Deployment

### Development Workflow

```bash
# 1. Create feature branch
git checkout -b feature/new-workflow

# 2. Make changes
# ... edit workflows ...

# 3. Test locally
./scripts/test-local.sh

# 4. Commit changes
git add .
git commit -m "feat: Add new workflow"

# 5. Push and create PR
git push origin feature/new-workflow
# Create PR on GitHub

# 6. After approval, merge to develop
git checkout develop
git merge feature/new-workflow

# 7. Deploy to staging (automatic via CI/CD)
```

### Production Deployment

```bash
# 1. Merge develop to main
git checkout main
git merge develop

# 2. Tag release
git tag -a v1.2.3 -m "Release version 1.2.3"
git push origin main --tags

# 3. Production deployment (manual approval required)
# CI/CD will handle the deployment after approval
```

## Operations

### Daily Operations

```bash
# Check system health
./scripts/health-check.sh

# View workflow status
curl $BRAIN_URL/api/workflows/status | jq

# Check queue depth
curl $BRAIN_URL/api/workflows/queue | jq '.length'

# Review errors
tail -f /var/log/cecelia/workflows/errors.log
```

### Monitoring

```bash
# View metrics dashboard
open http://localhost:3000/d/workflows

# Check specific workflow metrics
curl $BRAIN_URL/api/workflows/metrics/RD-AUTO-code-review

# Export metrics for analysis
./scripts/export-metrics.sh --last-24h > metrics.json
```

### Backup and Recovery

```bash
# Backup workflows
./scripts/backup-workflows.sh

# Restore from backup
./scripts/restore-workflows.sh 2024-02-15-backup.tar.gz

# Verify restoration
./scripts/verify-workflows.sh
```

## Troubleshooting

### Common Issues

#### Workflow Not Triggering

```bash
# Check if workflow is active
curl $N8N_URL/api/v1/workflows/{id} | jq '.active'

# Check Brain registration
curl $BRAIN_URL/api/brain/workflows/{id} | jq

# View logs
docker logs n8n-self-hosted --tail 100
```

#### High Error Rate

```bash
# Identify failing workflows
./scripts/analyze-errors.sh --last-hour

# Check specific error
curl $BRAIN_URL/api/workflows/errors/{error-id}

# Quarantine problematic workflow
./scripts/quarantine-workflow.sh {workflow-id}
```

#### Performance Issues

```bash
# Check resource usage
docker stats n8n-self-hosted

# Analyze slow queries
./scripts/analyze-performance.sh

# Optimize database
psql $DATABASE_URL -c "VACUUM ANALYZE workflow_executions;"
```

## API Reference

### Brain API Endpoints

```bash
# Workflow Management
GET    /api/brain/workflows           # List all workflows
POST   /api/brain/workflows/register  # Register new workflow
PUT    /api/brain/workflows/{id}      # Update workflow
DELETE /api/brain/workflows/{id}      # Remove workflow

# Execution Control
POST   /api/brain/workflows/{id}/execute  # Trigger workflow
GET    /api/brain/workflows/{id}/status   # Get execution status
POST   /api/brain/workflows/{id}/cancel   # Cancel execution

# Callbacks
POST   /api/brain/execution-callback  # Report execution status

# Monitoring
GET    /api/brain/workflows/health    # Health check
GET    /api/brain/workflows/metrics   # Performance metrics
```

### N8N API Endpoints

```bash
# Workflow Operations
GET    /api/v1/workflows              # List workflows
POST   /api/v1/workflows              # Create workflow
PUT    /api/v1/workflows/{id}         # Update workflow
DELETE /api/v1/workflows/{id}         # Delete workflow

# Execution
POST   /api/v1/workflows/{id}/execute # Execute workflow
GET    /api/v1/executions             # List executions
GET    /api/v1/executions/{id}        # Get execution details
```

## Best Practices

### Workflow Design

1. **Idempotency** - Workflows should be safe to retry
2. **Error Handling** - Always include error paths
3. **Timeouts** - Set appropriate timeouts
4. **Logging** - Log all significant events
5. **Testing** - Test all paths including errors

### Version Management

1. **Semantic Versioning** - Use MAJOR.MINOR.PATCH
2. **Changelog** - Document all changes
3. **Backward Compatibility** - Maintain when possible
4. **Deprecation** - Provide migration path

### Security

1. **No Hardcoded Secrets** - Use environment variables
2. **Access Control** - Implement proper permissions
3. **Audit Logging** - Track all changes
4. **Regular Audits** - Review security quarterly

### Performance

1. **Resource Limits** - Set CPU/memory limits
2. **Batch Processing** - Process in chunks
3. **Caching** - Cache expensive operations
4. **Monitoring** - Track performance metrics

### Documentation

1. **README Files** - Every directory should have one
2. **Inline Comments** - Explain complex logic
3. **API Docs** - Document all endpoints
4. **Examples** - Provide usage examples

## Appendix

### Glossary

| Term | Description |
|------|-------------|
| **Workflow** | Automated sequence of tasks |
| **Brain** | AI decision engine |
| **N8N** | Workflow execution platform |
| **Webhook** | HTTP callback trigger |
| **Quarantine** | Isolated due to errors |
| **KR** | Key Result (from OKR) |

### Resources

- [N8N Documentation](https://docs.n8n.io)
- [GitHub Actions](https://docs.github.com/actions)
- [PostgreSQL Docs](https://www.postgresql.org/docs)
- [Cecelia Brain Docs](../cecelia-core/docs)

### Support

- **Issues**: Create in GitHub repository
- **Emergency**: Contact Brain operator
- **Questions**: Post in discussions
- **Updates**: Check CHANGELOG.md