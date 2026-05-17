FROM node:20-alpine

# Install git for dev-tracker service
RUN apk add --no-cache git && \
    git config --global --add safe.directory '*'

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Backend dist
COPY dist/ ./dist/

# Frontend is mounted via volume at runtime

ENV PORT=5211
EXPOSE 5211

CMD ["node", "dist/dashboard/server.js"]
