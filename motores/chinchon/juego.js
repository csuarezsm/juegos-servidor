'use strict';
/* =====================================================================
   Chinchón · Jugar contra la máquina
   Motor de juego, rivales y mesa. Se apoya en el marcador de index.html:
   cada mano terminada se anota como una mano normal (totales, eliminados,
   reenganches, historial y ranking funcionan igual).
   © 2026 IT Canarias
   ===================================================================== */

/* ---------- Cartas ---------- */
const SUITS = ['o', 'c', 'e', 'b'];
const SUIT_NAME = { o: 'oros', c: 'copas', e: 'espadas', b: 'bastos' };
const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];             // baraja de 40
const RANK_IDX = Object.fromEntries(RANKS.map((r, i) => [r, i])); // 7 y sota son seguidas
const RANK_LABEL = r => ({ 10: 'S', 11: 'C', 12: 'R' })[r] || String(r);
const RANK_NAME = r => ({ 1: 'as', 10: 'sota', 11: 'caballo', 12: 'rey' })[r] || String(r);
const CLOSE_MAX = 5;                                          // se cierra con 5 o menos sin ligar
const BOTS = ['Paco', 'Lola', 'Manolo'];
const CARD_SIZES = [['1', 'normales'], ['1.25', 'grandes'], ['1.5', 'muy grandes']];
const BOT_IDEAS = ['Pancho', 'Chano', 'Candelaria', 'Tomasa', 'Juanillo', 'Nieves', 'Pepito', 'Carmela', 'Domingo', 'Fefa', 'Agustín', 'Chona', 'Ramón', 'Pino', 'Chicho', 'Luci'];

// Comodines: ids 'j1' y 'j2'. Sustituyen a cualquier carta; cada combinación necesita al menos 2 cartas de verdad.
let JOKER_VALUE = 0;                                           // lo que vale un comodín sin ligar (0: no suma y se puede cerrar con él)
const isJoker = id => id[0] === 'j';
const card = id => isJoker(id) ? { id, s: 'j', r: 0, joker: true } : { id, s: id[0], r: Number(id.slice(1)) };
const cardValue = c => (c.joker ? JOKER_VALUE : c.r <= 7 ? c.r : 10);
const cardName = c => (c.joker ? 'comodín' : RANK_NAME(c.r) + ' de ' + SUIT_NAME[c.s]);
function usePlayRules(g) { JOKER_VALUE = g && g.play && Number.isFinite(+g.play.jokerValue) ? +g.play.jokerValue : 0; }
const theCard = c => (c.r === 10 ? 'la ' : 'el ') + cardName(c);   // «la sota», «el rey»
function newDeck(jokers) {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(s + r);
  for (let j = 1; j <= (jokers || 0); j++) d.push('j' + j);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/* ---------- Mejor forma de ligar una mano ----------
   Devuelve { melds: [[ids]], loose: [ids], dead: puntos sin ligar }.
   Grupos: 3 o 4 del mismo número. Escaleras: 3 o más seguidas del mismo palo. */
function bestMelds(ids) {
  const jokers = ids.filter(isJoker), reals = ids.filter(x => !isJoker(x));
  const cs = reals.map(card), n = cs.length, J = jokers.length;
  const cands = [];                                            // { mask: cartas de verdad, k: comodines que usa }
  const subsets = (arr, min) => { const out = []; for (let m = 1; m < (1 << arr.length); m++) { const pick = arr.filter((_, b) => m & (1 << b)); if (pick.length >= min) out.push(pick); } return out; };
  // grupos: mismo número, 3 o 4 en total
  const byRank = {};
  cs.forEach((c, i) => (byRank[c.r] = byRank[c.r] || []).push(i));
  for (const r in byRank) for (const pick of subsets(byRank[r], 2)) {
    const mask = pick.reduce((m, i) => m | (1 << i), 0);
    for (let k = 0; k <= J; k++) if (pick.length + k >= 3 && pick.length + k <= 4) cands.push({ mask, k });
  }
  // escaleras: mismo palo, posiciones seguidas; los huecos los tapan comodines
  for (const s of SUITS) {
    const inSuit = cs.map((c, i) => [c, i]).filter(([c]) => c.s === s);
    for (let a = 0; a < RANKS.length; a++) for (let b = a + 2; b < RANKS.length; b++) {
      const win = inSuit.filter(([c]) => RANK_IDX[c.r] >= a && RANK_IDX[c.r] <= b).map(([, i]) => i);
      for (const pick of subsets(win, 2)) {
        const k = (b - a + 1) - pick.length;
        if (k > J) continue;
        // los extremos del tramo tienen que ser cartas de verdad o comodines: vale cualquiera, pero evitamos duplicados triviales exigiendo carta real en un extremo
        const idxs = pick.map(i => RANK_IDX[cs[i].r]);
        if (!idxs.includes(a) && !idxs.includes(b)) continue;
        cands.push({ mask: pick.reduce((m, i) => m | (1 << i), 0), k });
      }
    }
  }
  const memo = new Map();
  const solve = (mask, jl) => {
    if (!mask) return { dead: jl * JOKER_VALUE, used: [] };
    const key = mask * 8 + jl;
    if (memo.has(key)) return memo.get(key);
    const i = 31 - Math.clz32(mask & -mask), bit = 1 << i;
    let best = solve(mask & ~bit, jl); best = { dead: best.dead + cardValue(cs[i]), used: best.used };
    for (const m of cands) if ((m.mask & bit) && (m.mask & mask) === m.mask && m.k <= jl) {
      const r = solve(mask & ~m.mask, jl - m.k);
      if (r.dead < best.dead) best = { dead: r.dead, used: [m, ...r.used] };
    }
    memo.set(key, best);
    return best;
  };
  const res = solve((1 << n) - 1, J);
  const inMeld = res.used.reduce((a, m) => a | m.mask, 0);
  let jk = 0;
  const melds = res.used.map(m => [...cs.filter((_, i) => m.mask & (1 << i)).map(c => c.id), ...jokers.slice(jk, (jk += m.k))]);
  return { melds, loose: [...cs.filter((_, i) => !(inMeld & (1 << i))).map(c => c.id), ...jokers.slice(jk)], dead: res.dead };
}
// ¿Las 7 cartas son una escalera de 7 del mismo palo?
function isChinchon(ids) {
  if (ids.length !== 7 || ids.some(isJoker)) return false;     // el chinchón es sin comodín
  const cs = ids.map(card);
  if (!cs.every(c => c.s === cs[0].s)) return false;
  const ix = cs.map(c => RANK_IDX[c.r]).sort((a, b) => a - b);
  return ix.every((v, i) => !i || v === ix[i - 1] + 1);
}
// Con 8 cartas: qué tirar para quedarse con lo mejor
function bestDiscard(ids) {
  let best = null;
  for (const d of ids) {
    const rest = ids.filter(x => x !== d), bm = bestMelds(rest);
    const sc = bm.dead * 100 - cardValue(card(d)) + (isChinchon(rest) ? -10000 : 0) + (isJoker(d) ? 99 : 0);
    if (!best || sc < best.sc) best = { discard: d, rest, bm, sc };
  }
  return best;
}

/* ---------- Estado de la mano ----------
   g.play.hand = { order:[pid], hands:{pid:[ids]}, deck:[ids], discard:[ids], turn:pid, phase:'draw'|'discard'|'over',
                   turns, log, result } */
const isBot = (g, pid) => g.play.bots.includes(pid);
function dealHand(g) {
  const R = compute(g);
  const order = []; let i = g.players.findIndex(p => p.id === R.lead);
  for (let k = 0; k < g.players.length; k++) { const p = g.players[(i + k) % g.players.length]; if (!R.st[p.id].out) order.push(p.id); }
  usePlayRules(g);
  const deck = newDeck(g.play.jokers), hands = {};
  order.forEach(pid => (hands[pid] = deck.splice(0, 7)));
  g.play.hand = { dealer: R.next, order, hands, deck, discard: [deck.shift()], gone: [], took: {}, turn: order[0], phase: 'draw', turns: 0, log: pname(g, R.next) + ' ha repartido. Sale ' + pname(g, order[0]) + '.', result: null };
}
function drawFrom(h, src, pid) {
  h.gone = h.gone || []; h.took = h.took || {};
  if (h.gone.length === 0 && h.discard.length) h.gone.push(...h.discard);
  if (src === 'discard' && h.discard.length) { const c = h.discard.pop(); (h.took[pid] = h.took[pid] || []).push(c); return c; }
  if (!h.deck.length) { const top = h.discard.pop(); h.deck = h.discard.sort(() => Math.random() - .5); h.discard = [top]; h.gone = [top]; }
  return h.deck.shift();
}
// Vuelta actual (1 = la primera, en la que todos juegan una vez) y si ya se puede cerrar
const roundOf = h => Math.floor(h.turns / h.order.length) + 1;
const closeFrom = g => g.play.closeFrom || 2;
const canCloseNow = g => roundOf(g.play.hand) >= closeFrom(g);
function nextTurn(h) {
  const i = h.order.indexOf(h.turn);
  h.turn = h.order[(i + 1) % h.order.length]; h.phase = 'draw'; h.turns++;
}
// Termina la mano: puntos de cada uno y se anota en el marcador
function closeHand(g, closer, discardId) {
  usePlayRules(g);
  const h = g.play.hand, c = g.cfg;
  const scores = {}, detail = {};
  let kind = 'normal';
  for (const pid of h.order) {
    const bm = bestMelds(h.hands[pid]);
    detail[pid] = bm;
    scores[pid] = bm.dead;
  }
  if (closer) {
    if (isChinchon(h.hands[closer])) { kind = 'chinchon'; scores[closer] = c.chinchon === 'win' ? 0 : c.chinchonPts; }
    else if (detail[closer].loose.length === 0) { kind = 'bonus'; scores[closer] = c.closeBonus; }   // −10 solo con las 7 ligadas (un comodín suelto no cuenta como ligado)
  }
  if (discardId) h.discard.push(discardId);
  h.phase = 'over';
  h.result = { closer, kind, scores, detail, round: roundOf(h) };
  g.events.push({ t: 'hand', dealer: h.dealer, closer: closer || null, kind: closer ? kind : 'normal', scores, at: Date.now() });
}

/* ---------- La máquina ---------- */
/* ---------- Nivel difícil ----------
   Recuerda lo que ha salido, valora qué cartas sueltas aún pueden ligarse,
   evita dar al siguiente lo que está buscando y elige cuándo cerrar. */
const HARD = { hope: 0.05, wait: false, dangerW: 0.3, drawGain: 99, closeAt: 5 };   // ajustado con 2.000 partidas simuladas   // ajustes del nivel difícil
function outsFor(id, rest, known) {
  const c = card(id); if (c.joker) return 6;
  let o = 0;
  const same = SUITS.filter(s => s !== c.s).map(s => s + c.r);
  const free = same.filter(x => !known.has(x)).length, pair = same.some(x => rest.includes(x));
  o += pair ? free : free * 0.4;
  const i = RANK_IDX[c.r];
  for (const d of [-2, -1, 1, 2]) {
    const j = i + d; if (j < 0 || j >= RANKS.length) continue;
    const nb = c.s + RANKS[j]; if (known.has(nb)) continue;
    const near = rest.some(x => x !== id && !isJoker(x) && card(x).s === c.s && Math.abs(RANK_IDX[card(x).r] - i) <= 2);
    o += (Math.abs(d) === 1 ? 1 : 0.5) * (near ? 1 : 0.5);
  }
  return o;
}
function hardEval(rest, known) {
  const bm = bestMelds(rest);
  let hope = 0;
  for (const id of bm.loose) hope += cardValue(card(id)) * Math.min(1, outsFor(id, rest, known) / 3);
  return { bm, val: bm.dead - HARD.hope * hope };
}
function danger(h, d, pid) {
  if (isJoker(d)) return 99;
  const i = h.order.indexOf(pid), next = h.order[(i + 1) % h.order.length], c = card(d);
  let x = 0;
  for (const t of (h.took && h.took[next]) || []) {
    if (isJoker(t)) continue;
    const tc = card(t);
    if (tc.r === c.r) x += 6; else if (tc.s === c.s && Math.abs(RANK_IDX[tc.r] - RANK_IDX[c.r]) <= 2) x += 4;
  }
  return x;
}
function hardDiscard(h, hand, pid) {
  const known = new Set([...hand, ...(h.gone || [])]);
  let best = null;
  for (const d of hand) {
    const rest = hand.filter(x => x !== d), ev = hardEval(rest, known);
    const sc = ev.val + danger(h, d, pid) * HARD.dangerW + (isChinchon(rest) ? -1000 : 0) - cardValue(card(d)) * 0.01;
    if (!best || sc < best.sc) best = { discard: d, rest, bm: ev.bm, sc };
  }
  return best;
}
function hardWantsClose(g, h, pid, bd) {
  const R = compute(g), lim = g.cfg.limit;
  if (bd.bm.dead === 0) return true;                                   // −10 o chinchón
  if (bd.bm.dead <= HARD.closeAt || roundOf(h) >= 4 || h.deck.length < 6) return true;
  if (h.order.some(o => o !== pid && R.st[o].total >= lim - 20)) return true;   // alguien está a punto de pasarse
  if (R.st[pid].total >= lim - 25) return true;                        // protegerse
  const loose = bd.bm.loose, known = new Set([...h.hands[pid], ...(h.gone || [])]);
  if (HARD.wait && loose.length === 1 && outsFor(loose[0], bd.rest, known) >= 2) return false;   // esperar al −10
  return true;
}

function botStep(g) {
  usePlayRules(g);
  if (g.play.level === 'dificil') return hardStep(g);
  const h = g.play.hand, pid = h.turn, easy = g.play.level === 'facil';
  const hand = h.hands[pid];
  if (h.phase === 'draw') {
    const top = h.discard[h.discard.length - 1];
    let src = 'deck';
    if (top) {
      const now = bestMelds(hand).dead, withTop = bestDiscard([...hand, top]);
      if (withTop.discard !== top && withTop.bm.dead < now - (easy ? 3 : 0)) src = 'discard';
    }
    const got = drawFrom(h, src, pid);
    hand.push(got);
    h.phase = 'discard';
    h.log = pname(g, pid) + (src === 'discard' ? ' coge ' + theCard(card(got)) + ' del descarte.' : ' roba del mazo.');
    return;
  }
  let best = bestDiscard(hand);
  if (easy && Math.random() < .25) {
    const loose = bestMelds(hand).loose; if (loose.length) { const d = loose[Math.floor(Math.random() * loose.length)]; const rest = hand.filter(x => x !== d); best = { discard: d, rest, bm: bestMelds(rest) }; }
  }
  const canClose = best.bm.dead <= CLOSE_MAX && canCloseNow(g);
  const wantClose = canClose && (easy ? best.bm.dead <= 2 || h.turns > 40 : true);
  h.hands[pid] = best.rest;
  if (wantClose) { closeHand(g, pid, best.discard); h.log = pname(g, pid) + ' cierra' + (g.play.hand.result.kind === 'chinchon' ? ' ¡con CHINCHÓN!' : g.play.hand.result.kind === 'bonus' ? ' con todo ligado.' : '.'); return; }
  h.discard.push(best.discard); (h.gone = h.gone || []).push(best.discard);
  h.log += ' Tira ' + theCard(card(best.discard)) + '.';
  nextTurn(h);
  if (h.turns > 400) closeHand(g, null, null);                // por seguridad: nadie cierra
}
function hardStep(g) {
  const h = g.play.hand, pid = h.turn, hand = h.hands[pid];
  if (h.phase === 'draw') {
    const top = h.discard[h.discard.length - 1];
    let src = 'deck';
    if (top) {
      const known = new Set([...hand, ...(h.gone || [])]);
      const now = hardEval(hand, known), wt = hardDiscard(h, [...hand, top], pid);
      if (wt.discard !== top && (wt.bm.dead < now.bm.dead || wt.sc < now.val - HARD.drawGain)) src = 'discard';
    }
    const got = drawFrom(h, src, pid);
    hand.push(got); h.phase = 'discard';
    h.log = pname(g, pid) + (src === 'discard' ? ' coge ' + theCard(card(got)) + ' del descarte.' : ' roba del mazo.');
    return;
  }
  const bd = bestDiscard(hand);
  if (bd.bm.dead <= CLOSE_MAX && canCloseNow(g) && hardWantsClose(g, h, pid, bd)) {
    h.hands[pid] = bd.rest; closeHand(g, pid, bd.discard);
    h.log = pname(g, pid) + ' cierra' + (h.result.kind === 'chinchon' ? ' ¡con CHINCHÓN!' : h.result.kind === 'bonus' ? ' con todo ligado.' : '.');
    return;
  }
  const best = hardDiscard(h, hand, pid);
  h.hands[pid] = best.rest; h.discard.push(best.discard); (h.gone = h.gone || []).push(best.discard);
  h.log += ' Tira ' + theCard(card(best.discard)) + '.';
  nextTurn(h);
  if (h.turns > 400) closeHand(g, null, null);
}
// Juega sin pausas hasta que le toque a la persona o termine la mano
function runBotsInstant(g) { let k = 0; while (g.play.hand && g.play.hand.phase !== 'over' && isBot(g, g.play.hand.turn) && k++ < 2000) botStep(g); }

/* ---------- Dibujo de cartas ---------- */
const SUIT_SVG = {
  o: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#e0a419" stroke="#8a6500" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#8a6500" stroke-width="1.4"/></svg>',
  c: '<svg viewBox="0 0 24 24"><path d="M5 3h14l-1.5 7.5A5.6 5.6 0 0 1 12 15a5.6 5.6 0 0 1-5.5-4.5z" fill="#c0392b"/><path d="M11 14.5h2v4h3.5V21h-9v-2.5H11z" fill="#c0392b"/></svg>',
  e: '<svg viewBox="0 0 24 24"><path d="M12 1.5l2 3.2V15h-4V4.7z" fill="#2a5aa8"/><path d="M6.5 15h11v2.2h-11z" fill="#1d3f78"/><path d="M11 17.2h2V22h-2z" fill="#1d3f78"/></svg>',
  b: '<svg viewBox="0 0 24 24"><path d="M9.2 4.2a3 3 0 0 1 5.6 0l.4 2.6L13.6 22h-3.2L8.8 6.8z" fill="#3b8b3f"/><circle cx="10" cy="9" r="1" fill="#1f5c22"/><circle cx="13.6" cy="12.5" r="1" fill="#1f5c22"/></svg>'
};
const MELD_COLORS = ['#2e9e62', '#2a73c2', '#8e44ad', '#d35400'];
function cardHtml(id, opts) {
  opts = opts || {};
  if (!id) return '<div class="pc-card empty"></div>';
  const c = card(id), tag = opts.data ? 'button' : 'div';   // solo las cartas de tu mano son botones
  if (c.joker) return `<${tag} class="pc-card joker ${opts.sel ? 'sel' : ''} ${opts.tip ? 'tip' : ''} ${opts.small ? 'small' : ''}" ${opts.data || ''} aria-label="comodín" style="${opts.meld != null ? '--mc:' + MELD_COLORS[opts.meld % MELD_COLORS.length] : ''}">
    <b class="pc-r pc-j">★</b><span class="pc-s"><svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3 6.2 19.8l1.6-6.6L2.6 8.8l6.8-.5z" fill="#7d3c98"/></svg></span>${opts.meld != null ? '<i class="pc-m"></i>' : ''}${opts.isNew ? '<em class="pc-new" title="Carta nueva">nueva</em>' : ''}</${tag}>`;
  return `<${tag} class="pc-card ${opts.sel ? 'sel' : ''} ${opts.tip ? 'tip' : ''} ${opts.isNew ? 'fresh' : ''} ${opts.small ? 'small' : ''}" ${opts.data || ''} aria-label="${cardName(c)}" style="${opts.meld != null ? '--mc:' + MELD_COLORS[opts.meld % MELD_COLORS.length] : ''}">
    <b class="pc-r pc-${c.s}">${RANK_LABEL(c.r)}</b><span class="pc-s">${SUIT_SVG[c.s]}</span>${opts.meld != null ? '<i class="pc-m"></i>' : ''}${opts.isNew ? '<em class="pc-new" title="Carta nueva">nueva</em>' : ''}</${tag}>`;
}
function backHtml(n) { return `<div class="pc-card back"><span>${n != null ? n : ''}</span></div>`; }
// Ordena la mano: primero lo ligado (por combinación) y luego lo suelto
function arrangeHand(ids) {
  const bm = bestMelds(ids), meldOf = {};
  bm.melds.forEach((m, i) => m.forEach(id => (meldOf[id] = i)));
  const key = id => { const c = card(id); return (meldOf[id] != null ? meldOf[id] * 1000 : 9000) + (c.joker ? 900 : SUITS.indexOf(c.s) * 20 + RANK_IDX[c.r]); };
  return { ids: ids.slice().sort((a, b) => key(a) - key(b)), meldOf, bm };
}

/* ---------- Mesa ---------- */
let playTimer = null, playSel = null;
function me(g) { return g.players.find(p => !isBot(g, p.id)).id; }
function renderTable(g, R) {
  usePlayRules(g);
  clearTimeout(playTimer);
  if (!g.play.hand) { dealHand(g); save(); }
  const h = g.play.hand, my = me(g), myOut = !h.order.includes(my);
  $('#subtitle').textContent = 'Mano ' + (R.hand + 1) + ' · contra la máquina';
  const top = h.discard[h.discard.length - 1];
  const myTurn = h.turn === my && h.phase !== 'over';
  const arr = h.hands[my] ? arrangeHand(h.hands[my]) : null;
  let selDead = null;
  if (arr && myTurn && h.phase === 'discard' && playSel && h.hands[my].includes(playSel)) selDead = bestMelds(h.hands[my].filter(x => x !== playSel));
  const canClose = selDead && selDead.dead <= CLOSE_MAX && canCloseNow(g);
  const opp = g.players.filter(p => h.order.includes(p.id) && p.id !== my);
  // Modo aprendizaje: solo si está activado, la app sugiere jugadas
  const learn = !!g.play.learn;
  let tip = null;                                              // { draw: 'deck'|'discard' } o { discard: id, close: bool, dead }
  if (learn && myTurn && h.phase === 'draw') {
    const now = bestMelds(h.hands[my]).dead, wt = top ? bestDiscard([...h.hands[my], top]) : null;
    tip = { draw: wt && wt.discard !== top && wt.bm.dead < now ? 'discard' : 'deck', gain: wt ? now - wt.bm.dead : 0 };
  } else if (learn && myTurn && h.phase === 'discard') {
    const bd = bestDiscard(h.hands[my]);
    tip = { discard: bd.discard, dead: bd.bm.dead, close: bd.bm.dead <= CLOSE_MAX && canCloseNow(g), early: bd.bm.dead <= CLOSE_MAX && !canCloseNow(g) };
  }
  let hint = '';
  if (myOut) hint = 'Estás eliminado en esta partida.';
  else if (!myTurn) hint = h.phase === 'over' ? '' : 'Juega ' + pname(g, h.turn) + '…';
  else if (h.phase === 'draw') hint = tip
    ? (tip.draw === 'discard' ? `💡 Coge <b>${theCard(card(top))}</b> del descarte: te liga ${tip.gain} punto${tip.gain === 1 ? '' : 's'}.` : `💡 Roba del <b>mazo</b>: ${top ? theCard(card(top)) : 'el descarte'} no te liga nada.`)
    : 'Tu turno: roba del <b>mazo</b> o coge la carta del <b>descarte</b>.';
  else if (tip) hint = tip.close
    ? `💡 Puedes <b>cerrar</b> tirando <b>${theCard(card(tip.discard))}</b> (te quedan ${tip.dead}).`
    : tip.early ? `💡 Tira <b>${theCard(card(tip.discard))}</b>. Te quedarían ${tip.dead}, pero aún no se puede cerrar (desde la ${closeFrom(g)}ª vuelta).`
    : `💡 Tira <b>${theCard(card(tip.discard))}</b>. Te quedarían ${tip.dead} sin ligar; para cerrar hacen falta ${CLOSE_MAX} o menos.`;
  else hint = playSel ? (canClose ? 'Puedes <b>tirar</b> esta carta o <b>cerrar</b> la mano.' : 'Toca <b>Tirar</b> para descartar esta carta.') : 'Elige la carta que quieres tirar.';
  const cs = CARD_SIZES.find(x => x[0] === String(S.cardScale || '1')) || CARD_SIZES[0];
  $('#app').innerHTML = `<div class="pt-table" style="--cs:${cs[0]}"><div class="pt-l">
    <div class="pt-opps">${opp.map(p => `<div class="pt-opp ${h.turn === p.id && h.phase !== 'over' ? 'turn' : ''}">
        <div class="pt-on">${esc(p.name)}</div><div class="pt-ot">${R.st[p.id].total} pts</div>
        <div class="pt-ob">${'<i></i>'.repeat(Math.min(8, (h.hands[p.id] || []).length))}</div></div>`).join('')}</div>
    <div class="pt-mid">
      <div class="pt-pile"><button class="pt-btn ${tip && tip.draw === 'deck' ? 'tip' : ''}" id="pDeck" ${myTurn && h.phase === 'draw' ? '' : 'disabled'}>${backHtml(h.deck.length)}</button><small>Mazo</small></div>
      <div class="pt-pile"><button class="pt-btn ${tip && tip.draw === 'discard' ? 'tip' : ''}" id="pDisc" ${myTurn && h.phase === 'draw' && top ? '' : 'disabled'}>${top ? cardHtml(top) : cardHtml(null)}</button><small>Descarte</small></div>
    </div>
    <div class="pt-log">${esc(h.log || '')}</div></div><div class="pt-r">
    <div class="pt-hint">${hint}</div>
    ${arr ? `<div class="pt-hand ${cs[0] !== '1' ? 'big' : ''}">${arr.ids.map(id => cardHtml(id, { sel: id === playSel, meld: learn ? arr.meldOf[id] : null, tip: tip && tip.discard === id, isNew: myTurn && h.phase === 'discard' && id === h.fresh, data: `data-card="${id}"` })).join('')}</div>
    <div class="pt-info">${!canCloseNow(g) ? `<span class="pt-early">🔒 Se puede cerrar desde la ${closeFrom(g)}ª vuelta (vais por la ${roundOf(h)}ª)</span><br>` : ''}${learn ? `Sin ligar: <b>${arr.bm.dead}</b> pts · ` : ''}Llevas <b>${R.st[my].total}</b> · ${h.deck.length} en el mazo · <button class="pt-learn" id="pLearn">💡 Aprendizaje: ${learn ? 'sí' : 'no'}</button> <button class="pt-learn" id="pSize">🔍 Cartas: ${cs[1]}</button></div>
    <div class="pt-acts">
      <button class="btn-ghost" id="pScore">📋 Puntos</button>
      <button class="btn-gold" id="pDrop" ${myTurn && h.phase === 'discard' && playSel ? '' : 'disabled'}>Tirar</button>
      <button class="btn-red" id="pClose" ${canClose ? '' : 'disabled'}>Cerrar${selDead ? ' (' + (isChinchon(h.hands[my].filter(x => x !== playSel)) ? '★' : selDead.loose.length === 0 ? g.cfg.closeBonus : selDead.dead) + ')' : ''}</button>
    </div>` : `<div class="pt-acts"><button class="btn-ghost" id="pScore">📋 Puntos</button></div>`}</div></div>`;
  const deckB = $('#pDeck'), discB = $('#pDisc');
  if (deckB) deckB.onclick = () => humanDraw(g, 'deck');
  if (discB) discB.onclick = () => humanDraw(g, 'discard');
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => { if (!myTurn || h.phase !== 'discard') return; playSel = playSel === b.dataset.card ? null : b.dataset.card; vibrate(8); render(); });
  const sz = $('#pSize'); if (sz) sz.onclick = () => { const i = CARD_SIZES.indexOf(cs); S.cardScale = CARD_SIZES[(i + 1) % CARD_SIZES.length][0]; save(); render(); };
  const lb = $('#pLearn'); if (lb) lb.onclick = () => { g.play.learn = !g.play.learn; S.draft.play && (S.draft.play.learn = g.play.learn); save(); toast(g.play.learn ? '💡 Modo aprendizaje activado' : 'Modo aprendizaje desactivado'); render(); };
  const drop = $('#pDrop'); if (drop) drop.onclick = () => humanDiscard(g, false);
  const cl = $('#pClose'); if (cl) cl.onclick = () => confirmBox('Cerrar la mano', `Tiras ${theCard(card(playSel))} y enseñas tus cartas.`, 'Cerrar', () => humanDiscard(g, true));
  $('#pScore').onclick = () => { openModal(`<h3>📋 Puntuaciones</h3>${historyTable(g, compute(g), false)}<div class="acts"><button class="btn-gold" id="psOk">Volver a la mesa</button></div>`); $('#psOk').onclick = closeModal; };
  if (h.phase === 'over') { showHandResult(g); return; }
  if (myOut) { runBotsInstant(g); save(); render(); return; }
  if (isBot(g, h.turn)) playTimer = setTimeout(() => { if (S.game !== g) return; botStep(g); save(); render(); }, window.PLAY_DELAY || 750);
}
function humanDraw(g, src) {
  const h = g.play.hand, my = me(g);
  if (h.turn !== my || h.phase !== 'draw') return;
  const got = drawFrom(h, src, my);
  h.hands[my].push(got); h.phase = 'discard'; playSel = null; h.fresh = got;
  h.log = 'Has ' + (src === 'discard' ? 'cogido ' : 'robado ') + theCard(card(got)) + '.';
  vibrate(15); save(); render();
}
function humanDiscard(g, close) {
  const h = g.play.hand, my = me(g);
  if (h.turn !== my || h.phase !== 'discard' || !playSel) return;
  const d = playSel; playSel = null;
  h.hands[my] = h.hands[my].filter(x => x !== d);
  if (close) { if (!canCloseNow(g)) { h.hands[my].push(d); toast('Aún no se puede cerrar: desde la ' + closeFrom(g) + 'ª vuelta'); return; }
    if (bestMelds(h.hands[my]).dead > CLOSE_MAX) { h.hands[my].push(d); toast('Para cerrar necesitas ' + CLOSE_MAX + ' o menos sin ligar'); return; } closeHand(g, my, d); h.log = 'Has cerrado.'; }
  else { h.discard.push(d); (h.gone = h.gone || []).push(d); h.log = 'Has tirado ' + theCard(card(d)) + '.'; nextTurn(h); }
  vibrate(20); save(); render();
}
function showHandResult(g) {
  const h = g.play.hand, res = h.result, R = compute(g), my = me(g);
  const rows = h.order.map(pid => {
    const arr = arrangeHand(h.hands[pid]);
    const pts = res.scores[pid];
    return `<div class="hrow"><div class="top"><div class="n">${res.closer === pid ? (res.kind === 'chinchon' ? '★ ' : '✓ ') : ''}${esc(pname(g, pid))}<small>${res.closer === pid ? (res.kind === 'chinchon' ? '¡Chinchón!' : res.kind === 'bonus' ? 'Cerró con todo ligado' : 'Cerró') : arr.bm.dead + ' sin ligar'} · total ${R.st[pid].total}${R.st[pid].out ? ' · eliminado' : ''}</small></div>
      <b style="color:${pts < 0 ? 'var(--ok)' : 'var(--gold)'};font-size:calc(20px * var(--fs, 1))">${pts > 0 ? '+' + pts : pts}</b></div>
      <div class="pt-hand mini">${arr.ids.map(id => cardHtml(id, { small: true, meld: arr.meldOf[id] })).join('')}</div></div>`;
  }).join('');
  const myOut = R.st[my].out, rebuy = !R.ended && myOut && canRebuy(g, R, my);
  openModal(`<h3>${res.closer ? (res.closer === my ? '¡Has cerrado!' : esc(pname(g, res.closer)) + ' ha cerrado') : 'Mano terminada'}</h3>
    <div class="sub">${R.ended ? '🏆 ' + esc(pname(g, R.ended.winner)) + ' gana la partida.' : myOut ? 'Has quedado eliminado.' : 'Mano ' + R.hand + ' anotada.'}</div>
    ${rows}
    <div class="acts">${rebuy ? `<button class="btn-ghost" id="prRebuy">Reenganchar (${rebuyScore(g, R)})</button>` : ''}
      <button class="btn-gold" id="prNext">${R.ended ? 'Ver resultado' : myOut && !rebuy ? 'Ver cómo acaba' : 'Siguiente mano'}</button></div>`);
  const next = () => {
    closeModal();
    let R2 = compute(g);
    if (R2.ended) { g.play.hand = null; save(); render(); return; }
    if (R2.st[my].out) {                                        // sin la persona: la máquina juega el resto al momento
      let guard = 0;
      while (!R2.ended && guard++ < 200) { dealHand(g); runBotsInstant(g); R2 = compute(g); }
      g.play.hand = null; save(); render(); return;
    }
    dealHand(g); save(); render();
  };
  $('#prNext').onclick = next;
  const rb = $('#prRebuy'); if (rb) rb.onclick = () => { g.events.push({ t: 'rebuy', p: my, score: rebuyScore(g, compute(g)), at: Date.now() }); toast('Te reenganchas'); next(); };
}

/* ---------- Preparar una partida contra la máquina ---------- */
function renderPlaySetup() {
  $('#subtitle').textContent = 'Jugar contra la máquina';
  const d = S.draft;
  d.play = Object.assign({ name: '', bots: 2, level: 'normal', jokers: 0, jokerValue: 0, closeFrom: 2 }, d.play || {});
  if (d.play.jvRule !== 2) { d.play.jokerValue = 0; d.play.jvRule = 2; }       // nueva regla por defecto: suelto vale 0
  if (!Array.isArray(d.play.botNames) || d.play.noDefaults !== 1) { d.play.botNames = ['', '', '']; if (d.play.noDefaults !== 1 && BOTS.some(n => nkey(n) === nkey(d.play.name))) d.play.name = ''; d.play.noDefaults = 1; }
  while (d.play.botNames.length < 3) d.play.botNames.push('');
  $('#app').innerHTML = `
    ${modeToggleHtml()}
    <div class="sec">
      <h2>Tu partida</h2>
      <label class="f"><span>Tu nombre</span><input type="text" id="plName" maxlength="18" value="${esc(d.play.name)}" placeholder="Tu nombre" list="rosterList" style="width:55%"></label>
      <datalist id="rosterList">${(S.roster || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <label class="f"><span>Rivales</span><span class="kinds" style="flex:none;width:55%;margin:0">${[1, 2, 3].map(n => `<button data-bots="${n}" class="${d.play.bots === n ? 'on' : ''}">${n}</button>`).join('')}</span></label>
      ${Array.from({ length: d.play.bots }, (_, i) => `<label class="f"><span>🤖 Rival ${i + 1}</span>
        <span style="display:flex;gap:6px;width:55%"><input type="text" data-botname="${i}" maxlength="16" value="${esc(d.play.botNames[i])}" placeholder="Rival ${i + 1}" style="flex:1;min-width:0">
        <button class="closebtn" data-botdice="${i}" aria-label="Nombre al azar">🎲</button></span></label>`).join('')}
      <label class="f"><span>🔒 Se puede cerrar desde<em>En la primera vuelta normalmente no</em></span><span class="kinds" style="flex:none;width:55%;margin:0">${[1, 2, 3].map(k => `<button data-closefrom="${k}" class="${(d.play.closeFrom || 2) === k ? 'on' : ''}">${k}ª vuelta</button>`).join('')}</span></label>
      <label class="f"><span>★ Comodines<em>Sustituyen a cualquier carta</em></span><span class="kinds" style="flex:none;width:55%;margin:0">${[[0, 'Sin'], [2, '2 comodines']].map(([k, l]) => `<button data-jokers="${k}" class="${(d.play.jokers || 0) === k ? 'on' : ''}">${l}</button>`).join('')}</span></label>
      ${d.play.jokers ? `<label class="f"><span>Comodín sin ligar vale<em>0 = no suma y se puede cerrar con él suelto</em></span><input type="number" inputmode="numeric" id="plJV" value="${d.play.jokerValue}" style="width:90px"></label>` : ''}
      <label class="f"><span>💡 Modo aprendizaje<em>La app te sugiere qué robar, qué tirar y cuándo cerrar</em></span><span class="kinds" style="flex:none;width:55%;margin:0">${[[false, 'No'], [true, 'Sí']].map(([k, l]) => `<button data-learn="${k}" class="${!!d.play.learn === k ? 'on' : ''}">${l}</button>`).join('')}</span></label>
      <label class="f"><span>Dificultad</span><span class="kinds" style="flex:none;width:55%;margin:0">${[['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']].map(([k, l]) => `<button data-level="${k}" class="${d.play.level === k ? 'on' : ''}">${l}</button>`).join('')}</span></label>
      <div class="mut" style="margin-top:8px;line-height:1.45">Baraja española de 40 cartas${d.play.jokers ? ' y ' + d.play.jokers + ' comodines' : ''}, 7 por jugador. Se cierra con ${CLOSE_MAX} o menos sin ligar, desde la ${d.play.closeFrom || 2}ª vuelta; con todo ligado, ${d.cfg.closeBonus}; la escalera de 7 del mismo palo es chinchón.</div>
    </div>
    <div class="sec"><h2>Reglas</h2>${cfgFields(d.cfg, 's_')}</div>
    <div class="copy">© 2026 IT Canarias</div>
    <button class="btn-gold fab" id="plStart">🃏 Empezar a jugar</button>`;
  bindCfg('s_');
  bindModeToggle();
  const sync = () => {
    d.play.name = $('#plName').value;
    document.querySelectorAll('[data-botname]').forEach(el => (d.play.botNames[+el.dataset.botname] = el.value));
    d.cfg = readCfg('s_'); save();
  };
  document.querySelectorAll('[data-botname]').forEach(el => (el.oninput = sync));
  document.querySelectorAll('[data-botdice]').forEach(b => b.onclick = () => {
    sync();
    const used = new Set(d.play.botNames.map(nkey).concat(nkey(d.play.name)));
    const free = BOT_IDEAS.filter(n => !used.has(nkey(n)));
    d.play.botNames[+b.dataset.botdice] = free[Math.floor(Math.random() * free.length)] || '';
    save(); render();
  });
  $('#plName').oninput = sync;
  document.querySelectorAll('.sec input, .sec select').forEach(el => el.addEventListener('change', sync));
  document.querySelectorAll('[data-bots]').forEach(b => b.onclick = () => { sync(); d.play.bots = +b.dataset.bots; render(); });
  document.querySelectorAll('[data-closefrom]').forEach(b => b.onclick = () => { sync(); d.play.closeFrom = +b.dataset.closefrom; render(); });
  document.querySelectorAll('[data-jokers]').forEach(b => b.onclick = () => { sync(); d.play.jokers = +b.dataset.jokers; render(); });
  const jv = $('#plJV'); if (jv) jv.onchange = () => { const v = parseInt(jv.value, 10); d.play.jokerValue = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0; save(); };
  document.querySelectorAll('[data-learn]').forEach(b => b.onclick = () => { sync(); d.play.learn = b.dataset.learn === 'true'; render(); });
  document.querySelectorAll('[data-level]').forEach(b => b.onclick = () => { sync(); d.play.level = b.dataset.level; render(); });
  $('#plStart').onclick = () => {
    sync();
    const myName = (d.play.name || '').trim() || 'Tú';
    const meP = { id: uid(), name: (S.roster || []).find(x => nkey(x) === nkey(myName)) || myName };
    // nombres de los rivales: los que hayas puesto (limpios y sin repetir) o los de siempre
    const taken = new Set([nkey(myName)]);
    const bots = Array.from({ length: d.play.bots }, (_, i) => {
      let n = cleanName(d.play.botNames[i]).replace(/^🤖\s*/, '') || 'Rival ' + (i + 1);
      let k = 2; const base = n; while (taken.has(nkey(n))) n = base + ' ' + k++;
      taken.add(nkey(n)); return { id: uid(), name: '🤖 ' + n };
    });
    const players = [meP, ...bots];
    S.game = { id: uid(), created: Date.now(), cfg: Object.assign({}, d.cfg), players, firstDealer: players[players.length - 1].id, events: [], play: { level: d.play.level, learn: !!d.play.learn, jokers: d.play.jokers || 0, jokerValue: d.play.jokerValue ?? 0, closeFrom: d.play.closeFrom || 2, bots: bots.map(b => b.id), hand: null } };
    if (!/^Jugador \d+$/.test(meP.name) && !S.roster.some(x => nkey(x) === nkey(meP.name))) S.roster.push(meP.name);
    S.lastCfg = Object.assign({}, d.cfg);
    d.play.name = ''; d.play.botNames = ['', '', ''];          // la próxima partida empieza sin nombres
    playSel = null; keepAwake(); render();
  };
}
function modeToggleHtml() {
  const m = S.draft.mode || 'score';
  return `<div class="kinds" style="margin:0 0 12px">
    <button data-mode="score" class="${m === 'score' ? 'on' : ''}">📝 Llevar los puntos</button>
    <button data-mode="play" class="${m === 'play' ? 'on' : ''}">🃏 Contra la máquina</button>
    <button data-mode="online" class="${m === 'online' ? 'on' : ''}">🌐 En línea</button></div>`;
}
function bindModeToggle() { document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.draft.mode = b.dataset.mode; save(); render(); }); }
