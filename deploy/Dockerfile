# Multi-stage Node 20 image for App Runner (SPEC.md §6 pins Node.js 20 LTS; #123/#124
# close SPEC.md §11's "MCP server accessible via remote URL" line). server/ deps only —
# client/ is a separate npm package (own package.json) and is never installed here.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY server/src ./server/src
COPY server/data ./server/data
# Metadata only, not an enforced binding — server.js resolves the real port via
# `process.env.PORT ? Number(process.env.PORT) : 3000`, so `-e PORT=8080` still works.
EXPOSE 3000
CMD ["node", "server/src/server.js"]
