import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import schema from "../schema/v1.0.0.json";
import type { ValidationResult } from "./types.js";

// Build the AJV instance once at module load — it's expensive to compile.
const ajv = new Ajv({
  allErrors: true,         // collect all errors, not just the first
  strict: false,           // draft-07 schemas use "examples" which strict mode rejects
  validateFormats: true,
});
addFormats(ajv);

const compiledValidate = ajv.compile(schema);

/**
 * Validates a plain object against the CashMintStandard v1.0 per-token
 * metadata schema.
 *
 * @param json - The parsed token metadata object to validate.
 * @returns `{ valid: true, errors: [] }` on success, or
 *          `{ valid: false, errors: string[] }` listing every schema violation.
 *
 * @example
 * ```ts
 * const result = validate({ $schema: '...', cms_version: '1.0', name: 'Tiger #1',
 *   description: 'A tiger.', image: 'ipfs://Qm...' });
 * if (!result.valid) console.error(result.errors);
 * ```
 */
export function validate(json: unknown): ValidationResult {
  const valid = compiledValidate(json);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (compiledValidate.errors ?? []).map((err: ErrorObject) => {
    const field = err.instancePath || "(root)";
    return `${field}: ${err.message ?? "unknown error"}`;
  });

  return { valid: false, errors };
}
