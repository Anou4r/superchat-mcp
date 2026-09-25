import { readFile, writeFile, rename } from "node:fs/promises";

const target = new URL("../test/fixtures/public-api-contract.json", import.meta.url);
const previous = JSON.parse(await readFile(target, "utf8"));
const schemas = {};

function prune(value) {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["description", "example", "examples", "discriminator"].includes(key))
        .map(([key, item]) => [key, prune(item)]),
    );
  }
  return value;
}

function collectRefs(value, spec) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    if (!value.$ref.startsWith("#/components/schemas/"))
      throw new Error(`Unsupported ref: ${value.$ref}`);
    const name = value.$ref.split("/").at(-1);
    const source = spec.components?.schemas?.[name];
    if (!source) throw new Error(`Missing schema: ${name}`);
    const schema = prune(source);
    if (schemas[name]) {
      if (JSON.stringify(schemas[name]) !== JSON.stringify(schema))
        throw new Error(`Conflicting schema: ${name}`);
    } else {
      schemas[name] = schema;
      collectRefs(schema, spec);
    }
  }
  for (const [key, child] of Object.entries(value)) if (key !== "$ref") collectRefs(child, spec);
}

async function fetchOperation(operation) {
  const url = new URL(operation.source);
  if (
    url.origin !== "https://developers.superchat.com" ||
    !url.pathname.startsWith("/reference/")
  ) {
    throw new Error("Only public Superchat reference URLs are accepted.");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const markdown = await response.text();
  const blocks = [...markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const spec = blocks
    .map((block) => JSON.parse(block[1]))
    .find((block) => block.openapi && block.paths);
  if (!spec) throw new Error(`No OpenAPI block: ${url}`);
  const op = spec.paths[operation.path]?.[operation.method.toLowerCase()];
  if (!op) throw new Error(`Operation no longer documented: ${operation.method} ${operation.path}`);
  const body = op.requestBody?.content?.["application/json"]?.schema;
  if (op.requestBody && !body) throw new Error(`Unsupported request body: ${url}`);
  return {
    spec,
    operation: {
      method: operation.method,
      path: operation.path,
      source: operation.source,
      parameters: prune(op.parameters ?? []),
      ...(body ? { body: prune(body), bodyRequired: op.requestBody.required ?? false } : {}),
    },
  };
}

const operations = [];
for (let index = 0; index < previous.operations.length; index += 6) {
  const batch = await Promise.all(previous.operations.slice(index, index + 6).map(fetchOperation));
  for (const { operation, spec } of batch) {
    collectRefs(operation, spec);
    operations.push(operation);
  }
}
const updated = {
  retrievedAt: new Date().toISOString().slice(0, 10),
  source: previous.source,
  operations,
  components: { schemas },
};
const temporary = new URL(`${target.href}.tmp`);
await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`);
await rename(temporary, target);
console.log(
  `Updated ${operations.length} public operations. Review the diff and run npm run check.`,
);
