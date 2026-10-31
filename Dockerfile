# Servidor de juegos en línea · IT Canarias
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY motores ./motores
RUN mkdir -p /datos && chown node:node /datos
ENV NODE_ENV=production PORT=8090 HOST=0.0.0.0 DATA_DIR=/datos
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8090/salud >/dev/null || exit 1
CMD ["node", "src/server.js"]
