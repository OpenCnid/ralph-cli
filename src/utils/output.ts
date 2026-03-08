import pc from 'picocolors';

export function success(msg: string): void {
  console.log(pc.green('✓') + ' ' + msg);
}

export function warn(msg: string): void {
  console.log(pc.yellow('⚠') + ' ' + msg);
}

export function error(msg: string): void {
  console.error(pc.red('✗') + ' ' + msg);
}

export function info(msg: string): void {
  console.log(pc.blue('ℹ') + ' ' + msg);
}

export function heading(msg: string): void {
  console.log(pc.bold(msg));
}

export function plain(msg: string): void {
  console.log(msg);
}
