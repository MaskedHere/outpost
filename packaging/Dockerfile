# syntax=docker/dockerfile:1

# The runtime image uses Alpine's system Chromium (see CHROMIUM_PATH), so skip Playwright's own
# ~150MB browser download in every stage.
FROM node:22-alpine AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci

FROM deps AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
COPY apps/frontend apps/frontend
RUN npm run build

FROM node:22-alpine AS runtime
# chromium/nss/freetype/harfbuzz/ttf-freefont: Outpost scrapes CurseForge through a real headless
# browser (their search pages sit behind Cloudflare's bot challenge, which a plain fetch fails).
# docker-cli: used for the container exec/log paths the panel relies on.
RUN apk add --no-cache tini openssl docker-cli \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV DATABASE_URL="file:/data/config/outpost.db"
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Point Playwright at the system Chromium installed above instead of its own managed download.
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

COPY --from=deps /app/node_modules ./node_modules
# npm workspaces don't hoist dependencies with conflicting version requirements (dockerode and its
# tar-stream chain stay nested), so the backend's own node_modules is needed at runtime too.
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/generated ./apps/backend/generated
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/frontend/dist ./apps/frontend/dist

WORKDIR /app/apps/backend
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "mkdir -p /data/config && npx prisma migrate deploy --schema ./prisma/schema.prisma && node dist/server.js"]
