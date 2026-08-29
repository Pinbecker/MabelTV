import net from "node:net";

const DEFAULT_SOCKET = "/run/mabeltv/portal-control.sock";
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_REPLY_BYTES = 16 * 1024;

export function sendPlayerCommand(
    command,
    { socketPath = process.env.MABELTV_CONTROL_SOCKET || DEFAULT_SOCKET,
      timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!command || command.includes("\n")) {
    return Promise.reject(new Error("Invalid MabelTV control command"));
  }

  return new Promise((resolve, reject) => {
    const client = net.createConnection({ path: socketPath });
    const chunks = [];
    let replyBytes = 0;
    let settled = false;

    const finish = (error, reply = "") => {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) reject(error);
      else resolve(reply.trim());
    };

    client.setTimeout(timeoutMs);
    client.on("connect", () => client.write(`${command}\n`));
    client.on("data", chunk => {
      replyBytes += chunk.length;
      if (replyBytes > MAX_REPLY_BYTES) {
        finish(new Error("MabelTV control reply was unexpectedly large"));
        return;
      }
      chunks.push(chunk);
      if (chunk.includes(0x0a)) {
        finish(undefined, Buffer.concat(chunks).toString("utf8"));
      }
    });
    client.on("end", () => finish(undefined, Buffer.concat(chunks).toString("utf8")));
    client.on("timeout", () => finish(new Error("MabelTV control socket timed out")));
    client.on("error", error => finish(error));
  });
}

export async function setMabelTvPower(on, options) {
  const reply = await sendPlayerCommand(on ? "turn-on" : "turn-off", options);
  if (reply !== "ok") {
    throw new Error(`MabelTV rejected the ${on ? "ON" : "OFF"} command: ${reply || "empty reply"}`);
  }
}

export async function getMabelTvPower(options) {
  const reply = await sendPlayerCommand("status", options);
  let status;
  try {
    status = JSON.parse(reply);
  } catch (error) {
    throw new Error("MabelTV returned invalid status JSON", { cause: error });
  }
  if (typeof status.standby !== "boolean") {
    throw new Error("MabelTV status did not include standby state");
  }
  return !status.standby;
}
