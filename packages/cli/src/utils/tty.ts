import pc from 'picocolors';

/** Interactive prompts need a real terminal on both ends. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Exit with a friendly usage hint instead of letting @clack/prompts crash
 * with "TTY initialization failed" when there is no interactive terminal.
 */
export function requireInteractive(hint: string): void {
  if (isInteractive()) return;
  console.error(pc.red('This step needs an interactive terminal (TTY) and none is available.'));
  console.error(pc.dim(hint));
  process.exit(1);
}
