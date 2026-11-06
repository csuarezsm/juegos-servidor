/* Invasores espaciales — reglas y motor del juego (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.
   Es el MISMO archivo en la app (www/invasores.js) y en el servidor de juegos (motores/invasores/invasores.js). Sin dependencias.
   Reglas y fuentes: ver REGLAS.md (juego de máquina recreativa de 1978: 5 filas de 11 invasores, 10/20/30 puntos,
   platillo de 50 a 300, 3 vidas, vida extra a los 1500 puntos, los invasores aceleran al quedar menos).

   Juego determinista: con la misma semilla y las mismas entradas siempre sale lo mismo (el reto en línea usa una semilla común).
   Campo de 224×256 puntos. El motor avanza a 60 pasos por segundo: Invasores.paso(g, entrada).
   entrada = { x: centro al que ir (o null), dir: -1 | 0 | 1, fire: bool }
   El estado es JSON puro (se puede guardar). */
(function (root) {
'use strict';
const W = 224, H = 256;
const COLS = 11, ROWS = 5, DX = 16, DY = 14;
const CANON_Y = 224, CANON_W = 13, CANON_H = 8, CANON_V = 1.6;
const ESC_Y = 192, ESC_W = 22, ESC_N = 4, ESC_X0 = 29, ESC_DX = 48;
const TIPOS = [{ w: 8, pts: 30 }, { w: 11, pts: 20 }, { w: 12, pts: 10 }];       // calamar, cangrejo, pulpo
const TIPO_FILA = [0, 1, 1, 2, 2];
const UFO_Y = 32, UFO_W = 16, UFO_H = 7, UFO_PUNTOS = [50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100, 100];
const UFO_CADA = 1500;                                  // ≈ 25 s entre platillos
const VIDA_EXTRA = 1500, MAX_VIDAS = 9;
const NIVELES = { 1: { bomba: 1.35, vel: 0.85, nombre: 'Fácil' }, 2: { bomba: 1, vel: 1, nombre: 'Normal' }, 3: { bomba: 0.7, vel: 1.15, nombre: 'Difícil' } };
const ESCUDO = ['00111111100', '01111111110', '11111111111', '11111111111', '11111111111', '11111111111', '11100000111', '11000000011'];

function rng(g) {                                       // mulberry32: determinista y con el estado dentro de g
  g.rs = (g.rs + 0x6D2B79F5) | 0;
  let t = Math.imul(g.rs ^ (g.rs >>> 15), 1 | g.rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ent = (g, n) => Math.floor(rng(g) * n);

function escudosNuevos() {
  const f = [];
  for (let k = 0; k < ESC_N; k++) f.push(ESCUDO.join('').split('').map(Number));
  return f;
}
function oleadaNueva(g) {
  g.inv = new Array(COLS * ROWS).fill(1);
  g.alive = COLS * ROWS;
  g.ix = 17; g.iy = 56 + 8 * Math.min(g.oleada - 1, 5);
  g.dir = 1; g.st = 0; g.anim = 0;
  g.bombas = []; g.bala = null;
  g.bt = 50; g.ut = UFO_CADA; g.ufo = null; g.ufoDir = g.oleada % 2 ? 1 : -1; g.disparosOl = 0;
  g.esc = escudosNuevos();
  g.pausa = 60;
}
function nueva(o) {
  o = o || {};
  const g = { v: 1, seed: (o.seed == null ? 1 : o.seed) | 0, rs: 0, nivel: NIVELES[o.nivel] ? +o.nivel : 2, auto: o.auto !== false,
    vidas: o.vidas || 3, puntos: 0, oleada: 1, tick: 0, disparos: 0, kills: 0, ufos: 0, extra: false, fin: false, motivo: '',
    cx: (W - CANON_W) / 2, muerto: 0, ev: [] };
  g.rs = g.seed;
  oleadaNueva(g);
  return g;
}

/* ---------- Geometría ---------- */
const solapa = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
const invX = (g, c, r) => g.ix + c * DX + (DX - TIPOS[TIPO_FILA[r]].w) / 2;
const invY = (g, r) => g.iy + r * DY;
function columnas(g) {                                  // primera y última columna con invasores vivos
  let a = COLS, b = -1;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (g.inv[r * COLS + c]) { if (c < a) a = c; if (c > b) b = c; }
  return [a, b];
}
function filaBaja(g) { for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) if (g.inv[r * COLS + c]) return r; return -1; }

/* Un impacto quita un trozo del escudo: devuelve true si había algo que golpear */
function golpeEscudo(g, px, py, pw, ph, haciaArriba) {
  for (let k = 0; k < ESC_N; k++) {
    const ex = ESC_X0 + k * ESC_DX;
    if (!solapa(px, py, pw, ph, ex, ESC_Y, ESC_W, 16)) continue;
    const f = g.esc[k];
    // celdas de 2×2 puntos; se busca la primera celda viva en el camino del proyectil
    const c0 = Math.max(0, Math.floor((px - ex) / 2)), c1 = Math.min(10, Math.floor((px + pw - 1 - ex) / 2));
    const r0 = Math.max(0, Math.floor((py - ESC_Y) / 2)), r1 = Math.min(7, Math.floor((py + ph - 1 - ESC_Y) / 2));
    let hit = null;
    if (haciaArriba) { for (let r = r1; r >= r0 && !hit; r--) for (let c = c0; c <= c1; c++) if (f[r * 11 + c]) { hit = [r, c]; break; } }
    else { for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1; c++) if (f[r * 11 + c]) { hit = [r, c]; break; } }
    if (!hit) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = hit[0] + dr, c = hit[1] + dc;
      if (r < 0 || r > 7 || c < 0 || c > 10) continue;
      if ((Math.abs(dr) + Math.abs(dc) < 2 || rng(g) < 0.5) && f[r * 11 + c]) f[r * 11 + c] = 0;
    }
    return true;
  }
  return false;
}
function borrarEscudosBajo(g) {                         // los invasores comen los escudos al pasar por encima
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!g.inv[r * COLS + c]) continue;
    const x = invX(g, c, r), y = invY(g, r), w = TIPOS[TIPO_FILA[r]].w;
    if (y + 8 < ESC_Y) continue;
    for (let k = 0; k < ESC_N; k++) {
      const ex = ESC_X0 + k * ESC_DX;
      if (!solapa(x, y, w, 8, ex, ESC_Y, ESC_W, 16)) continue;
      const f = g.esc[k];
      for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 11; cc++) if (f[rr * 11 + cc] && solapa(ex + cc * 2, ESC_Y + rr * 2, 2, 2, x, y, w, 8)) f[rr * 11 + cc] = 0;
    }
  }
}

/* ---------- Un paso del juego (1/60 s) ---------- */
function paso(g, inp) {
  g.ev = [];
  if (g.fin) return g.ev;
  inp = inp || {};
  g.tick++;
  // el cañón se mueve aunque haya pausa (salvo si está destruido)
  if (!g.muerto) {
    if (typeof inp.x === 'number') {
      const obj = inp.x - CANON_W / 2, d = obj - g.cx;
      g.cx += Math.abs(d) <= CANON_V ? d : Math.sign(d) * CANON_V;
    } else if (inp.dir) g.cx += inp.dir * CANON_V;
    g.cx = Math.max(6, Math.min(W - 6 - CANON_W, g.cx));
    if (!g.bala && (inp.fire || g.auto)) {
      if (inp.fire || g.auto) { g.bala = { x: g.cx + (CANON_W - 1) / 2, y: CANON_Y - 4 }; g.disparos++; g.disparosOl++; g.ev.push('disparo'); }
    }
  }
  if (g.muerto) { g.muerto--; if (!g.muerto) { if (g.vidas <= 0) { g.fin = true; g.motivo = 'vidas'; g.ev.push('fin'); } } return g.ev; }
  if (g.pausa > 0) { g.pausa--; moverBala(g); return g.ev; }

  moverBala(g);
  if (g.fin) return g.ev;

  // formación
  const nv = NIVELES[g.nivel];
  if (g.st > 0) g.st--;
  if (g.st <= 0) {
    const base = Math.max(1, Math.round(1 + (g.alive - 1) * 0.55 / nv.vel));
    g.st = Math.max(1, base - Math.min(g.oleada - 1, 8));
    const [a, b] = columnas(g);
    // límites reales: se usa la caja de cada columna extrema
    let minX = 1e9, maxX = -1e9;
    for (let r = 0; r < ROWS; r++) for (const c of [a, b]) if (g.inv[r * COLS + c]) { const x = invX(g, c, r); minX = Math.min(minX, x); maxX = Math.max(maxX, x + TIPOS[TIPO_FILA[r]].w); }
    if ((g.dir > 0 && maxX + 2 > W - 4) || (g.dir < 0 && minX - 2 < 4)) { g.iy += 8; g.dir = -g.dir; }
    else g.ix += g.dir * 2;
    g.anim ^= 1; g.ev.push('paso');
    borrarEscudosBajo(g);
    const fb = filaBaja(g);
    if (fb >= 0 && invY(g, fb) + 8 >= CANON_Y) { g.fin = true; g.motivo = 'invadida'; g.vidas = 0; g.ev.push('fin'); return g.ev; }
  }

  // bombas
  const maxB = 3;
  if (--g.bt <= 0) {
    if (g.bombas.length < maxB && g.alive) {
      const cols = [];
      for (let c = 0; c < COLS; c++) for (let r = ROWS - 1; r >= 0; r--) if (g.inv[r * COLS + c]) { cols.push([c, r]); break; }
      let e;
      if (rng(g) < 0.4) {                                // apunta a la columna más cercana al cañón
        const cx = g.cx + CANON_W / 2; e = cols[0];
        for (const k of cols) if (Math.abs(invX(g, k[0], k[1]) - cx) < Math.abs(invX(g, e[0], e[1]) - cx)) e = k;
      } else e = cols[ent(g, cols.length)];
      const w = TIPOS[TIPO_FILA[e[1]]].w;
      g.bombas.push({ x: invX(g, e[0], e[1]) + w / 2, y: invY(g, e[1]) + 8 });
    }
    g.bt = Math.round((Math.max(14, 52 - 3 * Math.min(g.oleada, 10)) + ent(g, 34)) * nv.bomba);
  }
  const vb = 1.4 + Math.min(g.oleada - 1, 6) * 0.1;
  for (let i = g.bombas.length - 1; i >= 0; i--) {
    const b = g.bombas[i]; b.y += vb;
    if (b.y > H - 8) { g.bombas.splice(i, 1); continue; }
    if (golpeEscudo(g, b.x - 1, b.y, 3, 5, false)) { g.bombas.splice(i, 1); g.ev.push('escudo'); continue; }
    if (solapa(b.x - 1, b.y, 3, 5, g.cx, CANON_Y, CANON_W, CANON_H)) { g.bombas.splice(i, 1); morir(g); return g.ev; }
  }

  // platillo
  if (g.ufo) {
    g.ufo.x += g.ufoDir;
    if (g.ufo.x < -UFO_W - 2 || g.ufo.x > W + 2) { g.ufo = null; g.ut = UFO_CADA; g.ufoDir = -g.ufoDir; }
  } else if (--g.ut <= 0) {
    if (g.alive >= 8) { g.ufo = { x: g.ufoDir > 0 ? -UFO_W : W }; g.ev.push('ufo'); }
    else g.ut = 60;
  }

  // fin de oleada
  if (!g.alive) { g.oleada++; oleadaNueva(g); g.ev.push('oleada'); }
  return g.ev;
}

function moverBala(g) {
  const b = g.bala; if (!b) return;
  b.y -= 5;
  if (b.y < 22) { g.bala = null; g.ev.push('aire'); return; }
  // contra las bombas
  for (let i = g.bombas.length - 1; i >= 0; i--) {
    const m = g.bombas[i];
    if (solapa(b.x, b.y, 1, 6, m.x - 1, m.y, 3, 5)) { g.bombas.splice(i, 1); g.bala = null; g.ev.push('bomba'); return; }
  }
  if (golpeEscudo(g, b.x, b.y, 1, 6, true)) { g.bala = null; g.ev.push('escudo'); return; }
  if (g.ufo && solapa(b.x, b.y, 1, 6, g.ufo.x, UFO_Y, UFO_W, UFO_H)) {
    const p = UFO_PUNTOS[g.disparos % UFO_PUNTOS.length];
    sumar(g, p); g.ufos++; g.ev.push('ufoHit'); g.ufoPuntos = p;
    g.ufo = null; g.ut = UFO_CADA; g.ufoDir = -g.ufoDir; g.bala = null; return;
  }
  for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) {
    if (!g.inv[r * COLS + c]) continue;
    const t = TIPOS[TIPO_FILA[r]];
    if (solapa(b.x, b.y, 1, 6, invX(g, c, r), invY(g, r), t.w, 8)) {
      g.inv[r * COLS + c] = 0; g.alive--; g.kills++; g.bala = null; sumar(g, t.pts); g.ev.push('mata'); return;
    }
  }
}
function sumar(g, p) {
  g.puntos += p;
  if (!g.extra && g.puntos >= VIDA_EXTRA) { g.extra = true; if (g.vidas < MAX_VIDAS) g.vidas++; g.ev.push('extra'); }
}
function morir(g) {
  g.vidas--; g.bombas = []; g.bala = null; g.muerto = 90; g.ev.push('muerte');
}

/* ---------- Máquina que juega (para las pruebas y para ver cómo se juega) ---------- */
function bot(g) {
  const cx = g.cx + CANON_W / 2;
  // esquiva la bomba más cercana que venga hacia el cañón
  let peligro = null;
  for (const b of g.bombas) if (b.y > CANON_Y - 70 && Math.abs(b.x - cx) < 14 && (!peligro || b.y > peligro.y)) peligro = b;
  if (peligro) { const dir = peligro.x >= cx ? -1 : 1; return { x: Math.max(10, Math.min(W - 10, cx + dir * 40)), fire: true }; }
  // apunta al invasor vivo más bajo; si el platillo está, a por él
  if (g.ufo) return { x: g.ufo.x + UFO_W / 2 + g.ufoDir * 20, fire: true };
  let obj = null;
  for (let r = ROWS - 1; r >= 0 && !obj; r--) {
    let mejor = null;
    for (let c = 0; c < COLS; c++) if (g.inv[r * COLS + c]) { const x = invX(g, c, r) + TIPOS[TIPO_FILA[r]].w / 2; if (!mejor || Math.abs(x - cx) < Math.abs(mejor - cx)) mejor = x; }
    if (mejor != null) obj = mejor;
  }
  return { x: obj == null ? W / 2 : obj + g.dir * 3, fire: true };
}

/* Lo que se puede enviar al servidor al terminar */
const resultado = g => ({ puntos: g.puntos, oleada: g.oleada, ticks: g.tick, disparos: g.disparos, kills: g.kills });

const Inv = { W, H, COLS, ROWS, DX, DY, CANON_Y, CANON_W, CANON_H, ESC_Y, ESC_W, ESC_N, ESC_X0, ESC_DX, TIPOS, TIPO_FILA, UFO_Y, UFO_W, UFO_H, UFO_PUNTOS, UFO_CADA, VIDA_EXTRA, NIVELES,
  nueva, paso, bot, resultado, invX, invY, rng };
if (typeof module !== 'undefined' && module.exports) module.exports = Inv;
root.Invasores = Inv;
})(typeof self !== 'undefined' ? self : globalThis);
