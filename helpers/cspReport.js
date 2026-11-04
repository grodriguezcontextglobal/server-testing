'use strict';

/**
 * Normaliza los informes de violación de CSP de los dos formatos que mandan
 * los navegadores:
 *
 *   - report-uri  (application/csp-report):
 *       { "csp-report": { "document-uri", "violated-directive", ... } }
 *   - report-to   (application/reports+json, Reporting API):
 *       [ { type: "csp-violation", body: { documentURL, effectiveDirective, ... } }, ... ]
 *
 * Devuelve una lista de documentos para models/CspReport.js. Lo que no se
 * reconoce se descarta en silencio: el remitente es un navegador, no hay a
 * quién devolverle un error.
 */

const MAX_REPORTS_PER_REQUEST = 20;
const MAX_FIELD_LENGTH = 2048;

const str = (v) => (typeof v === 'string' && v ? v.slice(0, MAX_FIELD_LENGTH) : undefined);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined);

function fromReportUri(r) {
  return {
    documentUri: str(r['document-uri']),
    violatedDirective: str(r['violated-directive']),
    effectiveDirective: str(r['effective-directive']),
    blockedUri: str(r['blocked-uri']),
    sourceFile: str(r['source-file']),
    lineNumber: num(r['line-number']),
    disposition: str(r.disposition),
  };
}

function fromReportingApi(r) {
  const b = r.body && typeof r.body === 'object' ? r.body : {};
  return {
    documentUri: str(b.documentURL) ?? str(r.url),
    violatedDirective: str(b.violatedDirective) ?? str(b.effectiveDirective),
    effectiveDirective: str(b.effectiveDirective),
    blockedUri: str(b.blockedURL),
    sourceFile: str(b.sourceFile),
    lineNumber: num(b.lineNumber),
    disposition: str(b.disposition),
  };
}

const hasContent = (d) => Boolean(d.documentUri || d.effectiveDirective || d.violatedDirective || d.blockedUri);

function normalizeCspReports(body, userAgent) {
  let docs = [];
  if (Array.isArray(body)) {
    docs = body
      .filter((r) => r && typeof r === 'object' && r.type === 'csp-violation')
      .map(fromReportingApi);
  } else if (body && typeof body === 'object' && body['csp-report'] && typeof body['csp-report'] === 'object') {
    docs = [fromReportUri(body['csp-report'])];
  }
  const ua = str(userAgent);
  return docs
    .filter(hasContent)
    .slice(0, MAX_REPORTS_PER_REQUEST)
    .map((d) => {
      const out = { userAgent: ua };
      for (const [k, v] of Object.entries(d)) if (v !== undefined) out[k] = v;
      return out;
    });
}

module.exports = { normalizeCspReports, MAX_REPORTS_PER_REQUEST, MAX_FIELD_LENGTH };
