FROM node:18.18.0-bullseye

WORKDIR /app

# install native deps for canvas
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=34001
EXPOSE 34001

CMD ["node", "index.js"]