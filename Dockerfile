# syntax=docker/dockerfile:1

FROM node:24.18.0-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

# Fallback build toolchain in case a native module (better-sqlite3) has no
# prebuilt binary for this image's platform/arch (e.g. building for linux/arm64).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Full source is needed before `pnpm install` — the root postinstall script
# builds @emu/core (tsc), which requires packages/core's tsconfig + src to
# already be present, not just its package.json.
COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm build

FROM node:24.18.0-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3399 \
    EMU_DB_PATH=/data/data.db \
    EMU_DESIGNER_DB_PATH=/data/designer.db

# packages/server and packages/client must stay siblings — the server locates
# the built client at a path relative to its own compiled location.
COPY --from=build /app /app

RUN mkdir -p /data

EXPOSE 3399
VOLUME ["/data"]

CMD ["node", "packages/server/dist/main.js"]
