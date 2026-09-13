# MabelTV state database

## Authority boundary

Production uses `/var/lib/mabeltv/mabeltv.db` as the sole authority for
structured mutable application state. The Python Library service and native Qt
player share it. Production code does not fall back to, dual-write or silently
recreate the retired JSON stores.

The original JSON files remain immutable migration evidence and rollback input.
Secrets, OAuth/API credentials, LG pairing data, Matter fabric data, media,
artwork, generated indexes, operational transfer journals, logs and device
configuration stay outside SQLite.

Tests and migration tooling must pass an explicit temporary database. Production
defaults to `/var/lib/mabeltv/mabeltv.db`. Physical owner recovery calls
`mabeltv-state-migrate reset-owner`, exports the current owner record before
clearing it transactionally, and never treats retained `owner.json` as live.

## Schema ownership and identities

`database_schema.py` is the only schema and migration owner. `database.py`
owns connections, transactions, relational projections and repository
operations. Schema version 7 contains these main relationships:

- channels and favourites: `channels`, `channel_metadata`,
  `channel_favourites`, `programme_favourites` and `channel_metadata_state`;
- settings/auth/runtime aggregates: `application_settings`, `owner_fields` and
  `player_fields`;
- MabelTV history: `viewing_sessions` plus source attributes;
- local Adult media: `local_media`, `adult_series`, `adult_seasons` and their
  episode rows;
- provider identity and descriptive metadata: `external_titles`, with
  `local_title_links` and `adult_series_title_links` linking local media;
- Adult viewing state: `adult_titles`, `title_watch_events`, `watchlist_entries`,
  `up_next_entries`, `title_ratings` and `title_episode_state`;
- discovery/availability/insights: `explore_feedback`, `availability_cache`,
  `adult_viewing_state`, `adult_insights_titles`, `adult_insights_failures` and
  `adult_insights_state`;
- operations and cache coherency: `schema_migrations`, `imports` and
  `state_revisions`.

Stable external identities are `(media_type, tmdb_id)`. Local film identity is
its existing media-root-relative path plus its preserved `library_id`. Episode
paths are qualified by series ID, so identical season/episode filenames in two
series cannot collide. `local_media.series_id` is a foreign key to
`adult_series`. Explicit link tables connect local items to TMDB titles;
provider IDs are not inferred only from opaque metadata JSON.

Flexible upstream payloads and unknown imported fields remain in checked JSON
columns where normalizing them would lose data. They are extensions to a
relational owner, not an alternate store.

Descriptive title metadata has one relational owner in `external_titles`.
`adult_titles` owns only personal viewing state and cannot exist without its
external title. Watchlist membership, Up Next order and personal ratings each
have exactly one physical owner in their dedicated child tables. The retired
duplicate relationship columns were removed in schema 5, duplicate title
metadata columns in schema 6, and schema 7 rejects retired setting values.
Reads reconstruct the established API
dictionary shape from joins so the public API contract does not change.
Explicit `false` membership flags and timestamps or ranks left behind by a
former Watchlist/Up Next membership normalize to absence. Upgrade and JSON
import reports count each such normalization. Before retiring schema 1/2
duplicate columns, the upgrader proves that every explicit positive value and
its metadata agree with the canonical child row; it aborts on any conflict.

## Transaction and revision rules

Connections enable foreign keys, WAL mode and a bounded busy timeout. Writers
use `BEGIN IMMEDIATE`. Related state, relationship changes and their
`state_revisions` increment commit together.

Use targeted repository operations for hot or independently mutable state:
field-level settings merges, channel insert/update/delete, selected Adult title
updates, availability and Explore feedback. Whole-aggregate replacement remains
valid for a single-writer coherent snapshot such as player runtime state, but it
must still commit atomically with its revision. Never implement a cross-process
read/modify/write operation solely under a Python mutex.

Channel renumbering updates the channel, channel/programme metadata, favourites
and disabled settings in one transaction. Foreign keys cascade channel
favourites. A uniqueness or validation failure rolls the complete mutation
back. Local/series, viewing and Insights writers upsert changed rows and delete
only rows absent from the submitted authoritative aggregate. Stable rows retain
their identity; writers do not clear and rebuild whole tables.

The revision domains are `library`, `adult_viewing`, `viewing_insights`,
`adult_insights`, `settings`, `identity` and `player`. Portal snapshots may paint
only after authentication and only when their stored revision matches the
bootstrap ledger. Rebuildable caches never advance or become authoritative.

## Version compatibility

Migrations are append-only and checksummed. Never edit a released migration;
add the next integer migration and update both Python and native maximum/minimum
support in the same release. The current native release accepts schema 7 only,
preventing an old binary from writing a database whose invariants it does not
understand. Cross-language tests enforce the version match.

Upgrade validation requires `PRAGMA integrity_check`,
`PRAGMA foreign_key_check`, schema/checksum verification and focused semantic
checks. Migration success means the reconstructed records and fields match the
source after its reported semantic normalisations, not merely that SQL
completed.

## Initial migration evidence and retirement policy

`mabeltv-state-migrate import` creates a new candidate database, refuses to
overwrite an existing target, imports copies of the ten historical JSON stores,
reconstructs each document for deterministic comparison, records source hashes
and explicit source normalisations, and runs integrity/foreign-key checks before
atomic publication. Retired setting names and values are translated at this
boundary; database triggers prevent the retired `parent_pin`, `crt_effect`,
`portal_theme`, `portal_design` and `portal_palette` keys from later becoming
authoritative. Portal Experience appearance is a device-local preference owned
by `experience-theme.js`. Retained source JSON may be removed only
after an explicit retention decision and verified
backups; production code must never regain a compatibility read or dual-write.

Operational JSON under `.incoming` (including `.incoming/.usb-imports`) and
`.recycle-bin` remains a durable filesystem journal because it coordinates files
that exist outside the database. It must be written atomically. Disaster backups
exclude these journals with their associated media; after a total-device restore,
an interrupted transfer is restarted from its original source.

## Backup, restore and rollback

Never copy `mabeltv.db` directly while services are active and never back up
only the main file without WAL state. Use SQLite's online backup API through
`mabeltv-state-migrate backup`, then validate the snapshot's integrity, foreign
keys and schema. Package that snapshot with secrets/device configuration,
a manifest and checksums.

A fresh restore installs a compatible Git release, restores secrets and device
configuration with restrictive ownership, restores the validated database
snapshot while services are stopped, copies media separately, then starts the
Library and native services and checks schema, integrity, foreign keys, HTTP,
service restart counts and representative personal state.

Before a production schema upgrade, create and verify an online backup and
record the active release. Before the new release is proven, rollback means stop
both database clients, restore the pre-upgrade database snapshot atomically,
point `/opt/mabeltv/current` at the matching prior release, restart and re-run
health/integrity checks. Reverting code alone after a schema upgrade is unsafe.
