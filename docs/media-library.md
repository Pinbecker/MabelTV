# Mabel TV Library

The Mabel TV Library is the simple way to add programmes after the appliance
has been installed. It is only for devices connected to the same home network
as the Raspberry Pi; it is not exposed to the internet.

Open the address printed by the installer, normally:

```text
http://Mabel-TV.local:8080
```

Enter the parent PIN (`0973` unless an owner has changed it), choose the
channel, choose a video, and select **Upload & publish**. Keep the browser page
open until the progress bar completes. An interrupted upload is kept in a safe
inbox and resumes when the same file is selected again.

Files are validated before being moved into the live media folder. Once a file
is published, the television refreshes its library. This briefly restarts the
player so it can see the new programme; media is never deleted or partially
published during this step.

## Library controls

The same page can enable or disable whole channels and individual programmes,
rename programme labels, and move videos into a recycle bin. Restore returns a
video to its original channel. **Delete forever** only removes items already in
that recycle bin.

## Safety and recovery

Every appliance update creates a timestamped configuration snapshot under
`/var/backups/mabeltv/` before it changes services or settings. The existing
release rollback remains the quickest recovery path:

```sh
sudo mabeltv-rollback
```

When rolling back to a release older than the Library feature, the rollback
script automatically stops the Library service as well, leaving the previous
working TV appliance intact.
