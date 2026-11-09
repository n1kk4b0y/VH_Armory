let players = [];
let current = null;
let currentTab = "overview";
let selectedVaultIndex = 0;
let vaultPage = 1;
let vaultLimit = 25;
let vaultRequest = 0;
let vaultDetailRequest = 0;
let playerRequest = 0;
let requestedVault = new URLSearchParams(location.search).get('vault');
if (new URLSearchParams(location.search).get('tab') === 'vaults') currentTab='vaults';
const $ = id => document.getElementById(id);
let sourcePollTimer, pageLoadedAt = null, booting = false, bootToken = 0;
let lastSource = null;
function showSourceError(message) {
  VHViewer.dispose();gearTooltipController?.abort();
  players = [];current = null;pageLoadedAt = null;
  $("players").innerHTML = `<div class="notice">${escapeHtml(message)}</div>`;
  $("homeView").hidden = $("profile").hidden = $("rankingView").hidden = true;
  $("empty").hidden = false;
  $("emptyMessage").textContent = `Não foi possível carregar os jogadores: ${message}`;
}
function updateSourceStatus(source) {
  if (!source) return;
  lastSource = source;
  const stale = source.state === 'stale', failed = source.state === 'error';
  $("worldStatus").textContent = stale ? 'Dados da última leitura' : failed ? 'Fonte indisponível' : source.message;
  $("worldStatus").dataset.state = source.state;
  $("worldStatus").title = source.message;
  const notice = $("sourceNotice");
  if (notice) {
    notice.hidden = !(stale || failed || source.fallbackReason === 'incomplete');
    notice.dataset.state = source.state;
    notice.textContent = source.message + (stale ? ' Exibindo a última leitura válida.' : '');
  }
}
function scheduleSourcePoll(seconds) {
  clearTimeout(sourcePollTimer);
  if (!seconds) return;
  sourcePollTimer = setTimeout(async () => {
    if (booting || document.hidden) { scheduleSourcePoll(seconds); return; }
    try {
      const health = await api('/api/health');
      updateSourceStatus(health.source);
      if (!health.loadedAt && pageLoadedAt && health.source?.state === 'error') {
        showSourceError(health.source.message);scheduleSourcePoll(health.source.refreshSeconds ?? seconds);return;
      }
      if (health.loadedAt && health.loadedAt !== pageLoadedAt) await boot();
      else scheduleSourcePoll(health.source?.refreshSeconds ?? seconds);
    } catch {
      updateSourceStatus({ ...lastSource, state:'stale', message:'Não foi possível contatar o site.' });
      scheduleSourcePoll(seconds);
    }
  }, Math.min(seconds,10) * 1000);
}

function isRankingPage() {
  return location.pathname.replace(/\/+$/, "") === "/ranking";
}

function isHomePage() {
  return location.pathname.replace(/\/+$/, "") === "" && !new URLSearchParams(location.search).has("player");
}

function playerUrl(uuid) {
  return `/armory?player=${encodeURIComponent(uuid)}`;
}

function setView(view) {
  document.body.dataset.view = view;
  $("homeView").hidden = view !== "home";
  $("rankingView").hidden = view !== "ranking";
  $("profile").hidden = view !== "armory";
  $("empty").hidden = true;
}

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro na API");
  return data;
}

async function boot() {
  const token = ++bootToken;
  booting = true;
  clearTimeout(sourcePollTimer);
  let refreshSeconds = lastSource?.refreshSeconds || 0;
  try {
    const health = await api("/api/health");
    if (token !== bootToken) return;
    refreshSeconds = health.source?.refreshSeconds || 0;
    VHSkins.configure({ onlineEnabled:health.skins?.onlineEnabled, version:health.loadedAt || Date.now() });
    for (const name of ['abilities','talents','expertise','prestige','research','bounties','quests','discoveries']) {
      const tab = document.querySelector(`[data-tab="${name}"]`);
      if (tab && !tab.querySelector('.mod-icon')) tab.insertAdjacentHTML('afterbegin',VHIcons.uiMarkup(name));
    }
    VHIcons.mount(document.querySelector('.tabs'));
    updateSourceStatus(health.source || {kind:'local',state:'idle',message:health.worldExists?'Mundo local conectado':'Mundo não encontrado'});
    const data = await api("/api/players");
    if (token !== bootToken) return;
    pageLoadedAt = data.loadedAt;
    updateSourceStatus(data.source || health.source);
    refreshSeconds = data.source?.refreshSeconds ?? refreshSeconds;
    players = data.players || [];
    renderPlayers();
    updatePrimaryNav();

    if (isHomePage()) {
      await renderHomeScreen();
      return;
    }

    if (isRankingPage()) {
      await renderRankingScreen();
      return;
    }

    const requested = new URLSearchParams(location.search).get("player");
    const selected = requested && players.some(p => p.uuid === requested) ? requested : players[0]?.uuid;
    if (selected) await selectPlayer(selected);
    else showNoPlayers();
  } catch (error) {
    if (token !== bootToken) return;
    $("worldStatus").textContent = "Erro";
    showSourceError(error.message);
  } finally {
    if (token === bootToken) { booting = false;scheduleSourcePoll(refreshSeconds); }
  }
}

function updatePrimaryNav() {
  const active = isHomePage() ? "homeNav" : isRankingPage() ? "rankingNav" : "armoryNav";
  ["homeNav","armoryNav","rankingNav"].forEach(id => {
    $(id).classList.toggle("active", id === active);
    if (id === active) $(id).setAttribute("aria-current","page");
    else $(id).removeAttribute("aria-current");
  });
}

function podiumMarkup(ranking) {
  const top = ranking.filter(p => p.vault?.level != null && Number.isFinite(Number(p.vault.level))).slice(0,3);
  return top.map(p => `<a class="podium-card place-${p.rank}" href="${playerUrl(p.uuid)}" aria-label="${p.rank}º lugar: ${escapeHtml(displayName(p))}, nível ${formatNumber(p.vault.level)}. Abrir perfil">
    <div class="podium-medal"><span class="podium-position">${p.rank}º</span> LUGAR</div>
    <div class="podium-stage">${VHSkins.markup(p,"body")}</div>
    <strong class="podium-name" title="${escapeHtml(displayName(p))}">${escapeHtml(displayName(p))}</strong>
    <div class="podium-level"><span>NÍVEL</span><b>${formatNumber(p.vault.level)}</b></div>
    <small class="podium-xp">${formatNumber(p.vault?.xp)} XP</small>
    <span class="podium-open">Explorar perfil <span aria-hidden="true">↗</span></span>
  </a>`).join("");
}

function fillPodium(element, ranking) {
  const markup = podiumMarkup(ranking);
  element.dataset.count = ranking.filter(p => p.vault?.level != null && Number.isFinite(Number(p.vault.level))).slice(0,3).length;
  element.innerHTML = markup || `<div class="notice">Nenhum jogador com Vault Level disponível foi encontrado.</div>`;
  VHSkins.mount(element);
}

async function renderHomeScreen() {
  const data = await api("/api/ranking");
  current = null;
  setView("home");
  fillPodium($("homePodium"),data.ranking || []);
  $("homeCount").textContent = `${players.length} ${players.length === 1 ? "jogador disponível" : "jogadores disponíveis"} neste mundo`;
  renderHomePlayers();
}

function renderHomePlayers() {
  const term = $("homeSearch").value.trim().toLowerCase();
  const filtered = players.filter(p => `${p.name || ""} ${p.uuid}`.toLowerCase().includes(term));
  $("homePlayers").innerHTML = filtered.length ? filtered.map(p => `<a class="home-player-card" href="${playerUrl(p.uuid)}">
    ${VHSkins.markup(p)}
    <span class="home-player-copy"><strong>${escapeHtml(displayName(p))}</strong><small>Vault Level ${formatNumber(p.vault?.level)}</small></span>
    <span class="home-player-arrow" aria-hidden="true">↗</span>
  </a>`).join("") : `<div class="notice">${players.length ? "Nenhum jogador corresponde à pesquisa." : "Nenhum jogador encontrado neste mundo."}</div>`;
  VHSkins.mount($("homePlayers"));
}

async function renderRankingScreen() {
  const type=new URLSearchParams(location.search).get('type')==='vault-xp'?'vault-xp':'level';
  const data = await api('/api/ranking'+(type==='vault-xp'?'?type=vault-xp':''));
  const ranking = data.ranking || [];
  setView("ranking");
  $("rankingCount").textContent = `${ranking.length} ${ranking.length === 1 ? "jogador" : "jogadores"}`;
  document.querySelectorAll('[data-ranking-type]').forEach(a=>{if(a.dataset.rankingType===type)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('rankingTitle').textContent=type==='vault-xp'?'Recordes de XP em uma vault':'Ranking de Vault Level';
  $('rankingDescription').textContent=type==='vault-xp'?'O maior XP gerado em uma única run por jogador. Cada jogador aparece uma vez.':'Jogadores ordenados pelo maior Vault Level. O XP é usado como desempate.';
  $('rankingNote').hidden=type!=='vault-xp';
  $('rankingTable').classList.toggle('ranking-table--xp',type==='vault-xp');
  if(type==='vault-xp') {
    const runUrl=p=>`${playerUrl(p.uuid)}&tab=vaults&vault=${encodeURIComponent(p.run.fileId)}`;
    $('rankingNote').textContent=`${data.note} ${formatNumber(data.knownRuns)} de ${formatNumber(data.totalRuns)} registros com XP disponível.`;
    $('podium').dataset.count=Math.min(3,ranking.length);
    $('podium').innerHTML=ranking.slice(0,3).map((p,index)=>`<a class="podium-card place-${index+1}" href="${runUrl(p)}"><div class="podium-medal"><span class="podium-position">${p.rank}º</span> LUGAR</div><div class="podium-stage">${VHSkins.markup(p,'body')}</div><strong class="podium-name">${escapeHtml(displayName(p))}</strong><div class="podium-level"><span>XP DA VAULT</span><b class="rank-xp">${formatNumber(p.xp)}</b></div><small class="podium-xp">Recorde em uma vault · recalculado</small><span class="podium-open">Ver vault do recorde <span aria-hidden="true">↗</span></span></a>`).join('') || '<div class="notice">Nenhuma run com XP disponível foi encontrada.</div>';
    $('rankingTable').innerHTML=ranking.length ? `<div class="ranking-row ranking-head"><span>#</span><span>Player</span><span>XP da run</span><span>Vault do recorde</span><span>Data</span></div>${ranking.map(p=>`<a class="ranking-row" href="${runUrl(p)}" aria-label="Abrir vault do recorde de ${escapeHtml(displayName(p))}"><b class="rank-number">${p.rank}</b><span class="rank-player">${VHSkins.markup(p)}<span><strong>${escapeHtml(displayName(p))}</strong><small>${formatNumber(p.knownRuns)} runs com XP</small></span></span><strong class="rank-xp">${formatNumber(p.xp)}</strong><span class="rank-run">${escapeHtml(titleCaseUi(p.run.objective || 'Vault'))}<br>${escapeHtml(outcomeLabel(p.run.outcome))}</span><span class="rank-run">${escapeHtml(vaultDate(p.run.timestamp))}</span></a>`).join('')}` : '<div class="notice">Runs sem os dados necessários para calcular o XP ficam fora deste ranking.</div>';
    VHSkins.mount($('podium'));VHSkins.mount($('rankingTable'));return;
  }

  fillPodium($("podium"), ranking);

  $("rankingTable").innerHTML = ranking.length ? `
    <div class="ranking-row ranking-head"><span>#</span><span>Player</span><span>Level</span><span>XP</span><span>Vaults</span><span>Kills</span></div>
    ${ranking.map(p => `<a class="ranking-row" href="${playerUrl(p.uuid)}">
      <b class="rank-number">${p.rank}</b>
      <span class="rank-player">${VHSkins.markup(p)}<span><strong>${escapeHtml(displayName(p))}</strong><small>${escapeHtml(p.uuid)}</small></span></span>
      <strong class="rank-level">${formatNumber(p.vault?.level)}</strong>
      <span>${formatNumber(p.vault?.xp)}</span>
      <span>${formatNumber(p.vaultsCompleted)}</span>
      <span>${formatNumber(p.mobKills)}</span>
    </a>`).join("")}` : "";
  VHSkins.mount($("rankingTable"));
}

function displayName(player) {
  return player?.name || `Player ${String(player?.uuid || "").slice(0, 8)}`;
}

function renderPlayers() {
  const term = $("search").value.toLowerCase();
  const list = players.filter(p => `${p.name || ""} ${p.uuid}`.toLowerCase().includes(term));
  $("players").innerHTML = list.map(p => `
    <a class="player ${current?.uuid === p.uuid ? "active" : ""}" href="${playerUrl(p.uuid)}" data-uuid="${escapeHtml(p.uuid)}" ${current?.uuid === p.uuid ? 'aria-current="page"' : ''}>
      ${VHSkins.markup(p)}
      <div class="player-copy">
        <div class="pname">${escapeHtml(displayName(p))}</div>
        <div class="pmeta">Vault ${p.vault?.level ?? "—"}</div>
      </div>
    </a>`).join("") || `<div class="notice">Nenhum jogador encontrado.</div>`;
  VHSkins.mount($("players"));
  document.querySelectorAll(".player").forEach(el => el.onclick = event => {
    if (isHomePage() || isRankingPage() || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    selectPlayer(el.dataset.uuid).catch(error => { $("worldStatus").textContent = error.message; });
  });
}

async function selectPlayer(uuid) {
  if (current && current.uuid !== uuid) requestedVault=null;
  const request = ++playerRequest;
  const player = await api(`/api/players/${uuid}`);
  if (request !== playerRequest) return;
  current = player;
  selectedVaultIndex = 0;
  vaultPage = 1;
  vaultRequest++;
  vaultDetailRequest++;
  setView("armory");
  if (!isRankingPage()) history.replaceState(null, "", playerUrl(uuid));
  updatePrimaryNav();
  $("playerName").textContent = displayName(current);
  $("playerUuid").textContent = current.uuid;
  $("level").textContent = current.vault?.level ?? "—";
  updateXpHeader(current.vault || {});
  $("profileSkin").innerHTML = VHSkins.markup(current,"body");
  VHSkins.mount($("profileSkin"));
  renderPlayers();
  renderTab();
}

function renderTab() {
  VHViewer.dispose();
  gearTooltipController?.abort();
  VHP2.cancel();
  vaultRequest++;
  vaultDetailRequest++;
  document.querySelectorAll(".tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === currentTab));
  const c = current;
  if (!c) return;

  if (currentTab === "overview") renderOverview(c);
  if (currentTab === "statistics") renderStatistics(c);
  if (currentTab === "vaults") renderVaults(c);
  if (currentTab === "attributes") renderAttributes(c);
  if (currentTab === "gear") renderGearTab(c);
  if (currentTab === "companions") VHCompanions.render(c,renderTab);
  if (currentTab === "abilities") renderAbilities(c);
  if (currentTab === "talents") renderTierList("TALENTS", c.talents || [], "talent");
  if (currentTab === "expertise") renderTierList("EXPERTISE", c.expertise || [], "expertise");
  if (currentTab === "prestige") renderPrestige(c);
  if (currentTab === "research") renderResearch(c);
  if (currentTab === "bounties") VHP2.renderBounties(c);
  if (currentTab === "quests") VHP2.renderQuests(c);
  if (currentTab === "discoveries") VHP2.renderDiscoveries(c);
  VHIcons.mount($("tabContent"));
  VHSkins.mount($("tabContent"));
}

function renderOverview(c) {
  const v = c.vault || {};
  $("tabContent").innerHTML = `
    ${reputationBlock(c.reputation)}
    <div class="section-title">PROGRESSÃO</div>
    ${xpProgressBlock(v)}
    <div class="grid progression-grid">
      ${metric("Vault Level", v.level)}
      ${metric("Vault XP", formatNumber(v.xp))}
      ${metric("Researches", c.researches?.length ?? 0)}
      ${metric("Talents", c.talents?.length ?? 0)}
      ${metric("Abilities", c.abilities?.learned?.length ?? 0)}
    </div>
    <div class="section-title">RESUMO</div>
    <div class="quick-stats">
      ${quickStat("SLAYER", c.statistics?.mobKills, "Monstros mortos", null)}
      ${quickStat("CONQUEROR", c.statistics?.vaultsCompleted, "Vaults completas", c.statistics?.statSources?.vaultsCompleted)}
      ${quickStat("DELVER", c.statistics?.chestsLooted, "Baús saqueados", c.statistics?.statSources?.chestsLooted)}
    </div>
    ${characterSummaryBlock(c.characterStats)}
    <details class="sources">
      <summary>Fontes de dados (${c.dataSources?.length || 0})</summary>
      <div class="list">${(c.dataSources || []).map(source => `<div class="row"><span>${escapeHtml(source)}</span></div>`).join("")}</div>
    </details>`;
}

function renderStatistics(c) {
  const s = c.statistics || {};
  const objectives = s.objectives || [];
  $("tabContent").innerHTML = `
    <div class="stats-hero">
      <div class="stat-domain slayer">
        <div class="domain-name">SLAYER</div>
        <div class="domain-value">${formatNumber(s.mobKills)}</div>
        <div class="domain-label">MOB KILLS</div>
        <div class="domain-sub">Damage dealt: ${formatNumber(s.damageDealt)}</div>
        <div class="domain-sub">Damage taken: ${formatNumber(s.damageTaken)}</div>
      </div>
      <div class="stat-domain conqueror">
        <div class="domain-name">CONQUEROR</div>
        <div class="domain-value" title="${escapeHtml(sourceTitle(s.statSources?.vaultsCompleted, s.vaultsCompleted))}">${formatNumber(s.vaultsCompleted)}</div>
        <div class="domain-label">VAULTS COMPLETED</div>
        <div class="domain-sub" title="${escapeHtml(sourceTitle(s.statSources?.treasureRooms, s.treasureRooms))}">Treasure rooms: ${formatNumber(s.treasureRooms)}</div>
        <div class="domain-sub" title="${escapeHtml(sourceTitle(s.statSources?.dungeonsConquered, s.dungeonsConquered))}">Dungeons: ${formatNumber(s.dungeonsConquered)}</div>
      </div>
      <div class="stat-domain delver">
        <div class="domain-name">DELVER</div>
        <div class="domain-value" title="${escapeHtml(sourceTitle(s.statSources?.chestsLooted, s.chestsLooted))}">${formatNumber(s.chestsLooted)}</div>
        <div class="domain-label">CHESTS LOOTED</div>
        <div class="domain-sub" title="${escapeHtml(sourceTitle(s.statSources?.vendorsOpened, s.vendorsOpened))}">Vendors: ${formatNumber(s.vendorsOpened)}</div>
        <div class="domain-sub">Deaths: ${formatNumber(s.deaths)}</div>
      </div>
    </div>

    <div class="stats-value-legend"><strong>Leitura dos contadores:</strong> <span><b>0</b> = dado localizado, valor zero</span><span><b>—</b> = dado ainda não localizado no save</span></div>

    ${chestBreakdownBlock(s.chestBreakdown || c.vaultHistory?.chestBreakdown || {})}
    ${vaultHistoryBlock(c.vaultHistory || s.history)}

    ${p1StatisticsBlock(s)}
    ${VHP2.snapshotBlock(c.playerSnapshot)}
    ${reputationBlock(c.reputation)}

    <div class="section-title centered">PYLONS</div>
    <div class="pylons">
      ${miniStat("Activated", s.pylonsActivated, s.statSources?.pylonsActivated)}
      ${miniStat("Broken", s.pylonsBroken, s.statSources?.pylonsBroken)}
    </div>

    <div class="section-title centered">VAULT OBJECTIVES</div>
    ${objectives.length ? `
      <div class="objective-table">
        <div class="objective-head"><span>Objective</span><span>Won</span><span>Bailed</span><span>Failed</span></div>
        ${objectives.map(row => `<div class="objective-row"><strong>${escapeHtml(row.name)}</strong><span class="good">${formatNumber(row.won)}</span><span class="warn">${formatNumber(row.bailed)}</span><span class="bad">${formatNumber(row.failed)}</span></div>`).join("")}
      </div>` : `<div class="notice">Nenhum objetivo foi decodificado nas snapshots deste jogador. Os números não são estimados.</div>`}

    ${fieldDiagnostics(s.statSources,"Origem dos contadores")}

    ${s.customVaultStats?.length ? `<details class="sources"><summary>Stats personalizados do Vault Hunters detectados (${s.customVaultStats.length})</summary><div class="list">${s.customVaultStats.map(row => `<div class="row stat-raw"><span>${escapeHtml(row.category)} → ${escapeHtml(row.key)}</span><strong>${formatNumber(row.value)}</strong></div>`).join("")}</div></details>` : ""}
    ${s.embeddedVaultStats?.length ? `<details class="sources"><summary>Campos Vault encontrados no playerdata/saved data (${s.embeddedVaultStats.length})</summary><div class="list">${s.embeddedVaultStats.slice(0,120).map(row => `<div class="row stat-raw"><span>${escapeHtml(row.source)} → ${escapeHtml(row.path)}</span><strong>${formatNumber(row.value)}</strong></div>`).join("")}</div></details>` : ""}`;
  $("openVaultHistory")?.addEventListener("click", () => { currentTab = "vaults"; renderTab(); });
}


function diagnosticValue(value) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return formatNumber(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function fieldDiagnostics(sources, title = "Diagnóstico dos campos") {
  const rows = Object.entries(sources || {}).filter(([key]) => key !== "godAltarReputationEarned");
  if (!rows.length) return "";
  return `<details class="sources field-diagnostics"><summary>${escapeHtml(title)}</summary>
    <div class="field-table"><div class="field-head"><span>Campo</span><span>Estado</span><span>Valor</span><span>Origem</span></div>
    ${rows.map(([key, src]) => {
      const partial = src?.found && src?.complete === false && src?.knownRuns > 0;
      const found = src?.found ?? (src?.value != null);
      const state = partial ? `Parcial (${src.knownRuns}/${src.totalRuns})` : found ? "Localizado" : "Ausente";
      return `<div class="field-row"><strong>${escapeHtml(key)}</strong><span class="field-state ${partial ? "partial" : found ? "found" : "missing"}">${escapeHtml(state)}</span><span>${escapeHtml(diagnosticValue(src?.value))}${partial ? `<small>Subtotal registrado: ${escapeHtml(diagnosticValue(src.knownValue))}</small>` : ""}</span><code>${escapeHtml([src?.source,src?.path].filter(Boolean).join(" → ") || "—")}</code></div>`;
    }).join("")}</div></details>`;
}

function p1StatisticsBlock(s) {
  const fields = [["Gold Spent","goldSpent"],["Barrels","barrels"],["Dungeon Altars","dungeonAltarsFound"],["Phoenix Gear Uses","phoenixGearUses"]];
  const partial = fields.filter(([,key]) => s.statSources?.[key]?.found && s.statSources[key].complete === false);
  return `<div class="section-title">MAIS ESTATÍSTICAS DAS VAULTS</div><div class="vault-detail-grid p1-metrics">${fields.map(([label,key]) => vaultMetric(label,s[key])).join("")}</div>
    ${partial.length ? `<div class="notice">Algumas vaults não registram todos esses campos. Os subtotais disponíveis e a cobertura aparecem no diagnóstico abaixo.</div>` : ""}
    `;
}

function prestigeCard(skill, catalog = false) {
  const state = catalog ? skill.learned == null ? "Rank não registrado" : "Não aprendido"
    : skill.activatable == null ? "Estado não registrado" : !skill.activatable ? "Passivo" : skill.active == null ? "Estado não registrado" : skill.active ? "Ativo" : "Inativo";
  return `<div class="skill-card skill-with-icon prestige-card ${catalog ? "prestige-unlearned" : ""}">${VHIcons.skillMarkup("prestige",skill)}<div class="skill-card-content">
    <strong>${escapeHtml(skill.name || skill.id)}</strong><span class="prestige-state ${skill.active ? "active" : ""}">${escapeHtml(state)}</span>
    ${catalog ? `<div class="prestige-rank">Greed mínimo: ${formatNumber(skill.requiredGreedTier)} · Custo em Knowledge: ${formatNumber(skill.knowledgeCost)}</div>`
      : `<div class="prestige-rank">Rank ${formatNumber(skill.actualTier)}${skill.bonusTier ? ` · ${formatNumber(skill.tier)} aprendido + ${formatNumber(skill.bonusTier)} bônus` : ""}</div>`}
    ${skill.effects?.length ? `<ul class="prestige-effects">${skill.effects.map(effect => `<li>${escapeHtml(effect)}</li>`).join("")}</ul>` : `<p class="prestige-no-effect">Descrição do efeito não registrada.</p>`}
  </div></div>`;
}

function renderPrestige(c) {
  const prestige = c.prestige || {};
  const learned = prestige.learned || [];
  const catalog = (prestige.catalog || []).filter(skill => skill.learned !== true);
  const sources = {...prestige.fieldSources};
  for (const skill of learned) {
    sources[`${skill.id}.tier`] = skill.fieldSources?.tier;
    sources[`${skill.id}.bonusTier`] = skill.fieldSources?.bonusTier;
    if (skill.activatable) sources[`${skill.id}.active`] = skill.fieldSources?.active;
  }
  $("tabContent").innerHTML = `<div class="section-title">PRESTIGE</div>
    <div class="vault-detail-grid prestige-summary">
      ${vaultMetric("Poderes aprendidos",prestige.learnedCount)}${vaultMetric("Poderes ativados",prestige.activeCount)}
      ${vaultMetric("Pontos disponíveis",prestige.points?.available)}${vaultMetric("Pontos gastos",prestige.points?.spent)}
    </div><div class="stats-value-legend"><span><b>0</b> = valor registrado</span><span><b>—</b> = informação ausente</span></div>
    <div class="section-title">PODERES APRENDIDOS</div>
    ${learned.length ? `<div class="skill-grid prestige-grid">${learned.map(skill => prestigeCard(skill)).join("")}</div>`
      : `<div class="notice">${prestige.available && prestige.learnedCount === 0 ? "Este jogador ainda não aprendeu poderes de Prestige." : "Os poderes de Prestige deste jogador não foram localizados."}</div>`}
    ${prestige.diagnostics?.unknownTierCount ? `<div class="notice">${formatNumber(prestige.diagnostics.unknownTierCount)} poder(es) têm rank incompleto no save; o total aprendido está indisponível.</div>` : ""}
    ${catalog.length ? `<details class="sources prestige-catalog"><summary>Poderes disponíveis (${catalog.length})</summary><p class="vault-source-note">Requisitos e custos de compra registrados na árvore de Prestige.</p><div class="skill-grid prestige-grid">${catalog.map(skill => prestigeCard(skill,true)).join("")}</div></details>` : ""}
    ${fieldDiagnostics(sources,"Origem dos dados de Prestige")}`;
}

function attributeValue(row) {
  if (!row) return "—";
  return row.displayValue ?? formatNumber(row.value);
}

function attributeRow(row) {
  return `<div class="attribute-row${isAbilityPowerRow(row) ? " gear-ability-power" : ""}" title="${escapeHtml(sourceTitle(row?.source || row?.path ? {source:row.source,path:row.path} : null, row?.value))}"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(attributeValue(row))}</strong></div>`;
}

function characterSummaryBlock(stats) {
  if (!stats?.available) return `<div class="section-title">PLAYER ATTRIBUTES</div><div class="notice">Nenhum atributo persistido foi localizado no playerdata deste jogador.</div>`;
  const h = stats.highlights || {};
  return `<div class="section-title">PLAYER ATTRIBUTES</div>
    <div class="character-summary">
      <div><span>Attack Damage</span><strong class="attr-red">${escapeHtml(attributeValue(h.attackDamage))}</strong></div>
      <div><span class="attr-purple">Ability Power</span><strong class="attr-purple">${escapeHtml(attributeValue(h.abilityPower))}</strong></div>
      <div><span>Armor</span><strong class="attr-blue">${escapeHtml(attributeValue(h.armor))}</strong></div>
      <div><span>Max Health</span><strong class="attr-green">${escapeHtml(attributeValue(h.maxHealth))}</strong></div>
    </div>`;
}

function renderAttributes(c) {
  const stats = c.characterStats || {};
  if (!stats.available) {
    $("tabContent").innerHTML = `<div class="section-title">PLAYER ATTRIBUTES</div><div class="notice">Nenhum atributo persistido foi localizado no <code>playerdata</code>. Isso pode acontecer quando um atributo é calculado apenas em runtime pelo mod.</div>`;
    return;
  }
  const group = (title, rows, cls) => `<section class="attribute-group ${cls}"><h3>${title}</h3>${rows?.length ? rows.map(attributeRow).join("") : `<div class="attribute-empty">—</div>`}</section>`;
  const h = stats.highlights || {};
  $("tabContent").innerHTML = `
    <div class="section-title">PLAYER ATTRIBUTES</div>
    <div class="character-sheet">
      <div class="character-headline">
        <div><span>ATTACK DAMAGE</span><strong class="attr-red">${escapeHtml(attributeValue(h.attackDamage))}</strong></div>
        <div><span class="attr-purple">ABILITY POWER</span><strong class="attr-purple">${escapeHtml(attributeValue(h.abilityPower))}</strong></div>
        <div><span>ARMOR</span><strong class="attr-blue">${escapeHtml(attributeValue(h.armor))}</strong></div>
        <div><span>MAX HEALTH</span><strong class="attr-green">${escapeHtml(attributeValue(h.maxHealth))}</strong></div>
      </div>
      <div class="attribute-columns">
        ${group("Offensive", stats.offense || [], "offense")}
        ${group("Defensive", stats.defense || [], "defense")}
        ${group("Utility", stats.utility || [], "utility")}
      </div>
      ${stats.other?.length ? `<details class="sources"><summary>Outros atributos persistidos (${stats.other.length})</summary><div class="attribute-other">${stats.other.map(attributeRow).join("")}</div></details>` : ""}
    </div>
    <div class="notice gear-note">${stats.exactRuntime
      ? `Fonte exata: <code>the_vault:PlayerSnapshotDump</code>. Os valores já foram calculados pelo próprio Vault Hunters com gear, Curios, talents, expertises, prestige e modifiers.${stats.snapshotTimestamp ? ` Snapshot: ${escapeHtml(new Date(Number(stats.snapshotTimestamp) * 1000).toLocaleString("pt-BR"))}.` : ""}`
      : `Fallback: <code>playerSnapshots/&lt;UUID&gt;.json</code> não foi encontrado. Os valores vêm do NBT persistido e podem não incluir modifiers runtime. Entre em uma Vault com esse personagem e clique em <b>Recarregar dados</b> para o mod gerar/atualizar a snapshot exata.`}</div>`;
}

function chestBreakdownBlock(chests) {
  const defs = [
    ["wooden","Wooden"],["gilded","Gilded"],["ornate","Ornate"],["living","Living"],["coinPiles","Coin Piles"]
  ];
  return `<div class="section-title">CHEST BREAKDOWN</div><div class="chest-grid">${defs.map(([key,label]) => `<div class="chest-card"><span>${label}</span><strong>${formatNumber(chests?.[key])}</strong></div>`).join("")}</div>`;
}

function outcomeLabel(value) {
  if (value === "completed") return "Completed";
  if (value === "bailed") return "Bailed";
  if (value === "failed") return "Failed";
  return "—";
}

function vaultHistoryBlock(history) {
  const a = history?.aggregates || {};
  const d = history?.diagnostics || {};
  return `<div class="section-title">VAULT HISTORY</div>
    <div class="history-summary history-summary-5">
      <div><span>Runs decoded</span><strong>${formatNumber(history?.totalRuns)}</strong></div>
      <div><span>Completed</span><strong>${formatNumber(history?.completedVaults)}</strong></div>
      <div><span>Bailed</span><strong>${formatNumber(a.bailedVaults)}</strong></div>
      <div><span>Failed</span><strong>${formatNumber(a.failedVaults)}</strong></div>
      <div><span>Chests</span><strong>${formatNumber(history?.chestsLooted)}</strong></div>
    </div>
    <div class="snapshot-diagnostic">${formatNumber(d.referenceCount)} referências · ${formatNumber(d.snapshotsScanned)} arquivos lidos no índice global · ${formatNumber(d.snapshotsDecoded)} runs deste jogador</div>
    ${history?.detected ? `<button type="button" id="openVaultHistory" class="vault-page-button">Abrir histórico completo na aba Vaults</button>` : `<div class="notice">Nenhuma Vault Snapshot deste jogador foi decodificada.</div>`}
    ${d.failureCount ? `<div class="notice">${formatNumber(d.failureCount)} falha(s) registrada(s). Consulte <code>/api/players/&lt;uuid&gt;/vault-history-diagnostics</code>.</div>` : ""}`;
}

function titleCaseUi(value) {
  return String(value || "").replace(/^the_vault:/, "").replace(/[_\-.]+/g," ").replace(/\b\w/g, c => c.toUpperCase());
}


function vaultDate(timestamp) {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try { return new Date(n * 1000).toLocaleString("pt-BR"); } catch { return "—"; }
}

function vaultOutcomeClass(outcome) {
  if (outcome === "completed") return "completed";
  if (outcome === "bailed") return "bailed";
  if (outcome === "failed") return "failed";
  return "unknown";
}

async function renderVaults(c) {
  const request = ++vaultRequest;
  vaultDetailRequest++;
  const active = () => request === vaultRequest && current === c && currentTab === "vaults";
  $("tabContent").innerHTML = `<div class="section-title">VAULT HISTORY</div><div class="notice" role="status">Carregando Vaults…</div>`;
  try {
    const data = await api(`/api/players/${encodeURIComponent(c.uuid)}/vaults?page=${vaultPage}&limit=${vaultLimit}${requestedVault?'&selected='+encodeURIComponent(requestedVault):''}`);
    if (!active()) return;
    if (data.pages && vaultPage > data.pages) { vaultPage = data.pages; return renderVaults(c); }
    const runs = data.runs || [];
    if (!runs.length) {
      $("tabContent").innerHTML = `<div class="section-title">VAULT HISTORY <span class="badge">0 runs</span></div><div class="notice">Nenhuma Vault Snapshot deste jogador foi decodificada.</div>`;
      return;
    }
    vaultPage=data.page;
    selectedVaultIndex = Math.max(0,runs.findIndex(run=>run.fileId===requestedVault));
    requestedVault=null;
    const start = (data.page - 1) * data.limit + 1;
    $("tabContent").innerHTML = `
      <div class="section-title">VAULT HISTORY <span class="badge">${formatNumber(data.total)} runs</span></div>
      <nav class="vault-pagination" aria-label="Páginas do histórico">
        <span>${start}–${start + runs.length - 1} de ${formatNumber(data.total)} runs</span>
        <div class="vault-page-controls">
          <button type="button" id="vaultPrevious" class="vault-page-button" ${data.hasPrevious ? "" : "disabled"}>Anterior</button>
          <label>Página <input id="vaultPageInput" type="number" min="1" max="${data.pages}" value="${data.page}" aria-label="Número da página"> de ${data.pages}</label>
          <button type="button" id="vaultNext" class="vault-page-button" ${data.hasNext ? "" : "disabled"}>Próxima</button>
          <label>Por página <select id="vaultPageSize">${[10,25,50,100].map(n => `<option value="${n}" ${n === vaultLimit ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        </div>
      </nav>
      <div class="vault-browser">
        <aside class="vault-run-list">
          ${runs.map((run, index) => `<button type="button" class="vault-run-card ${index === selectedVaultIndex ? "active" : ""}" data-vault-run="${index}">
            <div class="vault-run-top"><strong>${escapeHtml(run.objective ? titleCaseUi(run.objective) : "Vault")}</strong><span class="vault-result ${vaultOutcomeClass(run.outcome)}">${escapeHtml(outcomeLabel(run.outcome))}</span></div>
            <div class="vault-run-date">${escapeHtml(vaultDate(run.timestamp))}</div>
            <div class="vault-run-xp"><b>${formatNumber(run.xp)} XP</b><small>${run.xpStatus==='recalculated'?'XP da run · recalculado':'XP indisponível'}</small></div>
            <div class="vault-run-meta"><span>${formatNumber(run.chests?.total)} chests</span><span>${formatNumber(run.mobKills)} mobs</span><span>${formatNumber(run.rooms?.specialTotal)} special rooms</span><span>${formatNumber(run.participantCount)} player(s)</span></div>
          </button>`).join("")}
        </aside>
        <section id="vaultDetail" class="vault-detail" aria-live="polite"></section>
      </div>`;
    $("vaultPrevious").onclick = () => { vaultPage--; renderVaults(c); };
    $("vaultNext").onclick = () => { vaultPage++; renderVaults(c); };
    $("vaultPageInput").onchange = event => {
      const page = Number(event.target.value);
      if (!Number.isInteger(page) || page < 1 || page > data.pages) { event.target.value = data.page; return; }
      vaultPage = page; renderVaults(c);
    };
    $("vaultPageSize").onchange = event => { vaultLimit = Number(event.target.value); vaultPage = 1; renderVaults(c); };
    async function selectRun(index) {
      selectedVaultIndex = index;
      const detailRequest = ++vaultDetailRequest;
      document.querySelectorAll("[data-vault-run]").forEach(el => el.classList.toggle("active", Number(el.dataset.vaultRun) === index));
      const target = $("vaultDetail");
      target.innerHTML = `<div class="notice" role="status">Carregando detalhes…</div>`;
      try {
        const detail = await api(`/api/players/${encodeURIComponent(c.uuid)}/vaults/${encodeURIComponent(runs[index].fileId)}`);
        if (active() && detailRequest === vaultDetailRequest) renderVaultDetail(detail.run);
      } catch (error) {
        if (active() && detailRequest === vaultDetailRequest) target.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div><button type="button" id="retryVaultDetail" class="vault-page-button">Tentar novamente</button>`;
        if (active() && detailRequest === vaultDetailRequest) $("retryVaultDetail").onclick = () => selectRun(index);
      }
    }
    document.querySelectorAll("[data-vault-run]").forEach(button => {
      button.onclick = () => selectRun(Number(button.dataset.vaultRun));
    });
    await selectRun(selectedVaultIndex);
  } catch (error) {
    if (!active()) return;
    requestedVault=null;
    $("tabContent").innerHTML = `<div class="section-title">VAULT HISTORY</div><div class="notice">${escapeHtml(error.message)}</div><button type="button" id="retryVaultPage" class="vault-page-button">Tentar novamente</button>`;
    $("retryVaultPage").onclick = () => renderVaults(c);
  }
}

function mobClassLabel(key) {
  const map = { horde:"Horde", dweller:"Dweller", assassin:"Assassin", tank:"Tank", dungeon:"Dungeon", guardian:"Guardian", elite:"Elite", unknown:"Unknown", champions:"Champions", dungeonBosses:"Dungeon Bosses" };
  return map[key] || titleCaseUi(key);
}

function roomTypeLabel(type) {
  const map = { omega:"Omega", challenge:"Challenge", ore:"Ore / Mining", special:"Special" };
  return map[type] || titleCaseUi(type);
}

function renderVaultDetail(run) {
  const target = $("vaultDetail");
  if (!target || !run) return;
  const participants = run.participants || [];
  const roomRows = run.rooms?.specialBreakdown || [];
  const specialRoomEntries = run.rooms?.specialEntries || [];
  const mobRows = Array.isArray(run.mobDetails) && run.mobDetails.length
    ? run.mobDetails
    : Object.entries(run.mobs || {}).map(([id, entry]) => ({ id, name:titleCaseUi(id), classKey:"unknown", className:"Unknown", killed:Number(entry?.killed || 0), champions:Number(entry?.killed_champions || 0), dungeonBosses:Number(entry?.killed_dungeon_bosses || 0), damageDealt:Number(entry?.damage_dealt || 0), damageReceived:Number(entry?.damage_received || 0) })).sort((a,b) => b.killed - a.killed);
  const categories = run.mobCategories || {};
  const categoryOrder = ["horde","dweller","assassin","tank","guardian","elite","dungeon","champions","dungeonBosses","unknown"];
  const categoryRows = categoryOrder
    .map(key => ({ key, label:mobClassLabel(key), value:Number(categories[key] || 0) }))
    .filter(row => run.fieldSources?.mobKills?.found && (row.value > 0 || ["champions","dungeonBosses"].includes(row.key)));
  const chestRows = Object.entries(run.chests || {}).filter(([key]) => key !== "total" && Number(run.chests[key] || 0) > 0);
  const rarityRows = Object.entries(run.chestRarities || {}).filter(([,value]) => Number(value || 0) > 0);
  const dungeonRows = [];
  for (const [difficulty, types] of Object.entries(run.dungeonBreakdown || {})) {
    for (const [type, count] of Object.entries(types || {})) dungeonRows.push({ difficulty, type, count });
  }
  const rewards = (run.reward || []).filter(item => !item?.empty && item?.id);
  target.innerHTML = `
    <div class="vault-detail-header">
      <div><div class="eyebrow">VAULT RUN</div><h2>${escapeHtml(run.objective ? titleCaseUi(run.objective) : "Vault")}</h2><p>${escapeHtml(vaultDate(run.timestamp))}</p></div>
      <div class="vault-header-right"><span class="vault-result large ${vaultOutcomeClass(run.outcome)}">${escapeHtml(outcomeLabel(run.outcome))}</span></div>
    </div>
    <div class="vault-id-grid">
      <div><span>Vault ID</span><code>${escapeHtml(run.vaultId || "—")}</code></div>
      <div><span>Snapshot ID</span><code>${escapeHtml(run.fileId || "—")}</code></div>
    </div>

    <div class="vault-detail-grid">
      ${vaultMetric("XP da vault", run.xp)}
      ${run.playerLevelAtRun != null ? vaultMetric("Player Level", run.playerLevelAtRun) : ""}
      ${vaultMetric("Chests", run.chests?.total)}
      ${vaultMetric("Mobs", run.mobKills)}
      ${vaultMetric("Special Rooms", run.rooms?.specialTotal)}
      ${vaultMetric("Dungeons", run.dungeons)}
      ${vaultMetric("Treasure Rooms", run.treasureRooms)}
      ${vaultMetric("Vendors", run.vendorsOpened)}
      ${vaultMetric("Barrels", run.barrels)}
      ${vaultMetric("Gold Spent", run.goldSpent)}
      ${vaultMetric("Dungeon Altars", run.dungeonAltarsFound)}
      ${vaultMetric("Phoenix Gear Uses", run.phoenixGearUses)}
      ${vaultMetric("Soul Shards", run.soulShardsCollected)}
      ${vaultMetric("Pylons Activated", run.pylonsActivated)}
      ${vaultMetric("Pylons Broken", run.pylonsBroken)}
      ${vaultMetric("Damage Dealt", run.damageDealt)}
      ${vaultMetric("Damage Taken", run.damageReceived)}
      ${vaultMetric("Champions", run.championsKilled)}
      ${vaultMetric("Dungeon Bosses", run.dungeonBossesKilled)}
    </div>
    <div class="vault-xp-note">${run.xp != null ? 'XP gerado nesta run, recalculado pelas estatísticas e multiplicadores salvos. Usa a configuração disponível; alterações de configuração, compartilhamento de XP e bônus de Greed podem mudar o crédito final.' : 'O registro não tem os dados necessários para calcular o XP desta run.'}</div>

    <div class="vault-detail-section"><h3>Players</h3>
      ${participants.length ? `<div class="vault-participants">${participants.map(p => `<div class="vault-participant">${VHSkins.markup(p)}<div class="participant-identity"><strong>${escapeHtml(p.name || `Player ${String(p.uuid || "").slice(0,8)}`)}</strong><small>${escapeHtml(p.uuid || "")}</small></div><div class="participant-stats"><span>${formatNumber(p.mobKills)} mobs</span><span>${formatNumber(p.chests)} chests</span></div></div>`).join("")}</div>` : `<div class="notice">Nenhum participante adicional foi identificado nesta snapshot.</div>`}
    </div>

    <div class="vault-detail-section"><h3>Chest Breakdown</h3>
      <div class="vault-chip-grid">${chestRows.length ? chestRows.map(([type,count]) => vaultChip(titleCaseUi(type), count)).join("") : vaultChip("None", run.chests?.total == null ? null : 0)}</div>
      ${rarityRows.length ? `<h4>Rarities</h4><div class="vault-chip-grid">${rarityRows.map(([rarity,count]) => vaultChip(titleCaseUi(rarity), count)).join("")}</div>` : ""}
    </div>

    <div class="vault-detail-section"><h3>Mob Classes</h3>
      ${categoryRows.length ? `<div class="mob-category-grid">${categoryRows.map(row => `<div class="mob-category ${escapeHtml(row.key)}"><span>${escapeHtml(row.label)}</span><strong>${formatNumber(row.value)}</strong></div>`).join("")}</div>` : `<div class="vault-empty-value">Nenhuma classe de mob pôde ser determinada.</div>`}
      <div class="vault-source-note">Base class: <code>${escapeHtml(run.mobClassificationSource || "Configuração de grupos não localizada")}</code>. Champion e Dungeon Boss são contadores explícitos da própria snapshot e podem se sobrepor à classe base.</div>
    </div>

    <div class="vault-detail-section"><h3>Special Rooms Discovered</h3>
      ${roomRows.length ? `<div class="vault-room-grid">${roomRows.map(r => `<div class="vault-room-card"><span class="room-type ${escapeHtml(r.type)}">${escapeHtml(roomTypeLabel(r.type))}</span><strong>${escapeHtml(r.name)}</strong><small>${formatNumber(r.count)} found</small></div>`).join("")}</div>` : `<div class="vault-empty-value">${run.rooms?.specialTotal == null ? "Salas especiais: informação ausente" : "0 special rooms recorded"}</div>`}
      ${specialRoomEntries.length ? `<details class="sources"><summary>Special room coordinates (${specialRoomEntries.length})</summary><div class="list">${specialRoomEntries.map(r => `<div class="row stat-raw"><span><b>${escapeHtml(roomTypeLabel(r.roomType))}</b> · ${escapeHtml(r.name || titleCaseUi(r.id))}</span><strong>${escapeHtml(`${r.x}, ${r.y}, ${r.z}`)}</strong></div>`).join("")}</div></details>` : ""}
      <div class="vault-source-note">Common/Starter/Raw rooms are intentionally hidden. The categories follow the room-type inference used by the Vault Hunters JAR.</div>
    </div>

    <div class="vault-detail-section"><h3>Mobs</h3>
      ${mobRows.length ? `<div class="vault-mob-table detailed"><div class="vault-mob-head"><span>Mob</span><span>Class</span><span>Kills</span><span>Champion</span><span>Dungeon Boss</span><span>Damage</span><span>Taken</span></div>${mobRows.map(m => `<div><span>${escapeHtml(m.name)}</span><span><i class="mob-class-tag ${escapeHtml(m.classKey || "unknown")}">${escapeHtml(m.className || "Unknown")}</i></span><strong>${formatNumber(m.killed || 0)}</strong><span>${formatNumber(m.champions || 0)}</span><span>${formatNumber(m.dungeonBosses || 0)}</span><span>${formatNumber(m.damageDealt || 0)}</span><span>${formatNumber(m.damageReceived || 0)}</span></div>`).join("")}</div>` : `<div class="vault-empty-value">No mob data</div>`}
    </div>

    <div class="vault-detail-section"><h3>Dungeons</h3>
      ${dungeonRows.length ? `<div class="vault-data-table dungeon-table"><div class="vault-data-head"><span>Difficulty / Type</span><span>Count</span></div>${dungeonRows.map(d => `<div><span>${escapeHtml(`${d.difficulty} · ${d.type}`)}</span><strong>${formatNumber(d.count)}</strong></div>`).join("")}</div>` : `<div class="vault-empty-value">${run.dungeons == null ? "Dungeons: informação ausente" : "0 dungeons recorded"}</div>`}
    </div>

    ${rewards.length ? `<div class="vault-detail-section"><h3>Rewards</h3><div class="vault-chip-grid">${rewards.map(r => `<div class="vault-chip"><span>${escapeHtml(titleCaseUi(r.id))}</span><strong>x${formatNumber(r.count)}</strong></div>`).join("")}</div></div>` : ""}

    ${fieldDiagnostics(Object.fromEntries(Object.entries(run.fieldSources || {}).filter(([key])=>key!=='vaultLevel')))}`;
  // Vault details arrive after renderTab's initial mount; initialize their faces here.
  VHSkins.mount(target);
}

function vaultMetric(label, value) {
  return `<div class="vault-detail-metric"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div>`;
}
function vaultChip(label, value) {
  return `<div class="vault-chip"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div>`;
}

function renderGearTab(c) {
  const companion=VHCompanions.selected(c);
  const armor = ["helmet","chestplate","leggings","boots"];
  const gear = (c.gear || []).filter(item => [...armor,"offhand"].includes(item.slot));
  const curios = (c.gearSnapshot?.curios || []).filter(item => !/^(hotbar|inventory|mainhand)(?:_|$)/.test(item.slot || ""));
  const curioType = item => item.curioType || String(item.slot).replace(/_?\d+$/,"");
  const leftTypes = ["charm","blue_trinket","red_trinket","belt","necklace","deck"];
  const curioRows = type => {
    const items = curios.filter(item => curioType(item) === type).sort((a,b) => (a.slotIndex || 0) - (b.slotIndex || 0));
    return items.length ? items.map(item => renderGearSlot(item.slot,item)).join("") : renderGearSlot(type + "_0");
  };
  const extraCurios = curios.filter(item => ![...leftTypes,"head"].includes(curioType(item)))
    .sort((a,b) => String(a.slot).localeCompare(String(b.slot),"pt-BR",{numeric:true}));
  const record = c.gearRecord || {};
  const recordLabel = {"vault-entry":"Registro de entrada na vault",logout:"Registro da última desconexão","player-save":"Registro do save do jogador",unavailable:"Sem registro de equipamento"}[record.kind] || "Equipamento registrado";
  const recordNote = {"vault-entry":"Este é o conjunto registrado ao entrar na vault.",logout:"Este é o conjunto salvo ao desconectar do jogo.","player-save":"O save não informa quando este conjunto foi equipado.",unavailable:"Nenhum conjunto de equipamentos está disponível nos arquivos lidos."}[record.kind] || "Conjunto de equipamentos disponível no save.";
  $("tabContent").innerHTML = `
    <div class="section-title">GEAR</div>
    <div class="gear-record"><div><strong>${escapeHtml(recordLabel)}</strong>${record.timestamp ? `<span>Registrado em ${escapeHtml(vaultDate(record.timestamp))}</span>` : `<span>Data do registro indisponível</span>`}</div><p>${escapeHtml(recordNote)}</p></div>
    <div class="gear-loadout gear-grid">
      <section class="gear-column gear-column--curios" aria-label="Curios"><h3>Curios</h3>${leftTypes.map(curioRows).join("")}${extraCurios.map(item => renderGearSlot(item.slot,item)).join("")}</section>
      <figure class="gear-avatar">${VHViewer.markup(c,companion)}<figcaption>${escapeHtml(c.name || `Player ${String(c.uuid || "").slice(0,8)}`)}</figcaption>${VHCompanions.controls(c)}</figure>
      <section class="gear-column gear-column--equipment" aria-label="Armadura e offhand"><h3>Armadura e offhand</h3>${armor.map(slot => renderGearSlot(slot,gear.find(item => item.slot === slot))).join("")}${curioRows("head")}${renderGearSlot("offhand",gear.find(item => item.slot === "offhand"))}</section>
    </div>
    <p class="gear-help">Passe o mouse, toque ou use Tab para ver os detalhes de um item.</p>
    ${VHDecks.render(c)}`;
  applySmartGearTooltips();
  VHDecks.mount($('tabContent'),c);
  VHCompanions.mountControls($('tabContent'),c,renderTab);
  VHViewer.mount($('tabContent'),c,companion);
}

function renderGearSlot(slot,item) {
  if (item) return renderGearCard(item,{compact:true});
  return `<div class="gear-empty-slot" data-gear-slot="${escapeHtml(slot)}"><div class="gear-icon" aria-hidden="true">${escapeHtml(slotGlyph(slot))}</div><div class="gear-copy"><strong>${escapeHtml(slotLabel(slot))}</strong><small>Sem item registrado</small></div></div>`;
}

function modifierLineText(row) {
  if (!row) return "";
  if (row.displayText) return row.displayText;
  if (row.display && (!row.value || row.display !== `${row.value} ${row.label}`.trim())) return row.display;
  return `${row.value || ""}${row.value && row.label ? " " : ""}${row.label || ""}`.trim();
}

const hiddenGearFields = new Set([
  "gearrolltype", "rolltype", "gearuniquepool", "uniqueitemkey",
  "gearmodel", "gearname", "exactdatasource", "trinket"
]);

function isAbilityPowerRow(row) {
  const id = String(row?.id || "").split(":").at(-1).replace(/[_\s-]/g, "").toLowerCase();
  return id.startsWith("abilitypower") || /\bability\s+power\b/i.test(row?.label || modifierLineText(row));
}

function isVisibleGearRow(row) {
  if (row?.hidden) return false;
  const key = value => String(value || "").split(":").at(-1).replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (hiddenGearFields.has(key(row?.id)) || hiddenGearFields.has(key(row?.label))) return false;
  return !/(?:^|\s)(?:Gear Roll Type|Gear Unique Pool|Unique Item Key|Gear Model|Gear Name|Exact data source)$/i.test(modifierLineText(row));
}

function renderGearCard(g,{compact=false}={}) {
  const rarityClass = `rarity-${String(g.rarityName || "none").toLowerCase().replace(/\s+/g, "-")}`;
  const statRows = (g.stats || []).filter(isVisibleGearRow);
  const groups = { ...(g.modifierGroups || {}) };
  for (const name of ["attributes", "implicits", "prefixes", "suffixes", "other"]) {
    groups[name] = Array.isArray(groups[name]) ? groups[name].filter(isVisibleGearRow) : [];
  }
  const exactAttributes = Array.isArray(groups.attributes) ? groups.attributes : [];
  const hasDetailedAffixes = [groups.attributes, groups.implicits, groups.prefixes, groups.suffixes, groups.other].some(list => Array.isArray(list) && list.length);
  const affixCount = [groups.prefixes, groups.suffixes].reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
  const visibleStats = statRows.filter(row => !["prefix","suffix","implicit","other","attribute"].includes(row.group)).slice(0, 4);
  const otherStats = statRows.filter(row => !["prefix","suffix","implicit","other"].includes(row.group));
  const levelText = g.itemLevel != null ? `Lv. ${formatNumber(g.itemLevel)}` : null;
  const meta = [g.rarityName, levelText, g.state, slotLabel(g.slot,g)].filter(Boolean).join(" · ");

  const repairs = g.repairSlots != null
    ? `<div class="gear-tooltip-meta"><b>Repairs:</b> ${formatNumber(g.usedRepairSlots ?? 0)}/${formatNumber(g.repairSlots)} used${g.repairsRemaining != null ? ` · ${formatNumber(g.repairsRemaining)} remaining` : ""}</div>`
    : "";
  const wearLine = g.damage != null ? `<div class="gear-tooltip-meta"><b>Damage / wear:</b> ${formatNumber(g.damage)}</div>` : "";
  const stateLine = g.state ? `<div class="gear-tooltip-meta"><b>State:</b> ${escapeHtml(g.state)}</div>` : "";
  const flags = [...new Set([...(g.flags || []), ...(g.legendary ? ["Legendary"] : []), ...(g.greater ? ["Greater"] : []), ...(g.corrupted ? ["Corrupted"] : []), ...(g.living ? ["Living"] : [])])];
  const trinket = g.trinket;
  const effects = trinket?.effects || [];
  const trinketSection = trinket ? `<div class="gear-mod-section trinket-effect"><div class="gear-mod-heading">Capacidades</div>
    ${trinket.name && trinket.name !== g.displayName ? `<div class="gear-mod-line"><b>${escapeHtml(trinket.name)}</b></div>` : ""}
    ${effects.length ? effects.map(effect => `<div class="gear-mod-line">${escapeHtml(effect)}</div>`).join("") : `<div class="gear-mod-line muted">${trinket.status === "unidentified" ? "Trinket ainda não identificado." : "Efeito indisponível neste registro."}</div>`}
    ${trinket.remainingUses != null ? `<div class="gear-mod-line gear-kv"><span>Usos restantes</span><b>${formatNumber(trinket.remainingUses)}</b></div>` : ""}
    </div>` : "";

  return `<div class="gear-card ${rarityClass}" data-gear-slot="${escapeHtml(g.slot)}" tabindex="0" aria-label="${escapeHtml(slotLabel(g.slot,g) + ": " + (g.displayName || g.id))}">
    <div class="gear-icon">${VHIcons.gearMarkup(g,"item",slotGlyph(g.slot))}</div>
    <div class="gear-copy">
      <strong>${escapeHtml(g.displayName || g.id)}</strong>
      <small>${escapeHtml(compact ? slotLabel(g.slot,g) : (meta || slotLabel(g.slot,g)))}</small>
      ${compact ? "" : (hasDetailedAffixes ? `<div class="gear-affix-summary"><span>${exactAttributes.length} attributes</span><span>${(groups.implicits || []).length} implicits</span><span>${affixCount} affixes</span></div>` : (visibleStats.length ? `<div class="gear-stats">${visibleStats.map(row => `<span${isAbilityPowerRow(row) ? ' class="gear-ability-power"' : ""}><b>${escapeHtml(row.label)}</b> ${escapeHtml(row.value)}</span>`).join("")}</div>` : `<div class="gear-stats muted"><span>Afixos não disponíveis</span></div>`))}
    </div>
    ${!compact || g.count > 1 ? `<div class="gear-count">x${g.count ?? 1}</div>` : ""}
    <div class="item-tooltip gear-tooltip-rich">
      <div class="tooltip-item-head">${VHIcons.gearMarkup(g,"tooltip",slotGlyph(g.slot))}<div>
        <div class="tooltip-title">${escapeHtml(g.displayName || g.id)}</div>
        <div class="tooltip-rarity">${escapeHtml(meta || g.id)}</div>
      </div></div>
      ${stateLine}${repairs}${wearLine}
      ${groups.nativeDecode && groups.nativeDecode.status !== "decoded" ? '<div class="tooltip-note">Não foi possível ler os atributos deste item neste registro.</div>' : ""}
      ${flags.length ? `<div class="gear-flags">${flags.map(flag => `<span>${escapeHtml(flag)}</span>`).join("")}</div>` : ""}
      ${trinketSection}
      ${VHCompanions.tooltip(g.companionProfile)}
      ${VHDecks.tooltip(g.deck)}
      ${renderModifierSection("Gear Attributes", exactAttributes, "attribute")}
      ${renderModifierSection("Implicits", groups.implicits, "implicit")}
      ${renderModifierSection("Prefixes", groups.prefixes, "prefix")}
      ${renderModifierSection("Suffixes", groups.suffixes, "suffix")}
      ${renderModifierSection("Other Modifiers", groups.other, "other")}
      ${(g.enchantments || []).length ? `<div class="gear-mod-section enchant"><div class="gear-mod-heading">Enchantments</div>${g.enchantments.map(e => `<div class="gear-mod-line">${escapeHtml(e.name)}${e.levelLabel ? ` ${escapeHtml(e.levelLabel)}` : ""}</div>`).join("")}</div>` : ""}
      ${(g.lore || []).length ? `<div class="gear-mod-section lore"><div class="gear-mod-heading">Lore</div>${g.lore.map(line => `<div class="gear-mod-line">${escapeHtml(line)}</div>`).join("")}</div>` : ""}
      ${otherStats.length ? `<div class="gear-mod-section extra"><div class="gear-mod-heading">Atributos adicionais</div>${otherStats.map(row => `<div class="gear-mod-line gear-kv${isAbilityPowerRow(row) ? " gear-ability-power" : ""}"><span>${escapeHtml(row.label)}</span><b>${escapeHtml(row.value)}</b></div>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

function tooltipReadableColor(color) {
  if (!color || typeof color !== "string") return null;
  const raw = color.trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return raw;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map(ch => ch + ch).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Some PlayerSnapshotDump text components serialize Minecraft BLACK/DARK colors.
  // On the Armory dark tooltip those become unreadable, so only very dark colors
  // are replaced. Bright Vault Hunters modifier colors remain unchanged.
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 78 ? "#f4f6fa" : raw;
}

function renderModifierSection(title, rows, cls) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return `<div class="gear-mod-section ${cls}"><div class="gear-mod-heading">${escapeHtml(title)}</div>${rows.map(row => {
    const text = modifierLineText(row);
    const abilityPower = isAbilityPowerRow(row);
    const readableColor = abilityPower ? null : tooltipReadableColor(row.colorHex);
    const colorStyle = readableColor ? ` style="color:${escapeHtml(readableColor)}"` : "";
    const category = row.category && row.category !== "NONE" ? `<small class="gear-category">${escapeHtml(titleCaseUi(row.category))}</small>` : "";
    const rawTitle = row.id ? ` title="${escapeHtml(row.id)}"` : "";
    return `<div class="gear-mod-line${row.legendary ? " legendary" : ""}"${rawTitle}><span class="gear-mod-display${abilityPower ? " gear-ability-power" : ""}"${colorStyle}>${escapeHtml(text)}</span>${row.tier != null ? `<small>T${escapeHtml(row.tier)}</small>` : category}</div>`;
  }).join("")}</div>`;
}


let gearTooltipController;
function applySmartGearTooltips() {
  gearTooltipController = new AbortController();
  const options = {signal:gearTooltipController.signal};
  const cards = Array.from(document.querySelectorAll('#tabContent .gear-card'));
  const margin = 16;
  const place = card => {
    const tip = card.querySelector('.item-tooltip');
    if (!tip) return;
    Object.assign(tip.style,{position:'fixed',left:'0px',top:'0px',right:'auto',bottom:'auto'});
    const topInset = Math.max(margin, (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0) + margin);
    tip.style.maxHeight = Math.min(innerHeight * .68, 640, Math.max(0, innerHeight - topInset - margin)) + 'px';
    const cardRect = card.getBoundingClientRect();
    const rect = tip.getBoundingClientRect();
    const preferredX = card.closest('.gear-column--equipment') ? cardRect.right - rect.width : cardRect.left;
    const x = Math.max(margin,Math.min(preferredX,innerWidth - rect.width - margin));
    const below = cardRect.bottom + 8;
    const preferredY = below + rect.height <= innerHeight - margin ? below : cardRect.top - rect.height - 8;
    const y = Math.max(topInset,Math.min(preferredY,innerHeight - rect.height - margin));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  cards.forEach(card => {
    const show = () => {
      cards.forEach(other => { if (other !== card) other.classList.add('gear-tooltip-dismissed'); });
      card.classList.remove('gear-tooltip-dismissed');place(card);
    };
    card.addEventListener('mouseenter',show,options);
    card.addEventListener('focus',show,options);
    card.addEventListener('keydown',event => {
      if (event.key === 'Escape') { card.classList.add('gear-tooltip-dismissed');card.blur(); }
    },options);
  });
  const reposition = () => cards.filter(card => !card.classList.contains('gear-tooltip-dismissed') && card.matches(':hover,:focus')).forEach(place);
  window.addEventListener('resize',reposition,options);
  window.addEventListener('scroll',reposition,{...options,capture:true});
  document.addEventListener('pointerdown',event => {
    const focused = document.activeElement;
    if (focused?.matches('.gear-card') && !focused.contains(event.target)) {
      focused.classList.add('gear-tooltip-dismissed');focused.blur();
    }
  },options);
}

function renderAbilities(c) {
  const items = c.abilities?.learned || [];
  $("tabContent").innerHTML = `<div class="section-title">ABILITIES ${c.abilities?.selected ? `<span class="badge">Selected: ${escapeHtml(c.abilities.selected)}</span>` : ""}</div>
    ${items.length ? `<div class="skill-grid">${items.map(abilityCard).join("")}</div>` : `<div class="notice">Nenhuma ability aprendida encontrada.</div>`}
    ${savedBuildsBlock(c.savedBuilds || [])}`;
}

function abilityCard(ability) {
  return `<div class="skill-card skill-with-icon">${VHIcons.skillMarkup("ability",ability)}<div class="skill-card-content">
    <strong>${escapeHtml(ability.name || ability.id)}</strong>
    <div class="skill-specializations">${(ability.specializations || []).map(spec => `<div class="skill-specialization">${VHIcons.skillMarkup("ability",spec,"small",ability)}<span>${escapeHtml(spec.name || spec.id)} · Tier ${formatNumber(spec.tier)}${spec.bonusTier ? ` +${formatNumber(spec.bonusTier)}` : ""}</span></div>`).join("")}</div>
  </div></div>`;
}

function tieredSkillCard(skill, kind) {
  return `<div class="skill-card skill-with-icon">${VHIcons.skillMarkup(kind,skill)}<div class="skill-card-content"><strong>${escapeHtml(skill.name || skill.id)}</strong><span>Tier ${formatNumber(skill.tier)}${skill.bonusTier ? ` +${formatNumber(skill.bonusTier)}` : ""}</span></div></div>`;
}

function savedBuildsBlock(builds) {
  return `<div class="section-title">BUILDS SALVAS <span class="badge">${builds.length}</span></div>
    ${builds.length ? `<p class="saved-build-note">Slots do Skill Altar com habilidades e talentos salvos. Os slots são independentes das habilidades atuais do personagem.</p>
      <div class="saved-builds">${builds.map(build => `<details class="saved-build-card">
        <summary>${build.icon?.key ? VHIcons.skillMarkup(build.icon.isTalent ? "talent" : "ability",build.icon.key,"build") : ""}<strong>${escapeHtml(build.name)}</strong><span class="saved-build-count">${build.abilities?.learned?.length || 0} habilidades · ${build.talents?.length || 0} talentos</span></summary>
        <h3>Habilidades</h3><div class="skill-grid">${(build.abilities?.learned || []).map(abilityCard).join("") || `<div class="notice">Nenhuma habilidade aprendida neste slot.</div>`}</div>
        <h3>Talentos</h3><div class="skill-grid">${(build.talents || []).map(skill => tieredSkillCard(skill,"talent")).join("") || `<div class="notice">Nenhum talento aprendido neste slot.</div>`}</div>
      </details>`).join("")}</div>` : `<div class="notice">Nenhuma build salva localizada para este jogador.</div>`}`;
}

function renderTierList(title, items, kind) {
  $("tabContent").innerHTML = `<div class="section-title">${title}</div>
    ${items.length ? `<div class="skill-grid">${items.map(skill => tieredSkillCard(skill,kind)).join("")}</div>` : `<div class="notice">Nenhum dado aprendido encontrado.</div>`}`;
}

function renderResearch(c) {
  const items = c.researches || [];
  $("tabContent").innerHTML = `<div class="section-title">RESEARCHES</div>
    ${items.length ? `<div class="skill-grid">${items.map(x => `<div class="skill-card skill-with-icon">${VHIcons.skillMarkup("research",x)}<div class="skill-card-content"><strong>${escapeHtml(x)}</strong></div></div>`).join("")}</div>` : `<div class="notice">Nenhuma research encontrada.</div>`}`;
}

function reputationBlock(rep) {
  const value = rep || {};
  return `<div class="reputation-wrap">
    <div class="section-title centered">VAULT GOD REPUTATION</div>
    <div class="reputation-grid">
      ${godCard("IDONA", value.idona ?? 0, "idona")}
      ${godCard("TENOS", value.tenos ?? 0, "tenos")}
      ${godCard("VELARA", value.velara ?? 0, "velara")}
      ${godCard("WENDARR", value.wendarr ?? 0, "wendarr")}
    </div>
    <div class="rep-note">Reputação só é lida de campos explicitamente identificados como reputation/rep em <code>PlayerInfluences</code>. Se não houver valor, o padrão é 0.</div>
  </div>`;
}

function xpPercent(vault) {
  if (vault?.xpProgress == null || !Number.isFinite(Number(vault.xpProgress))) return null;
  return Math.max(0, Math.min(100, Number(vault.xpProgress) * 100));
}

function updateXpHeader(vault) {
  const requiredXp = vault?.nextLevelXp;
  const percent = xpPercent(vault);
  $("xp").textContent = `XP ${formatNumber(vault?.xp)} / ${requiredXp == null ? "?" : formatNumber(requiredXp)}`;
  $("xpRemaining").textContent = vault?.xpRemaining == null ? "" : `Faltam ${formatNumber(vault.xpRemaining)} XP${vault.xpRequirementSourceKind === "jar-default" ? " (padrão)" : ""}`;
  const fill = $("xpMiniFill");
  if (fill) {
    fill.style.width = percent == null ? "0%" : `${percent}%`;
    fill.classList.toggle("unknown", percent == null);
  }
}

function xpProgressBlock(vault) {
  const percent = xpPercent(vault);
  const currentXp = formatNumber(vault?.xp);
  const requiredXp = vault?.nextLevelXp == null ? "?" : formatNumber(vault.nextLevelXp);
  const nextLevel = vault?.nextLevel ?? "?";
  const isDefault = vault?.xpRequirementSourceKind === "jar-default";
  let source;
  if (isDefault) source = `<div class="xp-source">Regra padrão do Remastered 20.0.3. A configuração da instância não foi encontrada; se ela foi alterada, estes valores podem ser diferentes.</div>`;
  else if (vault?.xpRequirementSource) source = `<div class="xp-source">Meta lida da configuração da instância.</div>`;
  else source = `<div class="xp-source warning">Meta de XP não localizada${vault?.xpRequirementError ? ": confira a configuração de níveis" : ""}.</div>`;
  return `<div class="xp-progress-card">
    <div class="xp-progress-top"><div><span>VAULT XP${isDefault ? " · REGRA PADRÃO" : ""}</span><strong>${currentXp} / ${requiredXp}</strong></div><div class="xp-next">Nível ${escapeHtml(nextLevel)}</div></div>
    <div class="xp-progress-track"><div class="xp-progress-fill ${percent == null ? "unknown" : ""}" style="width:${percent == null ? 0 : percent}%"></div></div>
    <div class="xp-progress-bottom"><span>${percent == null ? "Progresso não disponível" : `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% concluído`}</span><strong class="xp-remaining">${vault?.xpRemaining == null ? "XP restante: —" : `Faltam ${formatNumber(vault.xpRemaining)} XP para o nível ${escapeHtml(nextLevel)}`}</strong></div>
    ${source}
  </div>`;
}

function valueStateTitle(value) {
  return value == null || value === "" ? "Dado não localizado no save" : (Number(value) === 0 ? "Dado localizado: valor zero" : "Dado localizado");
}

function godCard(name, value, cls) {
  return `<div class="god-card ${cls}" title="${escapeHtml(valueStateTitle(value))}"><span>${name}</span><strong>${formatNumber(value)}</strong></div>`;
}

function sourceTitle(source, value) {
  const state = valueStateTitle(value);
  if (!source) return state;
  const origin = [source.source, source.path].filter(Boolean).join(" → ");
  return origin ? `${state} | Fonte: ${origin}` : state;
}

function quickStat(title, value, label, source = null) {
  return `<div class="quick-card" title="${escapeHtml(sourceTitle(source, value))}"><span>${escapeHtml(title)}</span><strong>${formatNumber(value)}</strong><small>${escapeHtml(label)}</small></div>`;
}

function miniStat(label, value, source = null) {
  return `<div class="mini-stat" title="${escapeHtml(sourceTitle(source, value))}"><strong>${formatNumber(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function metric(label, value) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${value ?? "—"}</div></div>`;
}

function slotLabel(slot,item = null) {
  const map = { helmet:"Helmet", chestplate:"Chestplate", leggings:"Leggings", boots:"Boots", offhand:"Offhand", mainhand:"Main Hand", belt_0:"Belt", back_0:"Back" };
  if (map[slot]) return map[slot];
  const curio = String(slot).match(/^(.+?)_(\d+)$/);
  if (curio?.[1] === "head" && item?.id === "the_vault:companion") return "Companion" + (Number(curio[2]) > 0 ? ` ${Number(curio[2]) + 1}` : "");
  const types = {charm:"Charm",blue_trinket:"Blue Trinket",red_trinket:"Red Trinket",belt:"Magnet",necklace:"Pendant",deck:"Deck",head:"Potion",back:"Back",ring:"Ring",trinket:"Trinket",compass:"Compass",body:"Body"};
  if (curio && types[curio[1]]) return types[curio[1]] + (Number(curio[2]) > 0 ? ` ${Number(curio[2]) + 1}` : "");
  if (String(slot).startsWith("hotbar_")) return `Hotbar ${String(slot).split("_")[1]}`;
  return String(slot || "Item").replace(/_/g, " ");
}

function slotGlyph(slot) {
  if (slot === "helmet") return "H";
  if (slot === "chestplate") return "C";
  if (slot === "leggings") return "L";
  if (slot === "boots") return "B";
  if (slot === "offhand") return "O";
  if (String(slot).startsWith("belt")) return "◆";
  if (String(slot).startsWith("back")) return "▣";
  return "✦";
}

function formatNumber(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  return number.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function showNoPlayers() {
  $("players").innerHTML = `<div class="notice">Nenhum UUID encontrado em playerdata ou nos arquivos do Vault Hunters.</div>`;
  setView("armory");
  $("profile").hidden = true;
  $("empty").hidden = false;
  $("emptyMessage").textContent = "Nenhum jogador encontrado neste mundo.";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char]));
}

$("search").addEventListener("input", renderPlayers);
$("homeSearch").addEventListener("input", renderHomePlayers);
$("reload").onclick = async () => {
  const button = $("reload");
  if (button.disabled) return;
  button.disabled = true;button.textContent = 'Atualizando...';
  try { await api("/api/reload", { method:"POST" }); await boot(); }
  catch (error) { updateSourceStatus({...lastSource,state:'error',message:error.message});showSourceError(error.message); }
  finally { button.disabled = false;button.textContent = 'Recarregar dados'; }
};
document.querySelectorAll(".tabs button").forEach(button => button.onclick = () => { currentTab = button.dataset.tab; renderTab(); });
boot();
