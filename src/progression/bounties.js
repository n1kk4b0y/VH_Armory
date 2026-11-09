const { object, uuid, entry, numeric, label, field } = require('./native');
const { itemName } = require('./p2Catalog');
const { parseSnbt } = require('../parsers/snbt');
const SOURCE = 'data/the_vault_Bounties.dat';
const GROUPS = ['active', 'complete', 'available', 'legendary'];
const TYPES = {
  'the_vault:kill_entity':{ label:'Eliminar monstros', target:'filter' },
  'the_vault:damage_entity':{ label:'Causar dano', target:'entityId' },
  'the_vault:mining':{ label:'Minerar blocos', target:'blockId' },
  'the_vault:item_discovery':{ label:'Encontrar itens', target:'itemId' },
  'the_vault:item_submission':{ label:'Entregar itens', target:'itemId' },
  'the_vault:completion':{ label:'Completar vaults', target:'id' }
};
function expiration(value) {
  // prismarine-nbt represents a native long as signed high/low words.
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isInteger)) return numeric(value);
  const number = BigInt(value[0]) * 4294967296n + BigInt(value[1] >>> 0);
  return number >= 0n && number <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(number) : null;
}
function rewardItem(value) {
  let stack = object(value?.stack) ? value.stack : value;
  // Quest Config's registered ItemStackAdapter uses item/amount/nbt, whereas
  // saved Bounties use native NBT stacks and oversized amounts.
  if(object(value) && typeof value.item==='string')stack={id:value.item,Count:value.amount===undefined?1:value.amount,tag:typeof value.nbt==='string'?parseSnbt(value.nbt):null};
  if (!object(stack) || typeof stack.id !== 'string' || stack.id === 'minecraft:air') return null;
  const amount = numeric(value?.amount) ?? numeric(stack.Count);
  return { id:stack.id, name:itemName(stack.id, stack.tag), amount, model:typeof stack.tag?.model === 'string' ? stack.tag.model : null };
}
function target(properties, type) {
  const key = TYPES[type]?.target;
  if (!key) return null;
  const raw = properties?.[key] ?? (key === 'filter' ? properties?.entityId : null);
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return { id:raw, name:key === 'itemId' || key === 'blockId' ? itemName(raw) : label(raw), kind:key };
}
function extractBounties(data, player) {
  const issues = [], groups = {}, fieldSources = {};
  for (const group of GROUPS) {
    const hit = entry(data?.[group], player), path = `${group}[UUID]`;
    const valid = !!hit && Array.isArray(hit.value);
    fieldSources[group] = field(valid ? hit.value.length : null, SOURCE, path);
    groups[group] = [];
    if (hit && !valid) issues.push({ path, message:'Bounty list is not a native list' });
    if (!valid) continue;
    hit.value.forEach((raw, index) => {
      const at = `${path}[${index}]`, owner = uuid(raw?.playerId), id = uuid(raw?.id);
      if (!object(raw) || (raw.playerId!=null && owner !== uuid(player))) {
        issues.push({ path:at, message:'Invalid bounty or player UUID mismatch' }); return;
      }
      const task = raw.task, props = task?.properties;
      if (!object(task) || !object(props)) { issues.push({ path:at, message:'Task or properties absent' }); return; }
      if (id && task.bountyId && uuid(task.bountyId) !== id) { issues.push({ path:at, message:'Task bounty UUID mismatch' }); return; }
      const type = typeof task.taskType === 'string' ? task.taskType : null;
      const goal = numeric(props.amount), progress = numeric(task.amountObtained);
      if (props.taskType && props.taskType !== type) { issues.push({ path:at, message:'Task type mismatch' }); return; }
      const ratio = goal > 0 && progress != null ? Math.min(1, progress / goal) : null;
      const items = Array.isArray(task.reward?.items) ? task.reward.items.map(rewardItem).filter(Boolean) : null;
      groups[group].push({
        id:id || uuid(task.bountyId), status:group, type, typeLabel:TYPES[type]?.label || label(type) || 'Objetivo desconhecido',
        knownType:!!TYPES[type], target:target(props, type), progress, goal, ratio,
        vaultOnly:typeof props.vaultOnly === 'boolean' ? props.vaultOnly : props.vaultOnly === 0 ? false : props.vaultOnly === 1 ? true : null,
        validDimensions:Array.isArray(props.validDimensions) ? props.validDimensions.filter(v => typeof v === 'string') : [],
        rewardPool:typeof props.rewardPool === 'string' ? props.rewardPool : null,
        expiresAt:expiration(raw.expiration),
        reward:{ vaultXp:numeric(task.reward?.vaultExp), items },
        source:SOURCE, path:at,
        fieldSources:{ progress:field(progress, SOURCE, `${at}.task.amountObtained`), goal:field(goal, SOURCE, `${at}.task.properties.amount`),
          rewardXp:field(numeric(task.reward?.vaultExp), SOURCE, `${at}.task.reward.vaultExp`),
          rewardItems:field(items?.length ?? null, SOURCE, `${at}.task.reward.items`) }
      });
    });
  }
  const available = Object.values(fieldSources).some(row => row.found);
  return { available, source:SOURCE, groups, counts:Object.fromEntries(GROUPS.map(g => [g,fieldSources[g].value])), fieldSources, issues,
    // Complete is a queue awaiting claim. Claimed bounties are removed by the mod.
    historicalCompleted:null };
}
module.exports = { extractBounties, rewardItem };
