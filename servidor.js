// Servidor de juegos en línea común para las apps de IT Canarias.
// © 2026 IT Canarias. Todos los derechos reservados.
//
// - Salas con código de 4 caracteres para compartir por WhatsApp. Sin cuentas ni contraseñas.
// - El servidor valida todas las jugadas con el módulo de cada juego (juegos/*.js).
// - Si se corta la conexión, el jugador vuelve a su sitio con su ficha (token).
// - No guarda nada en disco: las salas viven en memoria y se borran solas.
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const JUEGOS = {
  ajedrez: require('./juegos/ajedrez'),
  // pumba: require('./juegos/pumba'),      ← se añaden aquí, con la misma interfaz
  // chinchon: require('./juegos/chinchon'),
};

const PORT = +process.env.PORT || 8090;
const MAX_SALAS = +process.env.MAX_SALAS || 800;     // ~110 MB con todas llenas (medido: 300 salas = 76 MB)
const SALAS_POR_IP_HORA = +process.env.SALAS_POR_IP_HORA || 30;
const VACIA_MS = 10 * 60e3;          // sala sin nadie conectado: se borra a los 10 min
const INACTIVA_MS = 6 * 3600e3;      // sala sin actividad: se borra a las 6 h
const VERSION_PROTOCOLO = 1;

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin 0/O ni 1/I para que no haya dudas
const salas = new Map();
const creadasPorIp = new Map();

const limpio = n => String(n == null ? '' : n).replace(/[<>"'`\u0000-\u001f]/g, '').trim().slice(0, 24);
const ficha = () => crypto.randomBytes(12).toString('hex');
function nuevoCodigo() {
  for (let i = 0; i < 50; i++) {
    let c = ''; const b = crypto.randomBytes(4);
    for (const x of b) c += ALFABETO[x % ALFABETO.length];
    if (!salas.has(c)) return c;
  }
  return null;
}
function enviar(ws, msg) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); } catch (e) {} } }

function difundir(sala) {
  const ahora = Date.now();
  sala.asientos.forEach((a, i) => {
    if (!a || !a.ws) return;
    enviar(a.ws, {
      t: 'estado', codigo: sala.codigo, juego: sala.juego, asiento: i,
      jugadores: sala.asientos.map(x => x ? { nombre: x.nombre, conectado: !!x.ws } : null),
      turno: sala.mod.turno(sala.estado), revancha: sala.revancha.slice(),
      estado: sala.mod.vista(sala.estado, i, ahora), servidor: ahora,
    });
  });
}
// Programa la caída de bandera del jugador que tiene el turno
function programarReloj(sala) {
  clearTimeout(sala.temporizador);
  const ms = sala.mod.tiempoHastaBandera ? sala.mod.tiempoHastaBandera(sala.estado, Date.now()) : null;
  if (ms == null) return;
  sala.temporizador = setTimeout(() => {
    if (sala.mod.comprobarTiempo(sala.estado, Date.now())) difundir(sala); else programarReloj(sala);
  }, ms + 30);
}
function llena(sala) { return sala.asientos.every(Boolean); }

function alCrear(ws, m) {
  const mod = JUEGOS[m.juego];
  if (!mod) return enviar(ws, { t: 'error', codigo: 'juego', msg: 'Juego no disponible' });
  if (salas.size >= MAX_SALAS) return enviar(ws, { t: 'error', codigo: 'lleno', msg: 'El servidor está lleno. Prueba en un rato.' });
  const hora = Math.floor(Date.now() / 3600e3), k = ws.ip + ':' + hora;
  const n = (creadasPorIp.get(k) || 0) + 1; creadasPorIp.set(k, n);
  if (n > SALAS_POR_IP_HORA) return enviar(ws, { t: 'error', codigo: 'limite', msg: 'Demasiadas salas creadas. Espera un poco.' });
  const codigo = nuevoCodigo(); if (!codigo) return enviar(ws, { t: 'error', codigo: 'lleno', msg: 'No se pudo crear la sala' });
  const opciones = m.opciones && typeof m.opciones === 'object' ? m.opciones : {};
  const sala = { codigo, juego: m.juego, mod, estado: mod.iniciar(opciones), opciones, asientos: new Array(mod.jugadores).fill(null), revancha: [], creada: Date.now(), actividad: Date.now(), vaciaDesde: null, temporizador: null };
  const asiento = mod.asientoCreador ? mod.asientoCreador(opciones) : 0;
  const yo = { token: ficha(), nombre: limpio(m.nombre) || 'Jugador', ws };
  sala.asientos[asiento] = yo;
  salas.set(codigo, sala);
  ws.sala = sala; ws.yo = yo;
  enviar(ws, { t: 'sala', codigo, asiento, token: yo.token, juego: m.juego });
  difundir(sala);
}
function alUnirse(ws, m) {
  const codigo = String(m.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sala = salas.get(codigo);
  if (!sala) return enviar(ws, { t: 'error', codigo: 'no-existe', msg: 'No hay ninguna sala con ese código' });
  if (m.juego && m.juego !== sala.juego) return enviar(ws, { t: 'error', codigo: 'otro-juego', msg: 'Esa sala es de otro juego' });
  // ¿vuelve alguien que ya estaba? (reconexión con su ficha)
  let i = m.token ? sala.asientos.findIndex(a => a && a.token === m.token) : -1;
  if (i >= 0) {
    const yo = sala.asientos[i];
    if (yo.ws && yo.ws !== ws) { enviar(yo.ws, { t: 'error', codigo: 'otra-conexion', msg: 'Has entrado desde otro sitio' }); try { yo.ws.close(); } catch (e) {} }
    yo.ws = ws; if (m.nombre) yo.nombre = limpio(m.nombre) || yo.nombre;
  } else {
    i = sala.asientos.findIndex(a => !a);
    if (i < 0) return enviar(ws, { t: 'error', codigo: 'llena', msg: 'La sala ya está completa' });
    sala.asientos[i] = { token: ficha(), nombre: limpio(m.nombre) || 'Jugador', ws };
  }
  const yo = sala.asientos[i];
  ws.sala = sala; ws.yo = yo; sala.actividad = Date.now(); sala.vaciaDesde = null;
  enviar(ws, { t: 'sala', codigo: sala.codigo, asiento: i, token: yo.token, juego: sala.juego });
  difundir(sala);
}
function miAsiento(ws) { const s = ws.sala; return s ? s.asientos.indexOf(ws.yo) : -1; }
function alJugar(ws, m) {
  const sala = ws.sala, i = miAsiento(ws);
  if (!sala || i < 0) return enviar(ws, { t: 'error', codigo: 'sin-sala', msg: 'No estás en ninguna sala' });
  if (!llena(sala)) return enviar(ws, { t: 'error', codigo: 'esperando', msg: 'Falta que entre tu rival' });
  const r = sala.mod.jugada(sala.estado, i, m.jugada, Date.now());
  sala.actividad = Date.now();
  if (r.error) { enviar(ws, { t: 'error', codigo: 'jugada', msg: r.error }); difundir(sala); return; }
  programarReloj(sala); difundir(sala);
}
function alAccion(ws, m) {
  const sala = ws.sala, i = miAsiento(ws);
  if (!sala || i < 0) return enviar(ws, { t: 'error', codigo: 'sin-sala', msg: 'No estás en ninguna sala' });
  sala.actividad = Date.now();
  if (m.accion === 'revancha') {
    if (!sala.mod.fin(sala.estado)) return enviar(ws, { t: 'error', codigo: 'accion', msg: 'La partida no ha terminado' });
    if (!sala.revancha.includes(i)) sala.revancha.push(i);
    if (sala.revancha.length === sala.asientos.length) {
      // nueva partida con los asientos rotados (en ajedrez, se cambian los colores)
      sala.asientos.push(sala.asientos.shift());
      sala.estado = sala.mod.iniciar(sala.opciones); sala.revancha = [];
      sala.asientos.forEach((a, k) => { if (a && a.ws) enviar(a.ws, { t: 'sala', codigo: sala.codigo, asiento: k, token: a.token, juego: sala.juego }); });
    }
    difundir(sala); return;
  }
  if (!llena(sala)) return enviar(ws, { t: 'error', codigo: 'esperando', msg: 'Falta que entre tu rival' });
  const r = sala.mod.accion(sala.estado, i, m.accion, Date.now());
  if (r.error) return enviar(ws, { t: 'error', codigo: 'accion', msg: r.error });
  programarReloj(sala); difundir(sala);
}
// explicito = el jugador ha pulsado «Salir»; si no, se ha cortado la conexión y su sitio le espera
function alSalir(ws, explicito) {
  const sala = ws.sala, i = miAsiento(ws); if (!sala || i < 0) return;
  // si sale a propósito antes de empezar, se libera el sitio; en cualquier otro caso se le guarda
  if (explicito && sala.estado.moves && !sala.estado.moves.length && !sala.mod.fin(sala.estado)) sala.asientos[i] = null;
  else sala.asientos[i].ws = null;
  ws.sala = null; ws.yo = null;
  if (sala.asientos.every(a => !a || !a.ws)) sala.vaciaDesde = Date.now();
  difundir(sala);
}

const server = http.createServer((req, res) => {
  if (req.url === '/salud' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, servicio: 'juegos-servidor', protocolo: VERSION_PROTOCOLO, juegos: Object.keys(JUEGOS), salas: salas.size }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  ws.ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  ws.vivo = true; ws.cubo = 30; ws.cuboT = Date.now();
  ws.on('pong', () => { ws.vivo = true; });
  ws.on('error', () => { try { ws.terminate(); } catch (e) {} });   // p. ej. mensaje demasiado grande: se corta esa conexión, el servidor sigue
  ws.on('message', raw => {
    // límite: unos 6 mensajes por segundo de media, con margen
    const ahora = Date.now(); ws.cubo = Math.min(30, ws.cubo + (ahora - ws.cuboT) / 1000 * 6); ws.cuboT = ahora;
    if (ws.cubo < 1) return enviar(ws, { t: 'error', codigo: 'despacio', msg: 'Demasiados mensajes' });
    ws.cubo--;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try {
      if (m.t === 'crear') { if (ws.sala) alSalir(ws, true); alCrear(ws, m); }
      else if (m.t === 'unirse') { if (ws.sala) alSalir(ws, false); alUnirse(ws, m); }
      else if (m.t === 'jugada') alJugar(ws, m);
      else if (m.t === 'accion') alAccion(ws, m);
      else if (m.t === 'salir') alSalir(ws, true);
      else if (m.t === 'ping') enviar(ws, { t: 'pong', servidor: Date.now() });
    } catch (e) { console.error('error', e); enviar(ws, { t: 'error', codigo: 'interno', msg: 'Error del servidor' }); }
  });
  ws.on('close', () => alSalir(ws, false));
  enviar(ws, { t: 'hola', protocolo: VERSION_PROTOCOLO, juegos: Object.keys(JUEGOS) });
});
// Conexiones muertas (móvil sin cobertura) y salas abandonadas
const latido = setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.vivo) { try { ws.terminate(); } catch (e) {} return; } ws.vivo = false; try { ws.ping(); } catch (e) {} });
  const ahora = Date.now();
  for (const [c, s] of salas) {
    if ((s.vaciaDesde && ahora - s.vaciaDesde > VACIA_MS) || ahora - s.actividad > INACTIVA_MS) { clearTimeout(s.temporizador); salas.delete(c); }
  }
  const hora = Math.floor(ahora / 3600e3);
  for (const k of creadasPorIp.keys()) if (!k.endsWith(':' + hora)) creadasPorIp.delete(k);
}, 30e3);

if (require.main === module) {
  server.listen(PORT, () => console.log(`juegos-servidor escuchando en el puerto ${PORT}`));
  const parar = () => { clearInterval(latido); wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
  process.on('SIGTERM', parar); process.on('SIGINT', parar);
}
module.exports = { server, wss, salas, latido, JUEGOS, programarReloj };
