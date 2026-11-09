const { DEFINITIONS } = require('../gear/trinkets');

const SOURCE = 'data/the_vault_PlayerPrestige.dat';
const LEVEL_SOURCE = 'data/the_vault_PlayerVaultLevels.dat';
const normalizeUuid = value => typeof value === 'string' ? value.toLowerCase().replace(/-/g, '') : '';
const sameUuid = (a, b) => /^[0-9a-f]{32}$/.test(normalizeUuid(a)) && normalizeUuid(a) === normalizeUuid(b);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const integer = value => Number.isInteger(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' ? value.replace(/§./g, '').slice(0, 4096) : null;
const field = (value, source, path) => ({ found:value != null, value:value ?? null, source, path });
const PASSIVE = new Set(['trinket_power','no_bounties_cooldown_power','gear_attribute_boolean_power','shielded_power','magnet_mastery','black_market_rerolls_power','no_uses_power','crate_tier_power','champion_damage_power','super_crystals_power','treasure_hunter_power','black_marketer_power','temporal_shard_chance_power','commander_power','movement_speed_multiplier_power','tool_durability_power','original_ward_power','gear_durability_power','gear_attribute_power','masterful_power','berserk_power']);
const ACTIVATABLE = new Set(['activatable_trinket_power', 'chain_miner_power', 'triplejump_power', 'instant_item_use_power', 'potion_effect_power', 'wings_power']);

function effects(power) {
  if (!power) return [];
  const description = text(power.description || power.effectText);
  if (description) return description.split(/\r?\n|\\n/).filter(Boolean);
  const definition = typeof power.trinketEffectId === 'string' && power.trinketEffectId.startsWith('the_vault:')
    ? DEFINITIONS[power.trinketEffectId.slice(10)] : null;
  const result = definition ? [definition[1]] : [];
  // Only explicit parameters from the selected native power are presented.
  const labels = {
    minutesReduction:'Redução do cooldown de bounties (min)', costMultiplier:'Multiplicador de custo',
    extraTier:'Tiers extras nas crates', extraCapacity:'Capacidade extra dos cristais',
    capacityMultiplier:'Multiplicador de capacidade', bonusPerStack:'Bônus por stack', maxStacks:'Máximo de stacks',
    amplifier:'Amplificador do efeito', chance:'Chance', durationMultiplier:'Multiplicador de duração',
    multiplier:'Multiplicador de velocidade', damageReduction:'Redução de desgaste', thresholdTicks:'Intervalo (ticks)',
    percentageOfHearts:'Proporção dos corações'
  };
  for (const [key, label] of Object.entries(labels)) {
    const value = number(power[key]);
    if (value != null) result.push(`${label}: ${Number(value.toFixed(6)).toLocaleString('pt-BR')}`);
  }
  if (typeof power.attribute === 'string' && number(power.value) != null) {
    result.push(`${power.attribute.replace(/^the_vault:/, '').replace(/_/g, ' ')}: ${Number(power.value.toFixed(6)).toLocaleString('pt-BR')}`);
  }
  if (typeof power.itemId === 'string') result.push(`Item afetado: ${power.itemId.replace(/^the_vault:/, '').replace(/_/g, ' ')}`);
  if (typeof power.effectId === 'string') result.push(`Efeito: ${power.effectId.replace(/^minecraft:/, '').replace(/_/g, ' ')}`);
  return result;
}

function extractPrestige(data, uuid, levelData = null) {
  const players = Array.isArray(data?.Players) ? data.Players : [];
  const trees = Array.isArray(data?.Prestige) ? data.Prestige : [];
  const index = players.findIndex(player => sameUuid(player, uuid));
  const aligned = players.length === trees.length;
  const tree = aligned && index >= 0 ? trees[index] : null;
  const available = Array.isArray(tree?.skills);
  const activeIndex = Array.isArray(data?.ActivePrestige) ? data.ActivePrestige.findIndex(entry => sameUuid(entry?.Player, uuid)) : -1;
  const activeIds = activeIndex >= 0 && Array.isArray(data.ActivePrestige[activeIndex]?.Active)
    ? data.ActivePrestige[activeIndex].Active.filter(id => typeof id === 'string') : null;
  const activePath = activeIndex >= 0 ? `data.ActivePrestige[${activeIndex}].Active` : 'data.ActivePrestige[*].Active';
  const basePath = index >= 0 ? `data.Prestige[${index}].skills` : 'data.Prestige[*].skills';
  const issues = [];
  if (data && !aligned) issues.push('Players e Prestige têm tamanhos diferentes; a árvore não foi atribuída ao jogador.');
  const seen = new Set();
  let unsupportedSkillCount = 0;
  const catalog = (available ? tree.skills : []).flatMap((skill, position) => {
    if (!skill || typeof skill !== 'object' || skill.type !== 'tiered' || !text(skill.id)) { unsupportedSkillCount++; return []; }
    if (seen.has(skill.id)) { issues.push(`ID de poder duplicado: ${skill.id}`); return []; }
    seen.add(skill.id);
    const path = `${basePath}[${position}]`;
    const tier = integer(skill.tier);
    const bonusTier = integer(skill.bonusTier);
    const actualTier = tier != null && bonusTier != null ? tier + bonusTier : null;
    const tiers = Array.isArray(skill.tiers) ? skill.tiers : [];
    // TieredSkill.getChild uses tier + bonusTier and clamps to the last definition.
    // A definition's Greed tier and purchase cost never mean the player owns it.
    const selectedIndex = actualTier > 0 && tiers.length ? Math.min(actualTier - 1, tiers.length - 1) : null;
    const power = tiers[selectedIndex ?? 0] || null;
    const learned = actualTier == null ? null : actualTier > 0;
    const activatable = ACTIVATABLE.has(power?.type) || Object.hasOwn(power || {}, 'active') ? true : PASSIVE.has(power?.type) ? false : null;
    const childActive = [true, false, 0, 1].includes(power?.active) ? Boolean(power.active) : null;
    const active = learned && activatable ? (activeIds ? activeIds.includes(skill.id) : childActive) : null;
    const selectedPath = `${path}.tiers[${selectedIndex ?? 0}]`;
    return [{ id:text(skill.id), name:text(skill.name) || text(skill.id), tier, bonusTier, actualTier,
      learned, activatable, active, type:text(power?.type), effects:effects(power),
      requiredGreedTier:integer(power?.requiredGreedTier), knowledgeCost:integer(power?.learnKnowledgeCost),
      learnPointCost:integer(power?.learnPointCost), trinketEffectId:text(power?.trinketEffectId),
      fieldSources:{ tier:field(tier,SOURCE,`${path}.tier`), bonusTier:field(bonusTier,SOURCE,`${path}.bonusTier`),
        active:field(active,SOURCE,activeIds ? activePath : `${selectedPath}.active`),
        definition:field(power,SOURCE,selectedPath) } }];
  });
  const learned = catalog.filter(skill => skill.learned === true);
  const unknownTierCount = catalog.filter(skill => skill.learned == null).length;
  const toggles = learned.filter(skill => skill.activatable);
  const levelIndex = Array.isArray(levelData?.PlayerEntries) ? levelData.PlayerEntries.findIndex(player => sameUuid(player, uuid)) : -1;
  const levelsAligned = Array.isArray(levelData?.PlayerEntries) && Array.isArray(levelData?.StatEntries) && levelData.PlayerEntries.length === levelData.StatEntries.length;
  const level = levelsAligned && levelIndex >= 0 ? levelData.StatEntries[levelIndex] : null;
  const levelPath = levelIndex >= 0 ? `data.StatEntries[${levelIndex}]` : 'data.StatEntries[*]';
  const points = { available:integer(level?.unspentPrestigePoints), spent:integer(level?.totalSpentPrestigePoints) };
  const orphanActiveIds = (activeIds || []).filter(id => !learned.some(skill => skill.id === id && skill.activatable));
  return { available, version:integer(data?.prestige_version), active:activeIds, learned, catalog, points,
    learnedCount:available && !unknownTierCount && !unsupportedSkillCount && !issues.length ? learned.length : null,
    activeCount:available && !unknownTierCount && !unsupportedSkillCount && !issues.length && learned.every(skill => skill.activatable != null) && toggles.every(skill => skill.active != null) ? toggles.filter(skill => skill.active).length : null,
    fieldSources:{ tree:field(available ? { skillCount:catalog.length } : null,SOURCE,basePath),
      active:field(activeIds,SOURCE,activePath),
      availablePoints:field(points.available,LEVEL_SOURCE,`${levelPath}.unspentPrestigePoints`),
      spentPoints:field(points.spent,LEVEL_SOURCE,`${levelPath}.totalSpentPrestigePoints`) },
    diagnostics:{ issues, unknownTierCount, unsupportedSkillCount, orphanActiveIds } };
}

module.exports = { extractPrestige };
