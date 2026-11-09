const fs=require('node:fs');
const path=require('node:path');
const {object,uuid,label}=require('../progression/native');
const definitions=require('../../data/deck-definitions.json');
const attributes=require('../../data/card-attributes.json').attributes;
const icons=new Map();
const strings=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
const number=value=>typeof value==='number' && Number.isFinite(value)?value:null;
const integer=value=>Number.isInteger(value) && value>=0?value:null;
function text(value) {
  if(typeof value==='string') {try{return text(JSON.parse(value));}catch{return value;}}
  if(Array.isArray(value))return value.map(text).join('');
  return object(value)?String(value.text || value.translate || '')+(Array.isArray(value.extra)?value.extra.map(text).join(''):''):'';
}
function icon(model) {
  if(typeof model!=='string' || !/^the_vault:[a-z0-9_/-]+(?:#inventory)?$/.test(model))return null;
  const url='/assets/vault/items/'+model.slice(10).replace(/#inventory$/,'')+'.png';
  if(!icons.has(url))icons.set(url,fs.existsSync(path.join(__dirname,'../../public',url)));
  return icons.get(url)?url:null;
}
function forTier(rows,tier,key) {
  if(!Array.isArray(rows) || tier==null)return null;
  const eligible=rows.filter(row=>integer(row?.tier)!=null && row.tier<=tier && number(row[key])!=null)
    .sort((a,b)=>b.tier-a.tier);
  return eligible.length?eligible[0][key]:null;
}
const percent=id=>attributes[id]?.reader ? /percentage|increased/i.test(attributes[id].reader) : /percentile|percent|chance|resistance|cooldown_reduction|efficiency|item_quantity|item_rarity|copiously|durability_saving/.test(id || '');
const names={armor_percentile:'Armor',mana_additive_percentile:'Mana',thorns_damage_flat:'Thorns Damage',cooldown_reduction:'Cooldown Reduction',
  ability_power:'Ability Power',ability_power_percentile:'Ability Power',attack_damage:'Attack Damage',attack_damage_percentile:'Attack Damage'};
function statName(id) {const key=String(id || '').split(':').at(-1);return attributes[id]?.name || names[key] || label(key);}
function statValue(id,value) {
  if(value==null)return null;
  const n=percent(id)?value*100:value;
  return (n>=0?'+':'')+Number(n.toFixed(2))+(percent(id)?'%':'');
}
function entryData(raw,tier) {
  const modifier=object(raw.modifier)?raw.modifier:{};
  const config=object(modifier.config)?modifier.config:{};
  const condition=object(raw.condition)?raw.condition:null,scaler=object(raw.scaler)?raw.scaler:null;
  const entry={name:text(raw.name) || 'Carta',groups:strings(raw.groups),colors:strings(raw.colors),icon:icon(raw.model),
    type:typeof modifier.type==='string'?modifier.type:null,maxTier:integer(config.maxTier),condition,scaler,
    conditional:Boolean(condition || scaler),attribute:typeof config.attribute==='string'?config.attribute:null,
    baseValue:null,effectiveValue:null,effect:null,baseEffect:null,task:null,effectiveKnown:false};
  if(modifier.type==='gear') {
    entry.baseValue=forTier(modifier.values,tier,'value');
    entry.baseEffect=entry.baseValue==null?null:statValue(entry.attribute,entry.baseValue)+' '+statName(entry.attribute);
  } else if(modifier.type==='task_loot') {
    const task=object(modifier.task)?modifier.task:{};
    const count=forTier(modifier.counts,tier,'count');
    const current=number(task.counter?.current),target=number(task.counter?.target);
    const taskText=text(task.renderer?.tooltip).replace(/\$\{current\}/g,current==null?'—':String(current))
      .replace(/\$\{target\}/g,target==null?'—':String(target));
    const description=text(config.tooltip).replace(/\$\{count\}/g,count==null?'—':String(count)).replace(/\$\{task\}/g,taskText);
    entry.task={type:typeof task.type==='string'?task.type:null,current,target,count,
      description:description && !/\$\{/.test(description)?description:null,
      rewardItems:Array.isArray(config.loot)?config.loot.filter(row=>typeof row.item==='string').map(row=>({id:row.item,icon:icon(row.item)})):[]};
    entry.baseEffect=entry.task.description;
  }
  return entry;
}
function coreData(raw) {
  const config=object(raw.config)?raw.config:{};
  const value=number(raw.modifier_value);
  const groups=strings(config.requiredGroups),colors=strings(config.requiredColors);
  const type=typeof raw.type==='string'?raw.type:null;
  return {id:typeof raw.id==='string'?raw.id:null,name:text(raw.name) || 'Núcleo',type,value,
    icon:icon(raw.modelId),groups,colors,description:type==='global' && value!=null
      ? '+'+Number((value*100).toFixed(2))+'% de eficiência em '+(groups.length?groups.join(', '):'todas as cartas')+(colors.length?' · '+colors.join(', '):'')+'.':null};
}
function efficiency(card,cores) {
  let factor=1;
  for(const core of cores) {
    if(core.type!=='global' || core.value==null)return null;
    if(core.groups.every(group=>card.groups.includes(group)) && (!core.colors.length || core.colors.includes(card.colors[0])))
      factor=Math.fround(factor*Math.fround(1+Math.fround(core.value)));
  }
  return factor;
}
function extractDeck(id,tag,options={}) {
  if(id!=='the_vault:card_deck' || !object(tag))return null;
  const data=object(tag.data)?tag.data:null;
  const catalog=options.config?.data?.values || definitions.values;
  const kind=typeof tag.id==='string'?tag.id:null,definition=catalog[kind];
  const deck={id:kind,uuid:uuid(data?.uuid),name:definition?.name || label(kind) || 'Card Deck',
    icon:icon(definition?.model),source:options.config?.source || definitions.source,
    available:Array.isArray(data?.cards),slots:[],cardCount:null,slotCount:null,arcaneSlotCount:null,
    socketCount:integer(data?.socketCount),cores:Array.isArray(data?.modifiers)?data.modifiers.filter(object).map(coreData):[],
    coresAvailable:Array.isArray(data?.modifiers),stats:[],calculationComplete:false};
  if(!deck.available)return deck;
  const seen=new Set();
  for(const row of data.cards) {
    if(!object(row?.pos) || integer(row.pos.x)==null || integer(row.pos.y)==null || row.pos.x>31 || row.pos.y>31)continue;
    const key=row.pos.x+','+row.pos.y;if(seen.has(key))continue;seen.add(key);
    const raw=object(row.card)?row.card:null;
    const tier=integer(raw?.tier);
    const entries=raw && Array.isArray(raw.entries)?raw.entries.filter(object).map(entry=>entryData(entry,tier)):[];
    const groups=[...new Set(entries.flatMap(entry=>entry.groups))],colors=entries.flatMap(entry=>entry.colors);
    deck.slots.push({x:row.pos.x,y:row.pos.y,requiredGroups:strings(row.pos.groups),card:raw?{
      tier,name:entries.map(entry=>entry.name).join(' + ') || 'Carta',groups,colors:[...new Set(colors)],
      foil:groups.includes('Foil'),icon:entries.find(entry=>entry.icon)?.icon || null,entries,efficiency:null}:null});
  }
  deck.slots.sort((a,b)=>a.y-b.y || a.x-b.x);
  const cards=deck.slots.map(slot=>slot.card).filter(Boolean);
  const hasGreed=cards.some(card=>card.entries.some(entry=>entry.type==='greed'));
  const totals=new Map();
  let complete=deck.coresAvailable && !hasGreed;
  for(const card of cards) {
    card.efficiency=deck.coresAvailable && !hasGreed?efficiency(card,deck.cores):null;
    for(const entry of card.entries) {
      if(entry.type==='gear') {
        entry.effectiveKnown=card.efficiency!=null && !entry.conditional && entry.baseValue!=null && Boolean(attributes[entry.attribute]);
        if(entry.effectiveKnown) {
          const type=attributes[entry.attribute].type;
          const scaled=type==='double'?entry.baseValue*card.efficiency:Math.fround(Math.fround(entry.baseValue)*card.efficiency);
          entry.effectiveValue=['int','long'].includes(type)?Math.trunc(scaled):scaled;
          entry.effect=statValue(entry.attribute,entry.effectiveValue)+' '+statName(entry.attribute);
          const total=(totals.get(entry.attribute) || 0)+entry.effectiveValue;
          totals.set(entry.attribute,type==='float'?Math.fround(total):total);
        } else complete=false;
      } else if(entry.type!=='task_loot')complete=false;
    }
  }
  deck.cardCount=cards.length;deck.slotCount=deck.slots.length;
  deck.arcaneSlotCount=deck.slots.filter(slot=>slot.requiredGroups.includes('Arcane')).length;
  deck.stats=[...totals].map(([id,value])=>({id,label:statName(id),value,display:statValue(id,value),abilityPower:/ability_power/.test(id)}));
  deck.calculationComplete=complete;
  return deck;
}
module.exports={extractDeck,text,statValue};
