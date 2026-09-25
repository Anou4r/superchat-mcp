export interface ServerConfig {
  apiKey: string;
  enableWrites: boolean;
  enableDeletes: boolean;
  enableEnterpriseTools: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  function boolean(name: string): boolean {
    const value = env[name];
    if (value === undefined || value === "false") return false;
    if (value === "true") return true;
    throw new Error(`${name} must be true or false.`);
  }
  function integer(name: string, fallback: number, min: number, max: number): number {
    const value = env[name];
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
    return number;
  }
  const enableWrites = boolean("SUPERCHAT_ENABLE_WRITES");
  const enableDeletes = boolean("SUPERCHAT_ENABLE_DELETES");
  if (enableDeletes && !enableWrites) {
    throw new Error("SUPERCHAT_ENABLE_DELETES requires SUPERCHAT_ENABLE_WRITES=true.");
  }
  return {
    apiKey: env.SUPERCHAT_API_KEY?.trim() ?? "",
    enableWrites,
    enableDeletes,
    enableEnterpriseTools: boolean("SUPERCHAT_ENABLE_ENTERPRISE_TOOLS"),
    timeoutMs: integer("SUPERCHAT_TIMEOUT_MS", 30_000, 1, 300_000),
    maxRetries: integer("SUPERCHAT_MAX_RETRIES", 2, 0, 5),
  };
}
