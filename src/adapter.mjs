import { pathToFileURL } from "node:url";

import { canonicalValue } from "./canonical-json.mjs";
import { exactKeys, fail, plainObject } from "./errors.mjs";
import { OPTIONAL_FIELDS } from "./target.mjs";

const ADAPTER_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function translateAdapterError(error) {
  if (error?.name === "SessionMarkAdapterError"
    && ADAPTER_ERROR_CODE_PATTERN.test(error.code || "")
    && typeof error.message === "string"
    && error.message.length > 0
    && error.message.length <= 512) {
    fail(error.code, error.message);
  }
  throw error;
}

function adapterOperation(operation) {
  return async (input) => {
    try {
      return await operation(input);
    } catch (error) {
      translateAdapterError(error);
    }
  };
}

export async function loadAdapter(config) {
  if (!config.host.enabled) {
    return Object.freeze({
      name: "local",
      describeRequirements: () => ({ required: [], description: "" }),
      prepareBinding: null,
      projectBinding: null,
    });
  }
  let loaded;
  try { loaded = await import(pathToFileURL(config.host.module).href); } catch { fail("ADAPTER_LOAD_FAILED", "The configured session-marking adapter could not be loaded."); }
  if (loaded.adapterApiVersion !== 2 || typeof loaded.describeRequirements !== "function" || typeof loaded.prepareBinding !== "function" || typeof loaded.projectBinding !== "function") {
    fail("ADAPTER_INVALID", "The configured session-marking adapter does not implement API version 2.");
  }
  return Object.freeze({
    name: config.host.name,
    describeRequirements: adapterOperation(loaded.describeRequirements),
    prepareBinding: adapterOperation(loaded.prepareBinding),
    projectBinding: adapterOperation(loaded.projectBinding),
  });
}

export async function readRequirements(adapter) {
  const value = await adapter.describeRequirements();
  if (!exactKeys(value, ["required", "description"]) || !Array.isArray(value.required)
    || value.required.length > OPTIONAL_FIELDS.length || value.required.some((field) => !OPTIONAL_FIELDS.includes(field)) || typeof value.description !== "string") {
    fail("ADAPTER_INVALID", "The adapter requirements may only require stageId and describe destination constraints.");
  }
  return value;
}

export function validatePreparation(value) {
  if (!exactKeys(value, ["context"]) || !plainObject(value.context)) fail("ADAPTER_INVALID", "The adapter must prepare context without replacing the shared target.");
  return value;
}

export function validateProjection(value) {
  return canonicalValue(value, { requireObject: true });
}
