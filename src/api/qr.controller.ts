import { Router, Request, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { getSupabaseClient } from "../infra/supabaseClient";
import {
  initInstance,
  getQRCode,
  getConnectionStatus,
  getConnectedNumber,
  logoutInstance,
  listInstances,
  clearInstanceData,
} from "../core/baileys";
import QRCode from "qrcode-terminal";

export const qrRouter = Router();
// Router público para endpoints que não precisam de auth completo
export const publicQrRouter = Router();

// Middleware de autenticación global para este router
qrRouter.use(requireAuth);

const getScopedId = (tenantId: string, instanceId: string) =>
  `${tenantId}-${instanceId}`;

/**
 * GET /api/wa/instances/available
 * Obtiene las instancias disponibles para crear (wa-01, wa-02, wa-03)
 */
qrRouter.get(
  "/instances/available",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res
          .status(400)
          .json({ success: false, error: "Tenant ID missing" });
      }

      const supabase = getSupabaseClient();
      const { data: instances, error } = await supabase
        .from("ghl_wa_instances")
        .select("name")
        .eq("tenant_id", tenantId);

      if (error) throw error;

      const allPossibleIds = ["wa-01", "wa-02", "wa-03"];
      const existingIds = instances?.map((i) => i.name) || [];

      // Filtrar solo las que NO existen
      const available = allPossibleIds.filter(
        (id) => !existingIds.includes(id),
      );

      res.json({
        success: true,
        available,
        total: allPossibleIds.length,
        used: existingIds.length,
        tenantId,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

/**
 * GET /api/wa/instances
 * Obtiene todas las instancias creadas por el tenant
 * Combina datos de Supabase con estado en memoria (connectionStatus) para reflejar el estado real
 */
qrRouter.get("/instances", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res
        .status(400)
        .json({ success: false, error: "Tenant ID missing" });
    }

    const supabase = getSupabaseClient();
    const { data: instances, error } = await supabase
      .from("ghl_wa_instances")
      .select("*")
      .eq("tenant_id", tenantId);

    if (error) throw error;

    const mappedInstances =
      instances?.map((i) => {
        const scopedId = getScopedId(tenantId, i.name);
        const memoryStatus = getConnectionStatus(scopedId);
        const connectedNumber = getConnectedNumber(scopedId);
        const hasQR = !!getQRCode(scopedId);

        // Normalizar status: preferir estado em memoria (mais atual), fallback para DB
        let normalizedStatus: string;
        if (memoryStatus === "ONLINE" || memoryStatus === "connected") {
          normalizedStatus = "ONLINE";
        } else if (
          memoryStatus === "RECONNECTING" ||
          memoryStatus === "connecting"
        ) {
          normalizedStatus = "RECONNECTING";
        } else {
          // Fallback: normalizar status do banco
          const dbStatus = (i.status || "").toLowerCase();
          if (dbStatus === "connected") normalizedStatus = "ONLINE";
          else if (dbStatus === "reconnecting" || dbStatus === "connecting")
            normalizedStatus = "RECONNECTING";
          else normalizedStatus = "OFFLINE";
        }

        return {
          instanceId: i.name,
          status: normalizedStatus,
          phone: connectedNumber || i.phone_number || null,
          lastConnectedAt: i.last_connected_at || null,
          lastError: null,
          phoneAlias: i.alias,
          hasQR,
        };
      }) || [];

    res.json({
      success: true,
      instances: mappedInstances,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/instances
 * Crea una nueva instancia con ID específico del usuario
 * Body: { instanceId: 'wa-01' | 'wa-02' | 'wa-03', phoneAlias?: string, forceNew?: boolean }
 */
qrRouter.post(
  "/instances",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceId, phoneAlias, forceNew = false } = req.body;
      const tenantId = req.tenantId;

      if (!tenantId) {
        return res
          .status(400)
          .json({ success: false, error: "Tenant ID required" });
      }

      // Validar instanceId
      const allowedIds = ["wa-01", "wa-02", "wa-03"];
      if (!allowedIds.includes(instanceId)) {
        return res.status(400).json({
          success: false,
          error: `instanceId inválido: ${instanceId}`,
          message: "Solo se permiten: wa-01, wa-02, wa-03",
        });
      }

      const supabase = getSupabaseClient();

      // 1. Verificar límites del plan
      const { data: tenantData, error: tenantError } = await supabase
        .from("ghl_wa_tenants")
        .select("max_instances, subscription_status")
        .eq("id", tenantId)
        .single();

      if (tenantError || !tenantData) {
        return res
          .status(500)
          .json({ success: false, error: "Error fetching tenant data" });
      }

      if (
        tenantData.subscription_status !== "active" &&
        tenantData.subscription_status !== "trial"
      ) {
        return res.status(403).json({
          success: false,
          error: "Subscription inactive",
          message:
            "Tu suscripción no está activa. Por favor actualiza tu plan.",
        });
      }

      // Verificar si ya existe esta instancia específica
      const { data: existingInstance } = await supabase
        .from("ghl_wa_instances")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("name", instanceId)
        .single();

      // Si no existe, verificar límite global
      if (!existingInstance) {
        const { count, error: countError } = await supabase
          .from("ghl_wa_instances")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenantId);

        if (countError) throw countError;

        if ((count || 0) >= tenantData.max_instances) {
          return res.status(403).json({
            success: false,
            error: "Limit reached",
            message: `Has alcanzado el límite de ${tenantData.max_instances} instancias de tu plan. Actualiza tu suscripción para agregar más.`,
          });
        }
      }

      if (existingInstance && !forceNew) {
        return res.status(409).json({
          success: false,
          error: `Instancia ${instanceId} ya está activa`,
          instanceId,
          message: "Usa forceNew: true para sobrescribir o elimínala primero",
        });
      }

      const scopedId = getScopedId(tenantId, instanceId);

      // Si forceNew = true, limpiar sesión anterior
      if (existingInstance && forceNew) {
        console.log(
          `🧹 [${scopedId}] Eliminando sesión anterior (forceNew=true)...`,
        );
        await logoutInstance(scopedId);
        await supabase
          .from("ghl_wa_sessions")
          .delete()
          .eq("instance_id", scopedId);
      }

      // Registrar/Actualizar instancia en DB (select-update-insert seguro)
      const { data: existingDbInst } = await supabase
        .from("ghl_wa_instances")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", instanceId)
        .maybeSingle();
      if (existingDbInst?.id) {
        await supabase
          .from("ghl_wa_instances")
          .update({
            alias: phoneAlias,
            status: "offline",
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingDbInst.id);
      } else {
        await supabase.from("ghl_wa_instances").insert({
          tenant_id: tenantId,
          name: instanceId,
          alias: phoneAlias,
          status: "offline",
          is_active: true,
        });
      }

      // Inicializar la instancia
      await initInstance(scopedId, true, phoneAlias, tenantId);

      res.json({
        success: true,
        instanceId,
        phoneAlias,
        status: getConnectionStatus(scopedId),
        message:
          "Instancia creada. Genera el QR con GET /api/wa/qr/:instanceId",
        sessionWasCleared: !!existingInstance && forceNew,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

/**
 * GET /api/wa/qr/:instanceId
 * Genera y devuelve el QR code para escanear
 */
qrRouter.get(
  "/qr/:instanceId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceId } = req.params;
      const tenantId = req.tenantId;
      if (!tenantId)
        return res.status(400).json({ error: "Tenant ID missing" });

      const scopedId = getScopedId(tenantId, instanceId);

      // Verificar estado primero
      const currentStatus = getConnectionStatus(scopedId);
      if (currentStatus === "connected" || currentStatus === "ONLINE") {
        return res.json({
          success: true,
          instanceId,
          status: "connected",
          message: "Ya está conectado",
        });
      }

      const hasQR = getQRCode(scopedId);
      const shouldForce = !hasQR; // Forzar SIEMPRE que no haya QR

      console.log(
        `[${scopedId}] 🔄 Iniciando generación de QR (force=${shouldForce})...`,
      );

      // Iniciar instancia (forzar si es necesario)
      await initInstance(scopedId, shouldForce, undefined, tenantId);

      // Esperar hasta 15 segundos para que se genere el QR (polling cada 500ms)
      let qr: string | undefined;
      let status: string;
      let attempts = 0;
      const maxAttempts = 30; // 30 * 500ms = 15 segundos máximo

      console.log(`[${scopedId}] Esperando generación de QR...`);

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        qr = getQRCode(scopedId);
        status = getConnectionStatus(scopedId);

        // Si ya está conectado, retornar
        if (status === "connected" || status === "ONLINE") {
          return res.json({
            success: true,
            instanceId,
            status: "connected",
            message: "Ya está conectado",
          });
        }

        // Si tenemos QR, salir del loop
        if (qr) {
          console.log(
            `[${scopedId}] ✅ QR encontrado después de ${attempts * 500}ms`,
          );
          break;
        }

        attempts++;
      }

      // Verificar estado final
      status = getConnectionStatus(scopedId);
      if (status === "connected" || status === "ONLINE") {
        return res.json({
          success: true,
          instanceId,
          status: "connected",
          message: "Ya está conectado",
        });
      }

      if (!qr) {
        return res.json({
          success: false,
          instanceId,
          status,
          message: `QR no disponible después de ${attempts * 500}ms. Revisa los logs.`,
        });
      }

      // Mostrar QR en terminal para pruebas locales
      console.log(`\n🔷 QR Code para ${scopedId}:`);
      QRCode.generate(qr, { small: true });

      res.json({
        success: true,
        instanceId,
        status,
        qr,
        message: "Escanea el QR con WhatsApp",
      });
    } catch (error: any) {
      console.error(
        `[ERROR] Error generando QR para ${req.params.instanceId}:`,
        error,
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

/**
 * GET /api/wa/qr-check/:instanceId
 * Obtiene el QR si está disponible, sin forzar generación
 */
publicQrRouter.get(
  "/qr-check/:instanceId",
  (req: AuthenticatedRequest, res: Response) => {
    const { instanceId } = req.params;
    const tenantId = (req.headers["x-tenant-id"] as string) || req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "Tenant ID missing" });

    const scopedId = getScopedId(tenantId, instanceId);
    const qr = getQRCode(scopedId);
    const status = getConnectionStatus(scopedId);

    if (status === "connected" || status === "ONLINE") {
      return res.json({
        success: true,
        instanceId,
        status: "connected",
        message: "Ya está conectado",
      });
    }

    if (qr) {
      return res.json({
        success: true,
        instanceId,
        status,
        qr,
        message: "QR disponible para escanear",
      });
    }

    return res.status(200).json({
      success: false,
      instanceId,
      status,
      message: "QR aún no disponible",
    });
  },
);

/**
 * GET /api/wa/status/:instanceId
 * Obtiene el estado de conexión y número conectado
 */
qrRouter.get(
  "/status/:instanceId",
  (req: AuthenticatedRequest, res: Response) => {
    const { instanceId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "Tenant ID missing" });

    const scopedId = getScopedId(tenantId, instanceId);
    const rawStatus = getConnectionStatus(scopedId);
    const connectedNumber = getConnectedNumber(scopedId);

    // Normalizar status para o formato que o frontend espera (ONLINE/OFFLINE/RECONNECTING)
    let normalizedStatus: string;
    if (rawStatus === "ONLINE" || rawStatus === "connected") {
      normalizedStatus = "ONLINE";
    } else if (rawStatus === "RECONNECTING" || rawStatus === "connecting") {
      normalizedStatus = "RECONNECTING";
    } else {
      normalizedStatus = "OFFLINE";
    }

    res.json({
      success: true,
      instanceId,
      status: normalizedStatus,
      connectedNumber: connectedNumber || undefined,
    });
  },
);

/**
 * POST /api/wa/reconnect/:instanceId
 * Fuerza la reconexión de una instancia de WhatsApp
 */
publicQrRouter.post(
  "/reconnect/:instanceId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceId } = req.params;
      // Aceita tenantId via header (chamadas internas) ou do middleware de auth
      let tenantId = (req.headers["x-tenant-id"] as string) || req.tenantId;

      // Se não veio tenantId, buscar pelo instanceId no Supabase
      if (!tenantId) {
        const supabase = getSupabaseClient();
        const { data: inst } = await supabase
          .from("ghl_wa_instances")
          .select("tenant_id")
          .eq("name", instanceId)
          .single();
        tenantId = inst?.tenant_id;
      }

      if (!tenantId)
        return res.status(400).json({ error: "Tenant ID missing" });

      const scopedId = getScopedId(tenantId, instanceId);

      console.log(`🔄 [${scopedId}] Iniciando reconexión forzada...`);

      const currentStatus = getConnectionStatus(scopedId);

      await initInstance(scopedId, true, undefined, tenantId);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const newStatus = getConnectionStatus(scopedId);

      res.json({
        success: true,
        instanceId,
        message: `Reconexión iniciada para ${instanceId}`,
        previousStatus: currentStatus,
        currentStatus: newStatus,
      });
    } catch (error: any) {
      console.error(`❌ Error reconectando ${req.params.instanceId}:`, error);
      res.status(500).json({
        success: false,
        instanceId: req.params.instanceId,
        error: error.message,
      });
    }
  },
);

/**
 * POST /api/wa/logout/:instanceId
 * Cierra la sesión de una instancia
 */
qrRouter.post(
  "/logout/:instanceId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceId } = req.params;
      const tenantId = req.tenantId;
      if (!tenantId)
        return res.status(400).json({ error: "Tenant ID missing" });

      const scopedId = getScopedId(tenantId, instanceId);
      await logoutInstance(scopedId);

      // Actualizar estado en DB
      const supabase = getSupabaseClient();
      await supabase
        .from("ghl_wa_instances")
        .update({ status: "offline", updated_at: new Date().toISOString() })
        .eq("id", scopedId);

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
  },
);

/**
 * POST /api/wa/clear/:instanceId
 * Limpia la sesión de una instancia para forzar nuevo QR
 */
qrRouter.post(
  "/clear/:instanceId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceId } = req.params;
      const tenantId = req.tenantId;
      if (!tenantId)
        return res
          .status(400)
          .json({ success: false, error: "Tenant ID missing" });

      const scopedId = getScopedId(tenantId, instanceId);

      // Cerrar sesión si está activa
      await logoutInstance(scopedId);

      // Eliminar sesión de DB
      const supabase = getSupabaseClient();
      await supabase
        .from("ghl_wa_sessions")
        .delete()
        .eq("instance_id", scopedId);
      console.log(`[${scopedId}] Sesión eliminada de DB`);

      // Actualizar estado
      await supabase
        .from("ghl_wa_instances")
        .update({ status: "offline", updated_at: new Date().toISOString() })
        .eq("id", scopedId);

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
  },
);

/**
 * DELETE /api/wa/delete/:instanceId
 * Elimina completamente una instancia
 */
qrRouter.delete(
  "/delete/:instanceId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceId } = req.params;
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res
          .status(400)
          .json({ success: false, error: "Tenant ID missing" });
      }

      const scopedId = getScopedId(tenantId, instanceId);

      console.log(`🗑️ [${scopedId}] Eliminando instancia completamente...`);

      // 1. Cerrar socket
      try {
        await logoutInstance(scopedId);
      } catch (err) {
        console.log(`⚠️ [${scopedId}] No se pudo cerrar socket`);
      }

      // 2. Limpiar estado en memoria
      clearInstanceData(scopedId);

      // 3. Limpiar DB (Sesiones e Instancia)
      const supabase = getSupabaseClient();

      // Eliminar registro de sesiones
      await supabase
        .from("ghl_wa_sessions")
        .delete()
        .eq("instance_id", scopedId);

      // Eliminar registro de instancia
      await supabase
        .from("ghl_wa_instances")
        .delete()
        .eq("name", instanceId)
        .eq("tenant_id", tenantId);

      // 4. Limpiar cache de números
      try {
        const { unregisterInstanceNumber } =
          await import("../infra/instanceNumbersCache");
        await unregisterInstanceNumber(scopedId);
      } catch (err) {}

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
  },
);

/**
 * POST /api/wa/cleanup-cache
 * Limpia registros huérfanos de Supabase (Global Admin - cuidado)
 */
qrRouter.post(
  "/cleanup-cache",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { getAllInstanceNumbers, unregisterInstanceNumber } =
        await import("../infra/instanceNumbersCache");

      // Obtener todos los registros en Supabase (Instance Numbers Cache)
      const allCacheEntries = await getAllInstanceNumbers();

      console.log("\n🧹 [CLEANUP] Iniciando limpieza de Supabase...");

      const supabase = getSupabaseClient();
      const { data: dbInstances } = await supabase
        .from("ghl_wa_instances")
        .select("id");
      const validIds = dbInstances?.map((d) => d.id) || [];

      const deleted: string[] = [];
      for (const scopedId of Object.keys(allCacheEntries)) {
        if (!validIds.includes(scopedId)) {
          await unregisterInstanceNumber(scopedId);
          deleted.push(scopedId);
          console.log(`   ❌ Eliminado registro huérfano: ${scopedId}`);
        }
      }

      res.json({
        success: true,
        message: `Limpieza completada. ${deleted.length} registro(s) eliminado(s).`,
        deleted,
      });
    } catch (error: any) {
      console.error("❌ Error en cleanup-cache:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);
