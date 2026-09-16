#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { DeviceTypeId, Endpoint, Environment, Logger, ServerNode, VendorId } from "@matter/main";
import { OnOffPlugInUnitDevice } from "@matter/main/devices";
import { getConnectedTvPower, setConnectedTvPower } from "./mabeltv-tv-power-socket.mjs";

const logger = Logger.get("MabelTvConnectedTvMatter");
const pairingPath = process.env.MABELTV_TV_MATTER_PAIRING_PATH || "/var/lib/mabeltv/matter-tv/pairing.json";
const basePasscode = Number(process.env.MABELTV_MATTER_PASSCODE || 0);
const passcode = requiredInteger("MABELTV_TV_MATTER_PASSCODE", 1, 99_999_998,
  basePasscode > 0 ? (basePasscode % 99_999_998) + 1 : undefined);
const discriminator = requiredInteger("MABELTV_TV_MATTER_DISCRIMINATOR", 0, 4095,
  process.env.MABELTV_MATTER_DISCRIMINATOR === undefined
    ? undefined : (Number(process.env.MABELTV_MATTER_DISCRIMINATOR) + 1) % 4096);
const port = optionalInteger("MABELTV_TV_MATTER_PORT", 5541, 1, 65535);
Environment.default.vars.set("log.level", process.env.MABELTV_MATTER_LOG_LEVEL || "warn");
Logger.level = process.env.MABELTV_MATTER_LOG_LEVEL || "warn";

const initialPower = await getConnectedTvPower();
const server = await ServerNode.create({
  id: "mabel-tv-screen",
  network: { port, ble: false, discoveryCapabilities: { onIpNetwork: true, ble: false } },
  commissioning: { passcode, discriminator },
  productDescription: { name: "TV", deviceType: DeviceTypeId(OnOffPlugInUnitDevice.deviceType) },
  basicInformation: {
    vendorName: "MabelTV", vendorId: VendorId(0xfff1), nodeLabel: "TV",
    productName: "TV", productLabel: "TV", productId: 0x8001,
    hardwareVersion: 1, hardwareVersionString: "Connected television",
    softwareVersion: 1, softwareVersionString: "0.1.0",
    serialNumber: "mabeltv-connected-tv-1", uniqueId: "mabeltv-connected-tv-node-1",
  },
});
const powerEndpoint = new Endpoint(OnOffPlugInUnitDevice, { id: "connected-tv-power" });
await server.add(powerEndpoint);
let syncing = true;
let suppressPollingUntil = 0;
await powerEndpoint.set({ onOff: { onOff: initialPower } });
syncing = false;
powerEndpoint.events.onOff.onOff$Changed.on(async value => {
  if (syncing) return;
  suppressPollingUntil = Date.now() + 2000;
  try { await setConnectedTvPower(value); }
  catch (error) { logger.error(`TV ${value ? "ON" : "OFF"} failed`, error); throw error; }
});
const pollTimer = setInterval(async () => {
  if (syncing || Date.now() < suppressPollingUntil) return;
  try {
    const actual = await getConnectedTvPower();
    if (actual === powerEndpoint.state.onOff.onOff) return;
    syncing = true;
    await powerEndpoint.set({ onOff: { onOff: actual } });
  } catch (error) { logger.warn("Could not refresh connected TV power", error); }
  finally { syncing = false; }
}, 3000);
pollTimer.unref();
await writePairingDetails(server);
logger.info(`Connected TV Matter bridge ready; initial state is ${initialPower ? "ON" : "OFF"}`);
try { await server.run(); } finally { clearInterval(pollTimer); }

function requiredInteger(name, minimum, maximum, fallback) {
  const raw = process.env[name] || (fallback === undefined ? "" : String(fallback));
  if (!raw || !/^\d+$/.test(raw)) throw new Error(`${name} is required and must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is invalid`);
  return value;
}
function optionalInteger(name, fallback, minimum, maximum) {
  if (process.env[name] === undefined) return fallback;
  return requiredInteger(name, minimum, maximum);
}
async function writePairingDetails(node) {
  const details = { device: "TV", manualPairingCode: node.state.commissioning.pairingCodes.manualPairingCode,
    qrPairingCode: node.state.commissioning.pairingCodes.qrPairingCode };
  await fs.mkdir(path.dirname(pairingPath), { recursive: true, mode: 0o750 });
  const temporary = `${pairingPath}.${process.pid}.new`;
  await fs.writeFile(temporary, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(temporary, pairingPath);
}
