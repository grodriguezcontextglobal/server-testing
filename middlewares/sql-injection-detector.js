const logger = require("../helpers/logger");

// Basic regex to detect common SQL injection patterns. 
// This is not exhaustive but covers many common, simple attacks.
const sqlInjectionPattern = new RegExp(
    // Common SQL keywords that are suspicious in user input
    "\\b(ALTER|CREATE|DELETE|DROP|EXEC|INSERT|MERGE|SELECT|UPDATE|UNION)\\b" +
    // SQL comment characters
    "|(--|#|\\/\\*)" +
    // Common function calls that can be abused
    "|\\b(CHAR|CONCAT|CAST|DECLARE)\\b" +
    // Simple tautology
    "|('|\"|\\s)*(OR|and)\\s*('|\")?(\\d+|[a-zA-Z]+)('|\")?\s*=\s*('|\")?(\\d+|[a-zA-Z]+)",
    "i"
);

const hasSqlInjection = (value) => {
    if (typeof value !== 'string') {
        return false;
    }
    return sqlInjectionPattern.test(value);
};

const checkObjectForSqlInjection = (obj, path = []) => {
    if (obj === null || typeof obj !== 'object') {
        return null;
    }

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            const currentPath = [...path, key];

            if (typeof value === 'object') {
                const result = checkObjectForSqlInjection(value, currentPath);
                if (result) return result; // Return the first finding
            } else {
                if (hasSqlInjection(value)) {
                    return { path: currentPath.join('.'), value };
                }
            }
        }
    }
    return null;
};

const sqlInjectionDetector = (req, res, next) => {
    const sources = {
        body: req.body,
        query: req.query,
        params: req.params
    };

    for (const [sourceName, sourceObject] of Object.entries(sources)) {
        const suspiciousFinding = checkObjectForSqlInjection(sourceObject);
        if (suspiciousFinding) {
            logger.warn("Potential SQL injection attempt detected", {
                source: sourceName,
                path: suspiciousFinding.path,
                value: suspiciousFinding.value,
                requestPath: req.path,
                ip: req.ip
            });
            // For now, we only log. To block requests, you could uncomment the following line:
            // return res.status(403).json({ ok: false, message: "Invalid input detected." });
        }
    }

    next();
};

module.exports = {
    sqlInjectionDetector,
};