package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// BulkItemRequest matches the Node.js request body
type BulkItemRequest struct {
	CategoryName        string      `json:"category_name"`
	ItemGroup           string      `json:"item_group"`
	Cost                interface{} `json:"cost"` // Can be string or number
	Brand               string      `json:"brand"`
	DescriptItem        string      `json:"descript_item"`
	Ownership           string      `json:"ownership"`
	MinSerialNumber     string      `json:"min_serial_number"`
	MaxSerialNumber     string      `json:"max_serial_number"`
	Warehouse           int         `json:"warehouse"`
	MainWarehouse       int         `json:"main_warehouse"`
	CreatedAt           string      `json:"created_at"`
	UpdateAt            string      `json:"update_at"`
	Company             string      `json:"company"`
	Location            string      `json:"location"`
	CurrentLocation     string      `json:"current_location"`
	SubLocation         string      `json:"sub_location"`
	ExtraSerialNumber   string      `json:"extra_serial_number"`
	CompanyID           string      `json:"company_id"`
	ReturnDate          string      `json:"return_date"`
	ReturnedRentedInfo  string      `json:"returnedRentedInfo"`
	Container           interface{} `json:"container"` // bool or int
	ContainerSpotLimit  interface{} `json:"containerSpotLimit"`
	ContainerID         string      `json:"containerId"`
	DisplayItem         int         `json:"display_item"`
	EnableAssignFeature int         `json:"enableAssignFeature"`
	ImageURL            string      `json:"image_url"`
	SupplierInfo        string      `json:"supplier_info"`
}

// BulkItemAlphaRequest matches the Alphanumeric bulk insert request
type BulkItemAlphaRequest struct {
	CategoryName        string      `json:"category_name"`
	ItemGroup           string      `json:"item_group"`
	Cost                interface{} `json:"cost"`
	Brand               string      `json:"brand"`
	DescriptItem        string      `json:"descript_item"`
	Ownership           string      `json:"ownership"`
	List                []string    `json:"list"` // Array of serial numbers
	Warehouse           int         `json:"warehouse"`
	MainWarehouse       int         `json:"main_warehouse"`
	CreatedAt           string      `json:"created_at"`
	UpdateAt            string      `json:"update_at"`
	Company             string      `json:"company"`
	Location            string      `json:"location"`
	CurrentLocation     string      `json:"current_location"`
	SubLocation         string      `json:"sub_location"`
	ExtraSerialNumber   string      `json:"extra_serial_number"`
	CompanyID           string      `json:"company_id"`
	ReturnDate          string      `json:"return_date"`
	ReturnedRentedInfo  string      `json:"returnedRentedInfo"`
	Container           interface{} `json:"container"`
	ContainerSpotLimit  interface{} `json:"containerSpotLimit"`
	ContainerID         string      `json:"containerId"`
	DisplayItem         int         `json:"display_item"`
	EnableAssignFeature int         `json:"enableAssignFeature"`
	ImageURL            string      `json:"image_url"`
	SupplierInfo        string      `json:"supplier_info"`
}

// InsertDeviceDirectlyRequest matches the Node.js request body
type InsertDeviceDirectlyRequest struct {
	ItemID  interface{} `json:"item_id"`  // Can be string or int
	EventID string      `json:"event_id"` // Assuming string
}

// InsertDeviceInEventDirectly handles single item insert
func InsertDeviceInEventDirectly(db *sql.DB, req InsertDeviceDirectlyRequest) (int64, error) {
	LogInfo("Starting InsertDeviceInEventDirectly", map[string]interface{}{
		"item_id":  req.ItemID,
		"event_id": req.EventID,
	})

	query := `INSERT INTO item_inv_assigned_event (item_id, event_id) VALUES (?, ?)`

	// Handle ItemID being potentially a json.Number or float64 or string
	var itemID interface{} = req.ItemID
	// If it's a json.Number, convert to string or int64 depending on what driver expects.
	// MySQL driver often handles string for numbers.
	if val, ok := req.ItemID.(json.Number); ok {
		itemID = val.String()
	}

	res, err := db.Exec(query, itemID, req.EventID)
	if err != nil {
		LogError("Failed to insert device directly", err, nil)
		return 0, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return id, nil
}

// InsertDeviceFromContainerRequest matches the Node.js request body
type InsertDeviceFromContainerRequest struct {
	EventID     string                   `json:"event_id"`
	RefDatabase []map[string]interface{} `json:"refDatabase"`
}

// InsertDeviceInEventDirectlyFromContainer handles bulk insert from container
func InsertDeviceInEventDirectlyFromContainer(db *sql.DB, req InsertDeviceFromContainerRequest) error {
	LogInfo("Starting InsertDeviceInEventDirectlyFromContainer", map[string]interface{}{
		"event_id":   req.EventID,
		"item_count": len(req.RefDatabase),
	})

	if len(req.RefDatabase) == 0 {
		return nil
	}

	query := `INSERT INTO item_inv_assigned_event (item_id, event_id) VALUES `
	var values []interface{}
	var placeholders []string

	batchSize := 1000
	currentBatch := 0

	for _, item := range req.RefDatabase {
		itemID := item["item_id"]
		placeholders = append(placeholders, "(?, ?)")
		values = append(values, itemID, req.EventID)

		currentBatch++
		if currentBatch >= batchSize {
			stmt := query + strings.Join(placeholders, ",")
			_, err := db.Exec(stmt, values...)
			if err != nil {
				return err
			}
			placeholders = nil
			values = nil
			currentBatch = 0
		}
	}

	if currentBatch > 0 {
		stmt := query + strings.Join(placeholders, ",")
		_, err := db.Exec(stmt, values...)
		if err != nil {
			return err
		}
	}

	return nil
}

// InsertItemEventRequest matches the Node.js request body
type InsertItemEventRequest struct {
	EventID      string   `json:"event_id"`
	ItemGroup    string   `json:"item_group"`
	CategoryName string   `json:"category_name"`
	CompanyID    string   `json:"company_id"`
	Data         []string `json:"data"` // Array of serial numbers
}

// InsertItemInEvent handles bulk insert of items into an event
// Returns: totalInserted, totalItemsFound, error
func InsertItemInEvent(db *sql.DB, req InsertItemEventRequest) (int64, int, error) {
	LogInfo("Starting InsertItemInEvent", map[string]interface{}{
		"event_id":   req.EventID,
		"item_group": req.ItemGroup,
		"item_count": len(req.Data),
	})

	// 1. Find item IDs matching the criteria
	if len(req.Data) == 0 {
		return 0, 0, nil
	}

	// Prepare placeholders for IN clause
	placeholders := make([]string, len(req.Data))
	args := make([]interface{}, len(req.Data)+3)
	args[0] = req.ItemGroup
	args[1] = req.CategoryName
	args[2] = req.CompanyID

	for i, serial := range req.Data {
		placeholders[i] = "?"
		args[i+3] = serial
	}

	query := fmt.Sprintf(`
		SELECT item_id 
		FROM item_inv 
		WHERE item_group = ? 
		  AND category_name = ? 
		  AND company_id = ? 
		  AND serial_number IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		LogError("Failed to query item IDs", err, nil)
		return 0, 0, err
	}
	defer rows.Close()

	var itemIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			LogError("Failed to scan item ID", err, nil)
			continue
		}
		itemIDs = append(itemIDs, id)
	}

	if len(itemIDs) == 0 {
		return 0, 0, nil
	}

	// 2. Insert into item_inv_assigned_event
	// We'll use a transaction for safety, though not strictly required if we just want bulk insert
	tx, err := db.Begin()
	if err != nil {
		return 0, len(itemIDs), err
	}
	defer tx.Rollback()

	// Bulk insert syntax: INSERT INTO ... VALUES (?, ?), (?, ?), ...
	insertQuery := "INSERT INTO item_inv_assigned_event (event_id, item_id) VALUES "
	insertArgs := make([]interface{}, 0, len(itemIDs)*2)
	var valueStrings []string

	for _, id := range itemIDs {
		valueStrings = append(valueStrings, "(?, ?)")
		insertArgs = append(insertArgs, req.EventID, id)
	}

	insertQuery += strings.Join(valueStrings, ",")

	res, err := tx.Exec(insertQuery, insertArgs...)
	if err != nil {
		LogError("Failed to bulk insert items into event", err, nil)
		return 0, len(itemIDs), err
	}

	totalInserted, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, len(itemIDs), err
	}

	LogInfo("InsertItemInEvent completed", map[string]interface{}{
		"found":    len(itemIDs),
		"inserted": totalInserted,
	})

	return totalInserted, len(itemIDs), nil
}

// InsertBulkItem handles the bulk insertion of items
func InsertBulkItem(db *sql.DB, req BulkItemRequest) error {
	LogInfo("Starting InsertBulkItem", map[string]interface{}{
		"category":   req.CategoryName,
		"item_group": req.ItemGroup,
		"min_serial": req.MinSerialNumber,
		"max_serial": req.MaxSerialNumber,
	})

	minSerial, err := strconv.ParseInt(req.MinSerialNumber, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid min_serial_number: %v", err)
	}
	maxSerial, err := strconv.ParseInt(req.MaxSerialNumber, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid max_serial_number: %v", err)
	}

	if minSerial > maxSerial {
		return fmt.Errorf("min_serial_number cannot be greater than max_serial_number")
	}

	// Prepare the query
	query := `
		INSERT INTO item_inv (
			category_name, item_group, cost, brand, descript_item, ownership,
			serial_number, warehouse, main_warehouse, create_at, update_at,
			company, location, current_location, sub_location, extra_serial_number,
			company_id, return_date, returnedRentedInfo, container, containerSpotLimit,
			container_id, display_item, enableAssignFeature, image_url, supplier_info
		) VALUES `

	var values []interface{}
	var placeholders []string

	// Assuming returnedRentedInfo and container_id are JSON strings or defaults
	returnedRentedInfo := "[]"
	containerID := "[]"
	displayItem := 1
	enableAssignFeature := 1

	// Loop to generate values
	// Optimization: Batch inserts if range is very large (e.g., > 1000)
	// For now, assuming reasonable range as per Node.js logic
	batchSize := 1000
	currentBatch := 0

	for i := minSerial; i <= maxSerial; i++ {
		serialStr := fmt.Sprintf("%0*d", len(req.MinSerialNumber), i)

		placeholders = append(placeholders, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		values = append(values,
			req.CategoryName, req.ItemGroup, req.Cost, req.Brand, req.DescriptItem, req.Ownership,
			serialStr, req.Warehouse, req.MainWarehouse, req.CreatedAt, req.UpdateAt,
			req.Company, req.Location, req.CurrentLocation, req.SubLocation, req.ExtraSerialNumber,
			req.CompanyID, req.ReturnDate, returnedRentedInfo, req.Container, req.ContainerSpotLimit,
			containerID, displayItem, enableAssignFeature, req.ImageURL, req.SupplierInfo,
		)

		currentBatch++
		if currentBatch >= batchSize {
			stmt := query + strings.Join(placeholders, ",")
			_, err := db.Exec(stmt, values...)
			if err != nil {
				return err
			}
			// Reset
			placeholders = nil
			values = nil
			currentBatch = 0
		}
	}

	// Insert remaining
	if currentBatch > 0 {
		stmt := query + strings.Join(placeholders, ",")
		_, err := db.Exec(stmt, values...)
		if err != nil {
			return err
		}
	}

	return nil
}

// InsertBulkItemAlpha handles alphanumeric bulk insertion
func InsertBulkItemAlpha(db *sql.DB, req BulkItemAlphaRequest) error {
	LogInfo("Starting InsertBulkItemAlpha", map[string]interface{}{
		"category":   req.CategoryName,
		"item_group": req.ItemGroup,
		"count":      len(req.List),
	})

	if len(req.List) == 0 {
		return fmt.Errorf("no serial numbers provided")
	}

	query := `
		INSERT INTO item_inv (
			category_name, item_group, cost, brand, descript_item, ownership,
			serial_number, warehouse, main_warehouse, create_at, update_at,
			company, location, current_location, sub_location, extra_serial_number,
			company_id, return_date, returnedRentedInfo, container, containerSpotLimit,
			container_id, display_item, enableAssignFeature, image_url, supplier_info
		) VALUES `

	returnedRentedInfo := "[]"
	containerID := "[]"
	displayItem := 1
	enableAssignFeature := 1

	batchSize := 1000
	var values []interface{}
	var placeholders []string

	for i, serial := range req.List {
		placeholders = append(placeholders, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		values = append(values,
			req.CategoryName, req.ItemGroup, req.Cost, req.Brand, req.DescriptItem, req.Ownership,
			serial, req.Warehouse, req.MainWarehouse, req.CreatedAt, req.UpdateAt,
			req.Company, req.Location, req.CurrentLocation, req.SubLocation, req.ExtraSerialNumber,
			req.CompanyID, req.ReturnDate, returnedRentedInfo, req.Container, req.ContainerSpotLimit,
			containerID, displayItem, enableAssignFeature, req.ImageURL, req.SupplierInfo,
		)

		if (i+1)%batchSize == 0 {
			stmt := query + strings.Join(placeholders, ",")
			_, err := db.Exec(stmt, values...)
			if err != nil {
				return err
			}
			placeholders = nil
			values = nil
		}
	}

	if len(values) > 0 {
		stmt := query + strings.Join(placeholders, ",")
		_, err := db.Exec(stmt, values...)
		if err != nil {
			return err
		}
	}

	return nil
}

// RetrieveItemDataRequest matches the input for retrieving item data
type RetrieveItemDataRequest struct {
	CompanyID interface{} `json:"company_id"`
	Locations []string    `json:"locations"`
}

type GroupStats struct {
	TotalAvailable int `json:"totalAvailable"`
	Total          int `json:"total"`
}

type GroupedData struct {
	CategoryName map[string]GroupStats `json:"category_name"`
	ItemGroup    map[string]GroupStats `json:"item_group"`
	Brand        map[string]GroupStats `json:"brand"`
	Ownership    map[string]GroupStats `json:"ownership"`
}

// RetrieveItemData fetches and aggregates item data
func RetrieveItemData(db *sql.DB, req RetrieveItemDataRequest) (int, int, GroupedData, error) {
	var companyID string
	switch v := req.CompanyID.(type) {
	case string:
		companyID = v
	case float64:
		companyID = fmt.Sprintf("%.0f", v)
	case int:
		companyID = strconv.Itoa(v)
	default:
		// Fallback or error, but let's try string conversion just in case
		companyID = fmt.Sprintf("%v", v)
	}

	query := `
      SELECT 
        category_name, item_group, brand, ownership, warehouse
      FROM item_inv
      WHERE company_id = ?
    `

	args := []interface{}{companyID}

	if len(req.Locations) > 0 {
		placeholders := make([]string, len(req.Locations))
		for i, loc := range req.Locations {
			placeholders[i] = "?"
			args = append(args, loc)
		}
		query += fmt.Sprintf(" AND location IN (%s)", strings.Join(placeholders, ","))
	}
	fmt.Println("query:", query)
	fmt.Println("args:", args)
	rows, err := db.Query(query, args...)
	if err != nil {
		return 0, 0, GroupedData{}, err
	}
	defer rows.Close()

	// Use pointers or sql.NullString if fields can be null.
	// Assuming they are not null based on typical usage, but let's be safe with standard scanning.
	// If any of these are NULL in DB, Scan will fail if we use string.
	// Node.js driver handles NULLs gracefully.
	// Let's use sql.NullString for safety or assume strings.
	// Given the table schema inferred from inserts, they seem to be strings.

	var categoryName, itemGroup, brand, ownership string
	var warehouse int

	total := 0
	totalAvailable := 0

	gd := GroupedData{
		CategoryName: make(map[string]GroupStats),
		ItemGroup:    make(map[string]GroupStats),
		Brand:        make(map[string]GroupStats),
		Ownership:    make(map[string]GroupStats),
	}

	for rows.Next() {
		if err := rows.Scan(&categoryName, &itemGroup, &brand, &ownership, &warehouse); err != nil {
			return 0, 0, GroupedData{}, err
		}

		total++
		if warehouse == 1 {
			totalAvailable++
		}

		updateStats(gd.CategoryName, categoryName, warehouse)
		updateStats(gd.ItemGroup, itemGroup, warehouse)
		updateStats(gd.Brand, brand, warehouse)
		updateStats(gd.Ownership, ownership, warehouse)
	}

	return total, totalAvailable, gd, nil
}

func updateStats(m map[string]GroupStats, key string, warehouse int) {
	stats := m[key]
	stats.Total++
	if warehouse == 1 {
		stats.TotalAvailable++
	}
	m[key] = stats
}

// ItemFinalStatusRequest matches the request for ItemFinalStatusWhenEventIsFinished
type ItemFinalStatusRequest struct {
	GroupingDevicesFromNoSQL string `json:"groupingDevicesFromNoSQL"` // JSON string
	AllInventoryOfEvent      string `json:"allInventoryOfEvent"`      // JSON string
	EventID                  string `json:"eventId"`
	UpdateAt                 string `json:"update_at"`
}

// DeviceStatusHistory represents the device history from NoSQL
type DeviceStatusHistory struct {
	Status string `json:"status"`
}

// SimpleInventoryItem represents the minimal item structure we parse
type SimpleInventoryItem struct {
	SerialNumber string `json:"serial_number"`
	Status       string `json:"status"`
}

// ItemFinalStatusWhenEventIsFinished handles bulk status updates for event completion
func ItemFinalStatusWhenEventIsFinished(db *sql.DB, req ItemFinalStatusRequest) (int64, error) {
	// Parse the inner JSON strings
	var groupingDevices map[string][]DeviceStatusHistory
	if err := json.Unmarshal([]byte(req.GroupingDevicesFromNoSQL), &groupingDevices); err != nil {
		return 0, fmt.Errorf("failed to parse groupingDevicesFromNoSQL: %v", err)
	}

	var allInventory []SimpleInventoryItem
	if err := json.Unmarshal([]byte(req.AllInventoryOfEvent), &allInventory); err != nil {
		return 0, fmt.Errorf("failed to parse allInventoryOfEvent: %v", err)
	}

	if len(allInventory) == 0 {
		return 0, nil
	}

	batchSize := 500
	totalAffectedRows := int64(0)

	for i := 0; i < len(allInventory); i += batchSize {
		end := i + batchSize
		if end > len(allInventory) {
			end = len(allInventory)
		}
		batch := allInventory[i:end]

		// Build CASE statements
		var caseParts []string
		var values []interface{}
		var serialNumbers []string

		// Add CASE values
		for _, item := range batch {
			status := item.Status
			// Check if exists in groupingDevices and has history
			if history, ok := groupingDevices[item.SerialNumber]; ok && len(history) > 0 {
				status = history[len(history)-1].Status
			}

			caseParts = append(caseParts, "WHEN serial_number = ? THEN ?")
			values = append(values, item.SerialNumber, status)
			serialNumbers = append(serialNumbers, item.SerialNumber)
		}

		// Add update_at and active = false
		values = append(values, req.UpdateAt)

		// Add WHERE clause params
		values = append(values, req.EventID)
		for _, sn := range serialNumbers {
			values = append(values, sn)
		}

		placeholders := make([]string, len(serialNumbers))
		for j := range placeholders {
			placeholders[j] = "?"
		}

		query := fmt.Sprintf(`
			UPDATE item_inv_assigned_event iiae
			JOIN item_inv ii ON iiae.item_id = ii.item_id
			SET 
				iiae.status = CASE ii.serial_number 
					%s 
					ELSE iiae.status 
				END,
				iiae.condition = CASE ii.serial_number 
					%s 
					ELSE iiae.condition 
				END,
				iiae.updated_at = ?,
				active = false
			WHERE 
				iiae.event_id = ? AND
				ii.serial_number IN (%s)
		`, strings.Join(caseParts, " "), strings.Join(caseParts, " "), strings.Join(placeholders, ", "))

		res, err := db.Exec(query, values...)
		// Note: we are duplicating values for the second CASE statement in the query string logic above
		// Wait, the values slice needs to match the placeholders order.
		// My construction above:
		// values: [sn1, stat1, sn2, stat2, ..., update_at, event_id, sn1, sn2, ...]
		// Query:
		// CASE ii.serial_number WHEN ? THEN ? ...
		// CASE ii.serial_number WHEN ? THEN ? ...
		//
		// The second CASE block needs its own set of values if I use ? placeholders again!
		//
		// Correct approach: duplicating the [sn, status] pairs in the values slice is required if I repeat the placeholders.

		// Let's reconstruct values to match exactly:
		// 1. First CASE: [sn, stat, sn, stat...]
		// 2. Second CASE: [sn, stat, sn, stat...]
		// 3. update_at
		// 4. event_id
		// 5. IN clause: [sn, sn...]

		finalValues := []interface{}{}

		// 1. First CASE
		for _, item := range batch {
			status := item.Status
			if history, ok := groupingDevices[item.SerialNumber]; ok && len(history) > 0 {
				status = history[len(history)-1].Status
			}
			finalValues = append(finalValues, item.SerialNumber, status)
		}

		// 2. Second CASE (same values)
		for _, item := range batch {
			status := item.Status
			if history, ok := groupingDevices[item.SerialNumber]; ok && len(history) > 0 {
				status = history[len(history)-1].Status
			}
			finalValues = append(finalValues, item.SerialNumber, status)
		}

		finalValues = append(finalValues, req.UpdateAt, req.EventID)
		for _, sn := range serialNumbers {
			finalValues = append(finalValues, sn)
		}

		if err != nil {
			// If construction failed before exec? No, strict strings.Join
		}

		res, err = db.Exec(query, finalValues...)
		if err != nil {
			return totalAffectedRows, err
		}

		affected, _ := res.RowsAffected()
		totalAffectedRows += affected
	}

	return totalAffectedRows, nil
}

// CheckItemRequest matches the Node.js request body for checking items
type CheckItemRequest struct {
	Filters   map[string]interface{} `json:"filters"`
	Locations []string               `json:"locations"`
}

// CheckItem handles dynamic filtering of items
func CheckItem(db *sql.DB, req CheckItemRequest) ([]map[string]interface{}, error) {
	fmt.Printf("CheckItem Payload: %+v\n", req)
	// Start with base query
	query := "SELECT * FROM item_inv WHERE 1=1"
	var args []interface{}
	var conditions []string

	// Process filters
	for key, value := range req.Filters {
		// Prevent SQL injection by allowing only alphanumeric keys (and underscores)
		// This is a basic check. For strict security, use a whitelist of allowed columns.
		if !isValidColumnName(key) {
			return nil, fmt.Errorf("invalid column name: %s", key)
		}

		conditions = append(conditions, fmt.Sprintf("%s = ?", key))

		// Handle different types for value
		var strVal string
		switch v := value.(type) {
		case string:
			strVal = v
		case float64:
			strVal = fmt.Sprintf("%.0f", v)
		case int:
			strVal = strconv.Itoa(v)
		case bool:
			strVal = fmt.Sprintf("%t", v)
		default:
			strVal = fmt.Sprintf("%v", v)
		}
		args = append(args, strVal)
	}

	if len(req.Locations) > 0 {
		placeholders := make([]string, len(req.Locations))
		for i, loc := range req.Locations {
			placeholders[i] = "?"
			args = append(args, loc)
		}
		conditions = append(conditions, fmt.Sprintf("location IN (%s)", strings.Join(placeholders, ",")))
	}

	if len(conditions) > 0 {
		query += " AND " + strings.Join(conditions, " AND ")
	}

	LogInfo("Executing CheckItem query", map[string]interface{}{
		"query": query,
		"args":  args,
	})

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRowsToMap(rows)
}

// InventoryCurrentStateRequest matches request for checking inventory current state
type InventoryCurrentStateRequest struct {
	CompanyID interface{} `json:"company_id"`
	Locations []string    `json:"locations"`
}

// CheckingInventoryCurrentState handles the complex join query for inventory state
func CheckingInventoryCurrentState(db *sql.DB, req InventoryCurrentStateRequest) ([]map[string]interface{}, error) {
	fmt.Printf("CheckingInventoryCurrentState Payload: %+v\n", req)
	var companyID string
	switch v := req.CompanyID.(type) {
	case string:
		companyID = v
	case float64:
		companyID = fmt.Sprintf("%.0f", v)
	case int:
		companyID = strconv.Itoa(v)
	case nil:
		return nil, fmt.Errorf("company_id is required")
	default:
		return nil, fmt.Errorf("invalid type for company_id: %T", v)
	}

	if companyID == "" {
		return nil, fmt.Errorf("company_id is required")
	}

	query := `
    SELECT ii.* , iiae.status, iiae.condition, ei.*
    FROM item_inv ii
    LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
    LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
    WHERE ii.company_id = ?
    `
	args := []interface{}{companyID}

	if len(req.Locations) > 0 {
		placeholders := make([]string, len(req.Locations))
		for i, loc := range req.Locations {
			placeholders[i] = "?"
			args = append(args, loc)
		}
		query += fmt.Sprintf(" AND ii.location IN (%s)", strings.Join(placeholders, ","))
	}

	query += " ORDER by iiae.event_id DESC"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRowsToMap(rows)
}

// Helper to validate column names to prevent SQL injection in dynamic queries
func isValidColumnName(col string) bool {
	// Allow a-z, A-Z, 0-9, _
	for _, r := range col {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_') {
			return false
		}
	}
	return true
}

// Helper to scan arbitrary rows into a map slice
func scanRowsToMap(rows *sql.Rows) ([]map[string]interface{}, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var results []map[string]interface{}

	for rows.Next() {
		// Create a slice of interface{} to hold values
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		// Scan the result into the column pointers
		if err := rows.Scan(columnPointers...); err != nil {
			return nil, err
		}

		// Create our map, and retrieve all the values
		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})

			// Handle raw bytes (MySQL often returns text/blobs as []byte)
			if val != nil {
				v := *val
				if b, ok := v.([]byte); ok {
					m[colName] = string(b)
				} else {
					m[colName] = v
				}
			} else {
				m[colName] = nil
			}
		}
		results = append(results, m)
	}
	return results, nil
}

// ReturningItemRequest matches the request for ReturningItemToStockWhenEventIsFinished
type ReturningItemRequest struct {
	GroupingDevicesFromNoSQL string `json:"groupingDevicesFromNoSQL"` // JSON string
	AllInventoryOfEvent      string `json:"allInventoryOfEvent"`      // JSON string
	CompanyID                string `json:"companyId"`
	UpdateAt                 string `json:"update_at"`
}

// HierarchyNode represents a node in the inventory hierarchy
type HierarchyNode struct {
	Total     int                       `json:"total"`
	Available int                       `json:"available"`
	Types     []string                  `json:"types"`
	Children  map[string]*HierarchyNode `json:"children"`
}

// GetInventoryHierarchyRequest matches the request for GetInventoryHierarchyWithTypes
type GetInventoryHierarchyRequest struct {
	CompanyID interface{} `json:"company_id"`
}

// GetInventoryHierarchyWithTypes handles the hierarchical aggregation of inventory
func GetInventoryHierarchyWithTypes(db *sql.DB, req GetInventoryHierarchyRequest) (map[string]*HierarchyNode, error) {
	var companyID string
	switch v := req.CompanyID.(type) {
	case string:
		companyID = v
	case float64:
		companyID = fmt.Sprintf("%.0f", v)
	case int:
		companyID = strconv.Itoa(v)
	case nil:
		return nil, fmt.Errorf("company_id is required")
	default:
		return nil, fmt.Errorf("invalid type for company_id: %T", v)
	}

	if companyID == "" {
		return nil, fmt.Errorf("company_id is required")
	}

	// Fetch data
	query := `
		SELECT 
			COALESCE(item_group, ''), 
			COALESCE(warehouse, 0), 
			COALESCE(location, 'Unknown Location'), 
			COALESCE(sub_location, '[]')
		FROM item_inv
		WHERE company_id = ?
	`

	rows, err := db.Query(query, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*HierarchyNode)

	for rows.Next() {
		var itemGroup string
		var warehouse int
		var location string
		var subLocationStr string

		if err := rows.Scan(&itemGroup, &warehouse, &location, &subLocationStr); err != nil {
			continue // Skip row on error
		}

		isAvailable := (warehouse == 1)

		// Parse sub_location
		var subLocations []string
		// It might be a JSON string or just a string. The Node.js code tries JSON.parse.
		// If unmarshal fails, treat it as single string if not empty?
		// Node code: typeof item.sub_location === "string" ? JSON.parse(item.sub_location) : item.sub_location
		// If it's a JSON array string, Unmarshal works.
		if err := json.Unmarshal([]byte(subLocationStr), &subLocations); err != nil {
			// If it fails, maybe it's not a JSON array.
			// But the query COALESCE defaults to '[]'.
			// If the DB has raw string "some_loc", Unmarshal might fail or unmarshal into string?
			// subLocationStr is string.
			// If it is just a plain string (not json array), Node might wrap it or fail?
			// Node logic implies it expects an array structure from sub_location usually.
			// Let's assume it's JSON array of strings. If error, empty slice.
			subLocations = []string{}
		}

		// Process Root Location
		if _, exists := result[location]; !exists {
			result[location] = &HierarchyNode{
				Types:    []string{},
				Children: make(map[string]*HierarchyNode),
			}
		}
		rootNode := result[location]

		// Update Root
		rootNode.Total++
		if isAvailable {
			rootNode.Available++
		}
		addTypeUnique(rootNode, itemGroup)

		// Process Children
		currentNode := rootNode
		for _, subKey := range subLocations {
			if subKey == "" {
				subKey = "null"
			}

			if currentNode.Children == nil {
				currentNode.Children = make(map[string]*HierarchyNode)
			}

			if _, exists := currentNode.Children[subKey]; !exists {
				currentNode.Children[subKey] = &HierarchyNode{
					Types:    []string{},
					Children: make(map[string]*HierarchyNode),
				}
			}
			childNode := currentNode.Children[subKey]

			childNode.Total++
			if isAvailable {
				childNode.Available++
			}
			addTypeUnique(childNode, itemGroup)

			currentNode = childNode
		}
	}

	// Clean up empty children (set to nil)
	for _, node := range result {
		cleanHierarchyNode(node)
	}

	return result, nil
}

func addTypeUnique(node *HierarchyNode, itemType string) {
	if itemType == "" {
		return
	}
	for _, t := range node.Types {
		if t == itemType {
			return
		}
	}
	node.Types = append(node.Types, itemType)
}

func cleanHierarchyNode(node *HierarchyNode) {
	if node.Children == nil {
		return
	}
	if len(node.Children) == 0 {
		node.Children = nil
		return
	}
	for _, child := range node.Children {
		cleanHierarchyNode(child)
	}
}

// UpdateItemWarehouseRequest matches the request for UpdateItemWarehouse
type UpdateItemWarehouseRequest struct {
	ItemIDs   []int `json:"item_ids"`
	Warehouse int   `json:"warehouse"`
}

// UpdateItemWarehouse handles bulk update of warehouse status
func UpdateItemWarehouse(db *sql.DB, req UpdateItemWarehouseRequest) (int64, error) {
	if len(req.ItemIDs) == 0 {
		return 0, nil
	}

	// Build query with placeholders
	placeholders := make([]string, len(req.ItemIDs))
	args := make([]interface{}, len(req.ItemIDs)+1)

	args[0] = req.Warehouse
	for i, id := range req.ItemIDs {
		placeholders[i] = "?"
		args[i+1] = id
	}

	query := fmt.Sprintf("UPDATE item_inv SET warehouse = ? WHERE item_id IN (%s)", strings.Join(placeholders, ","))

	result, err := db.Exec(query, args...)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected()
}

// DeleteBulkItemsRequest matches the request for DeleteBulkItems
type DeleteBulkItemsRequest struct {
	ItemIDs   []int       `json:"item_ids"`
	CompanyID interface{} `json:"company_id"`
}

// DeleteBulkItems handles bulk deletion of items
func DeleteBulkItems(db *sql.DB, req DeleteBulkItemsRequest) (int64, error) {
	if len(req.ItemIDs) == 0 {
		return 0, nil
	}

	var companyID string
	switch v := req.CompanyID.(type) {
	case string:
		companyID = v
	case float64:
		companyID = fmt.Sprintf("%.0f", v)
	case int:
		companyID = strconv.Itoa(v)
	case nil:
		return 0, fmt.Errorf("company_id is required")
	default:
		return 0, fmt.Errorf("invalid type for company_id: %T", v)
	}

	if companyID == "" {
		return 0, fmt.Errorf("company_id is required")
	}

	// Build query with placeholders
	placeholders := make([]string, len(req.ItemIDs))
	args := make([]interface{}, len(req.ItemIDs)+1)

	for i, id := range req.ItemIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	// Add company_id as the last argument
	args[len(req.ItemIDs)] = companyID

	query := fmt.Sprintf("DELETE FROM item_inv WHERE item_id IN (%s) AND company_id = ?", strings.Join(placeholders, ","))

	result, err := db.Exec(query, args...)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected()
}

// ReturningItemToStockWhenEventIsFinished handles bulk return to stock
func ReturningItemToStockWhenEventIsFinished(db *sql.DB, req ReturningItemRequest) (int64, error) {
	var groupingDevices map[string][]DeviceStatusHistory
	if err := json.Unmarshal([]byte(req.GroupingDevicesFromNoSQL), &groupingDevices); err != nil {
		return 0, fmt.Errorf("failed to parse groupingDevicesFromNoSQL: %v", err)
	}

	var allInventory []SimpleInventoryItem
	if err := json.Unmarshal([]byte(req.AllInventoryOfEvent), &allInventory); err != nil {
		return 0, fmt.Errorf("failed to parse allInventoryOfEvent: %v", err)
	}

	if len(allInventory) == 0 {
		return 0, nil
	}

	batchSize := 100
	totalAffectedRows := int64(0)

	for i := 0; i < len(allInventory); i += batchSize {
		end := i + batchSize
		if end > len(allInventory) {
			end = len(allInventory)
		}
		batch := allInventory[i:end]

		var caseParts []string
		var values []interface{}        // For CASE
		var serialNumbers []interface{} // For IN clause

		for _, item := range batch {
			status := item.Status
			if history, ok := groupingDevices[item.SerialNumber]; ok && len(history) > 0 {
				status = history[len(history)-1].Status
			}

			caseParts = append(caseParts, "WHEN serial_number = ? THEN ?")
			values = append(values, item.SerialNumber, status)
			serialNumbers = append(serialNumbers, item.SerialNumber)
		}

		placeholders := make([]string, len(serialNumbers))
		for j := range placeholders {
			placeholders[j] = "?"
		}

		// Construct final values array: [case_values..., update_at, company_id, serial_numbers...]
		finalValues := append(values, req.UpdateAt, req.CompanyID)
		finalValues = append(finalValues, serialNumbers...)

		query := fmt.Sprintf(`
			UPDATE item_inv 
			SET 
				warehouse = 1,
				status = CASE 
					%s
					ELSE status 
				END,
				update_at = ?
			WHERE 
				company_id = ? 
				AND serial_number IN (%s)
		`, strings.Join(caseParts, " "), strings.Join(placeholders, ","))

		res, err := db.Exec(query, finalValues...)
		if err != nil {
			return totalAffectedRows, err
		}

		affected, _ := res.RowsAffected()
		totalAffectedRows += affected
	}

	return totalAffectedRows, nil
}
