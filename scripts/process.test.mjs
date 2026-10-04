import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { isPortOpen, prefixLines, waitFor } from "./lib/process.mjs";

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("isPortOpen sees a listening port and a closed one", async () => {
  const server = await listen();
  const { port } = server.address();
  assert.equal(await isPortOpen(port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isPortOpen(port), false);
});

test("waitFor resolves once the check passes, and false on timeout", async () => {
  let calls = 0;
  assert.equal(await waitFor(() => ++calls >= 3, { timeoutMs: 2000, intervalMs: 10 }), true);
  assert.equal(await waitFor(() => false, { timeoutMs: 60, intervalMs: 10 }), false);
});

test("prefixLines labels each non-empty line", () => {
  assert.equal(prefixLines("[web]", "one\n\ntwo\r\n"), "[web] one\n[web] two");
});
