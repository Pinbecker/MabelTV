"""Versioned SQLite schema and forward-only migrations for MabelTV state."""

from __future__ import annotations

import hashlib


SCHEMA_VERSION = 9

SCHEMA = r"""
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    source_manifest_sha256 TEXT NOT NULL,
    imported_at REAL NOT NULL,
    report_json TEXT NOT NULL CHECK(json_valid(report_json))
);
CREATE TABLE IF NOT EXISTS application_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_fields (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE CHECK(number BETWEEN 1 AND 999),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
    folder TEXT NOT NULL UNIQUE CHECK(length(folder) > 0),
    aspect TEXT NOT NULL CHECK(aspect IN ('crop','fit','stretch')),
    content_type TEXT NOT NULL CHECK(content_type IN ('shows','films'))
);
CREATE TABLE IF NOT EXISTS player_fields (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS adult_resume (
    library_id TEXT PRIMARY KEY,
    position_seconds REAL NOT NULL DEFAULT 0 CHECK(position_seconds >= 0),
    duration_seconds REAL NOT NULL DEFAULT 0 CHECK(duration_seconds >= 0),
    updated_utc_ms INTEGER NOT NULL DEFAULT 0,
    position_present INTEGER NOT NULL CHECK(position_present IN (0,1)),
    duration_present INTEGER NOT NULL CHECK(duration_present IN (0,1)),
    updated_present INTEGER NOT NULL CHECK(updated_present IN (0,1))
);
CREATE TABLE IF NOT EXISTS channel_film_resume (
    media_key TEXT PRIMARY KEY,
    position_seconds REAL NOT NULL DEFAULT 0 CHECK(position_seconds >= 0),
    duration_seconds REAL NOT NULL DEFAULT 0 CHECK(duration_seconds >= 0),
    updated_utc_ms INTEGER NOT NULL DEFAULT 0,
    position_present INTEGER NOT NULL CHECK(position_present IN (0,1)),
    duration_present INTEGER NOT NULL CHECK(duration_present IN (0,1)),
    updated_present INTEGER NOT NULL CHECK(updated_present IN (0,1))
);
CREATE TABLE IF NOT EXISTS channel_timelines (
    channel_number INTEGER PRIMARY KEY,
    episode_index INTEGER,
    episode_name TEXT,
    position_seconds REAL NOT NULL DEFAULT 0,
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS channel_programme_positions (
    channel_number INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    position_seconds REAL NOT NULL CHECK(position_seconds >= 0),
    PRIMARY KEY(channel_number, file_name),
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS channel_runtime_entries (
    channel_number INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('last_left','failed')),
    file_name TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY(channel_number, kind, file_name),
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS viewing_tracking (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    tracking_started REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS viewing_sessions (
    id TEXT PRIMARY KEY,
    started REAL,
    ended REAL,
    seconds REAL NOT NULL CHECK(seconds >= 0),
    surface TEXT,
    kind TEXT NOT NULL,
    item_key TEXT,
    channel_number INTEGER,
    channel_name TEXT,
    title TEXT,
    position_seconds REAL,
    media_duration_seconds REAL,
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
);
CREATE INDEX IF NOT EXISTS viewing_sessions_ended_idx ON viewing_sessions(ended);
CREATE INDEX IF NOT EXISTS viewing_sessions_item_idx ON viewing_sessions(item_key, ended);
CREATE TABLE IF NOT EXISTS channel_metadata (
    entity_kind TEXT NOT NULL CHECK(entity_kind IN ('channel','programme')),
    entity_key TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
    PRIMARY KEY(entity_kind, entity_key)
);
CREATE TABLE IF NOT EXISTS channel_favourites (
    channel_number INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS programme_favourites (
    media_key TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS channel_metadata_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE IF NOT EXISTS local_media (
    relative_path TEXT PRIMARY KEY,
    library_id TEXT UNIQUE,
    domain TEXT NOT NULL CHECK(domain IN ('adult','adult_episode')),
    series_id TEXT,
    state TEXT,
    message TEXT,
    progress INTEGER,
    favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)),
    favourite_present INTEGER NOT NULL DEFAULT 0 CHECK(favourite_present IN (0,1)),
    watched INTEGER CHECK(watched IN (0,1)),
    watched_present INTEGER NOT NULL DEFAULT 0 CHECK(watched_present IN (0,1)),
    remote_position REAL,
    remote_duration REAL,
    remote_last_watched REAL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    metadata_present INTEGER NOT NULL DEFAULT 0 CHECK(metadata_present IN (0,1)),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
);
CREATE TABLE IF NOT EXISTS adult_series (
    id TEXT PRIMARY KEY,
    title TEXT,
    favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)),
    favourite_present INTEGER NOT NULL DEFAULT 0 CHECK(favourite_present IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    metadata_present INTEGER NOT NULL DEFAULT 0 CHECK(metadata_present IN (0,1)),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
);
CREATE TABLE IF NOT EXISTS adult_seasons (
    series_id TEXT NOT NULL,
    season_number INTEGER NOT NULL CHECK(season_number BETWEEN 1 AND 99),
    explicit INTEGER NOT NULL DEFAULT 0 CHECK(explicit IN (0,1)),
    PRIMARY KEY(series_id, season_number),
    FOREIGN KEY(series_id) REFERENCES adult_series(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS adult_titles (
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    title TEXT,
    year TEXT,
    poster_path TEXT,
    overview TEXT,
    runtime INTEGER,
    manual_state TEXT,
    series_watching INTEGER CHECK(series_watching IN (0,1)),
    viewing_updated REAL,
    series_watching_updated REAL,
    last_launched REAL,
    last_provider TEXT,
    updated REAL,
    history_present INTEGER NOT NULL DEFAULT 0 CHECK(history_present IN (0,1)),
    episodes_present INTEGER NOT NULL DEFAULT 0 CHECK(episodes_present IN (0,1)),
    watchlisted INTEGER CHECK(watchlisted IN (0,1)),
    watchlist_updated REAL,
    up_next INTEGER CHECK(up_next IN (0,1)),
    up_next_rank INTEGER,
    personal_rating INTEGER CHECK(personal_rating BETWEEN 0 AND 10),
    rating_updated REAL,
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    PRIMARY KEY(media_type, tmdb_id)
);
CREATE TABLE IF NOT EXISTS title_watch_events (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    watched_at REAL NOT NULL,
    PRIMARY KEY(media_type, tmdb_id, ordinal),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS watchlist_entries (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    updated REAL,
    PRIMARY KEY(media_type, tmdb_id),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS up_next_entries (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    rank INTEGER NOT NULL CHECK(rank > 0),
    PRIMARY KEY(media_type, tmdb_id),
    UNIQUE(rank),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS title_ratings (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
    updated REAL,
    PRIMARY KEY(media_type, tmdb_id),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS title_episode_state (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    season_number INTEGER NOT NULL CHECK(season_number > 0),
    episode_number INTEGER NOT NULL CHECK(episode_number > 0),
    watched INTEGER NOT NULL CHECK(watched IN (0,1)),
    updated REAL,
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    PRIMARY KEY(media_type, tmdb_id, season_number, episode_number),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS explore_feedback (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    last_seen REAL NOT NULL,
    impressions INTEGER NOT NULL CHECK(impressions BETWEEN 0 AND 50),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    PRIMARY KEY(media_type, tmdb_id)
);
CREATE TABLE IF NOT EXISTS availability_cache (
    title_key TEXT PRIMARY KEY,
    checked REAL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE IF NOT EXISTS adult_viewing_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE IF NOT EXISTS adult_insights_titles (
    title_key TEXT PRIMARY KEY,
    checked REAL,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
);
CREATE TABLE IF NOT EXISTS adult_insights_failures (
    title_key TEXT PRIMARY KEY,
    failed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS adult_insights_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
"""
REVISION_SCHEMA = r"""
CREATE TABLE state_revisions (
    domain TEXT PRIMARY KEY CHECK(domain IN (
        'library','adult_viewing','viewing_insights','adult_insights'
    )),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    updated_at REAL NOT NULL
)
"""
STATE_OWNERSHIP_SCHEMA = r"""
ALTER TABLE state_revisions RENAME TO state_revisions_v2;
CREATE TABLE state_revisions (
    domain TEXT PRIMARY KEY CHECK(domain IN (
        'library','adult_viewing','viewing_insights','adult_insights',
        'settings','identity','player'
    )),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    updated_at REAL NOT NULL
);
INSERT INTO state_revisions(domain,revision,updated_at)
SELECT domain,revision,updated_at FROM state_revisions_v2;
DROP TABLE state_revisions_v2;
INSERT OR IGNORE INTO application_settings(key,value_json,updated_at)
SELECT 'crt_glass',
       CASE json_extract(value_json,'$')
         WHEN 'off' THEN '0' WHEN 'high' THEN '75' ELSE '35' END,
       updated_at
FROM application_settings WHERE key='crt_effect';
UPDATE application_settings SET value_json='"resume"'
WHERE key='playback_mode' AND json_extract(value_json,'$')='restart';
UPDATE application_settings
SET value_json=CASE json_extract(value_json,'$')
  WHEN 'cream' THEN '"silver-90s"'
  WHEN 'charcoal' THEN '"charcoal-90s"'
  WHEN 'walnut' THEN '"vintage-black"'
  ELSE value_json END
WHERE key='tv_border';
DELETE FROM application_settings WHERE key IN (
    'crt_effect','parent_pin','portal_theme','portal_design','portal_palette'
);
CREATE TRIGGER application_settings_reject_retired_insert
BEFORE INSERT ON application_settings
WHEN NEW.key IN (
    'crt_effect','parent_pin','portal_theme','portal_design','portal_palette'
)
BEGIN
    SELECT RAISE(ABORT, 'retired settings cannot become authoritative');
END;
CREATE TRIGGER application_settings_reject_retired_update
BEFORE UPDATE OF key ON application_settings
WHEN NEW.key IN (
    'crt_effect','parent_pin','portal_theme','portal_design','portal_palette'
)
BEGIN
    SELECT RAISE(ABORT, 'retired settings cannot become authoritative');
END;

UPDATE local_media
SET relative_path=series_id || '/' || relative_path
WHERE domain='adult_episode' AND series_id IS NOT NULL
  AND relative_path NOT LIKE series_id || '/%';
CREATE TRIGGER local_media_require_series_qualified_path_insert
BEFORE INSERT ON local_media
WHEN NEW.domain='adult_episode' AND (
    NEW.series_id IS NULL OR NEW.relative_path NOT LIKE NEW.series_id || '/%')
BEGIN
    SELECT RAISE(ABORT, 'episode paths must include their series identity');
END;
CREATE TRIGGER local_media_require_series_qualified_path_update
BEFORE UPDATE OF relative_path,domain,series_id ON local_media
WHEN NEW.domain='adult_episode' AND (
    NEW.series_id IS NULL OR NEW.relative_path NOT LIKE NEW.series_id || '/%')
BEGIN
    SELECT RAISE(ABORT, 'episode paths must include their series identity');
END;

UPDATE adult_titles
SET watchlisted=NULL, watchlist_updated=NULL, up_next=NULL, up_next_rank=NULL,
    personal_rating=NULL, rating_updated=NULL;
CREATE TRIGGER adult_titles_reject_duplicate_state_insert
BEFORE INSERT ON adult_titles
WHEN NEW.watchlisted IS NOT NULL OR NEW.watchlist_updated IS NOT NULL
  OR NEW.up_next IS NOT NULL OR NEW.up_next_rank IS NOT NULL
  OR NEW.personal_rating IS NOT NULL OR NEW.rating_updated IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'relationship state belongs in canonical child tables');
END;
CREATE TRIGGER adult_titles_reject_duplicate_state_update
BEFORE UPDATE OF watchlisted,watchlist_updated,up_next,up_next_rank,
                 personal_rating,rating_updated ON adult_titles
WHEN NEW.watchlisted IS NOT NULL OR NEW.watchlist_updated IS NOT NULL
  OR NEW.up_next IS NOT NULL OR NEW.up_next_rank IS NOT NULL
  OR NEW.personal_rating IS NOT NULL OR NEW.rating_updated IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'relationship state belongs in canonical child tables');
END;

CREATE TABLE external_titles (
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    title TEXT,
    year TEXT,
    overview TEXT,
    updated REAL,
    PRIMARY KEY(media_type,tmdb_id)
);
INSERT OR IGNORE INTO external_titles(media_type,tmdb_id,title,year,overview,updated)
SELECT media_type,tmdb_id,title,year,overview,updated FROM adult_titles;
INSERT OR IGNORE INTO external_titles(media_type,tmdb_id,title,year,overview,updated)
SELECT 'movie', CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER),
       json_extract(metadata_json,'$.title'), json_extract(metadata_json,'$.year'),
       json_extract(metadata_json,'$.overview'), json_extract(metadata_json,'$.updated')
FROM local_media
WHERE domain='adult' AND metadata_present=1
  AND CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER) > 0;
INSERT OR IGNORE INTO external_titles(media_type,tmdb_id,title,year,overview,updated)
SELECT 'tv', CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER),
       COALESCE(json_extract(metadata_json,'$.title'),title),
       json_extract(metadata_json,'$.year'), json_extract(metadata_json,'$.overview'),
       json_extract(metadata_json,'$.updated')
FROM adult_series
WHERE metadata_present=1
  AND CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER) > 0;

CREATE TABLE local_title_links (
    relative_path TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    FOREIGN KEY(relative_path) REFERENCES local_media(relative_path) ON DELETE CASCADE,
    FOREIGN KEY(media_type,tmdb_id) REFERENCES external_titles(media_type,tmdb_id)
        ON DELETE RESTRICT
);
CREATE INDEX local_title_links_title_idx
    ON local_title_links(media_type,tmdb_id);
INSERT OR IGNORE INTO local_title_links(relative_path,media_type,tmdb_id)
SELECT relative_path,'movie',CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER)
FROM local_media
WHERE domain='adult' AND metadata_present=1
  AND CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER) > 0;

CREATE TABLE adult_series_title_links (
    series_id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL DEFAULT 'tv' CHECK(media_type='tv'),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    FOREIGN KEY(series_id) REFERENCES adult_series(id) ON DELETE CASCADE,
    FOREIGN KEY(media_type,tmdb_id) REFERENCES external_titles(media_type,tmdb_id)
        ON DELETE RESTRICT
);
CREATE INDEX adult_series_title_links_title_idx
    ON adult_series_title_links(media_type,tmdb_id);
INSERT OR IGNORE INTO adult_series_title_links(series_id,media_type,tmdb_id)
SELECT id,'tv',CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER)
FROM adult_series
WHERE metadata_present=1
  AND CAST(json_extract(metadata_json,'$.tmdb_id') AS INTEGER) > 0;
"""
CHANNEL_INTEGRITY_SCHEMA = r"""
CREATE TABLE channel_favourites_v4 (
    channel_number INTEGER PRIMARY KEY,
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
INSERT INTO channel_favourites_v4(channel_number)
SELECT favourites.channel_number
FROM channel_favourites AS favourites
JOIN channels ON channels.number=favourites.channel_number;
DROP TABLE channel_favourites;
ALTER TABLE channel_favourites_v4 RENAME TO channel_favourites;
"""
CANONICAL_ADULT_RELATIONSHIPS_SCHEMA = r"""
DROP TRIGGER adult_titles_reject_duplicate_state_insert;
DROP TRIGGER adult_titles_reject_duplicate_state_update;
ALTER TABLE adult_titles DROP COLUMN watchlisted;
ALTER TABLE adult_titles DROP COLUMN watchlist_updated;
ALTER TABLE adult_titles DROP COLUMN up_next;
ALTER TABLE adult_titles DROP COLUMN up_next_rank;
ALTER TABLE adult_titles DROP COLUMN personal_rating;
ALTER TABLE adult_titles DROP COLUMN rating_updated;
"""
RELATIONAL_MEDIA_OWNERSHIP_SCHEMA = r"""
ALTER TABLE external_titles ADD COLUMN poster_path TEXT;
ALTER TABLE external_titles ADD COLUMN runtime INTEGER;
UPDATE external_titles
SET title=COALESCE((SELECT title FROM adult_titles
                    WHERE adult_titles.media_type=external_titles.media_type
                      AND adult_titles.tmdb_id=external_titles.tmdb_id),title),
    year=COALESCE((SELECT year FROM adult_titles
                   WHERE adult_titles.media_type=external_titles.media_type
                     AND adult_titles.tmdb_id=external_titles.tmdb_id),year),
    overview=COALESCE((SELECT overview FROM adult_titles
                       WHERE adult_titles.media_type=external_titles.media_type
                         AND adult_titles.tmdb_id=external_titles.tmdb_id),overview),
    updated=COALESCE((SELECT updated FROM adult_titles
                      WHERE adult_titles.media_type=external_titles.media_type
                        AND adult_titles.tmdb_id=external_titles.tmdb_id),updated),
    poster_path=(SELECT poster_path FROM adult_titles
                 WHERE adult_titles.media_type=external_titles.media_type
                   AND adult_titles.tmdb_id=external_titles.tmdb_id),
    runtime=(SELECT runtime FROM adult_titles
             WHERE adult_titles.media_type=external_titles.media_type
               AND adult_titles.tmdb_id=external_titles.tmdb_id);
ALTER TABLE adult_titles DROP COLUMN title;
ALTER TABLE adult_titles DROP COLUMN year;
ALTER TABLE adult_titles DROP COLUMN poster_path;
ALTER TABLE adult_titles DROP COLUMN overview;
ALTER TABLE adult_titles DROP COLUMN runtime;
ALTER TABLE adult_titles DROP COLUMN updated;
CREATE TRIGGER adult_titles_require_external_insert
BEFORE INSERT ON adult_titles
WHEN NOT EXISTS (
    SELECT 1 FROM external_titles
    WHERE media_type=NEW.media_type AND tmdb_id=NEW.tmdb_id
)
BEGIN
    SELECT RAISE(ABORT, 'Adult viewing state requires an external title');
END;
CREATE TRIGGER adult_titles_require_external_update
BEFORE UPDATE OF media_type,tmdb_id ON adult_titles
WHEN NOT EXISTS (
    SELECT 1 FROM external_titles
    WHERE media_type=NEW.media_type AND tmdb_id=NEW.tmdb_id
)
BEGIN
    SELECT RAISE(ABORT, 'Adult viewing state requires an external title');
END;
CREATE TRIGGER external_titles_restrict_adult_delete
BEFORE DELETE ON external_titles
WHEN EXISTS (
    SELECT 1 FROM adult_titles
    WHERE media_type=OLD.media_type AND tmdb_id=OLD.tmdb_id
)
BEGIN
    SELECT RAISE(ABORT, 'External title is still used by Adult viewing state');
END;

CREATE TABLE local_title_links_v6 AS
SELECT relative_path,media_type,tmdb_id FROM local_title_links;
DROP TABLE local_title_links;
ALTER TABLE local_media RENAME TO local_media_v5;
CREATE TABLE local_media (
    relative_path TEXT PRIMARY KEY,
    library_id TEXT UNIQUE,
    domain TEXT NOT NULL CHECK(domain IN ('adult','adult_episode')),
    series_id TEXT,
    state TEXT,
    message TEXT,
    progress INTEGER,
    favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)),
    favourite_present INTEGER NOT NULL DEFAULT 0 CHECK(favourite_present IN (0,1)),
    watched INTEGER CHECK(watched IN (0,1)),
    watched_present INTEGER NOT NULL DEFAULT 0 CHECK(watched_present IN (0,1)),
    remote_position REAL,
    remote_duration REAL,
    remote_last_watched REAL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    metadata_present INTEGER NOT NULL DEFAULT 0 CHECK(metadata_present IN (0,1)),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    CHECK((domain='adult' AND series_id IS NULL)
       OR (domain='adult_episode' AND series_id IS NOT NULL)),
    FOREIGN KEY(series_id) REFERENCES adult_series(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
INSERT INTO local_media
SELECT * FROM local_media_v5;
DROP TABLE local_media_v5;
CREATE INDEX local_media_series_idx ON local_media(series_id);
CREATE TRIGGER local_media_require_series_qualified_path_insert
BEFORE INSERT ON local_media
WHEN NEW.domain='adult_episode'
 AND NEW.relative_path NOT LIKE NEW.series_id || '/%'
BEGIN
    SELECT RAISE(ABORT, 'episode paths must include their series identity');
END;
CREATE TRIGGER local_media_require_series_qualified_path_update
BEFORE UPDATE OF relative_path,domain,series_id ON local_media
WHEN NEW.domain='adult_episode'
 AND NEW.relative_path NOT LIKE NEW.series_id || '/%'
BEGIN
    SELECT RAISE(ABORT, 'episode paths must include their series identity');
END;
CREATE TABLE local_title_links (
    relative_path TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    FOREIGN KEY(relative_path) REFERENCES local_media(relative_path) ON DELETE CASCADE,
    FOREIGN KEY(media_type,tmdb_id) REFERENCES external_titles(media_type,tmdb_id)
        ON DELETE RESTRICT
);
CREATE INDEX local_title_links_title_idx
    ON local_title_links(media_type,tmdb_id);
INSERT INTO local_title_links(relative_path,media_type,tmdb_id)
SELECT relative_path,media_type,tmdb_id FROM local_title_links_v6;
DROP TABLE local_title_links_v6;
"""
CURRENT_SETTINGS_SCHEMA = r"""
CREATE TRIGGER application_settings_reject_retired_value_insert
BEFORE INSERT ON application_settings
WHEN (NEW.key='playback_mode' AND json_extract(NEW.value_json,'$')='restart')
  OR (NEW.key='tv_border' AND json_extract(NEW.value_json,'$') IN (
      'cream','charcoal','walnut'))
BEGIN
    SELECT RAISE(ABORT, 'retired setting values cannot become authoritative');
END;
CREATE TRIGGER application_settings_reject_retired_value_update
BEFORE UPDATE OF key,value_json ON application_settings
WHEN (NEW.key='playback_mode' AND json_extract(NEW.value_json,'$')='restart')
  OR (NEW.key='tv_border' AND json_extract(NEW.value_json,'$') IN (
      'cream','charcoal','walnut'))
BEGIN
    SELECT RAISE(ABORT, 'retired setting values cannot become authoritative');
END;
"""

VIEWING_IDENTITY_SCHEMA = r"""
CREATE TABLE viewing_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('channel','film')),
    channel_id INTEGER,
    file_name TEXT COLLATE NOCASE,
    current_key TEXT UNIQUE,
    title_snapshot TEXT NOT NULL,
    source_snapshot TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE SET NULL,
    CHECK((kind='channel' AND file_name IS NULL)
       OR (kind='film' AND file_name IS NOT NULL))
);
CREATE UNIQUE INDEX viewing_items_channel_idx
ON viewing_items(channel_id, kind, file_name)
WHERE channel_id IS NOT NULL;

ALTER TABLE viewing_sessions ADD COLUMN viewing_item_id TEXT
    REFERENCES viewing_items(id) ON DELETE SET NULL;
ALTER TABLE viewing_sessions ADD COLUMN programme_title TEXT;
ALTER TABLE viewing_sessions ADD COLUMN programme_file_name TEXT;

INSERT INTO viewing_items(
    id,kind,channel_id,file_name,current_key,title_snapshot,source_snapshot,
    created_at,updated_at)
SELECT 'channel:' || channels.id,'channel',channels.id,NULL,
       'channel:' || channels.number,channels.name,channels.name,
       unixepoch(),unixepoch()
FROM channels
WHERE channels.content_type='shows';

INSERT OR IGNORE INTO viewing_items(
    id,kind,channel_id,file_name,current_key,title_snapshot,source_snapshot,
    created_at,updated_at)
SELECT 'film:legacy:' || lower(hex(sessions.item_key)),'film',channels.id,
       substr(sessions.item_key,
              length('channel:' || sessions.channel_number || ':') + 1),
       sessions.item_key,
       COALESCE(MAX(sessions.title),'Untitled'),
       COALESCE(MAX(sessions.channel_name),'MabelTV'),
       COALESCE(MIN(sessions.started),unixepoch()),
       COALESCE(MAX(sessions.ended),unixepoch())
FROM viewing_sessions AS sessions
LEFT JOIN channels ON channels.number=sessions.channel_number
WHERE sessions.kind='film' AND sessions.item_key IS NOT NULL
  AND channels.id IS NOT NULL
GROUP BY sessions.item_key;

INSERT OR IGNORE INTO viewing_items(
    id,kind,channel_id,file_name,current_key,title_snapshot,source_snapshot,
    created_at,updated_at)
SELECT 'legacy:' || sessions.kind || ':' || lower(hex(sessions.item_key)),
       CASE WHEN sessions.kind='film' THEN 'film' ELSE 'channel' END,
       NULL,
       CASE WHEN sessions.kind='film' THEN
         COALESCE(NULLIF(substr(sessions.item_key,
             length('channel:' || sessions.channel_number || ':') + 1),''),
             COALESCE(sessions.title,'Untitled'))
       ELSE NULL END,
       sessions.item_key,
       COALESCE(MAX(sessions.title),'Untitled'),
       COALESCE(MAX(sessions.channel_name),'MabelTV'),
       COALESCE(MIN(sessions.started),unixepoch()),
       COALESCE(MAX(sessions.ended),unixepoch())
FROM viewing_sessions AS sessions
WHERE sessions.item_key IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM viewing_items
      WHERE viewing_items.current_key=sessions.item_key)
GROUP BY sessions.item_key;

UPDATE viewing_sessions
SET viewing_item_id=(
    SELECT viewing_items.id
    FROM viewing_items
    WHERE viewing_items.current_key=viewing_sessions.item_key)
WHERE item_key IS NOT NULL;

UPDATE viewing_sessions
SET programme_title=title
WHERE kind='film' AND programme_title IS NULL;

CREATE INDEX viewing_sessions_stable_item_idx
ON viewing_sessions(viewing_item_id, ended);
"""

# Versions 1-8 are immutable because deployed databases record their exact
# checksums. This migration is the single compatibility boundary from the old
# domain name to My TV; all runtime code uses only the new names after it runs.
MY_TV_DOMAIN_SCHEMA = r"""
ALTER TABLE adult_resume RENAME TO my_tv_resume;
ALTER TABLE adult_series RENAME TO my_tv_series;
ALTER TABLE adult_seasons RENAME TO my_tv_seasons;
ALTER TABLE adult_titles RENAME TO my_tv_titles;
ALTER TABLE adult_series_title_links RENAME TO my_tv_series_title_links;
ALTER TABLE adult_viewing_state RENAME TO my_tv_viewing_state;
ALTER TABLE adult_insights_titles RENAME TO my_tv_insights_titles;
ALTER TABLE adult_insights_failures RENAME TO my_tv_insights_failures;
ALTER TABLE adult_insights_state RENAME TO my_tv_insights_state;

DROP INDEX adult_series_title_links_title_idx;
CREATE INDEX my_tv_series_title_links_title_idx
    ON my_tv_series_title_links(media_type,tmdb_id);

DROP TRIGGER adult_titles_require_external_insert;
DROP TRIGGER adult_titles_require_external_update;
DROP TRIGGER external_titles_restrict_adult_delete;
CREATE TRIGGER my_tv_titles_require_external_insert
BEFORE INSERT ON my_tv_titles
WHEN NOT EXISTS (
    SELECT 1 FROM external_titles
    WHERE media_type=NEW.media_type AND tmdb_id=NEW.tmdb_id
)
BEGIN
    SELECT RAISE(ABORT, 'My TV viewing state requires an external title');
END;
CREATE TRIGGER my_tv_titles_require_external_update
BEFORE UPDATE OF media_type,tmdb_id ON my_tv_titles
WHEN NOT EXISTS (
    SELECT 1 FROM external_titles
    WHERE media_type=NEW.media_type AND tmdb_id=NEW.tmdb_id
)
BEGIN
    SELECT RAISE(ABORT, 'My TV viewing state requires an external title');
END;
CREATE TRIGGER external_titles_restrict_my_tv_delete
BEFORE DELETE ON external_titles
WHEN EXISTS (
    SELECT 1 FROM my_tv_titles
    WHERE media_type=OLD.media_type AND tmdb_id=OLD.tmdb_id
)
BEGIN
    SELECT RAISE(ABORT, 'External title is still used by My TV viewing state');
END;

CREATE TABLE local_title_links_v9 AS
SELECT relative_path,media_type,tmdb_id FROM local_title_links;
DROP TABLE local_title_links;
ALTER TABLE local_media RENAME TO local_media_v8;
CREATE TABLE local_media (
    relative_path TEXT PRIMARY KEY,
    library_id TEXT UNIQUE,
    domain TEXT NOT NULL CHECK(domain IN ('my_tv','my_tv_episode')),
    series_id TEXT,
    state TEXT,
    message TEXT,
    progress INTEGER,
    favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)),
    favourite_present INTEGER NOT NULL DEFAULT 0 CHECK(favourite_present IN (0,1)),
    watched INTEGER CHECK(watched IN (0,1)),
    watched_present INTEGER NOT NULL DEFAULT 0 CHECK(watched_present IN (0,1)),
    remote_position REAL,
    remote_duration REAL,
    remote_last_watched REAL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    metadata_present INTEGER NOT NULL DEFAULT 0 CHECK(metadata_present IN (0,1)),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    CHECK((domain='my_tv' AND series_id IS NULL)
       OR (domain='my_tv_episode' AND series_id IS NOT NULL)),
    FOREIGN KEY(series_id) REFERENCES my_tv_series(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
INSERT INTO local_media
SELECT relative_path,library_id,
       CASE domain WHEN 'adult' THEN 'my_tv' ELSE 'my_tv_episode' END,
       series_id,state,message,progress,favourite,favourite_present,
       watched,watched_present,remote_position,remote_duration,
       remote_last_watched,metadata_json,metadata_present,extra_json
FROM local_media_v8;
DROP TABLE local_media_v8;
CREATE INDEX local_media_series_idx ON local_media(series_id);
CREATE TRIGGER local_media_require_series_qualified_path_insert
BEFORE INSERT ON local_media
WHEN NEW.domain='my_tv_episode'
 AND NEW.relative_path NOT LIKE NEW.series_id || '/%'
BEGIN
    SELECT RAISE(ABORT, 'episode paths must include their series identity');
END;
CREATE TRIGGER local_media_require_series_qualified_path_update
BEFORE UPDATE OF relative_path,domain,series_id ON local_media
WHEN NEW.domain='my_tv_episode'
 AND NEW.relative_path NOT LIKE NEW.series_id || '/%'
BEGIN
    SELECT RAISE(ABORT, 'episode paths must include their series identity');
END;
CREATE TABLE local_title_links (
    relative_path TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    FOREIGN KEY(relative_path) REFERENCES local_media(relative_path) ON DELETE CASCADE,
    FOREIGN KEY(media_type,tmdb_id) REFERENCES external_titles(media_type,tmdb_id)
        ON DELETE RESTRICT
);
CREATE INDEX local_title_links_title_idx
    ON local_title_links(media_type,tmdb_id);
INSERT INTO local_title_links(relative_path,media_type,tmdb_id)
SELECT relative_path,media_type,tmdb_id FROM local_title_links_v9;
DROP TABLE local_title_links_v9;

ALTER TABLE state_revisions RENAME TO state_revisions_v8;
CREATE TABLE state_revisions (
    domain TEXT PRIMARY KEY CHECK(domain IN (
        'library','my_tv_viewing','viewing_insights','my_tv_insights',
        'settings','identity','player'
    )),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    updated_at REAL NOT NULL
);
INSERT INTO state_revisions(domain,revision,updated_at)
SELECT CASE domain
         WHEN 'adult_viewing' THEN 'my_tv_viewing'
         WHEN 'adult_insights' THEN 'my_tv_insights'
         ELSE domain END,
       revision,updated_at
FROM state_revisions_v8;
DROP TABLE state_revisions_v8;

UPDATE application_settings
SET key='my_tv_provider_badges_enabled'
WHERE key='adult_provider_badges_enabled';
UPDATE viewing_sessions SET surface=replace(surface,'adult','my_tv')
WHERE surface LIKE '%adult%';
UPDATE viewing_sessions SET kind=replace(kind,'adult','my_tv')
WHERE kind LIKE '%adult%';
UPDATE viewing_sessions SET item_key=replace(item_key,'adult','my_tv')
WHERE item_key LIKE '%adult%';
UPDATE viewing_items SET current_key=replace(current_key,'adult','my_tv')
WHERE current_key LIKE '%adult%';
UPDATE viewing_items
SET source_snapshot=replace(replace(source_snapshot,'Adult TV','My TV'),
                            'Adult library','My TV library')
WHERE source_snapshot LIKE '%Adult TV%'
   OR source_snapshot LIKE '%Adult library%';
UPDATE viewing_sessions
SET channel_name=replace(replace(channel_name,'Adult TV','My TV'),
                         'Adult library','My TV library')
WHERE channel_name LIKE '%Adult TV%'
   OR channel_name LIKE '%Adult library%';
"""
MIGRATIONS = (
    (1, "initial relational state", SCHEMA),
    (2, "portal cache revision ledger", REVISION_SCHEMA),
    (3, "canonical state ownership and relational media links", STATE_OWNERSHIP_SCHEMA),
    (4, "channel relationship integrity", CHANNEL_INTEGRITY_SCHEMA),
    (5, "remove duplicate legacy viewing relationship columns",
     CANONICAL_ADULT_RELATIONSHIPS_SCHEMA),
    (6, "relational media and title ownership", RELATIONAL_MEDIA_OWNERSHIP_SCHEMA),
    (7, "reject retired setting values", CURRENT_SETTINGS_SCHEMA),
    (8, "stable MabelTV viewing identities and targeted history",
     VIEWING_IDENTITY_SCHEMA),
    (9, "rename the legacy private domain to My TV", MY_TV_DOMAIN_SCHEMA),
)
MIGRATION_CHECKSUMS = {
    version: hashlib.sha256(sql.encode("utf-8")).hexdigest()
    for version, _, sql in MIGRATIONS
}
