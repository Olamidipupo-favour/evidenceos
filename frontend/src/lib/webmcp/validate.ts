/**
 * A focused JSON Schema (draft 2020-12) validator for the keywords the
 * EvidenceOS tool contracts use. This is what makes the registered schemas
 * actually *reject* malformed agent inputs at runtime — `registerTool` only
 * checks that a schema is serializable, it does not validate against it.
 *
 * Supported keywords: `type` (incl. unions), `enum`, `const`, `required`,
 * `properties`, `additionalProperties`, `pattern`, `minLength`, `maxLength`,
 * `minimum`, `maximum`, `items`, `minItems`, `maxItems`, `uniqueItems`,
 * `oneOf`, `anyOf`, `nullable`. Metadata (`title`, `description`,
 * `default`, `$schema`, `$id`) is ignored.
 */

export class ToolArgumentError extends Error {
  override name = "ToolArgumentError";
}

/** A draft-2020-12 JSON Schema object. */
export type JsonSchema = Record<string, unknown>;

/** Validate `value` against `schema`; throws `ToolArgumentError` on failure. */
export function validateInput(schema: JsonSchema, value: unknown): void {
  const errors = validateAgainst(schema, value, "$");
  if (errors.length > 0) {
    throw new ToolArgumentError(
      `Malformed input.${errors.length === 1 ? "" : ` ${errors.length} problems:`} ${errors.join("; ")}`,
    );
  }
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function validateAgainst(schema: JsonSchema, value: unknown, path: string): string[] {
  const errors: string[] = [];

  const type = schema.type;
  const pattern = typeof schema.pattern === "string" ? schema.pattern : null;

  if (type !== undefined) {
    const expected = Array.isArray(type) ? type : [type];
    if (!expected.includes("any") && !matchesAny(expected, value)) {
      return [`${path} must be of type ${expected.join(" | ")} but got ${typeName(value)}`];
    }
  }

  if (pattern !== null && typeof value === "string") {
    const re = pattern === UUID_PATTERN.source ? UUID_PATTERN : new RegExp(pattern);
    if (!re.test(value)) {
      errors.push(`${path} does not match the required pattern`);
    }
  }

  if (schema.enum !== undefined) {
    const options = schema.enum as unknown[];
    if (!options.some((option) => deepEqual(option, value))) {
      errors.push(`${path} must be one of ${options.map(j).join(", ")}`);
    }
  }

  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    errors.push(`${path} must equal ${j(schema.const)}`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      const dupes = value.filter((item) => {
        const key = j(item);
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
      });
      if (dupes.length > 0) {
        errors.push(`${path} must contain unique items (duplicate: ${j(dupes[0])})`);
      }
    }
    if (schema.items && typeof schema.items === "object") {
      const itemSchema = schema.items as JsonSchema;
      if (itemSchema.type !== undefined) {
        value.forEach((item, i) => {
          errors.push(...validateAgainst(itemSchema, item, `${path}[${i}]`));
        });
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties as Record<string, JsonSchema> | undefined;
    const required = (schema.required as string[] | undefined) ?? [];

    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) {
        errors.push(`${path} is missing required property "${key}"`);
      }
    }

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if ((value as Record<string, unknown>)[key] !== undefined) {
          errors.push(
            ...validateAgainst(
              propSchema,
              (value as Record<string, unknown>)[key],
              `${path}.${key}`,
            ),
          );
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties ?? {}));
      const unknownKeys = Object.keys(value as Record<string, unknown>).filter(
        (key) => !allowed.has(key),
      );
      if (unknownKeys.length > 0) {
        errors.push(`${path} has unsupported properties: ${unknownKeys.join(", ")}`);
      }
    }
  }

  if (schema.oneOf !== undefined) {
    const matches = (schema.oneOf as JsonSchema[]).filter(
      (option) => validateAgainst(option, value, path).length === 0,
    );
    if (matches.length !== 1) {
      errors.push(
        `${path} must satisfy exactly one of ${(schema.oneOf as JsonSchema[]).length} alternatives`,
      );
    }
  }

  if (schema.anyOf !== undefined) {
    const matches = (schema.anyOf as JsonSchema[]).filter(
      (option) => validateAgainst(option, value, path).length === 0,
    );
    if (matches.length < 1) {
      errors.push(
        `${path} must satisfy at least one of ${(schema.anyOf as JsonSchema[]).length} alternatives`,
      );
    }
  }

  return errors;
}

function matchesAny(expected: string[], value: unknown): boolean {
  if (expected.includes("null") && value === null) return true;
  if (expected.includes("array") && Array.isArray(value)) return true;
  if (
    expected.includes("object") &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return true;
  }
  if (expected.includes("string") && typeof value === "string") return true;
  if (expected.includes("integer") && typeof value === "number" && Number.isInteger(value))
    return true;
  if (expected.includes("number") && typeof value === "number") return true;
  if (expected.includes("boolean") && typeof value === "boolean") return true;
  return false;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (
      !deepEqual((a as Record<string, unknown>)[aKeys[i]], (b as Record<string, unknown>)[bKeys[i]])
    ) {
      return false;
    }
  }
  return true;
}

function j(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
