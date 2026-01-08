-- Create sub_locations table
CREATE TABLE IF NOT EXISTS sub_locations (
    sub_location_id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id INT DEFAULT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES sub_locations(sub_location_id) ON DELETE CASCADE,
    INDEX idx_location_id (location_id),
    INDEX idx_parent_id (parent_id)
);

-- Add sub_location_id to item_inv if it doesn't exist
SET @dbname = DATABASE();
SET @tablename = "item_inv";
SET @columnname = "sub_location_id";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE item_inv ADD COLUMN sub_location_id INT"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Index for sub_location_id in item_inv
SET @indexname = "idx_item_inv_sub_location_id";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_item_inv_sub_location_id ON item_inv(sub_location_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- Stored Procedure to Migrate JSON Data
DROP PROCEDURE IF EXISTS MigrateSubLocations;

DELIMITER //

CREATE PROCEDURE MigrateSubLocations()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_item_id INT;
    DECLARE v_location_id INT;
    DECLARE v_sub_location_json JSON;
    DECLARE v_array_length INT;
    DECLARE v_i INT;
    DECLARE v_current_name VARCHAR(255);
    DECLARE v_parent_id INT;
    DECLARE v_current_id INT;
    
    -- Cursor to iterate through items with valid sub_location JSON
    DECLARE cur CURSOR FOR 
        SELECT item_id, location_id, sub_location 
        FROM item_inv 
        WHERE location_id IS NOT NULL 
          AND sub_location IS NOT NULL 
          AND JSON_VALID(sub_location) 
          AND JSON_LENGTH(sub_location) > 0;
          
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_item_id, v_location_id, v_sub_location_json;
        IF done THEN
            LEAVE read_loop;
        END IF;

        SET v_array_length = JSON_LENGTH(v_sub_location_json);
        SET v_i = 0;
        SET v_parent_id = NULL;
        
        -- Iterate through the JSON array elements
        WHILE v_i < v_array_length DO
            SET v_current_name = JSON_UNQUOTE(JSON_EXTRACT(v_sub_location_json, CONCAT('$[', v_i, ']')));
            
            -- Check if this sub_location already exists for this location and parent
            SET v_current_id = NULL;
            
            IF v_parent_id IS NULL THEN
                SELECT sub_location_id INTO v_current_id 
                FROM sub_locations 
                WHERE location_id = v_location_id 
                  AND name = v_current_name 
                  AND parent_id IS NULL 
                LIMIT 1;
            ELSE
                SELECT sub_location_id INTO v_current_id 
                FROM sub_locations 
                WHERE location_id = v_location_id 
                  AND name = v_current_name 
                  AND parent_id = v_parent_id 
                LIMIT 1;
            END IF;
            
            -- If not exists, insert it
            IF v_current_id IS NULL THEN
                INSERT INTO sub_locations (location_id, name, parent_id) 
                VALUES (v_location_id, v_current_name, v_parent_id);
                SET v_current_id = LAST_INSERT_ID();
            END IF;
            
            -- Set parent for next iteration
            SET v_parent_id = v_current_id;
            SET v_i = v_i + 1;
        END WHILE;
        
        -- Update item_inv with the leaf sub_location_id
        UPDATE item_inv SET sub_location_id = v_parent_id WHERE item_id = v_item_id;
        
    END LOOP;

    CLOSE cur;
END //

DELIMITER ;

-- Execute the migration
CALL MigrateSubLocations();

-- Optional: Clean up procedure after use if desired, but keeping it might be useful for re-runs (with modifications)
-- DROP PROCEDURE IF EXISTS MigrateSubLocations;
