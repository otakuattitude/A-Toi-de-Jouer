'use strict';
const API_URL = 'https://script.google.com/macros/s/AKfycbx3-Iq9L310yrrJdX65rqCWUruODZELxS8SQmlcSG0VXHxwGFgkArHCkbxqc07aGukY/exec';

(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const noAcc = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const keyOf = t => noAcc(t).toLowerCase();
  const normHead = k => noAcc(k).toUpperCase().replace(/[^A-Z0-9]/g, '');   // "⏱️ DURÉE" -> "DUREE"
  const pref = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  // POST en text/plain (pas de preflight) : la réponse du script reste lisible, les erreurs sont détectées.
  const apiGet = async s => (await fetch(`${API_URL}?sheet=${encodeURIComponent(s)}`)).json();
  const apiPost = async b => (await fetch(API_URL, { method: 'POST', body: JSON.stringify(b) })).json();

  const S = { games: [], members: [], ratings: {}, wishes: {}, user: '', admin: false, view: pref.get('ludo_view', matchMedia('(max-width:700px)').matches ? 'list' : 'grid'), tab: 'catalogue' };
  let toastTimer;
  const toast = m => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500); };

  /* ---------- Chargement ---------- */
  function parseGame(raw) {
    const m = {}; Object.keys(raw).forEach(k => m[normHead(k)] = raw[k]);
    const f = n => String(m[n] ?? '').trim(), title = f('JEU');
    if (!title) return null;
    return { title, key: keyOf(title), amb: [f('AMBIANCE'), f('AMBIANCE2')].filter(Boolean), duree: f('DUREE') || '—', players: f('JOUEURS') || '?',
      niveau: f('NIVEAU'), modes: [f('MODE'), f('MODE2')].filter(Boolean), formats: [f('FORMAT'), f('FORMAT2')].filter(Boolean),
      img: f('IMG') || f('IMAGE'), desc: f('DESCRIPTION') || f('RESUME') };
  }
  async function load() {
    $('#catalogue').innerHTML = '<p class="empty">Chargement de la ludothèque…</p>';
    try {
      const [u, g, n, w] = await Promise.all([apiGet('users'), apiGet('jeux'), apiGet('Notes'), apiGet('Souhaits')]);
      S.members = (Array.isArray(u) ? u : []).map(x => ({ name: noAcc(x.prenom), admin: x.admin === true })).filter(x => x.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      S.games = (Array.isArray(g) ? g : []).map(parseGame).filter(Boolean).map((x, i) => ({ ...x, i }));
      S.ratings = {};
      (Array.isArray(n) ? n : []).forEach(r => {
        const u2 = noAcc(r.username), k = keyOf(r.gameTitle), s = +r.score;
        if (!u2 || !k) return;
        S.ratings[u2] = S.ratings[u2] || {};
        if (s > 0) S.ratings[u2][k] = s; else delete S.ratings[u2][k];
      });
      S.wishes = {};
      (Array.isArray(w) ? w : []).forEach(r => { const u2 = noAcc(r.username), k = keyOf(r.gameTitle); if (u2 && k) (S.wishes[u2] = S.wishes[u2] || {})[k] = true; });
      return true;
    } catch {
      $('#catalogue').innerHTML = '<p class="error">Impossible de joindre le Google Sheet. Réessayez dans un instant.</p>';
      return false;
    }
  }

  /* ---------- Notes ---------- */
  const mine = g => (S.ratings[S.user] || {})[g.key] || 0;
  function avg(g) {
    const v = Object.values(S.ratings).map(r => r[g.key]).filter(Boolean);
    return v.length ? `${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} (${v.length})` : 'pas de note';
  }
  const stars = g => '<span class="stars" role="group" aria-label="Ma note">' + [1, 2, 3, 4, 5].map(n =>
    `<button class="star${n <= mine(g) ? ' on' : ''}" data-i="${g.i}" data-star="${n}" aria-label="${n} étoile${n > 1 ? 's' : ''}"><i class="fa-solid fa-star"></i></button>`).join('') + `</span><span class="avg">${avg(g)}</span>`;
  async function rate(i, star) {
    const g = S.games[i], r = S.ratings[S.user] = S.ratings[S.user] || {};
    const prev = r[g.key] || 0, next = prev === star ? 0 : star;
    if (next) r[g.key] = next; else delete r[g.key];
    refresh();
    try {
      const res = await apiPost({ action: 'rate', username: S.user, gameTitle: g.title, ambiance: g.amb[0] || '', score: next });
      if (res.result !== 'success') throw new Error(res.result);
    } catch {
      if (prev) r[g.key] = prev; else delete r[g.key];
      refresh(); toast('Note non enregistrée, réessayez.');
    }
  }
  /* ---------- Liste de souhaits ---------- */
  const wished = g => !!(S.wishes[S.user] || {})[g.key];
  async function toggleWish(i) {
    const g = S.games[i], w = S.wishes[S.user] = S.wishes[S.user] || {}, was = !!w[g.key];
    if (was) delete w[g.key]; else w[g.key] = true;
    refresh();
    try {
      const r = await apiPost({ action: 'wish', username: S.user, gameTitle: g.title, on: !was });
      if (r.result !== 'success') throw new Error(r.result);
    } catch {
      if (was) w[g.key] = true; else delete w[g.key];
      refresh(); toast('Souhait non enregistré, réessayez.');
    }
  }
  document.addEventListener('click', e => {
    const s = e.target.closest('.star'), d = e.target.closest('.desc-btn');
    if (s) rate(+s.dataset.i, +s.dataset.star);
    const h = e.target.closest('.wish'); if (h) toggleWish(+h.dataset.i);
    const o = e.target.closest('[data-open]'); if (o && !e.target.closest('button, a, select, input')) openDetail(+o.dataset.open);
    if (d) { const g = S.games[+d.dataset.i]; $('#descTitle').textContent = g.title; $('#descText').textContent = g.desc; $('#descDialog').showModal(); }
  });
  /* ---------- Bulle de description au survol ---------- */
  const tip = Object.assign(document.createElement('div'), { className: 'tip', hidden: true });
  tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
  let tipFor = null;
  document.addEventListener('mouseover', e => {
    if (!matchMedia('(hover: hover)').matches) return;   // pas de bulle au toucher : le bouton « Fiche » suffit
    const el = e.target.closest('[data-tip]'), g = el && S.games[+el.dataset.tip];
    if (!g || !g.desc) { tip.hidden = true; tipFor = null; return; }
    if (tipFor !== el) { tipFor = el; tip.innerHTML = `<b>${esc(g.title)}</b>${esc(g.desc)}`; tip.hidden = false; }
  });
  document.addEventListener('mousemove', e => {
    if (tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;
    if (y + h > innerHeight - 8) y = e.clientY - h - 16;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  });
  document.addEventListener('mouseleave', () => { tip.hidden = true; tipFor = null; });
  document.addEventListener('error', e => {   // jaquette introuvable -> pictogramme
    if (e.target.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('span'), { textContent: '🎲' }));
  }, true);

  /* ---------- Rendu ---------- */
  const wishBtn = (g, inline) => `<button class="wish${wished(g) ? ' on' : ''}${inline ? ' inline' : ''}" data-i="${g.i}" aria-pressed="${wished(g)}"
    aria-label="${wished(g) ? 'Retirer de' : 'Ajouter à'} ma liste de souhaits : ${esc(g.title)}" title="${wished(g) ? 'Retirer de' : 'Ajouter à'} ma liste de souhaits"><i class="fa-${wished(g) ? 'solid' : 'regular'} fa-heart"></i></button>`;
  const cover = g => `<div class="cover">${/^https?:\/\//i.test(g.img) ? `<img src="${esc(g.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span aria-hidden="true">🎲</span>'}<span class="ambbadge">${esc(g.amb.join(' • ') || 'Général')}</span>${wishBtn(g)}</div>`;
  const descBtn = g => g.desc ? `<button class="fiche desc-btn" data-i="${g.i}" title="Voir la description"><i class="fa-solid fa-comment-dots"></i> Fiche</button>` : '';
  const chips = g => [['fa-clock', 'c-amber', g.duree], ['fa-users', 'c-cyan', g.players + ' j.'], ['fa-signal', 'c-emerald', g.niveau], ['fa-puzzle-piece', 'c-rose', g.modes.join(', ')], ['fa-box', 'c-purple', g.formats.join(', ')]]
    .filter(c => c[2]).map(c => `<span class="chip ${c[1]}"><i class="fa-solid ${c[0]}"></i>${esc(c[2])}</span>`).join('');
  const card = g => `<article class="game" data-tip="${g.i}"><div>${cover(g)}<div class="gbody"><div class="gtitle"><h3>${esc(g.title)}</h3>${descBtn(g)}</div><div class="chips">${chips(g)}</div></div></div>
    <div class="gfoot"><span class="muted b">Ma note :</span><div>${stars(g)}</div></div></article>`;
  const recCard = g => `<article class="card rec" data-tip="${g.i}"><div><div class="gtitle"><div><h4>${esc(g.title)}</h4><span class="pill-amber">Coup de cœur potentiel</span></div>${descBtn(g)}</div>
    <p class="muted">Similaire en <b class="ic-purple">${esc(g.amb.join(' / '))}</b>${g.modes.length ? ` (${esc(g.modes.join(' / '))})` : ''}.</p></div>
    <div class="recfoot"><span class="muted">Durée : ${esc(g.duree)}</span><em>Recommandé pour toi</em></div></article>`;
  /* ---------- Mobile : tuiles / lignes compactes + fiche détaillée au toucher ---------- */
  const isMobile = () => matchMedia('(max-width:700px)').matches;
  const thumb = g => /^https?:\/\//i.test(g.img) ? `<img src="${esc(g.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span aria-hidden="true">🎲</span>';
  const mineTag = g => mine(g) ? `<span class="mine">★ ${mine(g)}</span>` : '';
  const tile = g => `<article class="tile" data-open="${g.i}" tabindex="0" role="button" aria-label="${esc(g.title)}"><div class="tcover">${thumb(g)}${wishBtn(g)}${mineTag(g)}</div>
    <div class="tinfo"><b>${esc(g.title)}</b><small>⏱ ${esc(g.duree)} · 👥 ${esc(g.players)}</small></div></article>`;
  const row = g => `<article class="row" data-open="${g.i}" tabindex="0" role="button" aria-label="${esc(g.title)}"><div class="rthumb">${thumb(g)}</div>
    <div class="rinfo"><b>${esc(g.title)}</b><small>⏱ ${esc(g.duree)} · 👥 ${esc(g.players)}${g.niveau ? ' · ' + esc(g.niveau) : ''}</small></div>${mineTag(g)}${wishBtn(g, true)}</article>`;
  let openIdx = -1;
  function renderDetail() {
    const g = S.games[openIdx]; if (!g) return;
    $('#gameDetail').innerHTML = `${cover(g)}<h2>${esc(g.title)}</h2><div class="chips">${chips(g)}</div>${g.desc ? `<p class="desc">${esc(g.desc)}</p>` : ''}
      <div class="gfoot"><span class="muted b">Ma note :</span><div>${stars(g)}</div></div>`;
  }
  function openDetail(i) { openIdx = i; renderDetail(); $('#gameDialog').showModal(); }

  function renderGames(list, el, view) {
    if (!list.length) { el.innerHTML = '<p class="empty">Aucun jeu ne correspond à vos critères.</p>'; return; }
    if (isMobile()) { el.innerHTML = view === 'grid' ? `<div class="tiles">${list.map(tile).join('')}</div>` : `<div class="rows">${list.map(row).join('')}</div>`; return; }
    if (view === 'grid') { el.innerHTML = `<div class="grid">${list.map(card).join('')}</div>`; return; }
    el.innerHTML = '<div class="tablewrap"><table><thead><tr><th>Jeu</th><th>Ambiance(s)</th><th>Durée</th><th>Joueurs</th><th>Niveau</th><th>Mode(s)</th><th>Format(s)</th><th>Ma note</th><th>Envie</th></tr></thead><tbody>' +
      list.map(g => `<tr data-tip="${g.i}"><td><strong>${esc(g.title)}</strong> ${descBtn(g)}</td><td data-label="Ambiance" class="ic-purple b">${esc(g.amb.join(' / '))}</td><td data-label="Durée">${esc(g.duree)}</td><td data-label="Joueurs">${esc(g.players)}</td><td data-label="Niveau">${esc(g.niveau)}</td><td data-label="Mode">${esc(g.modes.join(' / '))}</td><td data-label="Format">${esc(g.formats.join(' / '))}</td><td data-label="Ma note">${stars(g)}</td><td data-label="Envie">${wishBtn(g, true)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  function fill(sel, label, values) {
    const v = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    $(sel).innerHTML = `<option value="">${label}</option>` + v.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  }
  function buildFilters() {
    const G = S.games;
    fill('#fAmbiance', 'Ambiance (Toutes)', G.flatMap(g => g.amb)); fill('#fDuree', 'Durée (Toutes)', G.map(g => g.duree));
    fill('#fNiveau', 'Niveau (Tous)', G.map(g => g.niveau)); fill('#fMode', 'Mode (Tous)', G.flatMap(g => g.modes));
    fill('#fFormat', 'Format (Tous)', G.flatMap(g => g.formats));
  }
  function renderCatalogue() {
    const q = keyOf($('#search').value), a = $('#fAmbiance').value, d = $('#fDuree').value, n = $('#fNiveau').value, m = $('#fMode').value, f = $('#fFormat').value;
    const list = S.games.filter(g => (!q || g.key.includes(q)) && (!a || g.amb.includes(a)) && (!d || g.duree === d) && (!n || g.niveau === n) && (!m || g.modes.includes(m)) && (!f || g.formats.includes(f)));
    $('#navCount').textContent = list.length;
    const nf = [a, d, n, m, f].filter(Boolean).length; $('#filterBadge').textContent = nf; $('#filterBadge').hidden = !nf;
    $$('.vbtn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    renderGames(list, $('#catalogue'), S.view);
  }
  function renderWishlist() {
    const w = S.wishes[S.user] || {}, list = S.games.filter(g => w[g.key]);
    $('#wishUser').textContent = S.user;
    if (list.length) renderGames(list, $('#wishlist'), S.view);
    else $('#wishlist').innerHTML = '<div class="card empty-card"><i class="fa-solid fa-heart ic-rose big"></i><h3>Ta liste est vide</h3><p class="muted">Clique sur le cœur d\'un jeu du catalogue pour le retrouver ici.</p></div>';
  }
  function renderForYou() {
    const r = S.ratings[S.user] || {}, liked = S.games.filter(g => r[g.key] >= 4), w = {};
    liked.forEach(g => { [...g.amb.map(x => 'a:' + x), ...g.modes.map(x => 'm:' + x)].forEach(k => w[k] = (w[k] || 0) + r[g.key]); });
    const list = S.games.filter(g => !r[g.key]).map(g => ({ g, s: g.amb.reduce((t, x) => t + 2 * (w['a:' + x] || 0), 0) + g.modes.reduce((t, x) => t + (w['m:' + x] || 0), 0) + Math.random() * 3 }))
      .filter(x => liked.length && x.s > 3).sort((x, y) => y.s - x.s).slice(0, 9).map(x => x.g);
    $('#recUser').textContent = S.user;
    $('#foryouIntro').textContent = 'Sélection sur-mesure basée sur tes jeux notés 4 ou 5 étoiles.';
    $('#foryou').innerHTML = list.length ? `<div class="recgrid">${list.map(recCard).join('')}</div>` :
      `<div class="card empty-card"><i class="fa-solid fa-star ic-amber big"></i><h3>${liked.length ? 'Aucune recommandation ciblée' : 'Pas assez de coups de cœur'}</h3>
      <p class="muted">${liked.length ? 'Tu as noté tous les jeux de ces catégories ! Explore d\'autres ambiances.' : 'Note quelques jeux à 4 ou 5 étoiles dans le catalogue pour que l\'algorithme comprenne tes goûts !'}</p></div>`;
  }

  /* ---------- Profils, rôles, onglets ---------- */
  function renderProfiles() {
    const opts = S.members.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.admin ? ' (admin)' : ''}</option>`).join('');
    $('#profileSelect').innerHTML = opts + '<option value="__new__">+ Créer mon profil…</option>';
    $('#profileSelect').value = S.user; $('#pickSelect').innerHTML = opts;
  }
  function applyRole() {
    $('#adminBadge').hidden = !S.admin;
    $$('[data-admin]').forEach(t => t.hidden = !S.admin);
    if (!S.admin && ['stats', 'admin'].includes(S.tab)) showTab('catalogue');
  }
  function enter(name, admin) { S.user = name; S.admin = admin; renderProfiles(); applyRole(); refresh(); }
  let pending = '';
  function selectProfile(name) {
    const m = S.members.find(x => x.name === name); if (!m) return;
    if (m.admin) { pending = name; $('#pwUser').textContent = name; $('#pwInput').value = ''; $('#pwError').hidden = true; $('#pwDialog').showModal(); $('#pwInput').focus(); }
    else enter(name, false);
  }
  function showTab(t) {
    if (['stats', 'admin'].includes(t) && !S.admin) t = 'catalogue';
    S.tab = t;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $$('.panel').forEach(p => p.hidden = p.id !== 'tab-' + t);
    refresh();
  }
  function refresh() {
    tip.hidden = true; tipFor = null;
    if ($('#gameDialog').open) renderDetail();
    $('#wishCount').textContent = S.games.filter(wished).length;
    if (S.tab === 'wishlist') renderWishlist();
    if (S.tab === 'catalogue') renderCatalogue();
    if (S.tab === 'foryou') renderForYou();
    if (S.tab === 'stats' && S.admin) Admin.renderStats();
  }
  function setTheme(t) {
    if (!['dark', 'light', 'cvd'].includes(t)) t = 'dark';
    document.documentElement.setAttribute('data-theme', t); $('#themeSelect').value = t; pref.set('ludo_theme', t);
  }
  const askWho = () => { $('#pickDialog').showModal(); };

  async function init() {
    setTheme(pref.get('ludo_theme', 'dark'));
    $('#themeSelect').onchange = e => setTheme(e.target.value);
    $$('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    $$('.vbtn').forEach(b => b.onclick = () => { S.view = b.dataset.view; pref.set('ludo_view', S.view); renderCatalogue(); });
    ['search', 'fAmbiance', 'fDuree', 'fNiveau', 'fMode', 'fFormat'].forEach(id => $('#' + id).addEventListener('input', renderCatalogue));
    $('#resetFilters').onclick = () => { $('#search').value = ''; $$('.filters select').forEach(s => s.value = ''); renderCatalogue(); };
    $('#descClose').onclick = () => $('#descDialog').close();
    $('#gameClose').onclick = () => $('#gameDialog').close();
    $('#gameDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });   // clic en dehors = fermer
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-open]')) openDetail(+e.target.dataset.open); });
    $('#filterToggle').onclick = () => { const o = $('#filtersCard').classList.toggle('filters-open'); $('#filterToggle').setAttribute('aria-expanded', o); };
    matchMedia('(max-width:700px)').addEventListener('change', () => refresh());
    $('#pickDialog').addEventListener('cancel', e => e.preventDefault());   // choix obligatoire au démarrage

    $('#pickForm').onsubmit = e => { e.preventDefault(); $('#pickDialog').close(); selectProfile($('#pickSelect').value); };
    $('#pickNew').onclick = () => { $('#pickDialog').close(); $('#newName').value = ''; $('#newError').hidden = true; $('#newDialog').showModal(); };
    $('#profileSelect').onchange = e => {
      if (e.target.value === '__new__') { $('#newName').value = ''; $('#newError').hidden = true; $('#newDialog').showModal(); }
      else selectProfile(e.target.value);
    };
    const backFromDialog = () => { if (!S.user) askWho(); else renderProfiles(); };
    $('#pwCancel').onclick = () => { $('#pwDialog').close(); backFromDialog(); };
    $('#pwDialog').addEventListener('cancel', () => setTimeout(backFromDialog));
    $('#pwForm').onsubmit = async e => {
      e.preventDefault();
      if (await Admin.login(pending, $('#pwInput').value)) { $('#pwDialog').close(); enter(pending, true); }
      else { $('#pwError').hidden = false; $('#pwInput').select(); }
    };
    $('#newCancel').onclick = () => { $('#newDialog').close(); backFromDialog(); };
    $('#newDialog').addEventListener('cancel', () => setTimeout(backFromDialog));
    $('#newForm').onsubmit = async e => {
      e.preventDefault();
      const name = noAcc($('#newName').value);
      if (!name) return;
      if (S.members.some(m => m.name.toLowerCase() === name.toLowerCase())) { $('#newError').textContent = 'Ce prénom existe déjà.'; $('#newError').hidden = false; return; }
      try {
        const r = await apiPost({ action: 'createUser', prenom: name });
        if (r.result === 'exists') { $('#newError').textContent = 'Ce prénom existe déjà.'; $('#newError').hidden = false; return; }
        if (r.result !== 'success') throw new Error(r.result);
      } catch { $('#newError').textContent = 'Création impossible, réessayez.'; $('#newError').hidden = false; return; }
      S.members.push({ name, admin: false }); S.members.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      $('#newDialog').close(); enter(name, false); toast(`Bienvenue ${name} !`);
    };

    if (await load()) { buildFilters(); renderProfiles(); renderCatalogue(); askWho(); }
  }
  window.App = { S, $, esc, apiPost, toast };
  document.addEventListener('DOMContentLoaded', init);
})();
