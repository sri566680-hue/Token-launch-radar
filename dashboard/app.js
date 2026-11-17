// Token Launch Radar — the dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the board, a detail view for every protocol,
// the live-token set and the model page. No network: every byte it shows is in
// data.js. Views are addressable: ?protocol=<slug> opens a detail,
// ?filter=<text> filters the board, ?view=live|model switches tabs, ?sort=<key>
// picks the board's sort. Clicking a row opens its detail; the back link returns.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n == null) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'class') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function params() { return new URLSearchParams(window.location.search); }
  function state() {
    var p = params();
    return {
      view: p.get('view') || 'board',
      q: p.get('filter') || '',
      cat: p.get('category') || 'all',
      sort: p.get('sort') || 'implied',
      dir: p.get('dir') === 'asc' ? 1 : -1,
      protocol: p.get('protocol') || null,
    };
  }
  function go(next) {
    var p = new URLSearchParams();
    if (next.view && next.view !== 'board') p.set('view', next.view);
    if (next.q) p.set('filter', next.q);
    if (next.cat && next.cat !== 'all') p.set('category', next.cat);
    if (next.sort && next.sort !== 'implied') p.set('sort', next.sort);
    if (next.dir === 1) p.set('dir', 'asc');
    if (next.protocol) p.set('protocol', next.protocol);
    var qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    render();
  }
  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function filteredRows(st) {
    var q = st.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (st.cat !== 'all' && (r.category || 'Other') !== st.cat) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list, st) {
    var key = st.sort;
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'growth') d = (a.change_7d == null ? -999 : a.change_7d) - (b.change_7d == null ? -999 : b.change_7d);
      else if (key === 'age') d = (a.age_days == null ? -1 : a.age_days) - (b.age_days == null ? -1 : b.age_days);
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      else d = a.implied_value_usd - b.implied_value_usd;
      if (d === 0) d = a.slug < b.slug ? -1 : 1;
      return d * st.dir;
    });
  }
  function header(st) {
    var wrap = el('div', { class: 'wrap' });
    var head = el('header');
    head.appendChild(el('div', { class: 'eyebrow', text: 'Token Launch Radar · DefiLlama snapshot ' + DATA.as_of }));
    head.appendChild(el('h1', { text: 'Which protocol launches next — and what it would be worth' }));
    head.appendChild(el('p', { class: 'lede', html:
      'Every protocol DefiLlama tracks that <b>records no token</b>, ranked by what its launch would be worth. ' +
      'The value is a model built from the snapshot itself — TVL, seven-day growth, how long it has run with no token — never a promise, and never a guess about whether or when a token comes.' }));
    var facts = el('div', { class: 'facts' });
    [
      ['Watchlist covered', String(DATA.watchlist_size)],
      ['Protocols ranked', String(DATA.board_size)],
      ['Early finds below the floor', String(DATA.early_size)],
      ['Live-token protocols set aside', String(DATA.live_size)],
      ['Watchlist floor', money(DATA.floor_usd)],
    ].forEach(function (f) {
      var d = el('div', { class: 'fact' });
      d.appendChild(el('span', { text: f[0] }));
      d.appendChild(el('b', { text: f[1] }));
      facts.appendChild(d);
    });
    head.appendChild(facts);
    wrap.appendChild(head);
    return wrap;
  }
  function modelStrip() {
    var box = el('section', { class: 'modelstrip' });
    box.appendChild(el('h2', { text: 'How the value is built' }));
    box.appendChild(el('p', { html:
      'Implied value = TVL × <b>sector multiple</b> × <b>momentum</b> × <b>maturity</b> × <b>breadth</b>. ' +
      'The sector multiple is the median live-token market-cap / TVL of the protocol\u2019s own category, read from this snapshot — a category with fewer than 5 live protocols falls back to the global median. ' +
      'Momentum bends with the 7-day TVL change, maturity grows with the days the protocol has run with no token, breadth rewards running on more chains. ' +
      'Code: <code>impliedValue</code> in <code>lib/model.ts</code>, version <code>' + esc(DATA.model_version) + '</code>.' }));
    var chips = el('details', { class: 'sectors' });
    chips.appendChild(el('summary', { text: 'Sector multiples — ' + Object.keys(DATA.sector_multiples).length + ' categories' }));
    Object.keys(DATA.sector_multiples).sort().forEach(function (cat) {
      var s = DATA.sector_multiples[cat];
      chips.appendChild(el('span', { class: 'sector', html: esc(cat) + ' <b>×' + s.multiple.toFixed(2) + '</b>' + (s.fallback ? ' · global' : ' · n=' + s.live_samples) }));
    });
    box.appendChild(chips);
    return box;
  }
  function tabs(st) {
    var bar = el('nav', { class: 'tabs' });
    [['board', 'Board'], ['live', 'Live tokens'], ['model', 'How it works']].forEach(function (t) {
      var b = el('button', { type: 'button', class: 'tab', text: t[1] });
      b.setAttribute('aria-selected', st.view === t[0] || (t[0] === 'board' && st.view !== 'live' && st.view !== 'model') ? 'true' : 'false');
      b.addEventListener('click', function () { go({ view: t[0], q: st.q, cat: st.cat, sort: st.sort, dir: st.dir, protocol: null }); });
      bar.appendChild(b);
    });
    return bar;
  }
  function controls(st, onChange) {
    var box = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Filter by name, slug or category…', value: st.q, 'aria-label': 'Filter protocols' });
    search.addEventListener('input', function () { onChange({ q: search.value }); });
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var sel = el('select', { 'aria-label': 'Category' });
    sel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) {
      var o = el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')' });
      if (st.cat === c) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { onChange({ cat: sel.value }); });
    var sort = el('select', { 'aria-label': 'Sort by' });
    [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['name', 'Sort: name']].forEach(function (s) {
      var o = el('option', { value: s[0], text: s[1] });
      if (st.sort === s[0]) o.selected = true;
      sort.appendChild(o);
    });
    sort.addEventListener('change', function () { onChange({ sort: sort.value }); });
    box.appendChild(search);
    box.appendChild(sel);
    box.appendChild(sort);
    return box;
  }
  function boardTable(list, st) {
    var panel = el('section', { class: 'panel' });
    var head = el('div', { class: 'panelhead' });
    head.appendChild(el('h2', { text: 'The board' }));
    head.appendChild(el('p', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }));
    panel.appendChild(head);
    if (list.length === 0) {
      var empty = el('div', { class: 'empty' });
      empty.appendChild(el('h2', { text: 'No protocol matches that filter' }));
      empty.appendChild(el('p', { text: 'Try a shorter search or another category.' }));
      panel.appendChild(empty);
      return panel;
    }
    var maxV = list[0].implied_value_usd;
    var table = el('table', { class: 'board' });
    table.appendChild(el('caption', { text: list.length + ' protocols shown · implied value is the radar\u2019s own claim, not a promise' }));
    var thead = el('thead');
    var hr = el('tr');
    ['Rank', 'Protocol', 'Category', 'Chains', 'TVL', '7d', 'Age', 'Implied value'].forEach(function (h, i) {
      hr.appendChild(el('th', { text: h, class: i >= 4 ? 'r' : '' }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { class: r.rank <= 3 ? 'top3' : '' });
      tr.addEventListener('click', function () { go({ view: 'board', q: st.q, cat: st.cat, sort: st.sort, dir: st.dir, protocol: r.slug }); });
      tr.appendChild(el('td', { html: '<span class="rankbadge">' + r.rank + '</span>' }));
      var nameCell = el('td');
      var name = el('span', { class: 'pname', text: r.name });
      nameCell.appendChild(name);
      if (r.on_watchlist) nameCell.appendChild(el('span', { class: 'watch', text: 'Watchlist' }));
      nameCell.appendChild(el('span', { class: 'pslug', text: r.slug }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      var chains = el('td');
      r.chains.slice(0, 3).forEach(function (c) { chains.appendChild(el('span', { class: 'chainchip', text: c })); });
      if (r.chains.length > 3) chains.appendChild(el('span', { class: 'chainchip', text: '+' + (r.chains.length - 3) }));
      tr.appendChild(chains);
      tr.appendChild(el('td', { class: 'r num', text: money(r.tvl_usd) }));
      var g = el('td', { class: 'r num ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) });
      tr.appendChild(g);
      tr.appendChild(el('td', { class: 'r num', text: r.age_days == null ? '—' : r.age_days + 'd' }));
      var vc = el('td', { class: 'r' });
      vc.appendChild(el('div', { class: 'num', html: '<b>' + money(r.implied_value_usd) + '</b>' }));
      var bar = el('div', { class: 'valuebar' });
      bar.appendChild(el('i', {}));
      bar.firstChild.style.width = Math.max(2, Math.round((r.implied_value_usd / maxV) * 100)) + '%';
      vc.appendChild(bar);
      tr.appendChild(vc);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(table);
    return panel;
  }
  function liveTable() {
    var panel = el('section', { class: 'panel' });
    var head = el('div', { class: 'panelhead' });
    head.appendChild(el('h2', { text: 'Live tokens — already trading' }));
    head.appendChild(el('p', { text: 'These protocols already have a token that trades. The board never ranks them: it shows the market\u2019s own market cap, not a model\u2019s number.' }));
    panel.appendChild(head);
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var hr = el('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', '7d', 'Market cap'].forEach(function (h, i) {
      hr.appendChild(el('th', { text: h, class: i >= 3 ? 'r' : '' }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      tr.style.cursor = 'default';
      var nameCell = el('td');
      nameCell.appendChild(el('span', { class: 'pname', text: r.name }));
      nameCell.appendChild(el('span', { class: 'pslug', text: r.slug }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      var chains = el('td');
      r.chains.slice(0, 3).forEach(function (c) { chains.appendChild(el('span', { class: 'chainchip', text: c })); });
      tr.appendChild(chains);
      tr.appendChild(el('td', { class: 'r num', text: money(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'r num ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }));
      tr.appendChild(el('td', { class: 'r num', html: '<b>' + money(r.mcap_usd) + '</b>' }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(table);
    return panel;
  }
  function modelPage() {
    var panel = el('section', { class: 'panel' });
    var head = el('div', { class: 'panelhead' });
    head.appendChild(el('h2', { text: 'How it works' }));
    head.appendChild(el('p', { text: 'The whole model, stated so a reader can check it against the snapshot.' }));
    panel.appendChild(head);
    var body = el('div', { class: 'detail' });
    body.appendChild(el('p', { html:
      'The snapshot is DefiLlama\u2019s protocol index as fetched ' + esc(DATA.as_of) + ': ' +
      '758 protocols at or above $5M of TVL. A protocol is <b>pre-token</b> when its record carries no market cap, no CoinGecko id and no symbol. ' +
      'The watchlist — ' + DATA.watchlist_size + ' protocols at or above $50M of TVL that record no token and are not a wrapped, staked or bridged product — is the floor, never the ceiling: the early radar adds ' +
      DATA.early_size + ' pre-token protocols below that floor, picked by growth-adjusted TVL.' }));
    var table = el('table', { class: 'breakdown' });
    var thead = el('thead');
    var hr = el('tr');
    ['Factor', 'What it is', 'Range'].forEach(function (h, i) { hr.appendChild(el('th', { text: h, class: i === 2 ? 'r' : '' })); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    [
      ['Sector multiple', 'Median live-token market-cap / TVL of the protocol\u2019s own category, from this snapshot; fewer than 5 live samples falls back to the global median.', '×0.08 – ×0.60'],
      ['Momentum', '1 + 0.5 × tanh(7-day TVL change / 40): growth lifts the value, a fall cuts it, both bounded.', '×0.50 – ×1.50'],
      ['Maturity', '0.55 + 0.45 × (1 − e^(−age / 540 days)): longer with no token counts for more, saturating; past 4 years it decays slowly.', '×0.55 – ×1.00'],
      ['Breadth', '1 + 0.04 per chain the protocol runs on, up to 6 chains: wider reach, wider launch.', '×1.04 – ×1.24'],
    ].forEach(function (row) {
      var tr = el('tr');
      tr.appendChild(el('td', { html: '<b>' + row[0] + '</b>' }));
      tr.appendChild(el('td', { text: row[1] }));
      tr.appendChild(el('td', { class: 'r num', text: row[2] }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    body.appendChild(el('p', { class: 'note', text: 'Implied value = TVL × sector multiple × momentum × maturity × breadth. It is this radar\u2019s own claim about what a launch would be worth if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued, and no protocol name is ever special-cased: the same function scores every row.' }));
    panel.appendChild(body);
    return panel;
  }
  function detailView(row, st) {
    var panel = el('section', { class: 'panel' });
    var body = el('div', { class: 'detail' });
    var back = el('button', { type: 'button', class: 'back', text: '← Back to the board' });
    back.addEventListener('click', function () { go({ view: 'board', q: st.q, cat: st.cat, sort: st.sort, dir: st.dir, protocol: null }); });
    body.appendChild(back);
    body.appendChild(el('h2', { text: row.name }));
    body.appendChild(el('p', { class: 'meta', html:
      esc(row.slug) + ' · ' + esc(row.category || 'No category') + ' · ' + esc(row.chains.join(', ') || 'no chains listed') +
      (row.on_watchlist ? ' · <b>On the watchlist</b>' : '') + ' · Records no token' }));
    var hero = el('div', { class: 'hero' });
    [['Implied value', moneyFull(row.implied_value_usd), true], ['Rank', '#' + row.rank, false], ['TVL', moneyFull(row.tvl_usd), false], ['7-day change', pct(row.change_7d), false], ['Age', row.age_days == null ? 'unknown' : row.age_days + ' days', false]].forEach(function (s) {
      var d = el('div', { class: 'herostat' + (s[2] ? ' big' : '') });
      d.appendChild(el('span', { text: s[0] }));
      d.appendChild(el('b', { text: s[1] }));
      hero.appendChild(d);
    });
    body.appendChild(hero);
    body.appendChild(el('h3', { text: 'How the value is built' }));
    var base = row.tvl_usd * row.sector_multiple;
    var table = el('table', { class: 'breakdown' });
    var thead = el('thead');
    var hr = el('tr');
    ['Step', 'Figure', 'Value'].forEach(function (h, i) { hr.appendChild(el('th', { text: h, class: i === 2 ? 'r' : '' })); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    [
      ['TVL', moneyFull(row.tvl_usd), ''],
      ['Sector multiple (' + (row.category || 'no category') + ')', '×' + row.sector_multiple.toFixed(2), moneyFull(base)],
      ['Momentum (7d ' + pct(row.change_7d) + ')', '×' + row.momentum_multiplier.toFixed(2), moneyFull(base * row.momentum_multiplier)],
      ['Maturity (' + (row.age_days == null ? 'age unknown' : row.age_days + ' days') + ')', '×' + row.maturity_multiplier.toFixed(2), moneyFull(base * row.momentum_multiplier * row.maturity_multiplier)],
      ['Breadth (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')', '×' + row.breadth_multiplier.toFixed(2), moneyFull(base * row.momentum_multiplier * row.maturity_multiplier * row.breadth_multiplier)],
    ].forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: r[0] }));
      tr.appendChild(el('td', { class: 'num', text: r[1] }));
      tr.appendChild(el('td', { class: 'r num', text: r[2] }));
      tbody.appendChild(tr);
    });
    var total = el('tr', { class: 'total' });
    total.appendChild(el('td', { text: 'Implied value' }));
    total.appendChild(el('td', { text: '' }));
    total.appendChild(el('td', { class: 'r num', text: moneyFull(row.implied_value_usd) }));
    tbody.appendChild(total);
    table.appendChild(tbody);
    body.appendChild(table);
    body.appendChild(el('h3', { text: 'How to farm it' }));
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) { steps.appendChild(el('li', { text: s })); });
    body.appendChild(steps);
    body.appendChild(el('p', { class: 'note', text: 'This plan is a starting point, not advice. Never pay anyone to claim for you, never share a seed phrase, and check every step on the protocol\u2019s own site. A launch may never come, and a farm costs gas whether or not it does.' }));
    panel.appendChild(body);
    return panel;
  }
  function footer() {
    var f = el('footer');
    f.appendChild(el('p', { text: 'Source: ' + DATA.source + '. Snapshot as of ' + DATA.as_of + '. Implied values are this radar\u2019s own claim, built from the snapshot\u2019s figures; they do not predict a launch. A protocol is described as recording no token, never as having none.' }));
    return f;
  }
  function render() {
    var st = state();
    app.setAttribute('aria-busy', 'true');
    app.textContent = '';
    var wrap = header(st);
    wrap.appendChild(modelStrip());
    wrap.appendChild(tabs(st));
    var row = st.protocol ? bySlug(st.protocol) : null;
    if (row) {
      wrap.appendChild(detailView(row, st));
    } else if (st.view === 'live') {
      wrap.appendChild(liveTable());
    } else if (st.view === 'model') {
      wrap.appendChild(modelPage());
    } else {
      var list = sortedRows(filteredRows(st), st);
      wrap.appendChild(controls(st, function (patch) {
        go({ view: 'board', q: patch.q !== undefined ? patch.q : st.q, cat: patch.cat !== undefined ? patch.cat : st.cat, sort: patch.sort !== undefined ? patch.sort : st.sort, dir: st.dir, protocol: null });
      }));
      var count = el('div', { class: 'count', text: list.length + ' of ' + DATA.rows.length + ' shown' });
      wrap.querySelector('.controls').appendChild(count);
      wrap.appendChild(boardTable(list, st));
    }
    wrap.appendChild(footer());
    app.appendChild(wrap);
    app.setAttribute('aria-busy', 'false');
    document.title = row ? row.name + ' — Token Launch Radar' : 'Token Launch Radar — pre-token protocols ranked by implied value';
  }
  window.addEventListener('popstate', render);
  render();
})();
