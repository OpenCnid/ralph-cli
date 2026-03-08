import { loadConfig } from '../config/index.js';
import { success, warn, error } from '../utils/index.js';

export function configValidateCommand(): void {
  try {
    const result = loadConfig();

    for (const w of result.warnings) {
      warn(w);
    }

    if (result.configPath === null) {
      error('No .ralph/config.yml found. Run `ralph init` to create one.');
      process.exit(1);
    }

    success(`Config is valid: ${result.configPath}`);
  } catch (err) {
    error((err as Error).message);
    process.exit(1);
  }
}
