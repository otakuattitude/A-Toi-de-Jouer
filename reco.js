'use strict';
/* Moteur de recommandations « Pour moi » — fonction pure, testable sous Node (voir tests/test-reco.js).
   Principe : chaque note centre le goût autour de 3 (5★ = +2, 4★ = +1, 3★ = 0, 2★ = −1, 1★ = −2). On calcule une « affinité »
   pour chaque caractéristique (ambiance, mode, format, niveau, durée), lissée pour qu'une seule note ne fixe pas un goût, puis on note
   chaque jeu non encore noté. S'y ajoute un léger bonus selon l'avis des autres membres. Aucun hasard : même profil, même résultat. */
(function (root) {
  const W = { amb: 3, mode: 1.5, format: 1, niveau: 1, duree: 1 };      // poids de chaque type de caractéristique
  const CFG = { shrink: 1, minScore: 0.5, max: 9, perFamily: 2, perAmb: 6, commWeight: 0.5, popMin: 0.6 };
  const STOP = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'the']);
  const split = v => String(v ?? '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
  const groups = g => ({ amb: g.amb.flatMap(split), mode: g.modes.flatMap(split), format: g.formats.flatMap(split),
    niveau: g.niveau ? [g.niveau] : [], duree: g.duree && g.duree !== '—' ? [g.duree] : [] });
  const isClassified = g => { const f = groups(g); return !!(f.amb.length || f.mode.length || f.format.length); };
  const family = g => { const t = String(g.title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean); return t.find(x => !STOP.has(x)) || t[0] || ''; };

  function community(ratings, user) {
    const m = {};
    Object.entries(ratings).forEach(([u, map]) => { if (u === user) return; Object.entries(map).forEach(([k, s]) => { if (s > 0) { const c = m[k] = m[k] || { sum: 0, n: 0 }; c.sum += s; c.n++; } }); });
    return m;
  }
  const commScore = c => c ? (c.sum + 6) / (c.n + 2) - 3 : 0;            // moyenne lissée vers 3, centrée

  function recommend(games, ratings, user, opts) {
    const cfg = Object.assign({}, CFG, opts), mine = ratings[user] || {};
    const rated = games.filter(g => mine[g.key] > 0), liked = rated.filter(g => mine[g.key] >= 4), comm = community(ratings, user);
    const aff = {};
    rated.forEach(g => Object.entries(groups(g)).forEach(([grp, vals]) => vals.forEach(v => {
      const a = aff[grp + ':' + v] = aff[grp + ':' + v] || { s: 0, n: 0 }; a.s += mine[g.key] - 3; a.n++; })));
    const A = k => aff[k] ? aff[k].s / (aff[k].n + cfg.shrink) : 0;
    const because = g => {                                                // le jeu aimé qui ressemble le plus à celui-ci
      const fg = groups(g); let best = null, bs = 0;
      liked.forEach(l => { const fl = groups(l); let o = 0; Object.keys(W).forEach(k => o += W[k] * fg[k].filter(v => fl[k].includes(v)).length); o *= mine[l.key] - 3; if (o > bs) { bs = o; best = l; } });
      return best;
    };
    let picks = [];
    if (liked.length) {
      const cands = games.filter(g => !mine[g.key] && isClassified(g)).map(g => {
        const f = groups(g); let s = 0;
        Object.keys(W).forEach(k => { if (f[k].length) s += W[k] * f[k].reduce((t, v) => t + A(k + ':' + v), 0) / f[k].length; });
        s += cfg.commWeight * commScore(comm[g.key]);
        return { game: g, score: s };
      }).filter(x => x.score >= cfg.minScore).sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title, 'fr'));
      const fam = {}, amb = {};                                           // diversité : pas 5 variantes du même jeu ni 9 jeux de la même ambiance
      for (const x of cands) {
        if (picks.length >= cfg.max) break;
        const fk = family(x.game), ak = groups(x.game).amb[0] || '';
        if ((fam[fk] || 0) >= cfg.perFamily || (ak && (amb[ak] || 0) >= cfg.perAmb)) continue;
        fam[fk] = (fam[fk] || 0) + 1; amb[ak] = (amb[ak] || 0) + 1;
        const b = because(x.game); picks.push({ game: x.game, score: x.score, kind: 'taste', because: b ? b.title : null });
      }
    }
    if (picks.length < cfg.max) {                                         // complément : les plus appréciés des autres membres
      const have = new Set(picks.map(p => p.game.key));
      games.filter(g => !mine[g.key] && !have.has(g.key) && comm[g.key] && commScore(comm[g.key]) >= cfg.popMin)
        .sort((a, b) => commScore(comm[b.key]) - commScore(comm[a.key]) || a.title.localeCompare(b.title, 'fr'))
        .slice(0, cfg.max - picks.length)
        .forEach(g => picks.push({ game: g, score: commScore(comm[g.key]), kind: 'popular', because: null, avg: (comm[g.key].sum / comm[g.key].n), n: comm[g.key].n }));
    }
    return { picks, liked: liked.length, rated: rated.length };
  }
  const api = { recommend, groups, isClassified, CFG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Reco = api;
})(typeof window !== 'undefined' ? window : globalThis);
