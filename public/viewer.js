(() => {
  let current = null;
  const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const rad = value=>Number(value || 0)*Math.PI/180;

  function markup(player,companion) {
    return `<div class="character-stage" data-viewer-state="loading">
      <div class="character-ground" aria-hidden="true"></div>
      <canvas class="character-canvas" tabindex="0" role="img" aria-label="Modelo 3D de ${escape(player.name || 'jogador')}${companion ? ' com '+escape(companion.name) : ''}. Arraste ou use as setas para girar." hidden></canvas>
      <div class="character-fallback">${VHSkins.markup(player,'body')}</div>
      <span class="character-status" role="status">Carregando modelo 3D…</span>
      <button type="button" class="character-reset" aria-label="Restaurar a vista do modelo 3D" hidden>↺</button>
    </div>`;
  }

  function cubeGeometry(cube,bone,description) {
    const T=VH3DLibrary.THREE;
    const [w,h,d]=cube.size;
    const inflate=cube.inflate || 0;
    const geometry=new T.BoxGeometry(Math.max(0.001,w+2*inflate),Math.max(0.001,h+2*inflate),Math.max(0.001,d+2*inflate));
    const uv=geometry.getAttribute('uv');
    const tw=description.texture_width,th=description.texture_height;
    const mirror=cube.mirror ?? bone.mirror ?? false;
    let faces;
    if(Array.isArray(cube.uv)) {
      const [u,v]=cube.uv;
      faces=[ [u+d+w,v+d,d,h], [u,v+d,d,h], [u+d,v,w,d], [u+d+w,v,w,d], [u+2*d+w,v+d,w,h], [u+d,v+d,w,h] ];
    } else {
      faces=['east','west','up','down','south','north'].map(face=>{
        const side=cube.uv?.[face];return side ? [...side.uv,...(side.uv_size || [w,h])] : [0,0,0,0];
      });
    }
    faces.forEach(([x,y,width,height],face)=>{
      const points=[[0,0],[1,0],[0,1],[1,1]];
      points.forEach(([a,b],i)=>uv.setXY(face*4+i,(x+(mirror?1-a:a)*width)/tw,1-(y+b*height)/th));
    });
    uv.needsUpdate=true;
    return geometry;
  }

  // Native Gecko/Bedrock geometry: named bones, parents, absolute pivots,
  // bind rotations, cube pivots, atlas UVs, inflate and mirrored cubes.
  function nativeModel(data,texture) {
    const T=VH3DLibrary.THREE;
    const geometry=data['minecraft:geometry']?.[0];
    if(!geometry?.bones || !geometry.description?.texture_width)throw new Error('Modelo não suportado');
    const root=new T.Group(), bones=new Map();
    const material=new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:0.05,side:T.DoubleSide});
    for(const bone of geometry.bones) {
      const group=new T.Group();group.name=bone.name;
      bones.set(bone.name,{group,bone});
    }
    for(const {group,bone} of bones.values()) {
      const parent=bones.get(bone.parent);
      const pivot=bone.pivot || [0,0,0],pp=parent?.bone.pivot || [0,0,0];
      group.position.set(pivot[0]-pp[0],pivot[1]-pp[1],pivot[2]-pp[2]);
      group.rotation.set(...(bone.rotation || [0,0,0]).map(rad),'ZYX');
      (parent?.group || root).add(group);
      for(const cube of bone.cubes || []) {
        const mesh=new T.Mesh(cubeGeometry(cube,bone,geometry.description),material);
        const [x,y,z]=cube.origin,[w,h,d]=cube.size;
        if(cube.rotation) {
          const cp=cube.pivot || pivot,holder=new T.Group();
          holder.position.set(cp[0]-pivot[0],cp[1]-pivot[1],cp[2]-pivot[2]);
          holder.rotation.set(...cube.rotation.map(rad),'ZYX');
          mesh.position.set(x+w/2-cp[0],y+h/2-cp[1],z+d/2-cp[2]);holder.add(mesh);group.add(holder);
        } else {
          mesh.position.set(x+w/2-pivot[0],y+h/2-pivot[1],z+d/2-pivot[2]);group.add(mesh);
        }
      }
    }
    root.rotation.y=Math.PI;
    return root;
  }

  function disposeModel(model) {
    const textures=new Set(),materials=new Set();
    model?.traverse(obj=>{obj.geometry?.dispose();if(obj.material)materials.add(obj.material);});
    materials.forEach(m=>{if(m.map)textures.add(m.map);m.dispose();});textures.forEach(t=>t.dispose());
  }

  async function legendModel(player,companion) {
    const T=VH3DLibrary.THREE,model=new VH3DLibrary.PlayerObject();
    model.cape.visible=false;model.ears.visible=false;model.skin.visible=true;
    const skin=await VHSkins.companionTexture(player,companion);
    if(skin) {
      const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=skin.url;});
      const canvas=document.createElement('canvas');VH3DLibrary.loadSkinToCanvas(canvas,image);
      const texture=new T.CanvasTexture(canvas);texture.magFilter=T.NearestFilter;texture.minFilter=T.NearestFilter;texture.colorSpace=T.SRGBColorSpace;
      model.skin.map=texture;model.skin.modelType=companion.skinProfile?.model || VH3DLibrary.inferModelType(canvas);
    } else {
      model.skin.setOuterLayerVisible(false);
      model.skin.traverse(part=>{if(part.material){part.material.map=null;part.material.color.set('#8d8273');part.material.needsUpdate=true;}});
    }
    if(companion.model.baby)model.skin.head.scale.setScalar(2);
    model.scale.setScalar(companion.model.scale*(companion.model.baby?0.5:1));
    model.userData.skinAvailable=Boolean(skin);
    return model;
  }
  function dispose() {
    if(!current)return;
    current.controller.abort();current.observer?.disconnect();
    disposeModel(current.pet);current.viewer?.dispose();current=null;
  }

  async function mount(container,player,companion) {
    dispose();
    const stage=container.querySelector('.character-stage');if(!stage)return;
    const state={controller:new AbortController(),stage,viewer:null,pet:null,observer:null};current=state;
    const active=()=>current===state && stage.isConnected;
    const canvas=stage.querySelector('canvas'),status=stage.querySelector('.character-status');
    const fallback=message=>{if(!active())return;stage.dataset.viewerState='unavailable';status.textContent=message;canvas.hidden=true;stage.querySelector('.character-fallback').hidden=false;};
    let viewer;
    try {
      viewer=state.viewer=new VH3DLibrary.SkinViewer({canvas,width:stage.clientWidth || 260,height:340,pixelRatio:Math.min(devicePixelRatio || 1,2),renderPaused:true});
      viewer.controls.enableZoom=false;viewer.controls.enablePan=false;
      viewer.controls.minPolarAngle=Math.PI*0.18;viewer.controls.maxPolarAngle=Math.PI*0.8;
      const texture=await VHSkins.texture(player.uuid);
      if(!active())return;
      if(texture)await viewer.loadSkin(texture.url);
      else {
        // Neutral geometry is explicitly labeled; never attribute a default
        // Steve/Alex texture to a player whose real texture could not be read.
        const skin=viewer.playerObject.skin;skin.visible=true;
        for(const part of ['head','body','rightArm','leftArm','rightLeg','leftLeg'])skin[part].outerLayer.visible=false;
        skin.traverse(object=>{if(object.material){object.material.map=null;object.material.color.set('#8d8273');object.material.needsUpdate=true;}});
      }
      if(!active())return;
      const T=VH3DLibrary.THREE;
      if(companion?.model) {
        try {
          if(companion.model.kind==='legend')state.pet=await legendModel(player,companion);
          else {
            const response=await fetch(companion.model.model,{signal:state.controller.signal});
            if(!response.ok)throw new Error('Model not found');
            const data=await response.json();
            const texture=await new T.TextureLoader().loadAsync(companion.model.texture);
            if(!active()){texture.dispose();return;}
            texture.magFilter=T.NearestFilter;texture.minFilter=T.NearestFilter;texture.colorSpace=T.SRGBColorSpace;
            state.pet=nativeModel(data,texture);
          }
          if(!active()){disposeModel(state.pet);return;}
          const bounds=new T.Box3().setFromObject(state.pet),size=bounds.getSize(new T.Vector3());
          // Fit the native shape alongside the player, preserving proportions.
          const scale=companion.model.kind==='legend'?1:Math.min(1,20/Math.max(size.x,size.y,size.z,1));
          state.pet.scale.multiplyScalar(scale);state.pet.position.set(14-(bounds.min.x+bounds.max.x)*scale/2,-16-bounds.min.y*scale,0);
          viewer.playerObject.position.x=-10;viewer.scene.add(state.pet);
          stage.dataset.companionModel=companion.type;
          stage.dataset.companionKind=companion.model.kind || 'pet';
          if(companion.model.kind==='legend')stage.dataset.companionSkin=state.pet.userData.skinAvailable?'ready':'unavailable';
        } catch(error) {if(error.name==='AbortError')return;stage.dataset.companionModel='unavailable';}
      } else if(companion)stage.dataset.companionModel='unavailable';
      const reset=()=>{
        const giant=companion?.model?.kind==='legend' && companion.model.scale>1;
        viewer.controls.target.set(companion?.model?2:0,giant?8:0,0);
        const distance=giant?90:companion?.model ? 67 : 53;
        viewer.camera.position.set(10,giant?11:3,distance);viewer.controls.update();viewer.render();
      };
      reset();
      viewer.controls.addEventListener('change',()=>{if(active())viewer.render();});
      state.observer=new ResizeObserver(()=>{if(active()){viewer.setSize(stage.clientWidth || 260,stage.clientHeight || 340);viewer.render();}});
      state.observer.observe(stage);
      stage.dataset.viewerState='ready';stage.dataset.skinSource=texture?.source || 'unavailable';
      canvas.hidden=false;stage.querySelector('.character-fallback').hidden=true;
      stage.querySelector('.character-reset').hidden=false;
      stage.querySelector('.character-reset').addEventListener('click',reset,{signal:state.controller.signal});
      status.textContent=!texture ? 'Skin do jogador indisponível · modelo sem textura' : stage.dataset.companionModel==='unavailable' ? 'Modelo deste companion indisponível' : stage.dataset.companionSkin==='unavailable'?'Skin do companion indisponível · modelo sem textura':'Arraste para girar · use as setas';
      canvas.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;
        event.preventDefault();if(event.key==='Home'){reset();return;}
        const delta=new T.Vector3().subVectors(viewer.camera.position,viewer.controls.target);
        const spherical=new T.Spherical().setFromVector3(delta);
        spherical.theta+=(event.key==='ArrowLeft'?0.15:event.key==='ArrowRight'?-0.15:0);
        spherical.phi=Math.max(viewer.controls.minPolarAngle,Math.min(viewer.controls.maxPolarAngle,spherical.phi+(event.key==='ArrowUp'?-0.1:event.key==='ArrowDown'?0.1:0)));
        viewer.camera.position.copy(new T.Vector3().setFromSpherical(spherical).add(viewer.controls.target));viewer.controls.update();viewer.render();
      },{signal:state.controller.signal});
      canvas.addEventListener('webglcontextlost',()=>fallback('Visualização 3D indisponível neste navegador'),{signal:state.controller.signal});
    } catch {
      state.viewer?.dispose();state.viewer=null;fallback('Visualização 3D indisponível neste navegador');
    }
  }
  window.VHViewer={markup,mount,dispose,nativeModel};
})();
