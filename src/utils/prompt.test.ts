import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { ask, confirm, select } from './prompt.js';

let originalIsTtyDescriptor: PropertyDescriptor | undefined;

function setStdinIsTty(value: boolean): void {
  if (originalIsTtyDescriptor === undefined) {
    originalIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  }
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value,
  });
}

function restoreStdinIsTty(): void {
  if (originalIsTtyDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalIsTtyDescriptor);
  }
}

afterEach(() => {
  restoreStdinIsTty();
});

describe('prompt utils', () => {
  it('ask() returns default value when input is empty', async () => {
    setStdinIsTty(true);
    const input = new PassThrough();
    const output = new PassThrough();
    input.end('\n');

    const result = await ask('Project name', 'my-app', { input, output });
    expect(result).toBe('my-app');
  });

  it('confirm() handles y, n, and empty input with default', async () => {
    setStdinIsTty(true);

    const yesIn = new PassThrough();
    yesIn.end('y\n');
    expect(await confirm('Proceed?', false, { input: yesIn, output: new PassThrough() })).toBe(true);

    const noIn = new PassThrough();
    noIn.end('n\n');
    expect(await confirm('Proceed?', true, { input: noIn, output: new PassThrough() })).toBe(false);

    const emptyIn = new PassThrough();
    emptyIn.end('\n');
    expect(await confirm('Proceed?', true, { input: emptyIn, output: new PassThrough() })).toBe(true);
  });

  it('returns defaults immediately in non-interactive mode', async () => {
    setStdinIsTty(false);

    expect(await ask('Name', 'fallback')).toBe('fallback');
    expect(await confirm('Continue?', true)).toBe(true);
    expect(await select('Language', ['typescript', 'javascript'], 1)).toBe('javascript');
  });
});
