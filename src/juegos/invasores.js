'use strict';
/*
 * Invasores espaciales en línea: RETO de puntuación. Todos juegan a la vez, cada uno en su móvil, la misma oleada
 * (la semilla la pone el servidor). Cuando todos han terminado, gana quien más puntos tiene.
 * Sin máquina: si alguien se desconecta se le espera hasta el límite de tiempo del reto.
 * Las puntuaciones las calcula cada móvil con el mismo motor (motores/invasores/invasores.js); el servidor comprueba que sean
 * posibles para el tiempo transcurrido, pero no puede repetir la partida: es un reto entre amigos, no una clasificación oficial.
 */
const crypto = require('crypto');
const id = 'invasores';
const min = 2, max = 6;
const sinMaquina = true;
const revancha = true;
const LIMITE_MS = +process.env.INVASORES_LIMITE_MS || 20 * 60 * 1000;     // tiempo máximo del reto
const NIVELES = ['facil', 'normal', 'dificil'];
const MAX_PTS_SEG = +process.env.INVASORES_MAX_PTS_SEG || 45;                                                    // tope generoso de puntos por segundo de juego

function opciones(o) {
  o = o || {};
  return { nivel: NIVELES.includes(o.nivel) ? o.nivel : 'normal' };
}

function iniciar(sala) {
  const res = {};
  sala.asientos.forEach(a => { res[a.id] = { puntos: 0, oleada: 1, fin: false, tfin: null }; });
  return { seed: crypto.randomInt(1, 2 ** 31 - 1), nivel: NIVELES.indexOf(sala.opciones.nivel) + 1, empezo: Date.now(), limite: Date.now() + LIMITE_MS,
    ids: sala.asientos.map(a => a.id), nombres: sala.asientos.map(a => a.nombre), res, id: sala.codigo + '-' + Date.now().toString(36), terminado: false };
}
const terminada = g => g.terminado || g.ids.every(i => g.res[i].fin);
const turnoDe = () => null;

function jugada(g, pid, a) {
  const r = g.res[pid];
  if (!r) return 'No estás en este reto';
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  if (a.tipo === 'revancha') return null;
  if (g.terminado || r.fin) return 'Tu partida ya ha terminado';
  if (a.tipo !== 'progreso' && a.tipo !== 'fin') return 'Jugada no válida';
  const puntos = Math.floor(+a.puntos), oleada = Math.floor(+a.oleada);
  if (!Number.isFinite(puntos) || puntos < 0 || puntos > 999999 || !Number.isFinite(oleada) || oleada < 1 || oleada > 99) return 'Puntuación no válida';
  const seg = (Date.now() - g.empezo) / 1000 + 2;
  if (puntos > seg * MAX_PTS_SEG + 50) return 'Puntuación imposible para ese tiempo';
  if (puntos < r.puntos) return 'La puntuación no puede bajar';
  r.puntos = puntos; r.oleada = Math.max(r.oleada, oleada);
  if (a.tipo === 'fin') { r.fin = true; r.tfin = Date.now(); }
  return null;
}
const pasoAuto = () => {};
const esperaListos = () => false;
const siguienteMano = () => false;

// Reloj del reto: al llegar al límite, termina para todos con lo que lleven
const reloj = g => (g.terminado || terminada(g) ? null : Math.max(0, g.limite - Date.now()));
function alVencer(g) {
  if (g.terminado || Date.now() < g.limite) return false;
  g.terminado = true; g.ids.forEach(i => { const r = g.res[i]; if (!r.fin) { r.fin = true; r.tfin = Date.now(); } });
  return true;
}
function alSalir(g, pid) { const r = g.res[pid]; if (r && !r.fin) { r.fin = true; r.tfin = Date.now(); } }

function orden(g) {                                  // posiciones: más puntos primero; a igualdad, quien llegó más lejos
  return g.ids.map((_, k) => k).sort((a, b) => g.res[g.ids[b]].puntos - g.res[g.ids[a]].puntos || g.res[g.ids[b]].oleada - g.res[g.ids[a]].oleada || a - b);
}
function vista(g, yoPid) {
  const yo = g.ids.indexOf(yoPid);
  const v = { yo: yo >= 0 ? yo : null, seed: g.seed, nivel: g.nivel, empezo: g.empezo, ahora: Date.now(), limite: g.limite, ids: g.ids.slice(), nombres: g.nombres.slice(),
    res: g.ids.map(i => ({ puntos: g.res[i].puntos, oleada: g.res[i].oleada, fin: g.res[i].fin })), turnoSilla: null, fase: terminada(g) ? 'fin' : 'jugando' };
  if (terminada(g)) { const o = orden(g); v.orden = o; v.partida = { id: g.id, created: g.empezo, nombres: g.nombres.slice(), bots: g.ids.map(() => false), orden: o, puntos: g.ids.map(i => g.res[i].puntos), oleadas: g.ids.map(i => g.res[i].oleada) }; }
  return v;
}

module.exports = { id, min, max, sinMaquina, revancha, opciones, iniciar, turnoDe, jugada, pasoAuto, esperaListos, siguienteMano, vista, terminada, reloj, alVencer, alSalir };
