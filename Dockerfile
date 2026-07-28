# syntax=docker/dockerfile:1

# Build stage: compile every workspace the server needs.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/ai/package.json packages/ai/
COPY packages/server/package.json packages/server/
RUN npm ci --workspace @quoridor/server --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/ai packages/ai
COPY packages/server packages/server
RUN npx tsc -b packages/server

# Drop dev dependencies before copying node_modules into the runtime image.
RUN npm prune --omit=dev --workspace @quoridor/server --include-workspace-root

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/ai/package.json ./packages/ai/package.json
COPY --from=build /app/packages/ai/dist ./packages/ai/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist

EXPOSE 8080
USER node

# Node must see SIGTERM itself so the graceful shutdown path runs; no shell in
# between, so this stays an exec-form CMD.
CMD ["node", "--enable-source-maps", "packages/server/dist/main.js"]
