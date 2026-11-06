/* UNO — reglas y máquina (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.
   Es el MISMO archivo en la app (www/uno.js) y en el servidor de juegos (motores/uno/uno.js). Sin dependencias.
   Reglas: ver REGLAS.md (hoja de instrucciones oficial de Mattel). Opciones: acumular +2/+4, 7-0, castigo por no decir UNO (2 o 4).

   Carta = número: color*16 + tipo.  color 0 Rojo · 1 Amarillo · 2 Verde · 3 Azul · 4 Comodín
   tipo 0–9 número · 10 Salta · 11 Cambio de sentido · 12 +2 · 13 Comodín · 14 Comodín +4
   Estado (JSON puro, se puede guardar):
     seats[i] = { nombre, bot, mano:[cartas], puntos, place, dec }   dec = ya ha dicho «UNO»
     top: carta de arriba del descarte · color: color en juego · dir: 1 | -1 · turno: asiento al que le toca
     pend: { n, tipo:'d2'|'d4', retable, culpable, de } castigo pendiente de aceptar, devolver (acumular) o desafiar
     expuesto: { i } jugador con una carta que no dijo UNO (se le puede «pillar» hasta que juegue el siguiente)
     drawn: carta recién robada y jugable (solo se puede jugar esa o pasar)
     fase: 'jugando' | 'ronda_fin' | 'fin' */
(function (root) {
'use strict';

function rndPorDefecto() {
  const cr = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : (() => { try { return require('crypto').webcrypto; } catch (e) { return null; } })();
  return n => {
    if (cr) { const a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n; do { cr.getRandomValues(a); } while (a[0] >= lim); return a[0] % n; }
    return Math.floor(Math.random() * n);
  };
}
let RND = rndPorDefecto();
const setRnd = f => { RND = f || rndPorDefecto(); };

const COLORES = ['Rojo', 'Amarillo', 'Verde', 'Azul'];
const SKIP = 10, REV = 11, D2 = 12, WILD = 13, D4 = 14;
const col = c => c >> 4, tp = c => c & 15;
const esComodin = c => col(c) === 4;
const carta = (color, tipo) => color * 16 + tipo;
const NOMBRE_TIPO = { 10: 'Salta', 11: 'Cambio de sentido', 12: '+2', 13: 'Comodín', 14: 'Comodín +4' };
function nombreCarta(c) {
  const t = tp(c);
  if (esComodin(c)) return NOMBRE_TIPO[t];
  return (t <= 9 ? String(t) : NOMBRE_TIPO[t]) + ' ' + COLORES[col(c)].toLowerCase();
}
const puntosCarta = c => { const t = tp(c); return t <= 9 ? t : t <= 12 ? 20 : 50; };
const puntosMano = m => m.reduce((s, c) => s + puntosCarta(c), 0);

function mazoNuevo() {
  const m = [];
  for (let c = 0; c < 4; c++) {
    m.push(carta(c, 0));
    for (let t = 1; t <= 12; t++) { m.push(carta(c, t)); m.push(carta(c, t)); }
  }
  for (let k = 0; k < 4; k++) { m.push(carta(4, WILD)); m.push(carta(4, D4)); }
  return m;                                                   // 108 cartas
}
function barajar(a) { for (let i = a.length - 1; i > 0; i--) { const j = RND(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

const sig = (g, i, pasos) => (((i + g.dir * (pasos == null ? 1 : pasos)) % g.n) + g.n) % g.n;
const tengoColor = (g, m) => m.some(c => col(c) === g.color);

/* ¿Se puede jugar esta carta ahora (sin castigo pendiente)? */
function coincide(g, m, c) {
  if (esComodin(c)) return tp(c) === WILD || !tengoColor(g, m);        // el +4 solo si no tienes el color en juego
  return col(c) === g.color || tp(c) === tp(g.top);
}
/* Con castigo pendiente y «acumular»: solo se puede devolver con la misma carta */
const puedeApilar = (g, c) => !!(g.cfg.acum && g.pend && tp(c) === (g.pend.tipo === 'd2' ? D2 : D4));

function nueva(o) {
  o = o || {};
  const nombres = o.nombres || ['Tú', 'Máquina'];
  const n = nombres.length;
  const g = {
    n, cfg: { meta: [0, 200, 500, 1000].includes(+o.meta) ? +o.meta : 500, acum: !!o.acum, siete0: !!o.siete0, penal: +o.penal === 2 ? 2 : 4 },
    seats: nombres.map((nm, i) => ({ nombre: nm, bot: !!(o.bots && o.bots[i]), mano: [], puntos: 0, place: 0, dec: false })),
    ronda: 0, dealer: RND(n), mazo: [], desc: [], top: 0, color: 0, dir: 1, turno: 0, pend: null, expuesto: null, drawn: null,
    eligeColor: false, cierre: null, fase: 'jugando', ultimo: { n: 0 }, resultado: null, orden: [], mem: { falta: nombres.map(() => 0) }
  };
  repartir(g);
  return g;
}

function sacar(g) {
  if (!g.mazo.length) {
    if (g.desc.length <= 1) return null;
    const tope = g.desc.pop();
    g.mazo = barajar(g.desc); g.desc = [tope];
  }
  return g.mazo.pop();
}
function robarN(g, i, n) {
  const s = g.seats[i]; let k = 0;
  for (; k < n; k++) { const c = sacar(g); if (c == null) break; s.mano.push(c); }
  if (s.mano.length > 1) s.dec = false;
  return k;
}
const nota = (g, o) => { g.ultimo = Object.assign({ n: g.ultimo.n + 1 }, o); };

function repartir(g) {
  g.ronda++;
  if (g.ronda > 1) g.dealer = (g.dealer + 1) % g.n;
  g.mazo = barajar(mazoNuevo()); g.desc = [];
  g.seats.forEach(s => { s.mano = []; s.dec = false; });
  for (let k = 0; k < 7; k++) for (let i = 0; i < g.n; i++) g.seats[i].mano.push(g.mazo.pop());
  let t;
  do { t = g.mazo.pop(); if (tp(t) === D4) { g.mazo.unshift(t); t = null; } } while (t == null);   // un +4 inicial se devuelve al mazo
  g.desc.push(t); g.top = t; g.color = esComodin(t) ? 0 : col(t);
  g.dir = 1; g.pend = null; g.expuesto = null; g.drawn = null; g.eligeColor = false; g.cierre = null; g.resultado = null; g.fase = 'jugando';
  g.turno = sig(g, g.dealer);
  const tt = tp(t);
  if (tt === SKIP) { nota(g, { tipo: 'inicio', carta: t, i: g.turno, efecto: 'salta' }); g.turno = sig(g, g.turno); }
  else if (tt === REV) { g.dir = -1; g.turno = g.dealer; nota(g, { tipo: 'inicio', carta: t, i: g.turno, efecto: 'sentido' }); }
  else if (tt === D2) { const v = g.turno; robarN(g, v, 2); nota(g, { tipo: 'inicio', carta: t, i: v, efecto: 'roba', cantidad: 2 }); g.turno = sig(g, v); }
  else if (tt === WILD) { g.eligeColor = true; nota(g, { tipo: 'inicio', carta: t, i: g.turno, efecto: 'color' }); }
  else nota(g, { tipo: 'inicio', carta: t, i: g.dealer });
}

/* ---------- Qué puede hacer cada jugador ---------- */
function legal(g, i) {
  const L = { jugables: [], robar: false, pasar: false, retar: false, color: false, pillar: false, uno: false, apilar: false };
  if (g.fase !== 'jugando') return L;
  const s = g.seats[i];
  if (g.expuesto && g.expuesto.i !== i) L.pillar = true;
  if (g.turno !== i) return L;
  if (g.eligeColor) { L.color = true; return L; }
  if (g.pend) {
    L.robar = true;
    if (g.pend.retable && g.pend.tipo === 'd4') L.retar = true;
    if (g.cfg.acum) { L.jugables = s.mano.filter(c => puedeApilar(g, c)); L.apilar = L.jugables.length > 0; }
    return L;
  }
  if (g.drawn != null) { L.jugables = [g.drawn]; L.pasar = true; if (s.mano.length === 2) L.uno = !s.dec; return L; }
  L.jugables = s.mano.filter(c => coincide(g, s.mano, c));
  L.robar = true;
  if (s.mano.length === 2) L.uno = !s.dec;
  return L;
}

function avanzar(g, desde, pasos) { g.turno = sig(g, desde, pasos); }
function finRonda(g, gan) {
  const manos = g.seats.map(s => s.mano.slice());
  let pts = 0; g.seats.forEach((s, k) => { if (k !== gan) pts += puntosMano(s.mano); });
  g.seats[gan].puntos += pts;
  g.resultado = { ganador: gan, puntos: pts, manos, porMano: manos.map(puntosMano) };
  g.pend = null; g.expuesto = null; g.drawn = null; g.eligeColor = false; g.cierre = null; g.turno = null;
  const meta = g.cfg.meta;
  if (meta === 0 || g.seats[gan].puntos >= meta) {
    g.fase = 'fin';
    const idx = g.seats.map((_, k) => k);
    idx.sort((a, b) => (b === gan) - (a === gan) || g.seats[b].puntos - g.seats[a].puntos || puntosMano(g.seats[a].mano) - puntosMano(g.seats[b].mano) || a - b);
    if (meta === 0) idx.sort((a, b) => (b === gan) - (a === gan) || puntosMano(g.seats[a].mano) - puntosMano(g.seats[b].mano) || a - b);
    g.orden = idx; idx.forEach((k, r) => { g.seats[k].place = r + 1; });
  } else g.fase = 'ronda_fin';
}
function siguienteRonda(g) {
  if (g.fase !== 'ronda_fin') return false;
  repartir(g); return true;
}
function cierraSiGano(g) {                                     // tras resolver un castigo: ¿había terminado la mano quien lo puso?
  if (g.cierre != null && g.seats[g.cierre].mano.length === 0) { finRonda(g, g.cierre); return true; }
  g.cierre = null; return false;
}

/* ---------- Jugadas ---------- */
function accion(g, i, a) {
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  if (g.fase !== 'jugando') return 'La mano ha terminado';
  const s = g.seats[i]; if (!s) return 'No estás en la mesa';
  const t = a.tipo;
  if (t === 'pillar') {
    const e = g.expuesto; if (!e || e.i === i) return 'No hay a quién pillar';
    const k = robarN(g, e.i, g.cfg.penal); g.expuesto = null;
    nota(g, { tipo: 'pillar', i, obj: e.i, cantidad: k });
    return null;
  }
  if (t === 'uno') {
    if (g.expuesto && g.expuesto.i === i) { g.expuesto = null; s.dec = true; nota(g, { tipo: 'uno', i }); return null; }
    if (g.turno === i && s.mano.length === 2) { s.dec = true; nota(g, { tipo: 'uno', i }); return null; }
    return 'Solo se dice UNO al quedarte con una carta';
  }
  if (g.turno !== i) return 'No es tu turno';
  if (g.eligeColor) {
    if (t !== 'color' || !(a.color >= 0 && a.color <= 3)) return 'Elige un color';
    g.color = a.color | 0; g.eligeColor = false; nota(g, { tipo: 'color', i, color: g.color }); return null;
  }
  if (g.expuesto && g.expuesto.i !== i) g.expuesto = null;           // empieza el turno del siguiente: ya no se le puede pillar
  if (t === 'robar') {
    if (g.pend) {
      const p = g.pend; g.pend = null;
      const k = robarN(g, i, p.n);
      nota(g, { tipo: 'robar', i, cantidad: k, castigo: true });
      if (!cierraSiGano(g)) avanzar(g, i);
      return null;
    }
    if (g.drawn != null) return 'Ya has robado: juega esa carta o pasa';
    const c = sacar(g);
    if (c == null) { nota(g, { tipo: 'pasar', i }); avanzar(g, i); return null; }
    s.mano.push(c); if (s.mano.length > 1) s.dec = false;
    g.mem.falta[i] |= 1 << g.color;
    if (coincide(g, s.mano, c)) { g.drawn = c; nota(g, { tipo: 'robar', i, cantidad: 1, jugable: true }); }
    else { nota(g, { tipo: 'robar', i, cantidad: 1, jugable: false }); avanzar(g, i); }
    return null;
  }
  if (t === 'pasar') {
    if (g.drawn == null) return 'Solo puedes pasar después de robar';
    g.drawn = null; nota(g, { tipo: 'pasar', i }); avanzar(g, i); return null;
  }
  if (t === 'retar') {
    const p = g.pend; if (!p || !p.retable || p.tipo !== 'd4') return 'No hay nada que desafiar';
    g.pend = null;
    const j = p.de;
    if (p.culpable) {                                                // el +4 era ilegal: lo roba quien lo jugó y tú juegas normal
      const k = robarN(g, j, 4);
      nota(g, { tipo: 'retar', i, obj: j, ok: true, cantidad: k });
      g.cierre = null;
    } else {                                                         // era legal: robas 4 + 2 y pierdes el turno
      const k = robarN(g, i, 6);
      nota(g, { tipo: 'retar', i, obj: j, ok: false, cantidad: k });
      if (!cierraSiGano(g)) avanzar(g, i);
    }
    return null;
  }
  if (t !== 'jugar') return 'Jugada no válida';
  const c = a.carta | 0;
  const pos = s.mano.indexOf(c);
  if (pos < 0) return 'Esa carta no es tuya';
  if (g.pend) { if (!puedeApilar(g, c)) return 'Tienes que robar ' + g.pend.n + (g.cfg.acum ? ' o devolver el castigo con otra igual' : ''); }
  else if (g.drawn != null) { if (c !== g.drawn) return 'Solo puedes jugar la carta que has robado'; }
  else if (!coincide(g, s.mano, c)) return esComodin(c) && tp(c) === D4 ? 'El +4 solo se puede jugar si no tienes ninguna carta del color en juego' : 'Esa carta no coincide';
  const tt = tp(c);
  if (esComodin(c) && !(a.color >= 0 && a.color <= 3)) return 'Elige un color';
  if (g.cfg.siete0 && tt === 7 && !g.pend) { if (!(Number.isInteger(a.objetivo) && a.objetivo !== i && a.objetivo >= 0 && a.objetivo < g.n)) return 'Elige con quién cambias la mano'; }
  const colorAntes = g.color;
  const culpable = tt === D4 && tengoColor({ color: colorAntes }, s.mano.filter((_, k) => k !== pos));
  s.mano.splice(pos, 1); g.desc.push(c); g.top = c; g.drawn = null;
  g.color = esComodin(c) ? (a.color | 0) : col(c);
  if (a.uno && s.mano.length === 1) s.dec = true;
  if (s.mano.length > 1) s.dec = false;
  const info = { tipo: 'jugar', i, carta: c, color: g.color };
  const vacia = s.mano.length === 0;
  if (tt === SKIP) { info.salta = sig(g, i); nota(g, info); if (vacia) { finRonda(g, i); return null; } avanzar(g, i, 2); }
  else if (tt === REV) {
    g.dir = -g.dir; info.sentido = true; nota(g, info);
    if (vacia) { finRonda(g, i); return null; }
    if (g.n === 2) g.turno = i; else avanzar(g, i);
  }
  else if (tt === D2) {
    if (g.cfg.acum) {
      g.pend = g.pend ? { n: g.pend.n + 2, tipo: 'd2', retable: false, culpable: false, de: i } : { n: 2, tipo: 'd2', retable: false, culpable: false, de: i };
      info.castigo = g.pend.n; nota(g, info);
      if (vacia) g.cierre = i;
      avanzar(g, i);
    } else {
      const v = sig(g, i); const k = robarN(g, v, 2); info.roba = v; info.cantidad = k; nota(g, info);
      if (vacia) { finRonda(g, i); return null; }
      avanzar(g, i, 2);
    }
  }
  else if (tt === D4) {
    if (g.cfg.acum && g.pend) g.pend = { n: g.pend.n + 4, tipo: 'd4', retable: false, culpable: false, de: i };
    else g.pend = { n: 4, tipo: 'd4', retable: true, culpable, de: i, antes: colorAntes };
    info.castigo = g.pend.n; nota(g, info);
    if (vacia) g.cierre = i;
    avanzar(g, i);
  }
  else {
    if (g.cfg.siete0 && tt === 7) {
      const o = a.objetivo, tmp = g.seats[i].mano; g.seats[i].mano = g.seats[o].mano; g.seats[o].mano = tmp;
      info.cambia = o; g.seats.forEach(x => { if (x.mano.length !== 1) x.dec = false; });
    } else if (g.cfg.siete0 && tt === 0) {
      const ms = g.seats.map(x => x.mano);
      g.seats.forEach((x, k) => { x.mano = ms[(((k - g.dir) % g.n) + g.n) % g.n]; });
      info.rota = true; g.seats.forEach(x => { if (x.mano.length !== 1) x.dec = false; });
    }
    nota(g, info);
    if (vacia) { finRonda(g, i); return null; }
    avanzar(g, i);
  }
  if (g.fase === 'jugando' && g.seats[i].mano.length === 1 && !g.seats[i].dec) g.expuesto = { i };
  // con 7-0 puede haber cambiado quién tiene una sola carta
  if (g.fase === 'jugando' && g.cfg.siete0 && info.cambia != null) { const o = info.cambia; if (g.seats[o].mano.length === 1 && !g.seats[o].dec) g.expuesto = { i: o }; }
  return null;
}

/* ---------- Vista de cada jugador ---------- */
function vista(g, yo) {
  const o = {
    n: g.n, cfg: g.cfg, ronda: g.ronda, dealer: g.dealer, top: g.top, color: g.color, dir: g.dir, turno: g.turno, fase: g.fase,
    pend: g.pend ? { n: g.pend.n, tipo: g.pend.tipo, retable: g.pend.retable, de: g.pend.de, antes: g.pend.antes } : null,
    expuesto: g.expuesto ? { i: g.expuesto.i } : null, eligeColor: !!g.eligeColor, ultimo: g.ultimo, resultado: g.resultado, orden: g.orden.slice(),
    mazoN: g.mazo.length, descN: g.desc.length, desc: g.desc.slice(), mem: { falta: g.mem.falta.slice() }, yo,
    drawn: yo != null && yo === g.turno && g.drawn != null ? g.drawn : null,
    seats: g.seats.map((s, k) => ({ nombre: s.nombre, bot: s.bot, puntos: s.puntos, place: s.place, dec: s.dec, n: s.mano.length,
      mano: (k === yo || g.fase !== 'jugando') ? s.mano.slice() : s.mano.map(() => -1) }))
  };
  return o;
}

/* ---------- Máquina ---------- */
const NIV = { 1: { uno: 0.6, pilla: 0.25, apila: 0.4, reta: 0.15 }, 2: { uno: 0.88, pilla: 0.55, apila: 0.85, reta: 0.5 }, 3: { uno: 1, pilla: 0.9, apila: 1, reta: 1 } };
const cuentaColores = m => { const c = [0, 0, 0, 0]; m.forEach(x => { if (!esComodin(x)) c[col(x)]++; }); return c; };
function mejorColor(m, g, nivel, quitar) {
  if (nivel === 1 && RND(3) === 0) return RND(4);
  const c = cuentaColores(quitar == null ? m : m.filter(x => x !== quitar));
  let b = -1, bi = [];
  c.forEach((v, k) => { let w = v * 10; if (nivel === 3 && g) { const nx = g.seats[sig(g, g.turno)]; if (nx && (g.mem.falta[sig(g, g.turno)] >> k) & 1) w += 4; } if (w > b) { b = w; bi = [k]; } else if (w === b) bi.push(k); });
  return bi[RND(bi.length)];
}
/* Probabilidad de que un +4 jugado por «de» fuera ilegal (para desafiar) */
function probCulpable(g, de) {
  const antes = g.pend && g.pend.antes != null ? g.pend.antes : g.color;
  const h = g.seats[de].mano.length + 1;                            // cartas que tenía al jugarlo
  const vistas = g.desc.filter(c => !esComodin(c) && col(c) === antes).length;   // descartes de ese color
  const quedan = Math.max(1, 25 - vistas), sinVer = Math.max(1, (g.mazo ? g.mazo.length : g.mazoN) + g.seats.reduce((t, s, k) => t + (k === g.turno ? 0 : s.mano.length), 0));
  const q = Math.min(0.5, quedan / sinVer);
  return 1 - Math.pow(1 - q, Math.max(0, h - 1));
}

function elegirDetalle(g, i, nivel, sinPillar) {
  const s = g.seats[i], N = NIV[nivel] || NIV[2], m = s.mano;
  if (!sinPillar && g.expuesto && g.expuesto.i !== i && RND(1000) / 1000 < N.pilla) return { a: { tipo: 'pillar' }, why: 'pillar' };
  if (g.eligeColor) return { a: { tipo: 'color', color: mejorColor(m, g, nivel) }, why: 'color' };
  const L = legal(g, i);
  if (g.pend) {
    if (L.retar) {
      const p = probCulpable(g, g.pend.de);
      const ok = nivel === 3 ? p > 0.34 : nivel === 2 ? p > 0.5 && RND(100) < 60 : RND(1000) / 1000 < N.reta * 0.3;
      if (ok) return { a: { tipo: 'retar' }, why: 'retar', p };
    }
    if (L.apilar && RND(1000) / 1000 < N.apila) { const c = L.jugables[0]; return { a: { tipo: 'jugar', carta: c, color: esComodin(c) ? mejorColor(m, g, nivel, c) : undefined }, why: 'apilar' }; }
    return { a: { tipo: 'robar' }, why: 'castigo' };
  }
  const unoSi = (c) => m.length === 2 && RND(1000) / 1000 < N.uno;
  const nx = sig(g, i), cn = g.seats[nx].mano.length;
  if (g.drawn != null) {
    const c = g.drawn;
    if (nivel === 1 && RND(5) === 0) return { a: { tipo: 'pasar' }, why: 'pasar' };
    return { a: jugarCarta(c, m, g, nivel, unoSi(c), i), why: 'robada' };
  }
  if (!L.jugables.length) return { a: { tipo: 'robar' }, why: 'robar' };
  if (nivel === 1) {
    const sinC = L.jugables.filter(c => !esComodin(c)), pool = sinC.length ? sinC : L.jugables;
    return { a: jugarCarta(pool[RND(pool.length)], m, g, nivel, unoSi(), i), why: 'azar' };
  }
  const cc = cuentaColores(m), colores = cc.filter(v => v > 0).length;
  let best = null, bs = -1e9, razon = 'puntos';
  L.jugables.forEach(c => {
    const t = tp(c); let sc = puntosCarta(c) / 10, r = 'puntos';
    if (esComodin(c)) {
      sc -= 5; r = 'guardar';
      if (L.jugables.length === 1) { sc += 8; r = 'unica'; }
      if (m.length <= 2) { sc += 6; r = 'cerrar'; }
      if (cn <= 2 && t === D4) { sc += 12; r = 'ataque'; }
    } else {
      sc += cc[col(c)] * 0.7;
      if (cn <= 2 && (t === SKIP || t === D2 || (t === REV && g.n > 2))) { sc += 9; r = 'ataque'; }
      else if (t === REV && g.n === 2) sc += 1;
      if (nivel === 3 && ((g.mem.falta[nx] >> col(c)) & 1) && g.n > 1) { sc += 2.5; r = r === 'puntos' ? 'color' : r; }
      if (nivel === 3 && colores === 1 && col(c) === g.color) sc += 1;
    }
    if (g.cfg.siete0 && !esComodin(c) && t === 7 && nivel >= 2) { const min = Math.min(...g.seats.map((x, k) => k === i ? 99 : x.mano.length)); sc += m.length - 1 > min ? 3 : -4; r = 'cambio'; }
    if (g.cfg.siete0 && !esComodin(c) && t === 0 && nivel >= 2) { sc += nivel === 3 ? (m.length >= Math.max(...g.seats.map(x => x.mano.length)) ? 3 : -3) : 0; }
    sc += RND(100) / 400;
    if (sc > bs) { bs = sc; best = c; razon = r; }
  });
  return { a: jugarCarta(best, m, g, nivel, unoSi(), i), why: razon, carta: best };
}
function jugarCarta(c, m, g, nivel, uno, i) {
  const a = { tipo: 'jugar', carta: c };
  if (esComodin(c)) a.color = mejorColor(m, g, nivel, c);
  if (g.cfg.siete0 && tp(c) === 7 && !esComodin(c)) {
    let b = null, bn = 1e9; g.seats.forEach((x, k) => { if (k !== i && x.mano.length < bn) { bn = x.mano.length; b = k; } }); a.objetivo = b;
  }
  if (uno) a.uno = true;
  return a;
}
const elegir = (g, i, nivel) => elegirDetalle(g, i, nivel).a;

/* ---------- Modo aprendizaje ---------- */
function consejo(g, i) {
  const s = g.seats[i], L = legal(g, i), N = elegirDetalle(g, i, 3, true);
  const lineas = [], cc = cuentaColores(s.mano);
  const nx = sig(g, i), sn = g.seats[nx];
  const cn = sn.mano.length;
  let titulo = '', a = N.a;
  if (L.color) { titulo = 'Elige un color'; lineas.push('Elige el color del que más cartas tienes (' + COLORES[mejorColor(s.mano, g, 3)] + '): así podrás jugar en tus siguientes turnos.'); return { titulo, accion: a, lineas, que: 'color' }; }
  if (g.pend) {
    titulo = 'Te toca robar ' + g.pend.n;
    if (L.retar) {
      lineas.push('Un +4 solo es legal si quien lo juega no tiene ninguna carta del color anterior. Puedes desafiarlo: si mentía, roba él 4 y tú no robas; si era legal, robas 6 (4 + 2).');
      if (a.tipo === 'retar') lineas.push('💡 Sugerencia: desafía. Con las cartas que tenía, hay bastantes posibilidades de que no fuera legal.');
      else lineas.push('💡 Sugerencia: acepta. Lo más probable es que fuera legal y desafiar te costaría 2 cartas de más.');
    }
    if (L.apilar) lineas.push('Tienes una carta igual: puedes devolver el castigo al siguiente (suma ' + (g.pend.n + (g.pend.tipo === 'd2' ? 2 : 4)) + ').' + (a.tipo === 'jugar' ? ' 💡 Sugerencia: devuélvelo.' : ''));
    if (!L.retar && !L.apilar) lineas.push('No puedes evitarlo: roba las cartas y pierdes el turno.');
    return { titulo, accion: a, lineas, que: a.tipo };
  }
  if (L.pasar) { titulo = 'Has robado una carta jugable'; lineas.push('Puedes jugar la carta que acabas de robar o pasar. ' + (a.tipo === 'jugar' ? '💡 Sugerencia: juégala.' : '💡 Sugerencia: pasa.')); return { titulo, accion: a, lineas, que: a.tipo }; }
  if (!L.jugables.length) {
    titulo = 'No tienes carta que jugar';
    lineas.push('Ninguna de tus cartas coincide en color, número o símbolo con la de arriba (' + nombreCarta(g.top) + (esComodin(g.top) ? ', color ' + COLORES[g.color].toLowerCase() : '') + '). Roba una de la pila: si te sirve, puedes jugarla.');
    return { titulo, accion: { tipo: 'robar' }, lineas, que: 'robar' };
  }
  titulo = 'Cartas que puedes jugar: ' + L.jugables.length;
  const c = a.carta;
  lineas.push('Juegas sobre ' + nombreCarta(g.top) + (esComodin(g.top) ? ' (color ' + COLORES[g.color].toLowerCase() + ')' : '') + '. Coinciden: ' + L.jugables.map(nombreCarta).join(', ') + '.');
  const razones = {
    ataque: 'el siguiente jugador (' + sn.nombre + ') tiene solo ' + cn + ' carta' + (cn === 1 ? '' : 's') + ': conviene hacerle perder el turno o robar antes de que gane.',
    guardar: 'los comodines conviene guardarlos para cuando no tengas otra salida; esta vez no hay mejor opción.',
    unica: 'es tu única carta jugable.',
    cerrar: 'te quedan muy pocas cartas y cuantas menos tengas, antes ganas.',
    puntos: 'es la carta que más puntos vale de las que puedes jugar (si otro gana la mano, las cartas altas son las que más puntos te cuestan).',
    color: 'el siguiente jugador ha robado antes cuando se pedía ese color: probablemente no lo tiene y tendrá que robar.',
    cambio: 'con 7-0 puedes cambiar tu mano por la de quien menos cartas tenga.',
    robada: 'es la mejor opción.', azar: 'es una buena opción.'
  };
  lineas.push('💡 Sugerencia: ' + (c != null ? nombreCarta(c) : 'jugar') + ' — ' + (razones[N.why] || razones.puntos));
  const mejor = cc.indexOf(Math.max(...cc));
  if (c != null && esComodin(c)) lineas.push('Elige el color ' + COLORES[a.color].toLowerCase() + ': es el que más cartas tienes (' + cc[a.color] + ').');
  else if (Math.max(...cc) >= 3) lineas.push('Tienes ' + cc[mejor] + ' cartas ' + COLORES[mejor].toLowerCase() + 's: intenta quedarte con un color para no tener que robar.');
  if (s.mano.length === 2) lineas.push('⚠️ Te quedas con una carta: pulsa ¡UNO! antes de que juegue el siguiente o te pillarán y robarás ' + g.cfg.penal + '.');
  return { titulo, accion: a, lineas, que: 'jugar', carta: c };
}

const Uno = { COLORES, SKIP, REV, D2, WILD, D4, col, tp, esComodin, carta, nombreCarta, puntosCarta, puntosMano, mazoNuevo, nueva, repartir, legal, accion, siguienteRonda, vista, elegir, elegirDetalle, consejo, coincide, puedeApilar, sig, barajar, setRnd };
if (typeof module !== 'undefined' && module.exports) module.exports = Uno;
root.Uno = Uno;
})(typeof self !== 'undefined' ? self : globalThis);
