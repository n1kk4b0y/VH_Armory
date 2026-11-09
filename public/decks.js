(() => {
  const selected=new Map();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const num=value=>value==null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const colors={RED:'#f16868',BLUE:'#61b6ff',YELLOW:'#efcb61',GREEN:'#81d374',PURPLE:'#c684ee'};
  const stat=row=>`<div class="deck-stat${row.abilityPower?' gear-ability-power':''}"><span>${esc(row.label)}</span><b>${esc(row.display)}</b></div>`;
  function tooltip(deck) {
    if(!deck)return '';
    return `<div class="gear-mod-section deck-item-details" data-deck-details>
      <div class="gear-mod-line gear-kv"><span>Cartas equipadas</span><b>${num(deck.cardCount)} / ${num(deck.slotCount)}</b></div>
      <div class="gear-mod-line gear-kv"><span>Slots Arcane</span><b>${num(deck.arcaneSlotCount)}</b></div>
      <div class="gear-mod-line gear-kv"><span>Núcleos</span><b>${deck.coresAvailable?num(deck.cores.length):'—'} / ${num(deck.socketCount)}</b></div>
      ${deck.stats.length?`<div class="gear-mod-heading">${deck.calculationComplete?'Bônus do deck':'Bônus calculados disponíveis'}</div>${deck.stats.map(stat).join('')}`:''}
      ${deck.cores.map(core=>`<div class="deck-tooltip-core">${VHIcons.nativeMarkup(core.icon,'tab','◆')}<span><b>${esc(core.name)}</b><small>${esc(core.description || 'Descrição deste núcleo indisponível.')}</small></span></div>`).join('')}
      <p class="companion-help">Veja a disposição e os detalhes das cartas abaixo do conjunto.</p>
    </div>`;
  }
  function details(card) {
    if(!card)return '<p class="companion-help">Selecione uma carta para ver seus dados.</p>';
    const maxTier=Math.max(...card.entries.map(entry=>entry.maxTier || 0));
    return `<div class="deck-card-title">${VHIcons.nativeMarkup(card.icon,'skill','▧')}<div><h3>${esc(card.name)}</h3><span>Tier ${num(card.tier)}${maxTier?' / '+num(maxTier):''}</span></div>${card.foil?'<b class="deck-foil-label">Foil</b>':''}</div>
      <div class="deck-card-tags">${card.groups.map(group=>`<span>${esc(group)}</span>`).join('')}${card.colors.map(color=>`<span style="--tag-color:${colors[color] || '#c2b8a7'}" class="deck-color-tag">${esc(color)}</span>`).join('')}</div>
      ${card.entries.map(entry=>`<div class="deck-card-effect">
        ${card.entries.length>1?`<strong>${esc(entry.name)}</strong>`:''}
        <p class="${/ability_power/.test(entry.attribute || '')?'gear-ability-power':''}">${esc(entry.effect || entry.baseEffect || 'Efeito indisponível neste registro.')}</p>
        ${entry.type==='gear' && entry.effectiveKnown && card.efficiency!==1?`<small>Valor base: ${esc(entry.baseEffect)} · eficiência ${num(card.efficiency)}×</small>`:''}
        ${entry.type==='gear' && !entry.effectiveKnown?'<small>Valor base; o efeito final desta carta não pôde ser calculado.</small>':''}
        ${entry.conditional?'<small>Esta carta possui condição ou escalonamento registrado.</small>':''}
        ${entry.task?`<div class="deck-task-progress"><span>Progresso registrado</span><b>${num(entry.task.current)} / ${num(entry.task.target)}</b></div>`:''}
      </div>`).join('')}`;
  }
  function render(player) {
    const decks=(player.gearSnapshot?.curios || []).filter(item=>item.curioType==='deck' && item.deck);
    return decks.map((item,index)=>{
      const deck=item.deck,cards=deck.slots.filter(slot=>slot.card);
      const key=player.uuid+':'+item.slot;
      const chosen=selected.get(key),slot=cards.find(slot=>slot.x+','+slot.y===chosen) || cards[0];
      const columns=Math.max(1,...deck.slots.map(slot=>slot.x+1));
      return `<section class="deck-panel" data-deck-panel="${index}"><div class="deck-heading"><div>${VHIcons.nativeMarkup(deck.icon,'skill','▧')}<h2>${esc(item.displayName || deck.name)}</h2></div><span>${num(deck.cardCount)} / ${num(deck.slotCount)} cartas · ${deck.coresAvailable?num(deck.cores.length):'—'} / ${num(deck.socketCount)} núcleos</span></div>
        ${!deck.available?'<div class="notice">Os dados das cartas não estão disponíveis neste registro.</div>':`<div class="deck-content"><div class="deck-board"><div class="deck-layout" style="--deck-columns:${columns}">
          ${deck.slots.map(cell=>{const id=cell.x+','+cell.y,arcane=cell.requiredGroups.includes('Arcane'),card=cell.card;return card?
            `<button type="button" class="deck-cell${card.foil?' foil':''}" data-deck-card="${esc(id)}" aria-label="${esc(card.name+', linha '+(cell.y+1)+', coluna '+(cell.x+1))}" aria-pressed="${slot===cell}" style="grid-column:${cell.x+1};grid-row:${cell.y+1};--card-color:${colors[card.colors[0]] || '#aa967a'}">${VHIcons.nativeMarkup(card.icon,'item','▧')}<small>T${num(card.tier)}</small></button>`:
            `<div class="deck-cell deck-cell--empty${arcane?' arcane':''}" style="grid-column:${cell.x+1};grid-row:${cell.y+1}" aria-label="${arcane?'Slot Arcane vazio':'Slot vazio'}"><span>${arcane?'✦':'—'}</span><small>${arcane?'Arcane':'Vazio'}</small></div>`;}).join('')}
        </div><p class="companion-help">Selecione uma carta · disposição do deck equipado</p></div><div class="deck-card-details" data-deck-card-details>${details(slot?.card)}</div></div>`}
        ${deck.cores.length?`<div class="deck-cores">${deck.cores.map(core=>`<div class="deck-core">${VHIcons.nativeMarkup(core.icon,'skill','◆')}<div><strong>${esc(core.name)}</strong><p>${esc(core.description || 'Descrição deste núcleo indisponível.')}</p></div></div>`).join('')}</div>`:''}
        ${deck.stats.length?`<div class="deck-bonuses"><h3>${deck.calculationComplete?'Bônus do deck equipado':'Bônus calculados disponíveis'}</h3><div>${deck.stats.map(stat).join('')}</div></div>`:''}
        ${deck.available && deck.cardCount===0?'<p class="companion-help">Nenhuma carta equipada neste registro.</p>':''}
      </section>`;
    }).join('');
  }
  function mount(root,player) {
    const decks=(player.gearSnapshot?.curios || []).filter(item=>item.curioType==='deck' && item.deck);
    root.querySelectorAll('[data-deck-panel]').forEach(panel=>{
      const item=decks[Number(panel.dataset.deckPanel)];
      panel.querySelectorAll('[data-deck-card]').forEach(button=>button.addEventListener('click',()=>{
        const slot=item.deck.slots.find(slot=>slot.x+','+slot.y===button.dataset.deckCard);
        if(!slot?.card)return;
        selected.set(player.uuid+':'+item.slot,button.dataset.deckCard);
        panel.querySelectorAll('[data-deck-card]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
        const detailsPanel=panel.querySelector('[data-deck-card-details]');detailsPanel.innerHTML=details(slot.card);VHIcons.mount(detailsPanel);
      }));
    });
  }
  window.VHDecks={tooltip,render,mount};
})();
