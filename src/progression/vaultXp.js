// Native Remastered 20.0.3 schema and defaults reconstructed from the supplied
// VaultLevelsConfig.reset/getLevelMeta and PlayerVaultStats.getExpNeededToNextLevel.
// defaultTNLFunction is NOT used by reset in this build.
const JAR_VERSION = 'the_vault-1.18.2-20.0.3-remastered.6872';
const keyOf = (object, name) => Object.keys(object || {}).find(key => key.toLowerCase().replace(/_/g,'') === name.toLowerCase().replace(/_/g,''));
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

function defaultTnl(level) {
  if (!Number.isInteger(level) || level < 0) return null;
  if (level < 6) return 1000 * level + 1000;
  if (level < 8) return 2000 * level - 5000;
  if (level < 10) return 1500 * level - 1000;
  if (level < 40) return 400 * level + 10000;
  if (level < 50) return 1200 * level - 22000;
  if (level < 65) return 98700;
  if (level < 80) return 246750;
  if (level < 90) return 493500;
  if (level < 100) return 1110375;
  return null; // Do not assume cap/Greed state from a player's current level.
}

function nativeXpRequirement(config, level, greedTier = 0) {
  if (!Number.isInteger(level) || level < 0 || !Number.isInteger(greedTier) || greedTier < 0) return null;
  const listKey = keyOf(config,'levelMetas');
  const list = listKey ? config[listKey] : null;
  if (!Array.isArray(list) || !list.length) return null;
  let entry, baseRequired, fieldPath;
  if (level < list.length) {
    entry = list[level];
    const tnlKey = keyOf(entry,'tnl');
    baseRequired = tnlKey ? finite(entry[tnlKey]) : null;
    fieldPath = `${listKey}.${level}.${tnlKey || 'tnl'}`;
  } else {
    const tnlKey = keyOf(list.at(-1),'tnl');
    const last = tnlKey ? finite(list.at(-1)[tnlKey]) : null;
    const scalingKey = keyOf(config,'postCapScalingFactor');
    const scaling = scalingKey ? finite(config[scalingKey]) : 0.1;
    if (last == null || scaling == null || scaling <= -1) return null;
    baseRequired = Math.round(last * Math.pow(1 + scaling, level - (list.length - 1)));
    fieldPath = `${listKey}.${list.length - 1}.${tnlKey} + ${scalingKey || 'postCapScalingFactor(default=0.1)'}`;
  }
  const greedKey = keyOf(config,'greedTierXpMultiplier');
  const greedFactor = greedKey ? finite(config[greedKey]) : 0.2;
  if (!Number.isInteger(baseRequired) || baseRequired <= 0 || greedFactor == null) return null;
  const required = Math.round(baseRequired * (1 + greedTier * greedFactor));
  if (!Number.isSafeInteger(required) || required <= 0 || required > 2147483647) return null;
  return { required, baseRequired, path:fieldPath, confidence:'high', schema:'VaultLevelsConfig', greedTier };
}

function jarDefaultXpRequirement(level) {
  const required = defaultTnl(level);
  if (required == null) return null;
  return { required, baseRequired:required, source:JAR_VERSION, path:'VaultLevelsConfig.reset()',
    sourceKind:'jar-default', verified:false, confidence:'default', greedTier:0 };
}

function applyXpRequirement(vault, requirement) {
  const result = { ...vault, nextLevel:finite(vault.level) == null ? null : Number(vault.level) + 1,
    nextLevelXp:null, xpRemaining:null, xpProgress:null, xpRequirementSource:null,
    xpRequirementPath:null, xpRequirementSourceKind:null, xpRequirementVerified:false };
  const required = finite(requirement?.required);
  if (required == null || required <= 0) return result;
  result.nextLevelXp = required;
  result.xpRequirementSource = requirement.source || null;
  result.xpRequirementPath = requirement.path || null;
  result.xpRequirementSourceKind = requirement.sourceKind || 'instance-config';
  result.xpRequirementVerified = requirement.verified ?? (result.xpRequirementSourceKind === 'instance-config');
  result.xpRequirementConfidence = requirement.confidence || null;
  const xp = finite(vault.xp);
  if (xp != null && xp >= 0) {
    result.xpRemaining = Math.max(0, required - xp);
    result.xpProgress = Math.max(0, Math.min(1, xp / required));
  }
  return result;
}
module.exports = { nativeXpRequirement, jarDefaultXpRequirement, applyXpRequirement, defaultTnl };
