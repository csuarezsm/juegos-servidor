# Servidor de juegos en línea · IT Canarias
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY servidor.js ./
COPY juegos ./juegos
COPY compartido ./compartido
USER node
ENV PORT=8090 NODE_ENV=production
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/salud >/dev/null || exit 1
CMD ["node", "servidor.js"]
