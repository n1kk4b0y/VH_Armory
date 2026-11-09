const { GODS, runFieldSources, aggregateField } = require("./vaultFieldSources");
const path = require("path");
const { parse } = require("./nbtReader");
const { calculateRunXp } = require('../progression/vaultRunXp');

// Decoder for Vault Hunters 3rd Edition Remastered snapshot format used by
// the_vault-1.18.2-20.0.3-remastered.6872 (Vault data version v1_67).
// The binary layout was reconstructed from VaultSnapshots, VaultSnapshot,
// IDataObject/DataMap and StatCollector in the mod JAR.

const STAT_FIELDS = [
  "barrels",
  "broken_pylons",
  "chests",
  "completion",
  "detailed_rooms_discovered",
  "discovered_rooms",
  "discovered_tunnels",
  "dungeon_altars_found",
  "dungeons_opened",
  "exp_bonus",
  "exp_multiplier",
  "god_altar_completions",
  "god_altar_fails",
  "god_altar_reputation",
  "gold_spent",
  "mined_blocks",
  "mobs",
  "objective_exp_multiplier",
  "omega_rooms_found",
  "phoenix_gear_uses",
  "reward",
  "soul_shards_collected",
  "treasure_rooms_opened",
  "used_pylons",
  "vendors_opened",
  "zzz_live_stats"
];

const CHEST_TYPES = ["wooden", "gilded", "living", "ornate", "treasure", "altar", "hardened", "enigma", "flesh"];
const CHEST_RARITIES = ["common", "rare", "epic", "omega"];
const COMPLETION = ["bailed", "failed", "completed"];

function normUuid(value) {
  return String(value || "").toLowerCase().replace(/[^0-9a-f]/g, "");
}
function sameNormalizedUuid(a, b) { return normUuid(a) === normUuid(b); }

function uint32(value) {
  return BigInt(Number(value) >>> 0);
}

function longWord(value) {
  if (typeof value === "bigint") return BigInt.asUintN(64, value);
  if (typeof value === "string") return BigInt.asUintN(64, BigInt(value));
  if (typeof value === "number") return BigInt.asUintN(64, BigInt(Math.trunc(value)));
  if (Array.isArray(value) && value.length >= 2) {
    // prismarine-nbt Java longs are commonly [high32, low32].
    return BigInt.asUintN(64, (uint32(value[0]) << 32n) | uint32(value[1]));
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.value)) return longWord(value.value);
    if (value.high != null && value.low != null) return BigInt.asUintN(64, (uint32(value.high) << 32n) | uint32(value.low));
    if (value.hi != null && value.lo != null) return BigInt.asUintN(64, (uint32(value.hi) << 32n) | uint32(value.lo));
    if (value.unsigned != null) return longWord(value.unsigned);
  }
  throw new Error(`Unsupported NBT long representation: ${String(value)}`);
}

function normalizeLongArray(value) {
  if (!value) return [];
  if (ArrayBuffer.isView(value)) return Array.from(value, longWord);
  if (Array.isArray(value)) return value.map(longWord);
  if (Array.isArray(value.value)) return value.value.map(longWord);
  throw new Error("Snapshot LongArray is not in a supported representation");
}

function intArrayToUuid(parts) {
  if (!Array.isArray(parts) || parts.length !== 4) return null;
  const hex = parts.map(v => (Number(v) >>> 0).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function uuidParts(uuid) {
  const hex = normUuid(uuid);
  if (hex.length !== 32) return null;
  return {
    msb: BigInt(`0x${hex.slice(0,16)}`),
    lsb: BigInt(`0x${hex.slice(16)}`)
  };
}

function uuidFromWords(msb, lsb) {
  const hex = msb.toString(16).padStart(16, "0") + lsb.toString(16).padStart(16, "0");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

class BitReader {
  constructor(words, pos = 0) {
    this.words = words;
    this.pos = pos;
    this.limit = words.length * 64;
  }
  clone() { return new BitReader(this.words, this.pos); }
  remaining() { return this.limit - this.pos; }
  ensure(n) {
    if (n < 0 || this.pos + n > this.limit) throw new Error(`Snapshot bitstream ended at ${this.pos}/${this.limit}`);
  }
  skip(n) { this.ensure(n); this.pos += n; }
  readBits(n) {
    if (n < 0 || n > 64) throw new Error(`Invalid bit width ${n}`);
    this.ensure(n);
    if (n === 0) return 0n;
    const start = this.pos;
    this.pos += n;
    const wordIndex = Math.floor(start / 64);
    const shift = BigInt(start % 64);
    const bitsInFirst = 64 - Number(shift);
    const mask = n === 64 ? ((1n << 64n) - 1n) : ((1n << BigInt(n)) - 1n);
    if (n <= bitsInFirst) return (this.words[wordIndex] >> shift) & mask;
    const low = this.words[wordIndex] >> shift;
    const remain = n - bitsInFirst;
    const highMask = (1n << BigInt(remain)) - 1n;
    const high = this.words[wordIndex + 1] & highMask;
    return (low | (high << BigInt(bitsInFirst))) & mask;
  }
  readBool() { return this.readBits(1) !== 0n; }
  readNumberBits(n) { return Number(this.readBits(n)); }
  readLong() { return this.readBits(64); }
  readInt() {
    const unsigned = Number(this.readBits(32));
    return unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned;
  }
  readIntBounded(size) {
    if (!Number.isInteger(size) || size < 1) throw new Error(`Invalid bounded size ${size}`);
    const bits = size <= 1 ? 0 : Math.ceil(Math.log2(size));
    const value = this.readNumberBits(bits);
    if (value >= size) throw new Error(`Bounded integer ${value} exceeds registry size ${size}`);
    return value;
  }
  readIntSegmented(segment) {
    const flag = 1 << segment;
    let out = 0;
    let offset = 0;
    while (offset < 32) {
      if (32 - offset <= segment) {
        out |= this.readNumberBits(32 - offset) << offset;
        break;
      }
      const value = this.readNumberBits(segment + 1);
      if (value & flag) {
        out |= (value - flag) << offset;
        break;
      }
      out |= value << offset;
      offset += segment;
    }
    return out | 0;
  }
  readString() {
    const length = this.readIntSegmented(7);
    if (length < 0 || length > 65536) throw new Error(`Invalid UTF-8 length ${length}`);
    const bytes = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) bytes[i] = this.readNumberBits(8);
    return bytes.toString("utf8");
  }
  readIdentifier() {
    const length = this.readIntSegmented(7);
    if (length < 0 || length > 1024) throw new Error(`Invalid identifier length ${length}`);
    let text = "";
    for (let i = 0; i < length; i++) {
      const value = this.readIntBounded(41);
      if (value === 0) text += "_";
      else if (value >= 1 && value <= 26) text += String.fromCharCode(96 | value);
      else if (value >= 27 && value <= 36) text += String.fromCharCode(48 + value - 27);
      else if (value === 37) text += ":";
      else if (value === 38) text += "-";
      else if (value === 39) text += ".";
      else if (value === 40) text += "/";
    }
    return text.includes(":") ? text : `minecraft:${text}`;
  }
  readUuid() { return uuidFromWords(this.readLong(), this.readLong()); }
  readFloat() {
    const bits = Number(this.readBits(32));
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32BE(bits >>> 0, 0);
    return buffer.readFloatBE(0);
  }
}

function readChestList(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 100000) throw new Error(`Invalid chest count ${count}`);
  const byType = {};
  const byRarity = {};
  const combinations = {};
  const xpEntries = [];
  let trapped = 0;
  for (let i = 0; i < count; i++) {
    const fields = r.readIntSegmented(3);
    let type = null;
    let rarity = null;
    let isTrapped = false;
    for (let f = 0; f < fields; f++) {
      const field = ["rarity", "trapped", "type"][r.readIntBounded(3)];
      if (field === "trapped") isTrapped = true; // VoidAdapter: presence is the value.
      else if (field === "rarity") rarity = CHEST_RARITIES[r.readIntSegmented(3)] ?? null;
      else if (field === "type") type = CHEST_TYPES[r.readIntSegmented(3)] ?? null;
    }
    if (type) byType[type] = (byType[type] || 0) + 1;
    if (rarity) byRarity[rarity] = (byRarity[rarity] || 0) + 1;
    if (type || rarity) {
      const key = `${type || "unknown"}:${rarity || "unknown"}`;
      combinations[key] = (combinations[key] || 0) + 1;
    }
    if (isTrapped) trapped++;
    xpEntries.push({type,rarity,trapped:isTrapped});
  }
  return { total: count, byType, byRarity, combinations, trapped, xpEntries };
}

function readBarrelList(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 100000) throw new Error(`Invalid barrel count ${count}`);
  const byType = {};
  const byRarity = {};
  const xpEntries = [];
  for (let i = 0; i < count; i++) {
    const fields = r.readIntSegmented(3);
    let type = null;
    let rarity = null;
    for (let f = 0; f < fields; f++) {
      const field = ["rarity", "type"][r.readIntBounded(2)];
      if (field === "rarity") rarity = CHEST_RARITIES[r.readIntSegmented(3)] ?? null;
      else type = CHEST_TYPES[r.readIntSegmented(3)] ?? null;
    }
    if (type) byType[type] = (byType[type] || 0) + 1;
    if (rarity) byRarity[rarity] = (byRarity[rarity] || 0) + 1;
    xpEntries.push({type,rarity});
  }
  return { total: count, byType, byRarity, xpEntries };
}

function readMinedBlocks(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 10000) throw new Error(`Invalid mined block map count ${count}`);
  const byIndex = {};
  for (let i = 0; i < count; i++) {
    const key = r.readIntSegmented(7);
    const objectFields = r.readIntSegmented(3);
    let amount = 0;
    for (let j = 0; j < objectFields; j++) {
      r.readIntBounded(1); // only field: count
      amount = r.readIntSegmented(7);
    }
    byIndex[key] = amount;
  }
  return {
    byIndex,
    coinPiles: Object.prototype.hasOwnProperty.call(byIndex, 2) ? Number(byIndex[2]) : 0
  };
}

function readMobs(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 10000) throw new Error(`Invalid mob map count ${count}`);
  const fieldNames = ["damage_dealt", "damage_received", "killed", "killed_champions", "killed_dungeon_bosses"];
  const entries = {};
  let killed = 0;
  let damageDealt = 0;
  let damageReceived = 0;
  let champions = 0;
  let dungeonBosses = 0;
  for (let i = 0; i < count; i++) {
    const id = r.readIdentifier();
    const fields = r.readIntSegmented(3);
    const entry = {};
    for (let j = 0; j < fields; j++) {
      const name = fieldNames[r.readIntBounded(fieldNames.length)];
      if (name === "damage_dealt" || name === "damage_received") entry[name] = r.readFloat();
      else entry[name] = r.readIntSegmented(7);
    }
    entries[id] = entry;
    killed += Number(entry.killed || 0);
    damageDealt += Number(entry.damage_dealt || 0);
    damageReceived += Number(entry.damage_received || 0);
    champions += Number(entry.killed_champions || 0);
    dungeonBosses += Number(entry.killed_dungeon_bosses || 0);
  }
  return { entries, totalKilled: killed, damageDealt, damageReceived, championsKilled: champions, dungeonBossesKilled: dungeonBosses };
}

function readLiveStats(r) {
  const fieldNames = ["barrels", "chests", "mobs_killed"];
  const fields = r.readIntSegmented(3);
  const result = {};
  for (let i = 0; i < fields; i++) {
    const field = fieldNames[r.readIntBounded(fieldNames.length)];
    const count = r.readIntSegmented(4);
    const map = {};
    for (let j = 0; j < count; j++) {
      const key = field === "mobs_killed" ? r.readIdentifier() : r.readString();
      map[key] = r.readIntSegmented(7);
    }
    result[field] = map;
  }
  return result;
}

function readUtfDataInput(r) {
  const length = (r.readNumberBits(8) << 8) | r.readNumberBits(8);
  if (length < 0 || length > 65535) throw new Error(`Invalid NBT UTF length ${length}`);
  const bytes = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) bytes[i] = r.readNumberBits(8);
  // NBT names in the item data are effectively ASCII/UTF-8 for the data we need.
  return bytes.toString("utf8");
}

function skipLegacyNbtPayload(r, type) {
  switch (type) {
    case 0: return;
    case 1: r.skip(8); return;
    case 2: r.skip(16); return;
    case 3: r.skip(32); return;
    case 4: r.skip(64); return;
    case 5: r.skip(32); return;
    case 6: r.skip(64); return;
    case 7: {
      const count = r.readInt();
      if (count < 0 || count > 20_000_000) throw new Error(`Invalid NBT byte array ${count}`);
      r.skip(count * 8); return;
    }
    case 8: readUtfDataInput(r); return;
    case 9: {
      const childType = r.readNumberBits(8);
      const count = r.readInt();
      if (count < 0 || count > 2_000_000) throw new Error(`Invalid NBT list ${count}`);
      for (let i = 0; i < count; i++) skipLegacyNbtPayload(r, childType);
      return;
    }
    case 10:
      while (true) {
        const childType = r.readNumberBits(8);
        if (childType === 0) break;
        readUtfDataInput(r);
        skipLegacyNbtPayload(r, childType);
      }
      return;
    case 11: {
      const count = r.readInt();
      if (count < 0 || count > 2_000_000) throw new Error(`Invalid NBT int array ${count}`);
      r.skip(count * 32); return;
    }
    case 12: {
      const count = r.readInt();
      if (count < 0 || count > 2_000_000) throw new Error(`Invalid NBT long array ${count}`);
      r.skip(count * 64); return;
    }
    default: throw new Error(`Unknown legacy NBT tag ${type}`);
  }
}

function skipNullableLegacyNbt(r) {
  if (r.readBool()) return null;
  const type = r.readNumberBits(8);
  const name = readUtfDataInput(r);
  skipLegacyNbtPayload(r, type);
  return { type, name };
}

function readReward(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 1000) throw new Error(`Invalid reward list count ${count}`);
  const items = [];
  for (let i = 0; i < count; i++) {
    const empty = r.readBool();
    if (empty) { items.push({ empty: true }); continue; }
    const itemIsNull = r.readBool();
    const id = itemIsNull ? null : r.readIdentifier();
    const amount = r.readIntSegmented(7);
    skipNullableLegacyNbt(r);
    skipNullableLegacyNbt(r); // ForgeCaps
    items.push({ id, count: amount });
  }
  return items;
}

function readPositionIdentifierMap(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 100000) throw new Error(`Invalid room/tunnel map count ${count}`);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const x = r.readInt();
    const y = r.readInt();
    const z = r.readInt();
    entries.push({ x, y, z, id: r.readIdentifier() });
  }
  return entries;
}

function readDungeons(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 10000) throw new Error(`Invalid dungeon map count ${count}`);
  const difficulties = {};
  let total = 0;
  for (let i = 0; i < count; i++) {
    const difficulty = r.readString();
    const innerCount = r.readInt();
    if (innerCount < 0 || innerCount > 10000) throw new Error(`Invalid dungeon type count ${innerCount}`);
    const types = {};
    for (let j = 0; j < innerCount; j++) {
      const type = r.readString();
      const amount = r.readInt();
      types[type] = amount;
      total += amount;
    }
    difficulties[difficulty] = types;
  }
  return { total, difficulties };
}

function readGodReputation(r) {
  const count = r.readIntSegmented(4);
  if (count < 0 || count > 100) throw new Error(`Invalid god reputation map count ${count}`);
  const map = {};
  for (let i = 0; i < count; i++) map[r.readString().toLowerCase()] = r.readIntSegmented(7);
  return map;
}

function inferObjectiveFromReward(items) {
  for (const item of items || []) {
    const id = String(item?.id || "").toLowerCase();
    const match = id.match(/(?:^|:)vault_crate_([a-z0-9_]+)/);
    if (match) return match[1];
  }
  return null;
}

function readStatCollector(r) {
  const start = r.pos;
  const fieldCount = r.readIntSegmented(3);
  if (fieldCount < 5 || fieldCount > STAT_FIELDS.length) throw new Error(`Not a StatCollector: field count ${fieldCount}`);
  const seen = new Set();
  const result = {
    fieldCount,
    chests: null,
    barrels: null,
    minedBlocks: null,
    mobs: null,
    liveStats: null,
    completion: null,
    expBonus: null,
    expMultiplier: null,
    objectiveExpMultiplier: null,
    reward: [],
    vendorsOpened: null,
    goldSpent: null,
    dungeonAltarsFound: null,
    discoveredRooms: null,
    dungeons: null,
    soulShardsCollected: null,
    pylonsActivated: null,
    pylonsBroken: null,
    godAltarCompletions: null,
    godAltarFails: null,
    discoveredTunnels: null,
    phoenixGearUses: null,
    godAltarReputation: null,
    detailedRoomsPresent: false,
    fields: []
  };

  for (let i = 0; i < fieldCount; i++) {
    const fieldIndex = r.readIntBounded(STAT_FIELDS.length);
    if (seen.has(fieldIndex)) throw new Error(`Duplicate StatCollector field ${fieldIndex}`);
    seen.add(fieldIndex);
    const name = STAT_FIELDS[fieldIndex];
    result.fields.push(name);
    switch (name) {
      case "chests": result.chests = readChestList(r); break;
      case "barrels": result.barrels = readBarrelList(r); break;
      case "mined_blocks": result.minedBlocks = readMinedBlocks(r); break;
      case "treasure_rooms_opened": result.treasureRoomsOpened = r.readIntSegmented(7); break;
      case "mobs": result.mobs = readMobs(r); break;
      case "zzz_live_stats": result.liveStats = readLiveStats(r); break;
      case "completion": {
        const value = r.readIntSegmented(3);
        if (value < 0 || value >= COMPLETION.length) throw new Error(`Invalid completion ordinal ${value}`);
        result.completion = COMPLETION[value];
        break;
      }
      case "exp_multiplier": result.expMultiplier = r.readFloat(); break;
      case "exp_bonus": result.expBonus = r.readFloat(); break;
      case "objective_exp_multiplier": result.objectiveExpMultiplier = r.readFloat(); break;
      case "reward": result.reward = readReward(r); break;
      case "vendors_opened": result.vendorsOpened = r.readIntSegmented(7); break;
      case "gold_spent": result.goldSpent = r.readIntSegmented(7); break;
      case "dungeon_altars_found": result.dungeonAltarsFound = r.readIntSegmented(7); break;
      case "discovered_rooms": result.discoveredRooms = readPositionIdentifierMap(r); break;
      case "dungeons_opened": result.dungeons = readDungeons(r); break;
      case "soul_shards_collected": result.soulShardsCollected = r.readIntSegmented(7); break;
      case "used_pylons": result.pylonsActivated = r.readIntSegmented(7); break;
      case "broken_pylons": result.pylonsBroken = r.readIntSegmented(7); break;
      case "god_altar_completions": result.godAltarCompletions = r.readIntSegmented(7); break;
      case "god_altar_fails": result.godAltarFails = r.readIntSegmented(7); break;
      case "discovered_tunnels": result.discoveredTunnels = readPositionIdentifierMap(r); break;
      case "phoenix_gear_uses": result.phoenixGearUses = r.readIntSegmented(7); break;
      case "god_altar_reputation": result.godAltarReputation = readGodReputation(r); break;
      case "detailed_rooms_discovered":
        // In v1_67 this is the final constructor field. We deliberately do not
        // deserialize the room-detail map because no aggregate requested by the
        // Armory depends on it. Reaching it after the preceding known fields is
        // enough to validate the StatCollector candidate.
        result.detailedRoomsPresent = true;
        if (i !== fieldCount - 1) throw new Error("Detailed rooms field unexpectedly appears before the end of StatCollector");
        break;
      case "omega_rooms_found":
        // Legacy field is not constructed for current v1_67 saves. Reject a
        // candidate rather than guessing its older layout.
        throw new Error("Legacy omega_rooms_found field is not supported by the v1_67 decoder");
      default:
        throw new Error(`Unsupported StatCollector field ${name}`);
    }
  }

  if (!seen.has(STAT_FIELDS.indexOf("chests")) || !seen.has(STAT_FIELDS.indexOf("completion"))) {
    throw new Error("StatCollector candidate is missing required fields");
  }
  result.bitStart = start;
  result.bitEnd = r.pos;
  result.objective = inferObjectiveFromReward(result.reward);
  return result;
}

// One stream pass for every known player, rather than one pass per UUID.
function findPlayerUuidOffsets(words, uuids) {
  const targets = new Map();
  const offsets = new Map();
  for (const uuid of uuids) {
    const parts = uuidParts(uuid);
    if (!parts) continue;
    const key = normUuid(uuid);
    offsets.set(key, []);
    if (!targets.has(parts.msb)) targets.set(parts.msb, new Map());
    targets.get(parts.msb).set(parts.lsb, key);
  }
  if (!targets.size || words.length < 2) return offsets;
  const mask = (1n << 64n) - 1n;
  let msb = words[0], lsb = words[1];
  const max = words.length * 64 - 128;
  for (let pos = 0; pos <= max; pos++) {
    const group = targets.get(msb);
    const key = group?.get(lsb);
    if (key) offsets.get(key).push(pos);
    if (pos === max) break;
    const nextPos = pos + 128;
    const nextBit = (words[Math.floor(nextPos / 64)] >> BigInt(nextPos % 64)) & 1n;
    msb = ((msb >> 1n) | ((lsb & 1n) << 63n)) & mask;
    lsb = ((lsb >> 1n) | (nextBit << 63n)) & mask;
  }
  return offsets;
}

function findUuidBitOffsets(words, uuid) {
  return findPlayerUuidOffsets(words, [uuid]).get(normUuid(uuid)) || [];
}

function decodeStatsAtOffsets(words, offsets) {
  const failures = [];
  for (const offset of offsets) {
    try {
      const reader = new BitReader(words, offset + 128);
      const stats = readStatCollector(reader);
      return { stats, uuidBitOffset: offset, statBitOffset: offset + 128, candidateOffsets: offsets, failures };
    } catch (error) {
      failures.push({ offset, message: error.message });
    }
  }
  return { stats: null, uuidBitOffset: null, statBitOffset: null, candidateOffsets: offsets, failures };
}

function decodePlayerStatsFromSnapshot(snapshotLongs, uuid) {
  const words = normalizeLongArray(snapshotLongs);
  return decodeStatsAtOffsets(words, findUuidBitOffsets(words, uuid));
}

function chestBreakdownFromStats(stats) {
  const out = { wooden: 0, gilded: 0, ornate: 0, living: 0, treasure: 0, altar: 0, hardened: 0, enigma: 0, flesh: 0, coinPiles: 0 };
  if (stats?.chests?.byType) {
    for (const [key, value] of Object.entries(stats.chests.byType)) if (Object.prototype.hasOwnProperty.call(out, key)) out[key] += Number(value || 0);
  }
  if (stats?.minedBlocks?.coinPiles != null) out.coinPiles += Number(stats.minedBlocks.coinPiles || 0);
  return out;
}


function resourcePath(id) {
  const text = String(id || "").toLowerCase();
  const colon = text.indexOf(":");
  return colon >= 0 ? text.slice(colon + 1) : text;
}

function titleWords(value) {
  return String(value || "")
    .replace(/^.*:/, "")
    .replace(/[\\/_\-.]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Mirrors DiscoveredRoomStat.inferRoomType() in the Remastered 6872 JAR.
function inferRoomType(id) {
  const value = resourcePath(id);
  if (value.includes("/challenge")) return "challenge";
  if (value.includes("/omega")) return "omega";
  if (value.includes("/ore")) return "ore";
  if (value.includes("/special")) return "special";
  if (value.includes("/raw")) return "raw";
  return "common";
}

const SPECIAL_ROOM_TYPES = new Set(["challenge", "omega", "ore", "special"]);
const SPECIAL_ROOM_NAMES = {
  mine: "Mine / Mining Room",
  mining: "Mine / Mining Room",
  mushroom: "Mush Room",
  mush_room: "Mush Room",
  blacksmith: "Blacksmith",
  cove: "Cove",
  pirate_cove: "Cove",
  library: "Library",
  painting: "Painting",
  pixel: "Pixel",
  digsite: "Digsite",
  warehouse: "Warehouse",
  vendor: "Vendor Room",
  chromatic_caves: "Chromatic Caves",
  emerald_caves: "Emerald Caves",
  farm: "Farm",
  x_mark: "X-Mark",
  xmark: "X-Mark",
  dragon: "Dragon",
  crystal_caverns: "Crystal Caverns",
  factory: "Factory",
  village: "Village",
  raid: "Raid Room",
  laboratory: "Laboratory"
};

function friendlyRoomName(id) {
  const pathValue = resourcePath(id);
  const leaf = pathValue.split("/").filter(Boolean).pop() || pathValue;
  return SPECIAL_ROOM_NAMES[leaf] || titleWords(leaf);
}

function specialRoomData(entries) {
  const specialEntries = (entries || [])
    .map(entry => ({ ...entry, roomType: inferRoomType(entry?.id), name: friendlyRoomName(entry?.id) }))
    .filter(entry => SPECIAL_ROOM_TYPES.has(entry.roomType));
  const grouped = new Map();
  for (const entry of specialEntries) {
    const key = `${entry.roomType}|${entry.id}`;
    if (!grouped.has(key)) grouped.set(key, { id: entry.id, name: entry.name, type: entry.roomType, count: 0 });
    grouped.get(key).count++;
  }
  return {
    entries: specialEntries,
    breakdown: [...grouped.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name)),
    total: specialEntries.length
  };
}

function groupMapFromConfig(config) {
  if (!config || typeof config !== "object") return {};
  if (config.groups && typeof config.groups === "object" && !Array.isArray(config.groups)) return config.groups;
  if (config.GROUPS && typeof config.GROUPS === "object" && !Array.isArray(config.GROUPS)) return config.GROUPS;
  return config;
}

function normalizedGroupKey(value) {
  return String(value || "").toLowerCase().replace(/^the_vault:/, "");
}

function findGroupPredicate(config, aliases) {
  const groups = groupMapFromConfig(config);
  const wanted = new Set(aliases.map(normalizedGroupKey));
  for (const [key, value] of Object.entries(groups || {})) {
    if (wanted.has(normalizedGroupKey(key))) return value;
  }
  return null;
}

function predicateExplicitlyMentionsEntity(predicate, entityId) {
  const target = String(entityId || "").toLowerCase();
  if (!target) return false;
  if (typeof predicate === "string") return predicate.toLowerCase().includes(target);
  if (Array.isArray(predicate)) return predicate.some(child => predicateExplicitlyMentionsEntity(child, target));
  if (predicate && typeof predicate === "object") return Object.values(predicate).some(child => predicateExplicitlyMentionsEntity(child, target));
  return false;
}

const MOB_GROUP_DEFS = [
  { key:"dungeon", label:"Dungeon", aliases:["mob_type/dungeon","dungeon"] },
  { key:"tank", label:"Tank", aliases:["tank","mob_type/tank"] },
  { key:"horde", label:"Horde", aliases:["horde","mob_type/horde"] },
  { key:"assassin", label:"Assassin", aliases:["assassin","mob_type/assassin"] },
  // The Remastered JAR uses the internal group `fighter` for DAMAGE_DWELLER.
  { key:"dweller", label:"Dweller", aliases:["fighter","dweller","mob_type/dweller"] },
  { key:"guardian", label:"Guardian", aliases:["guardian","mob_type/guardian"] },
  { key:"elite", label:"Elite", aliases:["elite","mob_type/elite"] }
];

function classifyMobEntity(id, entityGroupsConfig) {
  for (const def of MOB_GROUP_DEFS) {
    const predicate = findGroupPredicate(entityGroupsConfig, def.aliases);
    if (predicate != null && predicateExplicitlyMentionsEntity(predicate, id)) {
      return { key:def.key, label:def.label, source:"entity_groups.json" };
    }
  }

  return { key:"unknown", label:"Unknown", source:null };
}

function classifyMobStats(entries, entityGroupsConfig) {
  const details = [];
  const categories = { horde:0, dweller:0, assassin:0, tank:0, dungeon:0, guardian:0, elite:0, unknown:0, champions:0, dungeonBosses:0 };
  for (const [id, entry] of Object.entries(entries || {})) {
    const cls = classifyMobEntity(id, entityGroupsConfig);
    const killed = Number(entry?.killed || 0);
    const champions = Number(entry?.killed_champions || 0);
    const dungeonBosses = Number(entry?.killed_dungeon_bosses || 0);
    categories[cls.key] = (categories[cls.key] || 0) + killed;
    categories.champions += champions;
    categories.dungeonBosses += dungeonBosses;
    details.push({
      id,
      name: titleWords(id),
      classKey: cls.key,
      className: cls.label,
      classSource: cls.source,
      killed,
      champions,
      dungeonBosses,
      damageDealt: Number(entry?.damage_dealt || 0),
      damageReceived: Number(entry?.damage_received || 0)
    });
  }
  details.sort((a,b) => b.killed - a.killed || a.name.localeCompare(b.name));
  return { details, categories };
}

// VaultLevel is a one-field compound (`value`, INT_SEGMENTED_7). We avoid a
// loose global bit scan: the value is accepted only when the same level-shaped
// field appears after two widely separated occurrences of the player's UUID
// at nearly the same relative offset. Those occurrences correspond to the
// start/end Vault owner in v1_67 snapshots. If that validation fails, return
// null instead of guessing.
function extractVaultLevelFromSnapshot(snapshotLongs, snapshotKeys, uuid, prepared = null) {
  const keys = Array.isArray(snapshotKeys) ? snapshotKeys.map(String) : [];
  const levelIndex = keys.indexOf("the_vault:level");
  if (levelIndex < 0 || !keys.length) return null;
  const words = prepared?.words || normalizeLongArray(snapshotLongs);
  const uuidOffsets = prepared?.offsets || findUuidBitOffsets(words, uuid);
  const candidates = [];
  const bitLimit = words.length * 64;

  for (const uuidPos of uuidOffsets) {
    const start = uuidPos + 128;
    const end = Math.min(bitLimit - 40, start + 4096);
    for (let pos = start; pos <= end; pos++) {
      try {
        const r = new BitReader(words, pos);
        if (r.readIntBounded(keys.length) !== levelIndex) continue;
        if (r.readIntSegmented(3) !== 1) continue;
        r.readIntBounded(1); // VaultLevel.VALUE is the only field.
        const value = r.readIntSegmented(7);
        if (value < 0 || value > 1000) continue;
        candidates.push({ uuidPos, fieldPos:pos, delta:pos - uuidPos, value });
      } catch {}
    }
  }

  let best = null;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.value !== b.value) continue;
      if (Math.abs(a.uuidPos - b.uuidPos) < 5000) continue;
      const deltaDiff = Math.abs(a.delta - b.delta);
      if (deltaDiff > 96) continue;
      const score = deltaDiff + Math.abs(a.delta - 1700) / 1000;
      if (!best || score < best.score) best = { value:a.value, score, evidence:[a,b] };
    }
  }
  return best ? { value:best.value, source:"VaultSnapshot the_vault:level", evidence:best.evidence } : null;
}

function roomBreakdown(entries) {
  const byId = {};
  for (const entry of entries || []) {
    const id = String(entry?.id || "unknown");
    byId[id] = (byId[id] || 0) + 1;
  }
  return Object.entries(byId)
    .map(([id, count]) => ({ id, name: id.replace(/^.*:/, "").replace(/[_\-.]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()), count }))
    .sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
}

function participantSummary(uuid, decoded) {
  const s = decoded?.stats;
  if (!s) return null;
  return {
    uuid,
    name: null,
    outcome: s.completion,
    objective: s.objective,
    chests: s.chests?.total ?? null,
    mobKills: s.mobs?.totalKilled ?? null,
    damageDealt: s.mobs?.damageDealt ?? null,
    damageReceived: s.mobs?.damageReceived ?? null,
    pylonsActivated: s.pylonsActivated ?? null,
    pylonsBroken: s.pylonsBroken ?? null,
    soulShardsCollected: s.soulShardsCollected ?? null
  };
}

function runFromDecoded(ref, file, decoded, participants = [], context = {}) {
  const s = decoded.stats;
  const xpInfo = calculateRunXp(s,context.xpConfig);
  const chestBreakdown = chestBreakdownFromStats(s);
  const classifiedMobs = classifyMobStats(s.mobs?.entries || {}, context.entityGroupsConfig);
  const discoveredRooms = Array.isArray(s.discoveredRooms) ? s.discoveredRooms : [];
  const specialRooms = specialRoomData(discoveredRooms);
  const run = {
    fileId: ref.fileId,
    vaultId: ref.vaultId,
    timestamp: ref.timestamp,
    source: file,
    path: `Snapshot@bit${decoded.statBitOffset}`,
    outcome: s.completion,
    completed: s.completion === "completed" ? true : (s.completion === "bailed" || s.completion === "failed" ? false : null),
    objective: s.objective,
    vaultLevel: context.vaultLevel?.value ?? null,
    vaultLevelSource: context.vaultLevel?.source ?? null,
    // The v1_67 StatCollector/VaultRunsSnapshot does not persist a historical
    // player progression level. Never substitute the current player level.
    playerLevelAtRun: null,
    playerLevelAtRunSource: null,
    xp: xpInfo.value,
    xpInfo,
    chests: { total: s.chests?.total ?? null, ...chestBreakdown },
    chestRarities: s.chests?.byRarity || {},
    chestCombinations: s.chests?.combinations || {},
    barrels: s.barrels?.total ?? null,
    barrelBreakdown: { byType: s.barrels?.byType || {}, byRarity: s.barrels?.byRarity || {} },
    minedBlocks: s.minedBlocks?.byIndex || {},
    mobKills: s.mobs?.totalKilled ?? null,
    damageDealt: s.mobs?.damageDealt ?? null,
    damageReceived: s.mobs?.damageReceived ?? null,
    championsKilled: s.mobs?.championsKilled ?? null,
    dungeonBossesKilled: s.mobs?.dungeonBossesKilled ?? null,
    mobs: s.mobs?.entries || {},
    mobDetails: classifiedMobs.details,
    mobCategories: classifiedMobs.categories,
    mobClassificationSource: context.entityGroupsSource || null,
    treasureRooms: s.treasureRoomsOpened ?? null,
    vendorsOpened: s.vendorsOpened ?? null,
    goldSpent: s.goldSpent ?? null,
    expBonus: s.expBonus,
    expMultiplier: s.expMultiplier,
    objectiveExpMultiplier: s.objectiveExpMultiplier,
    phoenixGearUses: s.phoenixGearUses ?? null,
    dungeons: s.dungeons?.total ?? null,
    dungeonBreakdown: s.dungeons?.difficulties || {},
    rooms: {
      total: Array.isArray(s.discoveredRooms) ? discoveredRooms.length : null,
      entries: discoveredRooms,
      breakdown: roomBreakdown(discoveredRooms),
      specialTotal: Array.isArray(s.discoveredRooms) ? specialRooms.total : null,
      specialEntries: specialRooms.entries,
      specialBreakdown: specialRooms.breakdown
    },
    tunnels: {
      total: Array.isArray(s.discoveredTunnels) ? s.discoveredTunnels.length : null,
      entries: Array.isArray(s.discoveredTunnels) ? s.discoveredTunnels : [],
      breakdown: roomBreakdown(s.discoveredTunnels)
    },
    dungeonAltarsFound: s.dungeonAltarsFound ?? null,
    participants,
    pylonsActivated: s.pylonsActivated ?? null,
    pylonsBroken: s.pylonsBroken ?? null,
    soulShardsCollected: s.soulShardsCollected ?? null,
    godAltarCompletions: s.godAltarCompletions ?? null,
    godAltarFails: s.godAltarFails ?? null,
    godAltarReputationEarned: s.godAltarReputation ?? null,
    reward: s.reward || [],
    decode: {
      uuidBitOffset: decoded.uuidBitOffset,
      statBitOffset: decoded.statBitOffset,
      fieldCount: s.fieldCount,
      fields: s.fields,
      vaultLevelEvidence: context.vaultLevel?.evidence || []
    }
  };
  run.fieldSources = runFieldSources(run);
  run.fieldSources.xp = {found:run.xp != null,value:run.xp,source:file,path:run.path,
    status:xpInfo.status,formulaSource:xpInfo.source,creditVerified:false};
  return run;
}

function aggregateRuns(runs) {
  const fieldSources = {};
  const aggregates = { totalRuns:runs.length, fieldSources };
  for (const key of ['chestsLooted','mobKills','damageDealt','damageReceived','championsKilled','dungeonBossesKilled',
    'treasureRooms','vendorsOpened','dungeons','specialRooms','pylonsActivated','pylonsBroken','soulShardsCollected',
    'godAltarCompletions','godAltarFails','barrels','goldSpent','dungeonAltarsFound','phoenixGearUses']) {
    fieldSources[key] = aggregateField(runs, key);
    aggregates[key] = fieldSources[key].value;
  }
  for (const [key, outcome] of [['completedVaults','completed'],['bailedVaults','bailed'],['failedVaults','failed']]) {
    fieldSources[key] = aggregateField(runs, 'outcome', run => run.outcome === outcome ? 1 : 0);
    aggregates[key] = fieldSources[key].value;
  }
  fieldSources.godAltarReputationEarned = aggregateField(runs, 'godAltarReputationEarned', () => 0);
  const godCoverage = fieldSources.godAltarReputationEarned;
  const godKeys = new Set([...GODS, ...runs.flatMap(run => Object.keys(run.godAltarReputationEarned || {}))]);
  const godTotals = Object.fromEntries([...godKeys].map(god => [god, runs.reduce((sum, run) =>
    sum + (run.fieldSources.godAltarReputationEarned.found ? Number(run.godAltarReputationEarned[god] ?? 0) : 0), 0)]));
  godCoverage.knownValue = godCoverage.found ? godTotals : null;
  godCoverage.value = godCoverage.complete ? godTotals : null;
  aggregates.godAltarReputationEarned = godCoverage.value;
  aggregates.chestBreakdown = {};
  for (const key of ['wooden','gilded','ornate','living','treasure','altar','hardened','enigma','flesh','coinPiles']) {
    aggregates.chestBreakdown[key] = aggregateField(runs, 'chestsLooted', run => run.chests[key] ?? 0).value;
  }
  const killedByEntity = {};
  const objectives = {};
  for (const run of runs) {
    for (const [id, entry] of Object.entries(run.mobs || {})) killedByEntity[id] = (killedByEntity[id] || 0) + Number(entry.killed || 0);
    if (run.objective) {
      const key = String(run.objective).toLowerCase();
      if (!objectives[key]) objectives[key] = { id:key, name:key, won:0, bailed:0, failed:0 };
      if (run.outcome === "completed") objectives[key].won++;
      if (run.outcome === "bailed") objectives[key].bailed++;
      if (run.outcome === "failed") objectives[key].failed++;
    }
  }
  aggregates.killedByEntity = Object.entries(killedByEntity)
    .map(([id, count]) => ({ id, name:id.replace(/^.*:/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()), count }))
    .sort((a,b) => b.count - a.count);
  aggregates.objectives = Object.values(objectives).map(row => ({ ...row, name:row.name.replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase()) }));
  return aggregates;
}

function historyFromRuns(runs, diagnostics, indexPath) {
  const aggregates = runs.length ? aggregateRuns(runs) : null;
  return {
    detected: runs.length > 0,
    source: "VaultSnapshots",
    indexPath,
    totalRuns: runs.length || null,
    completedVaults: aggregates?.completedVaults ?? null,
    chestsLooted: aggregates?.chestsLooted ?? null,
    chestBreakdown: aggregates?.chestBreakdown || {},
    objectives: aggregates?.objectives || [],
    runs,
    aggregates,
    diagnostics
  };
}

// Built once per world load. Only provider reads are used, so remote providers
// can supply the same interface later. Never keep an implicit cross-load cache.
async function buildVaultSnapshotIndex(provider, uuids, errors = [], options = {}) {
  const indexPath = "data/the_vault_VaultSnapshots.dat";
  const byPlayer = new Map();
  const byFile = new Map();
  const byVault = new Map();
  const diagnostics = { indexFound:false, indexPath, referenceCount:0, uniqueReferences:0,
    duplicateReferences:0, snapshotsScanned:0, snapshotsDecoded:0, streamScans:0,
    collectorsDecoded:0, failures:[], entityGroupsSource:null };
  const playerDiagnostics = new Map();
  for (const uuid of uuids) {
    const key = normUuid(uuid);
    byPlayer.set(key, []);
    playerDiagnostics.set(key, { snapshotsDecoded:0, failures:[] });
  }
  let index;
  try {
    if (Object.prototype.hasOwnProperty.call(options, "indexNbt")) {
      index = options.indexNbt;
      diagnostics.indexFound = !!index || await provider.exists(indexPath);
      if (!index) diagnostics.failures.push(...errors.filter(error => error.file === indexPath));
    } else if (await provider.exists(indexPath)) {
      diagnostics.indexFound = true;
      index = await parse(await provider.read(indexPath));
    }
  } catch (error) {
    const failure = { file:indexPath, message:error.message };
    diagnostics.failures.push(failure);
    errors.push(failure);
  }
  const entityGroups = typeof provider.readVaultEntityGroups === "function"
    ? await provider.readVaultEntityGroups() : null;
  let xpConfig = null;
  if (typeof provider.readVaultNativeConfig === 'function') {
    try { xpConfig=await provider.readVaultNativeConfig('vault_stats'); }
    catch(error) { errors.push({file:'vault_stats config',message:error.message});xpConfig={data:{},source:'invalid-instance-config'}; }
  }
  diagnostics.entityGroupsSource = entityGroups?.source || null;
  const refsRaw = Array.isArray(index?.data?.snapshot_refs) ? index.data.snapshot_refs : [];
  diagnostics.referenceCount = refsRaw.length;
  const refs = new Map();
  for (const raw of refsRaw) {
    const ref = { fileId:intArrayToUuid(raw?.FileId), vaultId:intArrayToUuid(raw?.VaultId), timestamp:Number(raw?.Timestamp ?? 0) };
    if (!ref.fileId) {
      diagnostics.failures.push({ file:indexPath, message:"Invalid snapshot FileId" });
      continue;
    }
    if (refs.has(ref.fileId)) {
      diagnostics.duplicateReferences++;
      const previous = refs.get(ref.fileId);
      if (previous.vaultId !== ref.vaultId || previous.timestamp !== ref.timestamp)
        diagnostics.failures.push({ file:indexPath, fileId:ref.fileId, message:"Conflicting duplicate reference; first reference retained" });
      continue;
    }
    refs.set(ref.fileId, ref);
  }
  diagnostics.uniqueReferences = refs.size;
  for (const ref of refs.values()) {
    const relative = path.join("data", "vault_snapshots", `${ref.fileId}.dat`);
    try {
      if (!(await provider.exists(relative))) throw new Error("Snapshot file referenced by index was not found");
      diagnostics.snapshotsScanned++;
      const nbt = await parse(await provider.read(relative));
      if (!nbt?.Snapshot) throw new Error("Snapshot LongArray not found");
      const words = normalizeLongArray(nbt.Snapshot);
      const offsetsByPlayer = findPlayerUuidOffsets(words, uuids);
      diagnostics.streamScans++;
      const record = { ...ref, source:relative, runs:new Map(), participants:[] };
      for (const [key, offsets] of offsetsByPlayer) {
        if (!offsets.length) continue;
        const decoded = decodeStatsAtOffsets(words, offsets);
        const pd = playerDiagnostics.get(key);
        if (!decoded.stats) {
          pd.failures.push({ file:relative, message:"UUID found, but no valid StatCollector followed it", candidates:offsets, details:decoded.failures.slice(0,8) });
          continue;
        }
        const uuid = uuidFromWords(BigInt(`0x${key.slice(0,16)}`), BigInt(`0x${key.slice(16)}`));
        const vaultLevel = extractVaultLevelFromSnapshot(nbt.Snapshot, nbt.SnapshotKeys, uuid, { words, offsets });
        const run = runFromDecoded(ref, relative, decoded, record.participants, {
          vaultLevel, entityGroupsConfig:entityGroups?.data || null, entityGroupsSource:entityGroups?.source || null, xpConfig
        });
        record.runs.set(key, run);
        const participant = participantSummary(uuid, decoded);
        participant.roomsDiscovered = run.rooms.total;
        participant.dungeons = run.dungeons;
        record.participants.push(participant);
        byPlayer.get(key).push(run);
        pd.snapshotsDecoded++;
        diagnostics.collectorsDecoded++;
      }
      byFile.set(ref.fileId, record);
      if (!byVault.has(ref.vaultId)) byVault.set(ref.vaultId, []);
      byVault.get(ref.vaultId).push(record);
      if (record.runs.size) diagnostics.snapshotsDecoded++;
    } catch (error) {
      diagnostics.failures.push({ file:relative, message:error.message });
    }
  }
  const histories = new Map();
  for (const [key, runs] of byPlayer) {
    runs.sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0) || a.fileId.localeCompare(b.fileId));
    const pd = playerDiagnostics.get(key);
    histories.set(key, historyFromRuns(runs, {
      ...diagnostics, snapshotsDecoded:pd.snapshotsDecoded,
      globalSnapshotsDecoded:diagnostics.snapshotsDecoded,
      failures:[...diagnostics.failures, ...pd.failures]
    }, diagnostics.indexFound ? indexPath : null));
  }
  return { byPlayer, byFile, byVault, histories, diagnostics };
}

function getPlayerVaultHistory(index, uuid) {
  return index.histories.get(normUuid(uuid)) || historyFromRuns([], index.diagnostics, null);
}

// Compatibility for tools that parse a single player outside parseWorld.
async function decodeVaultSnapshotHistory(provider, uuid, errors = []) {
  const index = await buildVaultSnapshotIndex(provider, [uuid], errors);
  return getPlayerVaultHistory(index, uuid);
}

module.exports = {
  BitReader,
  STAT_FIELDS,
  normalizeLongArray,
  intArrayToUuid,
  decodePlayerStatsFromSnapshot,
  decodeVaultSnapshotHistory,
  buildVaultSnapshotIndex,
  getPlayerVaultHistory,
  findPlayerUuidOffsets,
  aggregateRuns,
  inferRoomType,
  specialRoomData,
  classifyMobEntity,
  extractVaultLevelFromSnapshot
};
