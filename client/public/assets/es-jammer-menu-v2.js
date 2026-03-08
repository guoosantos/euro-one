(function () {
  var SECTION_ID = 'euro-es-jammer-section-v2';
  var LINK_USERS = '/es-jammer-console/users';
  var LINK_PERM = '/es-jammer-console/permissao';

  function q(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function createAnchor(href, label, isSub) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (isSub) {
      a.style.paddingLeft = '22px';
      a.style.opacity = '0.95';
    }
    return a;
  }

  function ensureSection(nav) {
    if (!nav || q('#' + SECTION_ID, nav)) return;

    var wrap = document.createElement('div');
    wrap.id = SECTION_ID;
    wrap.style.marginTop = '8px';

    var title = document.createElement('div');
    title.textContent = 'Seguranca';
    title.className = 'section-title';

    var main = createAnchor(LINK_USERS, 'Verificar ES Jammer', false);
    main.style.fontWeight = '600';

    var users = createAnchor(LINK_USERS, 'Usuarios', true);
    var perm = createAnchor(LINK_PERM, 'Permissao / Contra-senha', true);

    wrap.appendChild(title);
    wrap.appendChild(main);
    wrap.appendChild(users);
    wrap.appendChild(perm);
    nav.appendChild(wrap);
  }

  function tryInject() {
    var nav = q('aside nav') || q('aside .nav') || q('aside [role="navigation"]');
    ensureSection(nav);
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    tryInject();
    if (q('#' + SECTION_ID) || attempts > 120) {
      clearInterval(timer);
    }
  }, 500);

  var obs = new MutationObserver(function () {
    tryInject();
  });

  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
