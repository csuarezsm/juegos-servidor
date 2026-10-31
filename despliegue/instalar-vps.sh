#!/usr/bin/env bash
# Instala o actualiza el servidor de juegos en el VPS de IT Canarias, detrás de nginx-sat.
# Uso (desde la carpeta del repo, como root):  bash despliegue/instalar-vps.sh
#
# Qué hace, en orden, parándose al primer problema:
#  1. Comprueba que está todo lo que espera (Docker, nginx-sat, la red proxy-interno, el DNS) y que el puerto 8090 está libre.
#  2. Construye y arranca el contenedor «juegos-servidor» (no toca ningún otro).
#  3. Añade juegos.itcanarias.com a la configuración de nginx-sat, entre marcas, con copia de seguridad.
#     Antes de recargar Nginx comprueba la configuración (nginx -t); si falla, restaura la copia y no recarga.
#  4. Saca el certificado HTTPS con certbot, igual que los de las demás webs (se renueva con el cron que ya hay).
#  5. Comprueba https://juegos.itcanarias.com/salud.
# Se puede volver a ejecutar: actualiza el contenedor y deja la configuración igual.
set -euo pipefail

DOMINIO="juegos.itcanarias.com"
NGINX="nginx-sat"
CONF="/opt/n8n/nginx/default.conf"
RED="proxy-interno"
PUERTO=8090
IP_VPS="212.227.40.8"
INICIO="# >>> juegos-servidor"
FIN="# <<< juegos-servidor"
cd "$(dirname "$0")/.."

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
info() { printf '• %s\n' "$*"; }
para() { printf '\033[31m✘ %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || para "Ejecútalo como root."
command -v docker >/dev/null || para "No encuentro Docker."
command -v certbot >/dev/null || para "No encuentro certbot."
[ "$(docker inspect -f '{{.State.Running}}' "$NGINX" 2>/dev/null)" = "true" ] || para "El contenedor $NGINX no está en marcha."
docker network inspect "$RED" >/dev/null 2>&1 || para "No existe la red de Docker $RED."
[ -f "$CONF" ] || para "No encuentro $CONF."
getent hosts "$DOMINIO" | grep -q "$IP_VPS" || para "$DOMINIO no apunta a $IP_VPS (revisa el DNS)."
if ss -tlnp 2>/dev/null | grep -q ":$PUERTO " && ! docker ps --format '{{.Names}} {{.Ports}}' | grep -q "^juegos-servidor .*:$PUERTO->"; then
  para "El puerto $PUERTO lo usa otro programa."
fi
# Capacidad: el servidor de juegos necesita poco (unos 50 MB de memoria en uso, 128 MB como máximo),
# pero no se instala si el VPS ya va justo.
MEM_LIBRE=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
DISCO_LIBRE=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
CARGA=$(awk '{print $2}' /proc/loadavg); NUCLEOS=$(nproc)
info "Memoria disponible: ${MEM_LIBRE} MB · disco libre: ${DISCO_LIBRE} MB · carga (5 min): $CARGA con $NUCLEOS núcleos"
[ "$MEM_LIBRE" -ge 400 ] || para "Quedan menos de 400 MB de memoria libres. Mejor no añadir nada hasta liberar memoria."
[ "${DISCO_LIBRE:-0}" -ge 1500 ] || para "Quedan menos de 1,5 GB de disco para Docker (la construcción necesita unos 300 MB)."
if ! awk -v c="$CARGA" -v n="$NUCLEOS" 'BEGIN { exit !(c < n * 1.5) }'; then
  if [ "${FORZAR:-}" = "1" ]; then info "Carga alta ($CARGA), pero sigo porque has puesto FORZAR=1. La construcción se hace con prioridad baja."
  else para "El VPS va muy cargado ahora mismo (carga $CARGA con $NUCLEOS núcleos). Prueba más tarde o, si siempre está así, ejecuta: FORZAR=1 bash despliegue/instalar-vps.sh"; fi
fi
ok "Comprobaciones previas (hay capacidad de sobra)"

# --- 2. Contenedor ---
info "Construyendo y arrancando juegos-servidor (tarda un poco la primera vez)…"
nice -n 19 docker compose -f despliegue/docker-compose.vps.yml build
docker compose -f despliegue/docker-compose.vps.yml up -d
docker image prune -f --filter "label=com.docker.compose.project=despliegue" >/dev/null 2>&1 || true   # sin imágenes viejas del propio servidor
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$PUERTO/salud" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PUERTO/salud" >/dev/null || { docker logs --tail 50 juegos-servidor; para "El servidor no responde en 127.0.0.1:$PUERTO."; }
docker exec "$NGINX" wget -qO- "http://juegos-servidor:$PUERTO/salud" >/dev/null || para "nginx-sat no llega a juegos-servidor por la red $RED."
ok "Contenedor en marcha y accesible desde nginx-sat"

# --- 3/4. Nginx y certificado ---
# Cómo saca certbot los certificados de las demás webs: miramos uno que ya existe
REN=$(ls /etc/letsencrypt/renewal/*.conf 2>/dev/null | grep -v "$DOMINIO" | head -1 || true)
[ -n "$REN" ] || para "No encuentro configuraciones de certbot en /etc/letsencrypt/renewal."
AUTH=$(grep -E '^\s*authenticator' "$REN" | head -1 | sed 's/.*=\s*//' | tr -d ' ')
WEBROOT=$(grep -E '^\s*webroot_path' "$REN" | head -1 | sed 's/.*=\s*//' | tr -d ' ,')
[ -n "$WEBROOT" ] || WEBROOT=$(sed -n '/\[\[webroot_map\]\]/,$p' "$REN" | grep '=' | head -1 | sed 's/.*=\s*//' | tr -d ' ')
info "certbot usa «$AUTH»${WEBROOT:+ con la carpeta $WEBROOT} (visto en $(basename "$REN"))"
[ "$AUTH" = "webroot" ] || para "certbot no usa «webroot» para las demás webs ($AUTH). No sigo para no tocar nginx-sat: pásale este mensaje a Claude."
# carpeta equivalente dentro del contenedor de Nginx
WEBROOT_NGINX=$(docker inspect "$NGINX" --format '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' | while IFS='|' read -r src dst; do
  case "$WEBROOT" in "$src"|"$src"/*) echo "$dst${WEBROOT#"$src"}";; esac; done | head -1)
[ -n "$WEBROOT_NGINX" ] || para "La carpeta $WEBROOT no está montada en $NGINX."

COPIA="$CONF.antes-de-juegos-$(date +%Y%m%d-%H%M%S)"
cp -a "$CONF" "$COPIA"
info "Copia de seguridad: $COPIA"

poner_bloque() {   # sustituye (o añade) el bloque entre las marcas
  local tmp; tmp=$(mktemp)
  awk -v a="$INICIO" -v b="$FIN" '$0==a{skip=1} !skip{print} $0==b{skip=0}' "$CONF" > "$tmp"
  printf '%s\n' "$INICIO" "$1" "$FIN" >> "$tmp"
  cat "$tmp" > "$CONF"; rm -f "$tmp"     # cat > conserva el archivo montado en el contenedor
}
recargar() {
  if docker exec "$NGINX" nginx -t >/tmp/juegos-nginx-t.log 2>&1; then docker exec "$NGINX" nginx -s reload; return 0; fi
  cat /tmp/juegos-nginx-t.log
  cat "$COPIA" > "$CONF"; docker exec "$NGINX" nginx -t >/dev/null 2>&1 && docker exec "$NGINX" nginx -s reload || true
  para "La configuración de Nginx no es válida. He dejado la de antes ($COPIA)."
}
PROXY="        resolver 127.0.0.11 valid=30s ipv6=off;
        set \$juegos_backend juegos-servidor:$PUERTO;
        proxy_pass http://\$juegos_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;"
ACME="    location /.well-known/acme-challenge/ { root $WEBROOT_NGINX; }"

if [ ! -f "/etc/letsencrypt/live/$DOMINIO/fullchain.pem" ]; then
  # Paso A: solo HTTP, para que certbot pueda comprobar el dominio
  poner_bloque "server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;
$ACME
    location / {
$PROXY
    }
}"
  recargar
  info "Pidiendo el certificado HTTPS…"
  if ! certbot certonly --webroot -w "$WEBROOT" -d "$DOMINIO" --non-interactive --agree-tos --keep-until-expiring; then
    cat "$COPIA" > "$CONF"; docker exec "$NGINX" nginx -s reload || true
    para "certbot no pudo sacar el certificado. He dejado Nginx como estaba."
  fi
  ok "Certificado HTTPS"
fi

# Paso B: configuración definitiva (HTTP → HTTPS y WebSocket por HTTPS)
poner_bloque "server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;
$ACME
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMINIO;
    ssl_certificate /etc/letsencrypt/live/$DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMINIO/privkey.pem;
    location / {
$PROXY
    }
}"
recargar
ok "Nginx configurado para $DOMINIO"

# --- 5. Comprobación final ---
info "Consumo del servidor de juegos: $(docker stats --no-stream --format '{{.MemUsage}} · CPU {{.CPUPerc}}' juegos-servidor)"
sleep 1
if curl -fsS "https://$DOMINIO/salud"; then echo; ok "Listo: https://$DOMINIO/salud responde. Las demás webs no se han tocado."
else para "https://$DOMINIO/salud no responde todavía. Mira: docker logs juegos-servidor"; fi
