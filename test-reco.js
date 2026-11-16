'use strict';
// Lancer :  node tests/test-reco.js     (depuis le dossier du site)
const fs = require('fs'), path = require('path'), assert = require('assert');
const Reco = require('../reco.js');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'games.json'), 'utf8'));
const keyOf = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const games = raw.map((g, i) => ({ ...g, key: keyOf(g.title), i }));
const classified = games.filter(Reco.isClassified);

const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const txt = g => [...g.amb, ...g.modes, ...g.formats, g.niveau, g.duree].join(' | ');
const has = (g, s) => txt(g).includes(s) ? 1 : 0;

// Goûts « cachés » : ce que la personne aimerait vraiment (la vérité terrain du test)
const PERSONAS = {
  'Fêtard (Fun, débutant, cartes)': g => 1.3 * has(g, 'Fun') + 0.6 * has(g, 'Débutant') + 0.4 * has(g, 'Cartes') - 0.9 * has(g, 'Stratégie') * (1 - has(g, 'Fun')),
  'Stratège (Stratégie/Réflexion, plateau)': g => 1.3 * Math.max(has(g, 'Stratégie'), has(g, 'Réflexion')) + 0.7 * has(g, 'Intermédiaire') + 0.5 * has(g, 'Plateau') - 0.8 * has(g, 'Fun') * (1 - Math.max(has(g, 'Stratégie'), has(g, 'Réflexion'))),
  'Coopératif': g => 1.8 * has(g, 'Coopératif') + 0.5 * has(g, 'Équipes') - 0.5 * has(g, 'Compétitif') * (1 - has(g, 'Coopératif')),
  'Pressé (parties courtes)': g => 1.4 * has(g, '15–30') + 0.4 * has(g, 'Débutant') - 0.8 * (has(g, '1–2 h') + has(g, '2 h +')),
  'Réflexion + équipes': g => 1.3 * has(g, 'Réflexion') + 0.8 * has(g, 'Équipes') + 0.3 * has(g, 'Cartes')
};
const stars = (taste, r) => Math.max(1, Math.min(5, Math.round(3 + taste + 0.6 * gauss(r))));
const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ----- Ancien algorithme (celui de la version précédente), pour comparaison -----
function legacy(gs, ratings, user, r) {
  const mine = ratings[user] || {}, liked = gs.filter(g => mine[g.key] >= 4), w = {};
  liked.forEach(g => [...g.amb.map(x => 'a:' + x), ...g.modes.map(x => 'm:' + x)].forEach(k => w[k] = (w[k] || 0) + mine[g.key]));
  return gs.filter(g => !mine[g.key]).map(g => ({ g, s: g.amb.reduce((t, x) => t + 2 * (w['a:' + x] || 0), 0) + g.modes.reduce((t, x) => t + (w['m:' + x] || 0), 0) + r() * 3 }))
    .filter(x => liked.length && x.s > 3).sort((a, b) => b.s - a.s).slice(0, 9).map(x => x.g);
}

// ----- Simulation : N membres, chaque persona note k jeux au hasard, puis on évalue les 9 suggestions -----
function simulate(nTrials, nRated, algo) {
  const out = {};
  for (const [name, taste] of Object.entries(PERSONAS)) {
    let prec = 0, empty = 0, hit5 = 0, n = 0, relevantCount = 0;
    for (let t = 0; t < nTrials; t++) {
      const r = rng(1000 * t + name.length * 7 + nRated);
      const ratings = {};
      // communauté : 6 autres membres aux goûts variés, 8 notes chacun
      const others = Object.values(PERSONAS);
      for (let u = 0; u < 6; u++) { const f = others[Math.floor(r() * others.length)]; ratings['autre' + u] = {}; shuffle(classified, r).slice(0, 8).forEach(g => ratings['autre' + u][g.key] = stars(f(g), r)); }
      const me = ratings.moi = {};
      const mineGames = shuffle(classified, r).slice(0, nRated); mineGames.forEach(g => me[g.key] = stars(taste(g), r));
      const rel = classified.filter(g => !me[g.key] && taste(g) >= 1.2); relevantCount += rel.length;
      if (rel.length < 3) continue;
      const recs = algo(games, ratings, 'moi', r); n++;
      if (!recs.length) { empty++; continue; }
      const ok = recs.filter(g => taste(g) >= 1.2).length;
      prec += ok / recs.length; if (recs.slice(0, 5).some(g => taste(g) >= 1.2)) hit5++;
    }
    out[name] = { precision: prec / Math.max(1, n - empty), vide: empty / Math.max(1, n), hit5: hit5 / Math.max(1, n), relevants: relevantCount / Math.max(1, nTrials) };
  }
  return out;
}
const newAlgo = (gs, ratings, user) => Reco.recommend(gs, ratings, user).picks.map(p => p.game);
const popAlgo = (gs, ratings, user) => { const mine = ratings[user] || {}; const m = {}; Object.entries(ratings).forEach(([u, mp]) => { if (u !== user) Object.entries(mp).forEach(([k, s]) => (m[k] = m[k] || []).push(s)); }); return gs.filter(g => !mine[g.key] && m[g.key]).sort((a, b) => avg(m[b.key]) - avg(m[a.key])).slice(0, 9); };
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const randAlgo = (gs, ratings, user, r) => shuffle(classified.filter(g => !(ratings[user] || {})[g.key]), r).slice(0, 9);

function report(nRated) {
  const algos = { 'Ancien': legacy, 'Nouveau': newAlgo, 'Populaires': popAlgo, 'Hasard': randAlgo };
  const res = Object.fromEntries(Object.entries(algos).map(([k, f]) => [k, simulate(200, nRated, f)]));
  console.log(`\n=== ${nRated} jeux notés par membre — précision des 9 suggestions (part de vrais coups de cœur) ===`);
  console.log('Profil'.padEnd(44) + Object.keys(algos).map(k => k.padStart(12)).join('') + '   (liste vide : ancien / nouveau)');
  let tot = Object.fromEntries(Object.keys(algos).map(k => [k, 0]));
  for (const p of Object.keys(PERSONAS)) {
    console.log(p.padEnd(44) + Object.keys(algos).map(k => { tot[k] += res[k][p].precision; return (res[k][p].precision * 100).toFixed(0).padStart(11) + '%'; }).join('') + `   ${(res.Ancien[p].vide * 100).toFixed(0)}% / ${(res.Nouveau[p].vide * 100).toFixed(0)}%`);
  }
  console.log('MOYENNE'.padEnd(44) + Object.keys(algos).map(k => ((tot[k] / Object.keys(PERSONAS).length) * 100).toFixed(0).padStart(11) + '%').join(''));
  return res;
}
if (require.main === module) {
  [4, 8, 14].forEach(report);

  // ----- Cas limites -----
  console.log('\n=== Cas limites ===');
  const ck = n => games[n].key, ok = (name, fn) => { try { fn(); console.log('  OK  ' + name); } catch (e) { console.log('  ÉCHEC ' + name + ' → ' + e.message); process.exitCode = 1; } };
  ok('aucune note → aucune suggestion, pas d\'erreur', () => assert.deepStrictEqual(Reco.recommend(games, {}, 'x').picks, []));
  ok('que des notes basses → pas de suggestion « goût »', () => { const p = Reco.recommend(games, { x: { [ck(0)]: 1, [ck(1)]: 2 } }, 'x').picks; assert(p.every(q => q.kind !== 'taste')); });
  ok('tout noté → aucune erreur', () => { const m = {}; games.forEach(g => m[g.key] = 5); assert.deepStrictEqual(Reco.recommend(games, { x: m }, 'x').picks, []); });
  ok('résultat identique à chaque appel (déterministe)', () => { const r = { x: { [ck(0)]: 5, [ck(1)]: 4 } }; assert.deepStrictEqual(Reco.recommend(games, r, 'x').picks.map(p => p.game.key), Reco.recommend(games, r, 'x').picks.map(p => p.game.key)); });
  ok('jamais un jeu déjà noté, jamais plus de 9, jamais de doublon', () => { const r = { x: Object.fromEntries(classified.slice(0, 10).map(g => [g.key, 5])) }; const p = Reco.recommend(games, r, 'x').picks; assert(p.length <= 9); assert(p.every(q => !r.x[q.game.key])); assert.strictEqual(new Set(p.map(q => q.game.key)).size, p.length); });
  ok('un jeu aimé sans classification ne plante pas', () => { const un = games.find(g => !Reco.isClassified(g)); assert.doesNotThrow(() => Reco.recommend(games, { x: { [un.key]: 5 } }, 'x')); });
  ok('pas plus de 2 variantes d\'une même famille (UNO, 7 Wonders…)', () => { const r = { x: { [games.find(g => /^7 Wonders$/.test(g.title)).key]: 5, [games.find(g => /UNO Flip/.test(g.title)).key]: 5, [games.find(g => /Catane|Skyjo/.test(g.title)).key]: 5 } }; const f = {}; Reco.recommend(games, r, 'x').picks.forEach(p => { const k = p.game.title.split(' ')[0]; f[k] = (f[k] || 0) + 1; }); assert(Object.values(f).every(n => n <= 2), JSON.stringify(f)); });
  ok('« parce que tu as aimé » cite un jeu réellement aimé', () => { const a = classified[0], r = { x: { [a.key]: 5 } }; Reco.recommend(games, r, 'x').picks.filter(p => p.because).forEach(p => assert.strictEqual(p.because, a.title)); });
  ok('le profil d\'un autre membre n\'influence pas le sien (hors bonus communauté)', () => { const base = { x: { [ck(0)]: 5 } }; const a = Reco.recommend(games, base, 'x').picks.filter(p => p.kind === 'taste').map(p => p.game.key); const b = Reco.recommend(games, { ...base, y: {} }, 'x').picks.filter(p => p.kind === 'taste').map(p => p.game.key); assert.deepStrictEqual(a, b); });
}
module.exports = { simulate, report, newAlgo, legacy };
