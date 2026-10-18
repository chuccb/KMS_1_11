/** CConfig+20..40: 43D360 defaults to 1. CUIGameOpt 52D0B0 previews through 43DE80.
 * Only minimap/whisper have browser consumers. Remaining flags stay visible but disabled.
 */
export const GAME_DEFAULTS=Object.freeze({minimap:true,whisper:true,messenger:true,exchange:true,party:true,game:true});
export function gameSettings(value) {
  return Object.fromEntries(Object.keys(GAME_DEFAULTS).map(key=>[key,typeof value?.[key]==='boolean'?value[key]:true]));
}
export function gameProfile(storage) {
  let raw;
  try{raw=JSON.parse(storage?.getItem('kms111.gameSettings')??'null');}catch{}
  // Respect a user's earlier explicit M choice when migrating the browser-only minimap profile.
  if(!raw || typeof raw!=='object') {
    let minimap;try{minimap=JSON.parse(storage?.getItem('kms111.minimap')??'null')?.shown;}catch{}
    raw={minimap};
  }
  let saved=gameSettings(raw);
  return {values:()=>({...saved}),save(value){
    saved=gameSettings(value);try{storage?.setItem('kms111.gameSettings',JSON.stringify(saved));}catch{}
    return {...saved};
  }};
}
