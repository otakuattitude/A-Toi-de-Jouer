'use strict';
/* Actions réservées aux admins. La vérification du mot de passe se fait CÔTÉ SERVEUR (Code.gs) :
   le navigateur ne reçoit jamais aucun mot de passe. */
(() => {
  const { S, $, esc, apiPost, toast } = App;

  async function login(name, pw) {
    try { return (await apiPost({ action: 'login', prenom: name, password: pw })).result === 'success'; }
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
        <div class="rowr"><span class="muted">${x.n} vote(s)</span><span class="pill-amber">⭐ ${x.m.toFixed(1)} / 5</span></div></div>`).join('') : '<div class="inbox muted">Aucun jeu évalué pour le moment.</div>'}</div>
      <h3 class="sub ic-rose"><i class="fa-solid fa-heart"></i> Les jeux les plus souhaités</h3>
      <div class="toplist">${topW.length ? topW.map(x => `<div class="inbox toprow"><b>${esc(x.t)}</b><span class="pill-amber">❤ ${x.n} souhait(s)</span></div>`).join('') : '<div class="inbox muted">Aucun souhait pour le moment.</div>'}</div>
      <h3 class="sub ic-cyan"><i class="fa-solid fa-users"></i> Implication des membres (votes par joueur)</h3>
      <div class="members">${Object.entries(byUser).map(([u, n]) => `<div class="inbox"><span class="b"><i class="fa-solid fa-user ic-amber"></i> ${esc(u)}</span>
        <div class="mrow"><span class="muted">Jeux notés :</span><b class="ic-emerald">${n}</b></div></div>`).join('')}</div></div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#pwChangeForm').onsubmit = e => { e.preventDefault(); changePassword($('#oldPwd').value, $('#newPwd').value, $('#confPwd').value); };
  });
  window.Admin = { login, changePassword, renderStats };
})();
