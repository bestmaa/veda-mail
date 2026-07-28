FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner
WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV VEDA_MAIL_DATA_DIR=/data

LABEL org.opencontainers.image.title="Veda Mail" \
  org.opencontainers.image.description="White-label self-hosted webmail" \
  org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  org.opencontainers.image.source="https://github.com/bestmaa/veda-mail"

RUN apk add --no-cache dumb-init=1.2.5-r4 \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /data \
  && chown nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs \
  /app/scripts/admin-recovery.mjs ./scripts/admin-recovery.mjs
COPY --from=builder --chown=nextjs:nodejs \
  /app/LICENSE /app/NOTICE /app/TRADEMARKS.md ./

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
