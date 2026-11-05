'use strict';

/**
 * Repara el índice `idempotencyKey_1` de la colección `jobs` de la cola de
 * tareas y limpia los valores `null` heredados.
 *
 * PROBLEMA que resuelve (ver DESIGN_task_queue.md § Fase 0):
 * La versión inicial del modelo tenía `idempotencyKey: { default: null }`, así
 * que TODO job sin clave se guardaba con `idempotencyKey: null`. Un índice
 * `unique + sparse` NO ignora los `null` PRESENTES (sparse solo omite el campo
 * ausente) → solo un job sin clave podía existir; el 2do fallaba con:
 *   E11000 duplicate key error ... idempotencyKey_1 dup key: { idempotencyKey: null }
 *
 * El fix de código (models/Job.js sin default + buildNewJob que omite el campo)
 * hace que los jobs NUEVOS no tengan el campo → el índice sparse los ignora.
 * Este script arregla el ESTADO YA EXISTENTE en la DB:
 *   1. Quita el campo idempotencyKey a los docs donde vale null ($unset) → salen
 *      del índice sparse (deja de haber cualquier entrada null).
 *   2. Garantiza que el índice sea exactamente { unique: true, sparse: true };
 *      si existe con otras opciones (ej. no-sparse), lo dropea y recrea.
 *
 * Idempotente y seguro de re-correr. Uso: node scripts/fixJobsIdempotencyIndex.js
 */

if (require.main === module) {
  require("dotenv").config({ quiet: true });
  const mongoose = require("mongoose");

  const MONGO_URI = process.env.DB_CNN;
  if (!MONGO_URI) {
    console.error("ERROR: Variable de entorno DB_CNN no definida.");
    process.exit(1);
  }

  const INDEX_NAME = "idempotencyKey_1";
  const DESIRED = { key: { idempotencyKey: 1 }, unique: true, sparse: true };

  async function run() {
    await mongoose.connect(MONGO_URI);
    console.log("Conectado a MongoDB.");
    const jobs = mongoose.connection.collection("jobs");

    // 1) Limpiar los null heredados (sacarlos del índice sparse).
    const unsetRes = await jobs.updateMany(
      { idempotencyKey: null },
      { $unset: { idempotencyKey: "" } }
    );
    console.log(`Docs con idempotencyKey:null limpiados ($unset): ${unsetRes.modifiedCount}`);

    // 2) Revisar el índice actual y recrearlo solo si hace falta.
    const indexes = await jobs.indexes();
    const current = indexes.find((i) => i.name === INDEX_NAME);

    const isCorrect =
      current && current.unique === true && current.sparse === true;

    if (isCorrect) {
      console.log(`Índice ${INDEX_NAME} ya es unique+sparse. Nada que hacer.`);
    } else {
      if (current) {
        console.log(`Índice ${INDEX_NAME} existe con opciones incorrectas (${JSON.stringify({ unique: current.unique, sparse: current.sparse })}). Dropeando...`);
        await jobs.dropIndex(INDEX_NAME);
      } else {
        console.log(`Índice ${INDEX_NAME} no existe. Creando...`);
      }
      await jobs.createIndex(DESIRED.key, { unique: true, sparse: true, name: INDEX_NAME });
      console.log(`Índice ${INDEX_NAME} creado como unique+sparse.`);
    }

    await mongoose.disconnect();
    console.log("Listo.");
  }

  run().catch((err) => {
    console.error("Falló la reparación:", err.message);
    process.exit(1);
  });
}
