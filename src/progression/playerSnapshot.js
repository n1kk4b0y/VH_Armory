const { object, uuid, numeric, label, field } = require('./native');
const COUNTERS = {
  treasureRoomsOpened:'Salas de tesouro abertas', dungeonDoorsOpened:'Portas de dungeon abertas',
  vendoorsOpened:'Vendoors abertas', mobsKilled:'Monstros eliminados', damageTaken:'Dano recebido',
  pylonsBroken:'Pylons quebrados', pylonsUsed:'Pylons usados'
};
function extractPlayerSnapshot(info, player) {
  const data = info?.data, source = info?.source || null, issues = [];
  const identity = uuid(data?.playerUUID);
  const available = object(data) && data.version === 1 && identity === uuid(player);
  if (info && !available) issues.push({ source, message:identity && identity !== uuid(player) ? 'PlayerSnapshot UUID mismatch' : 'PlayerSnapshot version or identity is not the supported native schema' });
  const output = { available, source, version:available ? data.version : null, timestamp:available ? numeric(data.timestamp) : null,
    // PlayerSnapshotDump uses Instant.getEpochSecond. Bounty expiration, in
    // contrast, uses Instant.toEpochMilli. Keep the raw value and explicit unit.
    timestampUnit:'epoch-seconds', timestampMs:available && numeric(data.timestamp)!=null ? data.timestamp*1000 : null,
    nickname:available && typeof data.playerNickname === 'string' ? data.playerNickname : null,
    counters:{}, fieldSources:{}, chests:[], objectives:[], summary:{ dps:null, defense:null }, issues };
  if (!available) return output;
  for (const [key,name] of Object.entries(COUNTERS)) {
    const value = numeric(data[key]);
    output.counters[key] = { key, name, value };
    output.fieldSources[key] = field(value,source,key);
  }
  for (const key of ['dps','defense']) {
    output.summary[key] = numeric(data.summaryAttributes?.[key]);
    output.fieldSources[key] = field(output.summary[key],source,`summaryAttributes.${key}`);
  }
  if (object(data.chests)) for (const [type,rarities] of Object.entries(data.chests)) {
    if (!object(rarities)) continue;
    for (const [rarity,count] of Object.entries(rarities)) {
      const value = numeric(count);
      if(value!=null) output.chests.push({ type,rarity,count:value,source,path:`chests.${type}.${rarity}` });
    }
  }
  output.fieldSources.chests = field(object(data.chests) ? output.chests.reduce((sum,row)=>sum+row.count,0) : null,source,'chests');
  if (object(data.objectiveStats)) for (const [id,stats] of Object.entries(data.objectiveStats)) {
    if (!object(stats)) continue;
    output.objectives.push({ id,name:label(id),completed:numeric(stats.completed),failed:numeric(stats.failed),bailed:numeric(stats.bailed),source,path:`objectiveStats.${id}` });
  }
  output.fieldSources.objectives = field(object(data.objectiveStats) ? output.objectives.length : null,source,'objectiveStats');
  return output;
}
module.exports = { extractPlayerSnapshot };
