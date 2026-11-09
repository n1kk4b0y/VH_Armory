// Original local mod resources. An unknown identifier keeps a neutral fallback.
(() => {
  const catalog = window.VH_ASSET_CATALOG || {};
  const initialized = new WeakSet();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const key = value => String(value || '').split(':').at(-1).toLowerCase().replace(/[^a-z0-9]/g,'');
  const safeUrl = value => typeof value === 'string' && value.startsWith('/assets/vault/') ? value : null;

  function skillUrl(kind, skill, fallback) {
    const entries = kind === 'ability' ? catalog.abilities : kind === 'research' ? catalog.research : kind === 'prestige' ? catalog.prestige : catalog.skills;
    const candidates = typeof skill === 'string' ? [skill] : [skill?.id,skill?.name];
    for (const candidate of candidates) {
      const id = key(candidate);
      const direct = safeUrl(entries?.[id]);
      if (direct) return direct;
      if (kind === 'ability' && id.endsWith('base')) {
        const base = safeUrl(entries?.[id.slice(0,-4)]);
        if (base) return base;
      }
    }
    return fallback ? skillUrl(kind,fallback) : null;
  }

  function gearUrl(gear) {
    if(gear?.deck?.icon)return safeUrl(gear.deck.icon);
    const models = catalog.models || {};
    const attributes = gear?.modifierGroups?.attributes || [];
    const modelRow = attributes.find(row => key(row.id) === 'gearmodel' || /Gear Model$/i.test(row.displayText || row.label || ''));
    let nativeModel = modelRow?.rawValue;
    if (nativeModel && typeof nativeModel === 'object') nativeModel = nativeModel.id || nativeModel.value;
    if (typeof nativeModel !== 'string') nativeModel = String(modelRow?.displayText || modelRow?.display || '').match(/[a-z0-9_-]+:gear\/[a-z0-9_/-]+/i)?.[0];
    const unidentified = /unidentified|rolling/i.test(gear?.state || '') || gear?.trinket?.status === 'unidentified';
    if (!unidentified) {
      if (gear?.trinket?.status === 'identified') {
        const id = String(gear.trinket.effectId || '');
        const variant = id.startsWith('the_vault:') ? id.slice(10) : '';
        const icon = safeUrl(models['the_vault:trinket/' + variant])
          || safeUrl(models['the_vault:trinket/greed/' + variant]);
        if (icon) return icon;
      }
      for (const model of [nativeModel,gear?.model]) {
        const url = safeUrl(models[String(model || '').toLowerCase()]);
        if (url) return url;
      }
      if (gear?.id === 'the_vault:tool') {
        const typeRow = attributes.find(row => key(row.id) === 'tooltype');
        let type = typeRow?.rawValue || gear.toolType;
        if (type && typeof type === 'object') type = type.name || type.id || type.value;
        const tool = safeUrl(catalog.tools?.[key(type)]);
        if (tool) return tool;
      }
    }
    return safeUrl(catalog.items?.[String(gear?.id || '').toLowerCase()]);
  }

  function markup(url, size, fallback) {
    const source = safeUrl(url);
    return `<span class="mod-icon mod-icon--${escape(size)}" data-icon-state="${source ? 'loading' : 'unavailable'}" data-icon-placeholder="${escape(fallback || '◇')}" aria-hidden="true">${source ? `<img data-mod-icon src="${escape(source)}" alt="" loading="lazy" decoding="async" width="48" height="48">` : ''}</span>`;
  }

  function skillMarkup(kind, skill, size='skill', fallback) {
    return markup(skillUrl(kind,skill,fallback),size,kind === 'research' ? '▧' : '✦');
  }

  function gearMarkup(gear, size='item', fallback='◇') {
    return markup(gearUrl(gear),size,fallback);
  }

  function uiMarkup(name) {
    return markup(catalog.ui?.[name],'tab','◆');
  }

  function bountyMarkup(type) {
    const id=String(type||'').split(':').at(-1)+'_bounty';
    return markup(catalog.bounties?.[id],'skill','◇');
  }

  function questMarkup(quest) {
    const icon=String(quest.icon||'');
    const native=icon.startsWith('the_vault:gui/quests/') ? icon.slice('the_vault:gui/quests/'.length).replace(/\.png$/,'') : '';
    return markup(catalog.quests?.[native] || catalog.quests?.[quest.id],'skill','▧');
  }

  function discoveryMarkup(item) {
    const greed=String(item.model||'').startsWith('the_vault:trinket/') ? String(item.model).replace('the_vault:trinket/','the_vault:trinket/greed/') : '';
    return markup(catalog.models?.[item.model] || catalog.models?.[greed] || catalog.items?.[item.id],'item',item.symbol||'◇');
  }

  function modifierMarkup(effect,size='skill') {
    return markup(effect?.icon,size,'✦');
  }

  function mount(root=document) {
    root.querySelectorAll('img[data-mod-icon]').forEach(img => {
      if (initialized.has(img)) return;
      initialized.add(img);
      const wrapper = img.parentElement;
      const ready = () => {
        wrapper.dataset.iconState = img.naturalWidth && img.naturalHeight ? 'ready' : 'unavailable';
      };
      const unavailable = () => {
        wrapper.dataset.iconState = 'unavailable';
        img.removeAttribute('src');
      };
      img.addEventListener('load',ready);
      img.addEventListener('error',unavailable,{once:true});
      if (img.complete && img.getAttribute('src')) {
        if (img.naturalWidth) ready();
        else unavailable();
      }
    });
  }

  window.VHIcons = { skillUrl, gearUrl, skillMarkup, gearMarkup, uiMarkup, bountyMarkup, questMarkup, discoveryMarkup, modifierMarkup, nativeMarkup:markup, mount };
})();
