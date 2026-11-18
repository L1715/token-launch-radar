(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('main');
  if (!DATA || !DATA.rows) {
    main.innerHTML = '';
    var err = document.createElement('p');
    err.className = 'empty';
    err.textContent = 'No radar data was loaded. This page reads its data from the data.js file written beside it.';
    main.appendChild(err);
    return;
  }

  /* ---------- formatting ---------- */

  function fmtCompact(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }
  function pctClass(n) {
    if (n === null || n === undefined || n === 0) return 'flat';
    return n > 0 ? 'up' : 'down';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function fmtAgeLong(days) {
    if (days === null || days === undefined) return 'not reported';
    return days.toLocaleString('en-US') + ' days';
  }

  /* ---------- dom helper ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  /* ---------- state + hash routing ---------- */

  var SORTS = {
    value: 'implied value', tvl: 'TVL', change: '7-day change',
    age: 'age', name: 'name'
  };
  var state = { view: 'board', detail: null, q: '', cat: 'all', chain: 'all', watch: false, sort: 'value', dir: -1 };

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('view')) state.view = p.get('view');
    state.detail = p.get('detail');
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || 'all';
    state.chain = p.get('chain') || 'all';
    state.watch = p.get('watch') === '1';
    if (p.get('sort') && SORTS[p.get('sort')]) state.sort = p.get('sort');
    state.dir = p.get('dir') === '1' ? 1 : -1;
    if (state.detail && !DATA.rows.some(function (r) { return r.slug === state.detail; })) state.detail = null;
    if (['board', 'live', 'method'].indexOf(state.view) === -1) state.view = 'board';
  }
  function writeHash() {
    var p = new URLSearchParams();
    p.set('view', state.view);
    if (state.detail) p.set('detail', state.detail);
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'value') p.set('sort', state.sort);
    if (state.dir === 1) p.set('dir', '1');
    history.replaceState(null, '', '#' + p.toString());
  }
  window.addEventListener('hashchange', function () { readHash(); renderAll(); });

  /* ---------- filtering + sorting ---------- */

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'value') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d === null ? -Infinity : a.change_7d) - (b.change_7d === null ? -Infinity : b.change_7d);
      else if (key === 'age') d = (a.age_days === null ? -Infinity : a.age_days) - (b.age_days === null ? -Infinity : b.age_days);
      else d = a.name.localeCompare(b.name);
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
  }

  /* ---------- shared chrome ---------- */

  var chromeEl = el('section', { id: 'chrome' });
  var viewEl = el('section', { id: 'view' });
  main.appendChild(chromeEl);
  main.appendChild(viewEl);
  main.removeAttribute('aria-busy');

  document.getElementById('top-meta').innerHTML = '';
  document.getElementById('top-meta').appendChild(el('span', {}, [
    el('b', { text: 'Snapshot ' + DATA.as_of }),
    document.createTextNode(' · ' + (DATA.universe_size || DATA.rows.length) + ' protocols · watchlist floor ' + fmtCompact(DATA.floor_usd))
  ]));

  function kpis() {
    var items = [
      [String(DATA.board_size), 'Ranked protocols'],
      [DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'Watchlist covered'],
      [String(DATA.early_size), 'Early finds below the floor'],
      [fmtCompact(DATA.total_implied_usd), 'Total implied value'],
      [DATA.calibration.base_multiple.toFixed(3) + '×', 'Base multiple (market median)']
    ];
    return el('div', { class: 'kpis' }, items.map(function (it, i) {
      return el('div', { class: i === 3 ? 'kpi hot' : 'kpi' }, [el('b', { text: it[0], class: 'num' }), el('span', { text: it[1] })]);
    }));
  }
  function ribbon() {
    var c = DATA.calibration;
    return el('p', { class: 'ribbon' }, [
      document.createTextNode('Value model  '),
      el('code', { text: 'implied = TVL × ' + c.base_multiple.toFixed(4) + ' × growth × maturity × breadth' }),
      document.createTextNode('  — the base multiple is the median market-cap-to-TVL ratio of the ' + c.calibration_n + ' live-token protocols in this snapshot. '),
      el('b', { text: 'No protocol name is ever special-cased.' })
    ]);
  }

  function categories() {
    var set = {};
    DATA.rows.forEach(function (r) { set[r.category || 'Other'] = true; });
    return Object.keys(set).sort();
  }
  function chains() {
    var set = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { set[c] = true; }); });
    return Object.keys(set).sort();
  }

  function renderControls() {
    chromeEl.innerHTML = '';
    chromeEl.appendChild(kpis());
    chromeEl.appendChild(ribbon());
    var box = el('div', { class: 'controls' });

    var search = el('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Search name or slug…', 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; state.detail = null; writeHash(); renderView(); });
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'q', text: 'Search' }), search]));

    var catSel = el('select', { id: 'cat', 'aria-label': 'Filter by category' },
      [el('option', { value: 'all', text: 'All categories' })].concat(categories().map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.cat ? 'selected' : null });
      })));
    catSel.addEventListener('change', function () { state.cat = catSel.value; state.detail = null; writeHash(); renderView(); });
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'cat', text: 'Category' }), catSel]));

    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      [el('option', { value: 'all', text: 'All chains' })].concat(chains().map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
      })));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; state.detail = null; writeHash(); renderView(); });
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'chain', text: 'Chain' }), chainSel]));

    var sortSel = el('select', { id: 'sort', 'aria-label': 'Sort by' }, Object.keys(SORTS).map(function (k) {
      return el('option', { value: k, text: 'Sort: ' + SORTS[k], selected: k === state.sort ? 'selected' : null });
    }));
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; state.dir = state.sort === 'name' ? 1 : -1; writeHash(); renderView(); });
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'sort', text: 'Sort' }), sortSel]));

    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); renderView(); });
    box.appendChild(el('div', { class: 'checks' }, [
      el('label', {}, [watchBox, document.createTextNode('Watchlist only')])
    ]));

    var tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Views' });
    [['board', 'Board'], ['live', 'Live tokens'], ['method', 'Method']].forEach(function (t) {
      tabs.appendChild(el('button', {
        type: 'button', 'aria-pressed': state.view === t[0] ? 'true' : 'false', text: t[1],
        onclick: function () { state.view = t[0]; state.detail = null; writeHash(); renderAll(); }
      }));
    });
    box.appendChild(tabs);
    chromeEl.appendChild(box);
  }

  /* ---------- board ---------- */

  function openDetail(slug) { state.detail = slug; writeHash(); renderAll(); window.scrollTo(0, 0); }
  function closeDetail() { state.detail = null; writeHash(); renderAll(); }

  function sortHeader(key, label, cls) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return el('th', { class: cls || null, scope: 'col' }, [el('button', {
      type: 'button', text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash(); renderView();
      }
    })]);
  }

  function boardView() {
    var list = sortedRows(filteredRows());
    var frag = document.createDocumentFragment();
    frag.appendChild(el('p', { class: 'count' }, [
      document.createTextNode('Showing '),
      el('b', { text: String(list.length) }),
      document.createTextNode(' of ' + DATA.board_size + ' ranked protocols · sorted by ' + SORTS[state.sort] + (state.dir === 1 ? ' ascending' : ' descending') + ' · every row records no token.')
    ]));
    if (list.length === 0) {
      var empty = el('div', { class: 'panel' }, [el('div', { class: 'empty' }, [
        el('p', { text: 'No protocol matches these filters.' }),
        el('button', { type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.watch = false; writeHash(); renderAll(); } })
      ])]);
      frag.appendChild(empty);
      return frag;
    }
    var max = DATA.rows[0].implied_value_usd;
    var table = el('table', {}, []);
    var head = el('tr', {}, [
      el('th', { scope: 'col', text: '#' }),
      sortHeader('name', 'Protocol'),
      sortHeader('tvl', 'TVL', 'n'),
      sortHeader('change', '7d', 'n'),
      sortHeader('age', 'Age', 'n'),
      sortHeader('value', 'Implied value', 'n')
    ]);
    table.appendChild(el('thead', {}, [head]));
    var body = el('tbody', {}, []);
    list.forEach(function (r) {
      var badges = [];
      if (r.on_watchlist) badges.push(el('span', { class: 'badge watch', text: 'Watchlist' }));
      var row = el('tr', {
        tabindex: '0', class: r.rank <= 3 ? 'top3' : null,
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      }, [
        el('td', { class: 'rank num', text: String(r.rank) }),
        el('td', {}, [
          el('span', { class: 'pname', text: r.name }),
          badges.length ? el('span', {}, badges) : null,
          el('div', { class: 'pmeta', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 3).join(', ') || 'no chain listed') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') })
        ]),
        el('td', { class: 'n num', text: fmtCompact(r.tvl_usd) }),
        el('td', { class: 'n num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }),
        el('td', { class: 'n num', text: fmtAge(r.age_days) }),
        el('td', { class: 'n valcell' }, [
          el('b', { class: 'num', text: fmtCompact(r.implied_value_usd) }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + Math.max(1, Math.round(r.implied_value_usd / max * 100)) + '%' })])
        ])
      ]);
      body.appendChild(row);
    });
    table.appendChild(body);
    frag.appendChild(el('div', { class: 'panel table-wrap' }, [table]));
    return frag;
  }

  /* ---------- detail ---------- */

  function splitStep(s) {
    var costAt = s.indexOf(' Cost: ');
    if (costAt === -1) return { action: s, cost: null, time: null };
    var timeAt = s.indexOf('. Time: ', costAt);
    if (timeAt === -1) return { action: s.slice(0, costAt), cost: s.slice(costAt + 7), time: null };
    return {
      action: s.slice(0, costAt),
      cost: s.slice(costAt + 7, timeAt),
      time: s.slice(timeAt + 8).replace(/\.$/, '')
    };
  }

  function detailView(slug) {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return boardView();
    var m = r.model;
    var frag = document.createDocumentFragment();
    frag.appendChild(el('button', { type: 'button', class: 'back', text: '← Back to the board', onclick: closeDetail }));
    var badges = [];
    if (r.on_watchlist) badges.push(el('span', { class: 'badge watch', text: 'Watchlist' }));
    var prev = DATA.rows[r.rank - 2], next = DATA.rows[r.rank];
    var nav = el('div', { class: 'ranknav' }, [
      el('button', { type: 'button', text: '← Previous rank', disabled: !prev ? 'disabled' : null, onclick: function () { if (prev) openDetail(prev.slug); } }),
      el('button', { type: 'button', text: 'Next rank →', disabled: !next ? 'disabled' : null, onclick: function () { if (next) openDetail(next.slug); } })
    ]);
    frag.appendChild(el('div', { class: 'detail-head' }, [
      el('div', {}, [
        el('h2', {}, [document.createTextNode('#' + r.rank + '  ' + r.name), el('span', {}, badges)]),
        el('p', { class: 'slug', text: r.slug + ' · ' + (r.category || 'Uncategorised') + ' · ' + (r.chains.join(', ') || 'no chain listed') })
      ]),
      nav
    ]));
    frag.appendChild(el('div', { class: 'stats' }, [
      el('div', { class: 'stat hot' }, [el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtFull(r.implied_value_usd) }), el('small', { text: 'rank ' + r.rank + ' of ' + DATA.board_size })]),
      el('div', { class: 'stat' }, [el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtFull(r.tvl_usd) }), el('small', { text: r.tvl_usd >= DATA.floor_usd ? 'at or above the watchlist floor' : 'below the watchlist floor — an early find' })]),
      el('div', { class: 'stat' }, [el('span', { text: '7-day TVL change' }), el('b', { class: 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }), el('small', { text: r.change_7d === null ? 'not reported; counted as 0%' : 'winsorised to ' + m.growth_pct.toFixed(1) + '%' })]),
      el('div', { class: 'stat' }, [el('span', { text: 'Running with no token' }), el('b', { class: 'num', text: fmtAgeLong(r.age_days) }), el('small', { text: m.age_imputed ? 'listed date not reported; median age of ' + m.age_days_used + ' days used' : 'listed ' + (r.listed_at || '') })])
    ]));

    var bdRows = [
      ['TVL', fmtFull(r.tvl_usd)],
      ['× base multiple (market median)', '× ' + m.base_multiple.toFixed(4)],
      ['× growth multiplier (' + m.growth_pct.toFixed(1) + '% over 7 days)', '× ' + m.growth_multiplier.toFixed(4)],
      ['× maturity multiplier (' + m.age_days_used + ' days' + (m.age_imputed ? ', imputed' : '') + ')', '× ' + m.maturity_multiplier.toFixed(4)],
      ['× breadth multiplier (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', '× ' + m.breadth_multiplier.toFixed(4)]
    ];
    var bd = el('table', { class: 'breakdown' }, []);
    bdRows.forEach(function (row) {
      bd.appendChild(el('tr', {}, [el('td', { text: row[0] }), el('td', { text: row[1] })]));
    });
    bd.appendChild(el('tr', { class: 'total' }, [el('td', { text: 'Implied value' }), el('td', { text: fmtFull(r.implied_value_usd) })]));
    var left = el('div', { class: 'card' }, [
      el('h3', { text: 'How the value is built' }),
      bd,
      el('p', { class: 'note', text: 'Every factor comes from this protocol\'s own snapshot figures. It is ranked on the same figures as every other row; no name is special-cased.' })
    ]);

    var planItems = r.farm_steps.map(function (s) {
      var p = splitStep(s);
      var chips = [];
      if (p.cost) chips.push(el('span', { class: 'chip' }, [document.createTextNode('Cost: '), el('b', { text: p.cost })]));
      if (p.time) chips.push(el('span', { class: 'chip' }, [document.createTextNode('Time: '), el('b', { text: p.time })]));
      return el('li', {}, [el('p', { text: p.action }), el('div', { class: 'chips' }, chips)]);
    });
    var right = el('div', { class: 'card' }, [
      el('h3', { text: 'Farm plan — what to do, what it costs, how long it takes' }),
      el('ol', { class: 'plan' }, planItems)
    ]);
    frag.appendChild(el('div', { class: 'grid2' }, [left, right]));
    return frag;
  }

  /* ---------- live tokens ---------- */

  function liveView() {
    var frag = document.createDocumentFragment();
    frag.appendChild(el('p', { class: 'count' }, [
      document.createTextNode('These '),
      el('b', { text: String(DATA.live.length) }),
      document.createTextNode(' protocols already have a token that trades, so they are not ranked: the market has already priced them. Their market caps are shown as reported, and their median market-cap-to-TVL ratio calibrates the board\'s base multiple.')
    ]));
    var table = el('table', { class: 'static' }, []);
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: '#' }),
      el('th', { scope: 'col', text: 'Protocol' }),
      el('th', { scope: 'col', class: 'n', text: 'TVL' }),
      el('th', { scope: 'col', class: 'n', text: 'Market cap' }),
      el('th', { scope: 'col', class: 'n', text: 'Mcap / TVL' }),
      el('th', { scope: 'col', class: 'n', text: '7d' })
    ])]));
    var body = el('tbody', {}, []);
    DATA.live.forEach(function (r, i) {
      body.appendChild(el('tr', {}, [
        el('td', { class: 'rank num', text: String(i + 1) }),
        el('td', {}, [
          el('span', { class: 'pname', text: r.name }),
          el('div', { class: 'pmeta', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 3).join(', ') || 'no chain listed') })
        ]),
        el('td', { class: 'n num', text: fmtCompact(r.tvl_usd) }),
        el('td', { class: 'n num', text: fmtCompact(r.mcap_usd) }),
        el('td', { class: 'n num', text: r.mcap_tvl === null ? '—' : r.mcap_tvl.toFixed(3) + '×' }),
        el('td', { class: 'n num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) })
      ]));
    });
    table.appendChild(body);
    frag.appendChild(el('div', { class: 'panel table-wrap' }, [table]));
    return frag;
  }

  /* ---------- method ---------- */

  function methodView() {
    var c = DATA.calibration;
    var wrap = el('div', { class: 'method' });
    wrap.appendChild(el('h2', { text: 'Method: how the radar ranks a launch that does not exist yet' }));
    wrap.appendChild(el('p', { text: 'The snapshot carries no ranking, no implied value and no farm plan. This radar derives all three from the snapshot\'s own figures — TVL, seven-day growth, time running with no token, and chain breadth — and from nothing else. The same function scores every protocol; no name is ever special-cased, so a protocol that appears in a future snapshot is ranked the moment it arrives.' }));
    wrap.appendChild(el('div', { class: 'formula' }, [
      document.createTextNode('implied_value_usd = TVL × base × growth × maturity × breadth'),
      el('br', {}),
      document.createTextNode('  base     = median(mcap / TVL) over live-token protocols = '),
      el('b', { text: c.base_multiple.toFixed(4) + '  (n = ' + c.calibration_n + ', clamped to 0.05–0.50)' }),
      el('br', {}),
      document.createTextNode('  growth   = 1 + 0.5 × winsorised 7-day change (−50% … +100%; missing counts as 0%)'),
      el('br', {}),
      document.createTextNode('  maturity = 0.60 + 0.40 × (1 − exp(−age / 365 days)); missing listed date imputed at the median age, ' + c.median_age_days + ' days'),
      el('br', {}),
      document.createTextNode('  breadth  = 1 + 0.04 per extra chain, up to 5 extra chains (max 1.20)')
    ]));
    wrap.appendChild(el('h3', { text: 'Why the base multiple comes from the market' }));
    wrap.appendChild(el('p', { text: 'Asserting a multiple would be a guess dressed as a model. Instead the radar asks the snapshot what the market already pays for a dollar of TVL: the median ratio across the live-token protocols that carry both a market cap and a TVL. The median, not the mean, so one outlier cannot move it; the clamp keeps it inside a plausible band even on a strange snapshot.' }));
    wrap.appendChild(el('h3', { text: 'What is ranked, and what is set aside' }));
    var ul = el('ul', {}, []);
    [
      'Ranked: every protocol that records no token (no market cap, no CoinGecko id, no symbol) and passes the exclusion rule below — ' + DATA.board_size + ' rows, including all ' + DATA.watchlist_size + ' watchlist protocols and ' + DATA.early_size + ' more below the watchlist floor.',
      'Set aside from the ranking: exchange products (category CEX), whose TVL is custodial; versioned pools (names ending in a version marker), which would double-count one protocol; and bridge, wrapped and staked products — a wrapped or staked product of a token that already trades is not a token that does not exist yet. ' + DATA.set_aside.length + ' pre-token protocols are set aside, each listed with its reason at the bottom of this page.',
      'Shown separately: protocols whose token already trades appear under Live tokens with the market\'s own caps. They calibrate the model; they are never ranked against launches that have not happened.'
    ].forEach(function (t) { ul.appendChild(el('li', { text: t })); });
    wrap.appendChild(ul);
    wrap.appendChild(el('h3', { text: 'Farm plans' }));
    wrap.appendChild(el('p', { text: 'Each plan is generated from the protocol\'s own record: the action follows its category, the gas follows its first chain, the capital follows its TVL, and the holding period follows its age. Every step states what it costs and how long it takes. Plans never promise an airdrop — they describe the activity a snapshot would see.' }));
    wrap.appendChild(el('h3', { text: 'Limits' }));
    wrap.appendChild(el('p', { text: 'A record that carries no token may simply be incomplete. TVL can be gamed, seven days is a short window, and age is measured from the day tracking began, not from launch. The radar is a thermometer for where farming attention is best spent, not a prediction of issuance, timing, or price.' }));
    wrap.appendChild(el('h3', { text: 'Set aside: ' + DATA.set_aside.length + ' pre-token protocols not ranked, with reasons' }));
    var st = el('table', { class: 'static' }, []);
    st.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: 'Protocol' }),
      el('th', { scope: 'col', class: 'n', text: 'TVL' }),
      el('th', { scope: 'col', text: 'Reason set aside' })
    ])]));
    var sb = el('tbody', {}, []);
    DATA.set_aside.forEach(function (r) {
      sb.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'pname', text: r.name }), el('div', { class: 'pmeta', text: (r.category || 'Uncategorised') + ' · ' + r.slug })]),
        el('td', { class: 'n num', text: fmtCompact(r.tvl_usd) }),
        el('td', { text: r.reason })
      ]));
    });
    st.appendChild(sb);
    wrap.appendChild(el('div', { class: 'panel table-wrap', style: 'margin-top:10px' }, [st]));
    return wrap;
  }

  /* ---------- render ---------- */

  function renderView() {
    chromeEl.hidden = state.detail !== null;
    viewEl.innerHTML = '';
    if (state.detail) viewEl.appendChild(detailView(state.detail));
    else if (state.view === 'live') viewEl.appendChild(liveView());
    else if (state.view === 'method') viewEl.appendChild(methodView());
    else viewEl.appendChild(boardView());
  }
  function renderAll() { renderControls(); renderView(); }

  readHash();
  renderAll();
})();
