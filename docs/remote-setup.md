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

It should list `/sys/class/rc/rc0` and a `gpio_ir_recv` driver. If not, recheck all three wires and confirm this line exists in `/boot/firmware/config.txt`:

```text
dtoverlay=gpio-ir,gpio_pin=18
```

## Learn the supplied remote

Stop the TV service so it does not consume test key presses, then launch the mapper:

```bash
sudo systemctl stop mabeltv.service
sudo mabeltv-map-remote
```

The mapper asks for the essential buttons first, then optional navigation-pad, random/source and digit buttons. Point the EZClicker at the KY-022 rather than the television, press each requested button once, and use `S` to skip an optional button that the remote does not have. It saves `/etc/rc_keymaps/mabeltv.toml`, loads it immediately, and enables `mabeltv-ir.service` for later boots.

Test the resulting Linux keys:

```bash
sudo ir-keytable -s rc0 -t
```

The normal mapping is deliberately simple:

| Physical function | Linux/Qt key | Mabel TV action |
| --- | --- | --- |
| Channel + / - | Page Up / Page Down | next / previous channel |
| Volume + / - | Equal / Minus | louder / quieter |
| Mute | M | mute; hold three seconds to lock or unlock the remote |
| Previous / Back | B | previous channel; hold for parent confirmation |
| Power | P | standby / welcome-screen wake; hold five seconds for shutdown |
| OK | Enter | another random programme; confirm channel number or parent access |
| Navigation Up / Down | Up / Down | next / previous channel; navigate the parent panel |
| Navigation Left / Right | Left / Right | previous / next episode or film; adjust parent settings |
| 0–9 | 0–9 | direct channel entry |
| Source or spare button | R | random episode |

Start Mabel TV again with `sudo systemctl start mabeltv.service`.

One-shot actions (digits, mute, random, standby, parent access and shutdown) ignore Linux auto-repeat events. Channel and volume holds are allowed but rate-limited, so a noisy receiver or a long press cannot generate an uncontrolled burst of actions. While the remote is locked, every button except the three-second Mute hold is ignored; a small on-screen label remains as a reminder.

## TV interaction

The EZClicker is sold as a Samsung IR remote while the target television is LG, so its TV-directed codes would not normally match the LG receiver. That cannot be guaranteed for every LG model: test every button while the Pi is off before child use. The Pi boot setup also disables HDMI-CEC, so Mabel TV itself does not send power, input-switch, volume, or active-source commands through HDMI.

If an IR button still operates the LG television, do not use that button in the mapper. Choose a harmless spare button for the Mabel TV action, or physically position/shroud the KY-022 so the remote can be aimed away from the TV's receiver.
