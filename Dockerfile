# Node.js Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy package files first for cache optimization
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built application
COPY dist ./dist/

# Create temp directory for file uploads
RUN mkdir -p temp

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "dist/index.js"]
