const { decodePackedGear } = require('./nativeGear');

// Identities and qualitative functions from ModTrinkets and the effect classes
// in Remastered 20.0.3. Balance values belong to the instance's trinket.json.
const DEFINITIONS = {
  aether: ['Aether', 'Permite ganhar altura no ar ao manter o botão de pulo pressionado.'],
  carapace: ['Carapace', 'Protege contra dano de fogo.'],
  cat_in_a_jar: ['Cat in a Jar', 'Pode impedir que explosões destruam blocos.'],
  centipede_feet: ['Centipede Feet', 'Permite escalar paredes.'],
  chromatic_feather: ['Chromatic Feather', 'Permite realizar pulos adicionais no ar.'],
  chromatic_powder: ['Chromatic Powder', 'Reduz o desgaste de durabilidade dos equipamentos.'],
  clover: ['Clover', 'Aumenta a chance de Lucky Hit.'],
  crystal_ball: ['Crystal Ball', 'Aumenta a mana máxima.'],
  cufflinks: ['Cufflinks', 'Reduz o tempo de recarga das habilidades.'],
  elven_socks: ['Elven Socks', 'Protege contra dano de queda.'],
  ender_anchor: ['Ender Anchor', 'Teleporta os itens e orbes de XP atraídos pelo magnet diretamente até o jogador.'],
  giants_heart: ["Giant's Heart", 'Aumenta a vida máxima.'],
  gluttony_pendant: ['Gluttony Pendant', 'Permite consumir alimentos instantaneamente e acelera o uso das poções da vault.'],
  golden_burger: ['Golden Burger', 'Aumenta o XP recebido nas vaults.'],
  healing_salve: ['Healing Salve', 'Aumenta a eficácia da cura.'],
  high_heels: ['High Heels', 'Permite subir blocos mais altos sem pular.'],
  idonas_blade: ["Idona's Blade", 'Aumenta a quantidade de Soul Shards obtida.'],
  lucky_goose: ['Lucky Goose', 'Aumenta a raridade dos itens encontrados.'],
  night_vision_goggles: ['Night Vision Goggles', 'Concede visão noturna.'],
  phylactery: ['Phylactery', 'Aumenta a regeneração de mana.'],
  shadow_cloak: ['Shadow Cloak', 'Oculta o jogador dos mobs afetados; interagir ou receber dano interrompe o efeito temporariamente.'],
  slimey: ['Slimey', 'Faz o jogador quicar ao cair e evita o dano de queda.'],
  spellbook: ['Spellbook', 'Aumenta o Ability Power.'],
  stone_of_jordan: ['Stone of Jordan', 'Aumenta o nível de todas as habilidades.'],
  tenos_charm: ["Tenos' Charm", 'Aumenta a quantidade de itens encontrados.'],
  the_dice: ['The Dice', 'Aplica um multiplicador aleatório ao dano causado.'],
  velaras_petal: ["Velara's Petal", 'Concede regeneração de vida.'],
  wendarrs_hourglass: ["Wendarr's Hourglass", 'Aumenta a eficácia das frutas da vault.'],
  wings: ['Wings', 'Permite planar como uma elytra.']
};
const STATES = ['UNIDENTIFIED', 'ROLLING', 'IDENTIFIED'];
const field = row => String(row?.name ?? row?.key ?? row?.id ?? '').toLowerCase();
const effectId = value => typeof value === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) ? value : null;
const text = value => typeof value === 'string' ? value.replace(/§[0-9a-fk-or]/gi, '').trim().slice(0, 4096) : '';

function packedAttributes(value) {
  // Native V0_9 includes a serializer ID per attribute, before its name.
  // The shared decoder validates the whole stream, including word padding.
  const decoded = decodePackedGear(value);
  if (decoded.status !== 'decoded' || decoded.data.attributes.length > 64) return null;
  const rows = decoded.data.attributes;
  if (new Set(rows.map(row => row.name)).size !== rows.length) return null;
  return rows.map(({ name, value }) => ({ name, value }));
}

function readTrinket(id, tag = {}, serializedAttributes = null, state = null) {
  if (!['the_vault:trinket', 'the_vault:greed_trinket'].includes(id)) return null;
  const exported = Array.isArray(serializedAttributes) && serializedAttributes.some(row => field(row) === 'the_vault:trinket');
  const rows = exported ? serializedAttributes
    : Array.isArray(tag.nbtGearData?.attributes) ? tag.nbtGearData.attributes
    : packedAttributes(tag.vaultGearData) || [];
  const rowValue = row => row?.rawValue ?? row?.value;
  const nativeState = rowValue(rows.find(row => field(row) === 'the_vault:state')) ?? state ?? tag.clientCache?.state;
  const stateName = typeof nativeState === 'number' ? STATES[nativeState] : nativeState;
  const identified = !['UNIDENTIFIED', 'ROLLING'].includes(String(stateName || '').toUpperCase());
  const nativeEffect = effectId(rowValue(rows.find(row => field(row) === 'the_vault:trinket')));
  const totalUses = Number.isInteger(tag.vaultUses) && tag.vaultUses >= 0 ? tag.vaultUses : null;
  const usedVaults = Array.isArray(tag.usedVaults) ? tag.usedVaults.filter(entry => {
    const value = entry?.id;
    return typeof value === 'string' ? /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
      : Array.isArray(value) && value.length === 4 && value.every(Number.isInteger);
  }).length : 0;
  return { effectId: identified ? nativeEffect : null,
    status: !identified ? 'unidentified' : nativeEffect ? 'identified' : 'unknown',
    totalUses, usedVaults, remainingUses: totalUses == null ? null : Math.max(0, totalUses - usedVaults) };
}

function applyTrinketDefinition(item, configInfo = null) {
  if (!item?.trinket) return item;
  const trinket = item.trinket;
  const native = configInfo?.data?.TRINKETS?.[trinket.effectId];
  const definition = trinket.effectId?.startsWith('the_vault:') ? DEFINITIONS[trinket.effectId.slice(10)] : null;
  const name = text(native?.name) || definition?.[0] || null;
  const description = text(native?.effectText);
  trinket.name = name;
  trinket.effects = description && description !== 'Trinket Text' ? description.split(/\r?\n|\\n/).map(line => line.trim()).filter(Boolean)
    : definition ? [definition[1]] : [];
  trinket.effectSource = description && description !== 'Trinket Text' ? 'instance-config' : definition ? 'mod-function' : 'unavailable';
  trinket.color = Number.isInteger(native?.color) && native.color >= 0 && native.color <= 0xffffff
    ? '#' + native.color.toString(16).padStart(6, '0') : null;
  if (!item.customName && name) item.displayName = name;
  if (!item.customName && trinket.status === 'unidentified') item.displayName = 'Unidentified Trinket';
  return item;
}

module.exports = { DEFINITIONS, packedAttributes, readTrinket, applyTrinketDefinition };
