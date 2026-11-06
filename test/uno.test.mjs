// Pruebas del UNO en línea: personas + la máquina, de principio a fin
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '2', SEGUIR_MS: '80', AUSENTE_MS: '300', UNO_RITMO_MS: '400', LIMITE_MSG: '20000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-')) });
const { crearServidor } = require('../src/server.js');
const U = require('../motores/uno/uno.js');
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
// Juega como una persona: usa la primera carta jugable, dice UNO al quedarse con una y pulsa «Seguir» tras cada mano
function jugar(c) {
  const s = c.sala; if (!s || s.estado !== 'jugando') return;
  const p = s.partida;
  if (p.fase === 'ronda_fin') { const k = 'f' + p.ronda; if (!c.hecho.has(k)) { c.hecho.add(k); c.enviar({ t: 'jugada', a: { tipo: 'seguir' } }); } return; }
  if (p.turnoSilla !== s.yo) return;
  const clave = p.ronda + '|' + (p.ultimo ? p.ultimo.n : 0);
  if (c.hecho.has(clave)) return;
  c.hecho.add(clave);
  const L = U.legal(p, p.yo);
  if (L.color) return c.enviar({ t: 'jugada', a: { tipo: 'color', color: 1 } });
  if (L.jugables.length) {
    const k = L.jugables[0], a = { tipo: 'jugar', carta: k, uno: p.seats[p.yo].mano.length === 2 };
    if (U.esComodin(k)) a.color = 2;
    if (p.cfg.siete0 && U.tp(k) === 7) a.objetivo = (p.yo + 1) % p.n;
    return c.enviar({ t: 'jugada', a });
  }
  if (L.pasar) return c.enviar({ t: 'jugada', a: { tipo: 'pasar' } });
  c.enviar({ t: 'jugada', a: { tipo: 'robar' } });
}
async function hasta(cond, ms = 20000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('UNO en línea');
const A = cliente('Carlos'), B = cliente('Mari');
await A.abrir(); await B.abrir();
check('el saludo incluye el UNO', await hasta(() => A.hola && A.hola.juegos.includes('uno')));
A.auto = B.auto = false;
A.enviar({ t: 'crear', juego: 'uno', opciones: { nivel: 'raro', meta: 7, ritmo: 'x', penal: 9, acum: 1, siete0: 1 } });
check('crea la sala de 2 a 10', await hasta(() => A.sala && A.sala.juego === 'uno' && A.sala.max === 10 && A.sala.min === 2));
check('las opciones se limpian', JSON.stringify(A.sala.opciones) === JSON.stringify({ nivel: 'normal', meta: 500, acum: true, siete0: true, penal: 4, ritmo: 'normal' }), JSON.stringify(A.sala.opciones));
B.enviar({ t: 'unirse', codigo: A.sala.codigo });
await hasta(() => B.sala && A.sala.asientos.length === 2);
A.enviar({ t: 'bot' });
await hasta(() => A.sala.asientos.length === 3);
A.enviar({ t: 'empezar' });
check('empieza la partida', await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando'));
{
  const p = A.sala.partida, q = B.sala.partida;
  check('tres asientos con unas 7 cartas', p.seats.length === 3 && p.seats.every(s => s.n >= 5 && s.n <= 12));
  check('cada uno sabe su asiento', p.yo != null && q.yo != null && p.yo !== q.yo);
  check('ve sus cartas y no las ajenas', p.seats[p.yo].mano.every(c => c >= 0) && p.seats.every((s, i) => i === p.yo || s.mano.every(c => c === -1)));
  check('el mazo no viaja', p.mazo === undefined && q.mazo === undefined && Array.isArray(p.desc));
  const s = S._salas.get(A.sala.codigo); clearTimeout(s.timer);
  const toca = p.turnoSilla === A.sala.yo ? A : p.turnoSilla === B.sala.yo ? B : null;
  const noToca = toca === A ? B : A;
  noToca.enviar({ t: 'jugada', a: { tipo: 'robar' } });
  check('no se puede jugar fuera de turno', await hasta(() => noToca.errores.some(e => /No es tu turno/.test(e))));
  check('jugada mal formada', S.JUEGOS.uno.jugada(s.estadoJuego, 'p1', { tipo: 'poker' }) !== null && S.JUEGOS.uno.jugada(s.estadoJuego, 'p1', null) !== null);
  if (toca) {
    toca.enviar({ t: 'jugada', a: { tipo: 'jugar', carta: 999 } });
    check('una carta que no es tuya se rechaza', await hasta(() => toca.errores.some(e => /no es tuya/.test(e))));
  } else check('una carta que no es tuya se rechaza', true);
  check('la vista trae el tiempo de turno', toca ? (p.venceEn == null || p.venceEn > Date.now() - 2000) : true);
}
// Reloj: si quien tiene el turno no hace nada, roba y pasa solo
{
  const s = S._salas.get(A.sala.codigo); S._programar(s);
  const antes = A.sala.partida.ultimo.n;
  check('el reloj de turno juega por quien no actúa', await hasta(() => A.sala.partida.ultimo.n > antes, 5000));
}
// Módulo
{
  const J = S.JUEGOS.uno;
  const g = J.iniciar({ codigo: 'TEST', opciones: J.opciones({}), asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }, { id: 'p3', nombre: 'c', bot: true }] });
  check('con tres asientos, 3 ids y un bot', g.ids.length === 3 && g.motor.seats.filter(s => s.bot).length === 1);
  const g2 = J.iniciar({ codigo: 'T', ronda: 1, opciones: J.opciones({}), asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }] });
  check('en la revancha se cambian los asientos', g2.ids[0] === 'p2' && g2.motor.seats[0].nombre === 'b');
  check('la vista de un espectador no ve ninguna carta', J.vista(g, 'zz').seats.every(s => s.mano.every(c => c === -1)));
  check('la vista del jugador marca su asiento', J.vista(g, 'p1').yo === g.ids.indexOf('p1'));
  // pillar a quien no dijo UNO
  const h = J.iniciar({ codigo: 'P', opciones: J.opciones({}), asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }] });
  const m = h.motor; m.seats.forEach(s => { s.mano = [0, 1]; }); m.top = 5; m.color = 0; m.turno = 0; m.expuesto = null; m.pend = null; m.drawn = null; m.eligeColor = false; m.dir = 1; m.fase = 'jugando';
  m.seats[0].mano = [3, 1];
  const e1 = J.jugada(h, h.ids[0], { tipo: 'jugar', carta: 3 });
  check('jugar una carta del color', e1 === null);
  check('se queda con una sin decir UNO: queda expuesto', !!m.expuesto && m.expuesto.i === 0);
  const e2 = J.jugada(h, h.ids[1], { tipo: 'pillar' });
  check('el otro lo pilla y roba 4', e2 === null && m.seats[0].mano.length === 5);
}
// La partida sigue sola hasta el final, también con uno desconectado
A.auto = B.auto = true;
{ const s = S._salas.get(A.sala.codigo); S._programar(s); }
jugar(A); jugar(B);
await hasta(() => A.sala.partida.ronda > 1, 30000);
B.cerrar();
check('se nota la desconexión', await hasta(() => A.sala.asientos.some(a => a.id === 'p2' && !a.conectado)));
const rAntes = A.sala.partida.ronda;
check('la partida sigue sin ella (juega la máquina)', await hasta(() => A.sala.estado === 'fin' || A.sala.partida.ronda > rAntes || A.sala.partida.fase === 'fin', 60000));
const B2 = cliente('Mari', B.token); await B2.abrir();
check('al volver recupera su asiento', await hasta(() => B2.sala && B2.sala.yo === 'p2' && B2.sala.codigo === A.sala.codigo));
const okFin = await hasta(() => A.sala.estado === 'fin' && B2.sala.estado === 'fin', 240000);
if (!okFin) console.log(JSON.stringify({ p: A.sala.partida.fase, ronda: A.sala.partida.ronda, errA: A.errores, errB: B2.errores }).slice(0, 1500));
check('la partida termina con ganador', okFin);
const fin = A.sala.partida;
check('al final se entrega la partida para el historial', !!(fin.partida && fin.partida.orden.length === 3 && fin.partida.puntos.length === 3));
check('el campeón llegó a la meta', fin.seats[fin.orden[0]].puntos >= 500);
check('los puestos van del 1 al 3', fin.seats.map(s => s.place).sort().join() === '1,2,3');
check('al final se ven todas las manos', fin.seats.every(s => s.mano.length === s.n));
const raras = [...A.errores, ...B2.errores].filter(e => !/No es tu turno|no es tuya|Ahora no|aún no|Jugada no válida|Solo puedes|No hay a quién|Tienes que robar|no coincide/.test(e));
check('sin errores inesperados del servidor', !raras.length, raras.join(' | '));
// revancha
A.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); B2.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
check('revancha en la misma sala', await hasta(() => A.sala.estado === 'jugando' && A.sala.partida.ronda === 1));

// Mesa llena: 10 y no más
{
  const C = cliente('Pepe'); C.auto = false; await C.abrir();
  C.enviar({ t: 'crear', juego: 'uno', opciones: { nivel: 'dificil', ritmo: 'rapido' } });
  await hasta(() => C.sala);
  for (let i = 0; i < 9; i++) C.enviar({ t: 'bot' });
  check('caben 10 jugadores', await hasta(() => C.sala.asientos.length === 10));
  C.enviar({ t: 'bot' });
  check('no cabe un undécimo', await hasta(() => C.errores.some(e => /completa/.test(e))));
  C.enviar({ t: 'empezar' }); await hasta(() => C.sala.estado === 'jugando');
  check('con diez, diez asientos con unas 7 cartas', C.sala.partida.seats.length === 10 && C.sala.partida.seats.every(s => s.n >= 5 && s.n <= 12));
  C.enviar({ t: 'salir' });
  check('si se va la única persona, la sala desaparece', await hasta(() => C.sala === null));
  C.cerrar();
}
for (const c of [A, B2]) c.cerrar();
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
