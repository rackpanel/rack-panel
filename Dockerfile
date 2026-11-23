FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY shared ./shared
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm --prefix server ci && npm --prefix client ci

COPY server ./server
COPY client ./client

RUN npm run build

FROM node:22-alpine
WORKDIR /app

LABEL org.opencontainers.image.title="RACK//PANEL" \
      org.opencontainers.image.description="Touchscreen-first Server Rack, Proxmox VE, OPNsense & Tailscale Control Panel (Android 4.4+ compatible)" \
      org.opencontainers.image.url="https://github.com/rackpanel/rack-panel" \
      org.opencontainers.image.source="https://github.com/rackpanel/rack-panel" \
      org.opencontainers.image.licenses="MIT"

# Include Tailscale CLI, curl, OpenSSH client & FFmpeg (for RTSP/H.265 Hikvision camera streams)
RUN apk add --no-cache tailscale curl openssh-client ffmpeg

COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3840
ENV HOST=0.0.0.0

EXPOSE 3840
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3840/api/health || exit 1

CMD ["node", "server/dist/server/src/index.js"]
