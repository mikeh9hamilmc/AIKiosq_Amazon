# Stage 1: Build the React application
FROM node:20-alpine as build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Run the Node.js server
FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend assets from stage 1
COPY --from=build /app/dist ./dist

# Copy server source and other necessary files
COPY server ./server
COPY types.ts ./
COPY tsconfig.json ./
# Include any other files needed at runtime (e.g. inventory)
COPY public ./public

# Expose the port (App Runner typically uses 8080)
EXPOSE 8080

# Environment variables
ENV NODE_ENV=production
ENV SERVER_PORT=8080

# Start the server using tsx
CMD ["npx", "tsx", "server/index.ts"]
