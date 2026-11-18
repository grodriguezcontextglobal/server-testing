-- platform_audit_actor_retention — retencion de las filas SIN compañia.
-- Respuesta a O3 (FRONTEND_console_m1_accepted_2026-11-19.md §3). AU-11.
--
-- EL HUECO QUE CIERRA
-- -------------------
-- `platform_audit_retention` ancla la retencion de cada fila a SU COMPAÑIA:
-- cliente presente -> no se borra; cliente ausente 120 dias -> se borra. Eso
-- deja fuera las filas con `company_id IS NULL`, que no son pocas ni raras: las
-- busquedas que cruzan clientes, `/api/platform/me` y los `signin` de los
-- operadores. Hasta hoy no caducaban nunca, y el job lo decia en cada vuelta
-- para que no se convirtiera en permanente por descuido.
--
-- LA REGLA ACORDADA CON EL DASHBOARD: esas filas se anclan al OPERADOR en vez
-- de a la compañia — cuenta activa, mas 120 dias. Misma forma que la regla de
-- cliente, con otro sujeto, para que la retencion de la tabla entera se pueda
-- explicar a un evaluador en una frase.
--
-- Las dos alternativas y por que no:
--   - Horizonte fijo (borrar a los 120 dias de la fila): simple, pero borra
--     filas de un operador que sigue en activo, que es justo de quien conviene
--     tener historial.
--   - No borrar nunca: compra trazabilidad a cambio de minimizacion de datos.
--     Para registros de acceso privilegiado esa es la posicion dificil de
--     defender, no la facil.
--
-- POR QUE UNA TABLA Y NO UNA COLUMNA EN LA OTRA
-- ---------------------------------------------
-- `platform_audit_retention` tiene `company_id` como clave primaria. Meterle un
-- sujeto de otro tipo obligaria a cambiar la PK de una tabla ya desplegada en
-- PlanetScale. El sujeto es distinto, la clave es distinta: dos tablas.
--
-- QUE SE OBSERVA, igual que con las compañias: no hay "fecha de baja" de una
-- cuenta. Lo observable es `active === false` o que la cuenta ya no este. El
-- contador arranca el dia en que el job lo VE por primera vez, y se reinicia si
-- la cuenta vuelve a estar activa.
--
-- FILAS SIN COMPAÑIA Y SIN OPERADOR no existen hoy —el gate no escribe fila
-- para una peticion sin sesion, a proposito— pero si apareciera alguna no tiene
-- ancla posible: no se borra y el job la cuenta aparte en cada vuelta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_actor_retention (
    actor_user_id CHAR(24) NOT NULL PRIMARY KEY,
    first_absent_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
);
