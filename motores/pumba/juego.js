'use strict';
/* =====================================================================
   Pumba · Jugar contra la máquina
   Motor de juego, rivales y mesa. Se apoya en el marcador de index.html:
   cada mano terminada se anota como una mano normal (totales, eliminados,
   reenganches, historial y ranking funcionan igual).
   Reglas: «Pumba – Normas» v0.1 (31/10/2026) con las decisiones cerradas.
   © 2026 IT Canarias. Todos los derechos reservados.
   ===================================================================== */

/* ---------- Cartas ---------- */
const SUITS = ['o', 'c', 'e', 'b'];
const SUIT_NAME = { o: 'oros', c: 'copas', e: 'espadas', b: 'bastos' };
const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];             // baraja española de 40 (sin 8, 9 ni comodines)
const RANK_LABEL = r => ({ 1: 'A', 10: 'S', 11: 'C', 12: 'R' })[r] || String(r);
const RANK_NAME = r => ({ 1: 'as', 10: 'sota', 11: 'caballo', 12: 'rey' })[r] || String(r);
const HAND_SIZE = 5;                                          // cartas por jugador
const SPECIAL = [2, 3, 10, 11];                               // el rey, de momento, es una carta normal
const MAX_BOTS = 5;                                           // de 2 a 6 jugadores en total
const CARD_SIZES = [['1', 'normales'], ['1.25', 'grandes'], ['1.5', 'muy grandes']];
const BOT_IDEAS = ['Pancho', 'Chano', 'Candelaria', 'Tomasa', 'Juanillo', 'Nieves', 'Pepito', 'Carmela', 'Domingo', 'Fefa', 'Agustín', 'Chona', 'Ramón', 'Pino', 'Chicho', 'Luci'];
// Cuánto se equivoca o se despista la máquina según el nivel
const LEVEL = {
  facil:   { forget: 0.30, claim: 0.35 },
  normal:  { forget: 0.12, claim: 0.70 },
  dificil: { forget: 0.03, claim: 0.95 }
};
// Opciones de la mesa (se guardan en g.play)
const PLAY_DEF = { level: 'normal', learn: false, figures: 'face', sotaFree: true, closePenalty: true };

let FIG_TEN = false;                                          // figuras a 10 (si no: sota 10, caballo 11, rey 12)
function usePlayRules(g) { FIG_TEN = !!(g && g.play && g.play.figures === 'ten'); }
const card = id => ({ id, s: id[0], r: Number(id.slice(1)) });
const cardValue = c => (FIG_TEN && c.r > 10 ? 10 : c.r);
const cardName = c => RANK_NAME(c.r) + ' de ' + SUIT_NAME[c.s];
const theCard = c => (c.r === 10 ? 'la ' : 'el ') + cardName(c);   // «la sota», «el rey»
const handPoints = ids => ids.reduce((a, id) => a + cardValue(card(id)), 0);
function shuffle(d) { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }
function newDeck() { const d = []; for (const s of SUITS) for (const r of RANKS) d.push(s + r); return shuffle(d); }

/* ---------- Estado de la mano ----------
   g.play.hand = { dealer, order:[pid], dir:1|-1, hands:{pid:[ids]}, deck:[ids], pile:[ids] (la última es la de la mesa),
                   suit (palo que manda), penalty (cartas que hay que robar por los doses), turn, phase:'play'|'over',
                   turns, passes, said:{pid}, forgot:{pid}|null, lacks:{pid:[palos]}, log, result } */
const isBot = (g, pid) => g.play.bots.includes(pid);
const topOf = h => h.pile[h.pile.length - 1];
function dealHand(g) {
  const R = compute(g);
  usePlayRules(g);
  // Empieza el siguiente al que reparte, en sentido horario (orden de la mesa)
  const order = []; const i = g.players.findIndex(p => p.id === R.lead);
  for (let k = 0; k < g.players.length; k++) { const p = g.players[(i + k) % g.players.length]; if (!R.st[p.id].out) order.push(p.id); }
  const deck = newDeck(), hands = {};
  order.forEach(pid => (hands[pid] = deck.splice(0, HAND_SIZE)));
  // La primera carta de la mesa no puede ser especial: se devuelve al mazo y se saca otra
  let first = deck.shift(), guard = 0;
  while (SPECIAL.includes(card(first).r) && guard++ < 100) { deck.splice(Math.floor(Math.random() * (deck.length + 1)), 0, first); first = deck.shift(); }
  g.play.hand = { dealer: R.next, order, dir: 1, hands, deck, pile: [first], suit: first[0], penalty: 0, turn: order[0], phase: 'play', turns: 0, passes: 0,
    said: {}, forgot: null, lacks: {}, log: pname(g, R.next) + ' ha repartido. ' + (isBot(g, order[0]) ? 'Sale ' + pname(g, order[0]) + '.' : 'Sales tú.'), result: null };
}
// ¿Se puede echar esta carta ahora?
function canPlay(g, h, id) {
  const c = card(id), top = card(topOf(h));
  if (h.penalty > 0) return c.r === 2;                         // con castigo pendiente solo vale otro 2
  if (c.r === 10 && g.play.sotaFree !== false) return true;     // la sota cambia el palo: se puede echar siempre
  return c.s === h.suit || c.r === top.r;
}
const playable = (g, h, pid) => h.hands[pid].filter(id => canPlay(g, h, id));
function nextFrom(h, pid, steps) { const n = h.order.length, i = h.order.indexOf(pid); return h.order[(((i + h.dir * steps) % n) + n) % n]; }
// Roba del mazo; si se acaba, se barajan las de la mesa menos la última
function drawCards(h, pid, n) {
  let got = 0;
  for (let k = 0; k < n; k++) {
    if (!h.deck.length && h.pile.length > 1) { const top = h.pile.pop(); h.deck = shuffle(h.pile); h.pile = [top]; }
    if (!h.deck.length) break;
    h.hands[pid].push(h.deck.shift()); got++;
  }
  return got;
}
function advance(h, from, skip) { h.turn = nextFrom(h, from, 1 + (skip || 0)); h.turns++; }

/* ---------- Aviso de «¡Pumba!» ----------
   Quien echa la penúltima carta tiene que decirlo. Si se le olvida, se le puede reclamar hasta que
   el siguiente jugador eche carta o robe; el primero que lo reclama gana y el despistado roba dos. */
function claimPumba(g, by) {
  const h = g.play.hand; if (!h || !h.forgot || h.forgot.pid === by) return false;
  const pid = h.forgot.pid; h.forgot = null;
  if (h.hands[pid].length !== 1) return false;
  drawCards(h, pid, 2);
  h.log = pname(g, by) + ' reclama: ' + pname(g, pid) + ' no dijo «¡Pumba!» y roba dos.';
  return true;
}
// Antes de que actúe el siguiente, la máquina puede reclamar el olvido; después ya no vale
function resolveClaims(g, actor) {
  const h = g.play.hand; if (!h.forgot) return;
  const lv = LEVEL[g.play.level] || LEVEL.normal;
  const bots = h.order.filter(p => p !== h.forgot.pid && isBot(g, p));
  const who = bots.find(() => Math.random() < lv.claim);
  if (who) { const prev = h.log; claimPumba(g, who); h.log = prev + ' ' + h.log; }
  h.forgot = null;
}

/* ---------- Jugadas ---------- */
// Echa una carta. suit: palo elegido con la sota. say: si dice «¡Pumba!» al quedarse con una
function playCard(g, pid, id, suit, say) {
  usePlayRules(g);
  const h = g.play.hand;
  if (h.phase !== 'play' || h.turn !== pid || !h.hands[pid].includes(id) || !canPlay(g, h, id)) return false;
  resolveClaims(g, pid);
  const c = card(id);
  h.hands[pid] = h.hands[pid].filter(x => x !== id);
  h.pile.push(id); h.suit = c.s; h.passes = 0;
  if (h.lacks[pid]) h.lacks[pid] = h.lacks[pid].filter(s => s !== c.s);
  let log = pname(g, pid) + ' echa ' + theCard(c) + '.';
  const left = h.hands[pid].length;
  if (left === 1) {
    if (say || h.said[pid]) log += ' ¡Pumba!';
    else h.forgot = { pid };
  }
  h.said = {};
  if (!left) return closeHand(g, pid, id, log);
  let skip = 0;
  if (c.r === 2) { h.penalty += 2; log += ' ' + pname(g, nextFrom(h, pid, 1)) + ' roba ' + h.penalty + ' o responde con un 2.'; }
  else if (c.r === 3) { if (h.order.length > 2) { h.dir = -h.dir; log += ' Cambia el sentido.'; } }
  else if (c.r === 10) { h.suit = SUITS.includes(suit) ? suit : bestSuit(h.hands[pid]); log += ' Pide ' + SUIT_NAME[h.suit] + '.'; }
  else if (c.r === 11) { skip = 1; log += ' Salta a ' + pname(g, nextFrom(h, pid, 1)) + '.'; }
  h.log = log;
  advance(h, pid, skip);
  return true;
}
// Robar: con castigo pendiente, roba el castigo y pierde el turno; si no, una carta y pasa (aunque le sirva).
// Se puede robar aunque se tenga jugada (por error o porque interese).
function drawTurn(g, pid) {
  const h = g.play.hand;
  if (h.phase !== 'play' || h.turn !== pid) return false;
  const couldPlay = playable(g, h, pid).length > 0;
  resolveClaims(g, pid);
  h.said = {};
  if (h.penalty) {
    const n = h.penalty, got = drawCards(h, pid, n); h.penalty = 0; h.passes = 0;
    h.log = pname(g, pid) + ' roba ' + got + ' y pierde el turno.';
  } else {
    if (!couldPlay) (h.lacks[pid] = h.lacks[pid] || []).includes(h.suit) || h.lacks[pid].push(h.suit);
    const got = drawCards(h, pid, 1);
    h.passes = got ? 0 : h.passes + 1;
    h.log = pname(g, pid) + (got ? ' roba y pasa.' : ' no puede robar (no quedan cartas) y pasa.');
  }
  advance(h, pid, 0);
  // Por seguridad: si nadie puede jugar ni robar, la mano se cierra sin ganador
  if (h.passes >= h.order.length * 2 || h.turns > 1500) closeHand(g, null, null, h.log + ' Nadie puede seguir: se cuentan las cartas.');
  return true;
}
// Termina la mano: puntos de cada uno y se anota en el marcador
function closeHand(g, closer, lastId, log) {
  usePlayRules(g);
  const h = g.play.hand;
  let victim = null, extra = 0;
  // Se cierra con un 2: el castigo se cumple (el siguiente roba antes de contar)
  if (closer && lastId && card(lastId).r === 2 && g.play.closePenalty !== false) {
    victim = nextFrom(h, closer, 1); extra = drawCards(h, victim, h.penalty + 2);
    log = (log || '') + ' ' + pname(g, victim) + ' roba ' + extra + ' antes de contar.';
  }
  h.penalty = 0; h.forgot = null;
  const scores = {};
  for (const pid of h.order) scores[pid] = pid === closer ? 0 : handPoints(h.hands[pid]);
  h.phase = 'over';
  h.result = { closer, scores, victim, extra };
  h.log = (log || '') + (closer ? ' ' + pname(g, closer) + ' se queda sin cartas.' : '');
  g.events.push({ t: 'hand', dealer: h.dealer, closer: closer || null, kind: 'normal', scores, at: Date.now() });
  return true;
}

/* ---------- La máquina ---------- */
// Palo que más conviene pedir con la sota: el que más cartas (y puntos) tiene en la mano
function bestSuit(ids, avoid) {
  let best = 'o', bv = -1;
  for (const s of SUITS) {
    const cs = ids.filter(id => id[0] === s).map(card);
    const v = cs.length * 100 + cs.reduce((a, c) => a + cardValue(c), 0) + (avoid && avoid.includes(s) ? 50 : 0);
    if (v > bv) { bv = v; best = s; }
  }
  return best;
}
// Elige jugada: { play: id, suit } o { draw: true }
function botChoose(g, pid) {
  usePlayRules(g);
  const h = g.play.hand, hand = h.hands[pid], opts = playable(g, h, pid);
  if (!opts.length) return { draw: true };
  const lv = g.play.level || 'normal';
  const next = nextFrom(h, pid, 1), nextN = h.hands[next].length, lacks = h.lacks[next] || [];
  if (lv === 'facil') {
    const id = opts[Math.floor(Math.random() * opts.length)];
    return { play: id, suit: bestSuit(hand.filter(x => x !== id)) };
  }
  const hard = lv === 'dificil';
  let best = null;
  for (const id of opts) {
    const c = card(id), rest = hand.filter(x => x !== id);
    const suit = c.r === 10 ? bestSuit(rest, hard ? lacks : null) : c.s;
    let sc = cardValue(c);                                     // deshacerse de lo que más puntos vale
    const keep = rest.filter(x => x[0] === suit || card(x).r === c.r || card(x).r === 10).length;
    sc += keep * (hard ? 2 : 1.5);                             // seguir teniendo jugada en la próxima vuelta
    if (c.r === 2) sc += h.penalty ? 100 : 3 + (nextN <= 2 ? 15 : 0) - (hard && rest.length > 2 ? 5 : 0);
    if (c.r === 11) sc += 2 + (nextN <= 2 ? 12 : 0);
    if (c.r === 3 && h.order.length > 2) sc += 1 + (nextN <= 2 ? 10 : 0);
    if (c.r === 10 && opts.some(x => card(x).r !== 10)) sc -= hard ? 10 : 8;   // la sota se guarda para cuando no haya otra
    if (hard && lacks.includes(suit)) sc += 6;                  // el siguiente no tiene ese palo
    if (!rest.length) sc += 1000;                              // cerrar
    if (!best || sc > best.sc) best = { play: id, suit, sc };
  }
  return best;
}
function botStep(g) {
  const h = g.play.hand, pid = h.turn;
  const ch = botChoose(g, pid);
  if (ch.draw) { drawTurn(g, pid); return; }
  const lv = LEVEL[g.play.level] || LEVEL.normal;
  playCard(g, pid, ch.play, ch.suit, Math.random() >= lv.forget);
}
// Juega sin pausas hasta que le toque a la persona o termine la mano
function runBotsInstant(g) { let k = 0; while (g.play.hand && g.play.hand.phase !== 'over' && isBot(g, g.play.hand.turn) && k++ < 5000) botStep(g); }

/* ---------- Dibujo de cartas ---------- */
const SUIT_SVG = {
  o: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#e0a419" stroke="#8a6500" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#8a6500" stroke-width="1.4"/></svg>',
  c: '<svg viewBox="0 0 24 24"><path d="M5 3h14l-1.5 7.5A5.6 5.6 0 0 1 12 15a5.6 5.6 0 0 1-5.5-4.5z" fill="#c0392b"/><path d="M11 14.5h2v4h3.5V21h-9v-2.5H11z" fill="#c0392b"/></svg>',
  e: '<svg viewBox="0 0 24 24"><path d="M12 1.5l2 3.2V15h-4V4.7z" fill="#2a5aa8"/><path d="M6.5 15h11v2.2h-11z" fill="#1d3f78"/><path d="M11 17.2h2V22h-2z" fill="#1d3f78"/></svg>',
  b: '<svg viewBox="0 0 24 24"><path d="M9.2 4.2a3 3 0 0 1 5.6 0l.4 2.6L13.6 22h-3.2L8.8 6.8z" fill="#3b8b3f"/><circle cx="10" cy="9" r="1" fill="#1f5c22"/><circle cx="13.6" cy="12.5" r="1" fill="#1f5c22"/></svg>'
};
function cardHtml(id, opts) {
  opts = opts || {};
  if (!id) return '<div class="pc-card empty"></div>';
  const c = card(id), tag = opts.data ? 'button' : 'div';     // solo las cartas de tu mano son botones
  const fx = SPECIAL.includes(c.r) ? `<i class="pc-fx">${{ 2: '+2', 3: '⇄', 10: '🎨', 11: '⤼' }[c.r]}</i>` : '';
  return `<${tag} class="pc-card ${opts.sel ? 'sel' : ''} ${opts.ok ? 'ok' : ''} ${opts.dim ? 'dim' : ''} ${opts.tip ? 'tip' : ''} ${opts.isNew ? 'fresh' : ''} ${opts.small ? 'small' : ''}" ${opts.data || ''} aria-label="${cardName(c)}">
    <b class="pc-r pc-${c.s}">${RANK_LABEL(c.r)}</b><span class="pc-s">${SUIT_SVG[c.s]}</span>${opts.small ? '' : fx}${opts.isNew ? '<em class="pc-new" title="Carta nueva">nueva</em>' : ''}</${tag}>`;
}
function backHtml(n) { return `<div class="pc-card back"><span>${n != null ? n : ''}</span></div>`; }
function suitBadge(s) { return `<span class="pt-suit">${SUIT_SVG[s]}<b>${SUIT_NAME[s]}</b></span>`; }
// Ordena la mano por palo y número
function arrangeHand(ids) { return ids.slice().sort((a, b) => SUITS.indexOf(a[0]) - SUITS.indexOf(b[0]) || RANKS.indexOf(card(a).r) - RANKS.indexOf(card(b).r)); }

/* ---------- Mesa ---------- */
let playTimer = null, playSel = null;
function me(g) { return g.players.find(p => !isBot(g, p.id)).id; }
function renderTable(g, R) {
  usePlayRules(g);
  clearTimeout(playTimer);
  if (!g.play.hand) { dealHand(g); save(); }
  const h = g.play.hand, my = me(g), myOut = !h.order.includes(my);
  $('#subtitle').textContent = 'Mano ' + (R.hand + 1) + ' · contra la máquina';
  const top = topOf(h), myTurn = h.turn === my && h.phase === 'play';
  const mine = h.hands[my] ? arrangeHand(h.hands[my]) : null;
  const okIds = myTurn ? playable(g, h, my) : [];
  if (playSel && !okIds.includes(playSel)) playSel = null;
  const mustDraw = myTurn && (!okIds.length || h.penalty > 0);   // no hay más remedio (o hay castigo pendiente)
  const opp = h.order.filter(p => p !== my);
  const learn = !!g.play.learn;
  const tip = learn && myTurn ? botChoose(g, my) : null;
  const canClaim = h.forgot && h.forgot.pid !== my && !myOut;
  const needSay = myTurn && mine && mine.length === 2;
  let hint = '';
  if (myOut) hint = 'Estás eliminado en esta partida.';
  else if (!myTurn) hint = h.phase === 'over' ? '' : 'Juega ' + esc(pname(g, h.turn)) + '…';
  else if (h.penalty) hint = okIds.length ? `Te toca robar <b>${h.penalty}</b> o responder con un <b>2</b>.` : `No tienes un 2: roba <b>${h.penalty}</b> y pierdes el turno.`;
  else if (!okIds.length) hint = 'No tienes jugada: <b>roba</b> una carta y pasa el turno.';
  else if (tip && tip.play) hint = `💡 Echa <b>${theCard(card(tip.play))}</b>${card(tip.play).r === 10 ? ' y pide ' + SUIT_NAME[tip.suit] : ''}.`;
  else hint = playSel ? 'Pulsa <b>Echar</b>.' : 'Elige una carta que coincida en <b>palo</b> o en <b>número</b>, o <b>roba</b> y pasa.';
  if (needSay && !mustDraw) hint += h.said[my] ? ' <b>¡Pumba! dicho.</b>' : ' Si echas la penúltima, di <b>«¡Pumba!»</b>.';
  const cs = CARD_SIZES.find(x => x[0] === String(S.cardScale || '1')) || CARD_SIZES[0];
  const dirTxt = h.order.length > 2 ? (h.dir > 0 ? '↻ Sentido horario' : '↺ Sentido contrario') : '';
  $('#app').innerHTML = `<div class="pt-table" style="--cs:${cs[0]}"><div class="pt-l">
    <div class="pt-opps">${opp.map(p => `<div class="pt-opp ${h.turn === p && h.phase === 'play' ? 'turn' : ''}">
        <div class="pt-on">${esc(pname(g, p))}${h.hands[p].length === 1 ? ' <span class="pt-pb">¡1!</span>' : ''}</div><div class="pt-ot">${R.st[p].total} pts · ${h.hands[p].length} carta${h.hands[p].length === 1 ? '' : 's'}</div>
        <div class="pt-ob">${'<i></i>'.repeat(Math.min(10, h.hands[p].length))}</div></div>`).join('')}</div>
    <div class="pt-mid">
      <div class="pt-pile"><button class="pt-btn ${mustDraw ? 'go' : ''}" id="pDeck" ${myTurn ? '' : 'disabled'}>${backHtml(h.deck.length)}</button><small>Mazo</small></div>
      <div class="pt-pile"><div class="pt-top">${cardHtml(top)}${h.penalty ? `<span class="pt-pen">+${h.penalty}</span>` : ''}</div><small>Mesa</small></div>
    </div>
    <div class="pt-state">${suitBadge(h.suit)}${dirTxt ? `<span class="pt-dir">${dirTxt}</span>` : ''}</div>
    <div class="pt-log">${esc(h.log || '')}</div></div><div class="pt-r">
    ${canClaim ? `<button class="btn-red pt-claim" id="pClaim">📣 ¡${esc(pname(g, h.forgot.pid))} no ha dicho Pumba!</button>` : ''}
    <div class="pt-hint">${hint}</div>
    ${mine ? `<div class="pt-hand ${cs[0] !== '1' ? 'big' : ''} ${mine.length > 8 ? 'many' : ''}">${mine.map(id => cardHtml(id, { sel: id === playSel, ok: myTurn && okIds.includes(id), dim: myTurn && !okIds.includes(id), tip: tip && tip.play === id, isNew: id === h.fresh, data: `data-card="${id}"` })).join('')}</div>
    <div class="pt-info">Llevas <b>${R.st[my].total}</b> · en la mano <b>${handPoints(h.hands[my])}</b> pts · ${h.deck.length} en el mazo<br><button class="pt-learn" id="pLearn">💡 Aprendizaje: ${learn ? 'sí' : 'no'}</button> <button class="pt-learn" id="pSize">🔍 Cartas: ${cs[1]}</button></div>
    <div class="pt-acts">
      <button class="btn-ghost" id="pScore">📋 Puntos</button>
      <button class="${h.said[my] ? 'btn-gold' : 'btn-ghost'} pt-say" id="pSay" ${needSay && !mustDraw ? '' : 'disabled'}>${h.said[my] ? '✓ ¡Pumba!' : '📣 ¡Pumba!'}</button>
      ${myTurn ? `<button class="${mustDraw ? 'btn-gold' : 'btn-ghost'}" id="pDraw">${h.penalty ? 'Robar ' + h.penalty : 'Robar'}</button>` : ''}
      <button class="btn-gold" id="pPlay" ${myTurn && playSel ? '' : 'disabled'}>Echar</button>
    </div>` : `<div class="pt-acts"><button class="btn-ghost" id="pScore">📋 Puntos</button></div>`}</div></div>`;
  // Robar teniendo jugada: se pide confirmación por si es un error
  const askDraw = () => { if (mustDraw) return humanDraw(g);
    confirmBox('Robar y pasar', 'Tienes carta para echar. Si robas, coges una carta y pasas el turno.', 'Robar', () => humanDraw(g)); };
  const deckB = $('#pDeck'); if (deckB) deckB.onclick = askDraw;
  const drawB = $('#pDraw'); if (drawB) drawB.onclick = askDraw;
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => {
    if (!myTurn) return;
    const id = b.dataset.card;
    if (!okIds.includes(id)) { toast(h.penalty ? 'Solo puedes responder con un 2' : 'Esa carta no coincide en palo ni en número'); return; }
    playSel = playSel === id ? null : id; vibrate(8); render();
  });
  const say = $('#pSay'); if (say) say.onclick = () => { h.said[my] = true; vibrate([20, 30, 20]); toast('📣 ¡Pumba!'); save(); render(); };
  const cl = $('#pClaim'); if (cl) cl.onclick = () => { if (claimPumba(g, my)) { vibrate(40); toast('¡Bien visto! Roba dos'); } save(); render(); };
  const sz = $('#pSize'); if (sz) sz.onclick = () => { const i = CARD_SIZES.indexOf(cs); S.cardScale = CARD_SIZES[(i + 1) % CARD_SIZES.length][0]; save(); render(); };
  const lb = $('#pLearn'); if (lb) lb.onclick = () => { g.play.learn = !g.play.learn; if (S.draft.play) S.draft.play.learn = g.play.learn; save(); toast(g.play.learn ? '💡 Modo aprendizaje activado' : 'Modo aprendizaje desactivado'); render(); };
  const pl = $('#pPlay'); if (pl) pl.onclick = () => humanPlay(g);
  $('#pScore').onclick = () => { openModal(`<h3>📋 Puntuaciones</h3>${historyTable(g, compute(g), false)}<div class="acts"><button class="btn-gold" id="psOk">Volver a la mesa</button></div>`); $('#psOk').onclick = closeModal; };
  if (h.phase === 'over') { showHandResult(g); return; }
  if (myOut) { runBotsInstant(g); save(); render(); return; }
  // Si un rival se ha olvidado de decir «¡Pumba!», da algo más de tiempo para reclamárselo
  if (isBot(g, h.turn)) playTimer = setTimeout(() => { if (S.game !== g) return; botStep(g); save(); render(); }, (window.PLAY_DELAY || 800) * (canClaim ? 2.5 : 1));
}
function humanDraw(g) {
  const h = g.play.hand, my = me(g);
  if (!drawTurn(g, my)) return;
  const mineNow = h.hands[my]; h.fresh = mineNow[mineNow.length - 1];
  playSel = null; vibrate(15); save(); render();
}
function humanPlay(g) {
  const h = g.play.hand, my = me(g);
  if (h.turn !== my || !playSel) return;
  const id = playSel;
  const go = suit => { playSel = null; h.fresh = null; if (playCard(g, my, id, suit, false)) vibrate(20); save(); render(); };
  if (card(id).r === 10 && h.penalty === 0 && h.hands[my].length > 1) {
    openModal(`<h3>🎨 ¿Qué palo pides?</h3><div class="sub">Con la sota eliges el palo que hay que seguir.</div>
      <div class="pt-suits">${SUITS.map(s => `<button data-suit="${s}">${SUIT_SVG[s]}<b>${SUIT_NAME[s]}</b></button>`).join('')}</div>
      <div class="acts"><button class="btn-ghost" id="suC">Cancelar</button></div>`);
    $('#suC').onclick = closeModal;
    document.querySelectorAll('[data-suit]').forEach(b => b.onclick = () => { closeModal(); go(b.dataset.suit); });
    return;
  }
  go(null);
}
function showHandResult(g) {
  const h = g.play.hand, res = h.result, R = compute(g), my = me(g);
  const rows = h.order.slice().sort((a, b) => res.scores[a] - res.scores[b]).map(pid => {
    const pts = res.scores[pid];
    return `<div class="hrow"><div class="top"><div class="n">${res.closer === pid ? '✓ ' : ''}${esc(pname(g, pid))}<small>${res.closer === pid ? 'Se quedó sin cartas' : h.hands[pid].length + ' carta' + (h.hands[pid].length === 1 ? '' : 's')}${res.victim === pid ? ' · robó ' + res.extra + ' por el 2' : ''} · total ${R.st[pid].total}${R.st[pid].out ? ' · eliminado' : ''}</small></div>
      <b style="color:${pts ? 'var(--gold)' : 'var(--ok)'};font-size:calc(20px * var(--fs, 1))">+${pts}</b></div>
      ${h.hands[pid].length ? `<div class="pt-hand mini">${arrangeHand(h.hands[pid]).map(id => cardHtml(id, { small: true })).join('')}</div>` : ''}</div>`;
  }).join('');
  const myOut = R.st[my].out, rebuy = !R.ended && myOut && canRebuy(g, R, my);
  openModal(`<h3>${res.closer ? (res.closer === my ? '¡Te has quedado sin cartas!' : esc(pname(g, res.closer)) + ' cierra la mano') : 'Mano terminada'}</h3>
    <div class="sub">${R.ended ? '🏆 ' + esc(pname(g, R.ended.winner)) + ' gana la partida.' : myOut ? 'Has pasado de ' + g.cfg.limit + ' puntos.' + (rebuy ? ' Puedes reengancharte si quieres.' : '') : 'Mano ' + R.hand + ' anotada.'}</div>
    ${rows}
    <div class="acts">${rebuy ? `<button class="btn-ghost" id="prRebuy">Reenganchar (${rebuyScore(g, R)})</button>` : ''}
      <button class="btn-gold" id="prNext">${R.ended ? 'Ver resultado' : myOut ? (rebuy ? 'No, ver cómo acaba' : 'Ver cómo acaba') : 'Siguiente mano'}</button></div>`);
  const next = () => {
    closeModal();
    let R2 = compute(g);
    if (R2.ended) { g.play.hand = null; save(); render(); return; }
    if (R2.st[my].out) {                                        // sin la persona: la máquina juega el resto al momento
      let guard = 0;
      while (!R2.ended && guard++ < 300) { botRebuys(g); R2 = compute(g); if (R2.ended) break; dealHand(g); runBotsInstant(g); R2 = compute(g); }
      g.play.hand = null; save(); render(); return;
    }
    botRebuys(g);
    dealHand(g); save(); render();
  };
  $('#prNext').onclick = next;
  const rb = $('#prRebuy'); if (rb) rb.onclick = () => { g.events.push({ t: 'rebuy', p: my, score: rebuyScore(g, compute(g)), at: Date.now() }); toast('Te reenganchas'); next(); };
}
// El reenganche es opcional: la máquina se reengancha si la partida sigue (siempre, salvo en fácil, que a veces no)
function botRebuys(g) {
  let R = compute(g);
  for (const p of g.players) {
    if (!isBot(g, p.id) || !canRebuy(g, R, p.id) || R.ended) continue;
    if (g.play.level === 'facil' && Math.random() < 0.3) continue;
    g.events.push({ t: 'rebuy', p: p.id, score: rebuyScore(g, R), at: Date.now() });
    R = compute(g);
  }
}

/* ---------- Preparar una partida contra la máquina ---------- */
function renderPlaySetup() {
  $('#subtitle').textContent = 'Jugar contra la máquina';
  const d = S.draft;
  d.play = Object.assign({ name: '', bots: 2 }, PLAY_DEF, d.play || {});
  if (!Array.isArray(d.play.botNames)) d.play.botNames = [];
  while (d.play.botNames.length < MAX_BOTS) d.play.botNames.push('');
  const pick = (attr, list, cur) => `<span class="kinds" style="flex:none;width:58%;margin:0">${list.map(([k, l]) => `<button data-${attr}="${k}" class="${String(cur) === String(k) ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  $('#app').innerHTML = `
    ${modeToggleHtml()}
    <div class="sec">
      <h2>Tu partida</h2>
      <label class="f"><span>Tu nombre</span><input type="text" id="plName" maxlength="18" value="${esc(d.play.name)}" placeholder="Tu nombre" list="rosterList" style="width:58%"></label>
      <datalist id="rosterList">${(S.roster || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <label class="f"><span>Rivales</span>${pick('bots', [1, 2, 3, 4, 5].map(n => [n, n]), d.play.bots)}</label>
      ${Array.from({ length: d.play.bots }, (_, i) => `<label class="f"><span>🤖 Rival ${i + 1}</span>
        <span style="display:flex;gap:6px;width:58%"><input type="text" data-botname="${i}" maxlength="16" value="${esc(d.play.botNames[i])}" placeholder="Rival ${i + 1}" style="flex:1;min-width:0">
        <button class="closebtn" data-botdice="${i}" aria-label="Nombre al azar">🎲</button></span></label>`).join('')}
      <label class="f"><span>Dificultad</span>${pick('level', [['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']], d.play.level)}</label>
      <label class="f"><span>💡 Modo aprendizaje<em>La app te sugiere qué carta echar</em></span>${pick('learn', [[false, 'No'], [true, 'Sí']], !!d.play.learn)}</label>
      <label class="f"><span>Valor de las figuras<em>Puntos de sota, caballo y rey</em></span>${pick('figures', [['face', '10 · 11 · 12'], ['ten', 'Todas 10']], d.play.figures)}</label>
      <label class="f"><span>🎨 La sota<em>Elige el palo que hay que seguir</em></span>${pick('sotafree', [[true, 'Se echa siempre'], [false, 'Palo o número']], d.play.sotaFree !== false)}</label>
      <label class="f"><span>Cerrar con un 2<em>¿El siguiente roba el castigo antes de contar?</em></span>${pick('closepen', [[true, 'Sí, se cumple'], [false, 'No']], d.play.closePenalty !== false)}</label>
      <div class="mut" style="margin-top:8px;line-height:1.45">Baraja española de 40 cartas, ${HAND_SIZE} por jugador. Se echa carta del mismo palo o número, o se roba una y se pasa (aunque tengas jugada).
        <b>2</b>: el siguiente roba dos o responde con otro 2 (se acumulan) · <b>3</b>: cambia el sentido · <b>sota</b>: eliges palo · <b>caballo</b>: salta al siguiente · <b>rey</b>: sin efecto.
        Al echar la penúltima di «¡Pumba!»: si se te olvida y te lo reclaman, robas dos. Quien se queda sin cartas no suma; los demás suman lo que tienen en la mano.</div>
    </div>
    <div class="sec"><h2>Reglas de la partida</h2>${cfgFields(d.cfg, 's_')}</div>
    <div class="copy">© 2026 IT Canarias. Todos los derechos reservados.</div>
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
  const opt = (attr, fn) => document.querySelectorAll(`[data-${attr}]`).forEach(b => b.onclick = () => { sync(); fn(b.getAttribute('data-' + attr)); render(); });
  opt('bots', v => d.play.bots = +v);
  opt('level', v => d.play.level = v);
  opt('learn', v => d.play.learn = v === 'true');
  opt('figures', v => d.play.figures = v);
  opt('sotafree', v => d.play.sotaFree = v === 'true');
  opt('closepen', v => d.play.closePenalty = v === 'true');
  $('#plStart').onclick = () => {
    sync();
    const myName = (d.play.name || '').trim() || 'Tú';
    const meP = { id: uid(), name: (S.roster || []).find(x => nkey(x) === nkey(myName)) || cleanName(myName) || 'Tú' };
    const taken = new Set([nkey(meP.name)]);
    const bots = Array.from({ length: d.play.bots }, (_, i) => {
      let n = cleanName(d.play.botNames[i]).replace(/^🤖\s*/, '') || 'Rival ' + (i + 1);
      let k = 2; const base = n; while (taken.has(nkey(n))) n = base + ' ' + k++;
      taken.add(nkey(n)); return { id: uid(), name: '🤖 ' + n };
    });
    const players = [meP, ...bots];
    S.game = { id: uid(), created: Date.now(), cfg: Object.assign({}, d.cfg), players, firstDealer: players[players.length - 1].id, events: [], play: newPlay(d.play, bots.map(b => b.id)) };
    if (!/^Jugador \d+$/.test(meP.name) && meP.name !== 'Tú' && !S.roster.some(x => nkey(x) === nkey(meP.name))) S.roster.push(meP.name);
    S.lastCfg = Object.assign({}, d.cfg);
    d.play.name = ''; d.play.botNames = [];                    // la próxima partida empieza sin nombres
    playSel = null; keepAwake(); render();
  };
}
// Opciones de la mesa para una partida nueva (o una revancha)
function newPlay(p, bots) {
  return { level: ['facil', 'normal', 'dificil'].includes(p.level) ? p.level : 'normal', learn: !!p.learn, figures: p.figures === 'ten' ? 'ten' : 'face',
    sotaFree: p.sotaFree !== false, closePenalty: p.closePenalty !== false, bots, hand: null };
}
function modeToggleHtml() {
  const m = S.draft.mode || 'score';
  return `<div class="kinds" style="margin:0 0 12px">
    <button data-mode="score" class="${m === 'score' ? 'on' : ''}">📝 Llevar los puntos</button>
    <button data-mode="play" class="${m === 'play' ? 'on' : ''}">🃏 Jugar contra la máquina</button></div>`;
}
function bindModeToggle() { document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.draft.mode = b.dataset.mode; save(); render(); }); }
