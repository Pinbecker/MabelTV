import net from "node:net";

const DEFAULT_SOCKET = "/run/mabeltv/portal-control.sock";

export function sendTvCommand(command, {
  socketPath = process.env.MABELTV_CONTROL_SOCKET || DEFAULT_SOCKET,
  timeoutMs = 3000,
} = {}) {
  if (!command || command.includes("\n")) {
    return Promise.reject(new Error("Invalid TV control command"));
  }
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ path: socketPath });
    let reply = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) reject(error);
      else resolve(reply.trim());
    };
    client.setTimeout(timeoutMs);
    client.on("connect", () => client.write(`${command}\n`));
    client.on("data", chunk => {
      reply += chunk.toString("utf8");
      if (reply.includes("\n")) finish();
    });
    client.on("end", finish);
    client.on("timeout", () => finish(new Error("TV control socket timed out")));
    client.on("error", finish);
  });
}

export async function setConnectedTvPower(on, options) {
  const reply = await sendTvCommand(on ? "turn-on-tv-only" : "turn-off-tv-only", options);
  if (reply !== "ok") throw new Error(`TV rejected the ${on ? "ON" : "OFF"} command`);
}

export async function getConnectedTvPower(options) {
  const reply = await sendTvCommand("status", options);
  let status;
  try { status = JSON.parse(reply); } catch (error) {
    throw new Error("MabelTV returned invalid status JSON", { cause: error });
  }
  const value = String(status.connected_tv_power || "").toLowerCase();
  if (value === "on") return true;
  if (value === "off" || value === "standby") return false;
  throw new Error("MabelTV status did not include connected TV power");
}
