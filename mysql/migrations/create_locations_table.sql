CREATE TABLE IF NOT EXISTS locations (
    location_id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    manager_id INT,
    address_details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('active', 'inactive') DEFAULT 'active',
    INDEX idx_company_id (company_id),
    INDEX idx_manager_id (manager_id)
);

-- Populate locations from existing item_inv
-- using IGNORE to skip duplicates if any race condition, though DISTINCT should handle it
INSERT INTO locations (company_id, location_name)
SELECT DISTINCT company_id, location
FROM item_inv
WHERE location IS NOT NULL AND location != '';

-- Add location_id to item_inv if it doesn't exist
-- Procedure to add column safely
SET @dbname = DATABASE();
SET @tablename = "item_inv";
SET @columnname = "location_id";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE item_inv ADD COLUMN location_id INT"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Index for location_id
SET @indexname = "idx_item_inv_location_id";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_item_inv_location_id ON item_inv(location_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;


-- Update item_inv with location_id
UPDATE item_inv i
JOIN locations l ON i.company_id = l.company_id AND i.location = l.location_name
SET i.location_id = l.location_id
WHERE i.location_id IS NULL;
