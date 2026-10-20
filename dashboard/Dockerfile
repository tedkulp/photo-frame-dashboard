# Home server: the built dashboard plus its /api endpoints. See docs/home-server.md.
# Build context is this folder: docker build -t photo-frame-dashboard dashboard

# The build stage runs on the builder's own platform (dist is plain static files), so multi-arch
# builds only emulate the small runtime stage.
FROM --platform=$BUILDPLATFORM node:24.22.0-alpine3.24 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24.22.0-alpine3.24
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# No runtime dependencies: the server uses Node built-ins only.
COPY package.json ./
COPY server ./server
COPY --from=build /src/dist ./dist
RUN rm -rf server/test \
 && mkdir -p /app/data && chown node:node /app/data
# Chores and other saved state: home.db (plus SQLite's -wal/-shm). Mount ./data here, owned by uid 1000.
VOLUME /app/data
USER node
EXPOSE 8080
CMD ["node", "server/main.js"]
