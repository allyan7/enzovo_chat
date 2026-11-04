# One image: API + built React app. Ollama runs on the host:
#   docker run -p 3000:3000 -e OLLAMA_BASE_URL=http://host.docker.internal:11434 ghcr.io/<owner>/enzovo_chat
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci && npm cache clean --force
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV DB_PATH=/data/enzovo.db CHECKPOINT_DB_PATH=/data/checkpoints.db PORT=3000
RUN mkdir -p /data && npx tsx models/seed.ts
EXPOSE 3000
CMD ["npx", "tsx", "api.ts"]
