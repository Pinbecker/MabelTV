# MabelTV state database

## Authority boundary

Production uses `/var/lib/mabeltv/mabeltv.db` as the sole authority for
structured mutable application state. The library service and native player
both read and write that database. They do not fall back to the pre-migration
JSON files and do not dual-write JSON projections.

The original JSON files are retained unchanged as migration evidence and as an
immediate rollback snapshot. They are not live compatibility stores. Secrets,
Matter data, LG pairing data, media, artwork, generated media indexes, upload
work files, logs, and device configuration remain outside SQLite.

`MABELTV_DATABASE` and the Library service's `--database` option may select an
isolated database for development, migration and tests. Production defaults to
`/var/lib/mabeltv/mabeltv.db`. Tests must always supply a temporary database and
temporary media/cache paths; they must never touch `/var/lib`, `/var/cache` or
`/srv`. The launcher's legacy `--channels`, `--settings` and `--state` arguments
remain transitional command-line compatibility inputs, not alternate
authorities.

## Relational ownership

The database owns:

- channels, application settings, owner/authentication fields, and player state;
- viewing sessions and their source attributes;
- channel and programme metadata and favourites;
- Adult TV local-film and series/episode associations;
- title history, watched episode state, watchlist membership, Up Next order,
  ratings, Explore feedback, availability data, and Insights enrichment state.

Stable TMDB identities use `(media_type, tmdb_id)`. Local media keeps its
existing relative path as the stable filesystem identity and preserves its
existing `library_id`. Flexible provider payloads and unknown legacy fields are
kept in JSON columns so migration never discards data.

Every write that replaces one established application document runs in one
`BEGIN IMMEDIATE` transaction. Foreign keys protect title and channel
relationships. Channel renumbering updates the existing row so related
playback timelines follow it through `ON UPDATE CASCADE`. WAL mode permits the
native player and library service to read while the other process commits, and
both clients wait up to five seconds for a writer.

Schema version 2 adds `state_revisions`, a small transactional ledger for the
portal's `library`, `adult_viewing`, `viewing_insights`, and `adult_insights`
cache domains. Each authoritative state write increments its related revision
inside the same transaction. The authenticated `/api/bootstrap` response uses
those counters to validate device-local response snapshots without exposing
application data before authentication.

Read-time reconciliation of local Adult playback progress writes only when the
stored progress differs. An unchanged `GET /api/adult/viewing` is read-only, so
opening the portal cannot invalidate the snapshot it has just validated.

The native player accepts database schemas 1 and 2 because schema 2 is an
additive portal-only extension and does not alter any native-owned table. Its
maximum supported schema must advance with the Python schema version whenever a
future additive migration remains compatible; the cross-language regression
test enforces that release contract.

## Initial migration and proof

`mabeltv-state-migrate import` only creates a new database. It refuses to
overwrite an existing target and imports from copies of all ten legacy stores.
Before publishing the database it reconstructs each legacy document from the
relational rows, compares canonical content and record counts, runs SQLite
integrity and foreign-key checks, records the source hashes and report in the
database, and atomically renames the completed candidate.

The production cutover sequence is:

1. Create and copy off-device a complete pre-migration archive.
2. Build and test the candidate release without changing the active release.
3. Stop the player and library services for the final short snapshot.
4. Import that stopped snapshot to a new candidate database and require an
   exact validation report.
5. Preserve the JSON files, install the candidate release atomically, and start
   both services against the database.
6. Check the active release, service restart counts, HTTP health, SQLite
   integrity, foreign keys, and the hashes of the retained JSON snapshot.

## Rollback

Before cutover, rollback means deleting only the unpublished candidate database
and restarting the existing release; the live JSON stores have not changed.

Immediately after cutover, rollback means stopping both services, preserving a
SQLite online backup, selecting the previous release, and restarting it against
the untouched final JSON snapshot.

If SQLite has accepted newer user activity, first run
`mabeltv-state-migrate export-json` into a new directory. That command recreates
and validates all ten JSON documents without modifying the database or live
files. An operator can then stop the services, archive both forms, install the
validated exported files at their original paths, select the previous release,
and start the services. This is an explicit recovery operation; the production
application never maintains JSON in parallel.

## Schema evolution and backup

SQLite `user_version` and the `schema_migrations` table identify the schema.
Each migration has a version, name, source checksum, and application time. A
release refuses an unsupported version or a mismatched migration checksum.
Future schema changes must be additive migration steps, run on a verified
online backup in a transaction before the new application starts. They must
never rewrite the initial migration definition.

Temporary import, export, comparison or dual-read facilities belong only in the
explicit migration tool and must have a removal point. They must not become an
application fallback path. A release may support more than one database schema
version during a controlled rollout, but every running writer still targets one
authoritative schema and one database.

The installer stops both database users for the short upgrade window, creates
a validated SQLite backup immediately beforehand, and keeps that backup tied
to the release transaction. If any subsequent asset, unit, service, or health
check fails, it restores both the prior release and the exact pre-upgrade
database snapshot before restarting services.

Backups use SQLite's online backup API and validate the resulting snapshot with
`integrity_check` and `foreign_key_check`. Copying only a live `mabeltv.db` file
is prohibited because committed state may also be present in its WAL file.
Disaster-recovery archives also include secrets and device/integration
configuration separately, plus relative-path checksums and the active release
and schema versions.
