// Priority 3 — AI hook utilities will be implemented after Priority 2.
// Placeholder exports to keep the module graph consistent.

export async function requestChallenge(
  _endpoint: string,
  _categoryId: string,
  _serial: number
): Promise<never> {
  throw new Error("requestChallenge() is not yet implemented (Priority 3)");
}

export async function proveOwnership(
  _challenge: string,
  _privateKey: string
): Promise<never> {
  throw new Error("proveOwnership() is not yet implemented (Priority 3)");
}

export async function verifyOwnership(
  _signature: string,
  _categoryId: string,
  _serial: number
): Promise<never> {
  throw new Error("verifyOwnership() is not yet implemented (Priority 3)");
}
