import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from '../../config/schema.js';

export interface DetectionResult {
  language: Language;
  framework?: string | undefined;
  testRunner?: string | undefined;
  linter?: string | undefined;
  projectName?: string | undefined;
  description?: string | undefined;
}

/**
 * Detect project language, framework, test runner, and linter from project files.
 */
export function detectProject(projectRoot: string): DetectionResult {
  const result: DetectionResult = {
    language: 'typescript',
  };

  // Check package.json (Node.js projects)
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      result.projectName = pkg['name'] as string | undefined;
      result.description = pkg['description'] as string | undefined;

      const deps = { ...(pkg['dependencies'] as Record<string, string> | undefined), ...(pkg['devDependencies'] as Record<string, string> | undefined) };

      // Detect language
      if (deps['typescript']) {
        result.language = 'typescript';
      } else {
        result.language = 'javascript';
      }

      // Detect framework
      if (deps['next']) result.framework = 'nextjs';
      else if (deps['express']) result.framework = 'express';
      else if (deps['fastify']) result.framework = 'fastify';
      else if (deps['@nestjs/core']) result.framework = 'nestjs';
      else if (deps['react'] && !deps['next']) result.framework = 'react';
      else if (deps['vue']) result.framework = 'vue';
      else if (deps['svelte']) result.framework = 'svelte';

      // Detect test runner
      if (deps['vitest']) result.testRunner = 'vitest';
      else if (deps['jest']) result.testRunner = 'jest';
      else if (deps['mocha']) result.testRunner = 'mocha';

      // Detect linter
      if (deps['eslint']) result.linter = 'eslint';
      else if (deps['biome'] || deps['@biomejs/biome']) result.linter = 'biome';
    } catch {
      // Invalid package.json, continue with defaults
    }
    return result;
  }

  // Check pyproject.toml (Python)
  if (existsSync(join(projectRoot, 'pyproject.toml'))) {
    result.language = 'python';
    // Basic detection — read file for framework hints
    try {
      const content = readFileSync(join(projectRoot, 'pyproject.toml'), 'utf-8');
      if (content.includes('django')) result.framework = 'django';
      else if (content.includes('fastapi')) result.framework = 'fastapi';
      else if (content.includes('flask')) result.framework = 'flask';
      if (content.includes('pytest')) result.testRunner = 'pytest';
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) result.projectName = nameMatch[1];
    } catch { /* ignore */ }
    return result;
  }

  // Check go.mod (Go)
  if (existsSync(join(projectRoot, 'go.mod'))) {
    result.language = 'go';
    result.testRunner = 'go-test';
    try {
      const content = readFileSync(join(projectRoot, 'go.mod'), 'utf-8');
      if (content.includes('github.com/gin-gonic/gin')) result.framework = 'gin';
      else if (content.includes('github.com/gofiber/fiber')) result.framework = 'fiber';
      else if (content.includes('github.com/labstack/echo')) result.framework = 'echo';
      const modMatch = content.match(/^module\s+(\S+)/m);
      if (modMatch) {
        const parts = modMatch[1]!.split('/');
        result.projectName = parts[parts.length - 1];
      }
    } catch { /* ignore */ }
    return result;
  }

  // Check Cargo.toml (Rust)
  if (existsSync(join(projectRoot, 'Cargo.toml'))) {
    result.language = 'rust';
    try {
      const content = readFileSync(join(projectRoot, 'Cargo.toml'), 'utf-8');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) result.projectName = nameMatch[1];
    } catch { /* ignore */ }
    return result;
  }

  return result;
}
