# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
COPY apps/frontend apps/frontend
RUN npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV DATABASE_URL="file:/data/config/outpost.db"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/generated ./apps/backend/generated
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/frontend/dist ./apps/frontend/dist

WORKDIR /app/apps/backend
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "mkdir -p /data/config && npx prisma migrate deploy --schema ./prisma/schema.prisma && node dist/server.js"]
