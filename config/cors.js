const ACCEPTED_ORIGINS = [
    "http://localhost:5522",
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
        "token",
        "Cookie",
        "Set-Cookie",
        "credentials"
    ],
    credentials: true,
    maxAge: 84600,
    optionsSuccessStatus: 200
};

module.exports = { corsOptions, ACCEPTED_ORIGINS };