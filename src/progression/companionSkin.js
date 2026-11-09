const {uuid}=require('./native');
function companionSkin(profile,fallbackName) {
  const result={uuid:uuid(profile?.Id),name:typeof profile?.Name==='string'?profile.Name:fallbackName || null,
    textureUrl:null,model:null};
  for(const row of Array.isArray(profile?.Properties?.textures)?profile.Properties.textures:[]) {
    if(typeof row.Value!=='string' || row.Value.length>16384)continue;
    try {
      const data=JSON.parse(Buffer.from(row.Value,'base64').toString('utf8'));
      const profileId=uuid(data.profileId);
      if(result.uuid && profileId && result.uuid!==profileId)continue;
      const skin=data.textures?.SKIN;
      if(typeof skin?.url!=='string' || !/^https?:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]{32,64}$/i.test(skin.url))continue;
      result.uuid=result.uuid || profileId;
      result.textureUrl=skin.url.replace(/^http:/i,'https:');
      result.model=skin.metadata?.model==='slim'?'slim':'default';
      break;
    } catch {}
  }
  return result;
}
module.exports={companionSkin};
