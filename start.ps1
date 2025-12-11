# Quick Start Script
Write-Host "🚀 WhatsApp GHL Gateway - Setup" -ForegroundColor Cyan
Write-Host ""

# Verificar Node.js
Write-Host "Verificando Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js no encontrado. Instala Node.js 20+ desde https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js instalado: $nodeVersion" -ForegroundColor Green

# Instalar dependencias
Write-Host ""
Write-Host "📦 Instalando dependencias..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error instalando dependencias" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Dependencias instaladas" -ForegroundColor Green

# Crear directorio de sesiones
Write-Host ""
Write-Host "📁 Creando directorio de sesiones..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path ".\data\sessions" | Out-Null
Write-Host "✅ Directorio creado" -ForegroundColor Green

# Iniciar servidor
Write-Host ""
Write-Host "🚀 Iniciando servidor en modo desarrollo..." -ForegroundColor Cyan
Write-Host ""
Write-Host "📍 Endpoints disponibles en: http://localhost:8080" -ForegroundColor Green
Write-Host "📖 Ver README.md para instrucciones de Postman" -ForegroundColor Yellow
Write-Host ""

npm run dev
