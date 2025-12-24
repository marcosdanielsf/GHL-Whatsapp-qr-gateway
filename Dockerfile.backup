# Etapa 1: Build del frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Instalar dependencias del frontend
COPY frontend/package*.json ./
RUN npm ci

# Copiar código del frontend y compilar
COPY frontend/ ./
RUN npm run build

# Etapa 2: Backend + Frontend compilado
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del backend
COPY package*.json ./
RUN npm install

# Copiar código fuente del backend
COPY src/ ./src/
COPY tsconfig.json ./

# Compilar TypeScript del backend
RUN npm run build

# Copiar el frontend compilado desde la etapa anterior
COPY --from=frontend-builder /app/frontend/dist ./public

# Exponer puerto
EXPOSE 8080

# Comando de inicio
CMD ["npm", "start"]
