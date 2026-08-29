import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getMabelTvPower, sendPlayerCommand, setMabelTvPower } from "./mabeltv-power-socket.mjs";

async function withSocket(replyForCommand, action) {
  const directory = process.platform === "win32"
    ? undefined
    : fs.mkdtempSync(path.join(os.tmpdir(), "mabeltv-matter-test-"));
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\mabeltv-matter-test-${process.pid}-${Date.now()}-${Math.random()}`
    : path.join(directory, "control.sock");
  const received = [];
  const server = net.createServer(client => {
    let request = "";
    client.on("data", chunk => {
      request += chunk.toString("utf8");
      if (!request.includes("\n")) return;
      const command = request.slice(0, request.indexOf("\n"));
      received.push(command);
      client.end(`${replyForCommand(command)}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    await action({ socketPath, received });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("explicit power commands reuse the MabelTV control socket", async () => {
  await withSocket(() => "ok", async options => {
    await setMabelTvPower(true, options);
    await setMabelTvPower(false, options);
    assert.deepEqual(options.received, ["turn-on", "turn-off"]);
  });
});

test("status maps standby to the Matter on/off state", async () => {
  await withSocket(command => command === "status" ? '{"standby":true}' : "error", async options => {
    assert.equal(await getMabelTvPower(options), false);
    assert.deepEqual(options.received, ["status"]);
  });
});

test("a rejected player command is reported", async () => {
  await withSocket(() => "busy", async options => {
    await assert.rejects(setMabelTvPower(false, options), /rejected the OFF command/);
  });
});

test("status without a standby boolean is rejected", async () => {
  await withSocket(() => '{"playing":true}', async options => {
    await assert.rejects(getMabelTvPower(options), /did not include standby/);
  });
});
