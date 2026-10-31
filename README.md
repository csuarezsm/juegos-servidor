# Servidor de juegos en línea · IT Canarias

Un solo servicio para jugar en línea a las apps de IT Canarias (Ajedrez; después Pumba, Chinchón y las que vengan).

© 2026 IT Canarias. Todos los derechos reservados.

## Cómo funciona

- **Node.js + WebSocket** (`ws`), en su propio contenedor Docker y su propio puerto (`127.0.0.1:8090`), detrás del proxy que ya tenga el VPS. No toca ningún otro proyecto.
- **Salas con código** de 4 caracteres (sin 0/O ni 1/I) para compartir por WhatsApp. Sin cuentas ni contraseñas.
- **El servidor valida cada jugada** con el módulo del juego. Nadie puede hacer trampas desde la app.
- **Reconexión**: al entrar en una sala, cada jugador recibe una ficha (token). Si se corta la conexión, vuelve a su sitio con ella.
- **Reloj en el servidor**: decide él cuándo se acaba el tiempo.
- **Nada en disco**: las salas viven en memoria. Una sala sin nadie conectado se borra a los 10 minutos; una sin actividad, a las 6 horas.
- **Protección**: mensajes de 4 KB como máximo, unos 6 mensajes por segundo por conexión y 30 salas por hora por IP.
- **Consumo**: unos 40-60 MB de memoria y casi nada de CPU en reposo. Límites del contenedor: 128 MB de memoria, medio núcleo y 64 procesos; Node limitado a 96 MB de memoria. Cada sala ocupa unos pocos KB, medido: 300 salas llenas (600 jugadores) = 76 MB. El máximo es de 800 salas a la vez (unos 110 MB), dentro del límite. Si se llena, la app avisa de que lo intenten en un rato.
- **Privacidad**: solo pasan por el servidor el nombre que pone el jugador y sus jugadas. No se guardan.

## Añadir un juego

Cada juego es un archivo en `juegos/` con la misma interfaz (ver `juegos/ajedrez.js`):

| Función | Qué hace |
|---|---|
| `jugadores` | Número de asientos |
| `asientoCreador(opciones)` | Asiento de quien crea la sala |
| `iniciar(opciones)` | Estado inicial |
| `turno(estado)` | Asiento al que le toca |
| `jugada(estado, asiento, jugada, ahora)` | Valida y aplica; devuelve `{ ok }` o `{ error }` |
| `accion(estado, asiento, accion, ahora)` | Rendirse, tablas… |
| `vista(estado, asiento, ahora)` | Lo que ve cada jugador (en cartas, nunca las de los demás) |
| `fin(estado)` | Si la partida ha terminado |
| `tiempoHastaBandera` / `comprobarTiempo` | Opcional, si hay reloj |

Después se añade a `JUEGOS` en `servidor.js`. `compartido/ajedrez.js` es una copia del archivo de reglas de la app Ajedrez: si cambian las reglas allí, se copia aquí.

## Protocolo (JSON por WebSocket en `/ws`)

App → servidor: `crear {juego, nombre, opciones}` · `unirse {codigo, nombre, token?, juego?}` · `jugada {jugada}` · `accion {accion: rendirse|tablas|rechazar|revancha}` · `salir` · `ping`.

Servidor → app: `hola {protocolo, juegos}` · `sala {codigo, asiento, token}` · `estado {codigo, asiento, jugadores, turno, estado, revancha}` · `error {codigo, msg}` · `pong`.

## Instalar en el VPS de IT Canarias (212.227.40.8)

```bash
cd /opt && git clone https://github.com/csuarezsm/juegos-servidor.git && cd juegos-servidor
bash despliegue/instalar-vps.sh
```

El script comprueba la capacidad del VPS (memoria, disco y carga), arranca el contenedor en la red `proxy-interno`, añade `juegos.itcanarias.com` a `nginx-sat` (con copia de seguridad y vuelta atrás si `nginx -t` falla), saca el certificado con certbot y comprueba `https://juegos.itcanarias.com/salud`. Para actualizar: `git pull && bash despliegue/instalar-vps.sh`.

## Instalar en otro servidor

Requisitos: Docker con `docker compose`, y un registro DNS `juegos.itcanarias.com` (tipo A) apuntando a la IP del VPS.

```bash
git clone https://github.com/csuarezsm/juegos-servidor.git
cd juegos-servidor
docker compose up -d --build
curl http://127.0.0.1:8090/salud          # → {"ok":true,…}
```

Luego, el proxy (uno de estos, según lo que tenga el VPS):

- **Nginx**: `despliegue/nginx.conf` + `certbot --nginx -d juegos.itcanarias.com`.
- **Caddy**: añadir `despliegue/Caddyfile` al Caddyfile y recargar.
- **Traefik**: usar `despliegue/docker-compose.traefik.yml` en lugar del `docker-compose.yml`.

Comprobar desde fuera: `https://juegos.itcanarias.com/salud`.

Actualizar: `git pull && docker compose up -d --build`. Ver el registro: `docker logs -f juegos-servidor`.

## Pruebas

```bash
npm install
npm test
```
