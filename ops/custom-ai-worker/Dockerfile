FROM node:24.14.0-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY lib ./lib
COPY config ./config
COPY ops/custom-ai-worker ./ops/custom-ai-worker
COPY scripts/build-custom-ai-worker.mjs ./scripts/build-custom-ai-worker.mjs
COPY scripts/custom-ai/core-bundle.json ./scripts/custom-ai/core-bundle.json
RUN node scripts/build-custom-ai-worker.mjs
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.14.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/out/custom-ai-worker.mjs ./worker.mjs
USER node
CMD ["node", "worker.mjs", "--run", "/run/secrets/custom-ai-worker.json"]
