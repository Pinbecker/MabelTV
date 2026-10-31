'use strict';

// This is a durable, explicitly confirmed identity, separate from BBC tags.
function titleMatch(value, destination) {
  if (value == null) return null; // Older jobs and an explicit skip remain playable.
  const type = destination.kind === 'film' ? 'movie' : destination.kind === 'series' ? 'tv' : '';
  if (!type || value.media_type !== type || !Number.isSafeInteger(value.tmdb_id) || value.tmdb_id <= 0 ||
      typeof value.device !== 'string' || !value.device.trim() || value.device.length > 180 ||
      typeof value.title !== 'string' || !value.title.trim()) throw new Error('Review the title match for this destination.');
  return { media_type: type, tmdb_id: value.tmdb_id, device: value.device,
    title: value.title.trim().slice(0, 200), year: /^\d{4}$/.test(value.year) ? value.year : '',
    poster_path: /^\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(value.poster_path) ? value.poster_path : '' };
}
module.exports = { titleMatch };
