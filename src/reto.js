'use strict';
/*
 * Reto diario de Martín: Los Caminos del Volcán · IT Canarias
 *
 * Cada día hay un nivel y unas condiciones iguales para todos (salen solo de la fecha: Martin.retoDelDia).
 * La app envía las PULSACIONES de su partida (comprimidas) y el servidor las repite con el mismo motor que la app:
 * el tiempo y el agua que cuentan son los que salen de esa repetición, no los que diga el móvil.
 *
 * HTTP (con CORS abierto: lo llaman las apps y la versión web):
 *   GET  /reto/hoy       → { dia, nivel, mod, checksum, version }
 *   POST /reto/enviar    → { token, nombre, dia, nivel, mod, runs } → { ok, puesto, total, mejora, ms, agua, estrellas }
 *   POST /reto/ranking   → { dia, token } → { dia, nivel, mod, total, top: [{nombre, ms, agua, yo}], yo }
 * Se guarda en DATA_DIR/reto-martin.json solo: día, nombre que puso el jugador, tiempo, agua y un resumen del identificador
 * (nunca el identificador entero). Se conservan 35 días.
 * Para las pruebas: RETO_DIA=AAAA-MM-DD fija la fecha y RETO_FORZAR=<nivel>:<mod> fija el nivel y las condiciones.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cargar } = require('./motor');

const E = cargar(['martin/martin.js', 'martin/niveles.js'], ['Martin', 'MARTIN_NIVELES']);
const Martin = E.Martin;
const NIV = E.MARTIN_NIVELES.map(t => Martin.cargar(t)).filter(n => n.ok).map(n => n.nivel);
const IDS = NIV.map(n => n.level_id);
const DATOS = process.env.DATA_DIR || path.join(__dirname, '..', 'datos');
const ARCHIVO = path.join(DATOS, 'reto-martin.json');
const MAX_BODY = 64 * 1024, MAX_ENTRADAS = 8000;

let D = { dias: {} };
try { D = Object.assign(D, JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'))); } catch (e) {}
let timer = null;
function guardar() {
  timer = null;
  try { fs.mkdirSync(DATOS, { recursive: true }); const tmp = ARCHIVO + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(D)); fs.renameSync(tmp, ARCHIVO); }
  catch (e) { console.error('No se pudo guardar el reto diario:', e.message); }
}
const programar = () => { if (!timer) timer = setTimeout(guardar, 3000); };
function guardarYa() { clearTimeout(timer); guardar(); }

const hoy = () => {
  if (process.env.RETO_DIA) return process.env.RETO_DIA;
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
};
const ayer = d => new Date(Date.parse(d + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
const diaValido = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && !isNaN(Date.parse(d + 'T12:00:00Z'));

function planDelDia(dia) {
  let nivel, mod;
  if (process.env.RETO_FORZAR) [nivel, mod] = process.env.RETO_FORZAR.split(':');
  else ({ nivel, mod } = Martin.retoDelDia(dia, IDS));
  const L = NIV.find(n => n.level_id === nivel);
  if (!L || !Martin.MODS[mod]) return null;
  return { dia, nivel, mod, L };
}
const resumen = t => crypto.createHash('sha256').update('martin|' + t).digest('hex').slice(0, 16);
const limpiaNombre = s => String(s || '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim().slice(0, 18) || 'Anónimo';
const tokenValido = t => typeof t === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(t);

function limpiar() {
  const hasta = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(D.dias)) if (d < hasta) delete D.dias[d];
}

const mejorQue = (a, b) => !b || a.ms < b.ms || (a.ms === b.ms && a.agua > b.agua);
function lista(dia) {
  const r = (D.dias[dia] || {}).res || {};
  return Object.entries(r).map(([k, v]) => ({ k, nombre: v.nombre, ms: v.ms, agua: v.agua, t: v.t })).sort((a, b) => a.ms - b.ms || b.agua - a.agua || a.t - b.t);
}

/* ---------- Operaciones ---------- */
function info() {
  const p = planDelDia(hoy());
  if (!p) return null;
  return { dia: p.dia, nivel: p.nivel, mod: p.mod, checksum: p.L.checksum, version: p.L.content_version };
}
function enviar(b) {
  if (!b || typeof b !== 'object') return { error: 'Datos no válidos' };
  if (!tokenValido(b.token)) return { error: 'Identificador no válido' };
  if (!diaValido(b.dia)) return { error: 'Día no válido' };
  const h = hoy();
  if (b.dia !== h && b.dia !== ayer(h)) return { error: 'Ese reto ya ha terminado' };
  const p = planDelDia(b.dia);
  if (!p) return { error: 'No hay reto ese día' };
  if (b.nivel !== p.nivel || b.mod !== p.mod) return { error: 'El reto de ese día es otro: actualiza la app' };
  const runs = b.runs;
  if (!Array.isArray(runs) || runs.length < 2 || runs.length % 2 || runs.length > MAX_ENTRADAS) return { error: 'Partida no válida' };
  for (let i = 0; i < runs.length; i++) if (!Number.isInteger(runs[i]) || runs[i] < (i % 2 ? 1 : 0) || runs[i] > (i % 2 ? Martin.MAX_PASOS : 7)) return { error: 'Partida no válida' };
  let s;
  try { s = Martin.repetir(p.L, runs, { mod: p.mod }); } catch (e) { return { error: 'Partida no válida' }; }
  if (!s || s.fase !== 'meta') return { error: 'Esa partida no llega a la meta' };
  const r = Martin.resultado(s);
  const dia = D.dias[p.dia] = D.dias[p.dia] || { nivel: p.nivel, mod: p.mod, res: {} };
  const k = resumen(b.token), nombre = limpiaNombre(b.nombre);
  const nuevo = { nombre, ms: r.ms, agua: r.agua, t: Date.now() };
  const previo = dia.res[k];
  let mejora = false;
  if (mejorQue(nuevo, previo)) { dia.res[k] = nuevo; mejora = true; } else if (previo && nombre !== previo.nombre) previo.nombre = nombre;
  limpiar(); programar();
  const l = lista(p.dia), puesto = l.findIndex(x => x.k === k) + 1;
  return { ok: true, puesto, total: l.length, mejora, ms: r.ms, agua: r.agua, estrellas: r.estrellas, danos: r.danos, caidas: r.caidas };
}
function ranking(b) {
  if (!b || !diaValido(b.dia)) return { error: 'Día no válido' };
  const p = planDelDia(b.dia), l = lista(b.dia), k = tokenValido(b.token) ? resumen(b.token) : '';
  const fila = (x, i) => ({ nombre: x.nombre, ms: x.ms, agua: x.agua, yo: x.k === k, puesto: i + 1 });
  const top = l.slice(0, 30).map(fila), i = l.findIndex(x => x.k === k);
  return { dia: b.dia, nivel: p ? p.nivel : '', mod: p ? p.mod : '', total: l.length, top, yo: i >= 0 ? fila(l[i], i) : null };
}

/* ---------- HTTP ---------- */
const porIp = new Map();
setInterval(() => porIp.clear(), 10 * 60e3).unref();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
function responde(res, codigo, obj) { res.writeHead(codigo, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, CORS)); res.end(JSON.stringify(obj)); }
function http(req, res) {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/reto/')) return false;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
  if (req.method === 'GET' && url === '/reto/hoy') { const i = info(); responde(res, i ? 200 : 503, i || { error: 'No hay reto' }); return true; }
  if (req.method === 'POST' && (url === '/reto/enviar' || url === '/reto/ranking')) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const n = (porIp.get(ip) || 0) + 1; porIp.set(ip, n);
    if (n > (+process.env.RETO_LIMITE_IP || 60)) { responde(res, 429, { error: 'Demasiadas peticiones; espera un momento' }); return true; }
    let body = '', grande = false;
    req.on('data', c => { if (grande) return; body += c; if (body.length > MAX_BODY) { grande = true; body = ''; responde(res, 413, { error: 'Demasiado grande' }); } });
    req.on('end', () => {
      if (grande) return;
      let d = null; try { d = JSON.parse(body); } catch (e) {}
      const r = url === '/reto/enviar' ? enviar(d) : ranking(d);
      responde(res, r.error ? 400 : 200, r);
    });
    return true;
  }
  responde(res, 404, { error: 'No encontrado' });
  return true;
}

module.exports = { http, info, enviar, ranking, guardarYa, hoy, _datos: () => D, _reset: () => { D = { dias: {} }; } };
