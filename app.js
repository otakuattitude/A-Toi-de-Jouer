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
  const apiGet = async s => {
    const t = await (await fetch(`${API_URL}?sheet=${encodeURIComponent(s)}`)).text();
    try { return JSON.parse(t); } catch { throw new Error('NONJSON'); }   // le script a répondu par une page HTML (autorisation, erreur…)
  };
  const apiPost = async b => (await fetch(API_URL, { method: 'POST', body: JSON.stringify(b) })).json();

  const S = { games: [], members: [], ratings: {}, wishes: {}, user: '', admin: false, view: pref.get('ludo_view', matchMedia('(max-width:700px)').matches ? 'list' : 'grid'), tab: 'catalogue' };
  let toastTimer;
  const toast = m => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500); };

  /* ---------- Chargement ---------- */
  function parseGame(raw) {
    const m = {}; Object.keys(raw).forEach(k => m[normHead(k)] = raw[k]);
    const f = n => String(m[n] ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim(), title = f('JEU');   // retire les emojis en début de cellule (ex. « ⚡ 15–30 min »)
    if (!title) return null;
    return { title, key: keyOf(title), amb: [f('AMBIANCE'), f('AMBIANCE2')].flatMap(x => x.split(/\s*\/\s*/)).filter(Boolean), duree: f('DUREE') || '—', players: f('JOUEURS') || '?',
      niveau: f('NIVEAU'), modes: [f('MODE'), f('MODE2')].flatMap(x => x.split(/\s*\/\s*/)).filter(Boolean), formats: [f('FORMAT'), f('FORMAT2')].flatMap(x => x.split(/\s*\/\s*/)).filter(Boolean),
      img: f('IMG') || f('IMAGE'), desc: f('DESCRIPTION') || f('RESUME') };
  }
  async function load() {
    $('#catalogue').innerHTML = '<p class="empty">Chargement de la ludothèque…</p>';
    S.loadError = '';
    try {
      const [u, g, n, w, af] = await Promise.all([apiGet('users'), apiGet('jeux'), apiGet('Notes').catch(() => null), apiGet('Souhaits').catch(() => null), apiGet('affiche').catch(() => null)]);
      S.affiche = af && typeof af === 'object' && !Array.isArray(af) ? af : null;   // ancien script sans bandeau : on l'ignore
      S.members = (Array.isArray(u) ? u : []).map(x => ({ name: noAcc(x.prenom), admin: x.admin === true })).filter(x => x.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      S.games = (Array.isArray(g) ? g : []).map(parseGame).filter(Boolean).map((x, i) => ({ ...x, i }));
      if (!S.members.length) throw new Error('NOUSERS');
      if (!S.games.length) throw new Error('NOGAMES');
      if (n === null) toast('Notes momentanément indisponibles.');
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
    } catch (err) {
      const why = { NONJSON: "Le script Google a renvoyé une page à la place des données (autorisation à renouveler ou mauvaise version déployée).",
        NOGAMES: "Le Google Sheet répond, mais l'onglet « jeux » est introuvable ou vide.",
        NOUSERS: "Le Google Sheet répond, mais l'onglet « users » est introuvable ou vide." }[err.message] || "Connexion impossible au script Google. Vérifiez la connexion puis réessayez.";
      S.loadError = `<div class="card empty-card"><i class="fa-solid fa-triangle-exclamation ic-rose big"></i><h3>Données indisponibles</h3><p class="muted">${esc(why)}</p><button class="btn primary" id="retryLoad">Réessayer</button></div>`;
      $('#catalogue').innerHTML = S.loadError;
      return false;
    }
  }

  /* ---------- Notes ---------- */
  const mine = g => (S.ratings[S.user] || {})[g.key] || 0;
  function avg(g) {
    const v = Object.values(S.ratings).map(r => r[g.key]).filter(Boolean);
    return v.length ? { has: true, txt: `${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} (${v.length})` } : { has: false, txt: 'pas de note' };
  }
  const stars = g => `<span class="stars${S.user ? '' : ' locked'}" role="group" aria-label="${S.user ? 'Ma note' : 'Notation réservée aux membres : choisis un profil'}">` + [1, 2, 3, 4, 5].map(n =>
    `<button class="star${n <= mine(g) ? ' on' : ''}" data-i="${g.i}" data-star="${n}" aria-label="${n} étoile${n > 1 ? 's' : ''}"><i class="fa-solid fa-star"></i></button>`).join('') + `</span>${(a => `<span class="avg${a.has ? ' has' : ''}">${a.has ? '<i class="fa-solid fa-star"></i> ' : ''}${a.txt}</span>`)(avg(g))}`;
  const needLogin = () => { toast('Choisis ton profil pour noter ou garder des jeux.'); $('#pickDialog').showModal(); };
  async function rate(i, star) {
    if (!S.user) return needLogin();
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
    if (!S.user) return needLogin();
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
    if (e.target.closest('#retryLoad')) location.reload();
    if (e.target.closest('#loginPrompt')) $('#pickDialog').showModal();
    const o = e.target.closest('[data-open]'); if (o && !e.target.closest('button, a, select, input, .more')) toggleOpen(o);
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
    if (e.target.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('i'), { className: 'fa-solid fa-dice' }));
  }, true);

  /* ---------- Rendu ---------- */
  const wishBtn = (g, inline) => `<button class="wish${wished(g) ? ' on' : ''}${S.user ? '' : ' locked'}${inline ? ' inline' : ''}" data-i="${g.i}" aria-pressed="${wished(g)}"
    aria-label="${wished(g) ? 'Retirer de' : 'Ajouter à'} ma liste de souhaits : ${esc(g.title)}" title="${wished(g) ? 'Retirer de' : 'Ajouter à'} ma liste de souhaits"><i class="fa-${wished(g) ? 'solid' : 'regular'} fa-heart"></i></button>`;
  const cover = g => `<div class="cover">${/^https?:\/\//i.test(g.img) ? `<img src="${esc(g.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<i class="fa-solid fa-dice" aria-hidden="true"></i>'}<span class="ambbadge">${esc(g.amb.join(' • ') || 'Général')}</span></div>`;
  const descBtn = g => g.desc ? `<button class="fiche desc-btn" data-i="${g.i}" title="Voir la description"><i class="fa-solid fa-comment-dots"></i> Fiche</button>` : '';
  const easy = n => /d[eé]butant|famil|facile|initi|enfant/i.test(n || '');
  const chipList = rows => rows.filter(c => c[2]).map(c => `<span class="chip${c[1] ? ' ' + c[1] : ''}"><i class="fa-solid ${c[0]}"></i>${esc(c[2])}</span>`).join('');
  const chipsLite = g => chipList([['fa-signal', easy(g.niveau) ? 'c-ok' : '', g.niveau], ['fa-puzzle-piece', '', g.modes.join(', ')], ['fa-box', '', g.formats.join(', ')]]);
  const chips = g => chipList([['fa-clock', '', g.duree], ['fa-users', '', g.players + ' j.']]) + chipsLite(g);
  const card = g => `<article class="game" data-tip="${g.i}"><div>${cover(g)}<div class="gbody"><div class="gtitle"><h3>${esc(g.title)}</h3><div class="gact">${descBtn(g)}${wishBtn(g, true)}</div></div><div class="chips">${chips(g)}</div></div></div>
    <div class="gfoot"><span class="muted b">Ma note :</span><div>${stars(g)}</div></div></article>`;
  const recCard = p => { const g = p.game; return `<article class="card rec" data-tip="${g.i}"><div><div class="gtitle"><div><h4>${esc(g.title)}</h4>
    <span class="pill-amber">${p.kind === 'popular' ? 'Apprécié dans l\'asso' : 'Coup de cœur potentiel'}</span></div>${descBtn(g)}</div>
    <p class="muted">${p.kind === 'popular' ? `Noté ${p.avg.toFixed(1)} ★ par ${p.n} membre${p.n > 1 ? 's' : ''}.` : (p.because ? `Parce que tu as aimé <b>${esc(p.because)}</b>` : 'Proche de tes goûts') + (g.amb.length ? ` — ${esc(g.amb.join(' / '))}` : '') + '.'}</p></div>
    <div class="recfoot"><span class="muted">Durée : ${esc(g.duree)}</span><em>${p.kind === 'popular' ? 'Populaire' : 'Recommandé pour toi'}</em></div></article>`; };
  /* ---------- Mobile : tuiles / lignes compactes + fiche détaillée au toucher ---------- */
  const isMobile = () => matchMedia('(max-width:700px)').matches;
  const thumb = g => /^https?:\/\//i.test(g.img) ? `<img src="${esc(g.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<i class="fa-solid fa-dice" aria-hidden="true"></i>';
  const mineTag = g => mine(g) ? `<span class="mine">★ ${mine(g)}</span>` : '';
  const opened = new Set();                                   // jeux dont la fiche est dépliée (conservé entre deux rafraîchissements)
  const details = g => `<div class="infobox"><div class="infoline"><span><i class="fa-solid fa-clock"></i> ${esc(g.duree)}</span><span><i class="fa-solid fa-users"></i> ${esc(g.players)} j.</span></div>${g.desc ? `<p class="desc">${esc(g.desc)}</p>` : ''}</div>
    <div class="chips">${g.amb.map(a => `<span class="chip">${esc(a)}</span>`).join('')}${chipsLite(g)}</div>
    <div class="gfoot"><span class="muted b">Ma note :</span><div>${stars(g)}</div></div>`;
  const more = g => `<div class="more">${opened.has(g.i) ? details(g) : ''}</div>`;
  const openAttrs = g => `class="${'@'}${opened.has(g.i) ? ' open' : ''}" data-open="${g.i}" tabindex="0" role="button" aria-expanded="${opened.has(g.i)}" aria-label="${esc(g.title)}"`;
  const tile = g => `<article ${openAttrs(g).replace('@', 'tile')}><div class="tcover">${thumb(g)}<span class="ambbadge">${esc(g.amb.join(' • ') || 'Général')}</span>${wishBtn(g)}${mineTag(g)}</div>
    <div class="tinfo"><b>${esc(g.title)}</b></div>${more(g)}</article>`;
  const row = g => `<article ${openAttrs(g).replace('@', 'row')}><div class="rhead"><div class="rthumb">${thumb(g)}</div>
    <div class="rinfo"><b>${esc(g.title)}</b><small><i class="fa-regular fa-clock"></i> ${esc(g.duree)} · <i class="fa-solid fa-users"></i> ${esc(g.players)}${g.niveau ? ' · ' + esc(g.niveau) : ''}</small></div>${mineTag(g)}${wishBtn(g, true)}</div>${more(g)}</article>`;
  function toggleOpen(el) {                                   // déplie / replie la fiche sur place, sans recharger la liste
    const i = +el.dataset.open, g = S.games[i], on = !opened.has(i);
    if (on) opened.add(i); else opened.delete(i);
    el.classList.toggle('open', on); el.setAttribute('aria-expanded', on);
    el.querySelector('.more').innerHTML = on ? details(g) : '';
  }

  function renderGames(list, el, view) {
    if (!list.length) { el.innerHTML = '<p class="empty">Aucun jeu ne correspond à vos critères.</p>'; return; }
    if (isMobile()) { el.innerHTML = view === 'grid' ? `<div class="tiles">${list.map(tile).join('')}</div>` : `<div class="rows">${list.map(row).join('')}</div>`; return; }
    if (view === 'grid') { el.innerHTML = `<div class="grid">${list.map(card).join('')}</div>`; return; }
    el.innerHTML = '<div class="tablewrap"><table><thead><tr><th>Jeu</th><th>Ambiance(s)</th><th>Durée</th><th>Joueurs</th><th>Niveau</th><th>Mode(s)</th><th>Format(s)</th><th>Ma note</th><th>Envie</th></tr></thead><tbody>' +
      list.map(g => `<tr data-tip="${g.i}"><td><strong>${esc(g.title)}</strong> ${descBtn(g)}</td><td data-label="Ambiance" class="b">${esc(g.amb.join(' / '))}</td><td data-label="Durée">${esc(g.duree)}</td><td data-label="Joueurs">${esc(g.players)}</td><td data-label="Niveau">${esc(g.niveau)}</td><td data-label="Mode">${esc(g.modes.join(' / '))}</td><td data-label="Format">${esc(g.formats.join(' / '))}</td><td data-label="Ma note">${stars(g)}</td><td data-label="Envie">${wishBtn(g, true)}</td></tr>`).join('') + '</tbody></table></div>';
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
    if (S.loadError) { $('#catalogue').innerHTML = S.loadError; return; }
    const q = keyOf($('#search').value), a = $('#fAmbiance').value, d = $('#fDuree').value, n = $('#fNiveau').value, m = $('#fMode').value, f = $('#fFormat').value;
    const list = S.games.filter(g => (!q || g.key.includes(q)) && (!a || g.amb.includes(a)) && (!d || g.duree === d) && (!n || g.niveau === n) && (!m || g.modes.includes(m)) && (!f || g.formats.includes(f)));
    $('#navCount').textContent = list.length;
    const nf = [a, d, n, m, f].filter(Boolean).length; $('#filterBadge').textContent = nf; $('#filterBadge').hidden = !nf;
    $$('.vbtn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    renderGames(list, $('#catalogue'), S.view);
  }
  const loginCard = (t, m) => `<div class="card empty-card"><i class="fa-solid fa-user-lock ic-amber big"></i><h3>${t}</h3><p class="muted">${m}</p><button class="btn primary" id="loginPrompt">Choisir mon profil</button></div>`;
  function renderWishlist() {
    if (!S.user) { $('#wishUser').textContent = 'invité'; $('#wishlist').innerHTML = loginCard('Ta liste de souhaits', 'Choisis un profil pour garder les jeux qui te tentent.'); return; }
    const w = S.wishes[S.user] || {}, list = S.games.filter(g => w[g.key]);
    $('#wishUser').textContent = S.user;
    if (list.length) renderGames(list, $('#wishlist'), S.view);
    else $('#wishlist').innerHTML = '<div class="card empty-card"><i class="fa-solid fa-heart ic-rose big"></i><h3>Ta liste est vide</h3><p class="muted">Clique sur le cœur d\'un jeu du catalogue pour le retrouver ici.</p></div>';
  }
  function renderForYou() {
    $('#recUser').textContent = S.user || 'invité';
    if (!S.user) { $('#foryouIntro').textContent = ''; $('#foryou').innerHTML = loginCard('Recommandations personnalisées', 'Choisis un profil et note quelques jeux : les suggestions seront calculées pour toi.'); return; }
    if (!window.Reco) { $('#foryou').innerHTML = '<div class="card empty-card"><h3>Module de recommandations absent</h3><p class="muted">Le fichier reco.js n\'a pas été mis en ligne.</p></div>'; return; }
    const res = Reco.recommend(S.games, S.ratings, S.user);
    $('#foryouIntro').textContent = res.liked ? `Sélection basée sur tes ${res.liked} jeu${res.liked > 1 ? 'x' : ''} noté${res.liked > 1 ? 's' : ''} 4 ou 5 étoiles.` : 'Sélection sur-mesure basée sur tes jeux notés 4 ou 5 étoiles.';
    $('#foryou').innerHTML = res.picks.length ? `<div class="recgrid">${res.picks.map(recCard).join('')}</div>` :
      `<div class="card empty-card"><i class="fa-solid fa-star ic-amber big"></i><h3>${res.rated ? 'Pas encore de coup de cœur' : 'Pas assez de notes'}</h3>
      <p class="muted">${res.rated ? 'Mets 4 ou 5 étoiles aux jeux que tu aimes : les suggestions apparaîtront ici.' : 'Note quelques jeux dans le catalogue pour que l\'algorithme comprenne tes goûts !'}</p></div>`;
  }

  /* ---------- Bandeau « Les jeux du jour » ---------- */
  function renderAffiche() {
    const el = $('#affiche'), a = S.affiche;
    const items = a && a.actif && Array.isArray(a.jeux) ? a.jeux.map(j => ({ g: S.games.find(x => x.key === keyOf(j.title)), msg: j.msg })).filter(x => x.g).slice(0, 4) : [];
    const show = S.tab === 'catalogue' && items.length > 0;
    el.hidden = !show; $('#band').classList.toggle('has-aff', show);
    if (!show) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="aff-wrap"><div class="aff-head"><span class="aff-pill">À l'affiche</span><h2>${esc(a.titre || 'Les jeux du jour !')}</h2>${a.soustitre ? `<span class="aff-sub">${esc(a.soustitre)}</span>` : ''}</div>
      <div class="aff-cards">${items.map(({ g, msg }) => `<article class="aff-card">${cover(g)}<div class="aff-body"><div class="gtitle"><h3>${esc(g.title)}</h3><div class="gact">${wishBtn(g, true)}</div></div>
        <div class="chips">${chipList([['fa-users', '', g.players + ' j.'], ['fa-clock', '', g.duree]])}</div>${msg ? `<p class="aff-msg">« ${esc(msg)} »</p>` : ''}</div></article>`).join('')}</div></div>`;
  }

  /* ---------- Profils, rôles, onglets ---------- */
  function renderProfiles() {
    const opts = S.members.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.admin ? ' (admin)' : ''}</option>`).join('');
    $('#profileSelect').innerHTML = '<option value="__guest__">Invité (lecture seule)</option>' + opts + '<option value="__new__">+ Créer mon profil…</option>';
    $('#profileSelect').value = S.user || '__guest__'; $('#pickSelect').innerHTML = opts;
  }
  function applyRole() {
    $('#adminBadge').hidden = !S.admin;
    $$('[data-admin]').forEach(t => t.hidden = !S.admin);
    if (!S.admin && ['stats', 'admin'].includes(S.tab)) showTab('catalogue');
  }
  function enter(name, admin) { S.chosen = true; S.user = name; S.admin = admin; renderProfiles(); applyRole(); refresh(); }
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
    $('#wishCount').textContent = S.games.filter(wished).length;
    if (S.tab === 'wishlist') renderWishlist();
    if (S.tab === 'catalogue') renderCatalogue();
    if (S.tab === 'foryou') renderForYou();
    if (S.tab === 'stats' && S.admin) Admin.renderStats();
    if (S.tab === 'admin' && S.admin) Admin.renderAffiche();
    renderAffiche();
  }
  function setTheme(t) {
    if (!['dark', 'light', 'cvd'].includes(t)) t = 'light';
    document.documentElement.setAttribute('data-theme', t); $('#themeSelect').value = t; pref.set('ludo_theme', t);
  }
  const askWho = () => { $('#pickDialog').showModal(); };

  async function init() {
    setTheme(pref.get('ludo_theme', 'light'));
    $('#themeSelect').onchange = e => setTheme(e.target.value);
    $$('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    $$('.vbtn').forEach(b => b.onclick = () => { S.view = b.dataset.view; pref.set('ludo_view', S.view); renderCatalogue(); });
    ['search', 'fAmbiance', 'fDuree', 'fNiveau', 'fMode', 'fFormat'].forEach(id => $('#' + id).addEventListener('input', renderCatalogue));
    $('#resetFilters').onclick = () => { $('#search').value = ''; $$('#filterSelects select').forEach(s => s.value = ''); renderCatalogue(); };
    $('#descClose').onclick = () => $('#descDialog').close();
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-open]')) toggleOpen(e.target); });
    $('#filterToggle').onclick = () => { const o = $('#filtersCard').classList.toggle('filters-open'); $('#filterToggle').setAttribute('aria-expanded', o); };
    matchMedia('(max-width:700px)').addEventListener('change', () => refresh());
    $('#pickDialog').addEventListener('cancel', e => { e.preventDefault(); $('#pickDialog').close(); if (!S.chosen) enter('', false); });   // Échap = continuer en invité
    $('#pickGuest').onclick = () => { $('#pickDialog').close(); enter('', false); };

    $('#pickForm').onsubmit = e => { e.preventDefault(); $('#pickDialog').close(); selectProfile($('#pickSelect').value); };
    $('#pickNew').onclick = () => { $('#pickDialog').close(); $('#newName').value = ''; $('#newError').hidden = true; $('#newDialog').showModal(); };
    $('#profileSelect').onchange = e => {
      if (e.target.value === '__guest__') enter('', false);
      else if (e.target.value === '__new__') { $('#newName').value = ''; $('#newError').hidden = true; $('#newDialog').showModal(); }
      else selectProfile(e.target.value);
    };
    const backFromDialog = () => { if (!S.chosen) askWho(); else renderProfiles(); };
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
  window.App = { S, $, esc, apiPost, toast, keyOf, refresh };
  document.addEventListener('DOMContentLoaded', init);
})();
