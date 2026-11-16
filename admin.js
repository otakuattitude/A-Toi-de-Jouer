'use strict';
/* Actions réservées aux admins. La vérification du mot de passe se fait CÔTÉ SERVEUR (Code.gs) :
   le navigateur ne reçoit jamais aucun mot de passe. */
(() => {
  const { S, $, esc, apiPost, toast, keyOf } = App;
  let sessionPw = '';                                      // gardé en mémoire le temps de la session admin, jamais stocké

  async function login(name, pw) {
    try { const ok = (await apiPost({ action: 'login', prenom: name, password: pw })).result === 'success'; if (ok) sessionPw = pw; return ok; }
    catch { toast('Connexion au serveur impossible.'); return false; }
  }

  async function changePassword(oldPwd, newPwd, conf) {
    if (!S.admin) return;
    if (newPwd !== conf) return toast('Les nouveaux mots de passe ne correspondent pas.');
    if (newPwd.length < 6) return toast('6 caractères minimum.');
    try {
      const r = await apiPost({ action: 'updatePassword', username: S.user, oldPassword: oldPwd, newPassword: newPwd });
      if (r.result === 'success') { $('#pwChangeForm').reset(); toast('Mot de passe mis à jour.'); }
      else if (r.result === 'denied') toast('Ancien mot de passe incorrect.');
      else toast('Mise à jour refusée.');
    } catch { toast('Erreur réseau, réessayez.'); }
  }

  function renderStats() {
    if (!S.admin) return;                                  // garde-fou
    const byGame = {}, byAmb = {}, byUser = {}; let total = 0;
    S.members.forEach(m => byUser[m.name] = 0);
    Object.entries(S.ratings).forEach(([u, map]) => Object.entries(map).forEach(([k, s]) => {
      total++; byUser[u] = (byUser[u] || 0) + 1;
      const g = S.games.find(x => x.key === k), t = g ? g.title : k;
      (byGame[t] = byGame[t] || { sum: 0, n: 0 }); byGame[t].sum += s; byGame[t].n++;
      if (g) g.amb.forEach(a => byAmb[a] = (byAmb[a] || 0) + 1);
    }));
    const top = Object.entries(byGame).map(([t, v]) => ({ t, m: v.sum / v.n, n: v.n })).sort((a, b) => b.m - a.m || b.n - a.n).slice(0, 5);
    const wish = {};
    Object.values(S.wishes).forEach(m => Object.keys(m).forEach(k => wish[k] = (wish[k] || 0) + 1));
    const topW = Object.entries(wish).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => { const g = S.games.find(x => x.key === k); return { t: g ? g.title : k, n }; });
    const topAmb = Object.entries(byAmb).sort((a, b) => b[1] - a[1])[0];
    $('#stats').innerHTML = `<div class="card">
      <div class="stathead"><div><h2 class="ic-emerald"><i class="fa-solid fa-chart-pie"></i> Statistiques &amp; Tendances globales de l'Asso</h2>
        <p class="muted">Vue d'ensemble calculée à partir des notes de tous les membres.</p></div><span class="pill-emerald">Admin Only</span></div>
      <div class="two"><div class="inbox"><span class="tiny">Ambiance favorite de l'Asso</span><div class="big ic-purple">${esc(topAmb ? topAmb[0] : 'Aucune tendance')}</div></div>
        <div class="inbox"><span class="tiny">Total des votes enregistrés</span><div class="big ic-emerald">${total} vote(s) au total</div></div></div>
      <h3 class="sub ic-amber"><i class="fa-solid fa-trophy"></i> Le Top 5 des jeux préférés de l'Asso</h3>
      <div class="toplist">${top.length ? top.map((x, i) => `<div class="inbox toprow"><div class="rowl"><span class="rank r${i}">#${i + 1}</span><b>${esc(x.t)}</b></div>
        <div class="rowr"><span class="muted">${x.n} vote(s)</span><span class="pill-amber"><i class="fa-solid fa-star"></i> ${x.m.toFixed(1)} / 5</span></div></div>`).join('') : '<div class="inbox muted">Aucun jeu évalué pour le moment.</div>'}</div>
      <h3 class="sub ic-rose"><i class="fa-solid fa-heart"></i> Les jeux les plus souhaités</h3>
      <div class="toplist">${topW.length ? topW.map(x => `<div class="inbox toprow"><b>${esc(x.t)}</b><span class="pill-amber"><i class="fa-solid fa-heart"></i> ${x.n} souhait(s)</span></div>`).join('') : '<div class="inbox muted">Aucun souhait pour le moment.</div>'}</div>
      <h3 class="sub ic-cyan"><i class="fa-solid fa-users"></i> Implication des membres (votes par joueur)</h3>
      <div class="members">${Object.entries(byUser).map(([u, n]) => `<div class="inbox"><span class="b"><i class="fa-solid fa-user ic-amber"></i> ${esc(u)}</span>
        <div class="mrow"><span class="muted">Jeux notés :</span><b class="ic-emerald">${n}</b></div></div>`).join('')}</div></div>`;
  }

  /* ---------- Bandeau « Les jeux du jour » ---------- */
  const MAX = 4;
  let D = null;                                            // brouillon en cours d'édition
  const initDraft = () => {
    const a = S.affiche || {};
    D = { actif: !!a.actif, titre: a.titre || 'Les jeux du jour !', soustitre: a.soustitre || '',
      jeux: (Array.isArray(a.jeux) ? a.jeux : []).map(j => ({ title: j.title, msg: j.msg || '' })).filter(j => S.games.some(g => g.key === keyOf(j.title))).slice(0, MAX) };
  };
  function renderAffiche() {
    if (!S.admin) return;
    if (!D) initDraft();
    const full = D.jeux.length >= MAX;
    $('#afCard').innerHTML = `<div class="afhead"><div><h2><i class="fa-solid fa-bullhorn"></i> Bandeau « Les jeux du jour »</h2>
      <p class="muted">Choisis jusqu'à ${MAX} jeux du catalogue, ajoute une accroche si tu veux, puis publie quand la soirée commence.</p></div>
      <span class="afstate ${D.actif ? 'on' : ''}">${D.actif ? 'Publié' : 'Non publié'}</span></div>
      <div class="afgrid"><div class="afcol">
        <div class="aflabel"><span>Jeux à l'affiche</span><span class="afcount">${D.jeux.length} / ${MAX}</span></div>
        ${D.jeux.length ? D.jeux.map((j, i) => `<div class="afrow"><span class="afmove"><button type="button" data-af="up" data-i="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button><button type="button" data-af="down" data-i="${i}" aria-label="Descendre" ${i === D.jeux.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button></span>
          <div class="afinfo"><b>${esc(j.title)}</b><input data-af="msg" data-i="${i}" value="${esc(j.msg)}" maxlength="80" placeholder="Accroche (facultatif)" aria-label="Accroche pour ${esc(j.title)}"></div>
          <button type="button" class="afx" data-af="del" data-i="${i}" aria-label="Retirer ${esc(j.title)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') : '<div class="inbox muted">Aucun jeu choisi pour le moment.</div>'}
        <div class="afsearch"><i class="fa-solid fa-search"></i><input id="afQ" type="search" autocomplete="off" ${full ? 'disabled' : ''} placeholder="${full ? 'Maximum atteint : retire un jeu pour en ajouter' : 'Ajouter un jeu du catalogue (ex : Catane)'}" aria-label="Ajouter un jeu"></div>
        <div id="afSug" class="afsug" hidden></div>
      </div><div class="afcol">
        <div class="aflabel"><span>Texte du bandeau</span></div>
        <label for="afTitre">Titre</label><input id="afTitre" maxlength="60" value="${esc(D.titre)}">
        <label for="afSub">Sous-titre (la soirée)</label><input id="afSub" maxlength="60" value="${esc(D.soustitre)}" placeholder="Soirée du 28 novembre">
        <div class="inbox muted afnote">Les membres ne voient rien tant que tu n'as pas publié. Une fois publié, ils voient le bandeau au rechargement de la page.</div>
      </div></div>
      <div class="affoot"><span class="muted">${D.actif ? 'Le bandeau est visible par tous les membres.' : 'Le bandeau est masqué : les membres voient directement le catalogue.'}</span>
        <span class="afbtns">${D.actif ? '<button type="button" class="btn danger" data-af="off">Retirer le bandeau</button>' : ''}<button type="button" class="btn primary" data-af="pub">${D.actif ? 'Mettre à jour' : 'Publier le bandeau'}</button></span></div>`;
  }
  function suggest() {
    const q = keyOf($('#afQ').value), box = $('#afSug');
    const taken = new Set(D.jeux.map(j => keyOf(j.title)));
    const res = q ? S.games.filter(g => g.key.includes(q) && !taken.has(g.key)).slice(0, 6) : [];
    box.hidden = !q;
    box.innerHTML = res.length ? res.map(g => `<div class="afhit"><span><b>${esc(g.title)}</b><small>${esc(g.amb.join(' / '))}</small></span><button type="button" class="btn blue" data-af="add" data-k="${esc(g.key)}"><i class="fa-solid fa-plus"></i> Ajouter</button></div>`).join('') : '<div class="afhit muted">Aucun jeu trouvé.</div>';
  }
  async function saveAffiche(actif) {
    if (!S.admin || !sessionPw) return toast('Reconnecte-toi en admin pour publier.');
    if (actif && !D.jeux.length) return toast('Choisis au moins un jeu.');
    try {
      const r = await apiPost({ action: 'setAffiche', username: S.user, password: sessionPw, actif, titre: D.titre, soustitre: D.soustitre, jeux: D.jeux });
      if (r.result === 'success') {
        D.actif = actif; S.affiche = { actif, titre: D.titre.trim() || 'Les jeux du jour !', soustitre: D.soustitre.trim(), jeux: D.jeux.map(j => ({ ...j })) };
        toast(actif ? 'Bandeau publié.' : 'Bandeau retiré.'); renderAffiche(); App.refresh && App.refresh();
      } else if (r.result === 'denied') toast('Accès refusé : reconnecte-toi en admin.');
      else if (r.result === 'empty') toast('Choisis au moins un jeu.');
      else toast("Échec : redéploie le script Google (Nouvelle version).");
    } catch { toast('Erreur réseau, réessayez.'); }
  }
  function afClick(e) {
    const b = e.target.closest('[data-af]'); if (!b || b.tagName !== 'BUTTON') return;
    const a = b.dataset.af, i = +b.dataset.i;
    if (a === 'up' && i > 0) [D.jeux[i - 1], D.jeux[i]] = [D.jeux[i], D.jeux[i - 1]];
    else if (a === 'down' && i < D.jeux.length - 1) [D.jeux[i + 1], D.jeux[i]] = [D.jeux[i], D.jeux[i + 1]];
    else if (a === 'del') D.jeux.splice(i, 1);
    else if (a === 'add') { const g = S.games.find(x => x.key === b.dataset.k); if (g && D.jeux.length < MAX) D.jeux.push({ title: g.title, msg: '' }); }
    else if (a === 'pub') return saveAffiche(true);
    else if (a === 'off') return saveAffiche(false);
    renderAffiche();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const c = $('#afCard');
    c.addEventListener('click', afClick);
    c.addEventListener('input', e => {
      if (e.target.id === 'afQ') return suggest();
      if (e.target.id === 'afTitre') D.titre = e.target.value;
      else if (e.target.id === 'afSub') D.soustitre = e.target.value;
      else if (e.target.dataset.af === 'msg') D.jeux[+e.target.dataset.i].msg = e.target.value;
    });
    $('#pwChangeForm').onsubmit = e => { e.preventDefault(); changePassword($('#oldPwd').value, $('#newPwd').value, $('#confPwd').value); };
  });
  window.Admin = { login, changePassword, renderStats, renderAffiche };
})();
