// Pruebas del módulo de Ajedrez en el servidor común: dos jugadores, reloj, tablas, revancha, salir
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { LIMITE_MSG: '5000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-aj-')) });
const { crearServidor } = require('../src/server.js');
const S = require('../src/salas.js');
let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); if (process.env.GITHUB_ACTIONS) console.log('::error::' + n); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;
function cliente(nombre, token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx') {
  const c = { nombre, token, sala: undefined, errores: [] };
  c.abrir = () => new Promise(res => { c.ws = new WebSocket(URL_WS); c.ws.onopen = () => { c.enviar({ t: 'hola', token, nombre }); res(); };
    c.ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'error') c.errores.push(m.msg); if (m.t === 'sala') c.sala = m.sala; }; });
  c.enviar = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.mueve = u => c.enviar({ t: 'jugada', a: { tipo: 'mover', uci: u } });
  c.cerrar = () => c.ws.close();
  return c;
}
const hasta = async (f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await espera(15); } return false; };

console.log('Ajedrez en línea');
const a = cliente('Carlos'), b = cliente('Tere');
await a.abrir(); await b.abrir();
a.enviar({ t: 'crear', juego: 'ajedrez', opciones: { color: 'w', reloj: { base: 60000, inc: 2000 } } });
await hasta(() => a.sala && a.sala.codigo);
check('crear sala de ajedrez', a.sala.juego === 'ajedrez' && a.sala.estado === 'espera' && a.sala.max === 2 && a.sala.anfitrion);
a.enviar({ t: 'bot' }); await hasta(() => a.errores.length);
check('en ajedrez no se añade a la máquina', /no se puede añadir/.test(a.errores.pop() || ''));
b.enviar({ t: 'unirse', codigo: a.sala.codigo.toLowerCase() });
check('al entrar el segundo, empieza sola', await hasta(() => b.sala && b.sala.estado === 'jugando' && a.sala.estado === 'jugando'));
const P = () => a.sala.partida;
check('colores: quien crea juega con blancas', P().blancas === 'p1' && a.sala.partida.miColor === 0 && b.sala.partida.miColor === 1);
b.mueve('e7e5'); await hasta(() => b.errores.length);
check('fuera de turno se rechaza', b.errores.pop() === 'No es tu turno');
a.mueve('e2e5'); await hasta(() => a.errores.length);
check('jugada ilegal se rechaza', a.errores.pop() === 'Jugada ilegal');
a.mueve('f2f3');
check('la jugada llega al rival', await hasta(() => b.sala.partida.moves.join() === 'f2f3'));
check('el reloj de las negras corre', b.sala.partida.running && b.sala.partida.times[1] <= 60000);
b.mueve('e7e5'); await hasta(() => a.sala.partida.moves.length === 2);
check('el incremento se suma', a.sala.partida.times[1] > 60000 - 500 && a.sala.partida.times[1] <= 62000, JSON.stringify(a.sala.partida.times));
// desconexión y vuelta: se le espera (no juega la máquina)
b.cerrar(); await hasta(() => a.sala.asientos[1].conectado === false);
check('el rival ve la desconexión', a.sala.asientos[1].conectado === false && a.sala.estado === 'jugando');
a.mueve('g2g4'); await espera(150);
check('al ausente no le juega la máquina', a.sala.partida.moves.length === 3);
const b2 = cliente('Tere', b.token); await b2.abrir();
check('vuelve a su silla con la partida', await hasta(() => b2.sala && b2.sala.partida && b2.sala.partida.moves.length === 3 && b2.sala.yo === 'p2'));
b2.mueve('d8h4');
check('mate: resultado para los dos', await hasta(() => a.sala.estado === 'fin' && a.sala.partida.result === '0-1' && a.sala.partida.reason === 'mate'));
a.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); await hasta(() => a.sala.revancha.length === 1);
check('revancha pedida por uno: se espera al otro', a.sala.estado === 'fin' && b2.sala.revancha.includes('p1'));
b2.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
check('revancha: partida nueva con los colores cambiados', await hasta(() => a.sala.estado === 'jugando' && a.sala.partida.moves.length === 0 && a.sala.partida.blancas === 'p2' && a.sala.partida.miColor === 1));
b2.mueve('d2d4'); await hasta(() => a.sala.partida.moves.length === 1);
a.mueve('d7d5'); await hasta(() => b2.sala.partida.moves.length === 2);
b2.enviar({ t: 'jugada', a: { tipo: 'tablas' } }); await hasta(() => a.sala.partida.drawOffer === 0);
check('oferta de tablas', a.sala.partida.drawOffer === 0);
a.enviar({ t: 'jugada', a: { tipo: 'rechazar' } }); await hasta(() => b2.sala.partida.drawOffer === null);
check('rechazar tablas', b2.sala.partida.drawOffer === null);
b2.enviar({ t: 'jugada', a: { tipo: 'tablas' } }); await espera(50); a.enviar({ t: 'jugada', a: { tipo: 'tablas' } });
check('aceptar tablas', await hasta(() => b2.sala.estado === 'fin' && b2.sala.partida.result === '1/2-1/2'));
// reloj: caída de bandera decidida por el servidor
const x = cliente('X'), y = cliente('Y'); await x.abrir(); await y.abrir();
x.enviar({ t: 'crear', juego: 'ajedrez', opciones: { color: 'w', reloj: { base: 30000, inc: 0 } } }); await hasta(() => x.sala && x.sala.codigo);
y.enviar({ t: 'unirse', codigo: x.sala.codigo }); await hasta(() => y.sala && y.sala.estado === 'jugando');
x.mueve('e2e4'); await hasta(() => y.sala.partida.moves.length === 1);
const sala = S._salas.get(x.sala.codigo); sala.estadoJuego.times[1] = 150; sala.estadoJuego.tick = Date.now();
y.mueve('a7a6'); await hasta(() => x.sala.partida.moves.length === 2);   // reprograma el temporizador
sala.estadoJuego.times[0] = 120; sala.estadoJuego.tick = Date.now();
x.mueve('a2a3'); await hasta(() => y.sala.partida.moves.length === 3);
sala.estadoJuego.times[1] = 100; sala.estadoJuego.tick = Date.now(); S.jugada(x.token, { tipo: 'tablas' });   // fuerza difundir/programar
check('si se acaba el tiempo, pierde (lo decide el servidor)', await hasta(() => x.sala.estado === 'fin' && x.sala.partida.reason === 'tiempo' && x.sala.partida.result === '1-0', 2000), JSON.stringify(x.sala.partida));
// salir en juego = rendirse
const u = cliente('U'), v = cliente('V'); await u.abrir(); await v.abrir();
u.enviar({ t: 'crear', juego: 'ajedrez', opciones: { color: 'b' } }); await hasta(() => u.sala && u.sala.codigo);
v.enviar({ t: 'unirse', codigo: u.sala.codigo }); await hasta(() => v.sala && v.sala.estado === 'jugando');
check('color elegido: quien crea juega con negras', u.sala.partida.miColor === 1);
v.mueve('e2e4'); await hasta(() => u.sala.partida.moves.length === 1);
u.enviar({ t: 'salir' });
check('salir en juego cuenta como abandono', await hasta(() => v.sala.estado === 'fin' && v.sala.partida.result === '1-0' && v.sala.partida.reason === 'abandono'));
check('y quien sale ya no está en la sala', u.sala === null && v.sala.asientos[0].fuera);
v.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); await espera(80);
check('sin rival no hay revancha', v.sala.estado === 'fin');
// opciones absurdas
const w = cliente('W'); await w.abrir();
w.enviar({ t: 'crear', juego: 'ajedrez', opciones: { color: 'rojo', reloj: { base: 5 } } }); await hasta(() => w.sala && w.sala.codigo);
check('opciones no válidas se corrigen', w.sala.opciones.color === 'r' && w.sala.opciones.reloj === null);
// guardado: las partidas sobreviven a un reinicio
S.guardarYa();
const datos = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'salas.json'), 'utf8'));
check('las partidas de ajedrez se guardan en disco', datos.some(s => s.juego === 'ajedrez' && s.estadoJuego && s.estadoJuego.moves.length));
[a, b2, x, y, v, w].forEach(c => c.cerrar());
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
