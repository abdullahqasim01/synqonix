# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* values are baked into the browser bundle. Pass them as build arguments, or put them in
# web/.env.production (Next.js reads that file while building); an argument wins over the file.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STORAGE_URL
# An empty argument must not shadow the file, so unset it unless a value was given.
RUN if [ -z "$NEXT_PUBLIC_API_URL" ]; then unset NEXT_PUBLIC_API_URL; fi; \
    if [ -z "$NEXT_PUBLIC_STORAGE_URL" ]; then unset NEXT_PUBLIC_STORAGE_URL; fi; \
    npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
