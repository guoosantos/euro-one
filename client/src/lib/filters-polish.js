export function polishFiltersNow(root=document){
  // Aplica estilo base
  root.querySelectorAll('.filters input:not(.linput)').forEach(el=>{
    el.classList.add('linput');
  });
  root.querySelectorAll('.filters select:not(.lselect)').forEach(el=>{
    el.classList.add('lselect');
  });

  // Detecta "campos de busca" por tipo/placeholder/name e aplica pílula com ícone
  root.querySelectorAll('.filters input').forEach(el=>{
    const ph = (el.getAttribute('placeholder')||'').toLowerCase();
    const nm = (el.getAttribute('name')||'').toLowerCase();
    if (el.type === 'search' || /buscar|search|busca/.test(ph) || /q|search|busca/.test(nm)) {
      el.classList.add('linput--search');
    }
  });
}
export function installFiltersPolish(){
  const run = ()=>polishFiltersNow(document);
  run();
  window.addEventListener('popstate', run);
  const mo = new MutationObserver(()=>run());
  mo.observe(document.getElementById('root')||document.body,{subtree:true,childList:true});
}
