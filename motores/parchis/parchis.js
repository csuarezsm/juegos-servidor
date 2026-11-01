/* Parchís — reglas y máquina (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.

   Reglas (parchís clásico español, de 2 a 4 jugadores, un dado):
   - Recorrido de 68 casillas. Salidas: amarillo 5, azul 22, rojo 39, verde 56. Cada color entra a su pasillo
     (7 casillas + meta) después de la 68, 17, 34 y 51. Seguros: 5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63, 68.
   - Con un 5 hay que sacar ficha de casa si se puede. Si en la salida hay dos fichas y alguna es de otro color,
     se come una de ellas al salir.
   - Con un 6 se vuelve a tirar; si no queda ninguna ficha en casa, el 6 cuenta como 7. Con tres seises seguidos,
     la última ficha movida vuelve a casa (salvo que esté en el pasillo) y se pasa el turno.
   - Dos fichas del mismo color en una casilla forman barrera: nadie puede pasar ni caer ahí. Con un 6 (o 7) es
     obligatorio abrir una barrera si se puede. En una casilla caben como mucho dos fichas.
   - Al caer en una casilla con una ficha de otro color, fuera de los seguros, se la come (vuelve a su casa) y se
     cuentan 20 con cualquier ficha. En los seguros conviven dos fichas de distinto color.
   - A la meta se entra con el número exacto, y al llegar se cuentan 10. Gana quien mete antes sus cuatro fichas.
   Posición de cada ficha, relativa a su color: -1 en casa; 0–63 en el recorrido (0 = su salida); 64–70 pasillo; 71 meta. */
(function (root) {
'use strict';
const COLORES = ['amarillo', 'azul', 'rojo', 'verde'];
const SALIDA = [5, 22, 39, 56];
const SEGUROS = new Set([5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63, 68]);
const META = 71, PASILLO = 64, CASA = -1;
const casilla = (c, r) => r >= 0 && r < PASILLO ? ((SALIDA[c] - 1 + r) % 68) + 1 : null;
const esSeguro = sq => SEGUROS.has(sq);

function nueva(colores) {
  colores = (colores && colores.length ? colores : [0, 1, 2, 3]).slice().sort((a, b) => a - b);
  return { colores, fichas: [0, 1, 2, 3].map(() => [CASA, CASA, CASA, CASA]), turno: colores[0], fase: 'tirar',
    dado: null, valor: null, seises: 0, repite: false, pend: [], ultima: null, ganador: null, orden: [],
    stats: { comidas: [0, 0, 0, 0], comido: [0, 0, 0, 0], metas: [0, 0, 0, 0], seises: [0, 0, 0, 0], tiradas: 0 }, ultimo: null, n: 0 };
}
const copia = g => JSON.parse(JSON.stringify(g));
// fichas (de cualquier color) en una casilla del recorrido
function en(g, sq) { const out = []; for (const c of g.colores) g.fichas[c].forEach((r, i) => { if (casilla(c, r) === sq) out.push({ c, i }); }); return out; }
const barrera = l => l.length === 2 && l[0].c === l[1].c;
const enCasa = (g, c) => g.fichas[c].filter(r => r === CASA).length;

// Destino de la ficha i del color c avanzando n. null si no se puede. { a, come, meta }
function destino(g, c, i, n) {
  const r = g.fichas[c][i];
  if (r === CASA || r === META) return null;
  const t = r + n;
  if (t > META) return null;
  for (let k = r + 1; k <= t; k++) {
    if (k < PASILLO) {
      const sq = casilla(c, k), l = en(g, sq).filter(x => !(x.c === c && x.i === i));
      if (k < t) { if (barrera(l)) return null; continue; }
      if (l.length >= 2) return null;
      if (l.length === 1 && l[0].c !== c) return esSeguro(sq) ? { a: t } : { a: t, come: l[0] };
      return { a: t };
    }
    if (k < META) {
      const n2 = g.fichas[c].filter((x, j) => j !== i && x === k).length;
      if (k < t ? n2 >= 2 : n2 >= 2) return null;
    }
  }
  return { a: t, meta: t === META };
}
// Sacar una ficha de casa con un 5
function salida(g, c) {
  if (!enCasa(g, c)) return null;
  const sq = SALIDA[c], l = en(g, sq), propias = l.filter(x => x.c === c).length;
  if (propias >= 2) return null;
  if (l.length >= 2) { const otra = l.filter(x => x.c !== c); return otra.length ? { a: 0, come: otra[otra.length - 1], sale: true } : null; }
  return { a: 0, sale: true };
}
// Jugadas posibles con el valor pendiente (dado o premio)
function movimientos(g) {
  if (g.fase !== 'mover') return [];
  const c = g.turno, n = g.valor, premio = !!g.premio, out = [];
  if (!premio && g.dado === 5) {
    const s = salida(g, c);
    if (s) { const i = g.fichas[c].indexOf(CASA); return [Object.assign({ i, de: CASA }, s)]; }
  }
  for (let i = 0; i < 4; i++) {
    const d = destino(g, c, i, n);
    if (d) out.push(Object.assign({ i, de: g.fichas[c][i] }, d));
  }
  // con un 6 (o 7) hay que abrir barrera si se puede
  if (!premio && g.dado === 6) {
    const enBarrera = new Set();
    for (let i = 0; i < 4; i++) { const r = g.fichas[c][i]; if (r >= 0 && r < PASILLO) for (let j = i + 1; j < 4; j++) if (g.fichas[c][j] === r) { enBarrera.add(i); enBarrera.add(j); } }
    const abre = out.filter(m => enBarrera.has(m.i));
    if (abre.length) return abre;
  }
  return out;
}
const siguiente = g => { const k = g.colores.indexOf(g.turno); return g.colores[(k + 1) % g.colores.length]; };
function pasarTurno(g) { g.turno = siguiente(g); g.fase = 'tirar'; g.seises = 0; g.repite = false; g.pend = []; g.premio = false; g.dado = null; g.valor = null; g.ultima = null; }
// Tras mover: premios pendientes, repetir o pasar
function seguir(g) {
  while (g.pend.length) {
    const p = g.pend.shift();
    g.fase = 'mover'; g.valor = p; g.premio = true;
    if (movimientos(g).length) return;
  }
  g.premio = false;
  if (g.ganador != null) return;
  if (g.repite) { g.fase = 'tirar'; g.dado = null; g.valor = null; return; }
  pasarTurno(g);
}
// Tirar el dado (d: 1–6; si no se da, al azar)
function tirar(g, d, rnd) {
  if (g.fase !== 'tirar') return false;
  d = d || 1 + Math.floor((rnd || Math.random)() * 6);
  const c = g.turno;
  g.n++; g.stats.tiradas++;
  g.dado = d; g.repite = d === 6; g.premio = false;
  if (d === 6) {
    g.seises++; g.stats.seises[c]++;
    if (g.seises === 3) {
      const i = g.ultima, r = i != null ? g.fichas[c][i] : null;
      const vuelve = r != null && r >= 0 && r < PASILLO;
      if (vuelve) g.fichas[c][i] = CASA;
      g.ultimo = { tipo: 'tres6', c, i: vuelve ? i : null };
      pasarTurno(g);
      return true;
    }
  }
  g.valor = d === 6 && enCasa(g, c) === 0 ? 7 : d;
  g.fase = 'mover';
  g.ultimo = { tipo: 'tira', c, d, v: g.valor };
  if (!movimientos(g).length) {
    g.ultimo.nada = true;
    g.premio = false;
    if (g.repite) { g.fase = 'tirar'; } else pasarTurno(g);
  }
  return true;
}
// Mover la ficha i del color que juega
function mover(g, i) {
  const m = movimientos(g).find(x => x.i === i);
  if (!m) return false;
  const c = g.turno;
  g.fichas[c][i] = m.a;
  g.ultima = i;
  const ev = { tipo: 'mueve', c, i, de: m.de, a: m.a, v: g.valor, premio: !!g.premio };
  if (m.come) { g.fichas[m.come.c][m.come.i] = CASA; g.pend.push(20); g.stats.comidas[c]++; g.stats.comido[m.come.c]++; ev.come = m.come; }
  if (m.meta) { g.stats.metas[c]++; ev.meta = true; if (g.fichas[c].every(r => r === META)) { g.ganador = c; g.fase = 'fin'; g.orden = clasificar(g); ev.gana = true; } else g.pend.push(10); }
  if (m.sale) ev.sale = true;
  g.ultimo = ev;
  g.premio = false;
  if (g.ganador != null) return true;
  seguir(g);
  return true;
}
// Recorrido hecho (para clasificar a los que no han ganado)
const avance = (g, c) => g.fichas[c].reduce((a, r) => a + (r === CASA ? 0 : r + 1), 0);
function clasificar(g) { return g.colores.slice().sort((a, b) => (b === g.ganador) - (a === g.ganador) || avance(g, b) - avance(g, a)); }
// El que abandona: sus fichas se quedan donde están y deja de jugar
function quitar(g, c) {
  if (!g.colores.includes(c) || g.fase === 'fin') return;
  const era = g.turno === c;
  if (era) pasarTurno(g);
  g.colores = g.colores.filter(x => x !== c);
  if (g.colores.length === 1) { g.ganador = g.colores[0]; g.fase = 'fin'; g.orden = clasificar(g).concat([c]); }
}

/* ---------- La máquina ---------- */
// Peligro de una casilla para el color c: probabilidad aproximada de que la coman en la siguiente vuelta
function peligro(g, c, sq) {
  if (sq == null || esSeguro(sq)) return 0;
  let p = 0;
  for (const o of g.colores) {
    if (o === c) continue;
    for (const r of g.fichas[o]) {
      if (r < 0 || r >= PASILLO) continue;
      const so = casilla(o, r);
      let d = (sq - so + 68) % 68;
      // ¿llega por su recorrido antes de entrar a su pasillo?
      if (d >= 1 && d <= 7 && r + d < PASILLO) p += d === 7 ? 0.08 : 0.17;
      else if (d >= 8 && d <= 12 && r + d < PASILLO) p += 0.03;     // con premios o dos tiradas
    }
    if (SALIDA[o] === sq && enCasa(g, o)) p += 0.17;
  }
  return Math.min(1, p);
}
function valorar(g, m, nivel) {
  const c = g.turno, r0 = m.de, sq0 = casilla(c, r0), sq1 = casilla(c, m.a);
  let v = 0;
  if (m.come) v += 70 + (m.come && casilla(m.come.c, g.fichas[m.come.c][m.come.i]) != null ? g.fichas[m.come.c][m.come.i] * 0.5 : 0);
  if (m.meta) v += 60;
  if (m.sale) v += 40;
  if (m.a >= PASILLO && r0 < PASILLO) v += 30;                     // a salvo en el pasillo
  if (sq1 != null && esSeguro(sq1)) v += 12;
  v += (m.a - Math.max(0, r0)) * 0.4;
  const riesgoAntes = r0 >= 0 && r0 < PASILLO ? peligro(g, c, sq0) : 0;
  const despues = copia(g); despues.fichas[c][m.i] = m.a; if (m.come) despues.fichas[m.come.c][m.come.i] = CASA;
  const riesgo = m.a < PASILLO ? peligro(despues, c, sq1) : 0;
  const vale = 15 + Math.max(0, m.a) * 0.6;                        // cuánto se pierde si la comen
  v += riesgoAntes * vale * (nivel >= 2 ? 1 : 0.5) - riesgo * vale * (nivel >= 2 ? 1.2 : 0.6);
  // barrera propia: protege, y delante de rivales cerca de su pasillo molesta
  if (sq1 != null && despues.fichas[c].filter((x, j) => j !== m.i && casilla(c, x) === sq1).length === 1) v += nivel >= 3 ? 14 : 8;
  // no dejar sola a una ficha que estaba en barrera en casilla peligrosa
  if (nivel >= 3 && sq0 != null) { const comp = g.fichas[c].findIndex((x, j) => j !== m.i && x === r0); if (comp >= 0) v -= peligro(despues, c, sq0) * (15 + r0 * 0.6); }
  return v;
}
// Elige la ficha que mueve la máquina. nivel: 1 fácil, 2 normal, 3 difícil
function elegir(g, nivel, rnd) {
  rnd = rnd || Math.random;
  const ms = movimientos(g);
  if (!ms.length) return null;
  if (ms.length === 1) return ms[0].i;
  if (nivel <= 1 && rnd() < 0.45) return ms[Math.floor(rnd() * ms.length)].i;
  let best = null, bv = -Infinity;
  for (const m of ms) { const v = valorar(g, m, nivel) + (nivel <= 1 ? rnd() * 25 : nivel === 2 ? rnd() * 4 : 0); if (v > bv) { bv = v; best = m; } }
  return best.i;
}

const API = { COLORES, SALIDA, SEGUROS, META, PASILLO, CASA, casilla, esSeguro, nueva, copia, en, destino, salida, movimientos, tirar, mover, quitar, siguiente, clasificar, avance, elegir, peligro };
root.Parchis = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
