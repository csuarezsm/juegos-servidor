// Pruebas del Pumba en línea: dos jugadores reales + la máquina, de principio a fin
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '5', SEGUIR_MS: '80', AUSENTE_MS: '300', PAUSA_RECLAMAR_MS: '150', LIMITE_MSG: '5000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-')) });
const { crearServidor } = require('../src/server.js');
const { pumba: E } = require('../src/motor.js');
const S = require('../src/salas.js');

let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); if (process.env.GITHUB_ACTIONS) console.log('::error::' + (n + (x ? ' → ' + x : '')).replace(/\n/g, ' ').slice(0, 900)); } };
const espera = ms => new Promise(r => setTimeout(r, ms));

const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;

function cliente(nombre, token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx') {
  const c = { nombre, token, sala: null, errores: [], hecho: new Set(), auto: true, olvidar: false, hola: null };
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
// Juega como una persona: la carta que elegiría la máquina; dice «¡Pumba!» salvo que se le pida olvidarlo
function jugar(c) {
  const s = c.sala; if (!s || s.estado !== 'jugando') return;
  const p = s.partida, yo = s.yo;
  const clave = [p.mano, p.turnos, p.fase, p.turno, p.olvido].join('|');
  if (c.hecho.has(clave)) return;
  if (p.fase === 'over') { if (!p.listos.includes(yo)) { c.hecho.add(clave); c.enviar({ t: 'jugada', a: p.puedeReenganchar ? { tipo: 'reenganche' } : { tipo: 'listo' } }); } return; }
  if (p.olvido && p.olvido !== yo && p.miMano) { c.hecho.add(clave); c.enviar({ t: 'jugada', a: { tipo: 'reclamar' } }); return; }
  if (p.turno !== yo || !p.miMano) return;
  c.hecho.add(clave);
  if (!p.jugables.length || p.castigo && !p.jugables.length) return c.enviar({ t: 'jugada', a: { tipo: 'robar' } });
  const carta = p.jugables.find(x => x[1] !== '1' || x.length > 2) || p.jugables[0];
  const palo = carta.slice(1) === '10' ? 'o' : null;
  c.enviar({ t: 'jugada', a: { tipo: 'echar', carta, palo, pumba: !(c.olvidar && p.miMano.length === 2) } });
}
async function hasta(cond, ms = 20000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('Pumba en línea');
const A = cliente('Carlos'), B = cliente('Mari');
await A.abrir(); await B.abrir();
check('el saludo dice qué juegos hay', await hasta(() => A.hola && A.hola.juegos.includes('pumba')));
A.auto = B.auto = false;
A.enviar({ t: 'crear', juego: 'pumba', opciones: { limite: 40, reenganches: 1, figuras: 'cara', nivel: 'normal' } });
check('crea la sala de Pumba', await hasta(() => A.sala && A.sala.juego === 'pumba' && A.sala.max === 6));
check('las opciones se limpian', A.sala.opciones.limite === 50 && A.sala.opciones.sotaLibre === true);
B.enviar({ t: 'unirse', codigo: A.sala.codigo });
await hasta(() => B.sala && A.sala.asientos.length === 2);
A.enviar({ t: 'bot' });
await hasta(() => A.sala.asientos.length === 3);
A.enviar({ t: 'empezar' });
check('empieza la partida', await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando'));
{
  const pa = A.sala.partida, pb = B.sala.partida;
  check('cada uno ve solo sus 5 cartas', pa.miMano.length === 5 && pb.miMano.length === 5 && !pa.miMano.some(x => pb.miMano.includes(x)));
  check('la vista no incluye el mazo ni las cartas de los demás', !('deck' in pb) && !JSON.stringify(pb).includes(JSON.stringify(pa.miMano)));
  check('la primera carta de la mesa no es especial', ![2, 3, 10, 11].includes(Number(S._salas.get(A.sala.codigo).estadoJuego.play.hand.pile[0].slice(1))));
  const noToca = pa.turno === A.sala.yo ? B : (pa.turno === B.sala.yo ? A : null);
  if (noToca) { noToca.enviar({ t: 'jugada', a: { tipo: 'robar' } }); check('no se puede jugar fuera de turno', await hasta(() => noToca.errores.some(e => /No es tu turno/.test(e)))); }
  else check('no se puede jugar fuera de turno', true);
}
// «¡Pumba!» olvidado y reclamado, comprobado directamente sobre una sala preparada
{
  const s = S._salas.get(A.sala.codigo), g = s.estadoJuego, h = g.play.hand;
  const [a, b, bot] = ['p1', 'p2', 'p3'];
  clearTimeout(s.timer);
  const top = h.pile[h.pile.length - 1];
  h.hands[a] = [top[0] + (top.slice(1) === '4' ? '5' : '4'), 'b12']; h.turn = a; h.penalty = 0; h.suit = top[0];
  const carta = h.hands[a][0];
  require('../src/salas.js').jugada(A.token, { tipo: 'echar', carta, pumba: false });
  check('si olvida decir «¡Pumba!», todos lo ven', await hasta(() => B.sala.partida.olvido === a && A.sala.partida.olvido === a));
  A.enviar({ t: 'jugada', a: { tipo: 'reclamar' } });
  check('no se lo puede reclamar uno mismo', await hasta(() => A.errores.some(e => /a ti mismo/.test(e))));
  B.enviar({ t: 'jugada', a: { tipo: 'reclamar' } });
  check('otro jugador lo reclama fuera de turno y el despistado roba dos', await hasta(() => A.sala.partida.miMano.length === 3 && !B.sala.partida.olvido));
  B.enviar({ t: 'jugada', a: { tipo: 'reclamar' } });
  check('la segunda reclamación ya no vale', await hasta(() => B.errores.some(e => /Ya no se puede/.test(e))));
}
// la partida sigue sola hasta el final; Mari se olvida a veces de decir «¡Pumba!»
B.olvidar = true; A.auto = B.auto = true; jugar(A); jugar(B);
await hasta(() => (A.sala.partida.historial || []).length >= 1, 30000);
const manoAntes = A.sala.partida.mano;
B.cerrar();
check('se nota la desconexión', await hasta(() => A.sala.asientos.some(a => a.id === 'p2' && !a.conectado)));
check('la partida sigue sin ella (juega la máquina)', await hasta(() => A.sala.estado === 'fin' || A.sala.partida.mano > manoAntes + 1, 30000));
const B2 = cliente('Mari', B.token); B2.olvidar = true; await B2.abrir();
check('al volver recupera su silla y la partida', await hasta(() => B2.sala && B2.sala.yo === 'p2' && B2.sala.codigo === A.sala.codigo));
const okFin = await hasta(() => A.sala.estado === 'fin' && B2.sala.estado === 'fin', 90000);
if (!okFin) console.log(JSON.stringify({ p: A.sala.partida, errA: A.errores, errB: B2.errores }).slice(0, 3000));
check('la partida termina con ganador', okFin);
const fin = A.sala.partida;
check('al final se entrega la partida completa para el historial', !!(fin.fin && fin.partida && fin.partida.events.length && fin.partida.players.length === 3));
check('el ganador cuadra con el motor', E.compute(fin.partida).ended.winner === fin.fin.ganador);
check('quien cierra cada mano no suma', fin.historial.every(h => !h.cierra || h.puntos[h.cierra] === 0 || h.puntos[h.cierra] == null));
const raras = [...A.errores, ...B2.errores].filter(e => !/Ya no se puede|a ti mismo|No es tu turno|No hay partida en juego/.test(e));
check('sin errores inesperados del servidor', !raras.length, raras.join(' | '));

// Muchas partidas solo con la máquina y una persona que siempre roba: el servidor no se atasca
{
  const C = cliente('Pepe'); C.auto = false; await C.abrir();
  C.enviar({ t: 'crear', juego: 'pumba', opciones: { limite: 50, nivel: 'facil', figuras: 'diez', sotaLibre: false, cierreCastigo: false } });
  await hasta(() => C.sala);
  for (let i = 0; i < 5; i++) C.enviar({ t: 'bot' });
  check('caben 6 jugadores', await hasta(() => C.sala.asientos.length === 6));
  C.enviar({ t: 'bot' });
  check('no cabe un séptimo', await hasta(() => C.errores.some(e => /completa/.test(e))));
  C.enviar({ t: 'empezar' }); await hasta(() => C.sala.estado === 'jugando');
  C.enviar({ t: 'salir' });
  check('si se va la única persona, la sala desaparece', await hasta(() => C.sala === null));
  C.cerrar();
}
for (const c of [A, B2]) c.cerrar();
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
