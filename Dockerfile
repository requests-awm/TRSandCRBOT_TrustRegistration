# syntax=docker/dockerfile:1.7
#
# Trust Registration Monitor (TRS / CRBOT) — repository-root Dockerfile.
# Lives at the root so Cloud Run's "continuously deploy from a repository" trigger finds it with its
# default source location (/Dockerfile). The application itself is in app/trust-reg.
#
# Targets:
#   runner   (default) - the Next.js app, standalone output, non-root, ~150 MB
#   migrator           - Prisma CLI for `migrate deploy` against DATABASE_URL
#
# Configuration is read at RUNTIME (Cloud Run environment variables / --env-file), including the
# NEXT_PUBLIC_* values: the root layout injects them into the page per request (src/lib/publicConfig.ts)
# and server code reads them through src/server/env.ts. The build args below are optional and only
# matter for a placeholder-mode demo image built without any runtime configuration.

ARG NODE_IMAGE=node:22-alpine
ARG APP_DIR=app/trust-reg

# ---- deps -------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
ARG APP_DIR
WORKDIR /app
COPY ${APP_DIR}/package.json ${APP_DIR}/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder ----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
ARG APP_DIR
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY ${APP_DIR}/ ./

ARG NEXT_PUBLIC_DATA_SOURCE=http
ARG NEXT_PUBLIC_AUTH_MODE=supabase
ENV NEXT_PUBLIC_DATA_SOURCE=${NEXT_PUBLIC_DATA_SOURCE} \
    NEXT_PUBLIC_AUTH_MODE=${NEXT_PUBLIC_AUTH_MODE} \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- migrator ---------------------------------------------------------------------------------
# docker compose run --rm migrator            -> prisma migrate deploy
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/supabase/sql ./supabase/sql
ENTRYPOINT ["node", "node_modules/prisma/build/index.js"]
CMD ["migrate", "deploy"]

# ---- runner -----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && apk add --no-cache curl

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Cloud Run ignores HEALTHCHECK and injects its own PORT; both are honoured by server.js.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
