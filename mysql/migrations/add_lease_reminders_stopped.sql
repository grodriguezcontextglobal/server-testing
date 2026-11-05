-- Recordatorios de vencido: permitir que el staff los detenga desde el dashboard.
-- NULL = recordatorios activos. El scheduler (scheduler/overdueReminders.js)
-- filtra `reminders_stopped_at IS NULL`, asi que esta migracion va ANTES del
-- deploy del codigo: sin la columna el cron de las 8am falla con 1054.
ALTER TABLE member_assigned_device_lease
  ADD COLUMN reminders_stopped_at DATETIME DEFAULT NULL,
  ADD COLUMN reminders_stopped_by VARCHAR(64) DEFAULT NULL;
