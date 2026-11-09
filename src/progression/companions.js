const { own, object, uuid, numeric, label } = require('./native');
const fs=require('node:fs');
const path=require('node:path');
const models = require('./companionModels.json').variants;
const defaults = require('../../data/companion-defaults.json');
const packedModifiers = require('../../data/companion-modifiers.json');
const {companionSkin}=require('./companionSkin');
const legendModels={eternal:1,minion:0.5,antlion:0.1667,giant:1.5};
const SOURCE = 'data/the_vault_PlayerCompanions.dat';
const iconCache=new Map();
const ITEM_STATE_FIELDS = ['level','xp','hearts','maxHearts','baseCooldown','cooldownExpiry',
  'temporal','lastTemporalVault','relicSlots','relics','ancientRelicSlots','ancientRelics',
  'cosmeticSlots','vaultRuns','hatchedDate'];
function epoch(value) {
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)) value = value[0]*4294967296+(value[1]>>>0);
  if (typeof value === 'bigint') value=Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Remastered CompanionItem persists its state on the functional Curios head
// stack. PlayerCompanionData is the legacy world map used by its migration.
function companionItem(id, tag) {
  if (id !== 'the_vault:companion' || !object(tag)) return null;
  const companionId = uuid(tag.CompanionUUID);
  if (!companionId) return null;
  const data = {id:companionId,owner:uuid(tag.Owner),
    name:tag.PetSeries === 'LEGEND' && typeof tag.playerProfile?.Name === 'string' ? tag.playerProfile.Name : tag.PetName,
    type:tag.PetType,series:tag.PetSeries};
  if(tag.PetSeries==='LEGEND')data.skinProfile=companionSkin(tag.playerProfile,data.name);
  for (const key of ITEM_STATE_FIELDS) if (own(tag,key)) data[key]=tag[key];
  // CompanionItem.hasCompanionData checks these identity tags. Only identified
  // native items receive the getter's documented defaults; incomplete/legacy
  // records still preserve missing values.
  data.nativeItemData = ['PetName','PetType','PetSeries'].every(key=>typeof tag[key]==='string' && tag[key].length>0);
  data.nativeDefaults = [];
  if (data.nativeItemData) {
    for (const [key,value] of Object.entries({level:1,xp:0,hearts:1,maxHearts:1,baseCooldown:0,cooldownExpiry:0,vaultRuns:0})) {
      if (!own(tag,key)) {data[key]=value;data.nativeDefaults.push(key);}
    }
  }
  return {id:companionId,active:tag.active === 1 || tag.active === true,data,
    ownerSpecified:own(tag,'Owner') && tag.Owner !== '',
    hasState:ITEM_STATE_FIELDS.some(key=>own(tag,key))};
}

function modifierCatalog(config) {
  if (!config) return {...defaults.modifiers,...packedModifiers.modifiers};
  const result = {};
  function visit(value, key) {
    if (!object(value) && !Array.isArray(value)) return;
    if (object(value) && object(value.display)) {
      const id = value.id || key;
      if (typeof id === 'string') result[id.includes(':') ? id : 'the_vault:'+id] = {
        name:typeof value.display.name === 'string' ? value.display.name : null,
        description:typeof value.display.description === 'string' ? value.display.description : null,
        icon:typeof value.display.icon === 'string' ? value.display.icon : null,
        color:typeof value.display.color === 'string' ? value.display.color : null
      };
    }
    for (const [k,v] of Object.entries(value)) visit(v,k);
  }
  visit(config);
  return result;
}

function relicCapacity(raw,key,minimum) {
  const saved=numeric(raw[key]);
  if (own(raw,key) && saved==null) return null;
  if (raw.nativeItemData && minimum!=null) return Math.max(saved ?? 0,minimum);
  return saved;
}

function extractCompanions(data, owner, options = {}) {
  const map = data?.data;
  const collectionAvailable = object(map);
  const issues = [];
  const items = [];
  const records = new Map();
  const ownerId = uuid(owner);
  for (const [key,raw] of Object.entries(collectionAvailable ? map : {})) {
    if (!object(raw) || uuid(raw.owner) !== ownerId || !ownerId) continue;
    const id = uuid(key);
    if (!id || (raw.id && uuid(raw.id) !== id)) {
      issues.push({source:SOURCE,path:'data.'+key,message:'Companion UUID mismatch'});continue;
    }
    records.set(id,{raw,source:SOURCE,path:'data.'+key,sourceKind:'legacy-world-data'});
  }
  let equipped = options.equipped;
  const equippedId = uuid(equipped?.id);
  if (!ownerId || !equippedId) equipped=null;
  else if (object(equipped.data)) {
    const legacy = Object.entries(collectionAvailable ? map : {}).find(([key])=>uuid(key)===equippedId)?.[1];
    const wrongOwner = equipped.ownerSpecified ? uuid(equipped.data.owner) !== ownerId
      : uuid(legacy?.owner) != null && uuid(legacy.owner) !== ownerId;
    if (uuid(equipped.data.id) !== equippedId || wrongOwner) {
      issues.push({source:options.equippedSource || null,path:options.equippedPath || 'Curios.head',
        message:wrongOwner ? 'Companion item owner mismatch' : 'Companion item UUID mismatch'});
      equipped=null;
    } else if (equipped.hasState || !records.has(equippedId)) {
      // Keep all state from one capture. A newer/older legacy row must not
      // overwrite the item's level, lives, XP or missing fields.
      records.set(equippedId,{raw:{...equipped.data,owner:ownerId},source:options.equippedSource || null,
        path:options.equippedPath || 'Curios.head',sourceKind:'curios-item'});
    }
  }
  const config = options.config?.data || defaults.config;
  const configSource = options.config?.source || defaults.source;
  const definitions = modifierCatalog(options.modifiers?.data);
  const modifier = id => {
    if (typeof id !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) return null;
    const info = definitions[id];
    const texture=typeof info?.icon==='string' && /^the_vault:gui\/modifiers\/[a-z0-9_/-]+$/.test(info.icon)
      ? '/assets/vault/items/modifiers/'+info.icon.slice('the_vault:gui/modifiers/'.length)+'.png' : null;
    if (texture && !iconCache.has(texture)) iconCache.set(texture,fs.existsSync(path.join(__dirname,'../../public',texture)));
    return { id, name:info?.name || label(id), description:info?.description || null,icon:texture && iconCache.get(texture) ? texture : null,
      color:typeof info?.color==='string' && /^#[a-f0-9]{6}$/i.test(info.color) ? info.color : null,
      definitionSource:info ? options.modifiers?.source || info.definitionSource || defaults.source : null };
  };
  for (const [id,record] of records) {
    const raw=record.raw;
    const level = numeric(raw.level);
    const xp = numeric(raw.xp);
    const maxLevel = numeric(config.maxLevel);
    const atMax = level != null && maxLevel != null ? level >= maxLevel : null;
    // Native getLevelMeta uses the current level as the LIST INDEX; its level
    // label is one higher. Never search levels[].level for the current level.
    const meta = level != null && Number.isInteger(level) && Array.isArray(config.levels)
      ? config.levels[Math.min(level,config.levels.length-1)] : null;
    const required = atMax === true ? 0 : numeric(meta?.tnl);
    const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : null;
    const model = raw.series==='LEGEND' && own(legendModels,type)
      ? {kind:'legend',name:label(type),scale:legendModels[type],baby:['minion','antlion'].includes(type)}
      : own(models,type) ? models[type] : null;
    const hearts = numeric(raw.hearts), maxHearts = numeric(raw.maxHearts);
    const isEquipped = uuid(equipped?.id) === id;
    const relicSlots = relicCapacity(raw,'relicSlots',level!=null ? [2,4,7,9].filter(unlock=>level>=unlock).length : null);
    const ancientRelicSlots = relicCapacity(raw,'ancientRelicSlots',level!=null ? Number(level>=10) : null);
    const relics = Object.entries(object(raw.relics) ? raw.relics : {}).filter(([slot])=>/^\d+$/.test(slot))
      .map(([slot,value])=>({slot:Number(slot),model:numeric(value?.model),
        modifiers:Array.isArray(value?.modifiers) ? value.modifiers.map(modifier).filter(Boolean) : []})).sort((a,b)=>a.slot-b.slot);
    // Native getAncientRelic reads only ancientRelics["0"].
    const ancient=object(raw.ancientRelics?.['0']) ? raw.ancientRelics['0'] : null;
    const ancientRelics=ancient ? [{slot:0,model:numeric(ancient.model),
      modifiers:Array.isArray(ancient.modifiers) ? ancient.modifiers.map(modifier).filter(Boolean) : []}] : [];
    const passiveEffects = new Map();
    for (const relic of [...relics,...ancientRelics]) for (const effect of relic.modifiers) {
      const current=passiveEffects.get(effect.id);
      if (current) current.stacks++;else passiveEffects.set(effect.id,{...effect,stacks:1});
    }
    const duration = level != null && Number.isInteger(level) && Array.isArray(config.temporalModifierDurations)
      ? numeric(config.temporalModifierDurations[Math.max(0,Math.min(level-1,config.temporalModifierDurations.length-1))]) : null;
    items.push({id,owner:uuid(raw.owner),name:typeof raw.name === 'string' && raw.name ? raw.name : model?.name || label(type) || 'Companion',
      type,typeName:model?.name || label(type),series:typeof raw.series === 'string' ? raw.series : null,
      model,skinProfile:raw.series==='LEGEND'?raw.skinProfile || companionSkin(null,raw.name):null,
      level,xp,maxLevel,atMaxLevel:atMax,xpRequired:required,
      xpRemaining:required != null && xp != null ? Math.max(0,required-xp) : null,
      xpProgress:required > 0 && xp != null ? Math.min(1,xp/required) : null,
      hearts,maxHearts,cooldownExpiry:epoch(raw.cooldownExpiry),baseCooldownMinutes:numeric(raw.baseCooldown),
      equipped:isEquipped,active:isEquipped ? equipped.active : null,
      equippedSource:isEquipped ? options.equippedSource || null : null,
      equippedRecord:isEquipped ? options.equippedRecord || null : null,
      temporal:modifier(raw.temporal),temporalDurationTicks:duration,
      lastTemporalVault:uuid(raw.lastTemporalVault),relicSlots,relics,
      relicsEquipped:object(raw.relics) || raw.nativeItemData ? relics.length : null,
      ancientRelicSlots,ancientRelics,
      ancientRelicsEquipped:object(raw.ancientRelics) || raw.nativeItemData ? ancientRelics.length : null,
      passiveEffects:[...passiveEffects.values()],
      cosmeticSlots:numeric(raw.cosmeticSlots),vaultRuns:numeric(raw.vaultRuns),hatchedDate:raw.hatchedDate || null,
      source:record.source,path:record.path,sourceKind:record.sourceKind,configSource,
      nativeDefaults:raw.nativeDefaults || []});
  }
  items.sort((a,b)=>Number(b.equipped)-Number(a.equipped) || (b.level??-1)-(a.level??-1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {available:collectionAvailable || items.length>0,collectionAvailable,source:SOURCE,items,count:items.length,selectedId:items[0]?.id || null,issues,
    equippedId:items.find(p=>p.equipped)?.id || null};
}

module.exports = { extractCompanions, companionItem, modifierCatalog };
