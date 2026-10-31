// Pruebas del servidor de juegos en línea. Uso: npm test
'use strict';
process.env.SALAS_POR_IP_HORA = '1000';
const { server, latido, salas } = require('../servidor');
const WebSocket = require('ws');
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
let URL;
// Cliente de prueba: guarda todos los mensajes y permite esperar uno concreto
function cliente() {
  return new Promise(res => {
    const ws = new WebSocket(URL), c = { ws, msgs: [], ultimo: {} };
    ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); c.ultimo[m.t] = m; });
    c.send = m => ws.send(JSON.stringify(m));
    c.espera = (f, ms = 3000) => new Promise((ok2, ko2) => { const t0 = Date.now(); const tick = () => { const m = c.msgs.find(f); if (m) { c.msgs.splice(c.msgs.indexOf(m), 1); ok2(m); } else if (Date.now() - t0 > ms) ko2(new Error('tiempo')); else setTimeout(tick, 10); }; tick(); });
    c.estado = () => c.espera(m => m.t === 'estado');
    c.ultimoEstado = async () => { await espera(80); const l = c.msgs.filter(m => m.t === 'estado'); return l[l.length - 1]; };
    c.cerrar = () => ws.close();
    ws.on('open', () => res(c));
  });
}
(async () => {
  await new Promise(r => server.listen(0, r));
  URL = `ws://localhost:${server.address().port}/ws`;
  console.log('Salas');
  const a = await cliente();
  check('saludo con la versión del protocolo', !!(await a.espera(m => m.t === 'hola')).protocolo);
  a.send({ t: 'crear', juego: 'ajedrez', nombre: '<b>Carlos</b>', opciones: { color: 'w' } });
  const sa = await a.espera(m => m.t === 'sala');
  check('crear sala: código de 4 caracteres y ficha', /^[A-Z2-9]{4}$/.test(sa.codigo) && sa.asiento === 0 && sa.token.length === 24, JSON.stringify(sa));
  let ea = await a.estado();
  check('nombre limpio y esperando rival', ea.jugadores[0].nombre === 'bCarlos/b' && ea.jugadores[1] === null);
  a.send({ t: 'jugada', jugada: 'e2e4' });
  check('no se juega sin rival', (await a.espera(m => m.t === 'error')).codigo === 'esperando');
  const b = await cliente();
  b.send({ t: 'unirse', codigo: sa.codigo.toLowerCase(), nombre: 'Tere', juego: 'ajedrez' });
  const sb = await b.espera(m => m.t === 'sala');
  check('unirse con el código (da igual mayúsculas)', sb.asiento === 1 && sb.codigo === sa.codigo);
  const c3 = await cliente(); c3.send({ t: 'unirse', codigo: sa.codigo, nombre: 'Intruso' });
  check('la sala completa no admite a un tercero', (await c3.espera(m => m.t === 'error')).codigo === 'llena');
  c3.send({ t: 'unirse', codigo: 'ZZZZ' });
  check('código inexistente', (await c3.espera(m => m.t === 'error')).codigo === 'no-existe');
  c3.send({ t: 'crear', juego: 'parchis' });
  check('juego desconocido', (await c3.espera(m => m.t === 'error')).codigo === 'juego');

  console.log('Partida');
  b.send({ t: 'jugada', jugada: 'e7e5' });
  check('no se puede jugar fuera de turno', (await b.espera(m => m.t === 'error')).msg === 'No es tu turno');
  a.send({ t: 'jugada', jugada: 'e2e5' });
  check('jugada ilegal rechazada', (await a.espera(m => m.t === 'error')).msg === 'Jugada ilegal');
  a.send({ t: 'jugada', jugada: '<script>' });
  check('basura rechazada', (await a.espera(m => m.t === 'error')).msg === 'Jugada no válida');
  for (const [cl, u] of [[a, 'f2f3'], [b, 'e7e5'], [a, 'g2g4']]) { cl.send({ t: 'jugada', jugada: u }); await espera(40); }
  // b se desconecta y vuelve con su ficha
  b.cerrar(); await espera(100);
  ea = await a.ultimoEstado();
  check('el rival ve que se ha desconectado', ea.jugadores[1].conectado === false);
  const b2 = await cliente();
  b2.send({ t: 'unirse', codigo: sa.codigo, token: sb.token });
  const sb2 = await b2.espera(m => m.t === 'sala');
  const eb2 = await b2.estado();
  check('reconexión: vuelve a su sitio con la partida', sb2.asiento === 1 && eb2.estado.moves.join() === 'f2f3,e7e5,g2g4');
  b2.send({ t: 'jugada', jugada: 'd8h4' });
  const fin = await a.ultimoEstado();
  check('mate: los dos reciben el resultado', fin.estado.result === '0-1' && fin.estado.reason === 'mate', JSON.stringify(fin.estado));
  a.send({ t: 'jugada', jugada: 'a2a3' });
  check('después del final no se juega', (await a.espera(m => m.t === 'error')).msg === 'La partida ha terminado');
  a.send({ t: 'accion', accion: 'revancha' }); await espera(50);
  b2.send({ t: 'accion', accion: 'revancha' });
  const ra = await a.espera(m => m.t === 'sala');
  check('revancha: se cambian los colores', ra.asiento === 1);
  const er = await b2.ultimoEstado();
  check('y empieza una partida nueva', er.estado.moves.length === 0 && !er.estado.result && er.asiento === 0);
  for (const [cl, u] of [[b2, 'd2d4'], [a, 'd7d5']]) { cl.send({ t: 'jugada', jugada: u }); await espera(40); }
  b2.send({ t: 'accion', accion: 'tablas' }); await espera(40);
  check('oferta de tablas', (await a.ultimoEstado()).estado.drawOffer === 0);
  a.send({ t: 'accion', accion: 'rechazar' }); await espera(40);
  check('rechazar tablas', (await b2.ultimoEstado()).estado.drawOffer === null);
  b2.send({ t: 'accion', accion: 'tablas' }); await espera(40); a.send({ t: 'accion', accion: 'tablas' });
  check('aceptar tablas', (await b2.ultimoEstado()).estado.result === '1/2-1/2');

  console.log('Reloj');
  const x = await cliente(), y = await cliente();
  x.send({ t: 'crear', juego: 'ajedrez', nombre: 'X', opciones: { color: 'w', reloj: { base: 30000, inc: 0 } } });
  const sx = await x.espera(m => m.t === 'sala');
  y.send({ t: 'unirse', codigo: sx.codigo, nombre: 'Y' }); await y.espera(m => m.t === 'sala');
  x.send({ t: 'jugada', jugada: 'e2e4' }); await espera(60);
  const sala = salas.get(sx.codigo);
  check('el reloj de las negras corre tras la primera jugada', sala.estado.tick > 0 && (await y.ultimoEstado()).estado.running);
  sala.estado.times[1] = 150; sala.estado.tick = Date.now();
  require('../servidor').programarReloj(sala);
  await espera(300);
  check('si se acaba el tiempo, pierde (lo decide el servidor)', sala.estado.result === '1-0' && sala.estado.reason === 'tiempo', JSON.stringify(sala.estado));
  check('y se lo comunica a los dos', (await x.ultimoEstado()).estado.reason === 'tiempo');
  const w = await cliente();
  w.send({ t: 'crear', juego: 'ajedrez', opciones: { reloj: { base: 1, inc: 0 } } });
  await w.espera(m => m.t === 'sala');
  check('un reloj absurdo se ignora', salas.get((await w.estado()).codigo).estado.clock === null);
  w.send({ t: 'salir' }); await espera(50);
  check('salir antes de empezar libera el sitio', salas.get((w.ultimo.sala || {}).codigo).asientos.every(a => !a));

  console.log('Protección');
  const z = await cliente();
  for (let i = 0; i < 60; i++) z.send({ t: 'ping' });
  await espera(200);
  check('limita los mensajes por segundo', z.msgs.some(m => m.t === 'error' && m.codigo === 'despacio'));
  const big = await cliente(); let cerrado = false; big.ws.on('close', () => cerrado = true);
  big.ws.send('x'.repeat(10000)); await espera(200);
  check('mensajes enormes cierran la conexión', cerrado);
  const s0 = await cliente(); s0.send({ t: 'ping' });
  check('el servidor sigue funcionando', (await s0.espera(m => m.t === 'pong')).servidor > 0); s0.cerrar();
  const http = require('http');
  const salud = await new Promise(r => http.get(`http://localhost:${server.address().port}/salud`, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d))); }));
  check('ruta /salud', salud.ok && salud.juegos.includes('ajedrez'));

  [a, b2, c3, x, y, w, z].forEach(c => c.cerrar());
  clearInterval(latido); server.close();
  console.log(`\n${ok} correctas, ${ko} fallidas`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
