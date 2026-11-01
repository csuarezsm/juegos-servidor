'use strict';
/*
 * Contador anónimo de instalaciones y de partidas en línea · IT Canarias
 * - Las apps avisan una vez al instalarse y una vez por cada versión nueva: { juego, plataforma, version, evento, de }.
 * - Solo se guardan sumas (por juego, plataforma, día y versión). Ni IP, ni identificadores, ni nada del móvil.
 *   La IP solo se usa en memoria, unos minutos, para no aceptar avalanchas de avisos desde el mismo sitio.
 * - Se guarda en DATA_DIR/contador.json (el volumen juegos-datos en el VPS).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATOS = process.env.DATA_DIR || path.join(__dirname, '..', 'datos');
const ARCHIVO = path.join(DATOS, 'contador.json');
const JUEGOS = ['ajedrez', 'damas', 'chinchon', 'pumba', 'parchis'];
const PLATAFORMAS = ['android', 'play', 'ios', 'web'];
const NOMBRES = { ajedrez: 'Ajedrez', damas: 'Damas', chinchon: 'Chinchón', pumba: 'Pumba', parchis: 'Parchís' };
const PLAT_TXT = { android: 'Android (GitHub)', play: 'Google Play', ios: 'iPhone', web: 'Web' };

let D = { instalaciones: {}, actualizaciones: {}, dias: {}, versiones: {}, partidas: {} };
try { D = Object.assign(D, JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'))); } catch (e) {}
let timer = null;
function guardar() {
  timer = null;
  try { fs.mkdirSync(DATOS, { recursive: true }); const tmp = ARCHIVO + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(D)); fs.renameSync(tmp, ARCHIVO); }
  catch (e) { console.error('No se pudo guardar el contador:', e.message); }
}
const programar = () => { if (!timer) timer = setTimeout(guardar, 3000); };
const hoy = () => new Date().toISOString().slice(0, 10);
const suma = (o, ...ks) => { const last = ks.pop(); for (const k of ks) o = o[k] = o[k] || {}; o[last] = (o[last] || 0) + 1; };
const resta = (o, ...ks) => { const last = ks.pop(); for (const k of ks) { if (!o[k]) return; o = o[k]; } if (o[last] > 0) o[last]--; };

// límite por IP (solo en memoria): 30 avisos por hora
const porIp = new Map();
setInterval(() => porIp.clear(), 3600e3).unref();

// Aviso de una app. Devuelve '' si se cuenta o el motivo si no.
function contar(datos, ip) {
  const n = (porIp.get(ip) || 0) + 1; porIp.set(ip, n);
  if (n > 30) return 'Demasiados avisos';
  if (!datos || typeof datos !== 'object') return 'Datos no válidos';
  const juego = String(datos.juego || ''), plat = String(datos.plataforma || ''), ev = String(datos.evento || '');
  const ver = String(datos.version || ''), de = String(datos.de || '');
  if (!JUEGOS.includes(juego) || !PLATAFORMAS.includes(plat) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ver)) return 'Datos no válidos';
  if (ev === 'instalacion') {
    suma(D.instalaciones, juego, plat); suma(D.dias, hoy(), juego, plat);
  } else if (ev === 'actualizacion') {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(de)) return 'Datos no válidos';
    suma(D.actualizaciones, juego, plat); resta(D.versiones, juego, de);
  } else return 'Datos no válidos';
  suma(D.versiones, juego, ver);
  programar();
  return '';
}
// Una partida en línea que empieza (lo llama salas.js)
function partida(juego) { if (JUEGOS.includes(juego)) { suma(D.partidas, hoy(), juego); programar(); } }

/* ---------- Página de estadísticas (con contraseña) ---------- */
function autorizado(req) {
  const clave = process.env.ESTADISTICAS_CLAVE || '';
  if (clave.length < 8) return false;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const txt = Buffer.from(m[1], 'base64').toString('utf8'), pw = txt.slice(txt.indexOf(':') + 1);
  const a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(clave).digest();
  return crypto.timingSafeEqual(a, b);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tot = o => Object.values(o || {}).reduce((a, n) => a + n, 0);
const COLORES = { ajedrez: '#6cc4e8', damas: '#e2574c', chinchon: '#62c98a', pumba: '#f2b84b', parchis: '#4f8fe6' };
function pagina(salas) {
  const dias = []; for (let i = 29; i >= 0; i--) dias.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const porDia = dias.map(d => JUEGOS.map(j => tot((D.dias[d] || {})[j])));
  const max = Math.max(1, ...porDia.map(x => x.reduce((a, n) => a + n, 0)));
  const W = 600, H = 160, bw = W / 30;
  let bars = '';
  porDia.forEach((x, i) => { let y = H; x.forEach((n, k) => { if (!n) return; const h = n / max * (H - 10); y -= h; bars += `<rect x="${(i * bw + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${COLORES[JUEGOS[k]]}"><title>${dias[i]} · ${NOMBRES[JUEGOS[k]]}: ${n}</title></rect>`; }); });
  const partidasDia = dias.map(d => tot(D.partidas[d]));
  const maxP = Math.max(1, ...partidasDia);
  let barsP = ''; partidasDia.forEach((n, i) => { if (!n) return; const h = n / maxP * (H - 10); barsP += `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#a3b3c4"><title>${dias[i]}: ${n} partidas</title></rect>`; });
  const fila = j => { const ins = D.instalaciones[j] || {}; return `<tr><td><i style="background:${COLORES[j]}"></i>${NOMBRES[j]}</td>${PLATAFORMAS.map(p => `<td>${ins[p] || 0}</td>`).join('')}<td><b>${tot(ins)}</b></td><td>${tot(D.actualizaciones[j])}</td></tr>`; };
  const versiones = JUEGOS.map(j => { const v = Object.entries(D.versiones[j] || {}).filter(([, n]) => n > 0).sort((a, b) => b[0].localeCompare(a[0], 'es', { numeric: true })); return v.length ? `<div class="v"><b>${NOMBRES[j]}</b> ${v.map(([k, n]) => `<span>v${esc(k)}: ${n}</span>`).join(' ')}</div>` : ''; }).join('');
  const hoyTxt = hoy(), ultimos7 = dias.slice(-7);
  const sem = j => ultimos7.reduce((a, d) => a + tot((D.dias[d] || {})[j]), 0);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Estadísticas · Juegos de IT Canarias</title><style>
body{margin:0;background:#141a22;color:#f2f4f7;font:15px/1.4 system-ui,-apple-system,Roboto,sans-serif;padding:16px;max-width:760px;margin:0 auto}
h1{font-size:22px;margin:4px 0}h2{font-size:15px;color:#a9b4c2;text-transform:uppercase;letter-spacing:.5px;margin:22px 0 8px}
.k{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.k div{background:#212b38;border-radius:12px;padding:10px;text-align:center}.k b{display:block;font-size:26px}.k span{font-size:12px;color:#a9b4c2}
table{width:100%;border-collapse:collapse;background:#212b38;border-radius:12px;overflow:hidden;font-variant-numeric:tabular-nums}th,td{padding:8px;text-align:right;border-bottom:1px solid #334}th:first-child,td:first-child{text-align:left}th{font-size:12px;color:#a9b4c2}
td i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
svg{width:100%;height:auto;background:#212b38;border-radius:12px}.ley span{margin-right:12px;font-size:13px}.ley i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px}
.v{background:#212b38;border-radius:12px;padding:8px 10px;margin:6px 0}.v span{display:inline-block;margin:2px 8px 2px 0;color:#a9b4c2}.mut{color:#a9b4c2;font-size:13px}
</style></head><body>
<h1>📊 Juegos de IT Canarias</h1><div class="mut">Actualizado: ${esc(new Date().toLocaleString('es-ES', { timeZone: 'Atlantic/Canary' }))} · contador anónimo (solo sumas)</div>
<h2>Instalaciones</h2><div class="k">${JUEGOS.map(j => `<div><b style="color:${COLORES[j]}">${tot(D.instalaciones[j])}</b><span>${NOMBRES[j]} · ${sem(j)} esta semana</span></div>`).join('')}</div>
<h2>Por plataforma</h2><table><tr><th>Juego</th>${PLATAFORMAS.map(p => `<th>${PLAT_TXT[p]}</th>`).join('')}<th>Total</th><th>Actualizaciones</th></tr>${JUEGOS.map(fila).join('')}</table>
<h2>Instalaciones nuevas · últimos 30 días</h2><svg viewBox="0 0 ${W} ${H}">${bars}</svg>
<div class="ley">${JUEGOS.map(j => `<span><i style="background:${COLORES[j]}"></i>${NOMBRES[j]}</span>`).join('')}</div>
<h2>Versiones en uso</h2>${versiones || '<div class="mut">Aún no hay datos.</div>'}
<h2>Partidas en línea</h2><div class="k"><div><b>${salas.jugando}</b><span>jugándose ahora</span></div><div><b>${salas.salas}</b><span>salas abiertas</span></div><div><b>${tot(D.partidas[hoyTxt])}</b><span>empezadas hoy</span></div><div><b>${dias.reduce((a, d) => a + tot(D.partidas[d]), 0)}</b><span>últimos 30 días</span></div></div>
<svg viewBox="0 0 ${W} ${H}" style="margin-top:8px">${barsP}</svg>
<p class="mut">Las instalaciones se cuentan una vez por móvil (o navegador) al abrir la app por primera vez; quien ya la tenía cuenta al instalar esta versión. Borrar los datos de la app y volver a abrirla cuenta otra vez.</p>
</body></html>`;
}
function http(req, res, salas) {
  if (req.method === 'OPTIONS' && req.url === '/contar') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); res.end(); return true; }
  if (req.method === 'POST' && req.url === '/contar') {
    let body = '', grande = false;
    req.on('data', c => { body += c; if (body.length > 1000) { grande = true; req.destroy(); } });
    req.on('end', () => {
      if (grande) return;
      let d = null; try { d = JSON.parse(body); } catch (e) {}
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')   // nginx-sat pone X-Forwarded-For con la IP real.split(',')[0].trim();
      const e = contar(d, ip);
      res.writeHead(e ? 400 : 204, { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'text/plain' }); res.end(e);
    });
    return true;
  }
  if (req.method === 'GET' && (req.url === '/estadisticas' || req.url === '/estadisticas.json')) {
    if (!process.env.ESTADISTICAS_CLAVE) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('No encontrado'); return true; }
    if (!autorizado(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Estadisticas IT Canarias", charset="UTF-8"', 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('Hace falta la contraseña'); return true; }
    if (req.url.endsWith('.json')) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(D)); return true; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); res.end(pagina(salas)); return true;
  }
  return false;
}
function guardarYa() { clearTimeout(timer); guardar(); }
module.exports = { contar, partida, http, guardarYa, _datos: () => D };
