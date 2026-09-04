FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends zip unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    TRUST_PROXY=1

EXPOSE 10000
CMD ["node", "server.mjs"]
