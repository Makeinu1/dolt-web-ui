let clientRowIdCounter = 0;

export function createClientRowId(): string {
  clientRowIdCounter += 1;
  return `draft-row:${Date.now().toString(36)}:${clientRowIdCounter.toString(36)}`;
}
