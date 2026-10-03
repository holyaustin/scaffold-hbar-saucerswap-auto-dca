/** Set `KEY=value` in .env-style text: replaces the line (even a commented-out example) or appends it. */
export function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, () => line);
  return `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
}

/**
 * Check a Pyth API key typed or pasted by a user.
 * An empty answer means "skip". We cannot verify a key offline, only catch obvious paste mistakes.
 */
export function validatePythKey(raw) {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, value: null };
  if (/\s/.test(value)) return { ok: false, error: "A Pyth API key has no spaces. Check what you pasted." };
  if (value.length < 8) return { ok: false, error: "That looks too short to be a Pyth API key." };
  if (/^(https?:|0x)/i.test(value)) return { ok: false, error: "That looks like a URL or address, not an API key." };
  return { ok: true, value };
}

/** The current uncommented value of `KEY` in .env-style text, or undefined when it is not set. */
export function readEnvValue(content, key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(content);
  return match ? match[1] : undefined;
}
