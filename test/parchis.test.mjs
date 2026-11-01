// Pruebas del Parchís en línea: dos personas + la máquina, de principio a fin
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '2', SEGUIR_MS: '80', AUSENTE_MS: '300', LIMITE_MSG: '20000', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-')) });
const { crearServidor } = require('../src/server.js');
const P = require('../motores/parchis/parchis.js');
const S = require('../src/salas.js');

let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); if (process.env.GITHUB_ACTIONS) console.log('::error::' + (n + (x ? ' → ' + x : '')).replace(/\n/g, ' ').slice(0, 900)); } };
const espera = ms => new Promise(r => setTimeout(r, ms));

const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;

function cliente(nombre, token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx') {
  const c = { nombre, token, sala: null, errores: [], hecho: new Set(), auto: true, hola: null, dados: [] };
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
// Juega como una persona: tira cuando le toca y mueve la primera ficha posible
function jugar(c) {
  const s = c.sala; if (!s || s.estado !== 'jugando') return;
  const p = s.partida;
  if (p.turnoSilla !== s.yo) return;
  const clave = p.n + '|' + p.fase + '|' + JSON.stringify(p.fichas);
  if (c.hecho.has(clave)) return;
  c.hecho.add(clave);
  if (p.fase === 'tirar') c.enviar({ t: 'jugada', a: { tipo: 'tirar' } });
  else if (p.movs.length) c.enviar({ t: 'jugada', a: { tipo: 'mover', ficha: p.movs[0].i } });
}
async function hasta(cond, ms = 20000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('Parchís en línea');
const A = cliente('Carlos'), B = cliente('Mari');
await A.abrir(); await B.abrir();
check('el saludo incluye el parchís', await hasta(() => A.hola && A.hola.juegos.includes('parchis')));
A.auto = B.auto = false;
A.enviar({ t: 'crear', juego: 'parchis', opciones: { nivel: 'raro' } });
check('crea la sala de 2 a 4', await hasta(() => A.sala && A.sala.juego === 'parchis' && A.sala.max === 4 && A.sala.min === 2));
check('las opciones se limpian', A.sala.opciones.nivel === 'normal');
B.enviar({ t: 'unirse', codigo: A.sala.codigo });
await hasta(() => B.sala && A.sala.asientos.length === 2);
A.enviar({ t: 'bot' });
await hasta(() => A.sala.asientos.length === 3);
A.enviar({ t: 'empezar' });
check('empieza la partida', await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando'));
{
  const p = A.sala.partida;
  check('tres colores en juego', p.colores.length === 3 && Object.keys(p.color).length === 3);
  check('cada uno sabe su color', A.sala.partida.yo !== B.sala.partida.yo && A.sala.partida.yo != null);
  check('todas las fichas empiezan en casa', p.fichas.flat().every(r => r === -1));
  const s = S._salas.get(A.sala.codigo); clearTimeout(s.timer);
  const toca = p.turnoSilla === A.sala.yo ? A : p.turnoSilla === B.sala.yo ? B : null;
  const noToca = toca === A ? B : A;
  noToca.enviar({ t: 'jugada', a: { tipo: 'tirar' } });
  check('no se puede tirar fuera de turno', await hasta(() => noToca.errores.some(e => /No es tu turno/.test(e))));
  if (toca) {
    toca.enviar({ t: 'jugada', a: { tipo: 'mover', ficha: 0 } });
    check('no se mueve sin tirar', await hasta(() => toca.errores.some(e => /tira el dado/.test(e))));
  } else check('no se mueve sin tirar', true);
}
// El dado es justo: muchas tiradas directas sobre el módulo
{
  const J = require('../src/juegos/parchis.js');
  const g = J.iniciar({ codigo: 'TEST', opciones: { nivel: 'normal' }, asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }] });
  check('con dos jugadores, colores enfrentados', JSON.stringify(g.juego.colores) === '[0,2]');
  const cuenta = [0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 6000; k++) { g.juego.fase = 'tirar'; g.juego.seises = 0; g.juego.turno = 0; J.jugada(g, 'p1', { tipo: 'tirar' }); cuenta[g.juego.ultimo.d]++; }
  check('el dado sale del 1 al 6 por igual', cuenta.slice(1).every(n => n > 850 && n < 1150), cuenta.join(','));
  check('la jugada mal formada se rechaza', J.jugada(g, 'p1', null) && J.jugada(g, 'p1', { tipo: 'otra' }));
  const g2 = J.iniciar({ codigo: 'T', ronda: 1, opciones: {}, asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }] });
  check('en la revancha se cambian los colores', g2.color.p1 === 2 && g2.color.p2 === 0);
}
// La partida sigue sola hasta el final
A.auto = B.auto = true;
{ const s = S._salas.get(A.sala.codigo); S._programar(s); }
jugar(A); jugar(B);
await hasta(() => A.sala.partida.n > 30, 30000);
B.cerrar();
check('se nota la desconexión', await hasta(() => A.sala.asientos.some(a => a.id === 'p2' && !a.conectado)));
const nAntes = A.sala.partida.n;
check('la partida sigue sin ella (juega la máquina)', await hasta(() => A.sala.estado === 'fin' || A.sala.partida.n > nAntes + 10, 30000));
const B2 = cliente('Mari', B.token); await B2.abrir();
check('al volver recupera su silla', await hasta(() => B2.sala && B2.sala.yo === 'p2' && B2.sala.codigo === A.sala.codigo));
const okFin = await hasta(() => A.sala.estado === 'fin' && B2.sala.estado === 'fin', 120000);
if (!okFin) console.log(JSON.stringify({ p: A.sala.partida, errA: A.errores, errB: B2.errores }).slice(0, 3000));
check('la partida termina con ganador', okFin);
const fin = A.sala.partida;
check('al final se entrega la partida para el historial', !!(fin.partida && fin.partida.orden.length === 3 && fin.ganador === fin.partida.orden[0]));
check('el ganador tiene las cuatro fichas en la meta', fin.fichas[fin.ganador].every(r => r === P.META));
const raras = [...A.errores, ...B2.errores].filter(e => !/No es tu turno|tira el dado|Ahora toca|No hay partida/.test(e));
check('sin errores inesperados del servidor', !raras.length, raras.join(' | '));
// revancha
A.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); B2.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
check('revancha en la misma sala', await hasta(() => A.sala.estado === 'jugando' && A.sala.partida.ganador == null));

{
  const C = cliente('Pepe'); C.auto = false; await C.abrir();
  C.enviar({ t: 'crear', juego: 'parchis', opciones: { nivel: 'dificil' } });
  await hasta(() => C.sala);
  for (let i = 0; i < 3; i++) C.enviar({ t: 'bot' });
  check('caben 4 jugadores', await hasta(() => C.sala.asientos.length === 4));
  C.enviar({ t: 'bot' });
  check('no cabe un quinto', await hasta(() => C.errores.some(e => /completa/.test(e))));
  C.enviar({ t: 'empezar' }); await hasta(() => C.sala.estado === 'jugando');
  check('con cuatro, los cuatro colores', C.sala.partida.colores.length === 4);
  C.enviar({ t: 'salir' });
  check('si se va la única persona, la sala desaparece', await hasta(() => C.sala === null));
  C.cerrar();
}
for (const c of [A, B2]) c.cerrar();
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
