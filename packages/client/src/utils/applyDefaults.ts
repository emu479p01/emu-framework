/** Apply a patch of default values onto a record, but never overwrite a field that already has a value. */
export function applyIfBlank(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (current === undefined || current === null || current === '') {
      target[key] = value;
    }
  }
}
