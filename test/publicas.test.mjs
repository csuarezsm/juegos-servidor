// Pruebas de las partidas públicas y de «Jugar con cualquiera» (emparejamiento automático)
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
Object.assign(process.env, { PASO_BOT_MS: '5', SEGUIR_MS: '80', AUSENTE_MS: '300', LIMITE_MSG: '5000', ESPERA_AUTO_MS: '400', ESPERA_SOLO_MS: '900', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-')) });
const { crearServidor } = require('../src/server.js');

let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); if (process.env.GITHUB_ACTIONS) console.log('::error::' + (n + (x ? ' → ' + x : '')).replace(/\n/g, ' ').slice(0, 900)); } };
const espera = ms => new Promise(r => setTimeout(r, ms));

const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_WS = `ws://127.0.0.1:${server.address().port}/ws`;

function cliente(nombre) {
  const token = 'tok' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx';
  const c = { nombre, token, sala: null, lista: null, errores: [] };
  c.abrir = () => new Promise(res => {
    c.ws = new WebSocket(URL_WS);
    c.ws.onopen = () => { c.enviar({ t: 'hola', token, nombre }); res(); };
    c.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'error') c.errores.push(m.msg);
      if (m.t === 'sala') c.sala = m.sala;
      if (m.t === 'lista') c.lista = m;
    };
  });
  c.enviar = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.pedirLista = async juego => { c.lista = null; c.enviar({ t: 'lista', juego }); await hasta(() => c.lista); return c.lista.salas; };
  return c;
}
async function hasta(cond, ms = 5000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await espera(10); } return true; }

console.log('Partidas públicas');
const A = cliente('Carlos'), B = cliente('Mari'), C = cliente('Tere'), D = cliente('Luis');
for (const x of [A, B, C, D]) await x.abrir();
A.enviar({ t: 'crear', juego: 'parchis', opciones: {}, publica: true });
await hasta(() => A.sala);
check('se crea una partida pública', A.sala.publica === true && A.sala.auto === false && A.sala.empiezaEn === null);
B.enviar({ t: 'crear', juego: 'parchis', opciones: {} });
await hasta(() => B.sala);
check('una partida normal no es pública', B.sala.publica === false);
let l = await C.pedirLista('parchis');
check('la lista solo enseña las públicas', l.length === 1 && l[0].codigo === A.sala.codigo && l[0].nombre === 'Carlos' && l[0].jugadores === 1 && l[0].max === 4, JSON.stringify(l));
check('la lista es por juego', (await C.pedirLista('chinchon')).length === 0 && (await C.pedirLista('nada')).length === 0);
C.enviar({ t: 'unirse', codigo: l[0].codigo });
await hasta(() => C.sala && A.sala.asientos.length === 2);
check('se entra desde la lista con su código', C.sala.codigo === A.sala.codigo);
A.enviar({ t: 'empezar' });
await hasta(() => A.sala.estado === 'jugando');
check('al empezar desaparece de la lista', (await D.pedirLista('parchis')).length === 0);
for (const x of [A, B, C]) x.enviar({ t: 'salir' });
await espera(50);

console.log('Jugar con cualquiera');
A.sala = B.sala = C.sala = null;
A.enviar({ t: 'buscar', juego: 'chinchon', opciones: { limite: 100 } });
await hasta(() => A.sala);
check('sin nadie buscando, abre una mesa nueva', A.sala.auto && A.sala.publica && A.sala.estado === 'espera' && A.sala.asientos.length === 1);
check('solo, avisa de cuándo empieza con la máquina', A.sala.empiezaEn > Date.now());
B.enviar({ t: 'buscar', juego: 'chinchon' });
await hasta(() => B.sala && A.sala.asientos.length === 2);
check('el siguiente que busca entra en la misma mesa', B.sala.codigo === A.sala.codigo);
check('con dos personas empieza antes', A.sala.empiezaEn - Date.now() < 500);
const antes = A.sala.codigo;
A.enviar({ t: 'buscar', juego: 'chinchon' });
await espera(60);
check('volver a buscar no le saca de su mesa', A.sala.codigo === antes && A.sala.asientos.length === 2);
check('aparece en la lista como «cualquiera»', (await D.pedirLista('chinchon')).some(x => x.codigo === antes && x.auto));
await hasta(() => A.sala.estado === 'jugando', 3000);
check('pasado el rato se completa con la máquina y empieza sola', A.sala.estado === 'jugando' && A.sala.asientos.length === 4 && A.sala.asientos.filter(a => a.bot).length === 2, JSON.stringify(A.sala.asientos));
check('las opciones del primero se respetan', A.sala.opciones.limite === 100);
for (const x of [A, B]) x.enviar({ t: 'salir' });
await espera(50);

A.sala = B.sala = null;
A.enviar({ t: 'buscar', juego: 'pumba' });
await hasta(() => A.sala);
await hasta(() => A.sala.estado === 'jugando', 3000);
check('quien está solo acaba jugando con la máquina', A.sala.estado === 'jugando' && A.sala.asientos.length === A.sala.max);
A.enviar({ t: 'salir' });
await espera(50);

A.sala = B.sala = C.sala = D.sala = null;
for (const x of [A, B, C, D]) x.enviar({ t: 'buscar', juego: 'parchis' });
await hasta(() => [A, B, C, D].every(x => x.sala && x.sala.estado === 'jugando'));
check('con la mesa llena empieza al momento', [A, B, C, D].every(x => x.sala.estado === 'jugando' && x.sala.codigo === A.sala.codigo) && !A.sala.asientos.some(a => a.bot));
for (const x of [A, B, C, D]) x.enviar({ t: 'salir' });
await espera(50);

A.sala = B.sala = null;
A.enviar({ t: 'buscar', juego: 'ajedrez' });
await hasta(() => A.sala);
check('en ajedrez no hay máquina: espera sin cuenta atrás', A.sala.empiezaEn === null);
await espera(1100);
check('y sigue esperando a otra persona', A.sala.estado === 'espera');
B.enviar({ t: 'buscar', juego: 'ajedrez' });
await hasta(() => B.sala && B.sala.estado === 'jugando');
check('al llegar el rival empieza la partida', B.sala.codigo === A.sala.codigo && B.sala.estado === 'jugando');
check('ningún error inesperado', [A, B, C, D].every(x => !x.errores.length), [A, B, C, D].map(x => x.errores).join(';'));

console.log(`\n${passed} correctas, ${failed} fallidas`);
server.close(); for (const x of [A, B, C, D]) x.ws.close();
process.exit(failed ? 1 : 0);
