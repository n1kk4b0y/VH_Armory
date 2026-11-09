const { own, object, entry, numeric, label, field, unique } = require('./native');
const { catalog, text } = require('./p2Catalog');
const { rewardItem } = require('./bounties');
const SOURCE = 'data/the_vault_QuestStates.dat';
function extractQuests(data, player, config = null) {
  const hit = entry(data, player), state = hit?.value;
  const available = object(state), issues = [], fieldSources = {};
  const configured = config?.data?.quests;
  const definitions = config ? (Array.isArray(configured) ? configured : []) : Object.values(catalog.quests);
  const byId = new Map(definitions.filter(q => object(q) && typeof q.id === 'string').map(q => [q.id, q]));
  const definitionSource = config?.source || `the_vault ${catalog.version}: QuestConfig.reset`;
  const completed = available && Array.isArray(state.Completed) ? unique(state.Completed.filter(x => typeof x === 'string')) : null;
  const ready = available && Array.isArray(state.ReadyToComplete) ? unique(state.ReadyToComplete.filter(x => typeof x === 'string')) : null;
  const inProgress = available && object(state.InProgress) ? state.InProgress : null;
  fieldSources.completed = field(completed?.length ?? null, SOURCE, '[UUID].Completed');
  fieldSources.ready = field(ready?.length ?? null, SOURCE, '[UUID].ReadyToComplete');
  fieldSources.inProgress = field(inProgress ? Object.keys(inProgress).length : null, SOURCE, '[UUID].InProgress');
  const ids = unique([...(completed || []), ...(ready || []), ...Object.keys(inProgress || {})]);
  const quests = ids.map(id => {
    const definition = byId.get(id), done = completed?.includes(id), pending = ready?.includes(id);
    const status = done ? 'completed' : pending ? 'ready' : 'inProgress';
    if (done && (pending || own(inProgress,id)) || pending && own(inProgress,id)) issues.push({ path:`[UUID].${id}`, message:'Quest appears in multiple native state groups' });
    // QuestStates persists current progress only for InProgress. Do not invent
    // a stored progress number for ready/completed quests.
    const progress = status === 'inProgress' ? numeric(inProgress[id]) : null;
    const goal = numeric(definition?.targetProgress);
    const reward = object(definition?.reward) ? {
      vaultXp:numeric(definition.reward.vaultExp), skillPoints:numeric(definition.reward.skillPoints),
      items:Array.isArray(definition.reward.items) ? definition.reward.items.map(rewardItem).filter(Boolean) : null
    } : null;
    return { id, name:typeof definition?.name === 'string' ? text(definition.name) : label(id),
      nameSource:definition ? definitionSource : 'id', status, progress, goal,
      ratio:goal > 0 && progress != null ? Math.min(1, progress / goal) : null,
      type:typeof definition?.type === 'string' ? definition.type : null,
      targetId:typeof definition?.targetId === 'string' ? definition.targetId : null,
      icon:typeof definition?.icon === 'string' ? definition.icon : null,
      description:text(definition?.descriptionData?.description || definition?.descriptionData?.text) || null,
      reward, definitionFound:!!definition, definitionSource:definition ? definitionSource : null,
      definitionSourceKind:definition ? (config ? 'instance-config' : 'jar-default') : null,
      source:SOURCE, path:`[UUID].${status === 'completed' ? 'Completed' : status === 'ready' ? 'ReadyToComplete' : 'InProgress'}.${id}`,
      fieldSources:{ progress:field(progress,SOURCE,`[UUID].InProgress.${id}`),
        goal:field(goal,definition ? definitionSource : null,`quests[${id}].targetProgress`),
        reward:field(reward,definition ? definitionSource : null,`quests[${id}].reward`) } };
  });
  const known = quests.filter(q => q.definitionFound).length;
  return { available, source:SOURCE, skyVault:available && own(state,'isSkyVaultWorld') ? (state.isSkyVaultWorld === 1 || state.isSkyVaultWorld === true) : null,
    quests, counts:{ completed:completed?.length ?? null, ready:ready?.length ?? null, inProgress:inProgress ? Object.keys(inProgress).length : null },
    definitions:{ source:definitionSource, configured:!!config, total:config ? definitions.length : null, matched:known, unmatched:ids.length-known },
    fieldSources, issues };
}
module.exports = { extractQuests };
