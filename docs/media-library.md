# Browser dashboard and media library

Mabel TV’s browser dashboard is the normal grown-up entry point after installation. It runs only on the Raspberry Pi and listens on the home network; it is not a cloud service.

Open the address shown on the TV, normally:

```text
http://mabeltv.local:8080
```

If `.local` discovery is blocked by the router or phone, use the numeric IP address shown directly underneath it on the welcome screen.

## First setup and security

A fresh installation has no universal PIN. The installer generates a one-time six-digit code stored in a root-controlled configuration file. The TV shows that code beside the QR/address. Setup then requires a new 4–8 digit browser PIN.

- The PIN is stored as a salted PBKDF2-HMAC-SHA256 hash, not plaintext.
- Five failed attempts in five minutes temporarily lock further attempts from that address.
- Sessions expire after eight hours and are revoked by **Lock** or a PIN change.
- Browser mutations require the same network origin and cookies use `HttpOnly` and `SameSite=Strict`.
- Security headers prevent framing, MIME sniffing, referrer leakage, and unapproved script/resource origins.

HTTP is intentionally local-network-only. Never forward port 8080 through a router or expose it to the internet. Use trusted home Wi-Fi.

## Dashboard sections

### Overview

Shows player state, Pi temperature, storage, uptime, version, current thermal/power limiting, historical limiting since boot, and plain-language warnings. Quick actions add media, manage channels, or request a background TV refresh.

### Add media

One or several files can be selected together, and reopening the picker adds to a visible list instead of replacing the earlier choice. This supports phone pickers that offer only one video at a time. Items can be removed before upload. The browser transfers a batch sequentially so Raspberry Pi and Wi-Fi load stay predictable, while completed transfers enter the persistent background preparation queue. Uploads are split into durable 8 MiB parts. A retry asks the Pi for its saved offset instead of restarting. Mabel TV reserves enough room for source plus prepared output and 512 MiB safety space before accepting each file.

The final check uses a 30-second probe deadline:

- ordinary prepared videos publish atomically without conversion;
- video over 30 fps, or an oversized iPhone MOV, enters one persistent background conversion queue;
- the queue survives a Library service restart and permits only one encoder at once;
- conversion uses one thread, 720p/30 fps H.264/AAC, pauses at 78°C, and resumes at 72°C;
- the browser can be closed during preparation; choosing the same source file later resumes/checks it.

The TV keeps playing while a new library is validated in a worker thread. The checked library replaces the old one only when complete; an invalid update leaves the known-good channels on screen.

### Channels

Create, rename, renumber, hide/show, change crop/fit/stretch mode, choose **Shows / episodes** or **Films / long videos**, and delete an empty channel. Programme controls can hide/show, rename, move to recycle bin, restore, or permanently delete. Film and long-video channels are always exempt from episode inactivity resets.

Deletion is deliberately two-stage. Recycle-bin items expire after 30 days; this is shown in the interface.

### Help & system

Shows detailed status, changes the browser PIN, restarts the TV player, creates/downloads a redacted support bundle, and safely reboots or shuts down the Pi. Disruptive actions require confirmation.

The on-TV adult panel remains the quickest place to tune CRT appearance, sound, volume policy, display mode, playback behaviour, and remote lock. Hold Back/Previous for 3.5 seconds, then press OK three times. That physical shortcut is separate from the browser PIN.

## File naming

For series, use names such as:

```text
S01E02 - The Picnic.mp4
```

Mabel TV displays that as `S01 E02 · The Picnic`. Films and home videos can use any clear filename supported by the filesystem.

Supported containers are MP4, M4V, MKV, MOV, WebM, AVI, MPG, and MPEG. H.264/AAC at SD or 720p is the safest ready-to-play format for Pi 4.
