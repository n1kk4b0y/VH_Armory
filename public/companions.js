(() => {
  const selections=new Map();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const number=value=>value == null ? '—' : Number(value).toLocaleString('pt-BR');
  function selected(player) {
    const list=player.companions?.items || [];
    return list.find(item=>item.id===selections.get(player.uuid)) || list.find(item=>item.id===player.companions?.selectedId) || list[0] || null;
  }
  function equippedLabel(item) {
    return {'vault-entry':'equipado na entrada da vault',logout:'equipado na última desconexão',
      'player-save':'equipado no save'}[item.equippedRecord?.kind] || 'equipado no save';
  }
  function referenceTime(item) {
    return item.sourceKind==='curios-item' && item.equippedRecord?.timestamp>0 ? item.equippedRecord.timestamp*1000 : Date.now();
  }
  function sourceNote(item) {
    if(item.sourceKind!=='curios-item')return 'Dados da coleção de companions registrada no mundo.';
    const label={'vault-entry':'Dados registrados ao entrar na vault',logout:'Dados registrados na última desconexão',
      'player-save':'Dados do item equipado no save do jogador'}[item.equippedRecord?.kind] || 'Dados do item equipado';
    return label+(item.equippedRecord?.timestamp>0 ? ' em '+new Date(item.equippedRecord.timestamp*1000).toLocaleString('pt-BR') : '')+'.';
  }
  function status(item) {
    if(item.hearts===0)return 'Sem vidas';
    if(item.cooldownExpiry == null)return 'Cooldown não informado';
    if(item.cooldownExpiry>referenceTime(item))return 'Em cooldown';
    if(item.hearts == null)return 'Vidas não informadas';
    return 'Pronto';
  }
  function series(item) {return item.series ? item.series.charAt(0).toUpperCase()+item.series.slice(1).toLowerCase() : '—';}
  function slotCount(used,total) {return number(used)+' / '+number(total);}
  function cooldown(item) {
    if(item.hearts===0)return 'Sem vidas';
    if(item.cooldownExpiry==null)return 'Não informado';
    const seconds=Math.max(0,Math.ceil((item.cooldownExpiry-referenceTime(item))/1000));
    if(!seconds)return 'Pronto';
    const minutes=Math.floor(seconds/60),remainder=String(seconds%60).padStart(2,'0');
    return minutes+':'+remainder;
  }
  function controls(player) {
    const list=player.companions?.items || [],item=selected(player);
    if(!item)return `<p class="companion-empty">${player.companions?.available ? 'Nenhum companion registrado' : 'Dados de companions indisponíveis'}</p>`;
    return `<label class="companion-picker">Companion <select data-companion-select aria-label="Selecionar companion">${list.map(p=>`<option value="${esc(p.id)}" ${p.id===item.id?'selected':''}>${esc(p.name)}${p.equipped?' · '+esc(equippedLabel(p)):''}</option>`).join('')}</select></label>
      <div class="companion-caption"><strong>${esc(item.name)}</strong><span>${esc(item.typeName || 'Companion')} · ${esc(series(item))}</span><span>Lv. ${number(item.level)} · <b class="companion-hearts">♥ ${number(item.hearts)} / ${number(item.maxHearts)}</b></span><small>${esc(status(item))}${item.equipped?' · '+esc(equippedLabel(item)):' · selecionado para visualizar'}</small><small>${esc(item.temporal?.name || 'Habilidade não informada')} · ${number(item.vaultRuns)} vaults</small><button type="button" class="companion-details-link" data-companion-details-open>Ver detalhes do companion</button></div>`;
  }
  function mountControls(root,player,onChange) {
    root.querySelector('[data-companion-details-open]')?.addEventListener('click',()=>root.closest('main')?.querySelector('[data-tab="companions"]')?.click());
    root.querySelector('[data-companion-select]')?.addEventListener('change',event=>{
      if(!player.companions?.items.some(item=>item.id===event.target.value))return;
      selections.set(player.uuid,event.target.value);onChange();
    });
  }
  function modifier(item) {
    return `<div class="companion-ability"><div class="companion-effect-title">${VHIcons.modifierMarkup(item)}<strong>${esc(item.name)}${item.stacks>1?' ×'+number(item.stacks):''}</strong></div><p>${esc(item.description || 'Descrição do efeito indisponível na configuração lida.')}</p></div>`;
  }
  function tooltip(item) {
    if(!item)return '';
    const row=(label,value,cls='')=>`<div class="gear-mod-line gear-kv ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
    return `<div class="gear-mod-section companion-item-details" data-companion-details>
      ${row('Nível',number(item.level))}${row('Vidas','♥ '+slotCount(item.hearts,item.maxHearts),'companion-item-health')}
      ${row(item.equippedRecord?.timestamp>0?'Cooldown no registro':'Cooldown',cooldown(item),item.cooldownExpiry!=null && item.cooldownExpiry<=referenceTime(item) && item.hearts>0?'companion-item-ready':'')}
      ${row('Série',series(item))}${row('Tipo',item.typeName || '—')}${row('Vaults',number(item.vaultRuns))}
      ${row('Relíquias comuns',slotCount(item.relicsEquipped,item.relicSlots))}${row('Relíquias Ancient',slotCount(item.ancientRelicsEquipped,item.ancientRelicSlots),'companion-item-ancient')}
      ${item.atMaxLevel===true?'<p class="companion-help">Nível máximo</p>':row('XP para o próximo nível',number(item.xpRemaining))}
      ${item.temporal?`<div class="companion-item-temporal"><div class="gear-mod-heading">Habilidade temporal</div>${modifier(item.temporal)}${item.temporalDurationTicks!=null?`<p class="companion-help">Duração base: ${number(item.temporalDurationTicks/20)} s</p>`:''}</div>`:''}
      ${(item.passiveEffects || []).length?`<div class="companion-item-passives"><div class="gear-mod-heading">Efeitos das relíquias</div>${item.passiveEffects.map(effect=>`<div class="companion-passive-line">${VHIcons.modifierMarkup(effect,'tab')}<span>${esc(effect.name)}</span><b>×${number(effect.stacks)}</b></div>`).join('')}</div>`:''}
    </div>`;
  }
  function relicSection(list,used,capacity,ancient=false) {
    const title=ancient?'Relíquias Ancient':'Relíquias comuns';
    return `<section class="companion-relic-section ${ancient?'companion-relic-section--ancient':''}"><h3>${title}<span class="companion-slot-count">${slotCount(used,capacity)}</span></h3>
      ${list.length?list.map(relic=>`<div class="companion-relic"><span>${ancient?'Ancient':'Slot '+number(relic.slot+1)}</span>${relic.modifiers.length?relic.modifiers.map(modifier).join(''):'<p class="companion-help">Efeito não informado.</p>'}</div>`).join(''):
        `<p class="companion-help">${used==null?'Relíquias não informadas neste registro.':ancient && capacity===0?'Slot Ancient desbloqueado no nível 10.':ancient?'Nenhuma relíquia Ancient equipada.':'Nenhuma relíquia comum equipada.'}</p>`}</section>`;
  }
  function render(player,onChange) {
    const target=document.getElementById('tabContent'),item=selected(player);
    if(!item) {target.innerHTML=`<div class="section-title">COMPANIONS</div><div class="notice">${player.companions?.available ? 'Nenhum companion deste jogador foi registrado no save.' : 'O arquivo de companions não está disponível neste save.'}</div>`;return;}
    const remaining=item.cooldownExpiry == null ? null : Math.max(0,Math.ceil((item.cooldownExpiry-referenceTime(item))/1000));
    const metric=(name,value)=>`<div><span>${name}</span><strong>${number(value)}</strong></div>`;
    target.innerHTML=`<div class="section-title">COMPANIONS <span class="badge">${number(player.companions.count)}</span></div>
      <div class="companion-profile">
        <figure class="gear-avatar companion-preview">${VHViewer.markup(player,item)}<figcaption>${esc(player.name || 'Player '+String(player.uuid || '').slice(0,8))} & ${esc(item.name)}</figcaption>${controls(player)}</figure>
        <section class="companion-sheet">
          <div class="companion-heading"><div><div class="eyebrow">${esc(item.typeName || 'Companion')} · ${esc(series(item))}</div><h2>${esc(item.name)}</h2></div><span class="companion-state ${item.hearts===0?'no-lives':remaining>0?'cooldown':item.hearts == null || remaining == null?'unknown':'ready'}">${esc(status(item))}</span></div>
          ${item.equipped?`<p class="companion-help">${esc(equippedLabel(item))} · ${item.active==null?'Ativação não informada':item.active?'Ativo':'Inativo'}</p>`:''}
          <p class="companion-help companion-source">${esc(sourceNote(item))}</p>
          <div class="companion-vitality"><span>Vidas <b>♥ ${number(item.hearts)} / ${number(item.maxHearts)}</b></span><div class="companion-life-track"><i style="width:${item.hearts != null && item.maxHearts>0 ? Math.min(100,item.hearts/item.maxHearts*100) : 0}%"></i></div><small>Corações restantes do companion no registro do mundo.</small></div>
          <div class="companion-metrics">${metric('Nível',item.level)}${metric('XP atual',item.xp)}${metric('Vaults',item.vaultRuns)}${metric('Slots de relíquias',item.relicSlots)}</div>
          <div class="companion-xp"><div><span>${item.atMaxLevel===true?'Nível máximo':`Faltam <b>${number(item.xpRemaining)}</b> XP para o próximo nível`}</span><small>${item.atMaxLevel===true?'':number(item.xp)+' / '+number(item.xpRequired)+' XP'}</small></div><div class="xp-mini-track"><div class="xp-mini-fill" style="width:${item.atMaxLevel===true?100:(item.xpProgress || 0)*100}%"></div></div></div>
          <div class="companion-cooldown"><span>Cooldown ${item.sourceKind==='curios-item' && item.equippedRecord?.timestamp>0?'no registro':'restante'}</span><strong>${item.hearts===0?'Sem vidas':remaining == null ? '—' : remaining>0 ? `${Math.ceil(remaining/60)} min` : 'Disponível'}</strong><small>Cooldown base: ${number(item.baseCooldownMinutes)} min</small></div>
          <h3>Habilidade temporal</h3>${item.temporal?modifier(item.temporal):'<div class="notice">Nenhuma habilidade temporal informada.</div>'}
          ${item.temporalDurationTicks != null ? `<p class="companion-help">Duração base: ${number(item.temporalDurationTicks/20)} s.</p>`:''}
          ${relicSection(item.relics,item.relicsEquipped,item.relicSlots)}
          ${relicSection(item.ancientRelics || [],item.ancientRelicsEquipped,item.ancientRelicSlots,true)}
          ${(item.passiveEffects || []).length?`<h3>Efeitos das relíquias</h3><div class="companion-passives">${item.passiveEffects.map(effect=>`<div class="companion-passive-line">${VHIcons.modifierMarkup(effect,'tab')}<span>${esc(effect.name)}</span><b>×${number(effect.stacks)}</b></div>`).join('')}</div>`:''}
          ${item.hatchedDate?`<p class="companion-help">Chocado em ${esc(item.hatchedDate)}</p>`:''}
        </section>
      </div>`;
    mountControls(target,player,onChange);VHSkins.mount(target);VHViewer.mount(target,player,item);
  }
  window.VHCompanions={selected,controls,mountControls,render,tooltip};
})();
