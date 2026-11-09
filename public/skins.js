// Skin renders are independent of the world API and never delay its data.
// The public account UUID is the identity; names are display labels only.
(() => {
  const initialized = new WeakSet();
  const preferred = new Map();
  const localRenders = new Map();
  const checkedRenders = new Map();
  let config = { onlineEnabled:false, version:0 };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function sources(uuid, kind) {
    const id = String(uuid || '').replace(/-/g, '').toLowerCase();
    if (!config.onlineEnabled || !/^[0-9a-f]{32}$/.test(id)) return [];
    return kind === 'body'
      ? [`https://mc-heads.net/player/${id}/256`, `https://crafatar.com/renders/body/${id}?scale=6&overlay`]
      : [`https://mc-heads.net/avatar/${id}/64`, `https://crafatar.com/avatars/${id}?size=64&overlay`];
  }

  function configure(options) {
    config = { onlineEnabled:options?.onlineEnabled === true, version:options?.version || Date.now() };
    localRenders.clear();
    checkedRenders.clear();
  }

  // Return the raw, validated texture for the 3D viewer. No body-render PNGs
  // or default skins from failed remote requests are used as player textures.
  async function texture(uuid) {
    const id=String(uuid || '').replace(/-/g,'').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    const urls=[`/api/skins/${id}?v=${encodeURIComponent(config.version)}`];
    if(config.onlineEnabled)urls.push(`https://mc-heads.net/skin/${id}`,`https://crafatar.com/skins/${id}`);
    for(const url of urls) {
      const data=await checkedRender(url);
      if (!data)continue;
      const valid=await new Promise(resolve=>{const img=new Image();img.onload=()=>{
        const scale=img.naturalWidth/64;
        resolve(Number.isInteger(scale) && scale>=1 && (img.naturalHeight===img.naturalWidth || img.naturalHeight===img.naturalWidth/2));
      };img.onerror=()=>resolve(false);img.src=data;});
      if(valid)return {url:data,source:url.startsWith('/')?'local':'online'};
    }
    return null;
  }

  async function companionTexture(player,companion) {
    if(!player?.uuid || !companion?.id)return null;
    const url=`/api/players/${encodeURIComponent(player.uuid)}/companions/${encodeURIComponent(companion.id)}/skin?v=${encodeURIComponent(config.version)}`;
    const data=await checkedRender(url);
    if(data) {
      const valid=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>=64 && img.naturalWidth<=1024 && img.naturalWidth%64===0 && (img.naturalHeight===img.naturalWidth || img.naturalHeight===img.naturalWidth/2));img.onerror=()=>resolve(false);img.src=data;});
      if(valid)return {url:data,source:'companion-profile'};
    }
    return companion.skinProfile?.uuid?texture(companion.skinProfile.uuid):null;
  }

  function renderTexture(texture, kind) {
    const scale = texture.naturalWidth / 64;
    const legacy = texture.naturalHeight === texture.naturalWidth / 2;
    if (!Number.isInteger(scale) || scale < 1 || (!legacy && texture.naturalHeight !== texture.naturalWidth)) throw new Error('Invalid skin texture');
    const canvas = document.createElement('canvas');
    const factor = 8;
    canvas.width = (kind === 'face' ? 8 : 16) * factor;
    canvas.height = (kind === 'face' ? 8 : 32) * factor;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const draw = (sx,sy,w,h,dx,dy,flip = false) => {
      ctx.save();
      if (flip) { ctx.translate((dx + w) * factor,dy * factor);ctx.scale(-1,1);dx=dy=0; }
      ctx.drawImage(texture,sx*scale,sy*scale,w*scale,h*scale,dx*factor,dy*factor,w*factor,h*factor);
      ctx.restore();
    };
    if (kind === 'face') {
      draw(8,8,8,8,0,0);draw(40,8,8,8,0,0);
      return canvas.toDataURL('image/png');
    }
    let arm = 4;
    if (!legacy) {
      const probe = document.createElement('canvas');probe.width=probe.height=64;
      const context = probe.getContext('2d');context.drawImage(texture,0,0,64,64);
      const empty = (x,y) => context.getImageData(x,y,2,12).data.every((v,i) => i%4 !== 3 || v === 0);
      if (empty(54,20) && empty(46,52)) arm=3;
    }
    draw(8,8,8,8,4,0);
    draw(20,20,8,12,4,8);
    draw(44,20,arm,12,4-arm,8);
    draw(legacy?44:36,legacy?20:52,arm,12,12,8,legacy);
    draw(4,20,4,12,4,20);
    draw(legacy?4:20,legacy?20:52,4,12,8,20,legacy);
    draw(40,8,8,8,4,0);
    if (!legacy) {
      draw(20,36,8,12,4,8);
      draw(44,36,arm,12,4-arm,8);
      draw(52,52,arm,12,12,8);
      draw(4,36,4,12,4,20);
      draw(4,52,4,12,8,20);
    }
    return canvas.toDataURL('image/png');
  }

  function localRender(uuid, kind) {
    const id=String(uuid || '').replace(/-/g,'').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id)) return Promise.resolve(null);
    const key=`${id}:${kind}`;
    if (!localRenders.has(key)) localRenders.set(key,new Promise(resolve => {
      const texture=new Image();
      texture.onload=()=>{try{resolve(renderTexture(texture,kind));}catch{resolve(null);}};
      texture.onerror=()=>resolve(null);
      texture.src=`/api/skins/${id}?v=${encodeURIComponent(config.version)}`;
    }));
    return localRenders.get(key);
  }

  function markup(player, kind = 'face') {
    const name = player?.name || `Player ${String(player?.uuid || '').slice(0,8)}`;
    const description = `${kind === 'body' ? 'Skin' : 'Rosto'} de ${name}`;
    return `<span class="player-skin player-skin--${kind}" data-skin-state="loading">
      <img data-player-skin="${escape(player?.uuid)}" data-skin-kind="${kind}" alt="${escape(description)}" width="${kind === 'body' ? 128 : 64}" height="${kind === 'body' ? 256 : 64}" loading="${kind === 'body' ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">
      ${kind === 'body' ? '<small class="skin-unavailable">Skin indisponível</small>' : ''}
    </span>`;
  }

  function checkedRender(url) {
    if (!checkedRenders.has(url)) checkedRenders.set(url,(async () => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(),30000);
      try {
        // Crafatar may return a default skin PNG with HTTP 500. Check the
        // status before displaying it as the player's own skin.
        const response = await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
        if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) return null;
        const blob = await response.blob();
        if (blob.size > 2 * 1024 * 1024) return null;
        return await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch { return null; }
      finally { clearTimeout(deadline); }
    })());
    return checkedRenders.get(url);
  }

  function mount(root = document) {
    root.querySelectorAll('img[data-player-skin]').forEach(img => {
      if (initialized.has(img)) return;
      initialized.add(img);
      const wrapper = img.parentElement;
      const key = `${img.dataset.playerSkin}:${img.dataset.skinKind}`;
      const urls = sources(img.dataset.playerSkin, img.dataset.skinKind);
      const chosen = preferred.get(key);
      if (chosen && urls.includes(chosen)) {
        urls.splice(urls.indexOf(chosen),1);urls.unshift(chosen);
      }
      let index = 0, timer;
      const description = img.alt;

      function unavailable() {
        clearTimeout(timer);
        wrapper.dataset.skinState = 'unavailable';
        img.alt = `${description} — indisponível`;
        img.removeEventListener('error',next);
        img.removeAttribute('src');
      }
      async function attempt() {
        clearTimeout(timer);
        if (!img.isConnected) return;
        if (index >= urls.length) return unavailable();
        const url = urls[index];
        img.dataset.skinProvider = url;
        if (url.startsWith('https://crafatar.com/')) {
          img.removeAttribute('src');
          const activeIndex = index;
          const render = await checkedRender(url);
          if (!img.isConnected || index !== activeIndex) return;
          if (!render) return next();
          img.src = render;
          return;
        }
        img.src = url;
        // Body images are eager. Lazy faces keep their placeholder until visible.
        // A provider may need time to render an uncached skin.
        if (img.dataset.skinKind === 'body') timer = setTimeout(next,30000);
      }
      function next() {
        index++;
        attempt();
      }
      img.addEventListener('error', next);
      img.addEventListener('load', () => {
        clearTimeout(timer);
        if (!img.naturalWidth || !img.naturalHeight) return next();
        wrapper.dataset.skinState = 'ready';
        if (img.dataset.skinSource === 'online') preferred.set(key,img.dataset.skinProvider);
      });
      localRender(img.dataset.playerSkin,img.dataset.skinKind).then(local => {
        if (!img.isConnected) return;
        if (local) { img.dataset.skinSource='local';img.src=local; }
        else { img.dataset.skinSource=config.onlineEnabled?'online':'unavailable';attempt(); }
      });
    });
  }
  window.VHSkins = { markup, mount, configure, texture, companionTexture };
})();
