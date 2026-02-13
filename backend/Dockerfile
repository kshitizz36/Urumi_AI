# Urumi Platform API

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Security: Run as non-root user
RUN addgroup -g 1001 urumi && \
    adduser -u 1001 -G urumi -s /bin/sh -D urumi

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Switch to non-root user
USER urumi

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
