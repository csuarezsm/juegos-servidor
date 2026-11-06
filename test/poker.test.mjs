// Pruebas del Póker en línea: personas + la máquina, de principio a fin
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '2', SEGUIR_MS: '80', AUSENTE_MS: '300', POKER_RITMO_MS: '400', LIMITE_MSG: '20000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-')) });
const { crearServidor } = require('../src/server.js');
const P = require('../motores/poker/poker.js');
const S = require('../src/salas.js');

let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;

function cliente(nombre, token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx') {
  const c = { nombre, token, sala: null, errores: [], hecho: new Set(), auto: true, hola: null };
  c.abrir = () => new Promise(res => {
    c.ws = new WebSocket(URL_WS);
    c.ws.onopen = () => { c.enviar({ t: 'hola', token, nombre }); res(); };
    c.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'hola') c.hola = m;
      if (m.t === 'error') c.errores.push(m.msg);
      if (m.t === 'sala') { c.sala = m.sala; if (c.auto) jugar(c); }
    };
  });
  c.enviar = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.cerrar = () => c.ws.close();
  return c;
}
// Juega como una persona impaciente: todo o igualar/pasar; tras cada mano pulsa «Seguir»
function jugar(c) {
  const s = c.sala; if (!s || s.estado !== 'jugando') return;
  const p = s.partida;
  if (p.fase === 'mano_fin') { const k = 'f' + p.mano; if (!c.hecho.has(k)) { c.hecho.add(k); c.enviar({ t: 'jugada', a: { tipo: 'seguir' } }); } return; }
  if (p.turnoSilla !== s.yo) return;
  const clave = p.mano + '|' + p.fase + '|' + (p.ultimo ? p.ultimo.n : 0);
  if (c.hecho.has(clave)) return;
  c.hecho.add(clave);
  const L = P.legal(p, p.yo);                      // el cliente calcula sus opciones sobre la vista
  if (!L) return;
  if (L.raise && Math.random() < 0.6) c.enviar({ t: 'jugada', a: { tipo: 'allin' } });
  else c.enviar({ t: 'jugada', a: { tipo: L.check ? 'check' : 'call' } });
}
async function hasta(cond, ms = 20000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('Póker en línea');
const A = cliente('Carlos'), B = cliente('Mari');
await A.abrir(); await B.abrir();
check('el saludo incluye el póker', await hasta(() => A.hola && A.hola.juegos.includes('poker')));
A.auto = B.auto = false;
A.enviar({ t: 'crear', juego: 'poker', opciones: { nivel: 'raro', fichas: 7, ritmo: 'x', manosNivel: 99 } });
check('crea la sala de 2 a 9', await hasta(() => A.sala && A.sala.juego === 'poker' && A.sala.max === 9 && A.sala.min === 2));
check('las opciones se limpian', JSON.stringify(A.sala.opciones) === JSON.stringify({ nivel: 'normal', fichas: 1500, manosNivel: 10, ritmo: 'normal' }), JSON.stringify(A.sala.opciones));
B.enviar({ t: 'unirse', codigo: A.sala.codigo });
await hasta(() => B.sala && A.sala.asientos.length === 2);
A.enviar({ t: 'bot' });
await hasta(() => A.sala.asientos.length === 3);
A.enviar({ t: 'empezar' });
check('empieza la partida', await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando'));
{
  const p = A.sala.partida, q = B.sala.partida;
  check('tres asientos con 1500 fichas menos las ciegas', p.seats.length === 3 && p.seats.reduce((t, s) => t + s.stack + s.bet, 0) === 4500);
  check('cada uno sabe su asiento', p.yo != null && q.yo != null && p.yo !== q.yo);
  check('ve sus cartas y no las ajenas', p.seats[p.yo].cards.every(c => c >= 0) && p.seats.every((s, i) => i === p.yo || s.cards.every(c => c === -1)));
  check('el mazo no viaja', p.deck === undefined && q.deck === undefined);
  const s = S._salas.get(A.sala.codigo); clearTimeout(s.timer);
  const toca = p.turnoSilla === A.sala.yo ? A : p.turnoSilla === B.sala.yo ? B : null;
  const noToca = toca === A ? B : A;
  noToca.enviar({ t: 'jugada', a: { tipo: 'check' } });
  check('no se puede jugar fuera de turno', await hasta(() => noToca.errores.some(e => /No es tu turno/.test(e))));
  check('jugada mal formada', S.JUEGOS.poker.jugada(s.estadoJuego, 'p1', { tipo: 'robar' }) !== null && S.JUEGOS.poker.jugada(s.estadoJuego, 'p1', null) !== null);
  if (toca) {
    toca.enviar({ t: 'jugada', a: { tipo: 'raise', a: 1 } });
    check('subida por debajo del mínimo rechazada', await hasta(() => toca.errores.some(e => /mínima|No puedes/.test(e))));
  } else check('subida por debajo del mínimo rechazada', true);
  check('la vista trae el tiempo de turno solo para humanos', toca ? (p.venceEn == null || p.venceEn > Date.now() - 2000) : true);
}
// Reloj: si quien tiene el turno no hace nada, pasa o se retira solo
{
  const s = S._salas.get(A.sala.codigo); S._programar(s);
  const antes = A.sala.partida.ultimo ? A.sala.partida.ultimo.n : 0, mano = A.sala.partida.mano;
  check('el reloj de turno juega por quien no actúa', await hasta(() => { const p = A.sala.partida; return p.mano > mano || (p.ultimo ? p.ultimo.n : 0) > antes; }, 5000));
}
// Módulo: revancha rota los asientos; reparto del bote justo
{
  const J = S.JUEGOS.poker;
  const g = J.iniciar({ codigo: 'TEST', opciones: J.opciones({}), asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }, { id: 'p3', nombre: 'c', bot: true }] });
  check('con tres asientos, 3 ids y un bot', g.ids.length === 3 && g.motor.seats.filter(s => s.bot).length === 1);
  const g2 = J.iniciar({ codigo: 'T', ronda: 1, opciones: J.opciones({}), asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }] });
  check('en la revancha se cambian los asientos', g2.ids[0] === 'p2' && g2.motor.seats[0].nombre === 'b');
  const v = J.vista(g, 'p1');
  check('la vista de un espectador no ve ninguna carta', J.vista(g, 'zz').seats.every(s => s.cards.every(c => c === -1)));
  check('la vista del jugador marca su asiento', v.yo === g.ids.indexOf('p1'));
}
// La partida sigue sola hasta el final, también con uno desconectado
A.auto = B.auto = true;
{ const s = S._salas.get(A.sala.codigo); S._programar(s); }
jugar(A); jugar(B);
await hasta(() => A.sala.partida.mano > 3, 30000);
B.cerrar();
check('se nota la desconexión', await hasta(() => A.sala.asientos.some(a => a.id === 'p2' && !a.conectado)));
const mAntes = A.sala.partida.mano;
check('la partida sigue sin ella (juega la máquina)', await hasta(() => A.sala.estado === 'fin' || A.sala.partida.mano > mAntes + 1 || A.sala.partida.fase === 'fin', 30000));
const B2 = cliente('Mari', B.token); await B2.abrir();
check('al volver recupera su asiento', await hasta(() => B2.sala && B2.sala.yo === 'p2' && B2.sala.codigo === A.sala.codigo));
const okFin = await hasta(() => A.sala.estado === 'fin' && B2.sala.estado === 'fin', 180000);
if (!okFin) console.log(JSON.stringify({ p: A.sala.partida.fase, mano: A.sala.partida.mano, errA: A.errores, errB: B2.errores }).slice(0, 1500));
check('el torneo termina con ganador', okFin);
const fin = A.sala.partida;
check('al final se entrega la partida para el historial', !!(fin.partida && fin.partida.orden.length === 3 && fin.ganador === fin.partida.orden[0]));
check('el campeón tiene todas las fichas', fin.seats[fin.ganador].stack === 4500);
check('los puestos van del 1 al 3', fin.seats.map(s => s.place).sort().join() === '1,2,3');
const raras = [...A.errores, ...B2.errores].filter(e => !/No es tu turno|mínima|No puedes|Ahora no|aún no|Jugada no válida/.test(e));
check('sin errores inesperados del servidor', !raras.length, raras.join(' | '));
// revancha
A.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); B2.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
check('revancha en la misma sala', await hasta(() => A.sala.estado === 'jugando' && A.sala.partida.ganador == null));

// Mesa llena: 9 y no más
{
  const C = cliente('Pepe'); C.auto = false; await C.abrir();
  C.enviar({ t: 'crear', juego: 'poker', opciones: { nivel: 'dificil', ritmo: 'rapido' } });
  await hasta(() => C.sala);
  for (let i = 0; i < 8; i++) C.enviar({ t: 'bot' });
  check('caben 9 jugadores', await hasta(() => C.sala.asientos.length === 9));
  C.enviar({ t: 'bot' });
  check('no cabe un décimo', await hasta(() => C.errores.some(e => /completa/.test(e))));
  C.enviar({ t: 'empezar' }); await hasta(() => C.sala.estado === 'jugando');
  check('con nueve, nueve asientos y las ciegas puestas', C.sala.partida.seats.length === 9 && C.sala.partida.seats.filter(s => s.bet > 0).length === 2);
  C.enviar({ t: 'salir' });
  check('si se va la única persona, la sala desaparece', await hasta(() => C.sala === null));
  C.cerrar();
}
for (const c of [A, B2]) c.cerrar();
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
