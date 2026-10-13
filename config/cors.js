const ACCEPTED_ORIGINS = [
    "http://localhost:5522",
    "http://localhost:5523", // local Cypress/test instance
    "https://devitrak-app-survey.pages.dev",
    "http://localhost:3791",
    "https://admin.devitrak.net",
    "https://app.devitrak.net",
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
        "token",
        "s-token-lq",
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
    credentials: true,
    maxAge: 84600,
    optionsSuccessStatus: 200
};

module.exports = { corsOptions, ACCEPTED_ORIGINS };