FROM node:22-slim

WORKDIR /app

COPY . .

# Das npm aus node:20 (10.8.x) bricht auf Servern mit knappem RAM den
# Installationslauf ab ("npm error Exit handler never called!") -
# node:22 bringt npm 11 mit. --no-audit/--no-fund sparen Speicher,
# der zweite Versuch faengt Netzwerk-Flauten ab.
RUN rm -rf node_modules dist \
    && (npm install --include=dev --no-audit --no-fund \
        || (sleep 10 && npm install --include=dev --no-audit --no-fund)) \
    && npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "start"]
