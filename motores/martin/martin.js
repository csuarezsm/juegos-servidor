/* Martín: Los Caminos del Volcán — motor del juego (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.
   Es el MISMO archivo en la app (www/martin.js) y en el servidor de juegos (motores/martin/martin.js). Sin dependencias.
   Especificación: dossier MARTIN-L01-001 (valores TUN de arranque) — ver REGLAS.md.

   Simulación determinista a 1/60 s fijos (solo + - * / de números en coma flotante): las mismas entradas dan siempre
   el mismo resultado en cualquier móvil, navegador o servidor. El reto diario se valida repitiendo las pulsaciones.

   Coordenadas: x hacia la derecha, y hacia arriba, y = 0 es la superficie principal del terreno; unidad u = 1/2 baldosa.
   Martín: caja de 0,95 × 1,75 u, el punto de apoyo es el centro inferior (x, y).
   Entrada de cada paso (máscara): 1 = izquierda, 2 = derecha, 4 = salto (mantenido). Izquierda + derecha a la vez = quieto
   (la app decide antes «gana la última dirección pulsada»).
   El estado es JSON puro (se puede guardar). */
(function (root) {
'use strict';

/* ---------- Parámetros (dossier §05, §06) ---------- */
const DT = 1 / 60;
const VMAX = 4.0, ACC = 24, FRENO = 30, AIRE = 0.7;
const SALTO = 8.5, G = 24, G_SOSTENIDO = 0.6, SOSTENER = 10;      // 0,17 s ≈ 10 pasos
const COYOTE = 6, BUFER = 7;                                      // 0,10 s y 0,12 s en pasos (7,2 → 7)
const CAIDA_MAX = 30;                                             // velocidad vertical máxima (u/s)
const W = 0.95, H = 1.75, HW = W / 2;
const DANO_MEDIO = 12, DANO_FUERTE = 25, DANO_ROCA = 10, DANO_CAIDA = 15;
const V_MEDIO = 10, V_FUERTE = 13, V_ROCA = 2.5;
const INVULN = 21;                                                // 0,35 s
const REAPARECE = 48;                                             // 0,8 s de animación de regreso
const MAX_PASOS = 60 * 900;                                       // 15 minutos: tope de una partida
const EPS = 1e-6;
const MODS = { normal: { dano: 1, agua: 100 }, fragil: { dano: 1.5, agua: 100 }, poca: { dano: 1, agua: 70 } };

/* ---------- Validación y carga del nivel (dossier §11) ---------- */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('00000000' + h.toString(16)).slice(-8); }
const KINDS = ['ground', 'rock', 'oneway', 'wall'];
const num = v => typeof v === 'number' && isFinite(v);

/* Lanza Error con el motivo si el nivel no es válido. Devuelve el nivel preparado (sólidos ordenados). */
function validar(L) {
  const err = m => { throw new Error('Nivel no válido: ' + m); };
  if (!L || typeof L !== 'object') err('no es un objeto');
  if (typeof L.level_id !== 'string' || !L.level_id) err('falta level_id');
  if (!num(L.content_version)) err('falta content_version');
  const w = L.world; if (!w || !num(w.min_x) || !num(w.max_x) || !num(w.kill_y) || w.max_x <= w.min_x) err('world');
  if (!L.spawn || !num(L.spawn.x) || !num(L.spawn.y)) err('spawn');
  if (!L.checkpoint || typeof L.checkpoint.id !== 'string' || !num(L.checkpoint.x) || !num(L.checkpoint.y)) err('checkpoint');
  if (!L.cargo || L.cargo.type !== 'water' || !num(L.cargo.initial_integrity)) err('cargo');
  const g = L.goals; if (!g || !num(g.finish_x) || !num(g.finish_min_integrity) || !num(g.star_2_integrity) || !num(g.star_3_time_s)) err('goals');
  if (!Array.isArray(L.solids) || !L.solids.length) err('solids');
  const ids = new Set();
  const uno = (id, pref) => { if (typeof id !== 'string' || !id) err('id vacío en ' + pref); if (ids.has(id)) err('id duplicado ' + id); ids.add(id); };
  for (const s of L.solids) {
    uno(s.id, 'solids');
    if (!KINDS.includes(s.kind)) err('tipo desconocido en ' + s.id);
    if (!num(s.x0) || !num(s.x1) || !num(s.top) || s.x1 <= s.x0) err('geometría de ' + s.id);
    if (s.bottom != null && (!num(s.bottom) || s.bottom >= s.top)) err('bottom de ' + s.id);
    if (s.x0 < w.min_x - EPS || s.x1 > w.max_x + EPS) err(s.id + ' fuera del mundo');
  }
  for (const o of L.obstacles || []) { uno(o.id, 'obstacles'); if (!num(o.x0) || !num(o.x1) || o.x1 <= o.x0) err('obstáculo ' + o.id); }
  for (const r of L.routes || []) { uno(r.id, 'routes'); if (!num(r.x0) || !num(r.x1) || r.x1 <= r.x0) err('ruta ' + r.id); }
  const rutas = new Set((L.routes || []).map(r => r.id));
  for (const s of L.solids) if (s.route && !rutas.has(s.route)) err('ruta desconocida en ' + s.id);
  if (rutas.size === 1) err('una bifurcación necesita al menos dos rutas');
  // inicio, punto de control y meta sobre suelo transitable
  const apoyo = (x, y) => L.solids.some(s => s.kind !== 'wall' && x > s.x0 - EPS && x < s.x1 + EPS && Math.abs(s.top - y) < 0.05);
  if (!apoyo(L.spawn.x, L.spawn.y)) err('el inicio no está sobre suelo');
  if (!apoyo(L.checkpoint.x, L.checkpoint.y)) err('el punto de control no está sobre suelo');
  if (!L.solids.some(s => s.kind !== 'wall' && g.finish_x >= s.x0 && g.finish_x <= s.x1 && s.top >= w.kill_y + 2)) err('la meta no está sobre suelo');
  // los huecos declarados no pueden tener suelo en medio
  for (const o of L.obstacles || []) if (o.kind === 'gap') {
    for (const s of L.solids) if (s.kind !== 'wall' && s.top > w.kill_y + 1 && s.x0 < o.x1 - EPS && s.x1 > o.x0 + EPS && (s.bottom == null)) err('el hueco ' + o.id + ' tiene suelo (' + s.id + ')');
  }
  const o = Object.assign({}, L);
  o.solids = L.solids.map(s => ({ id: s.id, kind: s.kind, x0: s.x0, x1: s.x1, top: s.top, bot: s.bottom == null ? -1e9 : s.bottom, route: s.route || '' }));
  const extra = L.checkpoints_extra || [];
  for (const c of extra) { if (typeof c.id !== 'string' || !num(c.x) || !num(c.y)) err('checkpoint extra'); uno(c.id, 'checkpoints_extra'); if (!apoyo(c.x, c.y)) err('el punto de control ' + c.id + ' no está sobre suelo'); }
  o.cps = [L.checkpoint].concat(extra).sort((a, b) => a.x - b.x);
  o.checksum = fnv(JSON.stringify(L));
  return o;
}
/* Carga un nivel desde texto JSON. Devuelve {ok, nivel, error} (nunca lanza). */
function cargar(texto) {
  try { const L = validar(JSON.parse(texto)); return { ok: true, nivel: L }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/* ---------- Estado ---------- */
function nuevo(L, opts) {
  opts = opts || {};
  const m = MODS[opts.mod || 'normal'] || MODS.normal;
  const agua = Math.min(100, Math.max(1, Math.round(opts.agua != null ? opts.agua : Math.min(L.cargo.initial_integrity, m.agua))));
  return {
    fase: 'lista',            // lista | jugando | pausa | reaparece | fallo | meta
    t: 0,                     // pasos de simulación con reloj en marcha
    x: L.spawn.x, y: L.spawn.y, vx: 0, vy: 0, cara: 1, suelo: true,
    coy: COYOTE, buf: 0, sos: 0, pj: 0, frio: 0,
    agua, danos: 0, caidas: 0, golpes: 0,
    cp: 0, saltos: 0, rx: L.spawn.x, ry: L.spawn.y, rt: 0,
    causa: '', estrellas: 0, mod: opts.mod || 'normal', dm: m.dano,
    ruta: '', ev: [], conEv: !!opts.eventos
  };
}
const emite = (s, e) => { if (s.conEv) s.ev.push(e); };
function empezar(s) { if (s.fase === 'lista') s.fase = 'jugando'; }
function pausar(s) { if (s.fase === 'jugando') { s.fase = 'pausa'; } }
/* Pausar y seguir no cambian nada de la simulación (la app suelta antes todos los botones: no hay saltos al volver) */
function reanudar(s) { if (s.fase === 'pausa') s.fase = 'jugando'; }

/* ---------- Un paso de 1/60 s ---------- */
function dano(s, cantidad, tipo, id) {
  if (s.frio > 0) return false;
  const c = Math.max(1, Math.round(cantidad * s.dm));
  s.agua = Math.max(0, s.agua - c); s.danos += c; s.golpes++; s.frio = INVULN;
  emite(s, { t: 'dano', tipo, cantidad: c, resto: s.agua, id });
  return true;
}
function estrellas(L, s) {
  const g = L.goals; let n = 1;
  if (s.agua >= g.star_2_integrity) {
    n = 2;
    if (s.t / 60 <= g.star_3_time_s + EPS && s.agua >= (g.star_3_integrity != null ? g.star_3_integrity : g.star_2_integrity)) n = 3;
  }
  return n;
}
function paso(L, s, m) {
  if (s.fase === 'reaparece') {
    s.t++; s.rt--;
    if (s.rt <= 0) {
      s.fase = 'jugando'; s.x = s.rx; s.y = s.ry; s.vx = 0; s.vy = 0; s.suelo = true; s.coy = COYOTE; s.buf = 0; s.sos = 0; s.frio = INVULN; s.pj = (m & 4) ? 1 : 0;
      emite(s, { t: 'reaparecido' });
    }
    return s;
  }
  if (s.fase !== 'jugando') return s;
  s.t++;
  if (s.t > MAX_PASOS) { s.fase = 'fallo'; s.causa = 'tiempo'; emite(s, { t: 'fallo', causa: s.causa }); return s; }
  if (s.frio > 0) s.frio--;
  // 1) entrada
  const dir = ((m & 2) ? 1 : 0) - ((m & 1) ? 1 : 0);
  const salto = (m & 4) !== 0;
  if (salto && !s.pj) s.buf = BUFER; else if (s.buf > 0) s.buf--;
  s.pj = salto ? 1 : 0;
  if (s.suelo) s.coy = COYOTE; else if (s.coy > 0) s.coy--;
  // 2) movimiento horizontal y vertical
  const k = s.suelo ? 1 : AIRE;
  if (dir) {
    s.cara = dir;
    const a = ((s.vx * dir < 0) ? FRENO : ACC) * k * DT, obj = dir * VMAX;
    if (s.vx < obj) s.vx = Math.min(obj, s.vx + a); else if (s.vx > obj) s.vx = Math.max(obj, s.vx - a);
  } else {
    const a = FRENO * k * DT;
    if (s.vx > 0) s.vx = Math.max(0, s.vx - a); else if (s.vx < 0) s.vx = Math.min(0, s.vx + a);
  }
  if (s.buf > 0 && s.coy > 0) {
    s.saltos++; s.vy = SALTO; s.buf = 0; s.coy = 0; s.sos = SOSTENER; s.suelo = false;
    emite(s, { t: 'salto' });
  }
  let g = G;
  if (salto && s.vy > 0 && s.sos > 0) { g = G * G_SOSTENIDO; s.sos--; } else s.sos = 0;
  s.vy -= g * DT; if (s.vy < -CAIDA_MAX) s.vy = -CAIDA_MAX;
  // 3) colisiones: primero el eje x y luego el y
  const S = L.solids, n = S.length;
  const vxAntes = s.vx;
  const oldX = s.x, oldY = s.y;
  s.x += s.vx * DT;
  for (let i = 0; i < n; i++) {
    const c = S[i]; if (c.kind === 'oneway') continue;
    if (!(s.y < c.top - EPS && s.y + H > c.bot + EPS)) continue;
    if (!(s.x + HW > c.x0 && s.x - HW < c.x1)) continue;
    if (oldX + HW <= c.x0 + EPS && s.vx > 0) {
      s.x = c.x0 - HW;
      if (c.kind === 'rock' && Math.abs(vxAntes) > V_ROCA) dano(s, DANO_ROCA, 'roca', c.id);
      s.vx = 0;
    } else if (oldX - HW >= c.x1 - EPS && s.vx < 0) {
      s.x = c.x1 + HW;
      if (c.kind === 'rock' && Math.abs(vxAntes) > V_ROCA) dano(s, DANO_ROCA, 'roca', c.id);
      s.vx = 0;
    }
  }
  if (s.x < L.world.min_x + HW) { s.x = L.world.min_x + HW; if (s.vx < 0) s.vx = 0; }
  const vyAntes = s.vy;
  s.y += s.vy * DT;
  let aterrizo = false;
  if (s.vy <= 0) {
    let mejor = -1e18, idm = '', rutaDe = '';
    for (let i = 0; i < n; i++) {
      const c = S[i];
      if (!(s.x + HW > c.x0 + EPS && s.x - HW < c.x1 - EPS)) continue;
      if (oldY >= c.top - EPS && s.y <= c.top + EPS && c.top > mejor) { mejor = c.top; idm = c.id; rutaDe = c.route; }
    }
    if (mejor > -1e17) {
      s.y = mejor; s.vy = 0; aterrizo = true;
      if (!s.ruta && rutaDe) { s.ruta = rutaDe; emite(s, { t: 'ruta', id: rutaDe }); }
      const v = -vyAntes;
      if (v >= V_FUERTE) dano(s, DANO_FUERTE, 'fuerte', idm);
      else if (v >= V_MEDIO) dano(s, DANO_MEDIO, 'medio', idm);
      if (!s.suelo && v > 3) emite(s, { t: 'aterriza', v });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const c = S[i]; if (c.kind === 'oneway' || c.bot < -1e8) continue;
      if (!(s.x + HW > c.x0 + EPS && s.x - HW < c.x1 - EPS)) continue;
      if (oldY + H <= c.bot + EPS && s.y + H > c.bot) { s.y = c.bot - H; s.vy = 0; break; }
    }
  }
  s.suelo = aterrizo;
  // 4) integridad
  if (s.agua <= 0) { s.fase = 'fallo'; s.causa = 'agua'; emite(s, { t: 'fallo', causa: s.causa }); return s; }
  // 5) punto de control, límite de caída y meta
  while (s.cp < L.cps.length && s.x >= L.cps[s.cp].x) { const c = L.cps[s.cp++]; s.rx = c.x; s.ry = c.y; emite(s, { t: 'control', id: c.id }); }
  if (s.y < L.world.kill_y) {
    const c = Math.max(1, Math.round(DANO_CAIDA * s.dm));
    s.agua = Math.max(0, s.agua - c); s.danos += c; s.caidas++;
    emite(s, { t: 'caida', cantidad: c, resto: s.agua });
    if (s.agua <= 0) { s.fase = 'fallo'; s.causa = 'caida'; emite(s, { t: 'fallo', causa: s.causa }); return s; }
    s.fase = 'reaparece'; s.rt = REAPARECE; s.vx = 0; s.vy = 0;
    return s;
  }
  if (s.x >= L.goals.finish_x && s.agua >= L.goals.finish_min_integrity) {
    s.fase = 'meta'; s.estrellas = estrellas(L, s); s.vx = 0;
    emite(s, { t: 'meta', estrellas: s.estrellas });
  }
  return s;
}

/* Reproduce una partida entera a partir de las pulsaciones comprimidas [máscara, pasos, máscara, pasos, …]. */
function repetir(L, runs, opts) {
  const s = nuevo(L, opts); empezar(s);
  if (!Array.isArray(runs) || runs.length % 2) return s;
  let total = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const m = runs[i] | 0, c = runs[i + 1] | 0;
    if (m < 0 || m > 7 || c < 1) return null;
    total += c; if (total > MAX_PASOS + 1) return null;
    for (let j = 0; j < c; j++) { paso(L, s, m); if (s.fase === 'meta' || s.fase === 'fallo') return s; }
  }
  return s;
}
/* Graba pulsaciones en la forma comprimida */
function grabadora() {
  const r = []; let ult = -1, cnt = 0;
  return { anota(m) { if (m === ult) cnt++; else { if (cnt) r.push(ult, cnt); ult = m; cnt = 1; } }, runs() { return cnt ? r.concat([ult, cnt]) : r.slice(); } };
}
/* Reto diario: el nivel y las condiciones del día salen solo de la fecha (igual en la app y en el servidor) */
function retoDelDia(dia, ids) {
  const lista = (ids || []).filter(Boolean), h = parseInt(fnv('martin|' + dia), 16);
  const mods = ['normal', 'fragil', 'poca'];
  return { nivel: lista.length ? lista[h % lista.length] : '', mod: mods[Math.floor(h / 7) % mods.length] };
}
const resultado = s => ({ fase: s.fase, pasos: s.t, ms: Math.round(s.t * 1000 / 60), agua: s.agua, danos: s.danos, caidas: s.caidas, golpes: s.golpes, estrellas: s.estrellas, causa: s.causa });

/* ---------- Ayudas para la app y el robot de pruebas ---------- */
function clonar(s) { const c = Object.assign({}, s); c.ev = []; c.conEv = false; return c; }

const Mar = { DT, VMAX, ACC, FRENO, AIRE, SALTO, G, G_SOSTENIDO, SOSTENER, COYOTE, BUFER, W, H, HW, DANO_MEDIO, DANO_FUERTE, DANO_ROCA, DANO_CAIDA, V_MEDIO, V_FUERTE, V_ROCA,
  INVULN, REAPARECE, MAX_PASOS, MODS, retoDelDia, validar, cargar, nuevo, empezar, pausar, reanudar, paso, repetir, grabadora, resultado, estrellas, clonar, fnv };
if (typeof module !== 'undefined' && module.exports) module.exports = Mar;
root.Martin = Mar;
})(typeof self !== 'undefined' ? self : globalThis);
