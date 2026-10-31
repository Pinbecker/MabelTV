'use strict';

function words(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function identity(value) {
  const filename = String(value.file || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const rawTitle = value.title || value.show || '';
  const series = Number(value.series) || Number(String(rawTitle).match(/\b(?:Series|Season)\s+(\d+)\b/i)?.[1]) ||
    Number(filename.match(/\b(?:Series|Season)\s+(\d+)\b/i)?.[1]) || Number(filename.match(/\bS(\d+)E\d+\b/i)?.[1]) || null;
  const title = words(String(rawTitle).replace(/\s*:?\s*\b(?:Series|Season)\s+\d+.*$/i, ''));
  const fromFile = filename.match(/(?:\bS\d+E(\d+)\s*[- .]*|\b(?:Series|Season)\s+\d+\s*[- ]+0*(\d+)\.\s*)(.*)$/i);
  const episodeNumber = Number(value.episodeNumber) || Number(String(value.episode || '').match(/^0*(\d+)[. ]/)?.[1]) || Number(fromFile?.[1] || fromFile?.[2]) || null;
  const episode = words(String(value.episode || fromFile?.[3] || '').replace(/^0*\d+[. ]+/, ''));
  return { title, series, episodeNumber, episode, full: words(filename) };
}
function locationsFor(programme, inventory) {
  const wanted = identity(programme);
  const exact = inventory.filter(item => item.pid && item.pid === programme.pid);
  // Exact PID wins. Re-broadcasts can have a different PID, but a fallback
  // needs show, series and the specific episode title/number to agree.
  const fallback = inventory.filter(item => {
    const candidate = identity(item);
    if (!wanted.title || candidate.title !== wanted.title) return false;
    if (wanted.series || candidate.series) {
      return Boolean(wanted.series && wanted.series === candidate.series && wanted.episode &&
        candidate.episode === wanted.episode && wanted.episodeNumber && wanted.episodeNumber === candidate.episodeNumber);
    }
    // Films may have no episode. Only an exact normalised filename is safe.
    return !wanted.episode && !candidate.episode && candidate.full === wanted.title;
  });
  const matches = [...exact, ...fallback.filter(item => !exact.includes(item))];
  return matches.map(item => ({ ...item.location, matchedBy: item.pid === programme.pid ? 'BBC episode ID' : 'Show and episode' }));
}
module.exports = { identity, locationsFor };
