const {BitReader,normalizeLongArray}=require('../parsers/vaultSnapshotDecoder');
const catalog=require('../../data/native-gear-attributes.json');
const attributes=catalog.attributes;
const STATES=['UNIDENTIFIED','ROLLING','IDENTIFIED'];
const RARITIES=['SCRAPPY','COMMON','RARE','EPIC','OMEGA','UNIQUE','SPECIAL','CHAOTIC'];
const CATEGORIES=['NONE','LEGENDARY','ABYSSAL','ABILITY_ENHANCEMENT','CRAFTED','FROZEN','CORRUPTED','GREATER','IMBUED'];
const fullItems=new Set(['helmet','chestplate','leggings','boots','shield','wand','focus','sword','axe','magnet','tool','jewel','idol','vault_god_charm','vault_necklace','void_stone']);
const abilityFloats=new Set(['ability_cooldown_flat','ability_cooldown_percent','ability_mana_cost_flat','ability_mana_cost_percent','ability_area_of_effect_flat','ability_area_of_effect_percent']);
function count(value,max=256) {if(!Number.isInteger(value) || value<0 || value>max)throw Error('Invalid native collection size');return value;}
function enumValue(reader,values) {const index=reader.readIntSegmented(3);if(!values || index<0 || index>=values.length)throw Error('Invalid native enum');return values[index];}
function readDouble(reader) {const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(reader.readBits(64));return bytes.readDoubleBE();}
function readValue(reader,id) {
  const definition=attributes[id];if(!definition)throw Error('Unknown native attribute '+id);
  let value;
  if(definition.type==='int')value=reader.readInt();
  else if(definition.type==='float')value=reader.readFloat();
  else if(definition.type==='double')value=readDouble(reader);
  else if(definition.type==='long') {const n=BigInt.asIntN(64,reader.readLong());value=n>=BigInt(Number.MIN_SAFE_INTEGER) && n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n.toString();}
  else if(definition.type==='boolean')value=reader.readBool();
  else if(definition.type==='string')value=reader.readString();
  else if(['identifier','registry'].includes(definition.type))value=reader.readIdentifier();
  else if(definition.type==='enum')value=enumValue(reader,definition.values);
  else if(id==='the_vault:added_ability_level')value={ability:reader.readString(),level:reader.readInt()};
  else if(id==='the_vault:added_talent_level')value={talent:reader.readString(),level:reader.readInt()};
  else if(abilityFloats.has(id.slice(10)))value={ability:reader.readString(),amount:reader.readFloat()};
  else if(id==='the_vault:effect')value={effect:reader.readIdentifier(),amplifier:reader.readInt()};
  else if(id==='the_vault:effect_avoidance')value={effect:reader.readIdentifier(),chance:reader.readFloat()};
  else if(id==='the_vault:effect_list_avoidance') {
    const size=count(reader.readInt());const effects=[];
    for(let i=0;i<size;i++)effects.push(reader.readString());
    value={effects,name:reader.readString(),chance:reader.readFloat()};
  }
  else if(['the_vault:effect_cloud','the_vault:effect_cloud_when_hit'].includes(id)) {
    value={tooltip:reader.readString(),duration:reader.readInt(),radius:reader.readFloat(),color:reader.readInt(),affectsOwner:reader.readBool(),triggerChance:reader.readFloat()};
    const size=count(reader.readIntSegmented(7));value.additionalEffects=[];
    for(let i=0;i<size;i++)value.additionalEffects.push({effect:reader.readIdentifier(),duration:reader.readInt(),amplifier:reader.readInt()});
  }
  else if(id==='the_vault:ability_special_modification') {
    value={ability:reader.readString(),modification:reader.readIdentifier(),textColor:reader.readInt(),highlightColor:reader.readInt()};
    if(!['the_vault:entropic_bind_poison','the_vault:frost_nova_vulnerability'].includes(value.modification))throw Error('Unsupported native ability modification');
    value.amount=reader.readInt();
  }
  else throw Error('Unsupported native attribute '+id);
  const finite=value=>typeof value==='number'?Number.isFinite(value):value && typeof value==='object'?Object.values(value).every(finite):true;
  if(!finite(value))throw Error('Invalid native attribute value');
  return value;
}
function readEntry(reader,version,typed,modifier=false) {
  const serializer=typed?reader.readInt():modifier?1:0;
  if(![0,1].includes(serializer) || (modifier && serializer!==1))throw Error('Unsupported native serializer');
  const name=reader.readIdentifier(),value=readValue(reader,name);
  const row={name,value};
  if(serializer===1) {
    row.tier=reader.readInt();if(row.tier<0 || row.tier>10000)throw Error('Invalid native tier');
    const size=count(reader.readInt(),CATEGORIES.length);row.categories=[];
    for(let i=0;i<size;i++){const ordinal=reader.readInt();if(!CATEGORIES[ordinal])throw Error('Invalid native category');row.categories.push(CATEGORIES[ordinal]);}
    row.category=row.categories[0] || 'NONE';row.legendary=row.categories.includes('LEGENDARY');
    row.modifierGroup=reader.readString();
    // BitBuffer.readNullable consumes a presence flag, then the value when true.
    row.modifierIdentifier=reader.readBool()?reader.readIdentifier():null;
    const time=BigInt.asIntN(64,reader.readLong());row.gameTimeAdded=time>=BigInt(Number.MIN_SAFE_INTEGER) && time<=BigInt(Number.MAX_SAFE_INTEGER)?Number(time):time.toString();
  }
  return row;
}
function readRows(reader,version,typed,modifier=false) {
  const size=count(reader.readIntSegmented(7));const rows=[];
  for(let i=0;i<size;i++)rows.push(readEntry(reader,version,typed,modifier));return rows;
}
function validWord(word) {
  if(typeof word==='number')return Number.isSafeInteger(word);
  if(typeof word==='string' || typeof word==='bigint') {
    if(typeof word==='string' && !/^-?\d+$/.test(word))return false;
    const number=BigInt(word);return number>=-(1n<<63n) && number<(1n<<64n);
  }
  if(Array.isArray(word))return word.length===2 && word.every(n=>Number.isInteger(n) && n>=-0x80000000 && n<=0xffffffff);
  if(word && typeof word==='object') {
    if(Array.isArray(word.value))return validWord(word.value);
    if(word.high!=null && word.low!=null)return validWord([word.high,word.low]);
    if(word.hi!=null && word.lo!=null)return validWord([word.hi,word.lo]);
    if(word.unsigned!=null)return validWord(word.unsigned);
  }
  return false;
}
function decodePackedGear(value,id='the_vault:trinket') {
  let version=null;
  try {
    if(!Array.isArray(value) || !value.length || value.length>4096)throw Error('Invalid native gear buffer');
    if(value.some(w=>!validWord(w)))throw Error('Invalid or unsafe native gear word');
    const reader=new BitReader(normalizeLongArray(value));version=reader.readIntSegmented(3);
    if(version<5 || version>8)throw Error('Unsupported native gear version');
    const data={version,id:reader.readUuid()};
    const size=count(reader.readIntSegmented(7));
    // Current AttributeGearData uses a 32-bit serializer ID for every entry.
    // Retain the previous validated plain-attribute representation, without
    // scanning the buffer or inferring any value from its slot/model.
    const typed=size===0 || [0,1].includes(reader.clone().readInt());data.encoding=typed?'typed':'plain';
    data.attributes=[];for(let i=0;i<size;i++)data.attributes.push(readEntry(reader,version,typed));
    if(String(id).startsWith('the_vault:') && fullItems.has(id.slice(10))) {
      if(version!==8)throw Error('Unsupported native full-gear version');
      data.level=reader.readInt();if(data.level<0 || data.level>100000)throw Error('Invalid native gear level');
      data.state=enumValue(reader,STATES);data.rarity=enumValue(reader,RARITIES);
      data.maxRepairs=count(reader.readInt(),10000);data.usedRepairs=count(reader.readInt(),10000);
      data.implicits=readRows(reader,version,typed,true);data.prefixes=readRows(reader,version,typed,true);data.suffixes=readRows(reader,version,typed,true);
      if(['the_vault:vault_necklace','the_vault:void_stone'].includes(id)) {
        data.vaultUses=count(reader.readInt(),100000);
        const uuids=()=>{const size=count(reader.readIntSegmented(7));const list=[];for(let i=0;i<size;i++)list.push(reader.readUuid());return list;};
        data.usedVaults=uuids();data.freeVaultUses=uuids();
      }
    }
    if(reader.remaining()>=64 || reader.readBits(reader.remaining())!==0n)throw Error('Unexpected native gear trailing data');
    return {status:'decoded',version,data};
  } catch(error) {return {status:/Unsupported|Unknown/.test(error.message)?'unsupported':'invalid',version,data:null,message:error.message};}
}
const label=value=>String(value || '').split(':').at(-1).replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const nativeLabel=value=>catalog.effectLabels?.[String(value || '').split(':').at(-1).toLowerCase()] || label(value);
const num=value=>Number(Number(value).toFixed(2)).toString();
function displayEntry(row,group) {
  const info=attributes[row.name] || {};
  const name=info.name || label(row.name),value=row.value;
  let text=null;
  if(info.reader!=='none' || group!=='attribute') {
    if(info.reader==='CastleBastionModifierReader')text='Standing still builds Bastion up to 5 stacks. Each stack reduces final damage taken by '+num(value*100)+'%. Taking damage with Bastion knocks direct attackers away. Moving removes at most 1 stack per second.';
    else if(row.name==='the_vault:ability_special_modification')text=value.modification==='the_vault:entropic_bind_poison'?'Entropic Bind also applies Poison '+value.amount:'Frost Nova also applies Level '+value.amount+' Vulnerability';
    else if(['the_vault:effect_cloud','the_vault:effect_cloud_when_hit'].includes(row.name))text=num(value.triggerChance*100)+'% '+value.tooltip+' Effect Cloud'+(row.name.endsWith('_when_hit')?' when Hit':'');
    else if(row.name==='the_vault:effect_list_avoidance')text='+'+num(value.chance*100)+'% Avoidance: '+value.effects.map(nativeLabel).join(', ');
    else if(row.name==='the_vault:effect_avoidance')text='+'+num(value.chance*100)+'% '+nativeLabel(value.effect)+' Avoidance';
    else if(row.name==='the_vault:effect')text=nativeLabel(value.effect)+' '+(value.amplifier+1);
    else if(value && typeof value==='object' && value.ability && Number.isFinite(value.amount))text=(value.amount>=0?'+':'')+num(value.amount*(row.name.endsWith('_percent')?100:1))+(row.name.endsWith('_percent')?'%':'')+' '+nativeLabel(value.ability)+' '+label(row.name.replace('the_vault:ability_','').replace(/_(flat|percent)$/,''));
    else if(value && typeof value==='object' && (value.ability || value.talent) && Number.isInteger(value.level))text=(value.level>=0?'+':'')+value.level+' '+nativeLabel(value.ability || value.talent)+' Level';
    else if(typeof value==='number')text=(value>=0?'+':'')+num(/percentage|increased/i.test(info.reader || '')?value*100:value)+(/percentage|increased/i.test(info.reader || '')?'%':'')+' '+name;
    else if(typeof value==='boolean')text=value?name:null;
    else if(info.reader==='EffectImmunityModifierReader')text=label(value)+' Immunity';
    else if(typeof value==='string')text=name+': '+label(value);
  }
  return {...row,display:text?{elements:[text],color:info.color?parseInt(info.color.slice(1),16):null}:null,visible:Boolean(text)};
}
function serializedGearData(data) {
  if(!data)return null;
  return {...data,attributes:data.attributes.map(row=>displayEntry(row,'attribute')),
    implicits:(data.implicits || []).map(row=>displayEntry(row,'implicit')),
    prefixes:(data.prefixes || []).map(row=>displayEntry(row,'prefix')),
    suffixes:(data.suffixes || []).map(row=>displayEntry(row,'suffix'))};
}
module.exports={decodePackedGear,serializedGearData,attributes};
