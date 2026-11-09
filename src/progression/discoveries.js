const { own, object, uuid, entry, numeric, label, field, unique } = require('./native');
const { catalog } = require('./p2Catalog');
const { DEFINITIONS } = require('../gear/trinkets');
const FILES = {
  models:'data/the_vault_DiscoveredModels.dat', trinkets:'data/the_vault_DiscoveredTrinkets.dat',
  artifacts:'data/the_vault_DiscoveredArtifacts.dat', themes:'data/the_vault_DiscoveredThemes.dat',
  titles:'data/the_vault_DiscoveredTitles.dat', emblems:'data/the_vault_DiscoveredEmblems.dat',
  trails:'data/the_vault_DiscoveredTrails.dat', goals:'data/the_vault_DiscoveryGoalStates.dat'
};
function listEntry(data, key, player) { return Array.isArray(data?.[key]) ? data[key].find(row => uuid(row?.player) === uuid(player)) : null; }
function epochDate(day) {
  if (!Number.isInteger(day) || Math.abs(day) > 1000000) return null;
  const date = new Date(day * 86400000); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : null;
}
function extractDiscoveries(sources, player) {
  const categories = {}, issues = [];
  const make = (key, path, items) => {
    categories[key] = { available:items != null, count:items?.length ?? null, items:items || [], source:FILES[key], path,
      fieldSource:field(items?.length ?? null,FILES[key],path) };
  };
  const model = entry(sources.models,player)?.value;
  const modelItems = object(model) && Array.isArray(model.g) ? new Map() : null;
  if (modelItems) model.g.forEach((group,index) => {
    if (!Array.isArray(group?.ids)) { issues.push({ source:FILES.models, path:`[UUID].g[${index}].ids`, message:'Model IDs absent' }); return; }
    group.ids.forEach(id => {
      if (typeof id !== 'string') return;
      const day = Number.isInteger(group.d) ? group.d : null, old = modelItems.get(id);
      if (!old || old.discoveredDay == null || day != null && day < old.discoveredDay) modelItems.set(id,
        { id, name:label(id.split('/').slice(2).join('/')), model:id, discoveredDay:day, discoveredDate:epochDate(day), category:id.split('/')[1] || null });
    });
  });
  make('models','[UUID].g',modelItems ? [...modelItems.values()].sort((a,b)=>(b.discoveredDay??-Infinity)-(a.discoveredDay??-Infinity)||a.id.localeCompare(b.id)) : null);
  const trinkets = listEntry(sources.trinkets,'trinkets',player);
  make('trinkets','trinkets[player=UUID].trinkets',Array.isArray(trinkets?.trinkets) ? unique(trinkets.trinkets.filter(id=>typeof id==='string')).map(id => {
    const native = id.startsWith('the_vault:') ? DEFINITIONS[id.slice(10)] : null;
    return { id, name:native?.[0] || label(id), description:native?.[1] || null, model:`the_vault:trinket/${id.split(':').at(-1)}` };
  }) : null);
  const artifacts = listEntry(sources.artifacts,'artifacts',player);
  make('artifacts','artifacts[player=UUID].artifacts',Array.isArray(artifacts?.artifacts) ? unique(artifacts.artifacts.filter(Number.isInteger)).map(id=>({id,name:`Artefato #${id}`,model:`the_vault:artifact/vault_artifact_${id}`})) : null);
  const themes = entry(sources.themes,player)?.value;
  make('themes','[UUID]',Array.isArray(themes) ? unique(themes.filter(id=>typeof id==='string')).map(id=>({id,name:id})) : null);
  const titles = sources.titles, prefixes = entry(titles?.Prefixes,player), suffixes = entry(titles?.Suffixes,player);
  const titleItems = prefixes || suffixes ? [] : null;
  for (const [kind,hit,selected] of [['prefix',prefixes,entry(titles?.SelectedPrefixes,player)?.value],['suffix',suffixes,entry(titles?.SelectedSuffixes,player)?.value]]) {
    if (Array.isArray(hit?.value)) unique(hit.value.filter(id=>typeof id==='string')).forEach(id=>titleItems.push({id:`${kind}:${id}`,name:label(id),kind,selected:selected===id}));
    else if (hit) issues.push({source:FILES.titles,path:kind,message:'Title list malformed'});
  }
  make('titles','Prefixes[UUID] / Suffixes[UUID]',titleItems);
  const emblems = entry(sources.emblems?.Emblems,player)?.value;
  make('emblems','Emblems[UUID].Discovered',Array.isArray(emblems?.Discovered) ? unique(emblems.Discovered.filter(Number.isInteger)).map(id=>({id,name:catalog.emblems[id]?.name || `Emblema #${id}`,symbol:catalog.emblems[id]?.symbol || null,selected:emblems.Selected===id && (emblems.Enabled===1||emblems.Enabled===true)})) : null);
  const trails = entry(sources.trails?.Trails,player)?.value, selectedTrail = entry(sources.trails?.Selected,player)?.value;
  make('trails','Trails[UUID].Types',Array.isArray(trails?.Types) ? unique(trails.Types.filter(Number.isInteger)).map(id=>({id,name:catalog.trails[id]?.name||`Trail #${id}`,selected:selectedTrail?.TrailType===id&&(selectedTrail.Enabled===1||selectedTrail.Enabled===true)})) : null);
  const players = sources.goals?.PlayersList, states = sources.goals?.StatesList;
  const index = Array.isArray(players) ? players.findIndex(id=>uuid(id)===uuid(player)) : -1;
  const state = index>=0 && Array.isArray(states) ? states[index] : null;
  const goalItems = object(state) && Array.isArray(state.CompletedGoals) ? unique(state.CompletedGoals.filter(id=>typeof id==='string')).map(id=>({id,name:label(id),status:'completed',progress:null})) : null;
  if (goalItems && Array.isArray(state.OngoingGoalKeys) && Array.isArray(state.OngoingGoalValues)) {
    if (state.OngoingGoalKeys.length !== state.OngoingGoalValues.length) issues.push({source:FILES.goals,path:'StatesList[UUID].OngoingGoalValues',message:'Ongoing goals keys/values length mismatch'});
    state.OngoingGoalKeys.forEach((id,i)=> {if(typeof id==='string' && !goalItems.some(item=>item.id===id))goalItems.push({id,name:label(id),status:'inProgress',progress:numeric(state.OngoingGoalValues[i])});});
  }
  make('goals','StatesList[PlayersList=UUID]',goalItems);
  return {available:Object.values(categories).some(c=>c.available), categories, issues};
}
module.exports = { FILES, extractDiscoveries };
