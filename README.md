# Servidor de juegos en línea · IT Canarias

Un solo servidor para jugar en línea a todas las apps de juegos de IT Canarias: hoy **Chinchón**, **Ajedrez**, **Pumba**, **Damas** y **Parchís**, y las que vengan.
Dirección: `wss://juegos.itcanarias.com/ws` · Comprobación: `https://juegos.itcanarias.com/salud`

© 2026 IT Canarias. Todos los derechos reservados.

Guía para conectar cada app: documento «Servidor de juegos en línea — guía para conectar cada app».

## Cómo funciona

- **Salas con código** de 4 caracteres (sin 0/O ni 1/I) para compartir por WhatsApp. Sin cuentas: cada app genera una **ficha** (token) y la guarda; con ella vuelve a su silla.
- **Sala de espera** con anfitrión. En los juegos de cartas puede añadir a la máquina en las sillas libres y empieza cuando quiere. Ajedrez empieza solo al entrar el segundo jugador.
- **El servidor manda**: reparte, guarda las cartas, lleva el reloj y comprueba cada jugada con el mismo motor que la app (`motores/<juego>/`). A cada jugador solo le envía lo que puede ver.
- **Ausencias**: en los juegos de cartas y en el parchís, si alguien tarda más de 30 s sin conexión en su turno, la máquina juega por él hasta que vuelva. En ajedrez y damas se le espera (corre su reloj); salir de la sala en juego es rendirse.
- **Revancha** (ajedrez, damas y parchís): cuando la piden todos, partida nueva en la misma sala con los colores cambiados.
- **Partidas guardadas** en el volumen `juegos-datos`: sobreviven a reinicios y actualizaciones; los móviles se reconectan solos.
- **Límites**: mensajes de 4 KB · 40 mensajes cada 10 s por conexión · 10 códigos fallidos por minuto · 500 salas a la vez.
- **Limpieza**: las salas se borran 1 h después de terminar o tras 12 h sin nadie conectado.
- **Privacidad**: pasan por el servidor el nombre que pone el jugador y sus jugadas. No se guarda nada más y nada sale del servidor.

## Juegos

| Juego | `juego` | Jugadores | Módulo | Motor (copiado de la app) |
|---|---|---|---|---|
| Chinchón | `chinchon` | 2–4 (+ máquina) | `src/juegos/chinchon.js` | `motores/chinchon/marcador.js`, `juego.js` |
| Ajedrez | `ajedrez` | 2 | `src/juegos/ajedrez.js` | `motores/ajedrez/ajedrez.js` |
| Pumba | `pumba` | 2–6 (+ máquina) | `src/juegos/pumba.js` | `motores/pumba/marcador.js`, `juego.js` |
| Damas (españolas) | `damas` | 2 | `src/juegos/damas.js` | `motores/damas/damas.js` |
| Parchís | `parchis` | 2–4 (+ máquina) | `src/juegos/parchis.js` | `motores/parchis/parchis.js` |

Para añadir un juego: un módulo en `src/juegos/` con `id`, `min`, `max`, `opciones`, `iniciar`, `turnoDe`, `jugada`, `pasoAuto`, `esperaListos`, `siguienteMano`, `vista`, `terminada` (y, si tiene reloj, `reloj` y `alVencer`; si no admite máquina, `sinMaquina`; si la máquina debe esperar antes de jugar, `pausaBot`), sus archivos de reglas en `motores/<juego>/`, y registrarlo en `JUEGOS` de `src/salas.js`. **Si cambian las reglas en una app, se vuelven a copiar aquí.**

## Protocolo (JSON por WebSocket en `/ws`)

| La app envía | Para |
|---|---|
| `{t:'hola', token, nombre}` | Identificarse al conectar (y al reconectar) |
| `{t:'crear', juego, opciones}` | Crear una sala (quien la crea es el anfitrión) |
| `{t:'unirse', codigo}` | Entrar con el código |
| `{t:'bot'}` · `{t:'quitar', asiento}` · `{t:'empezar'}` | Acciones del anfitrión en la sala de espera |
| `{t:'jugada', a:{tipo, …}}` | Cualquier acción de juego (ver tabla de juegos) |
| `{t:'salir'}` | Dejar la sala |
| `{t:'ping'}` | Mantener viva la conexión (cada 25 s) |

El servidor responde con `{t:'hola', version, juegos}`, `{t:'sala', sala}` (la sala tal como la ve ese jugador, cada vez que cambia; `null` = fuera de la sala), `{t:'error', msg}` y `{t:'pong'}`.

Acciones por juego:
- **Chinchón**: `robar` (`de: 'mazo'|'descarte'`), `tirar` (`carta`, `cerrar`), `listo`, `reenganche`.
- **Pumba**: `echar` (`carta`, `palo` si es sota, `pumba: true` si dice «¡Pumba!» al echar la penúltima), `robar` (una carta, o el castigo de los doses), `reclamar` (fuera de turno: a quien olvidó decir «¡Pumba!», hasta que el siguiente eche o robe), `listo`, `reenganche`. Opciones al crear: `limite` (50–500), `reenganches` (0–3), `figuras` (`cara` o `diez`), `sotaLibre`, `cierreCastigo`, `nivel`. Si alguien olvida el «¡Pumba!», la máquina espera 2,5 s antes de jugar para dejar reclamar.
- **Parchís**: `tirar` (el dado lo tira el servidor, con números aleatorios criptográficos) y `mover` (`ficha`: 0–3). Opciones al crear: `nivel` (`facil`, `normal`, `dificil`) para las sillas de la máquina. Con dos jugadores, colores enfrentados; en cada revancha cambia quién empieza. La vista lleva el estado completo (no hay información oculta) y, a quien le toca mover, sus jugadas posibles.
- **Ajedrez**: `mover` (`uci`, p. ej. `e7e8q`), `tablas` (ofrecer o aceptar), `rechazar`, `rendirse`, `revancha`. Opciones al crear: `color` (`w`, `b` o `r`) y `reloj` (`{base, inc}` en ms).

## Instalar o actualizar en el VPS de IT Canarias (212.227.40.8)

```bash
cd /opt/juegos-servidor && git pull && bash despliegue/instalar-vps.sh
```
(La primera vez: `cd /opt && git clone https://github.com/csuarezsm/juegos-servidor.git && cd juegos-servidor && bash despliegue/instalar-vps.sh`.)

El script comprueba la capacidad del VPS (memoria, disco y carga; `FORZAR=1` delante para seguir con carga alta), construye y arranca el contenedor `juegos-servidor` en la red `proxy-interno`, añade `juegos.itcanarias.com` a `nginx-sat` (con copia de seguridad y vuelta atrás si `nginx -t` falla), saca el certificado con certbot y comprueba `/salud`. No toca ningún otro contenedor.

**Consumo**: unos 60 MB en reposo. Medido con 300 partidas de ajedrez a la vez (600 jugadores): 120 MB, contando también los clientes de prueba en el mismo proceso. Límites del contenedor: 192 MB de memoria, medio núcleo, 64 procesos, sistema de archivos de solo lectura salvo `/datos`.

| Para | Comando |
|---|---|
| Ver si está vivo | `curl -s https://juegos.itcanarias.com/salud` |
| Ver el registro | `docker logs --tail 100 -f juegos-servidor` |
| Consumo | `docker stats --no-stream juegos-servidor` |
| Reiniciar | `docker restart juegos-servidor` |

En otro servidor: `docker compose up -d --build` (escucha en `127.0.0.1:8090`) y un proxy delante (`despliegue/nginx.conf`, `Caddyfile` o `docker-compose.traefik.yml`).

## Pruebas

```bash
npm install && npm test
```
Chinchón: dos jugadores y la máquina de principio a fin, reconexión, ausencias, límites. Parchís: dos personas y la máquina hasta el final, dado justo, turnos, desconexión y vuelta, revancha, 4 jugadores. Pumba: dos jugadores y la máquina hasta el final, «¡Pumba!» olvidado y reclamado fuera de turno, desconexión y vuelta, 6 jugadores. Ajedrez: turnos, jugadas ilegales, reloj con incremento, caída de bandera, desconexión y vuelta, mate, tablas, revancha, abandono, guardado en disco. En GitHub, además, se construye la imagen Docker y se comprueba que arranca.

## Catálogo de juegos (`docs/`)

`docs/juegos.json` es el catálogo común que leen todas las apps en «🎲 Más juegos de IT Canarias», y `docs/index.html` la página con todos los juegos (GitHub Pages: https://csuarezsm.github.io/juegos-servidor/). Para añadir un juego, se añade una entrada (`id`, `nombre`, `emoji`, `descripcion`, `android`, `descarga`, `web`, `icono` y, cuando esté en Google Play, `play`): en unas horas aparece en todas las apps sin actualizarlas.

## Contador de instalaciones y estadísticas

- `POST /contar` (texto JSON): cada app avisa una vez al instalarse (`evento: 'instalacion'`) y una vez por versión nueva (`'actualizacion'`, con `de`), con `juego`, `plataforma` (`android`, `play`, `ios`, `web`) y `version`. Solo se suman números por juego, plataforma, día y versión: no se guarda la IP ni ningún identificador. Como mucho 30 avisos por hora desde una misma IP (solo en memoria). También se cuentan las partidas en línea que empiezan.
- `GET /estadisticas`: página con contraseña (usuario cualquiera). La contraseña la pide `instalar-vps.sh` la primera vez y se guarda solo en el VPS, en `despliegue/.env` (`ESTADISTICAS_CLAVE`, mínimo 8 caracteres). Para cambiarla: borra ese archivo y vuelve a ejecutar el instalador. Sin contraseña, la página no existe. `GET /estadisticas.json`: los mismos datos.
- Datos en `contador.json`, en el volumen `juegos-datos`.
