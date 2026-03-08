import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../../config/index.js';
import { safeWriteFile } from '../../utils/fs.js';
import { success, warn, info } from '../../utils/index.js';

interface CiGenerateOptions {
  platform?: string | undefined;
}

const GITHUB_ACTIONS_TEMPLATE = `name: Ralph Quality Checks

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install ralph-cli
        run: npm install -g ralph-cli

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Lint (project)
        run: npm run lint

      - name: Ralph Lint
        run: ralph lint

      - name: Ralph Grade
        run: ralph grade --ci

      - name: Ralph Doctor
        run: ralph doctor --ci
`;

const GITLAB_CI_TEMPLATE = `stages:
  - build
  - test
  - quality

build:
  stage: build
  script:
    - npm ci
    - npm run build

test:
  stage: test
  script:
    - npm test

quality:
  stage: quality
  script:
    - npm install -g ralph-cli
    - ralph lint
    - ralph grade --ci
    - ralph doctor --ci
`;

const GENERIC_TEMPLATE = `# Ralph Quality Pipeline
# Add these commands after your existing build/test/lint steps:

ralph lint
ralph grade --ci
ralph doctor --ci
`;

export function ciGenerateCommand(options: CiGenerateOptions): void {
  const projectRoot = findProjectRoot(process.cwd());

  let platform = options.platform;

  // Auto-detect if not specified
  if (!platform) {
    if (existsSync(join(projectRoot, '.github'))) {
      platform = 'github';
    } else if (existsSync(join(projectRoot, '.gitlab-ci.yml'))) {
      platform = 'gitlab';
    } else {
      platform = 'generic';
    }
    info(`Auto-detected platform: ${platform}`);
  }

  switch (platform) {
    case 'github': {
      const outputPath = join(projectRoot, '.github', 'workflows', 'ralph.yml');
      safeWriteFile(outputPath, GITHUB_ACTIONS_TEMPLATE);
      success(`Generated: .github/workflows/ralph.yml`);
      break;
    }
    case 'gitlab': {
      const outputPath = join(projectRoot, '.ralph-ci.gitlab-ci.yml');
      safeWriteFile(outputPath, GITLAB_CI_TEMPLATE);
      success(`Generated: .ralph-ci.gitlab-ci.yml`);
      info('Include this file in your main .gitlab-ci.yml');
      break;
    }
    case 'generic':
    default: {
      console.log(GENERIC_TEMPLATE);
      break;
    }
  }
}
