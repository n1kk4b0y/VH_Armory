const { normUuid } = require('../parsers/vaultHuntersParser');

function pagination(query = {}) {
  const integer = (value, fallback, name, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
      const error = new Error(`${name} must be an integer between 1 and ${max}`);
      error.status = 400;
      throw error;
    }
    return Number(value);
  };
  return { page:integer(query.page, 1, 'page', Number.MAX_SAFE_INTEGER), limit:integer(query.limit, 25, 'limit', 100) };
}

function paginate(runs, query) {
  const { page, limit } = pagination(query);
  const total = runs.length;
  const pages = Math.ceil(total / limit);
  const start = page > pages ? total : (page - 1) * limit;
  return { total, totalRuns:total, page, limit, pages, hasPrevious:page > 1 && pages > 0,
    hasNext:page < pages, runs:runs.slice(start, start + limit) };
}

// Lists contain card/Statistics fields only; fetch a detail separately.
function runSummary(run) {
  return { fileId:run.fileId, vaultId:run.vaultId, timestamp:run.timestamp,
    outcome:run.outcome, objective:run.objective, xp:run.xp,xpStatus:run.xpInfo?.status || 'unavailable',
    chests:{ total:run.chests?.total ?? null }, mobKills:run.mobKills,
    pylonsActivated:run.pylonsActivated, pylonsBroken:run.pylonsBroken,
    rooms:{ total:run.rooms?.total ?? null, specialTotal:run.rooms?.specialTotal ?? null },
    participantCount:run.participants?.length ?? 0 };
}

function historySummary(history = {}) {
  const { runs, ...summary } = history;
  // Keep profile payload bounded; full decoder failures have their own endpoint.
  if (summary.diagnostics) {
    const { failures = [], ...diagnostics } = summary.diagnostics;
    summary.diagnostics = { ...diagnostics, failureCount:failures.length };
  }
  return { ...summary, paginated:true };
}

function playerProfile(player) {
  return { ...player, statistics:{ ...player.statistics, history:historySummary(player.statistics?.history) },
    discoveries:player.discoveries ? {...player.discoveries,categories:Object.fromEntries(Object.entries(player.discoveries.categories).map(([key,{items,...summary}])=>[key,summary])),paginated:true} : null,
    vaultHistory:historySummary(player.vaultHistory) };
}

function playerRuns(world, player) {
  return world.vaultIndex.byPlayer.get(normUuid(player.uuid)) || [];
}

function findPlayerRun(world, player, id) {
  const key = normUuid(player.uuid);
  const file = world.vaultIndex.byFile.get(id.toLowerCase());
  if (file) return file.runs.get(key) || null;
  // Preserve legacy lookup by VaultId. Latest timestamp wins if multiple snapshots exist.
  const records = world.vaultIndex.byVault.get(id.toLowerCase()) || [];
  return records.map(record => record.runs.get(key)).filter(Boolean)
    .sort((a,b) => b.timestamp - a.timestamp || a.fileId.localeCompare(b.fileId))[0] || null;
}

module.exports = { pagination, paginate, runSummary, historySummary, playerProfile, playerRuns, findPlayerRun };
