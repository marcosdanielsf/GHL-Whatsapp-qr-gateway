# **Proyecto Integración WhatsApp ↔ GHL — *Sprint del 11 al 13 de noviembre de 2025***

## **No confundir:**

- Con el api de meta o facebook \- autorización de facebook \- aceptar las reglas de facebook es costoso y es fácil de integrar, el número que asigna a este whatsapp ya no sirve para hacer llamadas...  
- **Integración con whatsapp mediante QR,** es mas difícil para la gente común no requiere de autorización ni permisos de facebook ni aceptar términos y condiciones, es barato o gratis. tienen desventajas y riesgos anulación de número por parte de facebook, 

## **🎯 Objetivo General**

Construir el **Gateway WhatsApp** base del sistema, capaz de:  
 1️⃣ Conectarse mediante QR y mantener sesión activa (sin reescanear).  
 2️⃣ Enviar y recibir mensajes (texto \+ media) usando colas y control de flujo.

Este Sprint abarca los hitos **H1** y **H2** del MVP general.

---

## **🧭 Índice de Hitos del MVP**

| Hito | Objetivo | Resultado Esperado |
| ----- | ----- | ----- |
| **H1** | Conexión QR estable | Sesión persistente sin volver a escanear |
| **H2** | Envío/recepción con colas | Mensajería confiable (texto \+ media) |
| **H3** | Integración con GHL | Comunicación bidireccional vía Webhooks |
| **H4** | Multi-instancia \+ grupos | Soporte para 2 números y grupos |
| **H5** | Panel y monitoreo | UI mínima con estado, logs y pruebas |

---

## **🧱 Alcance del Sprint (H1 \+ H2)**

### **🔹 H1 — Sesión QR Estable (Gateway Básico)**

**Meta:** permitir que un número de WhatsApp se conecte mediante QR, mantenga la sesión y no requiera reescaneo tras reinicio.

**Requisitos técnicos:**

* **Node.js 20+**, **Baileys** (librería de WhatsApp no oficial Multi-Device).

* **Express.js** para exponer endpoints HTTP.

* **Redis** para manejar colas.

* **BullMQ** para enviar mensajes en segundo plano.

* **Docker Compose** para montar entorno local.

---

### **🔹 H2 — Envío y Recepción con Colas (Texto \+ Media)**

**Meta:** permitir el envío de mensajes de texto e imagen con retrasos controlados y logs estructurados.

**Requisitos técnicos:**

* **Cola de envío** con BullMQ.

* **Rate-limit** simple (3–4 s entre textos / 6–9 s entre medios).

* **Logs** (Winston o console estructurada).

* **Persistencia** de sesión (authState por `instanceId`).

---

## **⚙️ Configuración del Proyecto**

### **📂 Estructura de Carpetas**

`/app`

  `/src`

    `/api`

      `qr.controller.ts`

      `send.controller.ts`

    `/core`

      `baileys.ts`

      `message-router.ts`

      `session-store.ts`

    `/queue`

      `workers.ts`

      `rate-limit.ts`

    `/infra`

      `redis.ts`

      `logger.ts`

      `http.ts`

  `docker-compose.yml`

  `.env`

  `README.md`

### **📄 Variables de entorno (.env)**

`PORT=8080`

`REDIS_URL=redis://redis:6379`

`SESSION_DIR=/data/sessions`

`TEXT_DELAY_MS=3500`

`MEDIA_DELAY_MS_MIN=6000`

`MEDIA_DELAY_MS_MAX=9000`

---

## **💻 Código Base (Simplificado)**

### **🔸 `baileys.ts` — conexión y sesión**

`import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@adiwajshing/baileys'`

`import path from 'path'`

`export async function initInstance(instanceId: string) {`

  `const sessionPath = path.join(process.env.SESSION_DIR!, instanceId)`

  `const { state, saveCreds } = await useMultiFileAuthState(sessionPath)`

  `const sock = makeWASocket({ auth: state, printQRInTerminal: false })`

  `sock.ev.on('creds.update', saveCreds)`

  `sock.ev.on('connection.update', (u) => {`

    `const { connection, lastDisconnect, qr } = u`

    `if (qr) cacheQR(instanceId, qr)`

    `if (connection === 'open') markOnline(instanceId)`

    `if (connection === 'close') {`

      `const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut`

      `if (shouldReconnect) setTimeout(() => initInstance(instanceId), 2000)`

      `else markOffline(instanceId)`

    `}`

  `})`

  `sock.ev.on('messages.upsert', onInboundMessage(instanceId))`

  `return sock`

`}`

---

### **🔸 `qr.controller.ts`**

`import { Router } from 'express'`

`import { initInstance, getLastQR } from '../core/baileys'`

`export const router = Router()`

`router.get('/api/wa/qr/:instanceId', async (req, res) => {`

  `const { instanceId } = req.params`

  `await initInstance(instanceId)`

  `const qr = getLastQR(instanceId)`

  `if (!qr) return res.status(204).end()`

  `res.json({ instanceId, qr })`

`})`

---

### **🔸 `message-router.ts`**

`export const onInboundMessage = (instanceId: string) => async (m: any) => {`

  `for (const msg of m.messages) {`

    `const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text`

    `if (!text) continue`

    ``console.log(`[${instanceId}] Inbound from ${msg.key.remoteJid}: ${text}`)``

    `if (/^hola/i.test(text)) {`

      ``await getSock(instanceId).sendMessage(msg.key.remoteJid!, { text: `eco: ${text}` })``

    `}`

  `}`

`}`

---

### **🔸 `send.controller.ts`**

`import { Router } from 'express'`

`import { queues } from '../queue/workers'`

`export const router = Router()`

`router.post('/api/send', async (req, res) => {`

  `const job = await queues.send.add('send', req.body, { removeOnComplete: true })`

  `res.status(202).json({ jobId: job.id })`

`})`

---

### **🔸 `workers.ts` (cola de envío)**

`import { Worker } from 'bullmq'`

`import { getSock } from '../core/baileys'`

`import { delayForType } from './rate-limit'`

`export const sendWorker = new Worker('send', async (job) => {`

  `const { instanceId, to, type, message, mediaUrl } = job.data`

  `await delayForType(type, instanceId)`

  `const sock = getSock(instanceId)`

  `if (type === 'text') {`

    ``await sock.sendMessage(`${to}@s.whatsapp.net`, { text: message })``

  `} else {`

    `const res = await fetch(mediaUrl)`

    `const buffer = Buffer.from(await res.arrayBuffer())`

    ``await sock.sendMessage(`${to}@s.whatsapp.net`, { image: buffer })``

  `}`

  ``console.log(`[${instanceId}] SENT → ${to} (${type})`)``

`})`

---

### **🔸 `rate-limit.ts`**

`const lastSent: Record<string, number> = {}`

`export async function delayForType(type: string, instanceId: string) {`

  `const now = Date.now()`

  `const delay = type === 'text'`

    `? Number(process.env.TEXT_DELAY_MS || 3500)`

    `: randomInt(Number(process.env.MEDIA_DELAY_MS_MIN || 6000), Number(process.env.MEDIA_DELAY_MS_MAX || 9000))`

  `const last = lastSent[instanceId] || 0`

  `const wait = Math.max(0, last + delay - now)`

  `if (wait > 0) await new Promise(r => setTimeout(r, wait))`

  `lastSent[instanceId] = Date.now()`

`}`

---

### **🔸 `docker-compose.yml`**

`version: '3.9'`

`services:`

  `api:`

    `build: .`

    `ports: ["8080:8080"]`

    `environment:`

      `- REDIS_URL=redis://redis:6379`

      `- SESSION_DIR=/data/sessions`

    `volumes:`

      `- ./data/sessions:/data/sessions`

    `depends_on: [redis]`

  `worker:`

    `build: .`

    `command: node dist/worker.js`

    `environment:`

      `- REDIS_URL=redis://redis:6379`

      `- SESSION_DIR=/data/sessions`

    `volumes:`

      `- ./data/sessions:/data/sessions`

    `depends_on: [redis]`

  `redis:`

    `image: redis:7-alpine`

---

## **🧩 Pruebas del Sprint**

### **Prueba H1**

1. Ejecutar `docker-compose up`.

2. Abrir en navegador: `http://localhost:8080/api/wa/qr/wa-01`.

3. Escanear el QR con WhatsApp.

4. Enviar “hola” desde el teléfono → respuesta automática “eco: hola”.

5. Reiniciar el contenedor → no se pide QR y “hola” sigue funcionando.

### **Prueba H2**

1. Enviar texto:

`curl -X POST http://localhost:8080/api/send \`

  `-H "Content-Type: application/json" \`

  `-d '{"instanceId":"wa-01","to":"+51999999999","type":"text","message":"Hola desde GHL"}'`

2. Enviar imagen:

`curl -X POST http://localhost:8080/api/send \`

  `-H "Content-Type: application/json" \`

  `-d '{"instanceId":"wa-01","to":"+51999999999","type":"image","mediaUrl":"https://picsum.photos/400"}'`

3. Validar en consola:

   * Mensajes enviados con delay de 3–4 s (texto) y 6–9 s (media).

   * 0 duplicados, 0 fallos.

---

## **👥 Roles del Equipo (5 integrantes)**

| Rol | Responsabilidad |
| ----- | ----- |
| 1\. Backend Líder | Configurar librería Baileys y endpoints |
| 2\. Dev API | Implementar colas BullMQ y rate-limit |
| 3\. Dev QA | Probar reconexión y validar delays |
| 4\. Dev Infra | Docker Compose, entorno local y logs |
| 5\. Documentador | Crear README, demo y grabar video |

---

## **🧾 Entregable del Sprint (13 nov 2025\)**

* Repositorio con:

  * `/src` completo.

  * `.env`, `docker-compose.yml`, `README.md`.

* Video corto (1 min):

  * Escaneo QR → conexión.

  * Reinicio → sesión persistente.

  * Envío 5 textos \+ 1 imagen con spacing.

Logs mostrando:

 `[wa-01] SENT → +51999999999 (text)`

`[wa-01] SENT → +51999999999 (image)`

* 

---

## **✅ Criterios de Completitud**

| Criterio | Cumplimiento |
| ----- | ----- |
| Sesión QR persistente tras reinicio | ✅ |
| Envío/recepción de texto funcional | ✅ |
| Envío de imagen con delay controlado | ✅ |
| Logs estructurados de mensajes | ✅ |
| Sin duplicados ni pérdida de mensajes | ✅ |

* **H1** ✅ Sesión QR estable y persistente

* **H2** ✅ Envío/recepción con colas (texto \+ media)

## **Sprint 2 18-11-2025    entrega 22-11-2025**

## **🧩 Ejercicio H3 — Integración básica WhatsApp ↔ GHL (dos vías)**

**Objetivo:** que un mensaje que nace en GHL termine en WhatsApp, y la respuesta del cliente vuelva a GHL y dispare un Workflow.

### **1\) Camino OUTBOUND (GHL → tu Gateway → WhatsApp)**

**Tarea técnica:**

1. Crear un endpoint en tu gateway:

   * `POST /api/ghl/outbound`

Body mínimo:

 {  
  "locationId": "xxx",  
  "contactId": "yyy",  
  "phone": "+51999999999",  
  "message": "Texto que viene de GHL"  
}

*   
2. Ese endpoint simplemente:

   * Valida datos (que venga `phone` y `message`).

Llama internamente a tu `/api/send` (el que ya tienen de H2), con:

 {  
  "instanceId": "wa-01",  
  "to": "+51999999999",  
  "type": "text",  
  "message": "Texto que viene de GHL"  
}

*   
3. En GHL:

   * Crear un Workflow de prueba.

   * Añadir acción **Custom Webhook** apuntando a `https://tu-servidor/api/ghl/outbound`.

   * Enviar en el body JSON los campos que definiste (`phone`, `message`, etc).

✅ **Hecho cuando:**  
 Desde un Workflow de GHL disparan el Custom Webhook, y el mensaje llega al WhatsApp del tester.

---

### **2\) Camino INBOUND (WhatsApp → tu Gateway → GHL)**

**Tarea técnica:**

1. En tu `onInboundMessage(instanceId)` (que ya responde “eco”):

   * Además de hacer el `sendMessage`, haz un `fetch`/`axios.post` a un endpoint de GHL (o un mock, si aún no usan app real):

   * Endpoint destino (ejemplo): `POST https://tu-endpoint-ngrok/ghl/inbound-test`

Body mínimo:

 {  
  "instanceId": "wa-01",  
  "from": "+51999999999",  
  "text": "hola",  
  "timestamp": 1731300000  
}

*   
2. Si ya tienen app en GHL:

   * Configurar un **Webhook Inbound** en GHL apuntando a tu endpoint real.

   * Mapear `from` → contacto (por número) y mostrar el mensaje en alguna parte (aunque sea logueado o guardado como nota).

✅ **Hecho cuando:**

* Cuando el cliente escribe por WhatsApp:

  * Tu gateway recibe el mensaje.

  * Envía un `POST` a GHL (o mock).

  * Puedes ver ese JSON en logs o en un endpoint de prueba.

---

### **3\) Demostración simple (fin de H3)**

**Demo que deberían poder mostrar:**

1. Desde GHL → ejecutar un Workflow → se manda un mensaje de WhatsApp al cliente.

2. El cliente responde en WhatsApp → tu gateway envía el inbound a un endpoint de GHL (o mock) → se ve el JSON con la respuesta.

Con esto, ya tienes:

* ✅ H1: conexión y sesión estable

* ✅ H2: canal WhatsApp funcionando con colas

* ✅ H3: WhatsApp realmente **integrado** con el mundo GHL (aunque sea en versión simple)

Si quieres, en el siguiente paso te armo **H4 (multi-instancia \+ grupos)** también como **un solo ejercicio integrado**, igual que este.

## **Proyecto integración WhatsApp ↔ GHL — Sprint del 2 al 5 de diciembre de 2025**

🧩 **Ejercicio H4 — Multi-instancia \+ Estado de salud básico**

### **🎯 Objetivo general**

Permitir manejar **más de un número de WhatsApp** (multi-instancia) desde el gateway, con **estado básico por instancia** (ONLINE / OFFLINE / RECONNECTING), listo para usarse más adelante en el panel y en GHL.

---

## **1\) Modelo de instancia (definición técnica)**

### **Tarea técnica:**

1. Definir el concepto de **instanceId**:

   * Ejemplos: `"wa-01"`, `"wa-02"`, `"wa-03"`.

   * Cada `instanceId` tiene su **propia sesión** (authState) en una carpeta separada:

     * `/data/sessions/wa-01`

     * `/data/sessions/wa-02`

Crear una estructura interna (en memoria o DB simple) para almacenar el estado de cada instancia, por ejemplo:

 `{`  
  `"instanceId": "wa-01",`  
  `"status": "ONLINE",`  
  `"phone": "+51999999999",`  
  `"lastConnectedAt": "2025-11-25T10:30:00Z",`  
  `"lastError": null`  
`}`

2. 

✅ **Hecho cuando**:

* Existe un modelo claro de instancia y una estructura de estado que se actualiza en memoria o DB cada vez que una instancia cambia de conexión.

---

## **2\) Endpoints para manejar instancias**

### **Tarea técnica:**

Crear al menos estos endpoints en el gateway:

1. `POST /api/instances`

Body mínimo:

 `{`  
  `"phoneAlias": "Numero pruebas 1"`  
`}`

*   
  * Acción:

    * Genera un nuevo `instanceId` (ej. `wa-01`, `wa-02`, incremental).

    * Inicializa la sesión llamando a la función `initInstance(instanceId)`.

    * Registra la instancia en la estructura de estado.

Respuesta:

 `{`  
  `"instanceId": "wa-01"`  
`}`

*   
2. `GET /api/instances`

Devuelve la lista de instancias con su estado:

 `[`  
  `{`  
    `"instanceId": "wa-01",`  
    `"status": "ONLINE",`  
    `"phone": null,`  
    `"lastConnectedAt": "...",`  
    `"lastError": null`  
  `},`  
  `{`  
    `"instanceId": "wa-02",`  
    `"status": "OFFLINE",`  
    `"phone": null,`  
    `"lastConnectedAt": null,`  
    `"lastError": "Not connected"`  
  `}`  
`]`

*   
3. `GET /api/wa/qr/:instanceId`

   * Reutiliza lo que ya tienen de H1, pero ahora funciona para **cualquier** `instanceId` creado con `POST /api/instances`.

✅ **Hecho cuando**:

* Se puede crear una nueva instancia con `POST /api/instances`.

* `GET /api/instances` devuelve todas las instancias con su estado actual.

* `GET /api/wa/qr/wa-01` muestra el QR para esa instancia.

---

## **3\) Aislamiento de instancias en el código**

### **Tarea técnica:**

1. Asegurarse de que el wrapper de WhatsApp (Baileys) y el almacenamiento de sesión:

   * No usen variables globales que mezclen instancias.

   * Siempre reciban `instanceId` como parámetro para:

     * Cargar el authState correcto.

     * Enviar mensajes desde el socket correcto.

     * Procesar eventos (`messages.upsert`, `connection.update`) por instancia.

Modificar `/api/send` (de H2/H3) para que siempre reciba el `instanceId` correcto, por ejemplo:

 `{`  
  `"instanceId": "wa-01",`  
  `"to": "+51999999999",`  
  `"type": "text",`  
  `"message": "Hola desde instancia 1"`  
`}`

2. 

✅ **Hecho cuando**:

* Los mensajes de `wa-01` y `wa-02` no se mezclan.

* El código nunca asume “una sola” instancia; siempre usa `instanceId`.

---

## **4\) Estado de salud por instancia**

### **Tarea técnica:**

1. En `connection.update` del cliente de WhatsApp:

   * Actualizar el estado de la instancia:

     * `status = "ONLINE"` cuando la conexión abre.

     * `status = "OFFLINE"` cuando se cierra y no se intentará reconectar.

     * `status = "RECONNECTING"` durante intentos de reconexión automática.

   * Guardar:

     * `lastConnectedAt` cuando pasa a ONLINE.

     * `lastError` cuando hay errores graves.

2. Asegurarse de que `GET /api/instances` muestre estos estados en tiempo real.

✅ **Hecho cuando**:

* Se puede ver claramente qué instancia está ONLINE, cuál está OFFLINE, cuál está RECONNECTING usando solo `GET /api/instances`.

---

## **5\) Prueba final del ejercicio H4**

### **Escenario de prueba:**

1. Crear **2 instancias**:

   * `POST /api/instances` → `wa-01`

   * `POST /api/instances` → `wa-02`

2. Obtener QR de ambas:

   * `GET /api/wa/qr/wa-01`

   * `GET /api/wa/qr/wa-02`

   * Escanear con 2 números distintos (o 2 teléfonos distintos).

3. Enviar mensajes desde el gateway:

   * 5 mensajes con `instanceId = "wa-01"` al teléfono A.

   * 5 mensajes con `instanceId = "wa-02"` al teléfono B.

4. Validar que:

   * Los mensajes de `wa-01` llegan solo al número A.

   * Los mensajes de `wa-02` llegan solo al número B.

   * `GET /api/instances` muestra `wa-01` y `wa-02` como `ONLINE`.

✅ **Hecho H4 cuando**:

* Se pueden crear y listar instancias.

* Hay 2 instancias activas, cada una con su sesión QR.

* Los envíos no se mezclan entre instancias.

* El endpoint de estado refleja correctamente ONLINE/OFFLINE/RECONNECTING.

---

## **6\) Sugerencia de distribución del equipo (5 integrantes)**

* Dev 1: endpoints `/api/instances`, modelo de instancia.

* Dev 2: integración de `instanceId` en `/api/send` y wrapper de WhatsApp.

* Dev 3: lógica de `connection.update` y estado de salud.

* Dev 4: pruebas de multi-instancia, scripts de curl / Postman.

* Dev 5: documentación (README del H4 \+ diagrama simple de instancias).

Con este ejercicio H4, dejan listo el gateway para que en el siguiente hito (H5) se pueda construir un panel visual y una integración más cómoda con GHL.

## **Proyecto integración WhatsApp ↔ GHL — Sprint del 04 al 9 de Diciembre Ejercicio H5 — Panel mínimo y Custom Menu Link en GHL**

### **🎯 Objetivo general**

Construir un **panel web mínimo** para gestionar instancias de WhatsApp (ver estado, QR, reconectar) y **mostrarlo dentro de GHL** mediante un **Custom Menu Link**.

---

## **1\) API para el panel (usar lo que ya tienen de H4)**

### **Tarea técnica**

Usar / extender los endpoints del gateway:

1. `GET /api/instances`

   * Ya existe en H4.

Debe devolver, por instancia:

 `{`

  `"instanceId": "wa-01",`

  `"status": "ONLINE",`

  `"phone": "+51...",`

  `"lastConnectedAt": "2025-11-28T10:30:00Z",`

  `"lastError": null`

`}`

*   
2. `GET /api/wa/qr/:instanceId`

   * Ya existe en H1/H4.

Devuelve:

 `{`

  `"instanceId": "wa-01",`

  `"qr": "data:image/png;base64,...."`

`}`

*   
3. `POST /api/instances/:instanceId/reconnect`

   * Nueva ruta.

   * Acción:

     * Marca la instancia como RECONNECTING.

     * Llama internamente a la lógica de reconexión (reiniciar socket para ese `instanceId`).

Respuesta:

 `{ "ok": true }`

* 

✅ **Hecho cuando:**

* `GET /api/instances` lista correctamente instancias y estados.

* `GET /api/wa/qr/:instanceId` devuelve QR.

* `POST /api/instances/:id/reconnect` desencadena reconexión sin romper nada.

---

## **2\) Panel web mínimo (frontend)**

### **Tarea técnica**

Crear una pequeña página (puede ser React, Vue o HTML+JS simple), por ejemplo en `/panel/index.html` o `/panel`:

1. **Vista principal: tabla de instancias**

   * Al cargar la página, hace `GET /api/instances`.

   * Muestra columnas:

     * `instanceId`

     * `status` (con color: verde ONLINE, rojo OFFLINE, amarillo RECONNECTING)

     * `phone` (si lo tienen, o “—”)

     * `lastConnectedAt`

   * Acciones por fila:

     * Botón **“Ver QR”**

     * Botón **“Reconectar”**

2. **Ver QR**

   * Al hacer clic en “Ver QR”, llamar a:

     * `GET /api/wa/qr/:instanceId`

   * Mostrar el QR en un modal o cuadro flotante (imagen `<img src="data:image/png;base64,...">`).

3. **Reconectar**

   * Al hacer clic en “Reconectar”, llamar a:

     * `POST /api/instances/:instanceId/reconnect`

   * Actualizar tabla (volver a llamar `GET /api/instances`).

4. **Auto-refresh ligero**

   * Cada 10–15 segundos, recargar `GET /api/instances` para actualizar estados.

✅ **Hecho cuando:**

* Se ve una tabla con al menos 2 instancias (`wa-01`, `wa-02`) y sus estados.

* “Ver QR” muestra el QR de la instancia.

* “Reconectar” cambia el estado y hace el intento de reconexión sin errores.

---

## **3\) Integración con GHL (Custom Menu Link)**

### **Tarea técnica**

En la **vista Agency** de GHL:

1. Ir a **Settings → Custom Menu Links**.

2. Crear un nuevo link:

   * Nombre: `WhatsApp Gateway` (o similar).

   * URL: `https://TU-DOMINIO/panel`

   * Activar opción para que se muestre en subcuentas deseadas.

3. Guardar y entrar a una subcuenta para verificar que en el menú lateral aparece el link y abre el panel dentro de GHL.

✅ **Hecho cuando:**

* Desde una subcuenta de GHL, al hacer clic en el Custom Menu Link, se abre el panel con la tabla de instancias y los botones funcionando (QR y Reconectar).

---

## **4\) Prueba final del ejercicio H5**

### **Escenario de demo**

1. Abrir una subcuenta de GHL.

2. Ir al menú lateral y entrar a `WhatsApp Gateway` (Custom Menu Link).

3. Mostrar:

   * Tabla de instancias (`wa-01`, `wa-02`), estados y fechas.

   * Clic en “Ver QR” para una instancia → se muestra el QR.

   * Clic en “Reconectar” → estado pasa a RECONNECTING / ONLINE.

4. Desde el teléfono, verificar que:

   * La instancia sigue enviando/recibiendo mensajes después de reconectar.

✅ **H5 completado cuando:**

* El panel funciona dentro de GHL.

* Se puede gestionar instancias básicas (ver estado, QR, reconectar) sin salir de GHL.

---

## **5\) Sugerencia de distribución del equipo (5 integrantes)**

* **Frontend 1:** tabla, botones, consumo de API `/api/instances`, `/qr`, `/reconnect`.

* **Backend 1:** endpoint `POST /api/instances/:id/reconnect`.

* **Backend 2:** ajustar estado de instancia en `connection.update`.

* **Dev GHL:** configurar Custom Menu Link y probar dentro de una subcuenta.

* **Documentación:** README del panel \+ pasos para integrar en GHL.

