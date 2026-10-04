import net from "node:net";

/** True when something is already listening on the port. */
export function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Poll until `check()` is truthy or the timeout passes. Resolves true on success, false on timeout. */
export async function waitFor(check, { timeoutMs = 60_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Prefix every line of a text chunk so output from several processes stays readable. */
export function prefixLines(prefix, text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => `${prefix} ${line}`)
    .join("\n");
}
