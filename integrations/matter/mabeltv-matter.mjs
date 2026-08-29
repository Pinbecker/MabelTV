#!/usr/bin/env node

import "@matter/nodejs-ble";

import fs from "node:fs/promises";
import path from "node:path";
import {
  DeviceTypeId,
  Endpoint,
  Environment,
  Logger,
  ServerNode,
  VendorId,
} from "@matter/main";
import { OnOffPlugInUnitDevice } from "@matter/main/devices";

import { getMabelTvPower, setMabelTvPower } from "./mabeltv-power-socket.mjs";

const logger = Logger.get("MabelTvMatter");
const pairingPath = process.env.MABELTV_MATTER_PAIRING_PATH
  || "/var/lib/mabeltv/matter/pairing.json";
const passcode = requiredInteger("MABELTV_MATTER_PASSCODE", 1, 99_999_998);
const discriminator = requiredInteger("MABELTV_MATTER_DISCRIMINATOR", 0, 4095);
const port = optionalInteger("MABELTV_MATTER_PORT", 5540, 1, 65535);

Environment.default.vars.set("ble.enable", true);
// Matter's NOTICE-level commissioning banner includes the setup passcode. The
// root-only pairing helper is the deliberate place to reveal that secret.
Environment.default.vars.set("log.level", process.env.MABELTV_MATTER_LOG_LEVEL || "warn");
Logger.level = process.env.MABELTV_MATTER_LOG_LEVEL || "warn";

const initialPower = await getMabelTvPower();
const server = await ServerNode.create({
  id: "mabel-tv",
  network: { port },
  commissioning: { passcode, discriminator },
  productDescription: {
    name: "Mabel TV",
    deviceType: DeviceTypeId(OnOffPlugInUnitDevice.deviceType),
  },
  basicInformation: {
    vendorName: "MabelTV",
    vendorId: VendorId(0xfff1),
    nodeLabel: "Mabel TV",
    productName: "Mabel TV",
    productLabel: "Mabel TV",
    productId: 0x8000,
    hardwareVersion: 1,
    hardwareVersionString: "Raspberry Pi 4",
    softwareVersion: 1,
    softwareVersionString: "0.1.0",
    serialNumber: "mabeltv-pi4-personal-1",
    uniqueId: "mabeltv-personal-1",
  },
});

const powerEndpoint = new Endpoint(OnOffPlugInUnitDevice, { id: "mabeltv-power" });
await server.add(powerEndpoint);

let syncingFromPlayer = true;
let suppressPollingUntil = 0;
await powerEndpoint.set({ onOff: { onOff: initialPower } });
syncingFromPlayer = false;

powerEndpoint.events.onOff.onOff$Changed.on(async value => {
  if (syncingFromPlayer) return;
  suppressPollingUntil = Date.now() + 2000;
  logger.info(`Alexa requested MabelTV ${value ? "ON" : "OFF"}`);
  try {
    await setMabelTvPower(value);
  } catch (error) {
    logger.error(`MabelTV ${value ? "ON" : "OFF"} failed`, error);
    throw error;
  }
});

const pollTimer = setInterval(async () => {
  if (syncingFromPlayer || Date.now() < suppressPollingUntil) return;
  try {
    const actualPower = await getMabelTvPower();
    if (actualPower === powerEndpoint.state.onOff.onOff) return;
    syncingFromPlayer = true;
    await powerEndpoint.set({ onOff: { onOff: actualPower } });
    logger.info(`Matter state synchronised from MabelTV: ${actualPower ? "ON" : "OFF"}`);
  } catch (error) {
    logger.warn("Could not refresh MabelTV power state", error);
  } finally {
    syncingFromPlayer = false;
  }
}, 3000);
pollTimer.unref();

await writePairingDetails(server);
logger.info(`MabelTV Matter bridge ready; initial state is ${initialPower ? "ON" : "OFF"}`);
await server.run();

function requiredInteger(name, minimum, maximum) {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`${name} is required and must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalInteger(name, fallback, minimum, maximum) {
  if (process.env[name] === undefined) return fallback;
  const raw = process.env[name];
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

async function writePairingDetails(node) {
  const codes = node.state.commissioning.pairingCodes;
  const details = {
    device: "Mabel TV",
    manualPairingCode: codes.manualPairingCode,
    qrPairingCode: codes.qrPairingCode,
  };
  await fs.mkdir(path.dirname(pairingPath), { recursive: true, mode: 0o750 });
  const temporary = `${pairingPath}.${process.pid}.new`;
  await fs.writeFile(temporary, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(temporary, pairingPath);
  logger.info(`Pairing details written to ${pairingPath}`);
}
