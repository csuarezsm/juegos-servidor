// Pruebas del módulo de Damas en el servidor común: dos jugadores, captura obligatoria, reloj, tablas, revancha, salir
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { LIMITE_MSG: '5000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-da-')) });
const { crearServidor } = require('../src/server.js');
const S = require('../src/salas.js');
const D = require('../motores/damas/damas.js');
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

console.log('Damas en línea');
const a = cliente('Carlos'), b = cliente('Tere');
await a.abrir(); await b.abrir();
a.enviar({ t: 'crear', juego: 'damas', opciones: { color: 'w', reloj: { base: 60000, inc: 2000 } } });
await hasta(() => a.sala && a.sala.codigo);
check('crear sala de damas', a.sala.juego === 'damas' && a.sala.estado === 'espera' && a.sala.max === 2);
a.enviar({ t: 'bot' }); await hasta(() => a.errores.length);
check('en damas no se añade a la máquina', /no se puede añadir/.test(a.errores.pop() || ''));
b.enviar({ t: 'unirse', codigo: a.sala.codigo });
check('al entrar el segundo, empieza sola', await hasta(() => b.sala && b.sala.estado === 'jugando' && a.sala.estado === 'jugando'));
check('colores: quien crea juega con blancas', a.sala.partida.miColor === 0 && b.sala.partida.miColor === 1);
b.mueve('g6h5'); await hasta(() => b.errores.length);
check('fuera de turno se rechaza', b.errores.pop() === 'No es tu turno');
a.mueve('f3f5'); await hasta(() => a.errores.length);
check('jugada ilegal se rechaza', a.errores.pop() === 'Jugada ilegal');
a.mueve('f3e4');
check('la jugada llega al rival', await hasta(() => b.sala.partida.moves.join() === 'f3e4'));
check('el reloj de las negras corre', b.sala.partida.running && b.sala.partida.times[1] <= 60000);
// hasta una captura obligatoria: una jugada sin comer se rechaza
const quien = c => c === 0 ? a : b;
let p = D.replay(a.sala.partida.moves).pos, guard = 0;
while (!p.mustCapture() && guard++ < 60) {
  const L = p.legal(); const m = L[(guard * 7) % L.length]; const u = p.uci(m), n = a.sala.partida.moves.length;
  quien(p.turn).mueve(u); await hasta(() => a.sala.partida.moves.length === n + 1 && b.sala.partida.moves.length === n + 1);
  p = D.replay(a.sala.partida.moves).pos; if (D.status(p).over) break;
}
const tmp = p.clone(); const caps = tmp.captures([]); 
const quietas = tmp.quietMoves([]);
let rechazo = true;
if (p.mustCapture() && quietas.length) { const c = quien(p.turn); c.mueve(p.uci(quietas[0])); await hasta(() => c.errores.length); rechazo = c.errores.pop() === 'Jugada ilegal'; }
check('comer es obligatorio también en el servidor', p.mustCapture() && rechazo && caps.length > 0);
const L = p.legal(); const n0 = a.sala.partida.moves.length;
quien(p.turn).mueve(p.uci(L[0]));
check('la captura se acepta', await hasta(() => a.sala.partida.moves.length === n0 + 1));
// tablas
const t = D.replay(a.sala.partida.moves).pos.turn;
quien(t).enviar({ t: 'jugada', a: { tipo: 'tablas' } }); await hasta(() => a.sala.partida.drawOffer === t);
check('oferta de tablas', a.sala.partida.drawOffer === t);
quien(1 - t).enviar({ t: 'jugada', a: { tipo: 'rechazar' } }); await hasta(() => a.sala.partida.drawOffer === null);
check('rechazar tablas', a.sala.partida.drawOffer === null);
// rendirse y revancha con colores cambiados
b.enviar({ t: 'jugada', a: { tipo: 'rendirse' } });
check('rendirse: ganan las blancas', await hasta(() => a.sala.estado === 'fin' && a.sala.partida.result === '1-0' && a.sala.partida.reason === 'abandono'));
a.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); await espera(30); b.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
check('revancha: partida nueva con los colores cambiados', await hasta(() => a.sala.estado === 'jugando' && a.sala.partida.moves.length === 0 && a.sala.partida.miColor === 1));
// reloj: si se acaba, pierde (en damas siempre se puede ganar)
const x = cliente('X'), y = cliente('Y'); await x.abrir(); await y.abrir();
x.enviar({ t: 'crear', juego: 'damas', opciones: { color: 'w', reloj: { base: 30000, inc: 0 } } }); await hasta(() => x.sala && x.sala.codigo);
y.enviar({ t: 'unirse', codigo: x.sala.codigo }); await hasta(() => y.sala && y.sala.estado === 'jugando');
x.mueve('h3g4'); await hasta(() => y.sala.partida.moves.length === 1);
y.mueve('c6d5'); await hasta(() => x.sala.partida.moves.length === 2);
x.mueve('b3a4'); await hasta(() => y.sala.partida.moves.length === 3);
const sala = S._salas.get(x.sala.codigo); sala.estadoJuego.times[1] = 100; sala.estadoJuego.tick = Date.now(); S.jugada(x.token, { tipo: 'tablas' });   // fuerza difundir/programar
check('si se acaba el tiempo, pierde', await hasta(() => x.sala.estado === 'fin' && x.sala.partida.reason === 'tiempo' && x.sala.partida.result === '1-0', 2000), JSON.stringify(x.sala.partida));
// salir en juego = rendirse
const u = cliente('U'), v = cliente('V'); await u.abrir(); await v.abrir();
u.enviar({ t: 'crear', juego: 'damas', opciones: { color: 'b' } }); await hasta(() => u.sala && u.sala.codigo);
v.enviar({ t: 'unirse', codigo: u.sala.codigo }); await hasta(() => v.sala && v.sala.estado === 'jugando');
v.mueve('d3c4'); await hasta(() => u.sala.partida.moves.length === 1);
u.enviar({ t: 'salir' });
check('salir en juego cuenta como abandono', await hasta(() => v.sala.estado === 'fin' && v.sala.partida.result === '1-0' && v.sala.partida.reason === 'abandono'));
const w = cliente('W'); await w.abrir();
w.enviar({ t: 'crear', juego: 'damas', opciones: { color: 'rojo', reloj: { base: 5 } } }); await hasta(() => w.sala && w.sala.codigo);
check('opciones no válidas se corrigen', w.sala.opciones.color === 'r' && w.sala.opciones.reloj === null);
S.guardarYa();
const datos = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'salas.json'), 'utf8'));
check('las partidas de damas se guardan en disco', datos.some(s => s.juego === 'damas' && s.estadoJuego));
[a, b, x, y, v, w].forEach(c => c.cerrar());
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
