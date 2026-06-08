FROM node:20-alpine

WORKDIR /app

# Instalar dependencias de producción primero (cacheado si package.json no cambia)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar solo lo necesario para correr el servidor
COPY src/ ./src/
COPY llm/ ./llm/
COPY db/ ./db/
COPY scripts/ ./scripts/

EXPOSE 3000

CMD ["node", "src/server.js"]
