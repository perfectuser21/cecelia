import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { logger, execAsync } from '@cecelia/utils';
import { BrainClient } from '@cecelia/sdk';

export async function initCommand(name?: string, options?: any) {
  const spinner = ora();

  try {
    // Interactive prompts for missing information
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: name || 'my-cecelia-project',
        when: !name,
      },
      {
        type: 'list',
        name: 'projectType',
        message: 'Project type:',
        choices: [
          { name: 'Service (API/Backend)', value: 'service' },
          { name: 'Library (Reusable package)', value: 'library' },
          { name: 'CLI (Command-line tool)', value: 'cli' },
          { name: 'Web App (Frontend)', value: 'webapp' },
        ],
        when: !options.type,
      },
      {
        type: 'confirm',
        name: 'useBrain',
        message: 'Enable Brain integration?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'useDocker',
        message: 'Include Docker configuration?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'useCI',
        message: 'Setup GitHub Actions CI/CD?',
        default: true,
      },
    ]);

    const projectName = name || answers.projectName;
    const projectType = options.type || answers.projectType;
    const projectPath = path.join(process.cwd(), projectName);

    // Check if directory exists
    try {
      await fs.access(projectPath);
      const overwrite = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `Directory ${projectName} exists. Overwrite?`,
          default: false,
        },
      ]);
      if (!overwrite.overwrite) {
        console.log(chalk.yellow('Initialization cancelled'));
        return;
      }
    } catch {
      // Directory doesn't exist, continue
    }

    spinner.start('Creating project structure...');

    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });

    // Create base structure
    const structure = getProjectStructure(projectType);
    for (const [filePath, content] of Object.entries(structure)) {
      const fullPath = path.join(projectPath, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content as string);
    }

    // Initialize git if requested
    if (options.git !== false) {
      spinner.text = 'Initializing git repository...';
      await execAsync('git init', { cwd: projectPath });
      await execAsync('git add .', { cwd: projectPath });
      await execAsync('git commit -m "Initial commit from Cecelia Engine"', { cwd: projectPath });
    }

    // Install dependencies if requested
    if (options.install !== false) {
      spinner.text = 'Installing dependencies...';
      await execAsync('npm install', { cwd: projectPath });
    }

    // Register with Brain if enabled
    if (answers.useBrain) {
      spinner.text = 'Registering with Brain...';
      const brain = new BrainClient(options.brainUrl || 'http://localhost:5221');
      await brain.registerProject({
        name: projectName,
        type: projectType,
        path: projectPath,
      });
    }

    spinner.succeed(chalk.green(`Project ${projectName} created successfully!`));

    // Print next steps
    console.log('\nNext steps:');
    console.log(chalk.cyan(`  cd ${projectName}`));
    console.log(chalk.cyan('  cecelia dev'));
    console.log('\nAvailable commands:');
    console.log('  cecelia dev      - Start development mode');
    console.log('  cecelia test     - Run tests');
    console.log('  cecelia build    - Build for production');
    console.log('  cecelia deploy   - Deploy to environment');
    console.log('  cecelia doctor   - Check system health');

  } catch (error) {
    spinner.fail(chalk.red('Initialization failed'));
    logger.error('Init error:', error);
    throw error;
  }
}

function getProjectStructure(type: string): Record<string, string> {
  const baseStructure = {
    'package.json': getPackageJson(type),
    'tsconfig.json': getTsConfig(),
    '.gitignore': getGitignore(),
    'README.md': getReadme(type),
    'cecelia.config.ts': getCeceliaConfig(type),
    '.env.example': getEnvExample(),
  };

  const typeSpecific: Record<string, Record<string, string>> = {
    service: {
      'src/index.ts': getServiceIndex(),
      'src/routes/health.ts': getHealthRoute(),
      'src/middleware/error.ts': getErrorMiddleware(),
      'tests/health.test.ts': getHealthTest(),
    },
    library: {
      'src/index.ts': getLibraryIndex(),
      'src/example.ts': getExampleModule(),
      'tests/example.test.ts': getExampleTest(),
    },
    cli: {
      'src/index.ts': getCliIndex(),
      'src/commands/hello.ts': getHelloCommand(),
      'tests/cli.test.ts': getCliTest(),
    },
    webapp: {
      'src/main.ts': getWebAppMain(),
      'src/App.tsx': getAppComponent(),
      'index.html': getIndexHtml(),
      'vite.config.ts': getViteConfig(),
    },
  };

  return { ...baseStructure, ...(typeSpecific[type] || typeSpecific.service) };
}

function getPackageJson(type: string): string {
  return JSON.stringify({
    name: 'my-cecelia-project',
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'cecelia dev',
      build: 'cecelia build',
      test: 'cecelia test',
      lint: 'cecelia lint',
      deploy: 'cecelia deploy',
    },
    dependencies: type === 'webapp'
      ? { react: '^18.0.0', 'react-dom': '^18.0.0' }
      : type === 'service'
      ? { express: '^4.18.0' }
      : {},
    devDependencies: {
      '@cecelia/cli': '^1.0.0',
      typescript: '^5.3.0',
      vitest: '^1.0.0',
    },
  }, null, 2);
}

function getTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, null, 2);
}

function getGitignore(): string {
  return `node_modules/
dist/
.env
.env.local
*.log
coverage/
.DS_Store
.vscode/
.idea/
`;
}

function getReadme(type: string): string {
  return `# My Cecelia Project

A ${type} project built with Cecelia Engine.

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development
cecelia dev

# Run tests
cecelia test

# Build for production
cecelia build

# Deploy
cecelia deploy production
\`\`\`

## Project Structure

- \`src/\` - Source code
- \`tests/\` - Test files
- \`dist/\` - Build output
- \`cecelia.config.ts\` - Project configuration

## Available Commands

- \`cecelia dev\` - Start development mode
- \`cecelia test\` - Run tests
- \`cecelia build\` - Build project
- \`cecelia lint\` - Lint code
- \`cecelia deploy\` - Deploy to environment

## Brain Integration

This project is integrated with Cecelia Brain for intelligent development assistance.

## License

MIT
`;
}

function getCeceliaConfig(type: string): string {
  return `export default {
  project: {
    name: 'my-cecelia-project',
    type: '${type}',
  },
  build: {
    target: 'node18',
    sourcemap: true,
  },
  test: {
    coverage: {
      threshold: 85,
    },
  },
  lint: {
    extends: '@cecelia/eslint-config',
  },
  deploy: {
    environments: ['dev', 'staging', 'production'],
  },
  brain: {
    enabled: true,
    url: 'http://localhost:5221',
  },
};
`;
}

function getEnvExample(): string {
  return `# Environment Configuration
NODE_ENV=development
PORT=3000
BRAIN_URL=http://localhost:5221
LOG_LEVEL=info
`;
}

function getServiceIndex(): string {
  return `import express from 'express';
import { logger } from '@cecelia/utils';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/health', healthRouter);
app.use(errorHandler);

app.listen(port, () => {
  logger.info(\`Service running on port \${port}\`);
});
`;
}

function getHealthRoute(): string {
  return `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});
`;
}

function getErrorMiddleware(): string {
  return `import { Request, Response, NextFunction } from 'express';
import { logger } from '@cecelia/utils';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Request error:', err);
  res.status(500).json({
    error: err.message,
  });
}
`;
}

function getHealthTest(): string {
  return `import { describe, it, expect } from 'vitest';

describe('Health Check', () => {
  it('should return healthy status', async () => {
    const response = await fetch('http://localhost:3000/health');
    const data = await response.json();
    expect(data.status).toBe('healthy');
  });
});
`;
}

function getLibraryIndex(): string {
  return `export { example } from './example.js';

export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`;
}

function getExampleModule(): string {
  return `export function example(): string {
  return 'This is an example module';
}
`;
}

function getExampleTest(): string {
  return `import { describe, it, expect } from 'vitest';
import { hello, example } from '../src/index.js';

describe('Library', () => {
  it('should greet correctly', () => {
    expect(hello('World')).toBe('Hello, World!');
  });

  it('should export example function', () => {
    expect(example()).toBe('This is an example module');
  });
});
`;
}

function getCliIndex(): string {
  return `#!/usr/bin/env node

import { Command } from 'commander';
import { helloCommand } from './commands/hello.js';

const program = new Command();

program
  .name('my-cli')
  .description('My CLI tool')
  .version('1.0.0');

program
  .command('hello <name>')
  .description('Say hello')
  .action(helloCommand);

program.parse(process.argv);
`;
}

function getHelloCommand(): string {
  return `export function helloCommand(name: string): void {
  console.log(\`Hello, \${name}!\`);
}
`;
}

function getCliTest(): string {
  return `import { describe, it, expect } from 'vitest';
import { helloCommand } from '../src/commands/hello.js';

describe('CLI', () => {
  it('should have hello command', () => {
    expect(helloCommand).toBeDefined();
  });
});
`;
}

function getWebAppMain(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

function getAppComponent(): string {
  return `import React from 'react';

function App() {
  return (
    <div>
      <h1>Welcome to Cecelia</h1>
      <p>Your app is running!</p>
    </div>
  );
}

export default App;
`;
}

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cecelia App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`;
}

function getViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;
}