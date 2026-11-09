// Read-only progression views. State is scoped to the selected player.
(() => {
  let discoveryRequest=0, discoveryPlayer=null, category='models', page=1, query='';
  let questPlayer=null, questFilter='inProgress', questQuery='';
  const categories={models:'Modelos',trinkets:'Trinkets',artifacts:'Artefatos',themes:'Temas',titles:'Títulos',emblems:'Emblemas',trails:'Trails',goals:'Conquistas'};
  const statusNames={active:'Ativas',complete:'Prontas para resgatar',available:'Disponíveis',legendary:'Lendárias',completed:'Concluídas',ready:'Prontas para entregar',inProgress:'Em andamento'};
  const container=()=>document.getElementById('tabContent');
  const num=value=>formatNumber(value);
  const esc=value=>escapeHtml(value);
  const date=value=>value==null||value===0 ? 'Data indisponível' : new Date(value).toLocaleString('pt-BR');
  const count=(name,value)=>`<div class="p2-count"><span>${esc(name)}</span><strong>${num(value)}</strong></div>`;
  const heading=(title,copy)=>`<div class="p2-heading"><div class="eyebrow">PLAYER PROGRESSION</div><h2>${esc(title)}</h2><p>${esc(copy)}</p></div>`;
  function progress(value,goal,ratio) {
    return `<div class="p2-progress"><div><span>Progresso</span><strong>${num(value)}${goal!=null ? ' / '+num(goal) : ''}</strong></div>
      ${ratio!=null ? `<div class="p2-track" role="progressbar" aria-label="Progresso do objetivo" aria-valuenow="${Math.round(ratio*100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${ratio*100}%"></i></div>` : ''}</div>`;
  }
  function rewards(reward) {
    if(!reward)return '<p class="p2-muted">Recompensas não localizadas.</p>';
    return `<div class="p2-rewards"><div class="p2-reward-heading"><span>RECOMPENSAS</span>
      ${reward.vaultXp!=null?`<strong>+${num(reward.vaultXp)} Vault XP</strong>`:''}
      ${reward.skillPoints>0?`<strong>+${num(reward.skillPoints)} Skill Points</strong>`:''}</div>
      ${reward.items?.length ? `<div class="p2-reward-items">${reward.items.map(item=>`<div class="p2-reward-item">${VHIcons.gearMarkup(item,'item')}<span>${esc(item.name)}</span><b>×${num(item.amount)}</b></div>`).join('')}</div>` : reward.items ? '<p class="p2-muted">Nenhum item de recompensa registrado.</p>' : '<p class="p2-muted">Itens de recompensa não localizados.</p>'}</div>`;
  }
  function renderBounties(player) {
    const data=player.bounties;
    const header=heading('Bounties','Objetivos, progresso e recompensas registrados para este hunter.');
    if(!data?.available){container().innerHTML=header+'<div class="notice">Nenhum registro de Bounties foi localizado para este jogador.</div>';return;}
    container().innerHTML=header+`<div class="p2-counts">${['active','complete','available','legendary'].map(group=>count(statusNames[group],data.counts[group])).join('')}</div>
      <p class="p2-caption">As Bounties prontas aguardam resgate no jogo. O save não mantém um total histórico das recompensas já resgatadas.</p>
      ${['active','complete','available','legendary'].map(group=> {
        const entries=data.groups[group];
        if(!entries?.length)return group==='active'?'<div class="p2-empty">Nenhuma Bounty ativa registrada.</div>':'';
        return `<div class="section-title">${statusNames[group].toUpperCase()}</div><div class="p2-bounty-grid">${entries.map(bounty=>`<article class="p2-bounty-card" data-bounty-status="${group}">
          <header>${VHIcons.bountyMarkup(bounty.type)}<div><span class="p2-badge ${group}">${statusNames[group]}</span><h3>${esc(bounty.typeLabel)}</h3></div></header>
          <div class="p2-target">${bounty.target ? esc(bounty.target.name) : 'Alvo não identificado'}${bounty.vaultOnly ? '<small>Dentro de vaults</small>' : ''}</div>
          ${progress(bounty.progress,bounty.goal,bounty.ratio)}
          ${bounty.expiresAt>0&&group==='available'?`<p class="p2-muted">Disponível após ${esc(date(bounty.expiresAt))}</p>`:''}
          ${rewards(bounty.reward)}
        </article>`).join('')}</div>`;
      }).join('')}`;
  }
  function renderQuests(player) {
    const data=player.quests;
    if(questPlayer!==player.uuid){questPlayer=player.uuid;questFilter=data?.counts.ready>0?'ready':'inProgress';questQuery='';}
    const header=heading('Quests','Acompanhe as missões concluídas, prontas para entregar e em andamento.');
    if(!data?.available){container().innerHTML=header+'<div class="notice">Nenhum registro de Quests foi localizado para este jogador.</div>';return;}
    container().innerHTML=header+`<div class="p2-counts three">${['inProgress','ready','completed'].map(status=>count(statusNames[status],data.counts[status])).join('')}</div>
      <div class="p2-controls"><div class="p2-filters" aria-label="Filtrar Quests">${['inProgress','ready','completed','all'].map(status=>`<button type="button" data-quest-filter="${status}" aria-pressed="${questFilter===status}" class="${questFilter===status?'active':''}">${status==='all'?'Todas':statusNames[status]}</button>`).join('')}</div>
      <input class="search p2-search" id="questSearch" type="search" maxlength="200" placeholder="Pesquisar missão..." aria-label="Pesquisar missão" value="${esc(questQuery)}"></div>
      ${data.definitions.unmatched>0 ? '<p class="p2-caption">Metas e recompensas adicionais aparecem quando a configuração de Quests da instância está disponível.</p>' : ''}
      <div id="questResults"></div>`;
    const paint=()=>{
      const list=data.quests.filter(quest=>(questFilter==='all'||quest.status===questFilter)&&`${quest.id} ${quest.name}`.toLocaleLowerCase('pt-BR').includes(questQuery.toLocaleLowerCase('pt-BR')));
      document.getElementById('questResults').innerHTML=list.length?`<div class="p2-quest-grid">${list.map(quest=>`<article class="p2-quest-card" data-quest-status="${quest.status}">
        <header>${VHIcons.questMarkup(quest)}<div><span class="p2-badge ${quest.status}">${statusNames[quest.status]}</span><h3>${esc(quest.name)}</h3></div></header>
        ${quest.description?`<p class="p2-quest-description">${esc(quest.description)}</p>`:''}
        ${quest.status==='inProgress'?progress(quest.progress,quest.goal,quest.ratio):''}
        ${quest.status==='inProgress'&&quest.goal!=null&&quest.definitionSourceKind==='jar-default'?'<p class="p2-muted">Meta padrão do mod.</p>':''}
        ${quest.status==='inProgress'&&quest.goal==null?'<p class="p2-muted">Meta não localizada na configuração disponível.</p>':''}
        ${quest.status!=='completed'?rewards(quest.reward):''}
      </article>`).join('')}</div>`:'<div class="p2-empty">Nenhuma missão neste filtro.</div>';
      VHIcons.mount(document.getElementById('questResults'));
    };
    paint();
    container().querySelectorAll('[data-quest-filter]').forEach(button=>button.onclick=()=>{questFilter=button.dataset.questFilter;renderQuests(player);VHIcons.mount(container());});
    document.getElementById('questSearch').oninput=event=>{questQuery=event.target.value;paint();};
  }
  function renderDiscoveries(player) {
    const data=player.discoveries;
    if(discoveryPlayer!==player.uuid){discoveryPlayer=player.uuid;category='models';page=1;query='';}
    const header=heading('Discoveries','A coleção de modelos, itens e cosméticos que este hunter já descobriu.');
    if(!data?.available){container().innerHTML=header+'<div class="notice">Nenhum registro de descobertas foi localizado para este jogador.</div>';return;}
    container().innerHTML=header+`<div class="p2-discovery-filters" aria-label="Categorias de descobertas">${Object.entries(categories).map(([key,name])=>`<button type="button" data-discovery-category="${key}" class="${category===key?'active':''}" aria-pressed="${category===key}"><span>${name}</span><b>${num(data.categories[key]?.count)}</b></button>`).join('')}</div>
      <form id="discoverySearchForm" class="p2-discovery-search"><input class="search" id="discoverySearch" type="search" maxlength="200" placeholder="Pesquisar nesta coleção..." aria-label="Pesquisar descobertas" value="${esc(query)}"><button type="submit">Pesquisar</button></form>
      <div id="discoveryResults" aria-live="polite"></div><div id="discoveryPagination" class="p2-pagination"></div>`;
    container().querySelectorAll('[data-discovery-category]').forEach(button=>button.onclick=()=>{category=button.dataset.discoveryCategory;page=1;query='';renderDiscoveries(player);});
    document.getElementById('discoverySearchForm').onsubmit=event=>{event.preventDefault();query=document.getElementById('discoverySearch').value.trim();page=1;loadDiscoveries(player);};
    loadDiscoveries(player);
  }
  async function loadDiscoveries(player) {
    const request=++discoveryRequest, result=document.getElementById('discoveryResults');
    if(!result)return;
    result.innerHTML='<div class="p2-empty">Carregando coleção...</div>';
    document.getElementById('discoveryPagination').innerHTML='';
    try{
      const data=await api(`/api/players/${encodeURIComponent(player.uuid)}/discoveries?category=${category}&page=${page}&limit=24&q=${encodeURIComponent(query)}`);
      if(request!==discoveryRequest||!result.isConnected)return;
      result.innerHTML=!data.available?'<div class="notice">Esta coleção não tem registro no save deste jogador.</div>':!data.items.length?`<div class="p2-empty">${query?'Nenhuma descoberta corresponde à pesquisa.':'Nenhuma descoberta registrada nesta coleção.'}</div>`:
        `<div class="p2-discovery-grid">${data.items.map(item=>`<article class="p2-discovery-card">${VHIcons.discoveryMarkup(item)}<div><h3>${esc(item.name)}</h3>
          ${item.discoveredDate?`<small>Descoberto em ${esc(item.discoveredDate.split('-').reverse().join('/'))}</small>`:''}
          ${item.kind?`<small>${item.kind==='prefix'?'Prefixo':'Sufixo'}</small>`:''}
          ${item.selected?'<span class="p2-badge selected">Selecionado</span>':''}
          ${item.status?`<span class="p2-badge ${item.status}">${statusNames[item.status]}</span>`:''}
          ${item.progress!=null?`<small>Progresso: ${num(item.progress)}</small>`:''}
          ${item.description?`<p>${esc(item.description)}</p>`:''}
        </div></article>`).join('')}</div>`;
      document.getElementById('discoveryPagination').innerHTML=data.available?`<button type="button" id="discoveryPrevious" ${data.hasPrevious?'':'disabled'}>Anterior</button><span>${data.total} ${data.total===1?'descoberta':'descobertas'} · Página ${data.pages?data.page:0} de ${data.pages}</span><button type="button" id="discoveryNext" ${data.hasNext?'':'disabled'}>Próxima</button>`:'';
      const previous=document.getElementById('discoveryPrevious'),next=document.getElementById('discoveryNext');
      if(previous)previous.onclick=()=>{page=Math.max(1,page-1);loadDiscoveries(player);};
      if(next)next.onclick=()=>{page++;loadDiscoveries(player);};
      VHIcons.mount(result);
    }catch(error){if(request===discoveryRequest&&result.isConnected)result.innerHTML=`<div class="notice">${esc(error.message)}</div>`;}
  }
  function snapshotBlock(snapshot) {
    if(!snapshot?.available)return '';
    return `<section class="p2-snapshot"><div class="section-title">SNAPSHOT DO JOGADOR</div>
      <p class="p2-caption">Capturado em ${esc(date(snapshot.timestampMs))}. Contadores acumulados que o mod incluiu nessa captura.</p>
      <div class="p2-counts">${Object.values(snapshot.counters).map(row=>count(row.name,row.value)).join('')}${count('DPS',snapshot.summary.dps)}${count('Defense',snapshot.summary.defense==null?'—':(snapshot.summary.defense*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%')}</div>
      ${snapshot.chests.length||snapshot.objectives.length?`<details class="p2-snapshot-detail"><summary>Baús e objetivos da captura</summary>
        ${snapshot.chests.length?`<div class="p2-captured-table">${snapshot.chests.map(row=>`<div><span>${esc(row.type)} · ${esc(row.rarity)}</span><strong>${num(row.count)}</strong></div>`).join('')}</div>`:''}
        ${snapshot.objectives.length?`<div class="p2-captured-table">${snapshot.objectives.map(row=>`<div><span>${esc(row.name)}</span><span>Completas ${num(row.completed)} · Falhas ${num(row.failed)} · Abandonadas ${num(row.bailed)}</span></div>`).join('')}</div>`:''}</details>`:''}</section>`;
  }
  window.VHP2={renderBounties,renderQuests,renderDiscoveries,snapshotBlock,cancel(){discoveryRequest++;}};
})();
