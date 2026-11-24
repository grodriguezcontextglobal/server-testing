const ACCEPTED_ORIGINS = [
    "http://localhost:5522",
    "http://localhost:5523", // local Cypress/test instance
    "https://devitrak-app-survey.pages.dev",
    "http://localhost:3791",
    "https://admin.devitrak.net",
    "https://app.devitrak.net",
    // Console de plataforma (2026-11-19, confirmado por el dashboard). Entrada
    // propia y no heredada de `admin.devitrak.net`: es la unica pantalla que lee
    // datos de TODOS los clientes, asi que su origen tiene que poder quitarse
    // sin tocar el del dashboard. Colgarlo de un `localhost` tampoco servia:
    // esos dos se van el dia de la cookie en produccion.
    "https://ops.devitrak.net",
    "https://admin-testing-dev.netlify.app",
    "https://login.microsoftonline.com/"
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || ACCEPTED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-token",
        // Token de enrolamiento de MFA (login sin MFA, reset de contraseña).
        // Ver middlewares/validateMfaEnrollment.js.
        "x-mfa-setup-token",
        // Token del enlace firmado de los correos (/display-contracts).
        // Ver middlewares/contractLinkAuth.js.
        "x-link-token",
        // Token de sesión de la app del consumidor (app.devitrak.net).
        // Ver helpers/consumerToken.js y middlewares/consumerTokenGate.js.
        "x-consumer-token",
        // Token anti-CSRF de la sesión por cookie (fase 1, SC-23/AC-12). El
        // dashboard ya lo manda detrás de su flag VITE_APP_COOKIE_SESSION; sin
        // esta línea el preflight lo rechaza y el navegador lo reporta como un
        // error `{}` vacío, que no dice nada a nadie.
        "X-CSRF-Token",
        "token",
        // `s-token-lq` retirado el 2026-11-17: el dashboard dejó de mandarlo en
        // su #56 y nada del servidor lo lee (ver middlewares/validate-jwt.js).
        "sqlStaffId",
        "s-company-lq",
        "s-company-id",
        "x-company-id",
        "X-Company-ID",
        // Idempotencia de mutaciones (upload de documento, pagos, etc.) — el
        // frontend manda un UUID por acción; sin esto el preflight CORS rechaza
        // el request (aparece "canceled"/0B en la network tab). Ver FRONTEND_task_queue_changes.md §4.1
        "Idempotency-Key",
        "idempotency-key",
        // Client information headers (both cases for compatibility)
        "User-Agent",
        "Accept-Language",
        "X-Timezone",
        "x-timezone",
        "X-Request-Timestamp",
        "x-request-timestamp",
        "X-Request-ID",
        "x-request-id",
        // IP and proxy headers
        "X-Forwarded-For",
        "x-forwarded-for",
        "X-Real-IP",
        "x-real-ip",
        "X-Client-IP",
        "x-client-ip",
        // Standard headers
        "Accept",
        "Accept-Encoding",
        "Cache-Control",
        "Connection",
        "Host",
        "Origin",
        "Referer"
        // "Cookie",
        // "Set-Cookie",
        // "credentials"
    ],
    /**
     * CABECERAS DE RESPUESTA QUE EL NAVEGADOR PUEDE LEER.
     *
     * CORS deja ver solo siete cabeceras de respuesta sin permiso explicito
     * (Cache-Control, Content-Language, Content-Length, Content-Type, Expires,
     * Last-Modified, Pragma). Cualquier otra existe en el cable y es invisible
     * para el JavaScript que la recibe, salvo que el servidor la nombre aqui.
     *
     * Las del limite de peticiones las venimos mandando desde siempre
     * (`standardHeaders: true` en el limitador global de index.js y en el del
     * asistente), y en ninguno de los dos casos las podia leer nadie: el
     * dashboard vive en admin.devitrak.net y la API en db.devitrak.net, asi que
     * TODA llamada es cross-origin. Lo encontro el agente del dashboard el
     * 2026-11-24 midiendo con curl —que no aplica CORS y por eso las veia— y
     * comparandolo con lo que le llegaba al navegador.
     *
     * Lo que costaba: el cliente sabe que le han limitado, pero no cuando puede
     * volver a intentarlo, asi que tiene que escribir "prueba en un rato" — que
     * es justo la frase que hace que la gente lo reintente de inmediato. El
     * segundo que calculamos no llegaba a la persona que lo estaba esperando.
     *
     * Es global a proposito y no un caso especial de /api/assistant: el limite
     * de 300/15 min afecta a todas las rutas y era igual de ilegible.
     */
    exposedHeaders: [
        // Borradores 6 y 7 del estandar: es lo que escribe express-rate-limit
        // con `standardHeaders: true`, que es como estan los dos limitadores.
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "RateLimit-Policy",
        // Borrador 8: una sola cabecera combinada. Hoy no se emite; nombrarla
        // ahora evita que el dia que el limitador pase a `draft-8` el sintoma
        // reaparezca en silencio y haya que volver a medirlo desde fuera.
        "RateLimit",
        // La manda express-rate-limit en el 429, y es la forma mas directa de
        // las dos de decir cuanto falta.
        "Retry-After"
    ],
    credentials: true,
    maxAge: 84600,
    optionsSuccessStatus: 200
};

module.exports = { corsOptions, ACCEPTED_ORIGINS };