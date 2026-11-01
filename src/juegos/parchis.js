'use strict';
/*
 * Parchís en línea (de 2 a 4 jugadores). Cada silla (p1…p4) es un color; el dado lo tira el servidor
 * con números aleatorios criptográficos. La máquina juega en las sillas de bot y por quien se queda
 * sin conexión. Las reglas son las de la app (motores/parchis/parchis.js).
 */
const crypto = require('crypto');
const path = require('path');
const MOTORES = process.env.MOTORES_DIR || path.join(__dirname, '..', '..', 'motores');
const P = require(path.join(MOTORES, 'parchis', 'parchis.js'));

const id = 'parchis';
const min = 2, max = 4;
const revancha = true;
// Colores según el número de jugadores: con dos, enfrentados
const COLORES_POR_N = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const NIVELES = { facil: 1, normal: 2, dificil: 3 };

function opciones(o) {
  o = o || {};
  return { nivel: NIVELES[o.nivel] ? o.nivel : 'normal' };
}

function iniciar(sala) {
  const n = Math.min(4, Math.max(2, sala.asientos.length));
  const cols = COLORES_POR_N[n];
  // en cada revancha se cambia quién empieza: se rota la asignación de colores
  const rot = (sala.ronda || 0) % n;
  const color = {};
  sala.asientos.slice(0, n).forEach((a, k) => { color[a.id] = cols[(k + rot) % n]; });
  const juego = P.nueva(cols);
  return {
    id: sala.codigo + '-' + Date.now().toString(36), created: Date.now(),
    nivel: NIVELES[sala.opciones.nivel] || 2,
    color, nombres: Object.fromEntries(sala.asientos.map(a => [a.id, a.nombre])),
    bots: sala.asientos.filter(a => a.bot).map(a => a.id),
    juego, fuera: []
  };
}

const silla = (g, c) => Object.keys(g.color).find(k => g.color[k] === c) || null;
const terminada = g => g.juego.fase === 'fin';
function turnoDe(g) { return terminada(g) ? null : silla(g, g.juego.turno); }
const dado = () => crypto.randomInt(1, 7);

function jugada(g, pid, a) {
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  const j = g.juego;
  if (terminada(g)) return 'La partida ha terminado';
  if (turnoDe(g) !== pid) return 'No es tu turno';
  if (a.tipo === 'tirar') {
    if (j.fase !== 'tirar') return 'Ahora toca mover una ficha';
    P.tirar(j, dado());
    return null;
  }
  if (a.tipo === 'mover') {
    if (j.fase !== 'mover') return 'Primero tira el dado';
    const i = Number(a.ficha);
    if (!Number.isInteger(i) || i < 0 || i > 3) return 'Jugada no válida';
    return P.mover(j, i) ? null : 'Esa ficha no puede moverse';
  }
  return 'Jugada no válida';
}

// La máquina: tira o mueve (un paso cada vez, para que se vea)
function pasoAuto(g) {
  const j = g.juego;
  if (terminada(g)) return;
  if (j.fase === 'tirar') { P.tirar(j, dado()); return; }
  const pid = silla(g, j.turno);
  const nivel = g.bots.includes(pid) ? g.nivel : 2;
  const i = P.elegir(j, nivel);
  if (i != null) P.mover(j, i);
}

const esperaListos = () => false;
const siguienteMano = () => false;

// Quien abandona en juego pasa a la máquina (lo hace salas.js); se apunta el bot
function alSalir(g, pid) { if (!g.bots.includes(pid)) g.bots.push(pid); }

function vista(g, yo) {
  const j = g.juego;
  const mio = g.color[yo];
  const out = {
    colores: j.colores.slice(), fichas: j.fichas.map(f => f.slice()), turno: j.turno, turnoSilla: turnoDe(g),
    fase: j.fase, dado: j.dado, valor: j.valor, premio: !!j.premio, seises: j.seises, ultimo: j.ultimo, n: j.n,
    ganador: j.ganador, orden: j.orden.slice(), stats: j.stats,
    color: Object.assign({}, g.color), nombres: Object.assign({}, g.nombres), bots: g.bots.slice(),
    yo: mio == null ? null : mio,
    movs: mio != null && j.turno === mio && j.fase === 'mover' ? P.movimientos(j).map(m => ({ i: m.i, a: m.a, come: !!m.come, meta: !!m.meta })) : [],
    partida: null
  };
  if (terminada(g)) out.partida = { id: g.id, created: g.created, color: g.color, nombres: g.nombres, bots: g.bots, orden: j.orden, stats: j.stats, n: j.n };
  return out;
}

module.exports = { id, min, max, revancha, opciones, iniciar, turnoDe, jugada, pasoAuto, esperaListos, siguienteMano, vista, terminada, alSalir };
