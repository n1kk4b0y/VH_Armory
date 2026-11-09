const { extractPrestige } = require("../progression/prestige");
const { extractBounties } = require("../progression/bounties");
const { extractQuests } = require("../progression/quests");
const { extractDiscoveries, FILES:DISCOVERY_FILES } = require("../progression/discoveries");
const { extractPlayerSnapshot } = require("../progression/playerSnapshot");
const { extractCompanions, companionItem } = require("../progression/companions");
const {extractDeck}=require('../gear/decks');
const { entry:nativeEntry, uuid:nativeUuid, numeric:nativeNumeric } = require("../progression/native");
const { applyXpRequirement } = require("../progression/vaultXp");
const { parse } = require("./nbtReader");
const { parseSnbt } = require("./snbt");
const { readTrinket, applyTrinketDefinition } = require("../gear/trinkets");
const { decodePackedGear, serializedGearData } = require("../gear/nativeGear");
const { decodeVaultSnapshotHistory, buildVaultSnapshotIndex, getPlayerVaultHistory } = require("./vaultSnapshotDecoder");

const VAULT_FILES = {
  abilities: "data/the_vault_PlayerAbilities.dat",
  altarRecipes: "data/the_vault_PlayerAltarRecipes.dat",
  spiritRecovery: "data/the_vault_PlayerSpiritRecovery.dat",
  playerStats: "data/the_vault_PlayerStats.dat",
  talents: "data/the_vault_PlayerTalents.dat",
  levels: "data/the_vault_PlayerVaultLevels.dat",
  blackMarket: "data/the_vault_PlayerBlackMarket.dat",
  companions: "data/the_vault_PlayerCompanions.dat",
  customNames: "data/the_vault_PlayerCustomNames.dat",
  enhancements: "data/the_vault_PlayerEnhancements.dat",
  expertises: "data/the_vault_PlayerExpertises.dat",
  influences: "data/the_vault_PlayerInfluences.dat",
  particleTrails: "data/the_vault_PlayerParticleTrails.dat",
  prestige: "data/the_vault_PlayerPrestige.dat",
  pylons: "data/the_vault_PlayerPylons.dat",
  researches: "data/the_vault_PlayerResearches.dat",
  logoutSnapshots: "data/the_vault_LogoutSnapshots.dat",
  vaultPlayerStats: "data/the_vault_VaultPlayerStats.dat",
  godAltars: "data/the_vault_GodAltars.dat",
  vaultSnapshots: "data/the_vault_VaultSnapshots.dat",
  vaults: "data/the_vault_Vaults.dat",
  savedBuilds: "data/the_vault_SkillAltar.dat",
  bounties: "data/the_vault_Bounties.dat",
  quests: "data/the_vault_QuestStates.dat",
  ...Object.fromEntries(Object.entries(DISCOVERY_FILES).map(([key,file])=>[`discovered_${key}`,file]))
};

const RARITIES = {
  0: "Scrappy",
  1: "Common",
  2: "Rare",
  3: "Epic",
  4: "Omega",
  5: "Unique"
};

const GODS = ["idona", "tenos", "velara", "wendarr"];

function normUuid(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  return normalized.length === 32 ? normalized : "";
}

function sameUuid(a, b) {
  const aa = normUuid(a);
  const bb = normUuid(b);
  return !!aa && aa === bb;
}

function cleanUuid(value) {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function uuidToIntArray(value) {
  const hex = normUuid(value);
  if (!hex) return null;
  const out = [];
  for (let i = 0; i < 32; i += 8) {
    const unsigned = Number.parseInt(hex.slice(i, i + 8), 16);
    out.push(unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned);
  }
  return out;
}

function sameUuidValue(value, uuid) {
  if (typeof value === "string") return sameUuid(value, uuid);
  if (Array.isArray(value) && value.length === 4 && value.every(Number.isInteger)) {
    const target = uuidToIntArray(uuid);
    return !!target && target.every((part, index) => part === value[index]);
  }
  return false;
}

function normalizeSearch(value) {
  const text = String(value || "").toLowerCase();
  return {
    text,
    compact: text.replace(/[^a-z0-9]+/g, "")
  };
}

async function readNbtOptional(provider, relativePath, errors) {
  if (!(await provider.exists(relativePath))) return null;
  try {
    return await parse(await provider.read(relativePath));
  } catch (error) {
    errors.push({ file: relativePath, message: error.message });
    return null;
  }
}

async function loadVaultSources(provider, errors) {
  const sources = {};
  for (const [key, relativePath] of Object.entries(VAULT_FILES)) {
    sources[key] = await readNbtOptional(provider, relativePath, errors);
  }
  return sources;
}

async function loadDynamicVaultData(provider, errors, sources = null) {
  const result = [];
  let files = [];
  try {
    files = await provider.listFilesRecursive("data");
  } catch {
    return result;
  }

  const candidates = files
    .filter(file => /(?:^|[\\/])(?:the_vault_[^\\/]+|capabilities)\.dat$/i.test(file))
    .filter(file => !/[\\/]vault_snapshots[\\/]/i.test(file));

  for (const file of candidates) {
    try {
      const sourceKey = Object.keys(VAULT_FILES).find(key => VAULT_FILES[key].replace(/\\/g, "/") === file.replace(/\\/g, "/"));
      const parsed = sources && sourceKey ? sources[sourceKey] : await parse(await provider.read(file));
      if (parsed) result.push({ file, data: dataOf(parsed) });
    } catch (error) {
      errors.push({ file, message: error.message });
    }
  }
  return result;
}

function dataOf(source) {
  return source && typeof source === "object" ? (source.data ?? source) : null;
}

function parallelValue(data, playersKey, valuesKey, uuid) {
  if (!data) return null;
  const players = asArray(data[playersKey]);
  const values = asArray(data[valuesKey]);
  const index = players.findIndex(playerUuid => sameUuid(playerUuid, uuid));
  return index >= 0 ? (values[index] ?? null) : null;
}

function keyedEntry(list, uuid) {
  return asArray(list).find(entry => entry && sameUuid(entry.Key ?? entry.key ?? entry.Player ?? entry.player, uuid)) ?? null;
}

function titleCase(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function parseMinecraftText(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(parseMinecraftText).filter(Boolean).join("") || null;
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.extra)) return value.extra.map(parseMinecraftText).filter(Boolean).join("");
    return null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return parseMinecraftText(JSON.parse(trimmed)); } catch {}
  }
  return trimmed.replace(/§./g, "");
}

function itemBaseName(id) {
  const [namespace = "minecraft", rawPath = ""] = String(id || "").split(":");
  const path = rawPath || namespace;
  const specialVault = {
    helmet: "Vault Helmet",
    chestplate: "Vault Chestplate",
    leggings: "Vault Leggings",
    boots: "Vault Boots",
    shield: "Vault Shield",
    sword: "Vault Sword",
    axe: "Vault Axe",
    magnet: "Magnet"
  };
  if (namespace === "the_vault" && specialVault[path]) return specialVault[path];
  return titleCase(path);
}

function modelDisplayName(model, itemId) {
  if (!model) return null;
  const parts = String(model).split("/").filter(Boolean);
  const last = parts.at(-1) || "";
  const itemPath = String(itemId || "").split(":").at(-1) || "";

  if (parts.includes("armor") && parts.length >= 2) {
    const setName = parts.at(-2);
    return `${titleCase(setName)} ${itemBaseName(itemId)}`;
  }
  if (parts.includes("shield")) return `${titleCase(last)} Vault Shield`;
  if (parts.includes("magnets")) return titleCase(last);
  if (itemPath && last.toLowerCase() === itemPath.toLowerCase()) return itemBaseName(itemId);
  return titleCase(last);
}

function humanizeEnchant(id) {
  return titleCase(String(id || "").split(":").at(-1));
}

function roman(value) {
  const n = Number(value || 0);
  if (!Number.isInteger(n) || n <= 0 || n > 20) return String(value ?? "");
  const table = [[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let left = n;
  let out = "";
  for (const [amount, symbol] of table) {
    while (left >= amount) { out += symbol; left -= amount; }
  }
  return out;
}


function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function colorIntToHex(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const unsigned = number >>> 0;
  const rgb = unsigned & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

function stableValueText(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number(value.toFixed(6)).toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stableValueText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const preferred = value.value ?? value.amount ?? value.current ?? value.min ?? value.max ?? value.name ?? value.id;
    if (preferred != null && preferred !== value) return stableValueText(preferred);
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function serializedDisplayText(display) {
  if (!display || typeof display !== "object") return null;
  const elements = Array.isArray(display.elements) ? display.elements : [];
  if (!elements.length) return null;
  const text = elements.map(part => typeof part === "string" ? part : stableValueText(part)).join("");
  return text.replace(/\s+/g, " ").trim() || null;
}

function simplifySerializedGearEntry(entry, group) {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.name ?? entry.id ?? entry.attribute ?? null;
  const displayText = serializedDisplayText(entry.display);
  const rawValue = entry.value ?? null;
  const fallbackLabel = id ? statLabel(String(id).split(":").at(-1)) : "Attribute";
  const fallbackValue = stableValueText(rawValue) || "Present";
  return {
    id,
    label: displayText || fallbackLabel,
    value: displayText ? "" : fallbackValue,
    display: displayText || `${fallbackValue} ${fallbackLabel}`.trim(),
    displayText,
    rawValue,
    group,
    hidden: entry.visible === false,
    tier: entry.tier ?? entry.rolledTier ?? null,
    legendary: !!entry.legendary,
    category: entry.category ?? null,
    categories: Array.isArray(entry.categories) ? entry.categories : [],
    color: entry?.display?.color ?? null,
    colorHex: colorIntToHex(entry?.display?.color),
    source: "PlayerSnapshotDump.gearData"
  };
}

function exactGearFlags(attributes) {
  const flags = [];
  for (const row of attributes || []) {
    const id = String(row.id || "").toLowerCase();
    const value = row.rawValue;
    const enabled = value === true || value === 1 || value === "true" || value === "1";
    if (!enabled) continue;
    if (id.includes("corrupt")) flags.push("Corrupted");
    else if (id.includes("dungeon")) flags.push("Dungeoned");
    else if (id.includes("imbued")) flags.push("Imbued");
    else if (id.includes("greater")) flags.push("Greater");
    else if (id.includes("legendary")) flags.push("Legendary");
    else if (id.includes("living")) flags.push("Living");
    else if (id.includes("sealed")) flags.push("Sealed");
  }
  return [...new Set(flags)];
}

function parseSerializedGearData(rawGearData) {
  const data = parseJsonMaybe(rawGearData);
  if (!data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) return null;

  const convert = (name, group) => asArray(data[name]).map(entry => simplifySerializedGearEntry(entry, group)).filter(Boolean);
  const attributes = convert("attributes", "attribute");
  const implicits = convert("implicits", "implicit");
  const prefixes = convert("prefixes", "prefix");
  const suffixes = convert("suffixes", "suffix");
  const allModifiers = [...implicits, ...prefixes, ...suffixes];
  const flags = exactGearFlags(attributes);
  if (allModifiers.some(row => row.legendary || row.categories?.includes("LEGENDARY"))) flags.push("Legendary");
  if (allModifiers.some(row => row.categories?.includes("GREATER"))) flags.push("Greater");
  const maxRepairs = toNumber(data.maxRepairs);
  const usedRepairs = toNumber(data.usedRepairs);
  const repairsRemaining = maxRepairs != null && usedRepairs != null ? Math.max(0, maxRepairs - usedRepairs) : null;
  const rarityName = typeof data.rarity === "string" ? titleCase(data.rarity.toLowerCase()) : null;
  const state = typeof data.state === "string" ? titleCase(data.state.toLowerCase()) : null;

  return {
    raw: data,
    gearId: data.id ?? null,
    itemLevel: toNumber(data.level),
    rarityName,
    state,
    repairSlots: maxRepairs,
    usedRepairSlots: usedRepairs,
    repairsRemaining,
    attributes,
    implicits,
    prefixes,
    suffixes,
    other: [],
    flags: [...new Set(flags)],
    exact: true
  };
}

function canonicalGearSlot(slot) {
  const raw = String(slot || "").toLowerCase();
  if (["head", "helmet"].includes(raw)) return "helmet";
  if (["chest", "chestplate"].includes(raw)) return "chestplate";
  if (["legs", "leggings"].includes(raw)) return "leggings";
  if (["feet", "boots"].includes(raw)) return "boots";
  if (raw === "mainhand" || raw === "main_hand") return "mainhand";
  if (raw === "offhand" || raw === "off_hand") return "offhand";
  return raw.replace(/^curios?[_:-]?/, "");
}

function isCurioSlot(slot) {
  // Native HEAD is the helmet; lower-case head is Curios (potion or companion).
  if (slot === "head" || /^curios?[_:-]/i.test(String(slot))) return true;
  const raw = canonicalGearSlot(slot);
  return !!raw && !["helmet","chestplate","leggings","boots","offhand","mainhand"].includes(raw)
    && !/^(hotbar|inventory)(?:_|$)/.test(raw);
}

function curioSlotInfo(slot) {
  const raw = String(slot || "curio").toLowerCase().replace(/^curios?[_:-]/, "");
  const match = raw.match(/^(.+?)(?:_?(\d+))?$/);
  const type = match?.[1] || "curio";
  const index = Number(match?.[2] || 0);
  return { slot:type + "_" + index, slotGroup:"curio", curioType:type, slotIndex:index };
}

function extractExactSnapshotGear(snapshotInfo) {
  const snapshot = snapshotInfo?.data;
  if (!snapshot || typeof snapshot !== "object" || !snapshot.equipment || typeof snapshot.equipment !== "object") {
    return { equipment: [], curios: [], all: [], source: snapshotInfo?.source ?? null, timestamp: snapshot?.timestamp ?? null };
  }

  const equipment = [];
  const curios = [];
  const all = [];
  for (const [slotKey, entry] of Object.entries(snapshot.equipment)) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.itemKey ?? entry.id ?? null;
    if (!id) continue;
    const parsedGear = parseSerializedGearData(entry.gearData);
    const curio = isCurioSlot(slotKey);
    const slotInfo = curio ? curioSlotInfo(slotKey) : { slot:canonicalGearSlot(slotKey), slotGroup:"equipment" };
    const slot = slotInfo.slot;
    const rarityName = parsedGear?.rarityName ?? null;
    const item = {
      slot,
      snapshotSlot: slotKey,
      id,
      displayName: itemBaseName(id),
      customName: null,
      transmogName: null,
      count: Number(entry.count ?? 1),
      damage: null,
      model: null,
      rarity: null,
      rarityName,
      state: parsedGear?.state ?? null,
      legendary: parsedGear?.flags?.includes("Legendary") || false,
      greater: parsedGear?.flags?.includes("Greater") || false,
      corrupted: parsedGear?.flags?.includes("Corrupted") || false,
      living: parsedGear?.flags?.includes("Living") || false,
      enchantments: [],
      stats: [],
      modifierGroups: parsedGear ? {
        attributes: parsedGear.attributes,
        implicits: parsedGear.implicits,
        prefixes: parsedGear.prefixes,
        suffixes: parsedGear.suffixes,
        other: parsedGear.other,
        exact: true
      } : { attributes: [], implicits: [], prefixes: [], suffixes: [], other: [], exact: false },
      itemLevel: parsedGear?.itemLevel ?? null,
      repairSlots: parsedGear?.repairSlots ?? null,
      usedRepairSlots: parsedGear?.usedRepairSlots ?? null,
      repairsRemaining: parsedGear?.repairsRemaining ?? null,
      craftingPotential: null,
      details: [],
      flags: parsedGear?.flags || [],
      gearDataId: parsedGear?.gearId ?? null,
      exactGearData: !!parsedGear,
      exactGearSource: snapshotInfo?.source ?? null,
      snapshotTimestamp: snapshot.timestamp ?? null,
      rawGearData: parsedGear?.raw ?? null,
      hasVaultGearData: !!parsedGear,
      hasUnpackedVaultGearData: !!parsedGear
    };
    const tag = typeof entry.nbt === "string" ? parseSnbt(entry.nbt) : entry.nbt;
    const base = simplifyItem({id,Count:entry.count ?? 1,tag:tag && typeof tag === "object" && !Array.isArray(tag) ? tag : {}},slot);
    if (!base) continue;
    const complete = { ...enrichGearItem(base,item), ...slotInfo };
    const attributeValue = name => parsedGear?.attributes.find(row => String(row.id).split(":").at(-1) === name)?.rawValue;
    const nativeModel = attributeValue("gear_model");
    const nativeName = parseMinecraftText(attributeValue("gear_name"));
    if (typeof nativeModel === "string" && !complete.model) complete.model = nativeModel;
    if (nativeName && !complete.customName) complete.displayName = nativeName;
    const trinket = readTrinket(id, tag || {}, parsedGear?.attributes, parsedGear?.state);
    if (trinket) {
      complete.trinket = trinket;
      applyTrinketDefinition(complete);
    }
    all.push(complete);
    (curio ? curios : equipment).push(complete);
  }
  return { equipment, curios, all, source: snapshotInfo.source ?? null, timestamp: snapshot.timestamp ?? null };
}

function mergeDetails(base, extra) {
  const rows = [];
  const seen = new Set();
  for (const row of [...(base || []), ...(extra || [])]) {
    if (!row?.label || row.value == null) continue;
    const key = `${row.label}|${row.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

function enrichGearItem(base, exact) {
  if (!base) return exact;
  if (!exact) return base;
  const exactGroups = exact.modifierGroups || {};
  const groupsHaveData = [exactGroups.attributes, exactGroups.implicits, exactGroups.prefixes, exactGroups.suffixes, exactGroups.other]
    .some(list => Array.isArray(list) && list.length);
  const merged = {
    ...base,
    snapshotSlot: exact.snapshotSlot ?? base.snapshotSlot,
    itemLevel: exact.itemLevel ?? base.itemLevel,
    repairSlots: exact.repairSlots ?? base.repairSlots,
    usedRepairSlots: exact.usedRepairSlots ?? base.usedRepairSlots,
    repairsRemaining: exact.repairsRemaining ?? base.repairsRemaining,
    rarityName: exact.rarityName ?? base.rarityName,
    state: exact.state ?? base.state,
    gearDataId: exact.gearDataId ?? base.gearDataId ?? null,
    exactGearData: !!(exact.exactGearData || base.exactGearData),
    exactGearSource: exact.exactGearSource ?? base.exactGearSource,
    snapshotTimestamp: exact.snapshotTimestamp ?? base.snapshotTimestamp ?? null,
    rawGearData: exact.rawGearData ?? base.rawGearData ?? null,
    flags: [...new Set([...(base.flags || []), ...(exact.flags || [])])],
    legendary: base.legendary || exact.legendary,
    greater: base.greater || exact.greater,
    corrupted: base.corrupted || exact.corrupted,
    living: base.living || exact.living,
    hasUnpackedVaultGearData: base.hasUnpackedVaultGearData || exact.hasUnpackedVaultGearData,
    hasVaultGearData: base.hasVaultGearData || exact.hasVaultGearData,
    modifierGroups: groupsHaveData ? exactGroups : base.modifierGroups,
    details: mergeDetails(base.details, [
      exact.state ? { label: "State", value: exact.state } : null,
      exact.gearDataId ? { label: "Gear Data ID", value: exact.gearDataId } : null,
      exact.snapshotSlot ? { label: "Snapshot slot", value: exact.snapshotSlot } : null
    ].filter(Boolean))
  };
  if (!merged.rarityName && exact.rarityName) merged.rarityName = exact.rarityName;
  return merged;
}

function learnedTieredSkills(root) {
  return asArray(root?.skills)
    .filter(skill => Number(skill?.tier || 0) > 0 || Number(skill?.bonusTier || 0) > 0)
    .map(skill => ({
      id: skill.id ?? null,
      name: skill.name ?? titleCase(skill.id) ?? null,
      tier: Number(skill.tier || 0),
      bonusTier: Number(skill.bonusTier || 0),
      type: skill.type ?? null
    }));
}

function extractAbilities(data, uuid) {
  return extractAbilityTree(parallelValue(data, "Players", "Abilities", uuid));
}

function extractAbilityTree(root) {
  if (!root) return { selected: null, learned: [] };
  const learned = [];
  for (const ability of asArray(root.skills)) {
    const specializations = asArray(ability.specializations)
      .filter(spec => Number(spec?.tier || 0) > 0 || Number(spec?.bonusTier || 0) > 0)
      .map(spec => ({
        id: spec.id ?? null,
        name: spec.name ?? titleCase(spec.id) ?? null,
        tier: Number(spec.tier || 0),
        bonusTier: Number(spec.bonusTier || 0),
        type: spec.type ?? null
      }));
    if (specializations.length) {
      learned.push({ id: ability.id ?? null, name: ability.name ?? titleCase(ability.id) ?? null, specializations });
    }
  }
  return { selected: root.selected ?? null, learned };
}

function extractSavedBuilds(data, uuid) {
  const templates = data?.playerSkillTemplates;
  if (!templates || typeof templates !== "object") return [];
  const key = Object.keys(templates).find(candidate => sameUuid(candidate, uuid));
  const slots = key ? templates[key] : null;
  return Object.entries(slots || {})
    .filter(([slot, value]) => /^\d+$/.test(slot) && value && typeof value === "object")
    .sort(([a],[b]) => Number(a) - Number(b))
    .map(([slot, value]) => ({
      slot:Number(slot), name:`Build ${Number(slot) + 1}`,
      nameSource:"slot-label", source:VAULT_FILES.savedBuilds,
      icon: value.icon ? { key:value.icon.key || null, isTalent:!!value.icon.isTalent } : (value.topAbilityKey ? {key:value.topAbilityKey,isTalent:false} : null),
      abilities:extractAbilityTree(value.abilities), talents:learnedTieredSkills(value.talents),
      // SkillTemplate stores abilities/talents/icon only. It does not store gear,
      // expertise, a saved player level or an active-build marker.
      active:null
    }));
}

function appendRows(target, rows) {
  for (const row of rows) target.push(row);
}

function extractVaultProgress(data, uuid) {
  const entry = parallelValue(data, "PlayerEntries", "StatEntries", uuid);
  if (!entry) return {
    level: null, xp: null, unspentSkillPoints: null, unspentKnowledgePoints: null,
    unspentExpertisePoints: null, unspentRegretPoints: null, unspentPrestigePoints: null
  };
  return {
    level: entry.vaultLevel ?? null,
    xp: entry.exp ?? null,
    unspentSkillPoints: entry.unspentSkillPts ?? null,
    unspentKnowledgePoints: entry.unspentKnowledgePts ?? null,
    unspentExpertisePoints: entry.unspentExpertisePoints ?? null,
    unspentRegretPoints: entry.unspentRegretPoints ?? null,
    unspentPrestigePoints: entry.unspentPrestigePoints ?? null,
    spentSkillPoints: entry.totalSpentSkillPoints ?? null,
    spentKnowledgePoints: entry.totalSpentKnowledgePoints ?? null,
    spentExpertisePoints: entry.totalSpentExpertisePoints ?? null,
    spentRegretPoints: entry.totalSpentRegretPoints ?? null,
    spentPrestigePoints: entry.totalSpentPrestigePoints ?? null
  };
}

function extractResearches(data, uuid) {
  if (!data || typeof data !== "object") return [];
  const key = Object.keys(data).find(candidate => sameUuid(candidate, uuid));
  if (!key) return [];
  return asArray(data[key]?.researches).map(research => research?.name).filter(Boolean);
}

function extractPlayerStats(data, uuid) {
  const entry = keyedEntry(data?.Stats, uuid);
  if (!entry?.Value) return null;
  const value = entry.Value;
  return {
    crystalRecords: asArray(value.Crystals).length,
    raffleRecords: asArray(value.Raffles).length
  };
}

function extractBlackMarket(data, uuid) {
  const value = parallelValue(data, "playerList", "blackMarketList", uuid);
  if (!value) return null;
  return {
    nextReset: value.nextReset ?? null,
    resetRolls: value.resetRolls ?? null,
    trades: asArray(value.trades).map(entry => ({
      index: entry?.index ?? null,
      item: entry?.trade?.stack?.id ?? null,
      count: entry?.trade?.stack?.Count ?? 1,
      cost: entry?.trade?.cost ?? null,
      infinite: !!entry?.trade?.infinite
    }))
  };
}

function extractCustomNames(data, uuid) {
  return keyedEntry(data?.entries, uuid)?.Value ?? null;
}

function extractSpiritRecovery(data, uuid) {
  if (!data) return null;
  const multipliers = data.spiritRecoveryMultipliers || {};
  const key = Object.keys(multipliers).find(candidate => sameUuid(candidate, uuid));
  const playerData = keyedEntry(data.PlayerData, uuid)?.Value ?? null;
  if (!key && !playerData) return null;
  return { multiplier: key ? multipliers[key] : null, playerData };
}


function primitiveStatValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value.length < 80) return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function statLabel(key) {
  const aliases = {
    itemLevel: "Item Level",
    vaultLevel: "Vault Level",
    repairSlots: "Repair Slots",
    usedRepairSlots: "Used Repair Slots",
    craftingPotential: "Crafting Potential",
    gearLevel: "Gear Level",
    extra_gear_level: "Gear Level",
    extra_jewel_size: "Jewel Size",
    extra_attribute_value: "Extra Attribute",
    rollType: "Roll Type",
    armor: "Armor",
    abilityPower: "Ability Power",
    attackDamage: "Attack Damage",
    attackSpeed: "Attack Speed",
    attackRange: "Attack Range",
    health: "Health",
    mana: "Mana",
    cooldownReduction: "Cooldown Reduction",
    healingEfficiency: "Healing Efficiency",
    increasedDamage: "Increased Damage",
    luckyHitChance: "Lucky Hit Chance",
    stunAttackChance: "Stun Attack Chance",
    thornsDamage: "Thorns Damage",
    knockbackResistance: "Knockback Resist",
    criticalHitResistance: "Crit Hit Resistance"
  };
  return aliases[key] || titleCase(key);
}

function modifierIdentifier(modifier) {
  return modifier?.modifierIdentifier ?? modifier?.key ?? modifier?.id ?? modifier?.modifierGroup ?? null;
}

function modifierDisplayName(modifier) {
  const id = modifierIdentifier(modifier);
  if (!id) return "Modifier";
  const raw = String(id).split(":").at(-1);
  const normalized = raw.toLowerCase();

  const abilityMatch = normalized.match(/(?:ability|abilities|skill)[_-]?(?:level|tier)[_-]?(.*)$/i)
    || normalized.match(/(offensive|defensive|utility|ultimate|power[_-]?up).*?(?:ability|abilities).*?(?:level|tier)/i);
  if (abilityMatch) {
    let family = abilityMatch[1] || "";
    family = family.replace(/[_-]+/g, " ").trim();
    if (family) return `Level of all ${titleCase(family)} abilities`;
    return "Ability Level";
  }

  return titleCase(raw);
}

function modifierRawValue(modifier) {
  const value = modifier?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (value && typeof value === "object") {
    const candidate = value.value ?? value.amount ?? value.min ?? value.max ?? value.current;
    const number = toNumber(candidate);
    if (number != null) return number;
    if (typeof candidate === "boolean" || typeof candidate === "string") return candidate;
  }
  return null;
}

function isPercentModifier(id, label) {
  const key = `${id || ""} ${label || ""}`.toLowerCase();
  return /(percent|chance|resist|reduction|efficien|regen|movement[_ ]?speed|increased|item[_ ]?quantity|item[_ ]?rarity|copiously|soul[_ ]?chance|trap[_ ]?disarm|durability[_ ]?saving)/i.test(key);
}

function modifierValue(modifier) {
  const id = modifierIdentifier(modifier);
  const label = modifierDisplayName(modifier);
  const value = modifierRawValue(modifier);

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const abilityLevel = /(ability|abilities|skill).*?(level|tier)|(level|tier).*?(ability|abilities|skill)/i.test(String(id || ""));
    if (abilityLevel) return `${value >= 0 ? "+" : ""}${Number(value.toFixed(2))}`;
    if (isPercentModifier(id, label)) {
      const percent = Math.abs(value) <= 5 ? value * 100 : value;
      return `${percent >= 0 ? "+" : ""}${Number(percent.toFixed(2))}%`;
    }
    return `${value > 0 ? "+" : ""}${Number(value.toFixed(4))}`;
  }
  return modifier?.rolledTier != null ? `Tier ${modifier.rolledTier}` : "Present";
}

function simplifyGearModifier(modifier, group) {
  if (!modifier || typeof modifier !== "object") return null;
  const id = modifierIdentifier(modifier);
  const label = modifierDisplayName(modifier);
  const value = modifierValue(modifier);
  return {
    id,
    label,
    value,
    display: `${value} ${label}`.trim(),
    group,
    tier: modifier.rolledTier ?? modifier.tier ?? null,
    category: modifier.category ?? null,
    modifierGroup: modifier.modifierGroup ?? null,
    legendary: !!(modifier.legendary || modifier.isLegendary || modifier.legendaryModifier)
  };
}

function extractGearModifierGroups(tag, itemId) {
  const unpacked = tag?.nbtGearData;
  const empty = { attributes: [], implicits: [], prefixes: [], suffixes: [], other: [] };
  if (!unpacked || typeof unpacked !== "object") {
    const packed = Array.isArray(tag?.vaultGearData) && tag.vaultGearData.length > 0;
    const native = packed ? decodePackedGear(tag.vaultGearData, itemId) : null;
    if (native?.status === "decoded") {
      const groups = parseSerializedGearData(serializedGearData(native.data));
      for (const name of ["attributes", "implicits", "prefixes", "suffixes", "other"]) {
        for (const row of groups[name]) row.source = "vaultGearData";
      }
      return { ...groups, packed: false,
        craftingPotential: toNumber(native.data.attributes.find(row => row.name === "the_vault:crafting_potential")?.value),
        nativeDecode: { status: native.status, version: native.version } };
    }
    return {
      ...empty,
      itemLevel: null,
      repairSlots: null,
      usedRepairSlots: null,
      repairsRemaining: null,
      craftingPotential: null,
      packed,
      nativeDecode: native ? { status: native.status, version: native.version, message: native.message } : null
    };
  }

  const take = (names, group) => {
    const out = [];
    for (const name of names) {
      for (const modifier of asArray(unpacked[name])) {
        const simplified = simplifyGearModifier(modifier, group);
        if (simplified) out.push(simplified);
      }
    }
    return out;
  };

  const base = take(["baseModifiers", "implicitModifiers", "implicits"], "implicit");
  const prefixes = take(["prefixes", "prefixModifiers"], "prefix");
  const suffixes = take(["suffixes", "suffixModifiers"], "suffix");
  const other = take(["modifiers", "legendaryModifiers"], "other");
  const repairSlots = toNumber(unpacked.repairSlots ?? tag?.repairSlots);
  const usedRepairSlots = toNumber(unpacked.usedRepairSlots ?? tag?.usedRepairSlots);

  return {
    attributes: [],
    implicits: base,
    prefixes,
    suffixes,
    other,
    itemLevel: toNumber(unpacked.itemLevel ?? unpacked.vaultLevel ?? unpacked.level ?? tag?.itemLevel ?? tag?.vaultLevel),
    repairSlots,
    usedRepairSlots,
    repairsRemaining: repairSlots != null && usedRepairSlots != null ? Math.max(0, repairSlots - usedRepairSlots) : null,
    craftingPotential: toNumber(unpacked.craftingPotential ?? tag?.craftingPotential),
    packed: false
  };
}

function extractReadableItemStats(tag, cache, gear) {
  const stats = [];
  const seen = new Set();
  const push = (label, value, group = "stat") => {
    if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) return;
    const key = `${group}|${label}|${String(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    stats.push({ label, value: String(value), group });
  };

  for (const [key, value] of Object.entries(cache || {})) {
    if (["model","gearName","color","colors","jcolors","rarity","state"].includes(key)) continue;
    if (/^hasModifier|^present/.test(key)) continue;
    if (!/(level|armor|damage|power|health|mana|speed|range|cooldown|resist|chance|efficien|durab|repair|potential|quantity|rarity|attribute|roll|size)/i.test(key)) continue;
    const primitive = primitiveStatValue(value);
    if (primitive != null) push(statLabel(key), primitive, "cache");
  }

  if (!gear.packed) {
    if (gear.itemLevel != null) push("Item Level", gear.itemLevel, "gear");
    if (gear.repairSlots != null) push("Repair Slots", gear.repairSlots, "gear");
    if (gear.usedRepairSlots != null) push("Used Repair Slots", gear.usedRepairSlots, "gear");
    if (gear.craftingPotential != null) push("Crafting Potential", gear.craftingPotential, "gear");
    for (const modifier of [...gear.implicits, ...gear.prefixes, ...gear.suffixes, ...gear.other]) {
      push(modifier.label, modifier.value, modifier.group);
    }
  }

  for (const modifier of asArray(tag?.AttributeModifiers)) {
    const name = modifier?.AttributeName ?? modifier?.Name ?? modifier?.attribute ?? modifier?.name;
    const amount = toNumber(modifier?.Amount ?? modifier?.amount);
    if (name && amount != null) push(titleCase(String(name).split(":").at(-1)), amount, "attribute");
  }

  for (const key of ["vaultLevel","itemLevel","repairSlots","usedRepairSlots","craftingPotential"]) {
    const value = primitiveStatValue(tag?.[key]);
    if (value != null) push(statLabel(key), value, "tag");
  }

  return stats;
}

function simplifyItem(item, slot = null) {
  if (!item || typeof item !== "object") return null;
  const id = item.id ?? item.Id ?? null;
  const count = Number(item.Count ?? item.count ?? 1);
  if (!id || id === "minecraft:air" || count === 0) return null;

  const tag = item.tag || item.Tag || {};
  const cache = tag.clientCache || null;
  const customName = parseMinecraftText(tag?.display?.Name);
  const companion = companionItem(id, tag);
  const deck=extractDeck(id,tag);
  const modifierGroups = extractGearModifierGroups(tag, id);
  const nativeAttribute = name => modifierGroups.attributes.find(row => row.id === "the_vault:" + name)?.rawValue;
  const model = nativeAttribute("gear_model") ?? cache?.model ?? null;
  const nativeFlag = (name, fallback) => nativeAttribute(name) == null ? !!fallback : nativeAttribute(name) === true;
  const lore = asArray(tag?.display?.Lore).map(parseMinecraftText).filter(Boolean);
  const transmogName = modelDisplayName(model, id);
  const gearName = parseMinecraftText(nativeAttribute("gear_name") ?? cache?.gearName);
  const displayName = customName || gearName || transmogName || companion?.data.name || deck?.name || itemBaseName(id);
  const enchantments = asArray(tag.Enchantments).map(enchantment => ({
    id: enchantment?.id ?? null,
    name: humanizeEnchant(enchantment?.id),
    level: enchantment?.lvl ?? null,
    levelLabel: roman(enchantment?.lvl)
  }));
  const rarity = cache?.rarity ?? tag?.nbtGearData?.rarity ?? null;
  const rarityName = modifierGroups.rarityName ?? (rarity != null ? (RARITIES[Number(rarity)] || titleCase(String(rarity))) : null);
  const stateValue = modifierGroups.state ?? nativeAttribute("state") ?? cache?.state ?? null;
  const state = typeof stateValue === "string" && /^(unidentified|rolling|identified)$/i.test(stateValue)
    ? titleCase(stateValue.toLowerCase()) : stateValue;
  const flags = modifierGroups.flags || [];
  const readableStats = extractReadableItemStats(tag, cache, modifierGroups);

  const details = [];
  if (slot) details.push({ label: "Slot", value: titleCase(slot.replace(/^hotbar_/, "Hotbar ")) });
  if (rarity != null) details.push({ label: "Rarity", value: RARITIES[Number(rarity)] || `Tier ${rarity}` });
  if (cache?.model) details.push({ label: "Transmog", value: transmogName || cache.model });
  if (tag.Damage != null) details.push({ label: "Damage / wear", value: String(tag.Damage) });
  if (cache?.hasModifierLEGENDARY) details.push({ label: "Legendary", value: "Yes" });
  if (cache?.hasModifierGREATER) details.push({ label: "Greater", value: "Yes" });
  if (cache?.hasModifierCORRUPTED) details.push({ label: "Corrupted", value: "Yes" });
  if (cache?.["presentthe_vault:living"]) details.push({ label: "Living", value: "Yes" });
  if (tag.inventorySlots != null) details.push({ label: "Inventory slots", value: String(tag.inventorySlots) });
  if (tag.upgradeSlots != null) details.push({ label: "Upgrade slots", value: String(tag.upgradeSlots) });

  return applyTrinketDefinition({
    slot,
    id,
    displayName,
    customName,
    gearName,
    transmogName,
    lore,
    count,
    damage: tag.Damage ?? null,
    model,
    rarity,
    rarityName,
    state,
    flags,
    legendary: flags.includes("Legendary") || (!modifierGroups.nativeDecode && !!cache?.hasModifierLEGENDARY),
    greater: flags.includes("Greater") || (!modifierGroups.nativeDecode && !!cache?.hasModifierGREATER),
    corrupted: nativeFlag("corrupted", cache?.hasModifierCORRUPTED),
    living: nativeFlag("living", cache?.["presentthe_vault:living"]),
    enchantments,
    stats: readableStats,
    modifierGroups,
    itemLevel: modifierGroups.itemLevel,
    repairSlots: modifierGroups.repairSlots,
    usedRepairSlots: modifierGroups.usedRepairSlots,
    repairsRemaining: modifierGroups.repairsRemaining,
    craftingPotential: modifierGroups.craftingPotential,
    details,deck,
    hasVaultGearData: Array.isArray(tag.vaultGearData) && tag.vaultGearData.length > 0,
    hasUnpackedVaultGearData: !!tag.nbtGearData,
    exactGearData: modifierGroups.nativeDecode?.status === "decoded",
    gearDataId: modifierGroups.gearId ?? null,
    trinket: readTrinket(id, tag, modifierGroups.attributes, state),
    companion
  });
}

function isVaultHunterGear(item) {
  if (!item?.id || !String(item.id).startsWith("the_vault:")) return false;
  const path = String(item.id).split(":").at(-1);
  const known = /^(helmet|chestplate|leggings|boots|shield|sword|axe|wand|magnet|focus|jewel|tool|trinket|idol)/.test(path);
  return !!(item.hasVaultGearData || item.hasUnpackedVaultGearData || item.model || item.rarity != null || known);
}

function extractEquipmentFromPlayerNbt(playerNbt) {
  const inventory = asArray(playerNbt?.Inventory);
  const selected = Number(playerNbt?.SelectedItemSlot ?? -1);
  const slotMap = new Map([[100,"boots"],[101,"leggings"],[102,"chestplate"],[103,"helmet"],[-106,"offhand"]]);
  const equipment = [];
  for (const item of inventory) {
    const nbtSlot = Number(item?.Slot);
    let slot = slotMap.get(nbtSlot) || null;
    if (nbtSlot === selected && selected >= 0 && selected <= 8) slot = "mainhand";
    if (!slot) continue;
    const simplified = simplifyItem(item, slot);
    if (simplified) equipment.push(simplified);
  }
  return equipment;
}

function extractVanillaStats(playerNbt) {
  if (!playerNbt) return null;
  const attributes = {};
  for (const attribute of asArray(playerNbt.Attributes)) {
    const name = attribute?.Name ?? attribute?.name;
    if (!name) continue;
    attributes[name] = { base: attribute.Base ?? attribute.base ?? null, modifiers: asArray(attribute.Modifiers).length };
  }
  return {
    health: playerNbt.Health ?? null,
    foodLevel: playerNbt.foodLevel ?? null,
    experienceLevel: playerNbt.XpLevel ?? null,
    selectedItemSlot: playerNbt.SelectedItemSlot ?? null,
    attributes
  };
}

function latestSnapshotForPlayer(data, uuid) {
  const entry = keyedEntry(data?.Players, uuid);
  const snapshots = asArray(entry?.Value?.timestampedSnapshots);
  if (!snapshots.length) return null;
  return snapshots.reduce((latest, current) => !latest || Number(current?.Key || 0) > Number(latest?.Key || 0) ? current : latest, null);
}

function extractSnapshotEquipment(data, uuid) {
  const snapshot = latestSnapshotForPlayer(data, uuid);
  if (!snapshot?.Value) return null;
  const value = snapshot.Value;
  const invIds = asArray(value.InvIds);
  const items = asArray(value.Items);
  const slotNames = new Map([[36,"boots"],[37,"leggings"],[38,"chestplate"],[39,"helmet"],[40,"offhand"]]);
  const equipment = [];
  const hotbar = [];

  for (let index = 0; index < Math.min(invIds.length, items.length); index += 1) {
    const invId = Number(invIds[index]);
    const item = items[index];
    if (slotNames.has(invId)) {
      const simplified = simplifyItem(item, slotNames.get(invId));
      if (simplified) equipment.push(simplified);
    }
    if (invId >= 0 && invId <= 8) {
      const simplified = simplifyItem(item, `hotbar_${invId}`);
      if (simplified) hotbar.push(simplified);
    }
  }

  const curios = [];
  const curiosRoot = value?.customData?.curios || {};
  for (const [curioSlot, entries] of Object.entries(curiosRoot)) {
    if (!entries || typeof entries !== "object") continue;
    for (const [index, item] of Object.entries(entries)) {
      const simplified = simplifyItem(item, `${curioSlot}_${index}`);
      if (simplified) curios.push({ ...simplified, ...curioSlotInfo(curioSlot + "_" + index) });
    }
  }
  return { timestamp: snapshot.Key ?? null, equipment, hotbar, curios };
}

function extractPlayerCurios(playerNbt) {
  const entries = asArray(playerNbt?.ForgeCaps?.["curios:inventory"]?.Curios);
  const items = [];
  for (const entry of entries) {
    if (!entry?.Identifier) continue;
    // Functional stacks only. Cosmetic stacks and backpack contents are not gear.
    for (const stack of asArray(entry.Stacks?.Items)) {
      const slotInfo = curioSlotInfo(entry.Identifier + "_" + Number(stack.Slot ?? 0));
      const item = simplifyItem(stack,slotInfo.slot);
      if (item) items.push({ ...item, ...slotInfo });
    }
  }
  return items;
}

function selectGearRecord({uuid, playerNbt, playerSource, logoutData, exactSnapshot}) {
  const rawExact = exactSnapshot?.data;
  const validExact = rawExact?.equipment && typeof rawExact.equipment === "object" && !Array.isArray(rawExact.equipment)
    && (!rawExact.playerUUID || sameUuid(rawExact.playerUUID,uuid));
  let snapshot, source = null, kind = "unavailable";
  const logout = extractSnapshotEquipment(logoutData,uuid);
  const entryTimestamp=toNumber(rawExact?.timestamp),logoutTimestamp=toNumber(logout?.timestamp);
  // Dated captures compete by timestamp. A stale PlayerSnapshotDump must not
  // hide a newer complete logout, companion or deck. Never mix their items.
  const newerLogout=entryTimestamp>0 && logoutTimestamp>entryTimestamp;
  if (validExact && !newerLogout) {
    const exact = extractExactSnapshotGear(exactSnapshot);
    snapshot = { equipment:exact.equipment, curios:exact.curios, hotbar:[], timestamp:exact.timestamp,
      exactSource:exact.source, exactGearCount:exact.all.filter(item => item.exactGearData).length };
    source = exact.source;
    // Native PlayerDataSnapshotHelper registers LISTENER_JOIN, not vault exit.
    kind = "vault-entry";
  } else {
    snapshot = logout;
    if (snapshot) { source = VAULT_FILES.logoutSnapshots; kind = "logout"; }
    else if (Array.isArray(playerNbt?.Inventory)) {
      snapshot = { equipment:extractEquipmentFromPlayerNbt(playerNbt), curios:extractPlayerCurios(playerNbt), hotbar:[], timestamp:null };
      source = playerSource;
      kind = "player-save";
    }
  }
  const gear = (snapshot?.equipment || []).filter(item => ["helmet","chestplate","leggings","boots","offhand"].includes(canonicalGearSlot(item.slot)))
    .map(item => ({ ...item, slot:canonicalGearSlot(item.slot), slotGroup:"equipment" }));
  const timestamp = toNumber(snapshot?.timestamp);
  const gearRecord = { kind, timestamp:timestamp != null && timestamp > 0 ? timestamp : null, exitVerified:false,
    equipmentCount:gear.length, curioCount:snapshot?.curios.length || 0 };
  const nativeDetails = [...gear, ...(snapshot?.curios || [])].some(item => item.modifierGroups?.nativeDecode?.status === "decoded");
  return { gear, gearSource:source, gearDetailsSource:snapshot?.exactSource || (nativeDetails ? source : null), gearRecord,
    gearSnapshot:snapshot ? { ...snapshot, equipment:gear } : null };
}

function extractAltarRecipes(data, uuid) {
  if (!data) return null;
  const blockPos = parallelValue(data, "PlayerBlockPosEntries", "BlockPosEntries", uuid);
  const recipe = parallelValue(data, "PlayerEntries", "AltarRecipeEntries", uuid);
  if (blockPos == null && recipe == null) return null;
  return { blockPos, recipe };
}

function flattenMinecraftStats(raw) {
  const out = [];
  const root = raw?.stats;
  if (!root || typeof root !== "object") return out;
  for (const [category, values] of Object.entries(root)) {
    if (!values || typeof values !== "object") continue;
    for (const [key, value] of Object.entries(values)) {
      const number = toNumber(value);
      if (number == null) continue;
      const search = `${category} ${key}`.toLowerCase();
      out.push({ category, key, value: number, search, compact: normalizeSearch(search).compact, source: "minecraft-stats", path: `${category}.${key}` });
    }
  }
  return out;
}

function rowHas(row, token) {
  const normalized = normalizeSearch(token);
  return row.search.includes(normalized.text) || row.compact?.includes(normalized.compact);
}

function pickStatRow(rows, required, preferred = [], rejected = []) {
  const matches = rows.filter(row =>
    required.every(token => rowHas(row, token)) &&
    !rejected.some(token => rowHas(row, token))
  );
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const ap = preferred.reduce((n, token) => n + (rowHas(a, token) ? 1 : 0), 0);
    const bp = preferred.reduce((n, token) => n + (rowHas(b, token) ? 1 : 0), 0);
    return bp - ap || a.search.length - b.search.length;
  });
  return matches[0];
}

function pickStat(rows, required, preferred = [], rejected = []) {
  return pickStatRow(rows, required, preferred, rejected)?.value ?? null;
}

function pickFirstStatRow(rows, patterns, preferred = [], rejected = []) {
  for (const required of patterns) {
    const hit = pickStatRow(rows, required, preferred, rejected);
    if (hit) return hit;
  }
  return null;
}

const STAT_PATTERNS = {
  vaultsCompleted: [
    ["vaults", "completed"], ["vault", "completed"], ["vault", "complete"], ["vault", "completion"],
    ["vault", "finished"], ["vault", "finish"], ["vault", "success"], ["vault", "victory"],
    ["vault", "won"], ["vault", "win"]
  ],
  chestsLooted: [
    ["chests", "looted"], ["chest", "looted"], ["chest", "loot"], ["chest", "opened"], ["chest", "open"]
  ],
  treasureRooms: [
    ["treasure", "rooms"], ["treasure", "room"], ["treasure", "opened"], ["treasure", "complete"]
  ],
  dungeonsConquered: [
    ["dungeons", "conquered"], ["dungeon", "conquer"], ["dungeon", "completed"], ["dungeon", "complete"], ["dungeon", "finished"]
  ],
  vendorsOpened: [
    ["vendors", "opened"], ["vendor", "opened"], ["vendor", "open"], ["vendor", "used"], ["vendor", "use"]
  ],
  pylonsActivated: [
    ["pylons", "activated"], ["pylon", "activated"], ["pylon", "activate"], ["pylon", "used"], ["pylon", "use"],
    ["pylon", "triggered"], ["pylon", "trigger"], ["pylon", "claimed"]
  ],
  pylonsBroken: [
    ["pylons", "broken"], ["pylon", "broken"], ["pylon", "break"], ["pylon", "destroyed"], ["pylon", "destroy"],
    ["pylon", "mined"], ["pylon", "mine"]
  ]
};

const STAT_REJECTED = {
  vaultsCompleted: ["bounty", "quest", "crystal", "recipe", "level", "exp", "experience", "cooldown", "chance"],
  chestsLooted: ["chance", "tier", "cost", "bonus"],
  treasureRooms: ["chance", "tier", "cost", "bonus"],
  dungeonsConquered: ["chance", "tier", "cost", "bonus"],
  vendorsOpened: ["chance", "tier", "cost", "bonus"],
  pylonsActivated: ["duration", "cooldown", "chance", "tier", "cost", "buff"],
  pylonsBroken: ["duration", "cooldown", "chance", "tier", "cost", "buff"]
};

function findCounterRows(rows) {
  const result = {};
  for (const [key, patterns] of Object.entries(STAT_PATTERNS)) {
    result[key] = pickFirstStatRow(rows, patterns, ["total", "count", "stat", "counter"], STAT_REJECTED[key] || []);
  }
  return result;
}

function counterSource(row) {
  if (!row) return null;
  return { source: row.source ?? null, path: row.path ?? row.key ?? null, value: row.value };
}

function buildObjectiveStats(rows) {
  const defs = {
    rune_boss: ["rune_boss", "runeboss", "rune boss"],
    monolith: ["monolith"],
    elixir: ["elixir"],
    vault_royale: ["vault_royale", "vaultroyale", "royale"],
    cake: ["cake"],
    bingo: ["bingo"],
    rebirth: ["rebirth"],
    personal: ["personal"],
    scavenger: ["scavenger", "scav"]
  };

  const statusValue = (related, aliases) => {
    const matches = related.filter(row => aliases.some(alias => rowHas(row, alias)));
    if (!matches.length) return null;
    return matches.reduce((total, row) => total + Number(row.value || 0), 0);
  };

  const result = [];
  for (const [id, aliases] of Object.entries(defs)) {
    const related = rows.filter(row => aliases.some(alias => rowHas(row, alias)));
    if (!related.length) continue;

    const won = statusValue(related, ["won", "win", "wins", "complete", "completed", "completion", "finish", "finished", "success", "victory"]);
    const bailed = statusValue(related, ["bail", "bailed", "escape", "escaped", "exit", "exited"]);
    const failed = statusValue(related, ["fail", "failed", "failure", "death", "died", "lost", "loss"]);

    if (won != null || bailed != null || failed != null) {
      result.push({ id, name: titleCase(id), won, bailed, failed });
    }
  }
  return result;
}

function extractMinecraftStatistics(raw) {
  if (!raw) {
    return {
      available: false,
      mobKills: null,
      playerKills: null,
      deaths: null,
      damageDealt: null,
      damageTaken: null,
      killedByEntity: [],
      vaultsCompleted: null,
      chestsLooted: null,
      treasureRooms: null,
      dungeonsConquered: null,
      vendorsOpened: null,
      pylonsActivated: null,
      pylonsBroken: null,
      objectives: [],
      customVaultStats: [],
      statSources: {}
    };
  }

  const rows = flattenMinecraftStats(raw);
  const killed = raw?.stats?.["minecraft:killed"] || {};
  const killedEntries = Object.entries(killed)
    .filter(([,value]) => toNumber(value) != null)
    .map(([entity, value]) => ({ entity, name: titleCase(entity.split(":").at(-1)), count: Number(value) }))
    .sort((a,b) => b.count - a.count);
  const killedSum = killedEntries.reduce((sum, row) => sum + row.count, 0);
  const standardCustom = raw?.stats?.["minecraft:custom"] || {};

  // Some Vault Hunters versions put their counters under minecraft:custom,
  // others register a the_vault:* stat category. Search both without assuming
  // one exact key spelling.
  const vaultRows = rows.filter(row =>
    row.category.startsWith("the_vault:") ||
    row.key.startsWith("the_vault:") ||
    row.search.includes("vault") ||
    /(pylon|monolith|elixir|bingo|scav|royale|rebirth|treasure|dungeon|vendor)/.test(row.search)
  );
  const counters = findCounterRows(vaultRows);

  return {
    available: true,
    mobKills: toNumber(standardCustom["minecraft:mob_kills"]) ?? killedSum,
    playerKills: toNumber(standardCustom["minecraft:player_kills"]) ?? 0,
    deaths: toNumber(standardCustom["minecraft:deaths"]) ?? 0,
    damageDealt: toNumber(standardCustom["minecraft:damage_dealt"]) ?? 0,
    damageTaken: toNumber(standardCustom["minecraft:damage_taken"]) ?? 0,
    killedByEntity: killedEntries.slice(0, 30),
    vaultsCompleted: counters.vaultsCompleted?.value ?? null,
    chestsLooted: counters.chestsLooted?.value ?? null,
    treasureRooms: counters.treasureRooms?.value ?? null,
    dungeonsConquered: counters.dungeonsConquered?.value ?? null,
    vendorsOpened: counters.vendorsOpened?.value ?? null,
    pylonsActivated: counters.pylonsActivated?.value ?? null,
    pylonsBroken: counters.pylonsBroken?.value ?? null,
    objectives: buildObjectiveStats(vaultRows),
    customVaultStats: vaultRows.map(row => ({ category: row.category, key: row.key, value: row.value })).slice(0, 300),
    statSources: Object.fromEntries(Object.entries(counters).map(([key,row]) => [key, counterSource(row)]).filter(([,value]) => value))
  };
}

function flattenNumericObject(root, source = "unknown", basePath = "") {
  const rows = [];
  const skipped = new Set(["vaultGearData","Snapshot","Items","Inventory","EnderItems","recipeBook","Brain"]);
  const contextKeys = /(id|name|type|objective|status|result|stat|god|key|category|mode)/i;

  function visit(value, path = [], depth = 0, context = []) {
    if (depth > 16 || value == null) return;
    if (typeof value === "number" && Number.isFinite(value)) {
      const joined = [basePath, ...path].filter(Boolean).join(".");
      const search = [...context, joined].filter(Boolean).join(" ").toLowerCase();
      rows.push({ source, path: joined, search, compact: normalizeSearch(search).compact, value });
      return;
    }
    if (typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 1000); i += 1) visit(value[i], path.concat(i), depth + 1, context);
      return;
    }

    const localContext = [];
    for (const [key, child] of Object.entries(value)) {
      if (!contextKeys.test(key) || typeof child !== "string" || !child.trim() || child.length > 100) continue;
      localContext.push(child.trim());
    }
    const nextContext = [...context, ...localContext].slice(-8);

    for (const [key, child] of Object.entries(value)) {
      if (skipped.has(key)) continue;
      visit(child, path.concat(key), depth + 1, nextContext);
    }
  }
  visit(root);
  return rows;
}

function getPlayerScopes(root, uuid) {
  const scopes = [];
  const seen = new Set();
  const add = (value, path = "", reason = "") => {
    if (value == null) return;
    if (typeof value !== "object") {
      scopes.push({ value: { value }, path, reason });
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    scopes.push({ value, path, reason });
  };

  function visit(value, path = [], depth = 0) {
    if (!value || typeof value !== "object" || depth > 12) return;

    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 2000); i += 1) visit(value[i], path.concat(i), depth + 1);
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (sameUuid(key, uuid)) add(child, path.concat(key).join("."), "uuid-key");
    }

    const identityKeys = ["uuid","UUID","player","Player","playerId","playerID","playerUuid","playerUUID","Key","key","owner","Owner"];
    const identities = identityKeys.filter(key => sameUuidValue(value[key], uuid));
    if (identities.length) {
      const payload = value.Value ?? value.value ?? value.Data ?? value.data ?? value;
      add(payload, path.join("."), `identity:${identities.join(",")}`);
    }

    // Vault Hunters often stores player UUIDs in one list and payloads in a
    // sibling list using the same index (Players[i] -> Abilities[i], etc.).
    for (const [listKey, list] of Object.entries(value)) {
      if (!Array.isArray(list)) continue;
      for (let index = 0; index < Math.min(list.length, 2000); index += 1) {
        if (!sameUuidValue(list[index], uuid)) continue;
        for (const [siblingKey, sibling] of Object.entries(value)) {
          if (siblingKey === listKey || !Array.isArray(sibling) || index >= sibling.length) continue;
          const payload = sibling[index];
          if (payload != null) {
            add(payload, path.concat(siblingKey, index).join("."), `parallel:${listKey}[${index}]`);
          }
        }
      }
    }

    for (const [key, child] of Object.entries(value)) visit(child, path.concat(key), depth + 1);
  }

  visit(root);
  return scopes;
}

function pickAnyStat(rows, tokenSets, preferred = []) {
  for (const required of tokenSets) {
    const value = pickStat(rows, required, preferred);
    if (value != null) return value;
  }
  return null;
}

function extractEmbeddedVaultStatistics(playerNbt, sources, uuid) {
  const rows = [];
  appendRows(rows, flattenNumericObject(playerNbt, "playerdata"));

  const candidates = [
    ["vaultPlayerStats", dataOf(sources?.vaultPlayerStats)],
    ["playerPylons", dataOf(sources?.pylons)],
    ["playerStats", dataOf(sources?.playerStats)],
    ["godAltars", dataOf(sources?.godAltars)],
    ["influences", dataOf(sources?.influences)]
  ];
  for (const [name, root] of candidates) {
    if (!root) continue;
    const scopes = getPlayerScopes(root, uuid);
    for (const scope of scopes) appendRows(rows, flattenNumericObject(scope.value, name, scope.path));
  }

  const relevantRows = rows.filter(row =>
    /(vault|pylon|objective|monolith|elixir|bingo|cake|royale|rebirth|scav|treasure|dungeon|vendor)/.test(row.search)
  );
  const counters = findCounterRows(relevantRows);
  const objectiveRows = relevantRows.filter(row => /(monolith|elixir|bingo|cake|royale|rebirth|scav|rune.?boss|personal)/.test(row.search));

  return {
    vaultsCompleted: counters.vaultsCompleted?.value ?? null,
    chestsLooted: counters.chestsLooted?.value ?? null,
    treasureRooms: counters.treasureRooms?.value ?? null,
    dungeonsConquered: counters.dungeonsConquered?.value ?? null,
    vendorsOpened: counters.vendorsOpened?.value ?? null,
    pylonsActivated: counters.pylonsActivated?.value ?? null,
    pylonsBroken: counters.pylonsBroken?.value ?? null,
    objectives: buildObjectiveStats(objectiveRows),
    statSources: Object.fromEntries(Object.entries(counters).map(([key,row]) => [key, counterSource(row)]).filter(([,value]) => value)),
    diagnosticRows: relevantRows.slice(0, 300)
  };
}

function collectDynamicPlayerRows(dynamicSources, uuid) {
  const rows = [];
  const scopedFiles = new Set();
  const likelyStatSource = /(stat|pylon|influence|altar|vault|challenge|objective|history|record|goal)/i;

  for (const entry of dynamicSources || []) {
    if (!entry?.data || !likelyStatSource.test(entry.file || "")) continue;
    if (/the_vault_SkillAltar\.dat$/i.test(entry.file || "")) continue;
    const scopes = getPlayerScopes(entry.data, uuid);
    if (!scopes.length) continue;
    scopedFiles.add(entry.file);
    for (const scope of scopes) {
      appendRows(rows, flattenNumericObject(scope.value, entry.file, scope.path));
    }
  }
  return { rows, scopedFiles: [...scopedFiles] };
}

function extractDynamicVaultStatistics(dynamicSources, uuid) {
  const { rows, scopedFiles } = collectDynamicPlayerRows(dynamicSources, uuid);
  const relevantRows = rows.filter(row =>
    /(vault|pylon|objective|monolith|elixir|bingo|cake|royale|rebirth|scav|treasure|dungeon|vendor)/.test(row.search)
  );
  const counters = findCounterRows(relevantRows);
  const objectiveRows = relevantRows.filter(row => /(monolith|elixir|bingo|cake|royale|rebirth|scav|rune.?boss|personal)/.test(row.search));

  return {
    vaultsCompleted: counters.vaultsCompleted?.value ?? null,
    chestsLooted: counters.chestsLooted?.value ?? null,
    treasureRooms: counters.treasureRooms?.value ?? null,
    dungeonsConquered: counters.dungeonsConquered?.value ?? null,
    vendorsOpened: counters.vendorsOpened?.value ?? null,
    pylonsActivated: counters.pylonsActivated?.value ?? null,
    pylonsBroken: counters.pylonsBroken?.value ?? null,
    objectives: buildObjectiveStats(objectiveRows),
    statSources: Object.fromEntries(Object.entries(counters).map(([key,row]) => [key, counterSource(row)]).filter(([,value]) => value)),
    diagnosticRows: relevantRows.slice(0, 500),
    scopedFiles
  };
}

function mergeObjectiveLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      const id = row.id || row.name;
      if (!id) continue;
      const current = map.get(id) || { id, name: row.name || titleCase(id), won: null, bailed: null, failed: null };
      for (const key of ["won","bailed","failed"]) {
        if (current[key] == null && row[key] != null) current[key] = row[key];
      }
      map.set(id, current);
    }
  }
  return [...map.values()];
}

function mergeStatistics(primary, ...fallbacks) {
  const merged = { ...(primary || {}) };
  merged.statSources = { ...(primary?.statSources || {}) };
  const objectiveLists = [primary?.objectives || []];
  const diagnosticRows = [];
  const scopedFiles = new Set();

  for (const fallback of fallbacks) {
    if (!fallback) continue;
    for (const key of ["vaultsCompleted","chestsLooted","treasureRooms","dungeonsConquered","vendorsOpened","pylonsActivated","pylonsBroken"]) {
      if (merged[key] == null && fallback[key] != null) {
        merged[key] = fallback[key];
        if (fallback.statSources?.[key]) merged.statSources[key] = fallback.statSources[key];
      }
    }
    objectiveLists.push(fallback.objectives || []);
    appendRows(diagnosticRows, fallback.diagnosticRows || []);
    for (const file of fallback.scopedFiles || []) scopedFiles.add(file);
  }

  merged.objectives = mergeObjectiveLists(...objectiveLists);
  merged.embeddedVaultStats = diagnosticRows.slice(0, 600);
  merged.scannedVaultFiles = [...scopedFiles];
  return merged;
}

function exactGodName(value, god) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/^the_vault:/, "");
  return normalized === god || normalized.endsWith(`_${god}`) || normalized.endsWith(`/${god}`);
}

function findStrictGodReputation(root, god) {
  let found = null;
  const repNames = new Set(["reputation", "rep"]);
  const identityNames = new Set(["god", "vaultgod", "godid", "god_id"]);
  const directGodKeys = new Set([
    god,
    `${god}reputation`, `${god}_reputation`, `${god}rep`, `${god}_rep`
  ]);

  function numericRepFromObject(object) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return null;
    for (const [key, value] of Object.entries(object)) {
      if (!repNames.has(String(key).toLowerCase())) continue;
      const number = toNumber(value);
      if (number != null) return number;
    }
    return null;
  }

  function visit(value) {
    if (found != null || value == null) return;
    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child);
        if (found != null) return;
      }
      return;
    }
    if (typeof value !== "object") return;

    // Schema 1: explicit key such as idonaReputation / idona_reputation.
    for (const [key, child] of Object.entries(value)) {
      const lower = String(key).toLowerCase();
      const compact = lower.replace(/[^a-z0-9_]/g, "");
      if (!directGodKeys.has(lower) && !directGodKeys.has(compact)) continue;
      const direct = toNumber(child);
      if (direct != null) { found = direct; return; }
      const nested = numericRepFromObject(child);
      if (nested != null) { found = nested; return; }
    }

    // Schema 2: { god: "idona", reputation: 4 }. Intentionally do not
    // accept influence/points/level/value here; those produced false matches
    // in previous versions and are not proof of Vault God reputation.
    let identityMatches = false;
    for (const [key, child] of Object.entries(value)) {
      if (!identityNames.has(String(key).toLowerCase())) continue;
      if (exactGodName(child, god)) { identityMatches = true; break; }
    }
    if (identityMatches) {
      const rep = numericRepFromObject(value);
      if (rep != null) { found = rep; return; }
    }

    for (const child of Object.values(value)) {
      visit(child);
      if (found != null) return;
    }
  }

  visit(root);
  return found;
}

function recordHasPlayerUuid(value, uuid, depth = 0) {
  if (depth > 5 || value == null) return false;
  if (sameUuidValue(value, uuid)) return true;
  if (Array.isArray(value)) return value.some(child => recordHasPlayerUuid(child, uuid, depth + 1));
  if (typeof value !== "object") return false;
  return Object.values(value).some(child => recordHasPlayerUuid(child, uuid, depth + 1));
}

function extractReputation(influenceData, _minecraftStatsRaw, uuid) {
  // Exact schema from PlayerReputationData in the Vault Hunters JAR:
  // data.entries[] -> { Key: UUID, Value: { Reputations: [{ God, Reputation }], Version } }
  // If the player or a god entry is absent, PlayerReputationData#getReputation
  // returns zero. No heuristic influence/altar counters are accepted here.
  const values = { idona: 0, tenos: 0, velara: 0, wendarr: 0 };
  const valueSources = {};
  let matchedPlayer = false;

  const entries = asArray(influenceData?.entries);
  for (const entry of entries) {
    const key = entry?.Key ?? entry?.key ?? entry?.UUID ?? entry?.uuid ?? entry?.Player ?? entry?.player;
    if (!sameUuidValue(key, uuid)) continue;
    matchedPlayer = true;
    const payload = entry?.Value ?? entry?.value ?? entry?.Data ?? entry?.data ?? entry;
    const reputations = asArray(payload?.Reputations ?? payload?.reputations);
    for (const row of reputations) {
      const god = String(row?.God ?? row?.god ?? "").trim().toLowerCase().replace(/^the_vault:/, "");
      const value = toNumber(row?.Reputation ?? row?.reputation);
      if (!GODS.includes(god) || value == null) continue;
      values[god] = value;
      valueSources[god] = `${VAULT_FILES.influences} -> entries[UUID].Value.Reputations`;
    }
    break;
  }

  return {
    ...values,
    detected: matchedPlayer,
    defaultsToZero: true,
    source: VAULT_FILES.influences,
    valueSources,
    schema: "PlayerReputationData"
  };
}

function collectUuidsFromSources(playerFiles, sources) {
  const found = new Map();
  const add = value => {
    if (typeof value !== "string" || !normUuid(value)) return;
    if (!found.has(normUuid(value))) found.set(normUuid(value), cleanUuid(value));
  };
  for (const file of playerFiles) add(file.uuid);
  const levelData = dataOf(sources.levels);
  asArray(levelData?.PlayerEntries).forEach(add);
  Object.keys(dataOf(sources.savedBuilds)?.playerSkillTemplates || {}).forEach(add);
  for (const key of ["abilities","talents","expertises","prestige"]) asArray(dataOf(sources[key])?.Players).forEach(add);
  const researchData = dataOf(sources.researches);
  if (researchData) Object.keys(researchData).forEach(add);
  asArray(dataOf(sources.playerStats)?.Stats).forEach(entry => add(entry?.Key));
  asArray(dataOf(sources.logoutSnapshots)?.Players).forEach(entry => add(entry?.Key));
  Object.values(dataOf(sources.companions)?.data || {}).forEach(entry=>add(entry?.owner));
  Object.keys(dataOf(sources.quests) || {}).forEach(add);
  for(const group of ["active","available","complete","legendary"])Object.keys(dataOf(sources.bounties)?.[group] || {}).forEach(add);
  for(const key of ["models","themes"])Object.keys(dataOf(sources[`discovered_${key}`])||{}).forEach(add);
  for(const key of ["trinkets","artifacts"])asArray(dataOf(sources[`discovered_${key}`])?.[key]).forEach(row=>add(nativeUuid(row.player)));
  asArray(dataOf(sources.discovered_goals)?.PlayersList).forEach(add);
  Object.keys(dataOf(sources.discovered_emblems)?.Emblems || {}).forEach(add);
  Object.keys(dataOf(sources.discovered_trails)?.Trails || {}).forEach(add);
  for(const kind of ["Prefixes","Suffixes"])Object.keys(dataOf(sources.discovered_titles)?.[kind]||{}).forEach(add);
  return [...found.values()];
}

function sourceListForPlayer(sources, uuid, playerdataPath, hasStatsJson) {
  const result = [];
  if (playerdataPath) result.push(playerdataPath);
  const checks = [
    ["savedBuilds", data => Object.keys(data?.playerSkillTemplates || {}).some(key => sameUuid(key,uuid))],
    ["levels", data => !!parallelValue(data,"PlayerEntries","StatEntries",uuid)],
    ["abilities", data => !!parallelValue(data,"Players","Abilities",uuid)],
    ["talents", data => !!parallelValue(data,"Players","Talents",uuid)],
    ["expertises", data => !!parallelValue(data,"Players","Expertises",uuid)],
    ["researches", data => Object.keys(data || {}).some(key => sameUuid(key,uuid))],
    ["playerStats", data => !!keyedEntry(data?.Stats,uuid)],
    ["blackMarket", data => !!parallelValue(data,"playerList","blackMarketList",uuid)],
    ["prestige", data => !!parallelValue(data,"Players","Prestige",uuid)],
    ["spiritRecovery", data => Object.keys(data?.spiritRecoveryMultipliers || {}).some(key => sameUuid(key,uuid))],
    ["customNames", data => !!keyedEntry(data?.entries,uuid)],
    ["logoutSnapshots", data => !!keyedEntry(data?.Players,uuid)],
    ["influences", data => !!data],
    ["vaultPlayerStats", data => !!keyedEntry(data?.pending,uuid)],
    ["godAltars", data => !!data],
    ["pylons", data => !!data]
  ];
  for (const [key,predicate] of checks) {
    const data = dataOf(sources[key]);
    if (data && predicate(data)) result.push(VAULT_FILES[key]);
  }
  if (hasStatsJson) result.push(`stats/${cleanUuid(uuid)}.json`);
  return [...new Set(result)];
}



// ---------------- v11: character attributes + vault history ----------------
const ATTRIBUTE_DEFS = [
  { re: /ability.?power/i, label: "Ability Power", group: "offense" },
  { re: /attack.?damage/i, label: "Attack Damage", group: "offense" },
  { re: /attack.?range|reach.?distance/i, label: "Attack Range", group: "offense" },
  { re: /attack.?speed/i, label: "Attack Speed", group: "offense" },
  { re: /chaining/i, label: "Chaining", group: "offense" },
  { re: /increased.?damage|damage.?increase/i, label: "Increased Damage", group: "offense", percent: true },
  { re: /lucky.?hit.?chance/i, label: "Lucky Hit Chance", group: "offense", percent: true },
  { re: /stun.?attack.?chance|stun.?chance/i, label: "Stun Attack Chance", group: "offense", percent: true },
  { re: /thorns.?damage/i, label: "Thorns Damage", group: "offense" },
  { re: /critical.?hit.?resistance|crit.?hit.?resistance/i, label: "Crit Hit Resistance", group: "defense", percent: true },
  { re: /knockback.?resistance/i, label: "Knockback Resist", group: "defense", percent: true },
  { re: /armor.?toughness/i, label: "Armor Toughness", group: "defense" },
  { re: /(^|[.:_/])armor($|[.:_/])/i, label: "Armor", group: "defense" },
  { re: /max.?health/i, label: "Max Health", group: "defense" },
  { re: /(^|[.:_/])health($|[.:_/])/i, label: "Health", group: "defense" },
  { re: /cooldown.?reduction/i, label: "Cooldown Reduction", group: "utility", percent: true },
  { re: /healing.?efficiency/i, label: "Healing Efficiency", group: "utility", percent: true },
  { re: /mana.?regen/i, label: "Mana Regen", group: "utility", percent: true },
  { re: /(^|[.:_/])mana($|[.:_/])/i, label: "Mana", group: "utility" },
  { re: /movement.?speed/i, label: "Movement Speed", group: "utility" },
  { re: /step.?height/i, label: "Step Height", group: "utility" },
  { re: /reach/i, label: "Reach", group: "utility" }
];

function normalizeAttributeName(value) {
  return String(value || "").toLowerCase().replace(/^attribute\./, "").replace(/^generic\./, "");
}

function attributeDef(value) {
  const text = normalizeAttributeName(value);
  return ATTRIBUTE_DEFS.find(def => def.re.test(text)) || null;
}

function effectiveAttributeValue(attribute) {
  let base = toNumber(attribute?.Base ?? attribute?.base ?? attribute?.value ?? attribute?.Value);
  if (base == null) return null;
  const modifiers = asArray(attribute?.Modifiers ?? attribute?.modifiers);
  const op0 = modifiers.filter(m => Number(m?.Operation ?? m?.operation ?? 0) === 0).reduce((sum,m) => sum + Number(m?.Amount ?? m?.amount ?? 0), 0);
  const op1 = modifiers.filter(m => Number(m?.Operation ?? m?.operation ?? 0) === 1).reduce((sum,m) => sum + Number(m?.Amount ?? m?.amount ?? 0), 0);
  const op2 = modifiers.filter(m => Number(m?.Operation ?? m?.operation ?? 0) === 2);
  let value = base + op0;
  value += base * op1;
  for (const modifier of op2) value *= 1 + Number(modifier?.Amount ?? modifier?.amount ?? 0);
  return Number.isFinite(value) ? value : null;
}

function formatAttributeRaw(value, def) {
  if (value == null) return null;
  if (def?.percent) {
    const percent = Math.abs(value) <= 5 ? value * 100 : value;
    return { value, displayValue: `${Number(percent.toFixed(2))}%`, percent: true };
  }
  return { value, displayValue: String(Number(value.toFixed(4))), percent: false };
}


function snapshotNumericMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    let n = null;
    if (typeof raw === "number") n = raw;
    else if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) n = Number(raw);
    else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const candidate = raw.value ?? raw.Value ?? raw.amount ?? raw.Amount;
      if (candidate != null && Number.isFinite(Number(candidate))) n = Number(candidate);
    }
    if (n != null && Number.isFinite(n)) out[String(key)] = n;
  }
  return out;
}

function snapshotLookup(map, patterns) {
  const entries = Object.entries(map || {});
  for (const pattern of patterns) {
    const hit = entries.find(([key]) => pattern.test(String(key)));
    if (hit) return { key: hit[0], value: Number(hit[1]) };
  }
  return null;
}

function buildSnapshotStat(label, group, hit, source, options = {}) {
  if (!hit || !Number.isFinite(Number(hit.value))) return null;
  let value = Number(hit.value);
  let displayValue;
  if (options.percent) {
    const percent = options.multiplierPercent === false ? value : (Math.abs(value) <= 5 ? value * 100 : value);
    displayValue = `${Number(percent.toFixed(2))}%`;
  } else if (options.scale != null) {
    value *= Number(options.scale);
    displayValue = String(Number(value.toFixed(options.decimals ?? 2)));
  } else {
    displayValue = String(Number(value.toFixed(options.decimals ?? 4)));
  }
  return {
    id: hit.key,
    label,
    group,
    value,
    displayValue,
    percent: !!options.percent,
    source: source?.source || null,
    path: `${options.mapName || "snapshot"}.${hit.key}`,
    confidence: "exact",
    exactRuntime: true
  };
}

function extractCharacterStatsFromVaultSnapshot(snapshotInfo) {
  const snapshot = snapshotInfo?.data;
  if (!snapshot || typeof snapshot !== "object") return null;

  const vanilla = snapshotNumericMap(snapshot.vanillaAttributes);
  const gear = snapshotNumericMap(snapshot.gearAttributes);
  if (!Object.keys(vanilla).length && !Object.keys(gear).length && nativeNumeric(snapshot.summaryAttributes?.dps)==null && nativeNumeric(snapshot.summaryAttributes?.defense)==null) return null;

  const source = { source: snapshotInfo.source };
  const rows = [];
  for (const [key,label,group,percent] of [["dps","DPS","offense",false],["defense","Defense","defense",true]]) {
    const value=nativeNumeric(snapshot.summaryAttributes?.[key]);
    if(value!=null) rows.push({id:`summary:${key}`,label,group,value,percent,
      displayValue:percent ? `${(value*100).toFixed(1)}%` : value.toFixed(2),
      source:snapshotInfo.source,path:`summaryAttributes.${key}`,confidence:"exact",exactRuntime:true});
  }
  const add = row => { if (row) rows.push(row); };

  // Vanilla/Forge attributes are already final runtime values in
  // PlayerSnapshotDump (AttributeMap#getValue), including equipped gear.
  add(buildSnapshotStat("Attack Damage", "offense", snapshotLookup(vanilla, [/minecraft:generic\.attack_damage$/i, /generic\.attack_damage$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Attack Range", "offense", snapshotLookup(vanilla, [/forge:attack_range$/i, /attack_range$/i, /forge:reach_distance$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Attack Speed", "offense", snapshotLookup(vanilla, [/minecraft:generic\.attack_speed$/i, /generic\.attack_speed$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Armor", "defense", snapshotLookup(vanilla, [/minecraft:generic\.armor$/i, /generic\.armor$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Armor Toughness", "defense", snapshotLookup(vanilla, [/armor_toughness$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Knockback Resist", "defense", snapshotLookup(vanilla, [/knockback_resistance$/i]), source, { mapName:"vanillaAttributes", percent:true, mapName:"vanillaAttributes" }));
  add(buildSnapshotStat("Max Health", "defense", snapshotLookup(vanilla, [/minecraft:generic\.max_health$/i, /generic\.max_health$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Movement Speed", "utility", snapshotLookup(vanilla, [/minecraft:generic\.movement_speed$/i, /generic\.movement_speed$/i]), source, { mapName:"vanillaAttributes", decimals:3 }));
  add(buildSnapshotStat("Mana", "utility", snapshotLookup(vanilla, [/the_vault:generic\.mana_max$/i, /generic\.mana_max$/i, /mana_max$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));
  add(buildSnapshotStat("Mana Regen", "utility", snapshotLookup(vanilla, [/the_vault:generic\.mana_regen$/i, /generic\.mana_regen$/i, /mana_regen$/i]), source, { mapName:"vanillaAttributes", percent:true }));
  add(buildSnapshotStat("Reach", "utility", snapshotLookup(vanilla, [/the_vault:generic\.reach$/i, /generic\.reach$/i]), source, { mapName:"vanillaAttributes", decimals:2 }));

  // PlayerSnapshotDump deliberately stores the Vault-specific calculated
  // values below. Some are produced through helpers rather than raw sums.
  add(buildSnapshotStat("Ability Power", "offense", snapshotLookup(gear, [/ability_power$/i]), source, { mapName:"gearAttributes", decimals:2 }));
  add(buildSnapshotStat("Chaining", "offense", snapshotLookup(gear, [/on_hit_chain$/i]), source, { mapName:"gearAttributes", decimals:0 }));
  add(buildSnapshotStat("Increased Damage", "offense", snapshotLookup(gear, [/damage_increase$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Lucky Hit Chance", "offense", snapshotLookup(gear, [/lucky_hit_chance$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Stun Attack Chance", "offense", snapshotLookup(gear, [/on_hit_stun$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Thorns Damage", "offense", snapshotLookup(gear, [/thorns_damage_flat$/i]), source, { mapName:"gearAttributes", decimals:2 }));
  add(buildSnapshotStat("Crit Hit Resistance", "defense", snapshotLookup(gear, [/critical_hit_taken_reduction$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Cooldown Reduction", "utility", snapshotLookup(gear, [/cooldown_reduction$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Healing Efficiency", "utility", snapshotLookup(gear, [/healing_effectiveness$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Item Quantity", "utility", snapshotLookup(gear, [/item_quantity$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Item Rarity", "utility", snapshotLookup(gear, [/item_rarity$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Soul Quantity", "utility", snapshotLookup(gear, [/soul_quantity$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Trap Disarm Chance", "utility", snapshotLookup(gear, [/trap_disarming$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Copiously", "utility", snapshotLookup(gear, [/copiously$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Mining Speed", "utility", snapshotLookup(gear, [/(^|:)mining_speed$/i]), source, { mapName:"gearAttributes", decimals:2 }));
  add(buildSnapshotStat("Mining Speed Bonus", "utility", snapshotLookup(gear, [/mining_speed_percent$/i]), source, { mapName:"gearAttributes", percent:true }));
  add(buildSnapshotStat("Block Chance", "defense", snapshotLookup(gear, [/(^|:)block$/i]), source, { mapName:"gearAttributes", percent:true }));

  const usedKeys = new Set(rows.map(row => row.id));
  for (const [key, value] of Object.entries(gear)) {
    if (usedKeys.has(key)) continue;
    const def = attributeDef(key);
    const formatted = formatAttributeRaw(value, def);
    rows.push({
      id:key,
      label:def?.label || titleCase(key.split(":").at(-1).replaceAll("_", " ")),
      group:def?.group || "other",
      value:formatted?.value ?? value,
      displayValue:formatted?.displayValue ?? String(value),
      percent:formatted?.percent ?? false,
      source:snapshotInfo.source,
      path:`gearAttributes.${key}`,
      confidence:"exact",
      exactRuntime:true
    });
  }

  const deduped = [];
  const labels = new Set();
  for (const row of rows) {
    const k = row.label.toLowerCase();
    if (labels.has(k)) continue;
    labels.add(k);
    deduped.push(row);
  }

  const byLabel = Object.fromEntries(deduped.map(row => [row.label, row]));
  return {
    available: deduped.length > 0,
    exactRuntime: true,
    sourceKind: "the_vault:PlayerSnapshotDump",
    source: snapshotInfo.source,
    snapshotTimestamp: snapshot.timestamp ?? null,
    snapshotVersion: snapshot.version ?? null,
    offense: deduped.filter(row => row.group === "offense"),
    defense: deduped.filter(row => row.group === "defense"),
    utility: deduped.filter(row => row.group === "utility"),
    other: deduped.filter(row => row.group === "other"),
    all: deduped,
    highlights: {
      attackDamage: byLabel["Attack Damage"] ?? null,
      abilityPower: byLabel["Ability Power"] ?? null,
      armor: byLabel["Armor"] ?? null,
      maxHealth: byLabel["Max Health"] ?? null
    },
    raw: {
      vanillaAttributeCount: Object.keys(vanilla).length,
      gearAttributeCount: Object.keys(gear).length
    }
  };
}

function extractCharacterStats(playerNbt) {
  const found = new Map();
  const push = (id, value, source, forceDef = null) => {
    if (value == null || !Number.isFinite(Number(value))) return;
    const def = forceDef || attributeDef(id);
    const label = def?.label || titleCase(String(id || "Attribute").split(":").at(-1));
    const key = label.toLowerCase();
    const formatted = formatAttributeRaw(Number(value), def);
    if (!formatted) return;
    const existing = found.get(key);
    // Direct Minecraft/Forge Attributes are stronger than recursive capability guesses.
    if (existing && existing.confidence === "high" && source?.confidence !== "high") return;
    found.set(key, {
      id: String(id || label), label, group: def?.group || "other",
      value: formatted.value, displayValue: formatted.displayValue,
      percent: formatted.percent, source: source?.source || null,
      path: source?.path || null, confidence: source?.confidence || "medium"
    });
  };

  for (const [index, attribute] of asArray(playerNbt?.Attributes).entries()) {
    const id = attribute?.Name ?? attribute?.name;
    if (!id) continue;
    push(id, effectiveAttributeValue(attribute), { source: "playerdata", path: `Attributes.${index}`, confidence: "high" });
  }
  if (playerNbt?.Health != null) push("health", Number(playerNbt.Health), { source: "playerdata", path: "Health", confidence: "high" }, ATTRIBUTE_DEFS.find(x => x.label === "Health"));

  // Forge capabilities may persist Vault Hunters attributes outside the vanilla Attributes list.
  const capRows = flattenNumericObject(playerNbt?.ForgeCaps || {}, "playerdata", "ForgeCaps");
  for (const row of capRows) {
    const def = attributeDef(row.search);
    if (!def) continue;
    // Avoid tiers, costs and configuration-looking counters that merely mention an attribute.
    if (/(tier|cost|points?|level|required|min|max|config|chance.?weight)/i.test(row.path) && !/(attribute|attributes|value|amount|base)/i.test(row.path)) continue;
    push(row.path, Number(row.value), { source: "playerdata", path: row.path, confidence: "medium" }, def);
  }

  const all = [...found.values()].sort((a,b) => {
    const order = { offense:0, defense:1, utility:2, other:3 };
    return (order[a.group] ?? 9) - (order[b.group] ?? 9) || a.label.localeCompare(b.label);
  });
  const byLabel = Object.fromEntries(all.map(row => [row.label, row]));
  return {
    available: all.length > 0,
    offense: all.filter(row => row.group === "offense"),
    defense: all.filter(row => row.group === "defense"),
    utility: all.filter(row => row.group === "utility"),
    other: all.filter(row => row.group === "other"),
    all,
    highlights: {
      attackDamage: byLabel["Attack Damage"] ?? null,
      abilityPower: byLabel["Ability Power"] ?? null,
      armor: byLabel["Armor"] ?? null,
      maxHealth: byLabel["Max Health"] ?? null
    }
  };
}

const CHEST_TYPES = {
  wooden: { name: "Wooden", tokens: ["wooden"] },
  gilded: { name: "Gilded", tokens: ["gilded"] },
  ornate: { name: "Ornate", tokens: ["ornate"] },
  living: { name: "Living", tokens: ["living"] },
  coinPiles: { name: "Coin Piles", tokens: ["coin pile", "coin_pile", "coinpile"] }
};

function chooseChestCounter(rows, definition) {
  const candidates = rows.filter(row => {
    const hasType = definition.tokens.some(token => rowHas(row, token));
    if (!hasType) return false;
    const strongContext = rowHas(row, "chest") || rowHas(row, "loot") || rowHas(row, "open") || rowHas(row, "break") || rowHas(row, "count") || rowHas(row, "total") || definition.name === "Coin Piles";
    if (!strongContext) return false;
    return !/(chance|weight|tier|cost|bonus|config|multiplier|rarity|quantity)/i.test(row.search);
  });
  if (!candidates.length) return null;
  candidates.sort((a,b) => {
    const score = row => ["looted","opened","open","count","total","broken","mined"].reduce((n,t) => n + (rowHas(row,t) ? 2 : 0), 0) - row.path.length / 1000;
    return score(b) - score(a);
  });
  return candidates[0];
}

function extractChestBreakdownFromRows(rows) {
  const values = {};
  const sources = {};
  let any = false;
  for (const [key, def] of Object.entries(CHEST_TYPES)) {
    const row = chooseChestCounter(rows, def);
    values[key] = row ? Number(row.value) : null;
    if (row) { any = true; sources[key] = counterSource(row); }
  }
  const knownValues = Object.values(values).filter(value => value != null);
  return {
    ...values,
    total: knownValues.length ? knownValues.reduce((a,b) => a + b, 0) : null,
    detected: any,
    sources
  };
}

function normalizedObjectKeys(object) {
  const map = new Map();
  if (!object || typeof object !== "object" || Array.isArray(object)) return map;
  for (const [key,value] of Object.entries(object)) map.set(String(key).toLowerCase().replace(/[^a-z0-9]/g,""), value);
  return map;
}

function getAliasValue(object, aliases) {
  const map = normalizedObjectKeys(object);
  for (const alias of aliases) {
    const key = String(alias).toLowerCase().replace(/[^a-z0-9]/g,"");
    if (map.has(key)) return map.get(key);
  }
  return null;
}

function parseOutcome(record) {
  const explicitCompleted = getAliasValue(record,["completed","complete","finished","success","successful","won","win"]);
  const explicitFailed = getAliasValue(record,["failed","failure","died","death","lost"]);
  const explicitBailed = getAliasValue(record,["bailed","bail","escaped","escape","exited","exit"]);
  const asBool = value => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      if (/^(true|yes|1)$/i.test(value)) return true;
      if (/^(false|no|0)$/i.test(value)) return false;
    }
    return null;
  };
  const completedBool = asBool(explicitCompleted);
  const failedBool = asBool(explicitFailed);
  const bailedBool = asBool(explicitBailed);
  const status = String(getAliasValue(record,["status","result","outcome","completionStatus","exitStatus"]) ?? "").toLowerCase();
  if (completedBool === true || /(complete|completed|success|won|victory|finished)/.test(status)) return "completed";
  if (bailedBool === true || /(bail|escape|exited|survived)/.test(status)) return "bailed";
  if (failedBool === true || /(fail|death|died|lost|failure)/.test(status)) return "failed";
  if (completedBool === false && failedBool === false && bailedBool === false) return "unknown";
  return null;
}

function looksLikeVaultRun(record, path) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const keys = [...normalizedObjectKeys(record).keys()];
  const keyText = keys.join(" ");
  const pathText = String(path || "").toLowerCase();
  let score = 0;
  if (/vaultid|vaultuuid/.test(keyText)) score += 3;
  if (/objective|objectivetype/.test(keyText)) score += 2;
  if (/completed|finished|outcome|result|status|bailed|failed/.test(keyText)) score += 2;
  if (/vaultlevel|level/.test(keyText)) score += 1;
  if (/chest|wooden|gilded|ornate|living/.test(keyText)) score += 1;
  if (/(history|vaulthistory|vaults|runs|records|entries)/.test(pathText)) score += 2;
  return score >= 4;
}

function parseVaultRun(record, source, path) {
  const rows = flattenNumericObject(record, source, path);
  const chests = extractChestBreakdownFromRows(rows);
  const objectiveRaw = getAliasValue(record,["objective","objectiveType","objectiveId","objective_id","type"]);
  const vaultId = getAliasValue(record,["vaultId","vaultID","vaultUuid","vaultUUID","id"]);
  const timestamp = toNumber(getAliasValue(record,["timestamp","time","createdAt","created","startTime","endTime"]));
  const vaultLevel = toNumber(getAliasValue(record,["vaultLevel","level"]));
  const xp = toNumber(getAliasValue(record,["xp","vaultXp","experience","exp"]));
  const outcome = parseOutcome(record);
  return {
    source, path, vaultId: typeof vaultId === "string" ? vaultId : null,
    timestamp, vaultLevel, xp,
    objective: typeof objectiveRaw === "string" ? objectiveRaw.replace(/^the_vault:/,"") : null,
    outcome,
    completed: outcome === "completed" ? true : (outcome === "bailed" || outcome === "failed" ? false : null),
    chests
  };
}

function scanVaultRunRecords(root, source, basePath = "") {
  const runs = [];
  const seen = new Set();
  function visit(value, path = [], depth = 0) {
    if (!value || typeof value !== "object" || depth > 16) return;
    const fullPath = [basePath, ...path].filter(Boolean).join(".");
    if (!Array.isArray(value) && looksLikeVaultRun(value, fullPath)) {
      const key = `${source}|${fullPath}`;
      if (!seen.has(key)) { seen.add(key); runs.push(parseVaultRun(value, source, fullPath)); }
    }
    if (Array.isArray(value)) {
      for (let i=0; i<Math.min(value.length,500); i++) visit(value[i], path.concat(i), depth+1);
    } else {
      for (const [key,child] of Object.entries(value)) {
        if (["vaultGearData","Items","Inventory","EnderItems"].includes(key)) continue;
        visit(child, path.concat(key), depth+1);
      }
    }
  }
  visit(root);
  return runs;
}

function aggregateHistoryObjectives(runs) {
  const map = new Map();
  for (const run of runs) {
    if (!run.objective || !run.outcome) continue;
    const id = String(run.objective).toLowerCase().replace(/[^a-z0-9_]+/g,"_");
    const current = map.get(id) || { id, name: titleCase(id), won:0, bailed:0, failed:0 };
    if (run.outcome === "completed") current.won += 1;
    if (run.outcome === "bailed") current.bailed += 1;
    if (run.outcome === "failed") current.failed += 1;
    map.set(id,current);
  }
  return [...map.values()];
}

function extractVaultHistory(playerNbt, dynamicSources, uuid) {
  const runs = [];
  if (playerNbt) runs.push(...scanVaultRunRecords(playerNbt, "playerdata"));
  const numericRows = [];
  if (playerNbt) numericRows.push(...flattenNumericObject(playerNbt, "playerdata"));

  for (const entry of dynamicSources || []) {
    if (!entry?.data || !/(history|stat|vault|pylon|objective|challenge|record)/i.test(entry.file || "")) continue;
    const scopes = getPlayerScopes(entry.data, uuid);
    for (const scope of scopes) {
      runs.push(...scanVaultRunRecords(scope.value, entry.file, scope.path));
      numericRows.push(...flattenNumericObject(scope.value, entry.file, scope.path));
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const run of runs) {
    const key = `${run.source}|${run.path}|${run.vaultId || ""}|${run.timestamp || ""}`;
    if (seen.has(key)) continue;
    seen.add(key); deduped.push(run);
  }
  deduped.sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  const explicitOutcomeRuns = deduped.filter(run => run.outcome != null && run.outcome !== "unknown");
  const completedVaults = explicitOutcomeRuns.length ? explicitOutcomeRuns.filter(run => run.outcome === "completed").length : null;

  const runChestTotals = {};
  let chestFromRuns = false;
  for (const key of Object.keys(CHEST_TYPES)) runChestTotals[key] = 0;
  for (const run of deduped) {
    for (const key of Object.keys(CHEST_TYPES)) {
      const value = run.chests?.[key];
      if (value != null) { chestFromRuns = true; runChestTotals[key] += Number(value); }
    }
  }
  const globalChestBreakdown = extractChestBreakdownFromRows(numericRows);
  const chestBreakdown = {};
  for (const key of Object.keys(CHEST_TYPES)) {
    chestBreakdown[key] = chestFromRuns ? runChestTotals[key] : globalChestBreakdown[key];
  }
  const knownChestValues = Object.values(chestBreakdown).filter(value => value != null);
  const totalChests = knownChestValues.length ? knownChestValues.reduce((a,b) => a + Number(b),0) : null;

  return {
    detected: deduped.length > 0 || globalChestBreakdown.detected,
    totalRuns: deduped.length || null,
    completedVaults,
    chestsLooted: totalChests,
    chestBreakdown,
    chestSources: globalChestBreakdown.sources,
    objectives: aggregateHistoryObjectives(deduped),
    runs: deduped,
    sources: [...new Set(deduped.map(run => run.source).filter(Boolean))]
  };
}

function mergeHistoryIntoStatistics(statistics, history) {
  if (!statistics || !history) return statistics;
  statistics.history = history;
  statistics.chestBreakdown = history.chestBreakdown || {};
  if (statistics.vaultsCompleted == null && history.completedVaults != null) {
    statistics.vaultsCompleted = history.completedVaults;
    statistics.statSources.vaultsCompleted = { source: "vault-history", path: "history.runs[outcome=completed]", value: history.completedVaults };
  }
  if (statistics.chestsLooted == null && history.chestsLooted != null) {
    statistics.chestsLooted = history.chestsLooted;
    statistics.statSources.chestsLooted = { source: "vault-history", path: "history.chestBreakdown", value: history.chestsLooted };
  }
  statistics.objectives = mergeObjectiveLists(statistics.objectives || [], history.objectives || []);
  return statistics;
}


function mergeSnapshotHistoryIntoStatistics(statistics, history) {
  if (!statistics) statistics = {};
  statistics.statSources = { ...(statistics.statSources || {}) };
  statistics.history = history;

  // If no snapshot for this player could be decoded, keep non-history
  // counters as fallbacks, but never manufacture a run list.
  if (!history?.detected || !history?.aggregates) {
    statistics.chestBreakdown = history?.chestBreakdown || {};
    return statistics;
  }

  const a = history.aggregates;
  const set = (key, value, path) => {
    statistics[key] = value;
    const aggregateKey = { vaultsCompleted:"completedVaults", dungeonsConquered:"dungeons", damageTaken:"damageReceived" }[key] || key;
    statistics.statSources[key] = {
      ...(a.fieldSources?.[aggregateKey] || {found:value != null}),
      source: history.indexPath || "data/the_vault_VaultSnapshots.dat", path, value
    };
  };

  // These are per-Vault statistics and therefore the decoded snapshots are
  // the authoritative source when available.
  set("vaultsCompleted", a.completedVaults, "vault_snapshots[*].stats.completion");
  set("chestsLooted", a.chestsLooted, "vault_snapshots[*].stats.chests");
  set("treasureRooms", a.treasureRooms, "vault_snapshots[*].stats.treasure_rooms_opened");
  set("dungeonsConquered", a.dungeons, "vault_snapshots[*].stats.dungeons_opened");
  set("vendorsOpened", a.vendorsOpened, "vault_snapshots[*].stats.vendors_opened");
  set("pylonsActivated", a.pylonsActivated, "vault_snapshots[*].stats.used_pylons");
  set("pylonsBroken", a.pylonsBroken, "vault_snapshots[*].stats.broken_pylons");

  // Slayer numbers on the official-style page are Vault-run aggregates.
  set("mobKills", a.mobKills, "vault_snapshots[*].stats.mobs.killed");
  set("damageDealt", a.damageDealt, "vault_snapshots[*].stats.mobs.damage_dealt");
  set("damageTaken", a.damageReceived, "vault_snapshots[*].stats.mobs.damage_received");

  for (const [key, native] of Object.entries({barrels:"barrels",goldSpent:"gold_spent",dungeonAltarsFound:"dungeon_altars_found",
    phoenixGearUses:"phoenix_gear_uses",godAltarReputationEarned:"god_altar_reputation",championsKilled:"mobs",dungeonBossesKilled:"mobs"})) {
    set(key, a[key], `vault_snapshots[*].stats.${native}`);
  }
  statistics.chestBreakdown = { ...(a.chestBreakdown || {}) };
  statistics.objectives = a.objectives || [];
  if (Array.isArray(a.killedByEntity)) {
    statistics.killedByEntity = a.killedByEntity.map(row => ({
      entity: row.id,
      name: row.name,
      count: row.count
    }));
  }
  statistics.vaultsBailed = a.bailedVaults;
  statistics.vaultsFailed = a.failedVaults;
  statistics.soulShardsCollected = a.soulShardsCollected;
  statistics.godAltarCompletions = a.godAltarCompletions;
  statistics.godAltarFails = a.godAltarFails;
  return statistics;
}

async function parsePlayer(provider, uuid, relativePath = null, sources = null, errors = [], dynamicSources = null, vaultIndex = null) {
  const vaultSources = sources || await loadVaultSources(provider, errors);
  const dynamicVaultData = dynamicSources || await loadDynamicVaultData(provider, errors);
  let playerNbt = null;
  if (relativePath) {
    try { playerNbt = await parse(await provider.read(relativePath)); }
    catch (error) { errors.push({ file: relativePath, message: error.message }); }
  }

  const identity = typeof provider.resolvePlayerName === "function"
    ? await provider.resolvePlayerName(uuid)
    : { name: null, source: null };
  const minecraftStatsRaw = typeof provider.readPlayerStats === "function"
    ? await provider.readPlayerStats(uuid)
    : null;
  let exactPlayerSnapshot = typeof provider.readVaultPlayerSnapshot === "function"
    ? await provider.readVaultPlayerSnapshot(uuid)
    : null;
  if (exactPlayerSnapshot?.data?.playerUUID != null && nativeUuid(exactPlayerSnapshot.data.playerUUID) !== nativeUuid(uuid)) {
    errors.push({file:exactPlayerSnapshot.source,player:uuid,message:"PlayerSnapshot UUID mismatch"});
    exactPlayerSnapshot=null;
  }

  const levelData = dataOf(vaultSources.levels);
  const abilitiesData = dataOf(vaultSources.abilities);
  const talentsData = dataOf(vaultSources.talents);
  const expertisesData = dataOf(vaultSources.expertises);
  const researchesData = dataOf(vaultSources.researches);
  const statsData = dataOf(vaultSources.playerStats);
  const blackMarketData = dataOf(vaultSources.blackMarket);
  const prestigeData = dataOf(vaultSources.prestige);
  const spiritData = dataOf(vaultSources.spiritRecovery);
  const customNamesData = dataOf(vaultSources.customNames);
  const altarData = dataOf(vaultSources.altarRecipes);
  const snapshotData = dataOf(vaultSources.logoutSnapshots);
  const influenceData = dataOf(vaultSources.influences);
  const questData = dataOf(vaultSources.quests);
  const questState = nativeEntry(questData,uuid)?.value;
  let questConfig=null;
  if(typeof provider.readVaultQuestConfig === "function") {
    try { questConfig=await provider.readVaultQuestConfig(questState?.isSkyVaultWorld===1||questState?.isSkyVaultWorld===true); }
    catch(error) { errors.push({file:"Vault quest config",player:uuid,message:error.message});questConfig={source:"invalid-instance-config",data:{quests:[]},error:error.message}; }
  }
  const bounties=extractBounties(dataOf(vaultSources.bounties),uuid);
  const quests=extractQuests(questData,uuid,questConfig);
  if(questConfig?.error)quests.issues.push({source:questConfig.source,message:questConfig.error});
  const discoveries=extractDiscoveries(Object.fromEntries(Object.keys(DISCOVERY_FILES).map(key=>[key,dataOf(vaultSources[`discovered_${key}`])])),uuid);
  const playerSnapshot=extractPlayerSnapshot(exactPlayerSnapshot,uuid);

  const gearResult = selectGearRecord({uuid,playerNbt,playerSource:relativePath,logoutData:snapshotData,exactSnapshot:exactPlayerSnapshot});
  let companionConfig = null, modifierConfig = null;
  if (typeof provider.readVaultNativeConfig === 'function') {
    for (const name of ['companions','vault_modifiers']) {
      let config;
      try { config = await provider.readVaultNativeConfig(name); }
      catch(error) { errors.push({file:name+' config',player:uuid,message:error.message});config={data:{},source:'invalid-instance-config'}; }
      if (name === 'companions') companionConfig=config;else modifierConfig=config;
    }
  }
  // CompanionItem.getCompanion searches functional head stacks in slot order.
  // Use the same capture as Gear, including entry/logout snapshots. An empty
  // historical head must not acquire a companion from a later player save.
  const equippedCurio = (gearResult.gearSnapshot?.curios || [])
    .filter(item=>item.curioType === 'head' && item.companion)
    .sort((a,b)=>a.slotIndex-b.slotIndex)[0] || null;
  const companions = extractCompanions(dataOf(vaultSources.companions),uuid,{
    config:companionConfig,modifiers:modifierConfig,equipped:equippedCurio?.companion || null,
    equippedSource:gearResult.gearSource,
    equippedPath:equippedCurio ? gearResult.gearRecord.kind === 'vault-entry'
      ? 'equipment.'+equippedCurio.snapshotSlot+'.nbt' : 'Curios.head['+equippedCurio.slotIndex+'].tag' : null,
    equippedRecord:equippedCurio ? {kind:gearResult.gearRecord.kind,timestamp:gearResult.gearRecord.timestamp,slot:equippedCurio.slot} : null
  });
  if (equippedCurio) {
    const companion=companions.items.find(item=>item.equipped);
    if (companion) equippedCurio.companionProfile=companion;
  }
  if (typeof provider.readVaultTrinketConfig === "function") {
    try {
      const trinketConfig = await provider.readVaultTrinketConfig();
      for (const item of [...gearResult.gear, ...(gearResult.gearSnapshot?.curios || [])]) {
        applyTrinketDefinition(item, trinketConfig);
      }
      for(const item of discoveries.categories.trinkets.items) {
        const trinket={status:"identified",effectId:item.id};
        applyTrinketDefinition({trinket},trinketConfig);
        item.name=trinket.name || item.name;
        item.description=trinket.effects.join("\n") || item.description;
        item.effectSource=trinket.effectSource;
      }
    } catch (error) {
      errors.push({file:"Vault trinket config", player:uuid, message:error.message});
    }
  }
  let vault = applyXpRequirement(extractVaultProgress(levelData, uuid), null);
  if (vault.level != null && typeof provider.resolveVaultXpRequirement === "function") {
    try {
      const greedTier = exactPlayerSnapshot?.data?.greedTier;
      const xpRequirement = await provider.resolveVaultXpRequirement(vault.level, { greedTier:greedTier == null ? 0 : Number(greedTier) });
      vault = applyXpRequirement(vault, xpRequirement);
    } catch (error) {
      errors.push({ file:"Vault XP config", player:uuid, message:error.message });
      vault.xpRequirementError = error.message;
    }
  }

  const minecraftStatistics = extractMinecraftStatistics(minecraftStatsRaw);
  const dynamicStatistics = extractDynamicVaultStatistics(dynamicVaultData, uuid);
  const embeddedStatistics = extractEmbeddedVaultStatistics(playerNbt, vaultSources, uuid);

  // Vault history is authoritative only when it comes from the binary
  // VaultSnapshots format. The old generic object scanner produced false
  // positives such as CompanionEggData and is intentionally not used here.
  const vaultHistory = vaultIndex ? getPlayerVaultHistory(vaultIndex, uuid) : await decodeVaultSnapshotHistory(provider, uuid, errors);
  const statistics = mergeSnapshotHistoryIntoStatistics(
    mergeStatistics(minecraftStatistics, dynamicStatistics, embeddedStatistics),
    vaultHistory
  );
  const characterStats = extractCharacterStatsFromVaultSnapshot(exactPlayerSnapshot) || extractCharacterStats(playerNbt);

  return {
    uuid: cleanUuid(uuid),
    name: identity.name || playerSnapshot.nickname,
    nameSource: identity.source || (playerSnapshot.nickname ? playerSnapshot.source+" -> playerNickname" : null),
    vault,
    statistics,
    characterStats,
    vaultHistory,
    reputation: extractReputation(influenceData, minecraftStatsRaw, uuid),
    abilities: extractAbilities(abilitiesData, uuid),
    talents: learnedTieredSkills(parallelValue(talentsData,"Players","Talents",uuid)),
    expertise: learnedTieredSkills(parallelValue(expertisesData,"Players","Expertises",uuid)),
    researches: extractResearches(researchesData, uuid),
    prestige: extractPrestige(prestigeData, uuid, levelData),
    savedBuilds: extractSavedBuilds(dataOf(vaultSources.savedBuilds), uuid),
    bounties, quests, discoveries, playerSnapshot, companions,
    playerStats: extractPlayerStats(statsData, uuid),
    vanillaStats: extractVanillaStats(playerNbt),
    blackMarket: extractBlackMarket(blackMarketData, uuid),
    spiritRecovery: extractSpiritRecovery(spiritData, uuid),
    customNames: extractCustomNames(customNamesData, uuid),
    altarRecipes: extractAltarRecipes(altarData, uuid),
    ...gearResult,
    dataSources: [...new Set([
      ...sourceListForPlayer(vaultSources, uuid, relativePath, !!minecraftStatsRaw),
      ...(statistics.scannedVaultFiles || []),
      ...(vaultHistory?.indexPath ? [vaultHistory.indexPath] : []),
      ...((vaultHistory?.runs || []).map(run => run.source).filter(Boolean)),
      ...(exactPlayerSnapshot?.source ? [exactPlayerSnapshot.source] : []),
      ...(bounties.available ? [bounties.source] : []),
      ...(quests.available ? [quests.source] : []),
      ...Object.values(discoveries.categories).filter(category=>category.available).map(category=>category.source)
    ])],
    rawKeys: Object.keys(playerNbt || {})
  };
}

async function discoverDataFiles(provider) {
  const files = await provider.listFilesRecursive(".");
  return files.filter(file => /\.(dat|nbt|json)$/i.test(file));
}

async function parseWorld(provider) {
  const errors = [];
  const playerFiles = await provider.findPlayerFiles();
  const playerFileMap = new Map(playerFiles.map(file => [normUuid(file.uuid), file.relativePath]));
  const sources = await loadVaultSources(provider, errors);
  const dynamicSources = await loadDynamicVaultData(provider, errors, sources);
  const uuids = collectUuidsFromSources(playerFiles, sources);
  const vaultIndex = await buildVaultSnapshotIndex(provider, uuids, errors, { indexNbt:sources.vaultSnapshots });
  const players = [];
  for (const uuid of uuids) {
    try {
      const relativePath = playerFileMap.get(normUuid(uuid)) || null;
      players.push(await parsePlayer(provider, uuid, relativePath, sources, errors, dynamicSources, vaultIndex));
    } catch (error) {
      errors.push({ player: uuid, message: error.message });
    }
  }
  const names = new Map(players.map(player => [normUuid(player.uuid), player.name || null]));
  for (const record of vaultIndex.byFile.values()) {
    for (const participant of record.participants) participant.name = names.get(normUuid(participant.uuid)) || null;
  }
  return {
    worldPath: provider.worldPath,
    playerCount: players.length,
    vaultIndex,
    players,
    errors,
    files: await discoverDataFiles(provider)
  };
}

module.exports = {
  VAULT_FILES,
  parseWorld,
  parsePlayer,
  sameUuid,
  normUuid,
  extractVaultProgress,
  extractAbilities,
  extractSavedBuilds,
  learnedTieredSkills,
  extractSnapshotEquipment,
  extractMinecraftStatistics,
  extractReputation,
  simplifyItem,
  isVaultHunterGear,
  extractEmbeddedVaultStatistics,
  extractDynamicVaultStatistics,
  extractCharacterStats,
  extractCharacterStatsFromVaultSnapshot,
  extractExactSnapshotGear,
  selectGearRecord,
  parseSerializedGearData,
  extractVaultHistory
};
