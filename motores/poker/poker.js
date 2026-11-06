/* Póker · Texas Hold'em sin límite, torneo (freezeout) — reglas y máquina (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.
   Es el MISMO archivo en la app (www/poker.js) y en el servidor de juegos (motores/poker/poker.js).
   Reglas: ver REGLAS.md (TDA 2026 + Robert's Rules of Poker). Sin dependencias.

   Cartas: número 0–51. rango = c % 13 (0 = 2 … 12 = As), palo = floor(c / 13) (0 ♣, 1 ♦, 2 ♥, 3 ♠).
   Estado de la partida (JSON puro, se puede guardar):
     seats[i] = { nombre, bot, stack, bet, tot, cards, fold, allin, out, lastBet, place, inicio }
       bet = lo apostado en esta ronda · tot = lo puesto en esta mano · lastBet = apuesta de la mesa cuando actuó por última vez
     fase: 'preflop' | 'flop' | 'turn' | 'river' | 'mano_fin' | 'fin'
     turno: asiento al que le toca (o null) · bet: apuesta actual de la mesa · minRaise: subida mínima */
(function (root) {
'use strict';

const RANGOS = '23456789TJQKA', PALOS = '♣♦♥♠';
const rk = c => c % 13, st = c => Math.floor(c / 13);
const nombreCarta = c => (c < 0 ? '??' : RANGOS[rk(c)].replace('T', '10') + PALOS[st(c)]);

/* ---------- Azar ---------- */
function rndPorDefecto() {
  const cr = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : (() => { try { return require('crypto').webcrypto; } catch (e) { return null; } })();
  return n => {
    if (cr) { const a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n; do { cr.getRandomValues(a); } while (a[0] >= lim); return a[0] % n; }
    return Math.floor(Math.random() * n);
  };
}
let RND = rndPorDefecto();
const setRnd = f => { RND = f || rndPorDefecto(); };
function barajar() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = RND(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/* ---------- Evaluación de manos (5 a 7 cartas) ---------- */
const CAT = ['Carta alta', 'Pareja', 'Doble pareja', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color'];
function altaEscalera(mask) {                 // rango más alto de una escalera en la máscara de rangos, o -1
  for (let h = 12; h >= 4; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
  if ((mask & 15) === 15 && (mask >> 12) & 1) return 3;      // rueda A-2-3-4-5
  return -1;
}
const empaca = (cat, r) => { let s = cat * 1048576; for (let i = 0; i < 5; i++) s += (r[i] || 0) << (4 * (4 - i)); return s; };
function evaluar(cards) {
  const cnt = new Array(13).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) { const r = c % 13, s = (c / 13) | 0; cnt[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r; }
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) {
    const h = altaEscalera(sm[s]);
    if (h >= 0) return empaca(8, [h]);
    const top = []; for (let r = 12; r >= 0 && top.length < 5; r--) if ((sm[s] >> r) & 1) top.push(r);
    return empaca(5, top);
  }
  const quad = [], trio = [], par = [];
  for (let r = 12; r >= 0; r--) { if (cnt[r] === 4) quad.push(r); else if (cnt[r] === 3) trio.push(r); else if (cnt[r] === 2) par.push(r); }
  const resto = (excl, n) => { const o = []; for (let r = 12; r >= 0 && o.length < n; r--) if (cnt[r] && !excl.includes(r)) o.push(r); return o; };
  if (quad.length) return empaca(7, [quad[0], ...resto([quad[0]], 1)]);
  if (trio.length && (trio.length > 1 || par.length)) return empaca(6, [trio[0], trio.length > 1 ? Math.max(trio[1], par[0] === undefined ? -1 : par[0]) : par[0]]);
  const h = altaEscalera(mask);
  if (h >= 0) return empaca(4, [h]);
  if (trio.length) return empaca(3, [trio[0], ...resto([trio[0]], 2)]);
  if (par.length >= 2) return empaca(2, [par[0], par[1], ...resto([par[0], par[1]], 1)]);
  if (par.length === 1) return empaca(1, [par[0], ...resto([par[0]], 3)]);
  return empaca(0, resto([], 5));
}
const categoria = score => score >> 20;
const NOMBRES_RANGO = ['doses', 'treses', 'cuatros', 'cincos', 'seises', 'sietes', 'ochos', 'nueves', 'dieces', 'jotas', 'reinas', 'reyes', 'ases'];
const LETRA = r => RANGOS[r].replace('T', '10');
function detalleMano(score) {                       // «Pareja de reinas», «Full de ases y reyes»…
  const cat = score >> 20, r = [0, 1, 2, 3, 4].map(k => (score >> (4 * (4 - k))) & 15);
  const n = x => NOMBRES_RANGO[x];
  if (cat === 1) return 'Pareja de ' + n(r[0]);
  if (cat === 2) return 'Doble pareja de ' + n(r[0]) + ' y ' + n(r[1]);
  if (cat === 3) return 'Trío de ' + n(r[0]);
  if (cat === 4) return 'Escalera al ' + LETRA(r[0] + 0);
  if (cat === 5) return 'Color al ' + LETRA(r[0]);
  if (cat === 6) return 'Full de ' + n(r[0]) + ' y ' + n(r[1]);
  if (cat === 7) return 'Póker de ' + n(r[0]);
  if (cat === 8) return r[0] === 12 ? 'Escalera real' : 'Escalera de color al ' + LETRA(r[0]);
  return 'Carta alta (' + LETRA(r[0]) + ')';
}
const nombreMano = score => (categoria(score) === 8 && ((score >> 16) & 15) === 12) ? 'Escalera real' : CAT[categoria(score)];

/* ---------- Ciegas ---------- */
const NIVELES = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [750, 1500], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000], [4000, 8000], [5000, 10000], [7500, 15000], [10000, 20000]];
function ciegas(nivel) {
  if (nivel < NIVELES.length) return NIVELES[nivel];
  const k = nivel - NIVELES.length + 1, b = NIVELES[NIVELES.length - 1];
  return [b[0] * Math.pow(2, k), b[1] * Math.pow(2, k)];
}

/* ---------- Partida ---------- */
const sigAsiento = (g, i) => (i + 1) % g.n;
const vivos = g => g.seats.map((s, i) => i).filter(i => !g.seats[i].out);
const enMano = g => g.seats.map((s, i) => i).filter(i => !g.seats[i].out && !g.seats[i].fold);
const activos = g => g.seats.map((s, i) => i).filter(i => !g.seats[i].out && !g.seats[i].fold && !g.seats[i].allin);
const bote = g => g.seats.reduce((a, s) => a + s.tot, 0);

/* o = { nombres: [..], bots: [bool..], fichas: 1500, manosNivel: 10 } — de 2 a 9 jugadores */
function nueva(o) {
  const n = o.nombres.length;
  if (n < 2 || n > 9) throw new Error('De 2 a 9 jugadores');
  const fichas = o.fichas || 1500;
  const g = {
    v: 1, n, cfg: { fichas, manosNivel: o.manosNivel || 10 },
    seats: o.nombres.map((nombre, i) => ({ nombre: String(nombre), bot: !!(o.bots && o.bots[i]), stack: fichas, bet: 0, tot: 0, cards: [], fold: false, allin: false, out: false, lastBet: null, place: 0, inicio: fichas })),
    mano: 0, nivel: 0, bb: -1, btn: -1, sbp: -1, fase: 'preflop', board: [], deck: [], bet: 0, minRaise: 0, turno: null,
    resultado: null, ultimo: null, hist: [], orden: [], ganador: null
  };
  repartir(g);
  return g;
}

function repartir(g) {
  g.mano++;
  g.nivel = Math.floor((g.mano - 1) / g.cfg.manosNivel);
  const [sb, bb] = ciegas(g.nivel);
  const v = vivos(g);
  const otro = (a) => v.find(i => i !== a);
  // posiciones (el botón no es de nadie: con asientos vacíos puede quedar muerto, TDA 34)
  const siguienteOcupado = (from) => { let i = from; do { i = sigAsiento(g, i); } while (g.seats[i].out); return i; };
  let bbPos, sbPos, btn;
  if (v.length === 2) {
    if (g.mano === 1) bbPos = v[RND(2)];
    else if (v.includes(g.bb)) bbPos = otro(g.bb);      // el ciego grande no se repite
    else bbPos = siguienteOcupado(g.bb);
    sbPos = otro(bbPos); btn = sbPos;                   // cara a cara: la ciega pequeña es el botón (TDA 36-C)
  } else {
    bbPos = g.mano === 1 ? v[RND(v.length)] : siguienteOcupado(g.bb);
    sbPos = (bbPos - 1 + g.n) % g.n; btn = (bbPos - 2 + g.n) % g.n;
  }
  g.bb = bbPos; g.sbp = sbPos; g.btn = btn;
  g.seats.forEach(s => { s.bet = 0; s.tot = 0; s.cards = []; s.fold = false; s.allin = false; s.lastBet = null; s.inicio = s.stack; });
  g.board = []; g.deck = barajar(); g.resultado = null; g.ultimo = null; g.hist = []; g.fase = 'preflop';
  const poner = (i, x) => { const s = g.seats[i], m = Math.min(x, s.stack); s.stack -= m; s.bet += m; s.tot += m; if (s.stack === 0) s.allin = true; };
  if (!g.seats[sbPos].out) poner(sbPos, sb);            // ciega pequeña muerta si el asiento está vacío
  poner(bbPos, bb);
  g.bet = bb; g.minRaise = bb;
  let i = btn;
  for (let k = 0; k < 2 * g.n; k++) { i = sigAsiento(g, i); if (!g.seats[i].out) g.seats[i].cards.push(g.deck.pop()); }
  avanzar(g, bbPos);
}

/* ---------- Acciones permitidas ---------- */
const puedeSubir = (g, i) => g.seats[i].lastBet === null || (g.bet - g.seats[i].lastBet) >= g.minRaise;
function legal(g, i) {
  const s = g.seats[i];
  if (g.turno !== i) return null;
  const tope = s.stack + s.bet;                                  // lo máximo a lo que puede llegar en esta ronda
  const aIgualar = Math.min(g.bet - s.bet, s.stack);
  const L = { fold: true, check: g.bet === s.bet, call: g.bet > s.bet ? aIgualar : 0, raise: null, allin: tope };
  if (tope > g.bet && puedeSubir(g, i)) {
    const min = Math.min(g.bet + g.minRaise, tope);
    L.raise = { min, max: tope };
  }
  return L;
}

function registrar(g, i, tipo, a) { g.ultimo = { i, tipo, a: a || 0, n: (g.ultimo ? g.ultimo.n : 0) + 1 }; g.hist.push({ i, tipo, a: a || 0, fase: g.fase }); }

/* a = { tipo: 'fold' | 'check' | 'call' | 'raise' | 'allin', a: total al que sube } → null si va bien, o el motivo del error */
function accion(g, i, a) {
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  if (g.fase === 'mano_fin' || g.fase === 'fin' || g.turno === null) return 'Ahora no se puede apostar';
  if (g.turno !== i) return 'No es tu turno';
  const s = g.seats[i], L = legal(g, i);
  let tipo = a.tipo;
  if (tipo === 'allin') tipo = L.raise ? 'raise' : L.check ? 'check' : 'call';     // sin derecho a subir, «todo» es igualar
  if (tipo === 'fold') { s.fold = true; s.lastBet = g.bet; registrar(g, i, 'fold'); }
  else if (tipo === 'check') {
    if (!L.check) return 'No puedes pasar: hay una apuesta';
    s.lastBet = g.bet; registrar(g, i, 'check');
  } else if (tipo === 'call') {
    if (L.check) return 'No hay nada que igualar';
    const m = L.call; s.stack -= m; s.bet += m; s.tot += m; if (s.stack === 0) s.allin = true;
    s.lastBet = g.bet; registrar(g, i, s.allin ? 'allin' : 'call', s.bet);
  } else if (tipo === 'raise') {
    if (!L.raise) return 'No puedes subir ahora';
    let x = a.tipo === 'allin' ? L.allin : Math.floor(Number(a.a));
    if (!Number.isFinite(x)) return 'Cantidad no válida';
    if (x >= L.raise.max) x = L.raise.max;
    else if (x < L.raise.min) return 'La subida mínima es hasta ' + L.raise.min;
    const m = x - s.bet; s.stack -= m; s.bet = x; s.tot += m; if (s.stack === 0) s.allin = true;
    const inc = x - g.bet;
    if (inc >= g.minRaise) g.minRaise = inc;                     // subida completa: fija la nueva mínima
    const eraApuesta = g.bet === 0;                              // (una subida corta de «todo» no reabre la acción: ver puedeSubir)
    g.bet = x; s.lastBet = x;
    registrar(g, i, s.allin ? 'allin' : eraApuesta ? 'bet' : 'raise', x);
  } else return 'Jugada no válida';
  avanzar(g, i);
  return null;
}

/* ---------- Avance de la mano ---------- */
function rondaCompleta(g) {
  if (enMano(g).length <= 1) return true;
  const act = activos(g);
  if (!act.length) return true;
  return act.every(i => { const s = g.seats[i]; return s.bet === g.bet && (s.lastBet !== null || act.length <= 1); });
}
function siguienteActor(g, desde) {
  let i = desde;
  for (let k = 0; k < g.n; k++) {
    i = sigAsiento(g, i);
    const s = g.seats[i];
    if (!s.out && !s.fold && !s.allin && (s.bet < g.bet || s.lastBet === null)) return i;
  }
  return null;
}
function avanzar(g, ultimo) {
  for (let guard = 0; guard < 8; guard++) {
    if (enMano(g).length === 1) { terminarMano(g); return; }
    if (!rondaCompleta(g)) { g.turno = siguienteActor(g, ultimo); if (g.turno === null) { /* no debería pasar */ g.turno = null; } return; }
    if (g.fase === 'river') { terminarMano(g); return; }
    // siguiente calle
    g.seats.forEach(s => { s.bet = 0; s.lastBet = null; });
    g.bet = 0; g.minRaise = ciegas(g.nivel)[1];
    g.deck.pop();                                                 // se quema una carta
    if (g.fase === 'preflop') { g.fase = 'flop'; g.board.push(g.deck.pop(), g.deck.pop(), g.deck.pop()); }
    else { g.fase = g.fase === 'flop' ? 'turn' : 'river'; g.board.push(g.deck.pop()); }
    ultimo = g.btn;                                               // pasa primero quien está a la izquierda del botón (aunque esté vacío)
    g.turno = null;
    if (activos(g).length >= 2) { g.turno = siguienteActor(g, ultimo); return; }
  }
}

/* ---------- Botes (principal y laterales) ---------- */
function botes(g) {
  const noPlegados = g.seats.map((s, i) => i).filter(i => !g.seats[i].out && !g.seats[i].fold && g.seats[i].tot > 0);
  const niveles = [...new Set(noPlegados.map(i => g.seats[i].tot))].sort((a, b) => a - b);
  const out = []; let prev = 0;
  niveles.forEach((L, k) => {
    const tope = k === niveles.length - 1 ? Infinity : L;        // lo que hayan puesto de más los que se retiraron va al bote más alto
    let monto = 0;
    for (const s of g.seats) monto += Math.min(s.tot, tope) - Math.min(s.tot, prev);
    const el = noPlegados.filter(i => g.seats[i].tot >= L);
    if (monto > 0) {
      const last = out[out.length - 1];
      if (last && last.el.join() === el.join()) last.monto += monto; else out.push({ monto, el });
    }
    prev = L;
  });
  return out;
}
function terminarMano(g) {
  const vivosMano = enMano(g);
  const showdown = vivosMano.length > 1;
  if (showdown) while (g.board.length < 5) { if (g.board.length === 0) { g.deck.pop(); g.board.push(g.deck.pop(), g.deck.pop(), g.deck.pop()); } else { g.deck.pop(); g.board.push(g.deck.pop()); } }
  const score = {};
  if (showdown) vivosMano.forEach(i => { score[i] = evaluar([...g.seats[i].cards, ...g.board]); });
  const lista = botes(g), res = { botes: [], mostrar: showdown ? vivosMano.slice() : [], scores: score, showdown };
  // orden para repartir las fichas sobrantes: desde el primero a la izquierda del botón
  const ordenIzq = []; { let i = g.btn; for (let k = 0; k < g.n; k++) { i = sigAsiento(g, i); ordenIzq.push(i); } }
  for (const p of lista) {
    let el = p.el;
    let ganadores;
    if (el.length === 1) ganadores = el;
    else { const mejor = Math.max(...el.map(i => score[i])); ganadores = el.filter(i => score[i] === mejor); }
    const base = Math.floor(p.monto / ganadores.length); let resto = p.monto - base * ganadores.length;
    const ord = ordenIzq.filter(i => ganadores.includes(i));
    ord.forEach(i => { g.seats[i].stack += base + (resto > 0 ? 1 : 0); if (resto > 0) resto--; });
    res.botes.push({ monto: p.monto, el, ganadores: ganadores.slice(), mano: showdown && el.length > 1 ? nombreMano(score[ganadores[0]]) : null });
  }
  g.resultado = res; g.fase = 'mano_fin'; g.turno = null;
}

/* Pasa a la mano siguiente (o termina el torneo). Los eliminados se ordenan por las fichas que tenían al empezar la mano. */
function siguienteMano(g) {
  if (g.fase !== 'mano_fin') return false;
  const caidos = g.seats.map((s, i) => i).filter(i => !g.seats[i].out && g.seats[i].stack === 0);
  let quedan = vivos(g).length;
  caidos.sort((a, b) => g.seats[a].inicio - g.seats[b].inicio || b - a);
  caidos.forEach(i => { g.seats[i].out = true; g.seats[i].place = quedan--; g.orden.unshift(i); });
  const v = vivos(g);
  if (v.length <= 1) {
    const w = v[0]; g.seats[w].place = 1; g.orden.unshift(w); g.ganador = w; g.fase = 'fin'; g.turno = null; return true;
  }
  repartir(g);
  return true;
}

/* ---------- Vista para un jugador (el servidor no manda cartas ajenas) ---------- */
function vista(g, yo) {
  const mostrar = (g.resultado && g.resultado.mostrar) || [];
  const o = JSON.parse(JSON.stringify(g));
  delete o.deck;
  o.seats.forEach((s, i) => { if (i !== yo && !mostrar.includes(i)) s.cards = s.cards.map(() => -1); });
  o.yo = yo;
  return o;
}

/* ---------- Máquina ---------- */
function chen(c1, c2) {
  let r1 = rk(c1), r2 = rk(c2); if (r1 < r2) [r1, r2] = [r2, r1];
  const val = r => r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2;
  let s = val(r1);
  if (r1 === r2) s = Math.max(5, s * 2);
  else {
    if (st(c1) === st(c2)) s += 2;
    const gap = r1 - r2 - 1;
    s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && r1 < 10) s += 1;
  }
  return Math.ceil(s);
}
// Equidad aproximada (Monte Carlo) contra jugadores con manos al azar
function equidad(hole, board, nOpp, sims) {
  const usadas = new Set([...hole, ...board]);
  const rest = []; for (let c = 0; c < 52; c++) if (!usadas.has(c)) rest.push(c);
  const faltan = 5 - board.length, need = faltan + 2 * nOpp;
  let pts = 0;
  for (let s = 0; s < sims; s++) {
    for (let k = 0; k < need; k++) { const j = k + RND(rest.length - k); const t = rest[k]; rest[k] = rest[j]; rest[j] = t; }
    const full = board.concat(rest.slice(0, faltan));
    const mio = evaluar(hole.concat(full));
    let mejor = true, empates = 0;
    for (let o = 0; o < nOpp; o++) {
      const sc = evaluar([rest[faltan + 2 * o], rest[faltan + 2 * o + 1]].concat(full));
      if (sc > mio) { mejor = false; break; }
      if (sc === mio) empates++;
    }
    if (mejor) pts += 1 / (empates + 1);
  }
  return pts / sims;
}
const redondea = (x, b) => Math.max(b, Math.round(x / 5) * 5);
function posicionTardia(g, i) {                                   // 0 (primero en hablar) … 1 (botón)
  const v = enMano(g).length; let k = 0, j = g.btn;
  for (let t = 0; t < g.n; t++) { j = sigAsiento(g, j); if (j === i) break; if (!g.seats[j].out && !g.seats[j].fold) k++; }
  return v <= 1 ? 1 : 1 - k / (v - 1);
}
/* Elige la jugada de la máquina. nivel: 1 fácil, 2 normal, 3 difícil. Devuelve { tipo, a } */
function elegir(g, i, nivel, opt) {
  nivel = nivel || 2;
  const det = !!(opt && opt.det);                                  // determinista (para los consejos del modo aprendizaje)
  const s = g.seats[i], L = legal(g, i), bb = ciegas(g.nivel)[1];
  const pot = bote(g), aIgualar = Math.max(0, g.bet - s.bet), rivales = Math.max(1, enMano(g).length - 1);
  const stackBB = (s.stack + s.bet) / bb, r = det ? () => 0.5 : Math.random;
  const pasa = () => L.check ? { tipo: 'check' } : { tipo: 'fold' };
  const iguala = () => L.check ? { tipo: 'check' } : { tipo: 'call' };
  const sube = (frac, extra) => {
    if (!L.raise) return iguala();
    const objetivo = g.bet + Math.max(g.minRaise, Math.round((pot + aIgualar) * frac)) + (extra || 0);
    const a = Math.min(L.raise.max, Math.max(L.raise.min, redondea(objetivo, L.raise.min)));
    return { tipo: 'raise', a };
  };
  const todo = () => L.raise ? { tipo: 'raise', a: L.raise.max } : iguala();
  const tarde = posicionTardia(g, i);
  const ruido = det ? 0 : nivel === 1 ? 0.30 : nivel === 2 ? 0.07 : 0.03;

  if (g.fase === 'preflop') {
    const c = chen(s.cards[0], s.cards[1]);
    const f = Math.min(1, Math.max(0, (c + 1) / 21 + (r() - 0.5) * 2 * ruido));
    const subido = g.bet > bb;                                      // alguien ha subido
    const ancho = nivel === 1 ? 0 : Math.max(0, 6 - vivos(g).length) * 0.05;   // con pocos jugadores se juegan más manos
    const caro = aIgualar > s.stack * 0.35;
    if (stackBB <= 10) {                                            // poco dinero: todo o nada
      const umbral = nivel === 1 ? 0.5 : (0.52 - (1 - stackBB / 10) * 0.12 - tarde * 0.06 - ancho * 0.6);
      if (f >= umbral) return todo();
      return pasa();
    }
    if (!subido) {
      const umbral = (nivel === 1 ? 0.5 : nivel === 2 ? 0.46 - tarde * 0.06 : 0.44 - tarde * 0.07) - ancho;
      if (f >= umbral + (nivel === 3 ? 0.14 : 0.18) || (nivel === 3 && tarde > 0.7 && f >= umbral + 0.04 && r() < 0.4)) return sube(nivel === 3 ? 0.9 : 0.75, bb);
      if (nivel === 1 && f >= 0.34) return iguala();
      if (L.check) return iguala();
      if (f >= umbral - 0.06 && aIgualar <= bb && nivel >= 2) return iguala();
      if (nivel === 1 && f >= 0.28 && aIgualar <= bb) return iguala();
      return pasa();
    }
    // hay una subida
    if (f >= 0.88) return nivel === 1 && r() < 0.5 ? iguala() : sube(1.0, 0);
    if (nivel === 3 && f >= 0.74 && !caro && r() < 0.4) return sube(1.0, 0);          // sube de nuevo con manos fuertes
    if (f >= (caro ? 0.7 : nivel === 1 ? 0.42 : 0.55 - tarde * 0.05 - ancho * 0.6)) return iguala();
    if (nivel === 3 && f >= 0.48 && aIgualar <= bb * 3 && tarde > 0.5 && !caro) return iguala();
    return pasa();
  }

  // después del flop
  const sims = det ? 300 : nivel === 1 ? 40 : nivel === 2 ? 100 : 180;
  const opp = Math.min(5, rivales);
  let eq = equidad(s.cards, g.board, opp, sims);
  eq = Math.min(1, Math.max(0, eq + (r() - 0.5) * 2 * ruido));
  if (nivel === 3 && aIgualar > 0) eq = Math.max(0, eq - Math.min(0.22, 0.2 * aIgualar / Math.max(1, pot - aIgualar)));   // quien apuesta suele tener mejor mano que una al azar
  const odds = aIgualar > 0 ? aIgualar / (pot + aIgualar) : 0;
  const comprometido = s.tot > 0 && aIgualar >= s.stack * 0.9;
  if (aIgualar === 0) {                                              // nadie ha apostado
    if (eq > 0.74) return r() < 0.88 ? sube(0.66) : iguala();
    if (eq > (nivel === 1 ? 0.7 : nivel === 3 ? 0.55 : 0.58)) return r() < (nivel === 1 ? 0.3 : nivel === 3 ? 0.75 : 0.65) ? sube(nivel === 3 ? 0.6 : 0.5) : iguala();
    if (nivel === 3 && rivales <= 1 && eq > 0.4 && r() < 0.1 + 0.1 * tarde) return sube(0.5);              // farol con algo de mano, solo contra uno
    if (nivel === 3 && eq > 0.36 && g.fase !== 'river' && rivales <= 2 && r() < 0.2) return sube(0.5);        // semifarol
    return iguala();
  }
  const margen = nivel === 1 ? 0.0 : nivel === 2 ? 0.04 : 0.02;
  if (eq > 0.85 || (eq > 0.72 && nivel >= 2 && r() < 0.5)) return stackBB < 25 || comprometido ? todo() : sube(nivel === 1 ? 0.5 : 0.8);
  if (nivel === 1) {                                                  // el fácil iguala mucho y se asusta de las apuestas grandes
    if (eq > odds + margen || (r() < 0.25 && aIgualar < pot * 0.5)) return aIgualar > s.stack * 0.5 && eq < 0.55 ? pasa() : iguala();
    return pasa();
  }
  if (eq > odds + margen + (aIgualar > pot ? 0.06 : 0)) return iguala();
  return pasa();
}

/* ---------- Modo aprendizaje: explica la mano y sugiere qué hacer ---------- */
function describirSalida(c1, c2) {
  let r1 = rk(c1), r2 = rk(c2); if (r1 < r2) [r1, r2] = [r2, r1];
  if (r1 === r2) return 'Pareja de ' + NOMBRES_RANGO[r1];
  return LETRA(r1) + ' ' + LETRA(r2) + (st(c1) === st(c2) ? ' del mismo palo' : ' de distinto palo');
}
function fuerzaSalida(c) { return c >= 12 ? 'Premium' : c >= 9 ? 'Muy buena' : c >= 7 ? 'Buena' : c >= 5 ? 'Jugable' : 'Floja'; }
// Cartas que mejorarían tu mano (de las que aún no se han visto)
function outs(cartas, board) {
  if (board.length < 3 || board.length > 4) return null;
  const base = categoria(evaluar(cartas.concat(board))), vistas = new Set(cartas.concat(board));
  let n = 0, tot = 0;
  for (let c = 0; c < 52; c++) { if (vistas.has(c)) continue; tot++; if (categoria(evaluar(cartas.concat(board, [c]))) > base) n++; }
  return { n, de: tot, p: n / tot };
}
const pct = x => Math.round(x * 100) + ' %';
function consejo(g, i) {
  const s = g.seats[i], L = legal(g, i);
  if (!L || s.cards.length < 2 || s.cards[0] < 0) return null;
  const bb = ciegas(g.nivel)[1], aIgualar = Math.max(0, g.bet - s.bet), pot = bote(g);
  const rivales = Math.max(1, enMano(g).length - 1);
  const a = elegir(g, i, 3, { det: true });
  const lineas = [];
  let titulo, eq = null, nec = null;
  if (g.fase === 'preflop') {
    const c = chen(s.cards[0], s.cards[1]);
    titulo = describirSalida(s.cards[0], s.cards[1]) + ' · ' + fuerzaSalida(c);
    eq = equidad(s.cards, [], Math.min(5, rivales), 300);
    lineas.push('Tu mano de salida es «' + titulo + '». Contra ' + (rivales === 1 ? 'un rival' : rivales + ' rivales') + ' con cartas al azar la ganas ≈ ' + pct(eq) + ' de las veces.');
    if (rivales >= 3) lineas.push('Con varios rivales hace falta más mano: cuantos más jugadores, menos ganan las manos flojas.');
  } else {
    const sc = evaluar(s.cards.concat(g.board));
    titulo = detalleMano(sc);
    eq = equidad(s.cards, g.board, Math.min(5, rivales), 300);
    lineas.push('Ahora tienes «' + titulo + '». Contra ' + (rivales === 1 ? 'un rival' : rivales + ' rivales') + ' con cartas al azar la ganas ≈ ' + pct(eq) + ' de las veces.');
    const o = outs(s.cards, g.board);
    if (o && o.n > 0 && categoria(sc) < 6) lineas.push('Te sirven ' + o.n + ' cartas de las ' + o.de + ' que no has visto para mejorar tu mano (≈ ' + pct(o.p) + ' en la próxima carta).');
  }
  if (aIgualar > 0) {
    nec = aIgualar / (pot + aIgualar);
    lineas.push('Para igualar pones ' + Math.min(aIgualar, s.stack) + ' y el bote es ' + pot + ': necesitas ganar más de ' + pct(nec) + ' de las veces para que compense («probabilidad del bote»).');
  }
  const accion = a;
  let que;
  if (a.tipo === 'fold') que = 'Retirarte. ' + (nec != null ? 'Tu ' + pct(eq) + ' no llega al ' + pct(nec) + ' que necesitas, o la apuesta es demasiado grande para lo que llevas.' : 'Con esta mano no merece la pena seguir.');
  else if (a.tipo === 'check') que = 'Pasar (check): es gratis y ves la siguiente carta sin arriesgar fichas.';
  else if (a.tipo === 'call') que = nec != null && eq < nec ? 'Igualar (call) es algo justo: tu ' + pct(eq) + ' queda cerca del ' + pct(nec) + ' necesario, pero el precio es bajo y puedes mejorar en la siguiente carta. Si te suben mucho, retírate.' : 'Igualar (call): tu mano gana lo suficiente (' + pct(eq) + ' frente al ' + (nec != null ? pct(nec) : '') + ' necesario) para que compense pagar.';
  else if (a.tipo === 'raise' && L.raise && a.a >= L.raise.max) que = 'Ir con todo (all-in): tienes una mano fuerte para tu situación' + (s.stack + s.bet <= 10 * bb ? ' y te quedan pocas fichas (menos de 10 ciegas grandes), así que lo mejor es jugarlas.' : '.');
  else que = 'Subir hasta ' + a.a + ': con ' + pct(eq) + ' de ganar, apostar saca más fichas a las manos peores y echa a las que podrían mejorar.';
  lineas.push('💡 Sugerencia: ' + que);
  return { titulo, eq, necesaria: nec, accion, lineas, que };
}

const Poker = { RANGOS, PALOS, nombreCarta, rk, st, evaluar, categoria, nombreMano, detalleMano, CAT, ciegas, NIVELES, nueva, repartir, legal, accion, siguienteMano, bote, botes, vivos, enMano, activos, vista, chen, equidad, elegir, consejo, outs, describirSalida, fuerzaSalida, barajar, setRnd, puedeSubir };
if (typeof module !== 'undefined' && module.exports) module.exports = Poker;
root.Poker = Poker;
})(typeof self !== 'undefined' ? self : globalThis);
