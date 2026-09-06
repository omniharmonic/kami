/**
 * Load a binding from YAML or JSON and check it against the JSON Schema
 * (`schemas/place-set-binding-1.0.json`). This is the shape check only; the
 * tree-dependent rules 1–6 live in `validate.ts`.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

import type { Binding } from "./schema.js";

const require = createRequire(import.meta.url);
export const bindingJsonSchema = require("../schemas/place-set-binding-1.0.json") as Record<string, unknown>;
export const idsJsonSchema = require("../schemas/ids-schema-1.0.json") as Record<string, unknown>;

let ajv: Ajv2020 | null = null;
export function getAjv(): Ajv2020 {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    ajv.addSchema(bindingJsonSchema);
    ajv.addSchema(idsJsonSchema);
  }
  return ajv;
}

export function bindingValidator(): ValidateFunction {
  const v = getAjv().getSchema(bindingJsonSchema.$id as string);
  if (!v) throw new Error("binding schema not registered");
  return v;
}

export function idRecordValidator(): ValidateFunction {
  const v = getAjv().getSchema(idsJsonSchema.$id as string);
  if (!v) throw new Error("ids schema not registered");
  return v;
}

export interface SchemaIssue {
  path: string;
  message: string;
  keyword: string;
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): SchemaIssue[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.keyword === "additionalProperties"
      ? `unexpected key "${String((e.params as { additionalProperty?: string }).additionalProperty)}"`
      : (e.message ?? e.keyword),
    keyword: e.keyword,
  }));
}

export class BindingSchemaError extends Error {
  override name = "BindingSchemaError";
  constructor(public readonly issues: SchemaIssue[]) {
    super(`binding does not match place-set-binding-1.0: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  }
}

/** Shape-check an already-parsed object. Throws `BindingSchemaError`. */
export function assertBindingShape(value: unknown): Binding {
  const validate = bindingValidator();
  if (!validate(value)) throw new BindingSchemaError(formatAjvErrors(validate.errors));
  return value as Binding;
}

/** Shape-check without throwing. */
export function checkBindingShape(value: unknown): SchemaIssue[] {
  const validate = bindingValidator();
  return validate(value) ? [] : formatAjvErrors(validate.errors);
}

export type BindingFormat = "yaml" | "json";

/** Parse YAML or JSON text into a binding and shape-check it. */
export function parseBinding(text: string, format: BindingFormat = "yaml"): Binding {
  const value: unknown = format === "json" ? JSON.parse(text) : parseYaml(text);
  return assertBindingShape(value);
}

/** Read a `.yaml`/`.yml`/`.json` file. */
export async function loadBinding(path: string): Promise<Binding> {
  const text = await readFile(path, "utf8");
  return parseBinding(text, path.endsWith(".json") ? "json" : "yaml");
}
