import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

function getMockRegistry() {
  return globalThis.__mockModules instanceof Map ? globalThis.__mockModules : null;
}

function buildMockSource(specifier, entry) {
  const resolved = entry && typeof entry === "object" ? entry : {};
  const exportNames = Object.keys(resolved).filter((key) => key !== "default");
  const lines = [];
  lines.push(`const entry = globalThis.__mockModules?.get(${JSON.stringify(specifier)}) || {};`);
  lines.push(`const resolved = entry && typeof entry === "object" ? entry : {};`);
  lines.push(
    "export default Object.prototype.hasOwnProperty.call(resolved, \"default\") ? resolved.default : resolved;",
  );
  exportNames.forEach((name) => {
    if (!/^[$A-Z_][0-9A-Z_$]*$/i.test(name)) return;
    lines.push(`export const ${name} = resolved[${JSON.stringify(name)}];`);
  });
  return lines.join("\n");
}

export async function resolve(specifier, context, defaultResolve) {
  const registry = getMockRegistry();
  if (registry && registry.has(specifier)) {
    return { url: `mock:${specifier}`, shortCircuit: true };
  }
  try {
    const resolved = await defaultResolve(specifier, context, defaultResolve);
    if (registry && registry.has(resolved.url)) {
      return { url: `mock:${resolved.url}`, shortCircuit: true };
    }
    return resolved;
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      (specifier.startsWith(".") || specifier.startsWith("/")) &&
      !specifier.match(/\.[a-z0-9]+$/i)
    ) {
      try {
        const resolvedJs = await defaultResolve(`${specifier}.js`, context, defaultResolve);
        if (registry && registry.has(resolvedJs.url)) {
          return { url: `mock:${resolvedJs.url}`, shortCircuit: true };
        }
        return resolvedJs;
      } catch (_jsError) {
        const resolved = await defaultResolve(`${specifier}.jsx`, context, defaultResolve);
        if (registry && registry.has(resolved.url)) {
          return { url: `mock:${resolved.url}`, shortCircuit: true };
        }
        return resolved;
      }
    }
    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (url.startsWith("mock:")) {
    const specifier = url.slice(5);
    const registry = getMockRegistry();
    const entry = registry?.get(specifier) || {};
    return {
      format: "module",
      source: buildMockSource(specifier, entry),
      shortCircuit: true,
    };
  }
  if (url.endsWith(".jsx")) {
    const source = await readFile(new URL(url), "utf8");
    const result = await transform(source, {
      loader: "jsx",
      format: "esm",
      sourcemap: "inline",
    });
    return {
      format: "module",
      source: result.code,
      shortCircuit: true,
    };
  }
  return defaultLoad(url, context, defaultLoad);
}
