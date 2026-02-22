# Cecelia Engine Documentation

Welcome to the Cecelia Engine documentation. This is your complete guide to using Cecelia's unified development toolchain.

## Table of Contents

1. [Getting Started](./getting-started.md)
2. [Architecture Overview](./architecture.md)
3. [CLI Reference](./cli-reference.md)
4. [Brain SDK](./brain-sdk.md)
5. [Configuration](./configuration.md)
6. [Development Workflow](./workflow.md)
7. [Testing](./testing.md)
8. [CI/CD](./cicd.md)
9. [Best Practices](./best-practices.md)
10. [Troubleshooting](./troubleshooting.md)

## What is Cecelia Engine?

Cecelia Engine is an intelligent development toolchain that provides:

- **Unified CLI**: Single command interface for all development tasks
- **Brain Integration**: AI-powered development assistance
- **Quality Gates**: Automated code quality enforcement
- **Smart Automation**: Intelligent task automation and optimization
- **Developer Experience**: Fast feedback loops and clear error messages

## Quick Start

```bash
# Install globally
npm install -g @cecelia/cli

# Initialize a new project
cecelia init my-project

# Start development
cd my-project
cecelia dev

# Run tests
cecelia test

# Build for production
cecelia build

# Deploy
cecelia deploy production
```

## Core Concepts

### 1. Brain Integration
Every operation is monitored and assisted by the Cecelia Brain, providing intelligent suggestions and automated problem resolution.

### 2. Quality-First Development
Strict quality gates at every stage ensure high code quality and reliability.

### 3. Automation by Default
Everything that can be automated is automated, reducing manual work and human error.

### 4. Unified Configuration
All tools use a single configuration file (`cecelia.config.ts`) for consistency.

## Project Structure

```
my-project/
├── src/                # Source code
├── tests/              # Test files
├── dist/               # Build output
├── docs/               # Documentation
├── .github/            # GitHub Actions workflows
├── cecelia.config.ts   # Project configuration
├── tsconfig.json       # TypeScript config
├── package.json        # Dependencies
└── README.md          # Project readme
```

## Available Commands

| Command | Description |
|---------|-------------|
| `cecelia init` | Initialize new project |
| `cecelia dev` | Start development mode |
| `cecelia test` | Run tests |
| `cecelia build` | Build for production |
| `cecelia deploy` | Deploy to environment |
| `cecelia lint` | Lint and format code |
| `cecelia doctor` | Check system health |
| `cecelia brain` | Brain integration commands |

## Brain Integration Features

- **Real-time Analysis**: Code analyzed as you write
- **Smart Suggestions**: AI-powered improvement suggestions
- **Error Diagnosis**: Intelligent error analysis and fixes
- **Performance Monitoring**: Automatic performance profiling
- **Learning System**: Improves based on your patterns

## Development Workflow

1. **Initialize**: Set up project with `cecelia init`
2. **Develop**: Write code with `cecelia dev` running
3. **Test**: Ensure quality with `cecelia test`
4. **Build**: Optimize with `cecelia build`
5. **Deploy**: Release with `cecelia deploy`

## Configuration Example

```typescript
// cecelia.config.ts
export default {
  project: {
    name: 'my-service',
    type: 'service',
  },
  build: {
    target: 'node18',
    sourcemap: true,
    minify: true,
  },
  test: {
    coverage: {
      threshold: 85,
      lines: 85,
      functions: 80,
      branches: 75,
    },
  },
  lint: {
    extends: '@cecelia/eslint-config',
    rules: {
      // Custom rules
    },
  },
  deploy: {
    environments: {
      dev: {
        url: 'https://dev.example.com',
        branch: 'develop',
      },
      staging: {
        url: 'https://staging.example.com',
        branch: 'staging',
      },
      production: {
        url: 'https://example.com',
        branch: 'main',
      },
    },
  },
  brain: {
    enabled: true,
    url: 'http://localhost:5221',
    features: {
      analysis: true,
      suggestions: true,
      autoFix: true,
    },
  },
}
```

## Quality Gates

### Pre-commit Hooks
- TypeScript compilation
- ESLint/Prettier checks
- Unit test execution
- Commit message validation

### CI Pipeline
- Full test suite
- Coverage thresholds
- Security scanning
- Performance testing

### Release Gates
- Version consistency
- Changelog updates
- Documentation completeness
- Migration scripts

## Troubleshooting

### Common Issues

**Brain connection failed**
```bash
# Check Brain service
cecelia doctor --check-brain

# Restart with debug
BRAIN_URL=http://localhost:5221 cecelia dev --verbose
```

**Build failures**
```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
cecelia build --verbose
```

**Test failures**
```bash
# Run specific test
cecelia test path/to/test

# Update snapshots
cecelia test --update-snapshots
```

## Support

- [GitHub Issues](https://github.com/perfectuser21/cecelia-engine/issues)
- [Documentation](https://docs.cecelia.ai)
- Brain Assistant: `cecelia brain help`

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and guidelines.

## License

MIT License - See [LICENSE](../LICENSE) for details.