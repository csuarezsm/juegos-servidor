// Pruebas del servidor de partidas: dos jugadores reales + la máquina, de principio a fin
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '5', SEGUIR_MS: '80', AUSENTE_MS: '300', LIMITE_MSG: '5000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-')) });
const { crearServidor } = require('../src/server.js');
const { chinchon: E } = require('../src/motor.js');
const S = require('../src/salas.js');

let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); if (process.env.GITHUB_ACTIONS) console.log('::error::' + (n + (x ? ' → ' + x : '')).replace(/\n/g, ' ').slice(0, 900)); } };
const espera = ms => new Promise(r => setTimeout(r, ms));

const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;

function cliente(nombre, token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx') {
  const c = { nombre, token, sala: null, errores: [], hecho: new Set(), auto: true, vioOtraMano: false };
  c.abrir = () => new Promise(res => {
    c.ws = new WebSocket(URL_WS);
    c.ws.onopen = () => { c.enviar({ t: 'hola', token, nombre }); res(); };
    c.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'error') c.errores.push(m.msg);
      if (m.t === 'sala') { c.sala = m.sala; if (c.auto) jugar(c); }
    };
  });
  c.enviar = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.cerrar = () => c.ws.close();
  return c;
}
function jugar(c) {
  const s = c.sala; if (!s || s.estado !== 'jugando') return;
  const p = s.partida, yo = s.yo;
  if (p.resultado == null && p.jugadores.some(j => j.id !== yo && p.miMano && false)) c.vioOtraMano = true;
  const clave = [p.mano, p.turnos, p.fase, p.turno].join('|');
  if (c.hecho.has(clave)) return;
  if (p.fase === 'over') { if (!p.listos.includes(yo)) { c.hecho.add(clave); c.enviar({ t: 'jugada', a: p.puedeReenganchar ? { tipo: 'reenganche' } : { tipo: 'listo' } }); } return; }
  if (p.turno !== yo) return;
  c.hecho.add(clave);
  if (p.fase === 'draw') return c.enviar({ t: 'jugada', a: { tipo: 'robar', de: 'mazo' } });
  const b = E.bestDiscard(p.miMano);
  c.enviar({ t: 'jugada', a: { tipo: 'tirar', carta: b.discard, cerrar: b.bm.dead <= E.CLOSE_MAX && p.ronda >= p.cerrarDesde } });
}
async function hasta(cond, ms = 20000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('Servidor de partidas');
const salud = await (await fetch(`http://127.0.0.1:${server.address().port}/salud`)).json();
check('responde en /salud', salud.ok === true);

const A = cliente('Carlos'), B = cliente('Mari');
await A.abrir(); await B.abrir();
A.enviar({ t: 'crear', juego: 'chinchon', opciones: { limite: 60, cerrarDesde: 2 } });
check('crea la sala con un código de 4 letras', await hasta(() => A.sala && /^[A-Z2-9]{4}$/.test(A.sala.codigo)));
B.enviar({ t: 'unirse', codigo: 'ZZZZ' });
check('código inexistente da error', await hasta(() => B.errores.some(e => /No existe/.test(e))));
B.enviar({ t: 'unirse', codigo: A.sala.codigo.toLowerCase() });
check('el segundo jugador entra con el código', await hasta(() => B.sala && B.sala.asientos.length === 2 && A.sala.asientos.length === 2));
B.enviar({ t: 'empezar' });
check('solo el anfitrión puede empezar', await hasta(() => B.errores.some(e => /Solo quien crea/.test(e))));
A.enviar({ t: 'bot' });
check('el anfitrión añade a la máquina', await hasta(() => A.sala.asientos.length === 3 && A.sala.asientos[2].bot));
A.auto = B.auto = false;
A.enviar({ t: 'empezar' });
check('empieza la partida', await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando'));
{
  const pa = A.sala.partida, pb = B.sala.partida;
  check('cada uno ve solo sus 7 cartas', pa.miMano.length === 7 && pb.miMano.length === 7 && !pa.miMano.some(x => pb.miMano.includes(x)));
  check('la vista no incluye las cartas de los demás', !JSON.stringify(pb).includes(JSON.stringify(pa.miMano)) && pb.resultado === null);
  const noToca = pa.turno === A.sala.yo ? B : A;
  noToca.enviar({ t: 'jugada', a: { tipo: 'robar', de: 'mazo' } });
  check('no se puede jugar fuera de turno', await hasta(() => noToca.errores.some(e => /No es tu turno/.test(e))));
}
A.auto = B.auto = true; jugar(A); jugar(B);
// a mitad de partida, Mari pierde la conexión: la máquina juega por ella y luego vuelve
await hasta(() => (A.sala.partida.historial || []).length >= 1, 30000);
const manoAntes = A.sala.partida.mano;
B.cerrar();
check('se nota la desconexión', await hasta(() => A.sala.asientos.some(a => a.id === B.sala.yo && !a.conectado)));
check('la partida sigue sin ella (juega la máquina)', await hasta(() => A.sala.estado === 'fin' || A.sala.partida.mano > manoAntes + 1, 30000));
const B2 = cliente('Mari', B.token); await B2.abrir();
check('al volver recupera su silla y la partida', await hasta(() => B2.sala && B2.sala.yo === B.sala.yo && B2.sala.codigo === A.sala.codigo));
const okFin = await hasta(() => A.sala.estado === 'fin' && B2.sala.estado === 'fin', 60000); if (!okFin) console.log(JSON.stringify({p: A.sala.partida, asientos: A.sala.asientos, B2: B2.sala && B2.sala.yo, errA: A.errores, errB: B2.errores}).slice(0, 3000));
check('la partida termina con ganador', okFin);
const fin = A.sala.partida;
check('al final se entrega la partida completa para el historial', !!(fin.fin && fin.partida && fin.partida.events.length && fin.partida.players.length === 3));
check('los totales cuadran con el motor', JSON.stringify(E.compute({ ...fin.partida, cfg: fin.partida.cfg }).ended.winner) === JSON.stringify(fin.fin.ganador));

// salir en la sala de espera y límites
const C = cliente('Pepe'); await C.abrir();
C.enviar({ t: 'crear', juego: 'chinchon' }); await hasta(() => C.sala);
const cod = C.sala.codigo;
C.enviar({ t: 'salir' });
check('si se va el único jugador, la sala desaparece', await hasta(() => C.sala === null && !S._salas.has(cod)));
C.enviar({ t: 'crear', juego: 'chinchon', nombre: '<b>Pepe</b>\u0000' }); await hasta(() => C.sala);
check('los nombres se limpian', C.sala.asientos[0].nombre === 'bPepe/b');
const D = cliente('X'); await D.abrir();
for (let i = 0; i < 12; i++) D.enviar({ t: 'unirse', codigo: 'QQQ' + i });
check('freno a probar códigos', await hasta(() => D.errores.some(e => /Demasiados intentos/.test(e))));

for (const c of [A, B2, C, D]) c.cerrar();
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
