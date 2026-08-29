# Local Alexa control with Matter

MabelTV exposes one private, local Matter on/off accessory named **Mabel TV**.
It talks to the player through `/run/mabeltv/portal-control.sock`, so Alexa,
the kids' remote, and the portal all use the same `TvController` standby path.
No Alexa skill, cloud webhook, or Raspberry Pi shutdown command is involved.

## Pair with Alexa

The Raspberry Pi and a Matter-capable Echo must be on the same normal home
network. Do not use an isolated guest network. MabelTV is already connected to
Wi-Fi, so it uses Matter's on-network commissioning mode and does not ask Alexa
to provision or replace the Pi's Wi-Fi connection.

1. On a computer connected to the Pi, display the private setup code:

   ```bash
   ssh pinbecker@192.168.0.27
   sudo mabeltv-alexa-pairing
   ```

2. In the Alexa app, open **Devices**.
3. Tap **+**, then **Add Device**.
4. Choose **Other**, then **Matter**, and confirm that the device has a Matter
   logo.
5. Scan the QR code shown in the SSH terminal. If scanning a terminal is
   awkward, choose the manual-code option and enter the displayed setup code.
6. If Alexa warns that the accessory is not certified, choose the option to
   continue. This personal matter.js accessory uses Matter's development
   credentials and is intentionally not a commercial certified product.
7. Allow Alexa to finish adding it, then keep or set the device name to
   **Mabel TV**.
8. Test: **“Alexa, turn on Mabel TV”** and **“Alexa, turn off Mabel TV.”**

Pairing secrets are stored locally in `/etc/mabeltv/matter.conf` and the
Matter fabric is stored in `/var/lib/mabeltv/matter`. Do not publish either.

## Operation and diagnostics

```bash
systemctl status mabeltv-matter.service --no-pager
journalctl -u mabeltv-matter.service -b --no-pager -n 100
sudo mabeltv-alexa-pairing
```

Matter commissioning uses IPv6 link-local traffic and multicast DNS on the
existing home network. Bluetooth proximity is not involved. The Echo and Pi
must be on the same LAN, with client isolation and multicast filtering disabled.

The boot setting `hdmi_ignore_cec_init=1` remains intentional: it prevents an
ordinary Pi boot from unexpectedly waking the television. It does not disable
runtime CEC. Matter ON reaches `TvController::turnOn()`, which wakes the LG TV
and selects the Pi source; Matter OFF reaches `TvController::turnOff()`, which
places MabelTV and the TV in standby while the Pi keeps running.

If the local player socket or CEC command fails, the Matter service logs the
error. CEC failures remain non-fatal to MabelTV's own standby state, just as
they are for the kids' remote and portal.
