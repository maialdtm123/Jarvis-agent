# Jarvis multi-agent server
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
# Sem dependências de runtime — apenas o JS compilado.
EXPOSE 8791
CMD ["node", "dist/index.js"]
