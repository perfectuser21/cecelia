#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { version } from '../package.json';
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { testCommand } from './commands/test.js';
import { buildCommand } from './commands/build.js';
import { deployCommand } from './commands/deploy.js';
import { monitorCommand } from './commands/monitor.js';
import { doctorCommand } from './commands/doctor.js';
import { logger } from '@cecelia/utils';

const program = new Command();

program
  .name('cecelia')
  .description('Cecelia Engine - Unified development toolchain for autonomous development')
  .version(version)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--brain-url <url>', 'Brain API URL', 'http://localhost:5221')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().verbose) {
      logger.setLevel('debug');
    }
  });

// Initialize new project
program
  .command('init [name]')
  .description('Initialize a new Cecelia project')
  .option('-t, --type <type>', 'Project type (service|library|cli)', 'service')
  .option('-p, --preset <preset>', 'Use preset configuration')
  .option('--no-git', 'Skip git initialization')
  .option('--no-install', 'Skip dependency installation')
  .action(initCommand);

// Development mode
program
  .command('dev')
  .description('Start development mode with hot reload')
  .option('-p, --port <port>', 'Development server port', '3000')
  .option('-w, --watch <paths>', 'Additional paths to watch')
  .option('--no-brain', 'Disable Brain integration')
  .action(devCommand);

// Run tests
program
  .command('test [pattern]')
  .description('Run tests with coverage')
  .option('-w, --watch', 'Run tests in watch mode')
  .option('-c, --coverage', 'Generate coverage report')
  .option('-u, --update-snapshots', 'Update test snapshots')
  .option('--no-cache', 'Disable test cache')
  .action(testCommand);

// Build project
program
  .command('build')
  .description('Build project for production')
  .option('-o, --output <dir>', 'Output directory', 'dist')
  .option('-s, --sourcemap', 'Generate sourcemaps')
  .option('--no-minify', 'Skip minification')
  .option('--analyze', 'Analyze bundle size')
  .action(buildCommand);

// Deploy to environment
program
  .command('deploy <environment>')
  .description('Deploy to specified environment')
  .option('-t, --tag <tag>', 'Deployment tag/version')
  .option('--dry-run', 'Simulate deployment without changes')
  .option('--force', 'Force deployment (skip checks)')
  .option('--rollback', 'Rollback to previous version')
  .action(deployCommand);

// Monitor performance
program
  .command('monitor')
  .description('Monitor application performance and health')
  .option('-d, --duration <minutes>', 'Monitoring duration', '5')
  .option('-i, --interval <seconds>', 'Check interval', '10')
  .option('--export <format>', 'Export results (json|csv)')
  .action(monitorCommand);

// System health check
program
  .command('doctor')
  .description('Check system health and configuration')
  .option('--fix', 'Attempt to fix issues automatically')
  .option('--report', 'Generate detailed health report')
  .action(doctorCommand);

// Generate code/components
program
  .command('generate <type> <name>')
  .alias('g')
  .description('Generate code from templates')
  .option('-t, --template <template>', 'Template to use')
  .option('-d, --dir <dir>', 'Output directory')
  .option('--dry-run', 'Preview changes without writing')
  .action(async (type, name, options) => {
    const { generateCommand } = await import('./commands/generate.js');
    await generateCommand(type, name, options);
  });

// Lint and format code
program
  .command('lint [files...]')
  .description('Lint and format code')
  .option('-f, --fix', 'Auto-fix issues')
  .option('--format <format>', 'Output format', 'stylish')
  .action(async (files, options) => {
    const { lintCommand } = await import('./commands/lint.js');
    await lintCommand(files, options);
  });

// Manage dependencies
program
  .command('deps <action>')
  .description('Manage project dependencies')
  .option('-u, --update', 'Update dependencies')
  .option('-c, --check', 'Check for outdated')
  .option('-a, --audit', 'Security audit')
  .action(async (action, options) => {
    const { depsCommand } = await import('./commands/deps.js');
    await depsCommand(action, options);
  });

// Brain integration commands
const brain = program
  .command('brain')
  .description('Brain integration commands');

brain
  .command('sync')
  .description('Sync with Brain state')
  .action(async () => {
    const { brainSyncCommand } = await import('./commands/brain/sync.js');
    await brainSyncCommand();
  });

brain
  .command('analyze')
  .description('Request Brain analysis of code')
  .option('-f, --file <file>', 'Specific file to analyze')
  .action(async (options) => {
    const { brainAnalyzeCommand } = await import('./commands/brain/analyze.js');
    await brainAnalyzeCommand(options);
  });

brain
  .command('suggest')
  .description('Get improvement suggestions from Brain')
  .action(async () => {
    const { brainSuggestCommand } = await import('./commands/brain/suggest.js');
    await brainSuggestCommand();
  });

// Error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error.code === 'commander.missingArgument') {
    console.error(chalk.red(`Error: ${error.message}`));
  } else if (error.code === 'commander.unknownCommand') {
    console.error(chalk.red(`Unknown command: ${error.message}`));
    console.log(chalk.yellow('Run "cecelia --help" for available commands'));
  } else {
    console.error(chalk.red('An error occurred:'), error);
  }
  process.exit(1);
}

// Show help if no command provided
if (process.argv.length === 2) {
  program.help();
}