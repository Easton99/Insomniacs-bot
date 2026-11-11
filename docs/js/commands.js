/* Insomniacs Bot — commands reference (list + per-command detail pages)
 * Data lives in commands-data.js. Routing is hash based:
 *   commands.html            → filterable list
 *   commands.html#/birthday  → detail page for /ic birthday
 */
(function () {
  const COMMANDS   = window.IC_COMMANDS || [];
  const CATEGORIES = window.IC_CATEGORIES || [];
  const REQUIRES   = window.IC_REQUIRES || {};

  const catLabel = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
  const catOrder = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));
  const byName   = Object.fromEntries(COMMANDS.map((c) => [c.name, c]));

  // Old anchors (homepage cards, external links) → category filter
  const LEGACY_HASH = {
    account: 'account', stats: 'stats', recent: 'stats', leaderboard: 'group',
    records: 'group', chemistry: 'group', maps: 'maps', achievements: 'achievements',
    general: 'utilities',
  };

  const state = { q: '', cat: 'all', req: 'all', popular: false, sort: 'az' };

  const listView   = document.getElementById('cmd-list-view');
  const detailView = document.getElementById('cmd-detail-view');
  const listEl     = document.getElementById('cmd-list');
  const countEl    = document.getElementById('cmd-count');
  const searchEl   = document.getElementById('cmd-search');
  const sortEl     = document.getElementById('cmd-sort');
  const catFacet   = document.getElementById('facet-category');
  const reqFacet   = document.getElementById('facet-requires');
  const popularEl  = document.getElementById('facet-popular');
  const resetEl    = document.getElementById('cmd-reset');
  const baseTitle  = document.title;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  const STAR = '<span class="cmd-star" title="Popular">★</span>';

  // ── Facets ─────────────────────────────────────────────
  function facetButton(group, value, label, count) {
    return `<button type="button" class="facet-item" data-group="${group}" data-value="${esc(value)}">
      <span>${esc(label)}</span><span class="facet-count">${count}</span></button>`;
  }

  function renderFacets() {
    const catCounts = {};
    const reqCounts = {};
    COMMANDS.forEach((c) => {
      catCounts[c.category] = (catCounts[c.category] || 0) + 1;
      reqCounts[c.requires] = (reqCounts[c.requires] || 0) + 1;
    });

    catFacet.innerHTML = facetButton('cat', 'all', 'All commands', COMMANDS.length) +
      CATEGORIES.map((c) => facetButton('cat', c.id, c.label, catCounts[c.id] || 0)).join('');

    reqFacet.innerHTML = facetButton('req', 'all', 'Any', COMMANDS.length) +
      Object.keys(REQUIRES).filter((k) => reqCounts[k])
        .map((k) => facetButton('req', k, REQUIRES[k], reqCounts[k])).join('');

    document.querySelectorAll('.facet-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        state[btn.dataset.group] = btn.dataset.value;
        renderList();
      });
    });
  }

  function syncFacetState() {
    document.querySelectorAll('.facet-item').forEach((btn) => {
      const on = state[btn.dataset.group] === btn.dataset.value;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    popularEl.classList.toggle('active', state.popular);
    popularEl.setAttribute('aria-pressed', String(state.popular));
    searchEl.value = state.q;
    sortEl.value = state.sort;
  }

  // ── List ───────────────────────────────────────────────
  function matches(c) {
    if (state.cat !== 'all' && c.category !== state.cat) return false;
    if (state.req !== 'all' && c.requires !== state.req) return false;
    if (state.popular && !c.popular) return false;
    if (!state.q) return true;
    const hay = [c.name, '/ic ' + c.name, c.synopsis, c.description, catLabel[c.category],
      ...c.params.map((p) => p.name)].join(' ').toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
  }

  function sorted(list) {
    const az = (a, b) => a.name.localeCompare(b.name);
    if (state.sort === 'popular') return list.sort((a, b) => (b.popular ? 1 : 0) - (a.popular ? 1 : 0) || az(a, b));
    if (state.sort === 'category') return list.sort((a, b) => catOrder[a.category] - catOrder[b.category] || az(a, b));
    return list.sort(az);
  }

  function card(c) {
    return `<a class="cmd-item" href="#/${esc(c.name)}" title="View /ic ${esc(c.name)} documentation">
      <h3 class="cmd-item-name">/ic ${esc(c.name)}${c.popular ? STAR : ''}</h3>
      <p class="cmd-item-desc">${esc(c.synopsis)}</p>
      <div class="cmd-item-meta">
        <span>${esc(catLabel[c.category])}</span>
        ${c.requires !== 'anyone' ? `<span class="cmd-tag cmd-tag-${c.requires}">${esc(REQUIRES[c.requires])}</span>` : ''}
      </div>
    </a>`;
  }

  function renderList() {
    syncFacetState();
    const results = sorted(COMMANDS.filter(matches));
    countEl.textContent = `${results.length} command${results.length === 1 ? '' : 's'}`;

    if (results.length === 0) {
      listEl.innerHTML = '<p class="cmd-empty">No commands match those filters.</p>';
      return;
    }

    if (state.sort === 'category') {
      const groups = CATEGORIES.map((cat) => ({ cat, items: results.filter((c) => c.category === cat.id) }))
        .filter((g) => g.items.length);
      listEl.innerHTML = groups.map((g) =>
        `<h2 class="cmd-group-title">${esc(g.cat.label)}</h2>${g.items.map(card).join('')}`).join('');
    } else {
      listEl.innerHTML = results.map(card).join('');
    }
  }

  // ── Detail ─────────────────────────────────────────────
  function syntax(c) {
    const parts = c.params.map((p) => {
      let hint = p.type;
      if (p.type === 'Choice' && p.values && p.values.length > 1) hint = p.values.join('|');
      const token = `${p.name}:<${hint}>`;
      return p.required ? token : `[${token}]`;
    });
    return ['/ic ' + c.name, ...parts].join(' ');
  }

  function paramBlock(p) {
    const rows = [
      ['Type', p.type],
      ['Required', p.required ? 'Yes' : 'No'],
      ['Default', p.default || '—'],
    ];
    if (p.values) rows.push(['Accepted values', p.values.join(', ')]);
    return `<div class="param">
      <h4 class="param-name" id="param-${esc(p.name)}">${esc(p.name)}</h4>
      <p>${esc(p.desc)}</p>
      <table class="kv-table"><tbody>
        ${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${esc(v)}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
  }

  function section(id, title, body) {
    return `<section class="doc-section" id="${id}">
      <h2><a class="doc-anchor" href="#/${currentName}/${id}">${title}</a></h2>${body}</section>`;
  }

  let currentName = '';

  function renderDetail(name, anchor) {
    const c = byName[name];
    if (!c) { location.hash = ''; return; }
    currentName = c.name;

    const required = c.params.filter((p) => p.required);
    const optional = c.params.filter((p) => !p.required);
    const ordered  = sorted(COMMANDS.slice()).filter(Boolean);
    const idx  = ordered.indexOf(c);
    const prev = ordered[idx - 1];
    const next = ordered[idx + 1];

    const toc = [['synopsis', 'Synopsis'], ['description', 'Description'], ['syntax', 'Syntax'],
      ['examples', 'Examples'], ...(c.params.length ? [['parameters', 'Parameters']] : []), ['output', 'Output']];

    let params = '';
    if (c.params.length) {
      params = (required.length ? `<h3 class="param-group">Required parameters</h3>${required.map(paramBlock).join('')}` : '') +
        (optional.length ? `<h3 class="param-group">Optional parameters</h3>${optional.map(paramBlock).join('')}` : '');
    }

    detailView.innerHTML = `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#">Commands</a><span aria-hidden="true">/</span>
        <a href="#" data-cat="${c.category}">${esc(catLabel[c.category])}</a><span aria-hidden="true">/</span>
        <span>/ic ${esc(c.name)}</span>
      </nav>

      <h1 class="doc-title">/ic ${esc(c.name)}${c.popular ? STAR : ''}</h1>
      <div class="doc-meta">
        <span class="cmd-tag">${esc(catLabel[c.category])}</span>
        <span class="cmd-tag cmd-tag-${c.requires}">${esc(REQUIRES[c.requires])}</span>
        <span class="cmd-tag">Reply: ${c.visibility === 'only-you' ? 'only you' : 'everyone'}</span>
      </div>

      <nav class="doc-toc" aria-label="On this page">
        ${toc.map(([id, label]) => `<a href="#/${c.name}/${id}">${label}</a>`).join('<span aria-hidden="true">·</span>')}
      </nav>

      ${section('synopsis', 'Synopsis', `<p class="doc-lead">${esc(c.synopsis)}</p>`)}
      ${section('description', 'Description', `<p>${esc(c.description)}</p>`)}
      ${section('syntax', 'Syntax', `<pre><code>${esc(syntax(c))}</code></pre>
        <p class="doc-hint">Options in [brackets] are optional. In Discord, type <code>/ic ${esc(c.name)}</code> and pick options from the menu.</p>`)}
      ${section('examples', 'Examples', c.examples.map((ex, i) => `
        <div class="example">
          <h3>Example ${i + 1}: ${esc(ex.title)}</h3>
          <pre><code>${esc(ex.cmd)}</code></pre>
          <p>${esc(ex.explain)}</p>
        </div>`).join(''))}
      ${c.params.length ? section('parameters', 'Parameters', params) : ''}
      ${section('output', 'Output', `<p>${esc(c.output)}</p>
        <p class="doc-hint">${c.visibility === 'only-you' ? 'The reply is only visible to you.' : 'The reply is posted in the channel for everyone to see.'}</p>`)}

      ${c.related && c.related.length ? `<div class="doc-related"><h3>Related commands</h3>
        ${c.related.filter((r) => byName[r]).map((r) => `<a class="command-name" href="#/${r}">/ic ${r}</a>`).join(' ')}</div>` : ''}

      <nav class="doc-pager" aria-label="More commands">
        ${prev ? `<a href="#/${prev.name}">← /ic ${esc(prev.name)}</a>` : '<span></span>'}
        <a href="#">All commands</a>
        ${next ? `<a href="#/${next.name}">/ic ${esc(next.name)} →</a>` : '<span></span>'}
      </nav>`;

    detailView.querySelectorAll('pre').forEach(addCopyButton);
    detailView.querySelectorAll('[data-cat]').forEach((a) => a.addEventListener('click', () => {
      Object.assign(state, { q: '', req: 'all', popular: false, cat: a.dataset.cat });
    }));

    document.title = `/ic ${c.name} — Commands — Insomniacs Bot`;

    const target = anchor && document.getElementById(anchor);
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  function addCopyButton(block) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.title = 'Copy';
    btn.setAttribute('aria-label', 'Copy command');
    btn.textContent = '⧉';
    block.style.position = 'relative';
    block.appendChild(btn);
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(block.querySelector('code').textContent);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '⧉'; }, 1500);
      } catch { /* clipboard unavailable */ }
    });
  }

  // ── Routing ────────────────────────────────────────────
  let lastListScroll = 0;

  function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));

    if (hash.startsWith('/')) {
      const [name, anchor] = hash.slice(1).split('/');
      if (!listView.hidden) lastListScroll = window.scrollY;
      listView.hidden = true;
      detailView.hidden = false;
      renderDetail(name, anchor);
      return;
    }

    if (LEGACY_HASH[hash]) state.cat = LEGACY_HASH[hash];

    const fromDetail = !detailView.hidden;
    detailView.hidden = true;
    listView.hidden = false;
    document.title = baseTitle;
    renderList();
    if (fromDetail) window.scrollTo(0, lastListScroll);
  }

  // ── Wire up ────────────────────────────────────────────
  searchEl.addEventListener('input', () => { state.q = searchEl.value.trim(); renderList(); });
  sortEl.addEventListener('change', () => { state.sort = sortEl.value; renderList(); });
  popularEl.addEventListener('click', () => { state.popular = !state.popular; renderList(); });
  resetEl.addEventListener('click', () => {
    Object.assign(state, { q: '', cat: 'all', req: 'all', popular: false, sort: 'az' });
    renderList();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !listView.hidden && document.activeElement !== searchEl) {
      e.preventDefault();
      searchEl.focus();
    }
  });
  window.addEventListener('hashchange', route);

  renderFacets();
  route();
})();
