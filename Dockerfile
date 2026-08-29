# ---------- build stage ----------
FROM node:22-slim AS build
WORKDIR /app
# openssl จำเป็นสำหรับ Prisma, git ใช้สำหรับดึง commit hash
RUN apt-get update -y && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*
RUN git config --global --add safe.directory '*'
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY .git ./.git
RUN mkdir -p public && (HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "e78a53e") && echo "{\"version\":\"$HASH\"}" > public/version.json)
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY prisma ./prisma
# migrate แล้วค่อยรัน (data/ เป็น volume — DB คงอยู่)
CMD npx prisma migrate deploy && node dist/index.js
