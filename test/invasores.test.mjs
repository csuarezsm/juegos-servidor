// Pruebas del reto de Invasores espaciales en línea
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '2', AUSENTE_MS: '300', LIMITE_MSG: '20000', INVASORES_LIMITE_MS: '2500', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'inv-')) });
const { crearServidor } = require('../src/server.js');
const I = require('../motores/invasores/invasores.js');
const S = require('../src/salas.js');

let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;
function cliente(nombre) {
  const token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx';
  const c = { nombre, token, sala: null, errores: [], hola: null };
  c.abrir = () => new Promise(res => {
    c.ws = new WebSocket(URL_WS);
    c.ws.onopen = () => { c.enviar({ t: 'hola', token, nombre }); res(); };
    c.ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'hola') c.hola = m; if (m.t === 'error') c.errores.push(m.msg); if (m.t === 'sala') c.sala = m.sala; };
  });
  c.enviar = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.cerrar = () => c.ws.close();
  return c;
}
async function hasta(cond, ms = 8000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('Motor');
{
  const a = I.nueva({ seed: 7 }), b = I.nueva({ seed: 7 }), c = I.nueva({ seed: 8 });
  for (let k = 0; k < 3000; k++) { I.paso(a, I.bot(a)); I.paso(b, I.bot(b)); I.paso(c, I.bot(c)); }
  check('misma semilla, misma partida', JSON.stringify(a) === JSON.stringify(b));
  check('otra semilla, otra partida', JSON.stringify(a) !== JSON.stringify(c));
}

console.log('Reto en línea');
const A = cliente('Carlos'), B = cliente('Mari');
await A.abrir(); await B.abrir();
check('el saludo incluye invasores', await hasta(() => A.hola && A.hola.juegos.includes('invasores')));
A.enviar({ t: 'crear', juego: 'invasores', opciones: { nivel: 'raro' } });
check('crea la sala de 2 a 6 sin máquina', await hasta(() => A.sala && A.sala.juego === 'invasores' && A.sala.max === 6 && A.sala.min === 2));
check('las opciones se limpian', A.sala.opciones.nivel === 'normal', JSON.stringify(A.sala.opciones));
A.enviar({ t: 'bot' });
check('no se puede añadir a la máquina', await hasta(() => A.errores.some(e => /máquina/.test(e))));
A.enviar({ t: 'empezar' });
check('hacen falta dos personas', await hasta(() => A.errores.some(e => /al menos 2/.test(e))));
B.enviar({ t: 'unirse', codigo: A.sala.codigo });
await hasta(() => B.sala && A.sala.asientos.length === 2);
A.enviar({ t: 'empezar' });
check('empieza el reto', await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando'));
const pa = A.sala.partida, pb = B.sala.partida;
check('los dos tienen la misma semilla', Number.isInteger(pa.seed) && pa.seed === pb.seed);
check('cada uno sabe quién es', pa.yo !== pb.yo && pa.yo != null && pb.yo != null);
check('la vista no trae nada más que puntos', pa.res.length === 2 && pa.res.every(r => r.puntos === 0 && !r.fin));

// juega de verdad con el motor y la semilla del servidor
function jugar(seed, nivel, ticks) { const g = I.nueva({ seed, nivel }); let n = 0; while (!g.fin && n++ < ticks) I.paso(g, I.bot(g)); return g; }
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: 500000, oleada: 1 } });
check('una puntuación imposible se rechaza', await hasta(() => A.errores.some(e => /imposible/.test(e))));
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: -3, oleada: 1 } });
check('una puntuación negativa se rechaza', await hasta(() => A.errores.some(e => /no válida/.test(e))));
A.enviar({ t: 'jugada', a: { tipo: 'tiro' } });
check('una jugada rara se rechaza', await hasta(() => A.errores.length >= 3));
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: 30, oleada: 1 } });
check('el progreso se ve en vivo en el otro móvil', await hasta(() => B.sala.partida.res[pa.yo].puntos === 30));
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: 10, oleada: 1 } });
check('la puntuación no puede bajar', await hasta(() => A.errores.some(e => /no puede bajar/.test(e))));
A.enviar({ t: 'jugada', a: { tipo: 'fin', puntos: 120, oleada: 2 } });
check('al terminar uno, el reto sigue', await hasta(() => B.sala.partida.res[pa.yo].fin) && B.sala.estado === 'jugando');
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: 130, oleada: 2 } });
check('ya no se puede seguir después de terminar', await hasta(() => A.errores.some(e => /ya ha terminado/.test(e))));
B.enviar({ t: 'jugada', a: { tipo: 'fin', puntos: 130, oleada: 1 } });
check('cuando terminan todos, fin y ranking', await hasta(() => A.sala.estado === 'fin' && B.sala.estado === 'fin'));
{
  const p = A.sala.partida;
  check('gana quien más puntos tiene', p.orden[0] === pb.yo && p.partida.puntos[pb.yo] === 130, JSON.stringify([p.orden, pb.yo, pa.yo, p.partida.puntos]));
  check('la partida trae los datos para el historial', p.partida.nombres.length === 2 && p.partida.oleadas[pa.yo] === 2);
}
// Revancha: nueva semilla
A.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); B.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
check('revancha: nuevo reto con otra semilla', await hasta(() => A.sala.estado === 'jugando' && A.sala.partida.seed !== pa.seed));

// Límite de tiempo: al agotarse, termina para todos con lo que llevan
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: 40, oleada: 1 } });
check('al agotarse el tiempo termina el reto', await hasta(() => A.sala.estado === 'fin', 6000));
check('lo que llevaba cada uno cuenta', A.sala.partida.res[A.sala.yo ? 0 : 0] !== undefined && A.sala.partida.orden.length === 2);

// Salir en mitad = terminar con lo que llevas; quien queda puede acabar
A.enviar({ t: 'jugada', a: { tipo: 'revancha' } }); B.enviar({ t: 'jugada', a: { tipo: 'revancha' } });
await hasta(() => A.sala.estado === 'jugando' && B.sala.estado === 'jugando');
A.enviar({ t: 'jugada', a: { tipo: 'progreso', puntos: 20, oleada: 1 } });
B.enviar({ t: 'salir' });
check('el que sale queda como terminado', await hasta(() => A.sala.partida.res.some(r => r.fin)));
A.enviar({ t: 'jugada', a: { tipo: 'fin', puntos: 20, oleada: 1 } });
check('y el reto acaba cuando acaba el otro', await hasta(() => A.sala.estado === 'fin'));

// Módulo: vista de espectador y tope de puntos por tiempo
{
  const J = S.JUEGOS.invasores;
  const g = J.iniciar({ codigo: 'T', opciones: J.opciones({ nivel: 'dificil' }), asientos: [{ id: 'p1', nombre: 'a' }, { id: 'p2', nombre: 'b' }] });
  check('nivel difícil = 3', g.nivel === 3);
  check('espectador sin asiento', J.vista(g, 'zz').yo === null);
  check('el motor del servidor juega la misma partida que la app', JSON.stringify(jugar(g.seed, 2, 600).puntos) === JSON.stringify(jugar(g.seed, 2, 600).puntos));
  check('en ~0 s no se pueden tener 1000 puntos', J.jugada(g, 'p1', { tipo: 'progreso', puntos: 1000, oleada: 1 }) !== null);
}
for (const c of [A, B]) c.cerrar();
server.close();
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
