# MotoKE — container image for Cloudflare Containers
#
# The app has zero runtime dependencies, so there is no install step and no
# node_modules layer. The image is the Node runtime plus this repository.
#
# node:sqlite is still experimental in Node 22, hence --no-warnings: without it
# the runtime prints to stderr on every boot and some log collectors treat that
# as a failed start.

FROM node:22-slim

# Not root. A web process that can rewrite its own code is a bigger problem
# than the one it solves.
WORKDIR /app

# Source only. .dockerignore keeps the database, the encryption key, the
# generated photographs and the research notes out of the image.
COPY . .

# The data directory is where SQLite and the encryption key live. It is created
# here so the first boot does not have to, and so the ownership is right.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Tells server.js to bind 0.0.0.0 rather than loopback.
ENV MOTOKE_CONTAINER=1
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Cloudflare checks the port is answering before routing to the instance.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/fuel').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server.js"]
