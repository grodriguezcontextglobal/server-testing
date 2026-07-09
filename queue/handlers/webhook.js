'use strict';

/**
 * Handler genérico de la cola para disparar un webhook HTTP externo (ej. el
 * disparo de importación de inventario en `uploadExcelToS3`). Payload:
 * { url, body }. fetchImpl se inyecta para testear sin red real; en
 * producción usa el `fetch` global.
 */
function createWebhookHandler(fetchImpl = fetch) {
  return async function webhookHandler({ url, body }) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webhook error: ${response.status} ${response.statusText} - ${text}`);
    }

    return { status: response.status };
  };
}

module.exports = { createWebhookHandler };
