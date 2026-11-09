const defaults = require('../../data/vault-stats-defaults.json');
const TYPES = ['wooden','gilded','living','ornate','treasure','altar','hardened','enigma','flesh'];
const RARITIES = ['common','rare','epic','omega'];
const valid = value => typeof value === 'number' && Number.isFinite(value);
const f = Math.fround;
const int = value => Math.max(-2147483648,Math.min(2147483647,Math.trunc(value)));

// StatCollector.getExperience(endVault), Remastered 20.0.3. This reconstructs
// the run screen's generated XP. consume() may subsequently change the credit
// through party sharing / Greed; those historical settings aren't persisted.
function calculateRunXp(stats, configured = null) {
  const config = configured?.data || defaults.config;
  const missing = [];
  const source = configured?.source || defaults.source;
  let sum = f(0);
  const weight = (map,key,fallback=0) => {
    const value = map?.[key] ?? fallback;
    if (!valid(value)) {missing.push('config.'+key);return 0;}
    return f(value);
  };
  const add = (value,amount=1) => {sum=f(sum+f(f(value)*f(amount)));};
  const pairWeight = (map,type,rarity) => weight(map?.[String(type).toUpperCase()],String(rarity).toUpperCase());
  const rawChest = stats.chests?.xpEntries || [];
  const hasRawChest = rawChest.some(entry=>!entry.trapped && entry.rarity != null);
  if (hasRawChest) {
    for (const entry of rawChest) {
      if (entry.trapped)continue;
      if (!entry.type || !entry.rarity) {missing.push('chest.type/rarity');continue;}
      if (!config.chests?.[entry.type.toUpperCase()]?.[entry.rarity.toUpperCase()] &&
          config.chests?.[entry.type.toUpperCase()]?.[entry.rarity.toUpperCase()] !== 0) missing.push('config.chests.'+entry.type+'.'+entry.rarity);
      add(pairWeight(config.chests,entry.type,entry.rarity));
    }
  } else {
    for (const type of TYPES) for (const rarity of RARITIES)
      add(pairWeight(config.chests,type,rarity),stats.liveStats?.chests?.[type.toUpperCase()+':'+rarity.toUpperCase()] ?? 0);
  }
  if (stats.barrels != null) {
    for (const entry of stats.barrels.xpEntries || []) {
      if (!entry.type || !entry.rarity) {missing.push('barrel.type/rarity');continue;}
      add(pairWeight(config.barrels,entry.type,entry.rarity));
    }
  } else {
    for (const type of TYPES) for (const rarity of RARITIES)
      add(pairWeight(config.barrels,type,rarity),stats.liveStats?.barrels?.[type.toUpperCase()+':'+rarity.toUpperCase()] ?? 0);
  }
  for (const [index,amount] of Object.entries(stats.minedBlocks?.byIndex || {})) {
    const id = defaults.blockIds[index];
    if (!id) {missing.push('mined_blocks.'+index);continue;}
    add(weight(config.blocksMined,id,config.blocksMined?.['minecraft:default'] ?? config.blocksMined?.default ?? 0),amount);
  }
  if (stats.treasureRoomsOpened != null) add(weight(config,'treasureRoomsOpened'),stats.treasureRoomsOpened);
  const mobs = stats.mobs != null ? Object.entries(stats.mobs.entries).map(([id,value])=>[id,value.killed ?? 0])
    : Object.entries(stats.liveStats?.mobs_killed || {});
  for (const [id,count] of mobs) add(weight(config.mobsKilled,id,config.mobsKilled?.['minecraft:default'] ?? config.mobsKilled?.default ?? 0),count);
  const statsXp = int(sum);
  const outcome = stats.completion?.toUpperCase();
  if (!stats.objective) {
    const values=Object.values(config.completion || {}).map(map=>map?.[outcome]);
    if (values.some(value=>value !== values[0])) missing.push('objective');
  }
  const completionMap = config.completion?.[stats.objective] || config.completion?.['the_vault:'+stats.objective] || config.completion?.default;
  const completionXp = completionMap?.[outcome];
  if (!valid(completionXp)) missing.push('completion');
  if (!valid(stats.expMultiplier)) missing.push('exp_multiplier');
  const objectiveMultiplier = stats.objectiveExpMultiplier ?? stats.expMultiplier;
  if (!valid(objectiveMultiplier)) missing.push('objective_exp_multiplier');
  if (stats.expBonus != null && !valid(stats.expBonus)) missing.push('exp_bonus');
  const bonus = stats.expBonus == null ? 0 : int(Math.max(0,stats.expBonus));
  const total = missing.length ? null : (int(f(f(f(int(completionXp))*f(objectiveMultiplier))+f(f(statsXp)*f(stats.expMultiplier))))+bonus)|0;
  return {value:total,status:total == null ? 'unavailable' : 'recalculated',source,
    scope:'generated-by-player-in-one-vault',historicalConfigVerified:false,
    creditVerified:false,missing:[...new Set(missing)],breakdown:total == null ? null : {
      stats:statsXp,completion:int(completionXp),bonus,multiplier:stats.expMultiplier,objectiveMultiplier
    }};
}

function vaultXpRanking(world) {
  const rows = [];
  let knownRuns=0,totalRuns=0;
  for (const player of world.players) {
    const runs = player.vaultHistory?.runs || [];
    const eligible = runs.filter(run=>valid(run.xp) && run.xp >= 0);
    knownRuns += eligible.length;totalRuns += runs.length;
    const best = eligible.sort((a,b)=>b.xp-a.xp || b.timestamp-a.timestamp || a.fileId.localeCompare(b.fileId))[0];
    if (!best)continue;
    rows.push({uuid:player.uuid,name:player.name,xp:best.xp,run:{fileId:best.fileId,vaultId:best.vaultId,timestamp:best.timestamp,
      objective:best.objective,outcome:best.outcome,xp:best.xp,xpInfo:best.xpInfo},knownRuns:eligible.length,totalRuns:runs.length});
  }
  rows.sort((a,b)=>b.xp-a.xp || String(a.name || a.uuid).localeCompare(String(b.name || b.uuid)) || a.uuid.localeCompare(b.uuid));
  let rank=0;
  rows.forEach((row,index)=>{if(!index || row.xp !== rows[index-1].xp)rank=index+1;row.rank=rank;});
  return {type:'vault-xp',ranking:rows,count:rows.length,knownRuns,totalRuns,unavailablePlayers:world.players.length-rows.length,
    note:'Maior XP gerado em uma única vault por jogador. Valores recalculados com as estatísticas e multiplicadores salvos e a configuração disponível; o crédito após compartilhamento e Greed pode ser diferente.'};
}

module.exports = { calculateRunXp, vaultXpRanking };
