# Studio Personalizado — site + API (Node 22) em um único contêiner.
FROM node:22-slim AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY package.json index.html admin.html styles.css admin.css manifest.json sw.js icon.svg ./
COPY js ./js
COPY img ./img
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations
# Roda sem privilégios de root
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]
