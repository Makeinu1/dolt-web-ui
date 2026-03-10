export function stablePkJson(pk: Record<string, unknown>): string {
  const sortedEntries = Object.entries(pk).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}
