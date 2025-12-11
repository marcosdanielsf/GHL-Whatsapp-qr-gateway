import { Router, Request, Response } from 'express';
import {
  initInstance,
  getQRCode,
  getConnectionStatus,
  getConnectedNumber,
  logoutInstance,
  listInstances,
  generateInstanceId,
} from '../core/baileys';
import QRCode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';

export const qrRouter = Router();

/**
 * GET /api/wa/instances/available
 * Obtiene las instancias disponibles para crear (wa-01, wa-02, wa-03)
 */
qrRouter.get('/instances/available', (req: Request, res: Response) => {
  const allPossibleIds = ['wa-01', 'wa-02', 'wa-03'];
  const existingInstances = listInstances();
  const existingIds = existingInstances.map(i => i.instanceId);
  
  // Filtrar solo las que NO existen
  const available = allPossibleIds.filter(id => !existingIds.includes(id));
  
  res.json({
    success: true,
    available,
    total: allPossibleIds.length,
    used: existingIds.length,
  });
});

/**
 * POST /api/instances
 * Crea una nueva instancia con ID específico del usuario
 * Body: { instanceId: 'wa-01' | 'wa-02' | 'wa-03', phoneAlias?: string, forceNew?: boolean }
 */
qrRouter.post('/instances', async (req: Request, res: Response) => {
  try {
    const { instanceId, phoneAlias, forceNew = false } = req.body;
    
    // Validar que instanceId esté presente
    if (!instanceId) {
      return res.status(400).json({
        success: false,
        error: 'instanceId es requerido',
        message: 'Debe especificar wa-01, wa-02 o wa-03',
      });
    }
    
    // Validar que sea uno de los IDs permitidos
    const allowedIds = ['wa-01', 'wa-02', 'wa-03'];
    if (!allowedIds.includes(instanceId)) {
      return res.status(400).json({
        success: false,
        error: `instanceId inválido: ${instanceId}`,
        message: 'Solo se permiten: wa-01, wa-02, wa-03',
      });
    }
    
    // Verificar si ya existe en memoria
    const existingInstances = listInstances();
    const alreadyExists = existingInstances.some(i => i.instanceId === instanceId);
    
    if (alreadyExists && !forceNew) {
      return res.status(409).json({
        success: false,
        error: `Instancia ${instanceId} ya está activa`,
        instanceId,
        message: 'Usa forceNew: true para sobrescribir o elimínala primero',
      });
    }
    
    // Verificar si ya existe sesión guardada en disco
    const sessionPath = path.join(
      process.env.SESSION_DIR || './data/sessions',
      instanceId
    );
    
    const sessionExists = fs.existsSync(sessionPath);
    
    if (sessionExists && !forceNew) {
      console.log(`⚠️ [${instanceId}] Sesión anterior detectada. Usa forceNew: true para sobrescribir.`);
      return res.status(409).json({
        success: false,
        error: `Instancia ${instanceId} ya tiene una sesión guardada`,
        instanceId,
        message: 'Usa forceNew: true para eliminar la sesión anterior y crear una nueva',
        hint: 'O usa DELETE /api/wa/delete/:instanceId para eliminar completamente la instancia',
      });
    }
    
    // Si forceNew = true, eliminar sesión anterior
    if (sessionExists && forceNew) {
      console.log(`🧹 [${instanceId}] Eliminando sesión anterior (forceNew=true)...`);
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`✅ [${instanceId}] Sesión anterior eliminada`);
    }
    
    // Inicializar la instancia
    await initInstance(instanceId, true, phoneAlias);
    
    res.json({
      success: true,
      instanceId,
      phoneAlias,
      status: getConnectionStatus(instanceId),
      message: 'Instancia creada. Genera el QR con GET /api/wa/qr/:instanceId',
      sessionWasCleared: sessionExists && forceNew,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/wa/qr/:instanceId
 * Genera y devuelve el QR code para escanear
 */
qrRouter.get('/qr/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;

    // Verificar estado primero
    const currentStatus = getConnectionStatus(instanceId);
    if (currentStatus === 'connected') {
      return res.json({
        success: true,
        instanceId,
        status: 'connected',
        message: 'Ya está conectado',
      });
    }

    // Si hay una instancia activa ONLINE, no forzar reinicio
    const existingInstances = listInstances();
    const activeInstance = existingInstances.find(i => i.instanceId === instanceId && i.status === 'ONLINE');
    
    if (activeInstance) {
      return res.json({
        success: true,
        instanceId,
        status: 'connected',
        phoneNumber: activeInstance.phone,
        message: 'La instancia ya está conectada y activa',
      });
    }

    // SIEMPRE forzar reinicio si no hay QR para garantizar generación
    const hasQR = getQRCode(instanceId);
    const shouldForce = !hasQR; // Forzar SIEMPRE que no haya QR
    
    console.log(`[${instanceId}] 🔄 Iniciando generación de QR (force=${shouldForce})...`);
    
    // Iniciar instancia (forzar si es necesario)
    await initInstance(instanceId, shouldForce);

    // Esperar hasta 15 segundos para que se genere el QR (polling cada 500ms)
    let qr: string | undefined;
    let status: string;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 500ms = 15 segundos máximo

    console.log(`[${instanceId}] Esperando generación de QR...`);

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      qr = getQRCode(instanceId);
      status = getConnectionStatus(instanceId);

      // Si ya está conectado, retornar
      if (status === 'connected') {
        return res.json({
          success: true,
          instanceId,
          status: 'connected',
          message: 'Ya está conectado',
        });
      }

      // Si tenemos QR, salir del loop
      if (qr) {
        console.log(`[${instanceId}] ✅ QR encontrado después de ${attempts * 500}ms`);
        break;
      }

      // Log cada 2 segundos para debugging
      if (attempts % 4 === 0 && attempts > 0) {
        console.log(`[${instanceId}] ⏳ Esperando QR... (${attempts * 500}ms)`);
      }

      attempts++;
    }

    // Verificar estado final
    status = getConnectionStatus(instanceId);
    if (status === 'connected') {
      return res.json({
        success: true,
        instanceId,
        status: 'connected',
        message: 'Ya está conectado',
      });
    }

    if (!qr) {
      // Log detallado del estado actual
      console.log(`[${instanceId}] ❌ QR no encontrado después de ${attempts * 500}ms`);
      console.log(`[${instanceId}] Estado final:`, {
        status,
        hasQR: false,
        attempts,
        totalWaitTime: `${attempts * 500}ms`
      });
      
      return res.json({
        success: false,
        instanceId,
        status,
        message: `QR no disponible después de ${attempts * 500}ms. Revisa los logs del servidor para ver los eventos de conexión. Intenta limpiar la sesión con POST /api/wa/clear/${instanceId} y vuelve a intentar.`,
        debug: {
          attempts,
          waitTimeMs: attempts * 500,
          suggestion: 'Revisa la consola del servidor para ver los eventos connection.update'
        }
      });
    }

    // Mostrar QR en terminal para pruebas locales
    console.log(`\n🔷 QR Code para ${instanceId}:`);
    QRCode.generate(qr, { small: true });

    res.json({
      success: true,
      instanceId,
      status,
      qr,
      message: 'Escanea el QR con WhatsApp',
    });
  } catch (error: any) {
    console.error(`[ERROR] Error generando QR para ${req.params.instanceId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/wa/qr-check/:instanceId
 * Obtiene el QR si está disponible, sin forzar generación
 */
qrRouter.get('/qr-check/:instanceId', (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const qr = getQRCode(instanceId);
  const status = getConnectionStatus(instanceId);

  if (status === 'connected') {
    return res.json({
      success: true,
      instanceId,
      status: 'connected',
      message: 'Ya está conectado',
    });
  }

  if (qr) {
    return res.json({
      success: true,
      instanceId,
      status,
      qr,
      message: 'QR disponible para escanear',
    });
  }

  // No hay QR disponible aún - devolver 200 con success: false para polling
  return res.status(200).json({
    success: false,
    instanceId,
    status,
    message: 'QR aún no disponible',
  });
});

/**
 * GET /api/wa/status/:instanceId
 * Obtiene el estado de conexión y número conectado
 */
qrRouter.get('/status/:instanceId', (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const status = getConnectionStatus(instanceId);
  const connectedNumber = getConnectedNumber(instanceId);

  res.json({
    success: true,
    instanceId,
    status,
    connectedNumber: connectedNumber || undefined,
  });
});

/**
 * POST /api/wa/reconnect/:instanceId
 * Fuerza la reconexión de una instancia de WhatsApp
 * 
 * Casos de uso:
 * - Instancia OFFLINE que necesita reconectar
 * - Problemas de sincronización de mensajes
 * - Después de errores de red
 */
qrRouter.post('/reconnect/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    
    console.log(`🔄 [${instanceId}] Iniciando reconexión forzada...`);
    
    // Obtener estado actual
    const currentStatus = getConnectionStatus(instanceId);
    console.log(`📊 [${instanceId}] Estado actual: ${currentStatus}`);
    
    // Forzar reinicio de la instancia
    // El parámetro 'true' fuerza la reconexión incluso si ya está conectada
    await initInstance(instanceId, true);
    
    // Esperar un momento para que inicie la reconexión
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const newStatus = getConnectionStatus(instanceId);
    
    res.json({
      success: true,
      instanceId,
      message: `Reconexión iniciada para ${instanceId}`,
      previousStatus: currentStatus,
      currentStatus: newStatus,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`✅ [${instanceId}] Reconexión iniciada. Estado: ${currentStatus} → ${newStatus}`);
    
  } catch (error: any) {
    console.error(`❌ Error reconectando ${req.params.instanceId}:`, error);
    res.status(500).json({
      success: false,
      instanceId: req.params.instanceId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/wa/logout/:instanceId
 * Cierra la sesión de una instancia
 */
qrRouter.post('/logout/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    await logoutInstance(instanceId);

    res.json({
      success: true,
      message: `Instancia ${instanceId} desconectada`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/wa/clear/:instanceId
 * Limpia la sesión de una instancia para forzar nuevo QR
 */
qrRouter.post('/clear/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    
    // Cerrar sesión si está activa
    await logoutInstance(instanceId);
    
    // Eliminar directorio de sesión
    const sessionDir = path.join(process.env.SESSION_DIR || './data/sessions', instanceId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[${instanceId}] Sesión eliminada: ${sessionDir}`);
    }

    res.json({
      success: true,
      message: `Sesión de ${instanceId} eliminada. Puedes generar un nuevo QR ahora.`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/wa/instances
 * Lista todas las instancias
 */
qrRouter.get('/instances', (req: Request, res: Response) => {
  const instances = listInstances();

  res.json({
    success: true,
    instances,
  });
});

/**
 * DELETE /api/wa/delete/:instanceId
 * Elimina completamente una instancia (sesión + estado en memoria + Redis)
 */
qrRouter.delete('/delete/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const { clearInstanceData } = await import('../core/baileys');
    
    console.log(`🗑️ [${instanceId}] Eliminando instancia completamente...`);
    
    // 1. Cerrar socket si está activo
    try {
      await logoutInstance(instanceId);
      console.log(`✅ [${instanceId}] Socket cerrado`);
    } catch (err) {
      console.log(`⚠️ [${instanceId}] No se pudo cerrar socket (puede no estar activo)`);
    }
    
    // 2. Eliminar sesión del disco
    const sessionPath = path.join(
      process.env.SESSION_DIR || './data/sessions',
      instanceId
    );
    
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`✅ [${instanceId}] Sesión eliminada del disco`);
    }
    
    // 3. Limpiar estado en memoria (Maps internos)
    clearInstanceData(instanceId);
    console.log(`✅ [${instanceId}] Estado en memoria limpiado`);
    
    // 4. Limpiar registro Redis si existe
    try {
      const phone = getConnectedNumber(instanceId);
      if (phone) {
        const { getRedisClient } = await import('../infra/redisClient');
        const redis = getRedisClient();
        await redis.hdel('instances:numbers', instanceId);
        console.log(`✅ [${instanceId}] Registro Redis eliminado (${phone})`);
      }
    } catch (err) {
      console.log(`⚠️ [${instanceId}] No se pudo limpiar Redis (puede no existir)`);
    }
    
    console.log(`✅ [${instanceId}] Instancia eliminada completamente`);
    
    res.json({
      success: true,
      instanceId,
      message: `Instancia ${instanceId} eliminada completamente`,
    });
  } catch (error: any) {
    console.error(`❌ Error eliminando instancia:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/wa/cleanup-redis
 * Limpia registros huérfanos de Redis (números de instancias que ya no existen)
 */
qrRouter.post('/cleanup-redis', async (req: Request, res: Response) => {
  try {
    const { getRedisClient } = await import('../infra/redisClient');
    const redis = getRedisClient();
    
    // Obtener todas las instancias activas
    const activeInstances = listInstances();
    const activeInstanceIds = activeInstances.map(i => i.instanceId);
    
    // Obtener todos los registros en Redis
    const REDIS_KEY = 'instances:numbers';
    const allRedisEntries = await redis.hgetall(REDIS_KEY);
    
    console.log('\n🧹 [CLEANUP] Iniciando limpieza de Redis...');
    console.log(`   Instancias activas:`, activeInstanceIds);
    console.log(`   Registros en Redis:`, Object.keys(allRedisEntries));
    
    // Eliminar registros de instancias que ya no existen
    const deleted: string[] = [];
    for (const instanceId of Object.keys(allRedisEntries)) {
      if (!activeInstanceIds.includes(instanceId)) {
        await redis.hdel(REDIS_KEY, instanceId);
        deleted.push(instanceId);
        console.log(`   ❌ Eliminado registro huérfano: ${instanceId} (${allRedisEntries[instanceId]})`);
      }
    }
    
    console.log(`\n✅ [CLEANUP] Limpieza completada. Eliminados: ${deleted.length}`);
    
    res.json({
      success: true,
      message: `Limpieza completada. ${deleted.length} registro(s) eliminado(s).`,
      deleted,
      remaining: activeInstanceIds,
    });
  } catch (error: any) {
    console.error('❌ Error en cleanup-redis:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
