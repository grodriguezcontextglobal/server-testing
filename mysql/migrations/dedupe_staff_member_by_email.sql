-- ============================================================================
-- A3.2 — Colapsar las filas duplicadas de `staff_member` por email
-- EJECUTADO EN PROD EL 2026-08-18 (pasos 0 a 8). Solo quedan sin correr los
-- dos DROP de las tablas de respaldo, al final.
-- ============================================================================
--
-- PROBLEMA (FRONTEND_school_backend_asks.md § A3.2): un mismo email tiene
-- varias filas en `staff_member`. Eso vuelve ambigua la resolución de
-- `staff_id` y ya provocó que un login con rol scopeado cayera al rol
-- equivocado.
--
-- CAUSA: los caminos de alta hacían un INSERT plano, sin upsert por email.
-- Este script limpia el dato; la causa se cerró en el mismo release volviendo
-- idempotentes esos caminos (ver PASO 8 al final).
--
-- CRITERIO DE CANÓNICO (el que se relevó y confirmó, no el genérico):
--   1. Se queda la fila CON actividad en `staff_event`.
--   2. Si ambas tienen 0, se queda la de `staff_id` más bajo.
--
--   email                            | queda | se borra
--   ---------------------------------+-------+---------
--   cconti@contextglobal.com         |  162  |  163
--   fstarmark@gmail.com              |  177  |  176     (177 tiene 43 eventos)
--   info@garssoftwaresolutions.link  |  160  |  159     (160 tiene 2 eventos)
--   jdow2@invoxia.cc                 |  200  |  198     (200 tiene 1 evento)
--   l.castro.2001@hotmail.com        |  166  |  167
--   luan.xav24@gmail.com             |  168  |  169
--   mlancaster@contextglobal.com     |  173  |  172     (173 tiene 4 eventos)
--   pitons_tasks_2a@icloud.com       |  175  |  174     (175 tiene 17 eventos)
--   president@testing1.com           |  126  |  133
--   testingdevsoftware@gmail.com     |  142  |  150     (142 tiene 5 eventos)
--   tutacastrodossantos@gmail.com    |  170  |  171
--
-- LAS 11 FILAS A BORRAR TIENEN refs_staff_event = 0, así que `staff_event` no
-- necesita repunte. Todas SÍ tienen filas en `company_staff`: esas hay que
-- repuntarlas o borrarlas ANTES de tocar `staff_member`.
--
-- CONTEXTO PlanetScale/Vitess: el DML va con ids explícitos en vez de
-- subconsultas correlacionadas, porque Vitess rechaza parte del DML
-- multi-tabla. Es a propósito, no es verbosidad.
--
-- CORRER PASO POR PASO EN DBEAVER, leyendo el resultado de cada uno.
-- ============================================================================


-- ─── PASO 0 (lectura) · revalidar antes de escribir ─────────────────────────
-- El relevamiento es del 2026-08-18. Si pasó tiempo, confirmar que sigue igual:
-- las 11 filas a borrar deben seguir dando refs_staff_event = 0.

SELECT
    sm.staff_id,
    sm.email,
    (SELECT COUNT(*) FROM company_staff cs WHERE cs.staff_id = sm.staff_id) AS refs_company_staff,
    (SELECT COUNT(*) FROM staff_event  se WHERE se.staff_id = sm.staff_id) AS refs_staff_event
FROM staff_member sm
WHERE sm.staff_id IN (163, 176, 159, 198, 167, 169, 172, 174, 133, 150, 171)
ORDER BY sm.email, sm.staff_id;

-- ⚠️ Si alguna devuelve refs_staff_event > 0, PARAR: esa fila ganó actividad
-- desde el relevamiento y el criterio de canónico cambia para ese email.


-- ─── PASO 1 (escribe) · respaldo ────────────────────────────────────────────
-- Alternativa si PlanetScale bloquea DDL directo: exportar ambas tablas a CSV
-- desde DBeaver (click derecho → Export Data) antes de seguir.

CREATE TABLE staff_member_backup_20260818 LIKE staff_member;
INSERT INTO staff_member_backup_20260818 SELECT * FROM staff_member;

CREATE TABLE company_staff_backup_20260818 LIKE company_staff;
INSERT INTO company_staff_backup_20260818 SELECT * FROM company_staff;

SELECT
    (SELECT COUNT(*) FROM staff_member)                 AS origen_staff_member,
    (SELECT COUNT(*) FROM staff_member_backup_20260818) AS backup_staff_member,
    (SELECT COUNT(*) FROM company_staff)                AS origen_company_staff,
    (SELECT COUNT(*) FROM company_staff_backup_20260818) AS backup_company_staff;


-- ─── PASO 2 (lectura) · colisiones en company_staff ─────────────────────────
-- El duplicado y el canónico pueden estar YA los dos en la misma compañía
-- (por eso el código inserta con INSERT IGNORE). Repuntar esas filas chocaría
-- contra el UNIQUE, así que se borran en vez de repuntarse.
--
-- Los pares 3-3 y 2-2 de refs_company_staff (info@gars, jdow2) son los
-- candidatos obvios a colisionar en todas sus filas.

SELECT
    cs_dup.id         AS company_staff_id_a_borrar,
    cs_dup.company_id,
    cs_dup.staff_id   AS staff_id_duplicado,
    m.canonico        AS staff_id_canonico,
    cs_dup.role_id    AS role_id_que_se_pierde,
    cs_ok.role_id     AS role_id_que_queda,
    cs_dup.is_active  AS activo_duplicado,
    cs_ok.is_active   AS activo_canonico
FROM (
              SELECT 163 AS dup, 162 AS canonico
    UNION ALL SELECT 176, 177
    UNION ALL SELECT 159, 160
    UNION ALL SELECT 198, 200
    UNION ALL SELECT 167, 166
    UNION ALL SELECT 169, 168
    UNION ALL SELECT 172, 173
    UNION ALL SELECT 174, 175
    UNION ALL SELECT 133, 126
    UNION ALL SELECT 150, 142
    UNION ALL SELECT 171, 170
) AS m
JOIN company_staff cs_dup ON cs_dup.staff_id  = m.dup
JOIN company_staff cs_ok  ON cs_ok.staff_id   = m.canonico
                         AND cs_ok.company_id = cs_dup.company_id
ORDER BY cs_dup.staff_id, cs_dup.company_id;

-- ⚠️ COMPARAR `role_id_que_se_pierde` con `role_id_que_queda`. Si difieren, la
-- fila que sobrevive puede tener MENOS permisos que la que se borra — ese es
-- justo el síntoma original ("un login con rol scopeado cayó al rol
-- equivocado"). Corregir el rol del canónico a mano ANTES de borrar:
--   UPDATE company_staff SET role_id = <role_correcto> WHERE id = '<id_canonico>';


-- ─── PASO 3 (escribe) · borrar las filas de company_staff que colisionan ────
-- Pegar acá los `company_staff_id_a_borrar` que devolvió el PASO 2.
-- Si el PASO 2 no devolvió filas, saltear este paso.

-- DELETE FROM company_staff WHERE id IN ('<uuid-1>', '<uuid-2>', ...);


-- ─── PASO 4 (escribe) · repuntar el resto de company_staff al canónico ──────
-- Las filas que NO colisionaban cambian de dueño. Si el PASO 3 borró todas las
-- de un duplicado, su UPDATE simplemente afecta 0 filas — no es error.

UPDATE company_staff SET staff_id = 162 WHERE staff_id = 163;
UPDATE company_staff SET staff_id = 177 WHERE staff_id = 176;
UPDATE company_staff SET staff_id = 160 WHERE staff_id = 159;
UPDATE company_staff SET staff_id = 200 WHERE staff_id = 198;
UPDATE company_staff SET staff_id = 166 WHERE staff_id = 167;
UPDATE company_staff SET staff_id = 168 WHERE staff_id = 169;
UPDATE company_staff SET staff_id = 173 WHERE staff_id = 172;
UPDATE company_staff SET staff_id = 175 WHERE staff_id = 174;
UPDATE company_staff SET staff_id = 126 WHERE staff_id = 133;
UPDATE company_staff SET staff_id = 142 WHERE staff_id = 150;
UPDATE company_staff SET staff_id = 170 WHERE staff_id = 171;


-- ─── PASO 5 (lectura) · confirmar que ya no queda nada colgando ─────────────
-- Las 11 deben dar refs_company_staff = 0 Y refs_staff_event = 0.
-- Es el PASO 0 otra vez: si algo no da 0, NO seguir.

SELECT
    sm.staff_id,
    sm.email,
    (SELECT COUNT(*) FROM company_staff cs WHERE cs.staff_id = sm.staff_id) AS refs_company_staff,
    (SELECT COUNT(*) FROM staff_event  se WHERE se.staff_id = sm.staff_id) AS refs_staff_event
FROM staff_member sm
WHERE sm.staff_id IN (163, 176, 159, 198, 167, 169, 172, 174, 133, 150, 171)
ORDER BY sm.email, sm.staff_id;


-- ─── PASO 6 (escribe) · borrar las 11 filas duplicadas ──────────────────────

DELETE FROM staff_member
WHERE staff_id IN (163, 176, 159, 198, 167, 169, 172, 174, 133, 150, 171);
-- Debe reportar 11 filas afectadas.


-- ─── PASO 7 (lectura) · verificación final ──────────────────────────────────
-- Debe devolver 0 filas.

SELECT email, COUNT(*) AS filas
FROM staff_member
WHERE email IS NOT NULL AND email <> ''
GROUP BY email
HAVING COUNT(*) > 1;

-- Y que los 11 canónicos sigan enteros, con sus membresías y su actividad:
SELECT
    sm.staff_id,
    sm.email,
    (SELECT COUNT(*) FROM company_staff cs WHERE cs.staff_id = sm.staff_id) AS company_staff,
    (SELECT COUNT(*) FROM staff_event  se WHERE se.staff_id = sm.staff_id) AS staff_event
FROM staff_member sm
WHERE sm.staff_id IN (162, 177, 160, 200, 166, 168, 173, 175, 126, 142, 170)
ORDER BY sm.email;


-- ─── PASO 8 · cerrar la puerta ─────────────────────── ✅ APLICADO 2026-08-18
-- Con los datos limpios, el UNIQUE impide que el INSERT plano del controller
-- vuelva a duplicar.

ALTER TABLE staff_member ADD UNIQUE KEY uq_staff_member_email (email);

-- Los tres caminos de escritura que ese índice rompía ya son idempotentes por
-- email (ask #1 de A3.2, mismo release):
--   · mysql/controllers/staff.js  → insertingStaffMember (POST /new_member):
--     devuelve 200 + created:false reutilizando el staff_id existente.
--   · controller/registration.js  → upsertStaffMemberSQL, usado por los 3
--     call-sites (registro nuevo, usuario existente + empresa nueva,
--     aceptación de invitación).
-- Ambos atrapan el 1062 y releen, para la carrera de dos requests con el mismo
-- email que pasan el SELECT a la vez.
--
-- ⚠️ PENDIENTE: seed/seed-school-demo.js y seed/seed-school-demo-rich.js
-- siguen con INSERT plano. Solo afecta re-correr los seeds sobre una base que
-- ya los tiene — fallan con 1062 en vez de duplicar.


-- ─── LIMPIEZA (después de unos días sin incidentes) ─────────────────────────
-- DROP TABLE staff_member_backup_20260818;
-- DROP TABLE company_staff_backup_20260818;
