const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { SourceManager } = require('./providers/SourceManager');
const { sourceRevision } = require('./providers/sourceRevision');
const { SftpError } = require('./providers/SftpSession');
const { readConfig } = require('./config');
const { parseWorld } = require("./parsers/vaultHuntersParser");
const { vaultXpRanking } = require('./progression/vaultRunXp');
const {uuid:nativeUuid}=require('./progression/native');

const { pagination, paginate, runSummary, playerProfile, playerRuns, findPlayerRun, historySummary } = require("./api/vaultHistory");

function createApp(options = {}) {
  const app = express();
  const onlineSkins = options.onlineSkins ?? (process.env.VH_ONLINE_SKINS !== "0");
  const skinsPath = path.resolve(options.skinsPath || process.env.VH_SKINS_PATH || path.join(__dirname,"..","data","skins"));
  app.use((_req,res,next) => {
    const services = onlineSkins ? " https://mc-heads.net https://crafatar.com" : "";
    res.setHeader("Content-Security-Policy", `img-src 'self' data:${services}; connect-src 'self'${services}`);
    next();
  });
  app.use(cors());
  app.use(express.json());
  app.use((req,res,next) => {
    if (/^\/(?:config(?:\.|\/|$)|keys(?:\/|$)|data(?:\/|$)|src(?:\/|$)|node_modules(?:\/|$)|package(?:-lock)?\.json|\.env)/i.test(req.path))
      return res.status(404).json({error:'Arquivo não disponível.'});
    next();
  });
  app.use(express.static(path.join(__dirname, "..", "public")));

  const sources = options.provider ? null : (options.sourceManager || new SourceManager({root:options.projectRoot,configPath:options.configPath,env:options.env}));
  let provider = options.provider || null;
  const parse = options.parseWorld || parseWorld;

  let cache = { loadedAt: null, world: null };
  let loading = null;
  let manualReload = null;
  let refreshTimer = null, disposed = false;
  const sourceStatus = () => sources ? sources.status() : {kind:'local',state:cache.world?'connected':'idle',message:'Mundo local conectado',refreshSeconds:0};
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    const seconds = sources?.lastConfig?.refreshSeconds;
    if (!sources || disposed || options.autoRefresh === false || !seconds) return;
    refreshTimer = setTimeout(() => load().catch(() => {}), seconds * 1000);
    refreshTimer.unref();
  }

  async function load(loadOptions = {}) {
    if (loading) return loading;
    loading = (async () => {
      let candidate;
      try {
        candidate = sources ? await sources.prepare(loadOptions) : {provider};
        candidate.provider.resetCaches?.();
        const world = await parse(candidate.provider);
        if (candidate.config?.kind === 'sftp' && world.errors?.some(error => /^data\/the_vault_(PlayerVaultLevels|LogoutSnapshots|VaultSnapshots)\.dat$/.test(String(error.file).replace(/\\/g,'/'))))
          throw new SftpError('SFTP_DATA_INVALID', 'O Minecraft ainda não concluiu a gravação dos dados do mundo. A última leitura válida foi preservada; tente novamente.');
        const revision = sources ? await sourceRevision(candidate,world) : null;
        const loadedAt = revision && revision === cache.revision ? cache.loadedAt : new Date().toISOString();
        await sources?.commit(candidate);
        provider = candidate.provider;
        cache = { world, loadedAt, revision };
        return world;
      } catch (error) {
        if (!sources) throw error;
        const retained = await sources.fail(candidate,error,Boolean(cache.world));
        if (retained) return cache.world;
        cache = {loadedAt:null,world:null};
        throw new SftpError(error.code || 'SOURCE_ERROR',sources.status().message);
      }
    })();
    try { return await loading; } finally { loading = null; scheduleRefresh(); }
  }
  async function reloadFromFile() {
    if (!sources) return load({force:true});
    if (manualReload) return manualReload;
    manualReload = (async () => {
      // A button press during a background scan must still apply the file
      // the user just saved, rather than returning the older in-flight scan.
      if (loading) { try { await loading; } catch {} }
      let world, changed;
      do {
        world = await load({force:true});
        try { changed = JSON.stringify(sources.settings()) !== JSON.stringify(sources.lastConfig); }
        catch { changed = false; }
      } while (changed && !disposed);
      return world;
    })();
    try { return await manualReload; } finally { manualReload = null; }
  }
  app.locals.reload = load;
  app.locals.dispose = () => { disposed=true;clearTimeout(refreshTimer); };
  app.locals.sourceStatus = sourceStatus;

  app.get("/api/health", async (_req, res) => {
    const status = sourceStatus();
    let localPath = provider?.worldPath || null;
    if (!localPath && sources) { try { const config=sources.settings();if(config.kind==='local')localPath=config.local.worldPath; } catch {} }
    res.json({
      ok: true,
      version: require("../package.json").version,
      worldPath: status.kind === 'sftp' ? null : localPath,
      worldExists: status.kind === 'sftp' ? Boolean(cache.world) : Boolean(localPath && fs.existsSync(localPath)),
      loadedAt: cache.loadedAt,
      source: status,
      skins: { onlineEnabled:onlineSkins }
    });
  });

  app.get("/api/skins/:uuid", async (req,res) => {
    const id = req.params.uuid.replace(/-/g,"").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).json({error:"Invalid player UUID"});
    const dashed=id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,"$1-$2-$3-$4-$5");
    for (const name of [...new Set([dashed,id])]) {
      const file=path.join(skinsPath,`${name}.png`);
      try {
        const stat=await fs.promises.stat(file);
        if (stat.size > 2 * 1024 * 1024) return res.status(413).json({error:"Skin PNG is too large"});
        const bytes=await fs.promises.readFile(file);
        const valid=bytes.length >= 33 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const width=valid?bytes.readUInt32BE(16):0, height=valid?bytes.readUInt32BE(20):0;
        if (!valid || width < 64 || width > 1024 || width%64 !== 0 || (height !== width && height !== width/2)) return res.status(422).json({error:"Expected a 64x64 or 64x32 Minecraft skin PNG (or a multiple)"});
        res.setHeader("Cache-Control","no-cache");
        return res.type("png").send(bytes);
      } catch (error) {
        if (error.code !== "ENOENT") return res.status(500).json({error:"Could not read local skin"});
      }
    }
    res.status(404).json({error:"Local skin not found"});
  });

  app.get('/api/players/:uuid/companions/:companionId/skin',async(req,res)=>{
    const owner=nativeUuid(req.params.uuid),id=nativeUuid(req.params.companionId);
    if(!owner || !id)return res.status(400).json({error:'Invalid companion identity'});
    try {
      const world=cache.world || await load();
      const companion=world.players.find(p=>p.uuid===owner)?.companions?.items.find(c=>c.id===id);
      if(!companion || companion.owner!==owner || companion.series!=='LEGEND')return res.status(404).json({error:'Companion skin not found'});
      const profile=companion.skinProfile;
      const valid=bytes=>{
        if(bytes.length<33 || bytes.length>2*1024*1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
        const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
        return width>=64 && width<=1024 && width%64===0 && (height===width || height===width/2);
      };
      const profileId=nativeUuid(profile?.uuid);
      if(profileId)for(const name of [profileId,profileId.replace(/-/g,'')]) {
        try {
          const file=path.join(skinsPath,name+'.png');
          if((await fs.promises.stat(file)).size>2*1024*1024)continue;
          const bytes=await fs.promises.readFile(file);
          if(valid(bytes)){res.setHeader('Cache-Control','no-cache');return res.type('png').send(bytes);}
        } catch(error) {if(error.code!=='ENOENT')return res.status(500).json({error:'Could not read companion skin'});}
      }
      if(onlineSkins && /^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]{32,64}$/i.test(profile?.textureUrl || '')) {
        const response=await (options.fetchSkin || fetch)(profile.textureUrl,{signal:AbortSignal.timeout(5000),redirect:'error'});
        if(response.ok && Number(response.headers.get('content-length') || 0)<=2*1024*1024) {
          const reader=response.body?.getReader();
          const chunks=[];let size=0;
          if(reader)while(true) {
            const chunk=await reader.read();if(chunk.done)break;
            size+=chunk.value.length;if(size>2*1024*1024){await reader.cancel();break;}chunks.push(chunk.value);
          }
          const bytes=Buffer.concat(chunks);
          if(size<=2*1024*1024 && valid(bytes)){res.setHeader('Cache-Control','private, max-age=300');return res.type('png').send(bytes);}
        }
      }
      res.status(404).json({error:'Companion skin unavailable'});
    } catch {res.status(404).json({error:'Companion skin unavailable'});}
  });

  app.get("/api/players", async (_req, res) => {
    try {
      const world = cache.world || await load();
      res.json({
        loadedAt: cache.loadedAt,
        source: sourceStatus(),
        count: world.players.length,
        players: world.players.map(p => ({
          uuid: p.uuid,
          name: p.name,
          vault: p.vault,
          statistics: {
            mobKills: p.statistics?.mobKills ?? null,
            vaultsCompleted: p.statistics?.vaultsCompleted ?? null
          },
          reputation: p.reputation,
          gearCount: p.gear.length + (p.gearSnapshot?.curios?.length || 0)
        })),
        errors: world.errors
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });


  app.get("/api/ranking", async (req, res) => {
    try {
      const world = cache.world || await load();
      if (req.query.type === 'vault-xp') return res.json({loadedAt:cache.loadedAt,...vaultXpRanking(world)});
      if (req.query.type !== undefined && req.query.type !== 'level') return res.status(400).json({error:'Unknown ranking type'});
      const ranked = [...world.players]
        .sort((a, b) => {
          const levelA = a.vault?.level != null && Number.isFinite(Number(a.vault.level)) ? Number(a.vault.level) : -1;
          const levelB = b.vault?.level != null && Number.isFinite(Number(b.vault.level)) ? Number(b.vault.level) : -1;
          if (levelB !== levelA) return levelB - levelA;
          const xpA = a.vault?.xp != null && Number.isFinite(Number(a.vault.xp)) ? Number(a.vault.xp) : -1;
          const xpB = b.vault?.xp != null && Number.isFinite(Number(b.vault.xp)) ? Number(b.vault.xp) : -1;
          if (xpB !== xpA) return xpB - xpA;
          return String(a.name || a.uuid).localeCompare(String(b.name || b.uuid));
        })
        .map((player, index) => ({
          rank: index + 1,
          uuid: player.uuid,
          name: player.name,
          vault: player.vault,
          researches: player.researches?.length ?? 0,
          talents: player.talents?.length ?? 0,
          abilities: player.abilities?.learned?.length ?? 0,
          vaultsCompleted: player.statistics?.vaultsCompleted ?? null,
          mobKills: player.statistics?.mobKills ?? null
        }));

      res.json({ loadedAt: cache.loadedAt, count: ranked.length, ranking: ranked });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("/api/players/:uuid", async (req, res) => {
    try {
      const world = cache.world || await load();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === req.params.uuid.replace(/-/g, "").toLowerCase());
      if (!player) return res.status(404).json({ error: "Player not found" });
      res.json(playerProfile(player));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  app.get("/api/players/:uuid/vaults", async (req, res) => {
    try {
      const world = cache.world || await load();
      const target = req.params.uuid.replace(/-/g, "").toLowerCase();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === target);
      if (!player) return res.status(404).json({ error: "Player not found" });
      const runs=playerRuns(world,player);
      const query={...req.query};
      if(query.selected !== undefined) {
        if(typeof query.selected !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.selected))return res.status(400).json({error:'Invalid selected vault'});
        const index=runs.findIndex(run=>run.fileId===query.selected.toLowerCase());
        if(index<0)return res.status(404).json({error:'Selected vault not found for this player'});
        const {limit}=pagination(query);query.page=String(Math.floor(index/limit)+1);
      }
      const result = paginate(runs, query);
      res.json({ ok:true, uuid:player.uuid, name:player.name,
        ...result, runs:result.runs.map(runSummary) });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, stack: process.env.VH_DEBUG === "1" ? e.stack : undefined });
    }
  });

  app.get("/api/players/:uuid/vaults/:fileId", async (req, res) => {
    try {
      const world = cache.world || await load();
      const target = req.params.uuid.replace(/-/g, "").toLowerCase();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === target);
      if (!player) return res.status(404).json({ error: "Player not found" });
      const run = findPlayerRun(world, player, req.params.fileId);
      if (!run) return res.status(404).json({ error: "Vault run not found" });
      res.json({ ok: true, uuid: player.uuid, name: player.name, run });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, stack: process.env.VH_DEBUG === "1" ? e.stack : undefined });
    }
  });

  app.get("/api/players/:uuid/vaults/:fileId/diagnostics", async (req, res) => {
    try {
      const world = cache.world || await load();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === req.params.uuid.replace(/-/g, "").toLowerCase());
      if (!player) return res.status(404).json({ error:"Player not found" });
      const run = findPlayerRun(world, player, req.params.fileId);
      if (!run) return res.status(404).json({ error:"Vault run not found" });
      res.json({ ok:true, uuid:player.uuid, fileId:run.fileId, source:run.source, path:run.path,
        fieldSources:run.fieldSources, decode:run.decode, vaultLevel:run.vaultLevel, vaultLevelSource:run.vaultLevelSource,
        playerLevelAtRun:run.playerLevelAtRun, playerLevelAtRunSource:run.playerLevelAtRunSource });
    } catch (e) { res.status(e.status || 500).json({ error:e.message }); }
  });

  app.get("/api/players/:uuid/prestige-diagnostics", async (req, res) => {
    try {
      const world = cache.world || await load();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === req.params.uuid.replace(/-/g, "").toLowerCase());
      if (!player) return res.status(404).json({ error:"Player not found" });
      res.json({ ok:true, uuid:player.uuid, name:player.name, prestige:player.prestige });
    } catch (e) { res.status(e.status || 500).json({ error:e.message }); }
  });

  for (const system of ['bounties','quests','player-snapshot','progression-diagnostics','discoveries']) {
    app.get(`/api/players/:uuid/${system}`, async (req,res) => {
      try {
        const world=cache.world || await load();
        const player=world.players.find(p=>p.uuid.replace(/-/g,'').toLowerCase()===req.params.uuid.replace(/-/g,'').toLowerCase());
        if(!player)return res.status(404).json({error:'Player not found'});
        if(system==='bounties')return res.json({ok:true,uuid:player.uuid,...player.bounties});
        if(system==='quests')return res.json({ok:true,uuid:player.uuid,...player.quests});
        if(system==='player-snapshot')return res.json({ok:true,uuid:player.uuid,...player.playerSnapshot});
        if(system==='progression-diagnostics')return res.json({ok:true,uuid:player.uuid,
          bounties:{available:player.bounties.available,counts:player.bounties.counts,fieldSources:player.bounties.fieldSources,issues:player.bounties.issues},
          quests:{available:player.quests.available,counts:player.quests.counts,definitions:player.quests.definitions,fieldSources:player.quests.fieldSources,issues:player.quests.issues},
          discoveries:playerProfile(player).discoveries,playerSnapshot:player.playerSnapshot});
        const category=typeof req.query.category==='string' ? req.query.category : 'models';
        if(!Object.prototype.hasOwnProperty.call(player.discoveries.categories,category))return res.status(400).json({error:'Unknown discovery category'});
        if(req.query.q!==undefined && (typeof req.query.q!=='string'||req.query.q.length>200))return res.status(400).json({error:'Search must be a string with at most 200 characters'});
        const query=(req.query.q||'').trim().toLocaleLowerCase('pt-BR');
        const collection=player.discoveries.categories[category];
        const items=collection.items.filter(item=>!query||`${item.id} ${item.name}`.toLocaleLowerCase('pt-BR').includes(query));
        const {runs,...page}=paginate(items,req.query);
        const {totalRuns,...pagination}=page;
        const {items:all,...summary}=collection;
        return res.json({ok:true,uuid:player.uuid,category,...summary,...pagination,items:runs});
      }catch(error){res.status(error.status||500).json({error:error.message});}
    });
  }

  app.get("/api/players/:uuid/vault-history-diagnostics", async (req, res) => {
    try {
      const world = cache.world || await load();
      const target = req.params.uuid.replace(/-/g, "").toLowerCase();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === target);
      if (!player) return res.status(404).json({ error: "Player not found" });

      const history = player.vaultHistory || {};
      const result = paginate(playerRuns(world, player), req.query);
      res.json({
        ok: true,
        uuid: player.uuid,
        name: player.name,
        detected: !!history.detected,
        source: history.source || null,
        indexPath: history.indexPath || null,
        totalRuns: history.totalRuns ?? null,
        completedVaults: history.completedVaults ?? null,
        chestsLooted: history.chestsLooted ?? null,
        chestBreakdown: history.chestBreakdown || {},
        objectives: history.objectives || [],
        diagnostics: history.diagnostics || null,
        aggregates: history.aggregates || null,
        ...result,
        runs: result.runs.map(run => ({
          fileId: run.fileId,
          vaultId: run.vaultId,
          timestamp: run.timestamp,
          source: run.source,
          outcome: run.outcome,
          objective: run.objective,
          xp: run.xp, xpInfo:run.xpInfo,
          chests: run.chests,
          mobKills: run.mobKills,
          pylonsActivated: run.pylonsActivated,
          pylonsBroken: run.pylonsBroken,
          rooms: run.rooms,
          tunnels: run.tunnels,
          dungeons: run.dungeons,
          dungeonBreakdown: run.dungeonBreakdown,
          participants: run.participants,
          fieldSources:run.fieldSources,
          barrels:run.barrels, goldSpent:run.goldSpent, dungeonAltarsFound:run.dungeonAltarsFound,
          phoenixGearUses:run.phoenixGearUses, godAltarReputationEarned:run.godAltarReputationEarned,
          decode: run.decode
        }))
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, stack: process.env.VH_DEBUG === "1" ? e.stack : undefined });
    }
  });

  app.get("/api/players/:uuid/gear-diagnostics", async (req, res) => {
    try {
      const world = cache.world || await load();
      const target = req.params.uuid.replace(/-/g, "").toLowerCase();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === target);
      if (!player) return res.status(404).json({ error: "Player not found" });
      const items = [
        ...(player.gear || []),
        ...(player.gearSnapshot?.curios || []),
        ...(player.gearSnapshot?.hotbar || [])
      ];
      res.json({
        ok: true,
        uuid: player.uuid,
        name: player.name,
        gearSource: player.gearSource || null,
        gearDetailsSource: player.gearDetailsSource || null,
        gearRecord: player.gearRecord || null,
        exactGearCount: items.filter(item => item.exactGearData).length,
        items: items.map(item => ({
          slot: item.slot,
          snapshotSlot: item.snapshotSlot || null,
          id: item.id,
          displayName: item.displayName,
          rarityName: item.rarityName,
          state: item.state,
          itemLevel: item.itemLevel,
          repairSlots: item.repairSlots,
          usedRepairSlots: item.usedRepairSlots,
          repairsRemaining: item.repairsRemaining,
          gearDataId: item.gearDataId || null,
          exactGearData: !!item.exactGearData,
          flags: item.flags || [],
          enchantments: item.enchantments || [],
          modifierGroups: item.modifierGroups || {},
          stats: item.stats || [],
          details: item.details || []
        }))
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, stack: process.env.VH_DEBUG === "1" ? e.stack : undefined });
    }
  });

  app.get("/api/players/:uuid/attribute-diagnostics", async (req, res) => {
    try {
      const world = cache.world || await load();
      const target = req.params.uuid.replace(/-/g, "").toLowerCase();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === target);
      if (!player) return res.status(404).json({ error: "Player not found" });
      res.json({
        ok: true,
        uuid: player.uuid,
        name: player.name,
        sourceKind: player.characterStats?.sourceKind || "playerdata-fallback",
        source: player.characterStats?.source || null,
        exactRuntime: !!player.characterStats?.exactRuntime,
        snapshotTimestamp: player.characterStats?.snapshotTimestamp ?? null,
        snapshotVersion: player.characterStats?.snapshotVersion ?? null,
        counts: player.characterStats?.raw || null,
        highlights: player.characterStats?.highlights || {},
        offense: player.characterStats?.offense || [],
        defense: player.characterStats?.defense || [],
        utility: player.characterStats?.utility || [],
        other: player.characterStats?.other || []
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, stack: process.env.VH_DEBUG === "1" ? e.stack : undefined });
    }
  });

  app.get("/api/players/:uuid/diagnostics", async (req, res) => {
    try {
      const world = cache.world || await load();
      const target = req.params.uuid.replace(/-/g, "").toLowerCase();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === target);
      if (!player) return res.status(404).json({ error: "Player not found" });
      res.json({
        uuid: player.uuid,
        name: player.name,
        statistics: {
          vaultsCompleted: player.statistics?.vaultsCompleted ?? null,
          chestsLooted: player.statistics?.chestsLooted ?? null,
          treasureRooms: player.statistics?.treasureRooms ?? null,
          dungeonsConquered: player.statistics?.dungeonsConquered ?? null,
          vendorsOpened: player.statistics?.vendorsOpened ?? null,
          pylonsActivated: player.statistics?.pylonsActivated ?? null,
          pylonsBroken: player.statistics?.pylonsBroken ?? null,
          barrels:player.statistics?.barrels ?? null, goldSpent:player.statistics?.goldSpent ?? null,
          dungeonAltarsFound:player.statistics?.dungeonAltarsFound ?? null, phoenixGearUses:player.statistics?.phoenixGearUses ?? null,
          godAltarReputationEarned:player.statistics?.godAltarReputationEarned ?? null,
          objectives: player.statistics?.objectives || [],
          statSources: player.statistics?.statSources || {},
          scannedVaultFiles: player.statistics?.scannedVaultFiles || [],
          candidateRows: player.statistics?.embeddedVaultStats || []
        },
        prestige:player.prestige,
        reputation: player.reputation,
        characterStats: player.characterStats,
        vaultHistory: historySummary(player.vaultHistory),
        dataSources: player.dataSources
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });


  app.get("/api/vault-index-diagnostics", async (_req, res) => {
    try {
      const world = cache.world || await load();
      res.json({ ok:true, loadedAt:cache.loadedAt, ...world.vaultIndex.diagnostics,
        indexedPlayers:world.vaultIndex.byPlayer.size, indexedFiles:world.vaultIndex.byFile.size,
        indexedVaults:world.vaultIndex.byVault.size });
    } catch (e) { res.status(500).json({ error:e.message }); }
  });

  app.post("/api/reload", async (_req, res) => {
    try {
      const world = await reloadFromFile();
      res.json({ ok: true, loadedAt: cache.loadedAt, playerCount: world.players.length,source:sourceStatus(),usingCached:sourceStatus().state==='stale' });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("/api/raw/:uuid", async (req, res) => {
    try {
      const world = cache.world || await load();
      const player = world.players.find(p => p.uuid.replace(/-/g, "").toLowerCase() === req.params.uuid.replace(/-/g, "").toLowerCase());
      if (!player) return res.status(404).json({ error: "Player not found" });
      res.json({ rawKeys: player.rawKeys, dataSources: player.dataSources });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("*splat", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return app;
}

if (require.main === module) {
  try {
    const config = readConfig();
    const app = createApp();
    const server = app.listen(config.web.port,config.web.host,() => {
      console.log(`VH Armory: http://localhost:${config.web.port}`);
      console.log('Configuração: config.json. Use Recarregar dados após editar a origem.');
      app.locals.reload().catch(error=>console.error(error.message));
    });
    server.on('close',app.locals.dispose);
    server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'A porta está ocupada. Altere web.port em config.json.':'Não foi possível iniciar o site. Confira web.host e web.port.');app.locals.dispose();process.exitCode=1;});
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
module.exports = { createApp };
