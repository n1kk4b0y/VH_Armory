const GODS = ['idona', 'tenos', 'velara', 'wendarr'];
const RUN_FIELDS = {
  outcome:['completion','outcome'], chestsLooted:['chests','chests.total'],
  barrels:['barrels','barrels'], goldSpent:['gold_spent','goldSpent'],
  dungeonAltarsFound:['dungeon_altars_found','dungeonAltarsFound'], phoenixGearUses:['phoenix_gear_uses','phoenixGearUses'],
  mobKills:['mobs','mobKills'], damageDealt:['mobs','damageDealt'], damageReceived:['mobs','damageReceived'],
  championsKilled:['mobs','championsKilled'], dungeonBossesKilled:['mobs','dungeonBossesKilled'],
  treasureRooms:['treasure_rooms_opened','treasureRooms'], vendorsOpened:['vendors_opened','vendorsOpened'],
  dungeons:['dungeons_opened','dungeons'], specialRooms:['discovered_rooms','rooms.specialTotal'],
  pylonsActivated:['used_pylons','pylonsActivated'], pylonsBroken:['broken_pylons','pylonsBroken'],
  soulShardsCollected:['soul_shards_collected','soulShardsCollected'],
  godAltarCompletions:['god_altar_completions','godAltarCompletions'], godAltarFails:['god_altar_fails','godAltarFails'],
  godAltarReputationEarned:['god_altar_reputation','godAltarReputationEarned'],
  expBonus:['exp_bonus','expBonus'], expMultiplier:['exp_multiplier','expMultiplier'],
  objectiveExpMultiplier:['objective_exp_multiplier','objectiveExpMultiplier']
};

function runFieldSources(run) {
  return Object.fromEntries(Object.entries(RUN_FIELDS).map(([key, [nativeField, valuePath]]) => {
    const value = valuePath.split('.').reduce((obj, part) => obj?.[part], run);
    const found = run.decode.fields.includes(nativeField) && value != null;
    return [key, { found, value:found ? value : null, source:run.source,
      path:`${run.path}.stats.${nativeField}`, nativeField, valuePath }];
  }));
}

function aggregateField(runs, key, getter = run => run.fieldSources[key]?.value) {
  const known = runs.filter(run => run.fieldSources[key]?.found);
  const knownValue = known.length ? known.reduce((sum, run) => sum + Number(getter(run)), 0) : null;
  const complete = runs.length > 0 && known.length === runs.length;
  return { found:known.length > 0, complete, value:complete ? knownValue : null, knownValue,
    knownRuns:known.length, totalRuns:runs.length, source:'data/the_vault_VaultSnapshots.dat',
    path:`vault_snapshots[*].stats.${RUN_FIELDS[key][0]}` };
}

module.exports = { GODS, RUN_FIELDS, runFieldSources, aggregateField };
