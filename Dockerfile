# ALRIS Call Center — Imagem Docker de Produção (Node.js 20 Alpine, leve e zero-dependências)
FROM node:20-alpine

WORKDIR /app

# Copia apenas os arquivos públicos do servidor e frontend (sem segredos)
COPY package.json server.js index.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
