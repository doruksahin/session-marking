import { pathToFileURL } from "node:url";

import { canonicalValue } from "./canonical-json.mjs";
import { exactKeys, fail, plainObject } from "./errors.mjs";
import * as localTarget from "./local-target.mjs";

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
      describeSelection: localTarget.describeSelection,
      resolveTarget: localTarget.resolveTarget,
      projectBinding: null,
    });
  }
  let loaded;
  try { loaded = await import(pathToFileURL(config.host.module).href); } catch { fail("ADAPTER_LOAD_FAILED", "The configured session-marking adapter could not be loaded."); }
  if (loaded.adapterApiVersion !== 1 || typeof loaded.describeSelection !== "function" || typeof loaded.resolveTarget !== "function" || typeof loaded.projectBinding !== "function") {
    fail("ADAPTER_INVALID", "The configured session-marking adapter does not implement API version 1.");
  }
  return Object.freeze({
    name: config.host.name,
    describeSelection: adapterOperation(loaded.describeSelection),
    resolveTarget: adapterOperation(loaded.resolveTarget),
    projectBinding: adapterOperation(loaded.projectBinding),
  });
}

export function validateDescription(value) {
  return canonicalValue(value, { requireObject: true });
}

export function validateResolution(value) {
  if (!exactKeys(value, ["context", "target"]) || !plainObject(value.context)) fail("ADAPTER_INVALID", "The adapter returned an invalid target resolution.");
  return Object.freeze({ target: canonicalValue(value.target, { requireObject: true }), context: value.context });
}

export function validateProjection(value) {
  return canonicalValue(value, { requireObject: true });
}
