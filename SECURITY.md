# Security policy

## Supported versions

Only the most recent signed Mabel TV release and its immediate rollback release receive security fixes. Development snapshots and dirty-tree bundles are unsupported.

## Deployment boundary

Mabel TV is a home-LAN appliance. Port 8080 and SSH must not be forwarded to the public internet. Use trusted Wi-Fi, a strong Raspberry Pi login password, current Raspberry Pi OS security updates, and a browser PIN children cannot guess.

The dashboard uses HTTP because consumer `.local` TLS without a trusted local certificate creates confusing certificate warnings. Its compensating controls are a one-time physical setup code, salted PBKDF2 PIN verifier, throttled login, expiring/revocable cookies, same-origin mutation checks, strict browser headers, unprivileged service account, fixed root helper allow-list, and systemd sandbox/resource limits. This is not a substitute for an untrusted/public network design.

## Reporting a vulnerability

Do not open a public issue containing an exploit, setup code, support bundle, private IP address, or owner filename. Contact the distributor’s published private security address with:

- affected version and build-manifest commit;
- Pi/OS model;
- reproducible steps and impact;
- the smallest redacted logs needed to demonstrate it.

The distributor should acknowledge within three business days, give an initial assessment within ten business days, coordinate disclosure, and publish fixed binaries plus corresponding source.

## Secrets and support bundles

Mabel TV never intentionally adds the browser PIN, its plaintext equivalent, or video contents to a support bundle. Bundles can contain device/network/system details and media filenames from errors or compatibility reports. Owners should review them before sharing.
