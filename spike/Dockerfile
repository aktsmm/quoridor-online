# Phase 0a spike image. Container Apps runs linux/amd64.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./

ENV PORT=8080
EXPOSE 8080

# Run as an unprivileged user and as PID 1 so SIGTERM reaches node directly.
USER node
CMD ["node", "server.mjs"]
