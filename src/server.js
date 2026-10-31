'use strict';
/*
 * Servidor de partidas en línea · IT Canarias
 * HTTP:  GET /salud  → estado (para comprobar que funciona)
 * WS:    /ws         → protocolo JSON (ver README.md)
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const S = require('./salas');

const PUERTO = +process.env.PORT || 8090;
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = require('../package.json').version;
const LIMITE_MSG = +process.env.LIMITE_MSG || 40;   // mensajes por conexión cada 10 s

function crearServidor() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/salud' || req.url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, servicio: 'juegos-servidor', version: VERSION, juegos: Object.keys(S.JUEGOS), ...S.estadisticas() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('No encontrado');
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', ws => {
    ws.vivo = true;
    ws.on('pong', () => { ws.vivo = true; });
    let token = null, nombre = '', cuenta = 0, desde = Date.now(), fallos = 0;
    const err = (msg) => S.enviar(ws, { t: 'error', msg });

    ws.on('message', raw => { try { recibir(raw); } catch (e) { console.error('Error al procesar un mensaje:', e); err('Error interno'); } });
    const recibir = raw => {
      // límite de mensajes: 40 cada 10 s por conexión
      if (Date.now() - desde > 10000) { desde = Date.now(); cuenta = 0; }
      if (++cuenta > LIMITE_MSG) return err('Demasiados mensajes; espera un momento');
      let m; try { m = JSON.parse(raw); } catch (e) { return err('Mensaje no válido'); }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ping') return S.enviar(ws, { t: 'pong' });
      if (m.t === 'hola') {
        if (token) return;
        if (!S.tokenValido(m.token)) return err('Identificador no válido');
        token = m.token; nombre = S.limpiaNombre(m.nombre);
        S.enviar(ws, { t: 'hola', version: VERSION });
        S.alConectar(token, ws);
        return;
      }
      if (!token) return err('Falta identificarse');
      if (typeof m.nombre === 'string') nombre = S.limpiaNombre(m.nombre) || nombre;
      let e = null;
      switch (m.t) {
        case 'crear': e = S.crear(token, nombre, String(m.juego || ''), m.opciones); break;
        case 'unirse':
          if (fallos >= 10) { e = 'Demasiados intentos; espera un minuto'; break; }
          e = S.unirse(token, nombre, m.codigo);
          if (e) { fallos++; setTimeout(() => fallos--, 60000); }
          break;
        case 'bot': e = S.anadirBot(token); break;
        case 'quitar': e = S.quitar(token, String(m.asiento || '')); break;
        case 'empezar': e = S.empezar(token); break;
        case 'jugada': e = S.jugada(token, m.a); break;
        case 'salir': e = S.salir(token); S.enviar(ws, { t: 'sala', sala: null }); break;
        default: e = 'Orden desconocida';
      }
      if (e) err(e);
    };
    ws.on('close', () => { if (token) S.alDesconectar(token, ws); });
    ws.on('error', () => {});
  });

  // latido: corta conexiones muertas (móvil sin cobertura) para que la máquina pueda cubrirlas
  const latido = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.vivo) { ws.terminate(); continue; } ws.vivo = false; ws.ping(); }
  }, 20000);
  const limpieza = setInterval(S.limpiar, 10 * 60e3);
  server.on('close', () => { clearInterval(latido); clearInterval(limpieza); });
  return { server, wss };
}

if (require.main === module) {
  S.cargar();
  const { server, wss } = crearServidor();
  server.listen(PUERTO, HOST, () => console.log(`Servidor de juegos v${VERSION} en ${HOST}:${PUERTO}`));
  const parar = () => { console.log('Parando…'); S.guardarYa(); for (const ws of wss.clients) ws.close(1012, 'Reinicio'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
  process.on('SIGTERM', parar); process.on('SIGINT', parar);
}

module.exports = { crearServidor };
