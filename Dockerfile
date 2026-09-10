# Stage 1: compile Go worker
FROM golang:1.27-bookworm AS go-builder
WORKDIR /go-worker
COPY go-worker/ .
RUN CGO_ENABLED=0 go build -o worker .

# Stage 2: Node production image
FROM node:20.11.0-bookworm
WORKDIR /app

# native deps for canvas + curl for HEALTHCHECK
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  curl \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# copy Go binary from builder stage
COPY --from=go-builder /go-worker/worker ./go-worker/worker

COPY . .

# run as non-root user
RUN chown -R node:node /app
USER node

ENV PORT=34001
EXPOSE 34001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:34001/health || exit 1

CMD ["node", "index.js"]