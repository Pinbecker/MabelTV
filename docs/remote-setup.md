# KY-022 and EZClicker remote setup

Mabel TV uses the Linux kernel's `gpio-ir` receiver and rc-core input path. Once mapped, remote presses arrive as normal keyboard events. No LIRC daemon and no Samsung TV control software are used.

## Wiring

Power the Pi off and disconnect it before touching the 40-pin header.

| KY-022 label | Raspberry Pi connection | Header pin |
| --- | --- | --- |
| `S` / signal | BCM GPIO 18 | physical pin 12 |
| `+` / VCC | 3.3 V | physical pin 1 |
| `-` / GND | ground | physical pin 6 |

Do not connect the module's VCC to 5 V. Check the labels printed on the actual module: some clone boards place the three pins in a different physical order even though their `S`, `+`, and `-` meaning is the same.

## Confirm the receiver

After `configure-boot.sh` and a reboot:

```bash
ir-keytable
```

It should list one rc device with the Name and Driver `gpio_ir_recv`; its number may vary between boots. If it is absent, recheck all three wires and confirm this line exists in `/boot/firmware/config.txt`:

```text
dtoverlay=gpio-ir,gpio_pin=18
```

## Learn the supplied remote

Stop the TV service so it does not consume test key presses, then launch the mapper:

```bash
sudo systemctl stop mabeltv.service
sudo mabeltv-map-remote
```

The mapper asks for the essential buttons first, then optional navigation-pad, random/source and digit buttons. Point the EZClicker at the KY-022 rather than the television, press each requested button once, and use `S` to skip an optional button that the remote does not have. It automatically finds the `gpio_ir_recv` device, saves `/etc/rc_keymaps/mabeltv.toml`, loads it immediately, and enables `mabeltv-ir.service` for later boots. The rc-core number is deliberately not fixed because HDMI CEC receivers can take `rc0` or `rc1` depending on boot order.

Test the resulting Linux keys:

```bash
sudo ir-keytable
# Use the rc number whose Name and Driver are gpio_ir_recv, for example:
sudo ir-keytable -s rc2 -t
```

The normal mapping is deliberately simple:

| Physical function | Linux/Qt key | Mabel TV action |
| --- | --- | --- |
| Channel + / - | Page Up / Page Down | next / previous channel |
| Volume + / - | Equal / Minus | louder / quieter |
| Mute | M | mute; hold three seconds to lock or unlock the remote |
| Previous / Back | B | previous channel; hold for parent confirmation |
| Power | P | MabelTV + TV standby / wake; wake also selects the Pi HDMI input |
| OK | Enter | pause / play; confirm channel number or parent access |
| Navigation Up / Down | Up / Down | next / previous channel; navigate the parent panel |
| Navigation Left / Right | Left / Right | previous / next episode or film; adjust parent settings |
| Home | Home | hold to open the current channel's episode or film list |
| 0–9 | 0–9 | direct channel entry |
| Source or spare button | R | random episode |

Start Mabel TV again with `sudo systemctl start mabeltv.service`.

When the optional TV guide is enabled in the browser dashboard, hold **OK / Select**
for 3.5 seconds to open it. A normal short OK press still pauses, plays, or confirms
a channel number. In the guide, use Up/Down or Channel +/− to choose a channel,
press OK to watch it, and press Back to close the guide.

One-shot actions (digits, pause/play, mute, random, standby and parent access) ignore Linux auto-repeat events. Channel and volume holds are allowed but rate-limited, so a noisy receiver or a long press cannot generate an uncontrolled burst of actions. The Power button never shuts down the Raspberry Pi. While the remote is locked, every button except the three-second Mute hold is ignored; a small on-screen label remains as a reminder.

Left/Right navigation normally resumes the saved position for each individual programme. In Parent Control, **Reset unvisited episodes** can be set to Off, 5 minutes, 20 minutes, 1 hour, or 3 hours. In Resume mode, a partly watched show restarts when it is next selected after that much inactivity during the current Mabel TV uptime. Time while the player is stopped never counts, and channels marked **Films / long videos** are never reset. A one-off deliberate restart remains available by holding Back and then pressing Left, Right, OK on the confirmation screen.

## TV interaction

The EZClicker is sold as a Samsung IR remote while the target television may be another brand, so its TV-directed codes should not be relied upon. MabelTV instead uses HDMI-CEC through the Pi: an explicit ON wakes the TV and announces the Pi as the active source; OFF sends TV standby. It never sends a CEC toggle and never shuts down the Pi. The installer provides `cec-client` through Debian's `cec-utils` package, and the `mabeltv` service accesses the connected `/dev/cec*` device through its existing `video` group membership without sudo.

Enable the television manufacturer's HDMI-CEC setting (LG calls it **SIMPLINK**). MabelTV automatically chooses the Pi 4 HDMI connector with a valid CEC physical address. `MABELTV_CEC_DEVICE=/dev/cec1` can override that detection for unusual hardware.

If an IR button still operates the LG television, do not use that button in the mapper. Choose a harmless spare button for the Mabel TV action, or physically position/shroud the KY-022 so the remote can be aimed away from the TV's receiver.
