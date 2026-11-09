const fs = require("fs/promises");
const path = require("path");
const { nativeXpRequirement, jarDefaultXpRequirement } = require("../progression/vaultXp");

function normUuid(value) {
  return String(value || "").toLowerCase().replace(/[^0-9a-f]/g, "");
}


function findXpRequirement(root, targetLevel, greedTier = 0) {
  const native = nativeXpRequirement(root, targetLevel, greedTier);
  if (native) return native;
  const levelNames = new Set(["level", "vaultlevel", "vault_level", "lvl"]);
  const strongXpNames = new Set([
    "requiredxp", "xprequired", "requiredexp", "exprequired",
    "requiredexperience", "experiencerequired", "nextlevelxp",
    "xptonextlevel", "exptonextlevel", "experiencetonextlevel"
  ]);
  const weakXpNames = new Set(["xp", "exp", "experience"]);
  const hits = [];

  const numberOf = value => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
  };

  function normalizedKey(key) {
    return String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  }

  function visit(value, pathParts = [], contextKey = "") {
    if (value == null) return;

    if (Array.isArray(value)) {
      const context = normalizedKey(contextKey);
      if ((strongXpNames.has(context) || weakXpNames.has(context)) && targetLevel < value.length) {
        const required = numberOf(value[targetLevel]);
        if (required != null && required > 0) hits.push({ required, path: [...pathParts, targetLevel].join("."), confidence: strongXpNames.has(context) ? "high" : "medium" });
      }
      value.forEach((child, index) => visit(child, [...pathParts, index], contextKey));
      return;
    }

    if (typeof value !== "object") return;

    // Common schema: { level: 69, requiredXp: 123456 }
    let objectLevel = null;
    for (const [key, child] of Object.entries(value)) {
      if (levelNames.has(normalizedKey(key))) {
        const n = numberOf(child);
        if (n != null) objectLevel = n;
      }
    }
    if (objectLevel === targetLevel) {
      for (const [key, child] of Object.entries(value)) {
        const nk = normalizedKey(key);
        if (!strongXpNames.has(nk) && !weakXpNames.has(nk)) continue;
        const required = numberOf(child);
        if (required != null && required > 0) hits.push({ required, path: [...pathParts, key].join("."), confidence: strongXpNames.has(nk) ? "high" : "medium" });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const nk = normalizedKey(key);

      // Common schema: { xp: [ ... requirement by level ... ] }
      if (Array.isArray(child) && (strongXpNames.has(nk) || weakXpNames.has(nk)) && targetLevel < child.length) {
        const required = numberOf(child[targetLevel]);
        if (required != null && required > 0) hits.push({ required, path: [...pathParts, key, targetLevel].join("."), confidence: strongXpNames.has(nk) ? "high" : "medium" });
      }

      // Common schema: { levels: { "69": { requiredXp: ... } } } or
      // { xpByLevel: { "69": 123456 } }. Only accept a bare numeric map
      // when its parent key explicitly mentions XP/experience.
      if (child && typeof child === "object" && !Array.isArray(child) && Object.prototype.hasOwnProperty.call(child, String(targetLevel))) {
        const levelNode = child[String(targetLevel)];
        if (typeof levelNode === "object" && levelNode) {
          for (const [xpKey, xpValue] of Object.entries(levelNode)) {
            const xk = normalizedKey(xpKey);
            if (!strongXpNames.has(xk) && !weakXpNames.has(xk)) continue;
            const required = numberOf(xpValue);
            if (required != null && required > 0) hits.push({ required, path: [...pathParts, key, targetLevel, xpKey].join("."), confidence: strongXpNames.has(xk) ? "high" : "medium" });
          }
        } else if (/(xp|exp|experience)/i.test(key)) {
          const required = numberOf(levelNode);
          if (required != null && required > 0) hits.push({ required, path: [...pathParts, key, targetLevel].join("."), confidence: "medium" });
        }
      }

      visit(child, [...pathParts, key], key);
    }
  }

  visit(root);
  hits.sort((a, b) => (a.confidence === "high" ? -1 : 0) - (b.confidence === "high" ? -1 : 0));
  return hits[0] || null;
}

class LocalProvider {
  constructor(worldPath, options = {}) {
    this.env = options.env || process.env;
    this.configRoots = options.instancePath ? [path.resolve(worldPath), path.resolve(options.instancePath)]
      : [path.resolve(worldPath), path.dirname(path.resolve(worldPath)), path.dirname(path.dirname(path.resolve(worldPath)))];
    this.snapshotRoots = options.instancePath ? [path.resolve(options.instancePath), path.resolve(worldPath)]
      : [this.configRoots[2], this.configRoots[1], this.configRoots[0]];
    this.worldPath = path.resolve(worldPath);
    this.xpRequirementCache = new Map();
    this.entityGroupsCache = undefined;
    this.trinketConfigCache = undefined;
    this.questConfigCache = new Map();
    this.nativeConfigCache = new Map();
  }

  resetCaches() {
    this.xpRequirementCache.clear();
    this.entityGroupsCache = undefined;
    this.trinketConfigCache = undefined;
    this.questConfigCache.clear();
    this.nativeConfigCache.clear();
  }

  resolve(relative) {
    return path.join(this.worldPath, relative);
  }

  async exists(relative) {
    try {
      await fs.access(this.resolve(relative));
      return true;
    } catch {
      return false;
    }
  }

  async read(relative) {
    return fs.readFile(this.resolve(relative));
  }

  async readText(relative, encoding = "utf8") {
    return fs.readFile(this.resolve(relative), encoding);
  }

  async readJson(relative) {
    return JSON.parse(await this.readText(relative, "utf8"));
  }

  async list(relative = ".") {
    return fs.readdir(this.resolve(relative), { withFileTypes: true });
  }

  async listFilesRecursive(relative = ".") {
    const base = this.resolve(relative);
    const out = [];

    async function visit(dir, rel) {
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const childRel = path.join(rel, entry.name);
        const childAbs = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(childAbs, childRel);
        else out.push(childRel);
      }
    }

    await visit(base, relative);
    return out;
  }

  async findPlayerFiles() {
    const dir = this.resolve("playerdata");
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
    return entries
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith(".dat"))
      .map(e => ({
        uuid: e.name.slice(0, -4),
        relativePath: path.join("playerdata", e.name)
      }));
  }

  async readPlayerStats(uuid) {
    const target = normUuid(uuid);
    const direct = path.join("stats", `${String(uuid).toLowerCase()}.json`);
    try { return await this.readJson(direct); } catch {}

    let entries = [];
    try { entries = await fs.readdir(this.resolve("stats"), { withFileTypes: true }); } catch { return null; }
    const match = entries.find(e => e.isFile() && e.name.toLowerCase().endsWith(".json") && normUuid(e.name.slice(0, -5)) === target);
    if (!match) return null;
    try { return JSON.parse(await fs.readFile(path.join(this.resolve("stats"), match.name), "utf8")); } catch { return null; }
  }

  async resolveVaultXpRequirement(level, options = {}) {
    const targetLevel = Number(level);
    if (!Number.isInteger(targetLevel) || targetLevel < 0) return null;
    const greedTier = options.greedTier ?? 0;
    const cacheKey = `${targetLevel}:${greedTier}`;
    if (this.xpRequirementCache.has(cacheKey)) return this.xpRequirementCache.get(cacheKey);
    const roots = this.configRoots;
    const explicit = this.env.VH_VAULT_LEVELS_PATH;
    const candidates = explicit ? [path.resolve(explicit)] : [];
    for (const root of [...new Set(roots)]) candidates.push(path.join(root, "config", "the_vault", "vault_levels.json"));
    const preferredNames = ["vault_level.json", "player_levels.json", "levels.json", "leveling.json", "vault_xp.json", "vault_experience.json", "player_level.json"];
    for (const root of [...new Set(roots)]) {
      const dir = path.join(root, "config", "the_vault");
      for (const name of preferredNames) candidates.push(path.join(dir,name));
    }
    for (const file of [...new Set(candidates)]) {
      let text;
      try { text = await fs.readFile(file,"utf8"); }
      catch (error) {
        if (file === candidates[0] && explicit) throw new Error(`Cannot read VH_VAULT_LEVELS_PATH: ${error.message}`);
        if (error.code !== "ENOENT") throw error;
        continue;
      }
      let config;
      try { config = JSON.parse(text); }
      catch { throw new Error(`Invalid Vault XP config: ${file}`); }
      const hit = findXpRequirement(config,targetLevel,greedTier);
      // An existing config must never silently be replaced by mod defaults.
      if (!hit) throw new Error(`XP for level ${targetLevel} was not found in ${file}`);
      const result = { ...hit, source:file, sourceKind:"instance-config", verified:true };
      this.xpRequirementCache.set(cacheKey,result);
      return result;
    }
    const result = this.env.VH_USE_JAR_XP_DEFAULTS === "0" || greedTier !== 0 ? null : jarDefaultXpRequirement(targetLevel);
    this.xpRequirementCache.set(cacheKey,result);
    return result;
  }

  async readVaultPlayerSnapshot(uuid) {
    const target = normUuid(uuid);

    // The Vault itself writes exact runtime player snapshots to
    // <FML game dir>/playerSnapshots/<uuid>.json. For a CurseForge world at
    // <instance>/saves/<world>, FML game dir is <instance>.
    const roots = this.snapshotRoots;

    for (const root of [...new Set(roots)]) {
      const dir = path.join(root, "playerSnapshots");
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }

      const match = entries.find(entry =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".json") &&
        normUuid(entry.name.slice(0, -5)) === target
      );
      if (!match) continue;

      const file = path.join(dir, match.name);
      try {
        const data = JSON.parse(await fs.readFile(file, "utf8"));
        return { data, source: file };
      } catch {}
    }

    return null;
  }

  async readVaultQuestConfig(skyVault = false) {
    const mode = skyVault ? 'sky_quests' : 'quests';
    if (this.questConfigCache.has(mode)) return this.questConfigCache.get(mode);
    const roots = this.configRoots;
    for (const root of [...new Set(roots)]) {
      const file = path.join(root,'config','the_vault','quest',mode+'.json');
      let content;
      try { content = await fs.readFile(file,'utf8'); }
      catch(error) { if(error.code==='ENOENT')continue; throw new Error(`Cannot read quest config: ${file}: ${error.message}`); }
      let data;
      try { data = JSON.parse(content); } catch { throw new Error(`Invalid quest config: ${file}`); }
      if(!Array.isArray(data?.quests))throw new Error(`Native quests list was not found in ${file}`);
      const result={data,source:file};this.questConfigCache.set(mode,result);return result;
    }
    this.questConfigCache.set(mode,null);return null;
  }

  async readVaultNativeConfig(name) {
    if (!['companions','vault_modifiers','vault_stats'].includes(name)) throw new Error('Unsupported native config');
    if (this.nativeConfigCache.has(name)) return this.nativeConfigCache.get(name);
    const env = {companions:'VH_COMPANIONS_CONFIG_PATH',vault_modifiers:'VH_MODIFIERS_CONFIG_PATH',vault_stats:'VH_VAULT_STATS_CONFIG_PATH'}[name];
    const explicit = this.env[env];
    const roots = this.configRoots;
    const candidates = explicit ? [path.resolve(explicit)] : [...new Set(roots)].map(root=>path.join(root,'config','the_vault',name+'.json'));
    for (const file of candidates) {
      let text;
      try { text = await fs.readFile(file,'utf8'); }
      catch(error) { if(!explicit && error.code === 'ENOENT')continue;throw new Error(`Cannot read ${env}: ${file}: ${error.message}`); }
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Invalid ${name} config: ${file}`); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid ${name} config: ${file}`);
      if (name === 'companions' && (!Array.isArray(data.levels) || !Number.isInteger(data.maxLevel))) throw new Error(`Native companion levels not found in ${file}`);
      if (name === 'vault_stats' && ['completion','chests','barrels','blocksMined','mobsKilled'].some(key=>!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) throw new Error(`Native vault_stats maps not found in ${file}`);
      const result = {data,source:file};this.nativeConfigCache.set(name,result);return result;
    }
    this.nativeConfigCache.set(name,null);return null;
  }


  async readVaultEntityGroups() {
    if (this.entityGroupsCache !== undefined) return this.entityGroupsCache;

    const roots = this.snapshotRoots;

    for (const root of [...new Set(roots)]) {
      const file = path.join(root, "config", "the_vault", "entity_groups.json");
      try {
        const data = JSON.parse(await fs.readFile(file, "utf8"));
        this.entityGroupsCache = { data, source: file };
        return this.entityGroupsCache;
      } catch {}
    }

    this.entityGroupsCache = null;
    return null;
  }

  async readVaultTrinketConfig() {
    if (this.trinketConfigCache !== undefined) return this.trinketConfigCache;
    const explicit = this.env.VH_TRINKET_CONFIG_PATH;
    const roots = this.configRoots;
    const candidates = explicit ? [path.resolve(explicit)] : [...new Set(roots)].map(root => path.join(root, "config", "the_vault", "trinket.json"));
    for (const file of candidates) {
      let content;
      try { content = await fs.readFile(file, "utf8"); }
      catch (error) {
        if (!explicit && error.code === "ENOENT") continue;
        throw new Error(`Cannot read trinket config: ${file}: ${error.message}`);
      }
      let data;
      try { data = JSON.parse(content); }
      catch { throw new Error(`Invalid trinket config: ${file}`); }
      if (!data?.TRINKETS || typeof data.TRINKETS !== "object" || Array.isArray(data.TRINKETS)) {
        throw new Error(`TRINKETS was not found in ${file}`);
      }
      this.trinketConfigCache = { data, source:file };
      return this.trinketConfigCache;
    }
    this.trinketConfigCache = null;
    return null;
  }

  async resolvePlayerName(uuid) {
    const target = normUuid(uuid);
    const roots = this.configRoots;

    const candidates = [];
    for (const root of roots) {
      candidates.push(path.join(root, "usernamecache.json"));
      candidates.push(path.join(root, "usercache.json"));
    }

    for (const candidate of [...new Set(candidates)]) {
      let parsed;
      try { parsed = JSON.parse(await fs.readFile(candidate, "utf8")); } catch { continue; }

      // Forge usernamecache.json: { "uuid": "PlayerName" }
      if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (normUuid(key) === target && typeof value === "string" && value.trim()) {
            return { name: value.trim(), source: candidate };
          }
          if (typeof value === "object" && value) {
            const candidateUuid = value.uuid ?? value.id ?? key;
            const candidateName = value.name ?? value.username;
            if (normUuid(candidateUuid) === target && typeof candidateName === "string" && candidateName.trim()) {
              return { name: candidateName.trim(), source: candidate };
            }
          }
        }
      }

      // Vanilla/dedicated server usercache.json: [{ name, uuid, expiresOn }]
      if (Array.isArray(parsed)) {
        const hit = parsed.find(entry => normUuid(entry?.uuid ?? entry?.id) === target);
        if (hit?.name) return { name: String(hit.name), source: candidate };
      }
    }

    return { name: null, source: null };
  }
}

module.exports = { LocalProvider, findXpRequirement };
