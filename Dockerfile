FROM node:22-slim

# OCR (Post Manager): Tesseract + deutsches Sprachpaket, pdftoppm fuer PDF-Scans
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Das npm 10.9.x, das node:22-slim aktuell mitbringt, stirbt auf knappen
# Servern bei "npm error Exit handler never called!" — daher zuerst auf
# npm 11 heben (das alte node:20-Problem, nur anders verpackt).
RUN npm install -g npm@11 --no-audit --no-fund

WORKDIR /app

COPY . .

# --no-audit/--no-fund sparen Speicher; npm ci (Lock-Datei) ist deterministisch,
# die nachfolgenden Install-Versuche faengen Netzwerk-Flauten ab.
RUN rm -rf node_modules dist \
    && (npm ci --include=dev --no-audit --no-fund \
        || npm install --include=dev --no-audit --no-fund \
        || (sleep 10 && npm install --include=dev --no-audit --no-fund)) \
    && npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "start"]