-- platform_audit_log — registro de accesos del console de plataforma.
-- DC2 de FRONTEND_pending_work_asks_2026-11-16.md. AU-2, AU-9, AU-12.
--
-- POR QUE UNA TABLA PROPIA Y NO StaffActivityLog
-- ----------------------------------------------
-- StaffActivityLog se escribe ENCOLADO a proposito (ver su cabecera): si la
-- escritura falla, reintenta en vez de perder la fila. Eso es correcto para el
-- registro de actividad y es exactamente lo contrario de lo que pide este caso,
-- que es FAIL-CLOSED: si no se puede dejar constancia de la lectura, la lectura
-- no se sirve. Los dos comportamientos no caben en el mismo camino de codigo.
--
-- SOLO INSERT, Y POR QUE NO SE PUEDE IMPONER EN ESTA BASE
-- -------------------------------------------------------
-- Ninguna ruta de la aplicacion actualiza ni borra filas de aqui. El unico
-- proceso que borra es el job de retencion (scheduler/platformAuditRetention.js),
-- y borra por antiguedad, nunca por contenido.
--
-- DC2 pedia ademas acotar los permisos del usuario de la aplicacion a INSERT y
-- SELECT sobre esta tabla, que es lo que convertiria "ninguna ruta lo hace" en
-- "la base no lo permite". **Aqui no se puede.** Comprobado en produccion el
-- 2026-11-18: el motor es `8.4.11-Vitess` (PlanetScale), y
-- `SHOW GRANTS FOR CURRENT_USER()` devuelve `vt_app@localhost`, el usuario
-- interno de Vitess y no la identidad real de la aplicacion. Los permisos de
-- PlanetScale se dan por contraseña con roles de ambito (lectura / escritura /
-- admin), no por tabla: "solo INSERT y SELECT sobre platform_audit_log" no es
-- expresable.
--
-- El control compensatorio, mientras tanto, es de codigo y esta probado:
-- test/platformConsoleM1.test.js prohibe que aparezca un UPDATE o un DELETE
-- sobre esta tabla en cualquier sitio que no sea el job de retencion. Es mas
-- debil que un permiso —un permiso lo impone la base, un test lo impone la
-- revision— y por eso APP-2026-015 se queda ABIERTA en vez de cerrarse el dia
-- del despliegue.

CREATE TABLE IF NOT EXISTS platform_audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    -- UTC explicito. DATETIME y no TIMESTAMP: TIMESTAMP convierte segun la zona
    -- de la SESION, asi que la misma fila se leeria distinta desde dos clientes
    -- y una evidencia de auditoria no puede depender de eso. Lo escribe Node en
    -- UTC (helpers/platformAuditLog.js).
    at DATETIME(3) NOT NULL,

    -- Identidad del operador. Sale SIEMPRE del JWT (req.uid), nunca del cuerpo
    -- ni de una cabecera. NULL solo en el caso en que la cuenta ya no existe
    -- cuando se resuelve el gate.
    actor_user_id CHAR(24) NULL,
    actor_email VARCHAR(255) NULL,

    action ENUM('view', 'search', 'export', 'signin', 'access_change') NOT NULL,

    -- La compañia OBJETIVO de la lectura, tal y como la nombro la ruta; NULL en
    -- las busquedas que cruzan compañias y en /me. Hoy es el id de Mongo, que es
    -- con el que el console direcciona una compañia. Si DC3 añade rutas que
    -- direccionen por id de SQL, se añade una columna: no se reutiliza esta para
    -- dos espacios de identificadores distintos.
    company_id VARCHAR(64) NULL,

    -- Que se leyo: el path de la ruta (sin query string; los parametros van en
    -- details). Ej: 'GET /api/platform/companies/:companyId/staff'.
    resource VARCHAR(255) NOT NULL,

    -- Parametros, filtros, pagina, estado HTTP, numero de registros devueltos y
    -- X-Request-ID. Nunca el contenido leido.
    details JSON NULL,

    ip VARCHAR(45) NULL,          -- 45 = IPv6 con prefijo ::ffff: de IPv4
    geo VARCHAR(128) NULL,        -- sin resolver todavia: no hay fuente de geo
    user_agent VARCHAR(512) NULL,

    result ENUM('allowed', 'denied') NOT NULL,

    -- Por que se denego, en vocabulario cerrado del gate ('not_platform_observer',
    -- 'wrong_domain', 'mfa_required', 'inactive_account', 'unknown_account').
    -- NULL cuando result='allowed'.
    reason VARCHAR(64) NULL,

    -- B4: los dos accesos que hara el console (la actividad de UNA compañia, y
    -- el propio historial del operador en /me/access-log), y uno por fecha para
    -- el job de retencion.
    INDEX idx_platform_audit_company_at (company_id, at),
    INDEX idx_platform_audit_actor_at (actor_user_id, at),
    INDEX idx_platform_audit_at (at)
);

-- ---------------------------------------------------------------------------
-- platform_audit_retention — desde cuando una compañia dejo de existir.
--
-- La retencion acordada es "mientras el cliente esta activo, mas 120 dias". El
-- problema: **el sistema no sabe hoy cuando un cliente deja de serlo**. El
-- modelo Company no tiene ni bandera de activo ni fecha de baja a nivel de
-- compañia (lo que si tiene `active` es cada empleado dentro de `employees[]`),
-- asi que no hay ningun instante desde el que contar los 120 dias.
--
-- Sin esa fecha, el contador solo puede arrancar desde lo unico observable: el
-- dia en que el job VIO por primera vez que la compañia ya no esta. Esta tabla
-- guarda ese dia, una fila por compañia. Si la compañia reaparece, la fila se
-- borra y el contador se reinicia.
--
-- Contar en cambio desde la fecha de CADA fila seria incorrecto en el sentido
-- peligroso: a un cliente dado de baja ayer se le borraria hoy mismo todo lo
-- anterior a hace 120 dias, que es justo la evidencia que la regla quiere
-- conservar.
--
-- Cuando el producto tenga una baja de cliente con fecha, el job pasa a usarla y
-- esta tabla sobra. Queda anotado en el POA&M.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_retention (
    company_id VARCHAR(64) NOT NULL PRIMARY KEY,
    first_absent_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
);
