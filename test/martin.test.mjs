// Pruebas del reto diario de Martín: el servidor repite las pulsaciones con el mismo motor que la app
import { createRequire } from 'module';
import os from 'os'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juegos-mt-'));
Object.assign(process.env, { DATA_DIR: DIR, RETO_DIA: '2026-11-07', RETO_LIMITE_IP: '40' });
const PART = JSON.parse(fs.readFileSync(new URL('./martin-partidas.json', import.meta.url), 'utf8'));
const { crearServidor } = require('../src/server.js');
const R = require('../src/reto.js');
const Martin = require('../motores/martin/martin.js');
let passed = 0, failed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); if (process.env.GITHUB_ACTIONS) console.log('::error::' + n); } };
const { server } = crearServidor();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const post = (ruta, d, ip = '2.2.2.2') => fetch(B + ruta, { method: 'POST', body: typeof d === 'string' ? d : JSON.stringify(d), headers: { 'x-forwarded-for': ip } });
const forzar = k => { process.env.RETO_FORZAR = k; };
const TOK = 'jugador-uno-0001', TOK2 = 'jugador-dos-0002', TOK3 = 'jugador-tres-003';
const envio = (clave, extra = {}) => { const [n, m] = clave.split(':'); return Object.assign({ token: TOK, nombre: 'Carlos', dia: '2026-11-07', nivel: n, mod: m, runs: PART[clave] }, extra); };

console.log('Reto diario de Martín');
delete process.env.RETO_FORZAR;
let r = await fetch(B + '/reto/hoy'); let j = await r.json();
const esperado = Martin.retoDelDia('2026-11-07', JSON.parse(JSON.stringify(require('../motores/martin/niveles.js'))).map(t => Martin.cargar(t).nivel.level_id));
check('el reto de hoy sale solo de la fecha (igual para todos)', r.status === 200 && j.nivel === esperado.nivel && j.mod === esperado.mod && j.dia === '2026-11-07' && /^[0-9a-f]{8}$/.test(j.checksum), JSON.stringify(j));
check('lleva CORS abierto', r.headers.get('access-control-allow-origin') === '*');
r = await fetch(B + '/reto/enviar', { method: 'OPTIONS' });
check('responde a la comprobación previa del navegador', r.status === 204 && /POST/.test(r.headers.get('access-control-allow-methods')));
check('/salud avisa de que el reto está activo', (await (await fetch(B + '/salud')).json()).reto === true);

forzar('uga_l01_water_delivery:normal');
r = await post('/reto/enviar', envio('uga_l01_water_delivery:normal')); j = await r.json();
check('una partida válida entra en la clasificación', r.status === 200 && j.ok && j.puesto === 1 && j.total === 1 && j.agua === 100 && j.estrellas >= 1, JSON.stringify(j));
check('el tiempo lo calcula el servidor (102,6 s)', Math.abs(j.ms - 102583) < 20, String(j.ms));

// el servidor no se fía de lo que diga el móvil
const f = envio('uga_l01_water_delivery:normal'); f.ms = 1; f.agua = 100; f.token = TOK2;
j = await (await post('/reto/enviar', f)).json();
check('un tiempo inventado no sirve: cuenta el que sale de la repetición', j.ok && j.ms > 100000);
let t = envio('uga_l01_water_delivery:normal', { token: TOK3 }); t.runs = t.runs.slice(0, 6);
r = await post('/reto/enviar', t); j = await r.json();
check('una partida que no llega a la meta se rechaza', r.status === 400 && /meta/.test(j.error), JSON.stringify(j));
t = envio('uga_l01_water_delivery:normal', { token: TOK3 }); t.runs = t.runs.slice(); t.runs[1] = 1;
r = await post('/reto/enviar', t);
check('pulsaciones manipuladas no llegan a la meta', r.status === 400);
t = envio('uga_l01_water_delivery:normal', { token: TOK3 }); t.runs = [9, 5];
check('máscaras fuera de rango se rechazan', (await post('/reto/enviar', t)).status === 400);
t = envio('uga_l01_water_delivery:normal', { token: TOK3 }); t.runs = [2, 1.5, 0, 3];
check('números no enteros se rechazan', (await post('/reto/enviar', t)).status === 400);
t = envio('uga_l01_water_delivery:normal', { token: TOK3 }); t.runs = new Array(20000).fill(2);
check('listas enormes se rechazan', (await post('/reto/enviar', t)).status === 400);
check('día equivocado se rechaza', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { dia: '2026-11-01', token: TOK3 }))).status === 400);
check('día con formato raro se rechaza', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { dia: 'hoy', token: TOK3 }))).status === 400);
check('otro nivel que el del día se rechaza', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { nivel: 'uga_l02_after_the_storm', token: TOK3 }))).status === 400);
check('otras condiciones que las del día se rechazan', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { mod: 'fragil', token: TOK3 }))).status === 400);
check('identificador raro se rechaza', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { token: '<x>' }))).status === 400);
check('no es JSON → 400', (await post('/reto/enviar', 'no es json')).status === 400);
r = await post('/reto/enviar', 'x'.repeat(70000));
check('cuerpo de más de 64 KB cortado (413)', r.status === 413);

R._reset();
forzar('uga_l02_after_the_storm:fragil');
j = await (await post('/reto/enviar', envio('uga_l02_after_the_storm:fragil', { token: TOK2, nombre: '<b>Ana</b>' }))).json();
check('modo frágil válido', j.ok, JSON.stringify(j));
j = await (await post('/reto/ranking', { dia: '2026-11-07', token: TOK2 })).json();
check('el nombre se limpia de caracteres peligrosos', j.yo && j.yo.nombre === 'bAna/b', JSON.stringify(j.yo));

R._reset();
forzar('uga_l03_dry_ravine:poca');
j = await (await post('/reto/enviar', envio('uga_l03_dry_ravine:poca', { token: TOK2, nombre: 'Ana' }))).json();
{ const MM = createRequire(import.meta.url)('../motores/martin/martin.js'), NN = createRequire(import.meta.url)('../motores/martin/niveles.js'); const LL = MM.cargar(NN[2]).nivel, fin = MM.repetir(LL, PART['uga_l03_dry_ravine:poca'], { mod: 'poca' });
  check('modo «poca agua» válido (parte con 70)', j.ok && j.agua === fin.agua && fin.ag0 === 70 && fin.agua <= 70, JSON.stringify(j)); }

// ranking y mejora
R._reset();
forzar('uga_l01_water_delivery:normal');
await post('/reto/enviar', envio('uga_l01_water_delivery:normal'));
// una partida más lenta no sustituye a la mejor: se le añade un tramo de espera antes de salir
const lenta = [0, 120].concat(PART['uga_l01_water_delivery:normal']);
j = await (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { runs: lenta }))).json();
check('una partida peor no sustituye a la mejor', j.ok && j.mejora === false && j.puesto === 1);
await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { token: TOK2, nombre: 'Ana', runs: lenta }));
j = await (await post('/reto/ranking', { dia: '2026-11-07', token: TOK2 })).json();
check('clasificación ordenada por tiempo y con tu puesto', j.total === 2 && j.top[0].nombre === 'Carlos' && j.top[1].yo === true && j.yo.puesto === 2, JSON.stringify(j));
check('el ranking nunca devuelve identificadores', !JSON.stringify(j).includes(TOK));
j = await (await post('/reto/ranking', { dia: '2026-11-07' })).json();
check('sin identificador se ve igual la lista, sin «yo»', j.top.length === 2 && j.yo === null);

// ayer se acepta, anteayer no
process.env.RETO_DIA = '2026-11-08';
forzar('uga_l01_water_delivery:normal');
check('el día anterior aún se acepta', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { token: TOK3 }))).status === 200);
process.env.RETO_DIA = '2026-11-09';
check('dos días después ya no', (await post('/reto/enviar', envio('uga_l01_water_delivery:normal', { token: TOK3 }))).status === 400);
process.env.RETO_DIA = '2026-11-07';

// límite por IP
let ultimo = 0; for (let i = 0; i < 45; i++) ultimo = (await post('/reto/ranking', { dia: '2026-11-07' }, '8.8.8.8')).status;
check('un mismo sitio no puede saturar el servidor', ultimo === 429);

R.guardarYa();
const guardado = JSON.parse(fs.readFileSync(path.join(DIR, 'reto-martin.json'), 'utf8'));
check('se guarda en disco sin identificadores completos', !JSON.stringify(guardado).includes(TOK) && Object.keys(guardado.dias).length >= 1);

server.close();
console.log(`\n${passed} correctas, ${failed} falladas`);
process.exit(failed ? 1 : 0);
