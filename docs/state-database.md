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

Backups use SQLite's online backup API and validate the resulting snapshot with
`integrity_check` and `foreign_key_check`. Copying only a live `mabeltv.db` file
is prohibited because committed state may also be present in its WAL file.
Disaster-recovery archives also include secrets and device/integration
configuration separately, plus relative-path checksums and the active release
and schema versions.
