'use strict';
/*
 * Salas de juego, común a todos los juegos. Cada juego es un módulo en ./juegos.
 * Un jugador se identifica por un token privado que guarda su app: así puede
 * reconectarse a la misma silla aunque cambie de red o cierre la app.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JUEGOS = {
  chinchon: require('./juegos/chinchon'),
  ajedrez: require('./juegos/ajedrez'),
  // pumba: require('./juegos/pumba'),   ← cada juego nuevo, un módulo con la misma interfaz
};

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // sin 0/O ni 1/I
const PASO_BOT_MS = +process.env.PASO_BOT_MS || 900;      // pausa de la máquina entre jugadas
const AUSENTE_MS = +process.env.AUSENTE_MS || 30000;      // sin conexión este tiempo → juega la máquina por él
const SEGUIR_MS = +process.env.SEGUIR_MS || 25000;        // tras una mano, se reparte solo pasado este tiempo
const MAX_SALAS = +process.env.MAX_SALAS || 500;          // medido: 300 partidas llenas ≈ 120 MB (con los clientes de prueba en el mismo proceso)
const CADUCA_MS = 12 * 3600e3, CADUCA_FIN_MS = 3600e3;

const salas = new Map();          // codigo → sala
const conexiones = new Map();     // token → Set(ws)
let guardarTimer = null;
const DATOS = process.env.DATA_DIR || path.join(__dirname, '..', 'datos');

const limpiaNombre = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
const tokenValido = t => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

function nuevoCodigo() {
  for (let i = 0; i < 50; i++) {
    let c = ''; for (let k = 0; k < 4; k++) c += ALFABETO[crypto.randomInt(ALFABETO.length)];
    if (!salas.has(c)) return c;
  }
  throw new Error('Sin códigos libres');
}

/* ---------- Envío ---------- */
function enviar(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function aToken(token, msg) { for (const ws of conexiones.get(token) || []) enviar(ws, msg); }
const conectado = token => (conexiones.get(token) || new Set()).size > 0;

function vistaSala(s, token) {
  const yo = s.asientos.find(a => a.token === token);
  const J = JUEGOS[s.juego];
  return {
    codigo: s.codigo, juego: s.juego, estado: s.estado, opciones: s.opciones, max: J.max, min: J.min,
    yo: yo ? yo.id : null, anfitrion: !!(yo && yo.token === s.anfitrion),
    asientos: s.asientos.map(a => ({ id: a.id, nombre: a.nombre, bot: !!a.bot, conectado: a.bot || (!a.fuera && conectado(a.token)), fuera: !!a.fuera, anfitrion: a.token === s.anfitrion })),
    revancha: s.revancha || [],
    partida: s.estadoJuego ? J.vista(s.estadoJuego, yo ? yo.id : null) : null
  };
}
function difundir(s) {
  for (const a of s.asientos) if (!a.bot) aToken(a.token, { t: 'sala', sala: vistaSala(s, a.token) });
  s.actividad = Date.now();
  programarGuardado();
  programar(s);
}

/* ---------- Motor de turnos: bots, ausentes y siguiente mano ---------- */
// Las tareas programadas nunca deben tumbar el servidor
const seguro = (s, fn) => () => { try { fn(); } catch (e) { console.error('Error en la sala ' + s.codigo + ':', e); } };
function programar(s) {
  clearTimeout(s.timer); s.timer = null;
  if (s.estado !== 'jugando') return;
  const J = JUEGOS[s.juego], g = s.estadoJuego;
  if (J.terminada(g)) { s.estado = 'fin'; s.finEn = Date.now(); s.revancha = []; difundir(s); return; }
  // juegos con reloj y sin máquina (ajedrez): solo se programa la caída de bandera; al ausente se le espera
  if (J.reloj) {
    const ms = J.reloj(g);
    if (ms != null) s.timer = setTimeout(seguro(s, () => { if (J.alVencer(g)) difundir(s); else programar(s); }), ms + 30);
    return;
  }
  const turno = J.turnoDe(g);
  if (turno) {
    const a = s.asientos.find(x => x.id === turno);
    if (a.bot) { s.timer = setTimeout(seguro(s, () => { J.pasoAuto(g); difundir(s); }), PASO_BOT_MS); return; }
    if (!conectado(a.token)) {
      const falta = Math.max(0, (a.desconectadoEn || Date.now()) + AUSENTE_MS - Date.now());
      s.timer = setTimeout(seguro(s, () => { if (!conectado(a.token) && J.turnoDe(g) === turno) { J.pasoAuto(g); difundir(s); } else programar(s); }), falta + 50);
    }
    return;
  }
  // mano terminada: se espera a que todos pulsen «Seguir» (o se reparte sola pasado un rato)
  const humanos = s.asientos.filter(a => !a.bot && conectado(a.token)).map(a => a.id);
  const sigue = seguro(s, () => { if (J.siguienteMano(g)) difundir(s); });
  if (!J.esperaListos(g, humanos)) { s.timer = setTimeout(sigue, 1200); return; }
  s.timer = setTimeout(sigue, SEGUIR_MS);
}

/* ---------- Acciones ---------- */
function salaDe(token) { for (const s of salas.values()) if (s.asientos.some(a => a.token === token)) return s; return null; }

function crear(token, nombre, juego, opciones) {
  const J = JUEGOS[juego]; if (!J) return 'Juego desconocido';
  if (salaDe(token)) salir(token);
  if (salas.size >= MAX_SALAS) return 'El servidor está lleno; prueba en un rato';
  const s = { codigo: nuevoCodigo(), juego, opciones: J.opciones(opciones), anfitrion: token, estado: 'espera', asientos: [], estadoJuego: null, creada: Date.now(), actividad: Date.now() };
  s.asientos.push({ id: 'p1', token, nombre: limpiaNombre(nombre) || 'Jugador 1' });
  salas.set(s.codigo, s);
  difundir(s);
  return null;
}
function unirse(token, nombre, codigo) {
  const s = salas.get(String(codigo || '').toUpperCase().trim());
  if (!s) return 'No existe ninguna partida con ese código';
  const ya = s.asientos.find(a => a.token === token);
  if (ya) { if (nombre) ya.nombre = limpiaNombre(nombre) || ya.nombre; difundir(s); return null; }
  if (s.estado !== 'espera') return 'Esa partida ya ha empezado';
  if (s.asientos.length >= JUEGOS[s.juego].max) return 'La partida está completa';
  const otra = salaDe(token); if (otra) salir(token);
  s.asientos.push({ id: siguienteId(s), token, nombre: limpiaNombre(nombre) || 'Jugador ' + (s.asientos.length + 1) });
  // juegos que empiezan solos al completarse la mesa (ajedrez)
  const J = JUEGOS[s.juego];
  if (J.autoEmpezar && s.asientos.length >= J.max) { s.estadoJuego = J.iniciar(s); s.estado = 'jugando'; }
  difundir(s);
  return null;
}
const siguienteId = s => { for (let i = 1; ; i++) if (!s.asientos.some(a => a.id === 'p' + i)) return 'p' + i; };
const BOT_NOMBRES = ['Pancho', 'Chano', 'Candelaria', 'Tomasa', 'Nieves', 'Domingo', 'Fefa', 'Agustín', 'Chona', 'Ramón', 'Pino', 'Luci'];
function anadirBot(token) {
  const s = salaDe(token);
  if (!s || s.anfitrion !== token) return 'Solo quien crea la partida puede añadir a la máquina';
  if (s.estado !== 'espera') return 'La partida ya ha empezado';
  if (JUEGOS[s.juego].sinMaquina) return 'En este juego no se puede añadir a la máquina';
  if (s.asientos.length >= JUEGOS[s.juego].max) return 'La partida está completa';
  const usados = new Set(s.asientos.map(a => a.nombre.replace(/^🤖 /, '')));
  const libres = BOT_NOMBRES.filter(n => !usados.has(n));
  s.asientos.push({ id: siguienteId(s), token: 'bot-' + crypto.randomUUID(), bot: true, nombre: '🤖 ' + (libres[crypto.randomInt(libres.length)] || 'Máquina') });
  difundir(s);
  return null;
}
function quitar(token, asiento) {
  const s = salaDe(token);
  if (!s || s.anfitrion !== token || s.estado !== 'espera') return 'No se puede quitar';
  const a = s.asientos.find(x => x.id === asiento);
  if (!a || a.token === token) return 'No se puede quitar';
  s.asientos = s.asientos.filter(x => x !== a);
  if (!a.bot) aToken(a.token, { t: 'fuera', motivo: 'Te han quitado de la partida' });
  difundir(s);
  return null;
}
function empezar(token) {
  const s = salaDe(token); const J = s && JUEGOS[s.juego];
  if (!s || s.anfitrion !== token) return 'Solo quien crea la partida puede empezarla';
  if (s.estado !== 'espera') return 'Ya ha empezado';
  if (s.asientos.length < J.min) return 'Hacen falta al menos ' + J.min + ' jugadores (puedes añadir a la máquina)';
  s.estadoJuego = J.iniciar(s);
  s.estado = 'jugando';
  difundir(s);
  return null;
}
function jugada(token, a) {
  const s = salaDe(token);
  const yo = s && s.asientos.find(x => x.token === token);
  // revancha: cuando la piden todos los que siguen en la sala, partida nueva en la misma sala
  if (s && s.estado === 'fin' && a && a.tipo === 'revancha' && JUEGOS[s.juego].revancha) {
    s.revancha = s.revancha || [];
    if (!s.revancha.includes(yo.id)) s.revancha.push(yo.id);
    const humanos = s.asientos.filter(x => !x.bot && !x.fuera);
    if (s.asientos.every(x => !x.fuera) && humanos.every(x => s.revancha.includes(x.id))) {
      s.ronda = (s.ronda || 0) + 1; s.estadoJuego = JUEGOS[s.juego].iniciar(s); s.estado = 'jugando'; s.revancha = []; s.finEn = null;
    }
    difundir(s);
    return null;
  }
  if (!s || s.estado !== 'jugando') return 'No hay partida en juego';
  const err = JUEGOS[s.juego].jugada(s.estadoJuego, yo.id, a);
  if (err) return err;
  difundir(s);
  return null;
}
function salir(token) {
  const s = salaDe(token); if (!s) return null;
  const a = s.asientos.find(x => x.token === token);
  if (s.estado === 'espera') {
    s.asientos = s.asientos.filter(x => x !== a);
    if (!s.asientos.some(x => !x.bot)) { borrar(s); return null; }
    if (s.anfitrion === token) s.anfitrion = s.asientos.find(x => !x.bot).token;
  } else if (JUEGOS[s.juego].sinMaquina) {
    // juegos sin máquina (ajedrez): salir en juego es rendirse; la silla se queda con su nombre
    const J = JUEGOS[s.juego];
    if (s.estado === 'jugando' && J.alSalir) J.alSalir(s.estadoJuego, a.id);
    a.fuera = true; a.token = 'fuera-' + crypto.randomUUID();
    if (s.anfitrion === token) { const h = s.asientos.find(x => !x.bot && !x.fuera); s.anfitrion = h ? h.token : null; }
    if (!s.asientos.some(x => !x.bot && !x.fuera)) { borrar(s); return null; }
  } else {
    // en juego: su silla la ocupa la máquina hasta el final
    a.bot = true; a.token = 'bot-' + crypto.randomUUID(); a.nombre = a.nombre.startsWith('🤖') ? a.nombre : '🤖 ' + a.nombre;
    if (s.estadoJuego && s.estadoJuego.play) s.estadoJuego.play.bots.push(a.id);
    if (s.anfitrion === token) { const h = s.asientos.find(x => !x.bot); s.anfitrion = h ? h.token : null; }
    if (!s.asientos.some(x => !x.bot)) { borrar(s); return null; }
  }
  difundir(s);
  return null;
}
function borrar(s) { clearTimeout(s.timer); salas.delete(s.codigo); programarGuardado(); }

/* ---------- Conexiones ---------- */
function alConectar(token, ws) {
  if (!conexiones.has(token)) conexiones.set(token, new Set());
  conexiones.get(token).add(ws);
  const s = salaDe(token);
  if (s) { const a = s.asientos.find(x => x.token === token); a.desconectadoEn = null; difundir(s); }
  else enviar(ws, { t: 'sala', sala: null });
}
function alDesconectar(token, ws) {
  const set = conexiones.get(token); if (!set) return;
  set.delete(ws);
  if (set.size) return;
  conexiones.delete(token);
  const s = salaDe(token);
  if (s) { const a = s.asientos.find(x => x.token === token); a.desconectadoEn = Date.now(); difundir(s); }
}

/* ---------- Guardado en disco (las partidas sobreviven a un reinicio) ---------- */
function programarGuardado() { if (!guardarTimer) guardarTimer = setTimeout(guardar, 2000); }
function guardar() {
  guardarTimer = null;
  try {
    fs.mkdirSync(DATOS, { recursive: true });
    const datos = [...salas.values()].map(({ timer, ...s }) => s);
    const tmp = path.join(DATOS, 'salas.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(datos));
    fs.renameSync(tmp, path.join(DATOS, 'salas.json'));
  } catch (e) { console.error('No se pudo guardar:', e.message); }
}
function cargar() {
  try {
    const datos = JSON.parse(fs.readFileSync(path.join(DATOS, 'salas.json'), 'utf8'));
    for (const s of datos) if (JUEGOS[s.juego]) { s.asientos.forEach(a => { if (!a.bot) a.desconectadoEn = Date.now(); }); salas.set(s.codigo, s); }
    for (const s of salas.values()) programar(s);
    console.log('Partidas recuperadas:', salas.size);
  } catch (e) { if (e.code !== 'ENOENT') console.error('No se pudieron cargar las partidas:', e.message); }
}
function limpiar() {
  const ahora = Date.now();
  for (const s of salas.values()) {
    const vivo = s.asientos.some(a => !a.bot && !a.fuera && conectado(a.token));
    if ((s.estado === 'fin' && ahora - (s.finEn || s.actividad) > CADUCA_FIN_MS) || (!vivo && ahora - s.actividad > CADUCA_MS)) borrar(s);
  }
}

function guardarYa() { clearTimeout(guardarTimer); guardar(); }
const estadisticas = () => ({ salas: salas.size, jugando: [...salas.values()].filter(s => s.estado === 'jugando').length, conexiones: [...conexiones.values()].reduce((n, x) => n + x.size, 0) });

module.exports = { JUEGOS, tokenValido, limpiaNombre, crear, unirse, anadirBot, quitar, empezar, jugada, salir, alConectar, alDesconectar, cargar, limpiar, guardarYa, estadisticas, enviar, _salas: salas };
