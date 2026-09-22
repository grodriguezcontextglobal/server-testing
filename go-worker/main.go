package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/mongo"
)

// Global DB instances
var (
	SQLDB   *sql.DB
	MongoDB *mongo.Database
)

// Response format to send back to Node.js
type Response struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func main() {
	// Load environment variables ONCE
	if err := godotenv.Load("../.env"); err != nil {
		_ = godotenv.Load(".env")
	}

	// Initialize Logger
	InitLogger()

	// Initialize Databases (Lazy or immediate)
	// For robustness, we can try to connect, but maybe not fail hard if DB is down initially?
	// But since this is a worker, failing hard is probably better so we know it's broken.
	// However, to prevent crash loops, we can log error and try to reconnect later or just fail individual requests.
	// Let's try to connect globally.
	var err error
	SQLDB, err = ConnectDB()
	if err != nil {
		LogInfo("Warning: Initial MySQL connection failed (will retry on request)", err)
	} else {
		LogInfo("Connected to MySQL", nil)
		SQLDB.SetMaxOpenConns(25)
		SQLDB.SetMaxIdleConns(25)
		SQLDB.SetConnMaxLifetime(5 * time.Minute)
	}

	MongoDB, err = ConnectMongoDB()
	if err != nil {
		LogInfo("Warning: Initial MongoDB connection failed (will retry on request)", err)
	} else {
		LogInfo("Connected to MongoDB", nil)
	}

	// If arguments are provided, behave as CLI for backward compatibility or testing
	if len(os.Args) >= 3 {
		runCLI()
		return
	}

	// Otherwise, start HTTP server
	startServer()
}

func startServer() {
	// Lightweight liveness endpoint for container/service health checks
	// (compose healthcheck, nssm/monitoring, load balancer). GET, no auth.
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	// Wrap handler with panic recovery
	http.HandleFunc("/", recoverMiddleware(handleRequest))
	port := os.Getenv("GO_WORKER_PORT")
	if port == "" {
		// Must stay in sync with DEFAULT_GO_WORKER_PORT in helpers/goWorker.js.
		// These two defaults used to disagree (8081 here vs 7453 there), so an
		// environment that set GO_WORKER_PORT for only ONE of the two processes
		// left them silently talking past each other — the root cause of the
		// "Go Worker Connection Failed / circuit breaker open" outages in prod.
		port = "7453"
	}
	fmt.Printf("Go worker server listening on port %s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func recoverMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				LogError("Panic in HTTP handler", fmt.Errorf("%v", err), nil)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next(w, r)
	}
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read body
	byteValue, err := io.ReadAll(r.Body)
	if err != nil {
		sendHTTPError(w, fmt.Sprintf("Failed to read body: %v", err))
		return
	}
	defer r.Body.Close()

	// Parse Command from URL path (e.g., /insert-item-event)
	command := r.URL.Path[1:] // Remove leading slash

	processCommand(command, byteValue, w)
}

func runCLI() {
	defer func() {
		if r := recover(); r != nil {
			sendCLIError(fmt.Sprintf("Panic in Go Worker: %v", r))
		}
	}()

	if len(os.Args) < 3 {
		sendCLIError("Not enough arguments")
		return
	}

	command := os.Args[1]
	jsonFilePath := os.Args[2]

	jsonFile, err := os.Open(jsonFilePath)
	if err != nil {
		sendCLIError(fmt.Sprintf("Failed to open input file: %v", err))
		return
	}
	defer jsonFile.Close()

	byteValue, _ := io.ReadAll(jsonFile)

	resp := executeCommand(command, byteValue)
	json.NewEncoder(os.Stdout).Encode(resp)
}

func processCommand(command string, byteValue []byte, w http.ResponseWriter) {
	resp := executeCommand(command, byteValue)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func executeCommand(command string, byteValue []byte) Response {
	switch command {
	// --- SQL Commands ---
	case "insert-bulk-item", "insert-bulk-item-alpha", "insert-device-event-container", "insert-item-event", "insert-device-event-directly", "retrieve-item-data", "item-final-status", "returning-item-to-stock", "check-item", "checking-inventory-current-state", "get-inventory-hierarchy", "update-item-warehouse", "delete-bulk-items":
		if SQLDB == nil {
			var err error
			SQLDB, err = ConnectDB()
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Database connection failed: %v", err)}
			}
			SQLDB.SetMaxOpenConns(25)
			SQLDB.SetMaxIdleConns(25)
			SQLDB.SetConnMaxLifetime(5 * time.Minute)
		}
		db := SQLDB

		if command == "insert-bulk-item" {
			var req BulkItemRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			if err := InsertBulkItem(db, req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Bulk insert failed: %v", err)}
			}
			return Response{Status: "success", Message: "Bulk items inserted successfully"}
		} else if command == "insert-bulk-item-alpha" {
			var req BulkItemAlphaRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			if err := InsertBulkItemAlpha(db, req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Alpha bulk insert failed: %v", err)}
			}
			return Response{Status: "success", Message: "Alpha bulk items inserted successfully"}
		} else if command == "insert-device-event-container" {
			var req InsertDeviceFromContainerRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			inserted, err := InsertDeviceInEventDirectlyFromContainer(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Device container insert failed: %v", err)}
			}
			return Response{Status: "success", Message: "Devices from container inserted successfully", Data: map[string]interface{}{
				"inserted_items": inserted,
				"total_items":    len(req.RefDatabase),
			}}
		} else if command == "insert-item-event" {
			var req InsertItemEventRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			inserted, found, err := InsertItemInEvent(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Item event insert failed: %v", err)}
			}
			return Response{Status: "success", Message: "Items inserted into event successfully", Data: map[string]interface{}{
				"inserted_items": inserted,
				"total_items":    found,
			}}
		} else if command == "insert-device-event-directly" {
			var req InsertDeviceDirectlyRequest
			decoder := json.NewDecoder(bytes.NewReader(byteValue))
			decoder.UseNumber()
			if err := decoder.Decode(&req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			inserted, err := InsertDeviceInEventDirectly(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Device insert failed: %v", err)}
			}
			return Response{Status: "success", Message: "Item inserted successfully into event", Data: map[string]interface{}{
				"inserted_items": inserted,
			}}
		} else if command == "retrieve-item-data" {
			var req RetrieveItemDataRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			total, totalAvailable, groupedData, err := RetrieveItemData(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Retrieve item data failed: %v", err)}
			}
			return Response{Status: "success", Message: "Item data retrieved successfully", Data: map[string]interface{}{
				"total":          total,
				"totalAvailable": totalAvailable,
				"groupedData":    groupedData,
			}}
		} else if command == "item-final-status" {
			var req ItemFinalStatusRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			affectedRows, err := ItemFinalStatusWhenEventIsFinished(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Item final status update failed: %v", err)}
			}
			return Response{Status: "success", Message: fmt.Sprintf("Successfully updated %d items", affectedRows), Data: map[string]interface{}{
				"affectedRows": affectedRows,
			}}
		} else if command == "returning-item-to-stock" {
			var req ReturningItemRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			affectedRows, err := ReturningItemToStockWhenEventIsFinished(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Returning item update failed: %v", err)}
			}
			return Response{Status: "success", Message: fmt.Sprintf("Successfully updated %d items", affectedRows), Data: map[string]interface{}{
				"affectedRows": affectedRows,
			}}
		} else if command == "check-item" {
			var req CheckItemRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			results, err := CheckItem(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Check item failed: %v", err)}
			}
			return Response{Status: "success", Message: "Items checked successfully", Data: results}
		} else if command == "checking-inventory-current-state" {
			var req InventoryCurrentStateRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			results, err := CheckingInventoryCurrentState(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Checking inventory current state failed: %v", err)}
			}
			return Response{Status: "success", Message: "Inventory current state retrieved successfully", Data: results}
		} else if command == "get-inventory-hierarchy" {
			var req GetInventoryHierarchyRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			results, err := GetInventoryHierarchyWithTypes(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Get inventory hierarchy failed: %v", err)}
			}
			return Response{Status: "success", Message: "Inventory hierarchy retrieved successfully", Data: results}
		} else if command == "update-item-warehouse" {
			var req UpdateItemWarehouseRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			affectedRows, err := UpdateItemWarehouse(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Update item warehouse failed: %v", err)}
			}
			return Response{Status: "success", Message: "Item warehouse updated successfully", Data: map[string]interface{}{"affectedRows": affectedRows}}
		} else if command == "delete-bulk-items" {
			var req DeleteBulkItemsRequest
			if err := json.Unmarshal(byteValue, &req); err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
			}
			affectedRows, err := DeleteBulkItems(db, req)
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("Delete bulk items failed: %v", err)}
			}
			return Response{Status: "success", Message: "Items deleted successfully", Data: map[string]interface{}{"affectedRows": affectedRows}}
		}

	// --- Stripe Commands ---
	case "check-stripe-payment-intents":
		var req CheckStripePaymentIntentsRequest
		if err := json.Unmarshal(byteValue, &req); err != nil {
			return Response{Status: "error", Message: fmt.Sprintf("Invalid JSON format: %v", err)}
		}

		results, err := CheckStripePaymentIntents(req)
		if err != nil {
			return Response{Status: "error", Message: fmt.Sprintf("Stripe check failed: %v", err)}
		}

		return Response{Status: "success", Message: "Stripe payment intents checked successfully", Data: map[string]interface{}{
			"paymentIntents": results,
		}}

	// --- Mongo Commands ---
	case "add-receiver-transaction",
		"create-bulk-item-transaction",
		"pool-receivers-bulk",
		"event-list",
		"receiver-pool-bulk-delete",
		"receiver-pool-found-delete",
		"return-all-items-transaction-pool",
		"update-receiver-status",
		"update-bulk-item-data-pool",
		"update-bulk-items-pool",
		"update-bulk-items-transaction",
		"update-bulk-items-transaction-user",
		"update-issue-device",
		"update-pool-receivers",
		"get-consumer-stats":

		if MongoDB == nil {
			var err error
			MongoDB, err = ConnectMongoDB()
			if err != nil {
				return Response{Status: "error", Message: fmt.Sprintf("MongoDB connection failed: %v", err)}
			}
		}
		db := MongoDB

		var res interface{}
		var opErr error

		switch command {
		case "add-receiver-transaction":
			res, opErr = AddReceiverToTransaction(db, byteValue)
		case "create-bulk-item-transaction":
			res, opErr = CreateBulkItemTransactionInUser(db, byteValue)
		case "pool-receivers-bulk":
			res, opErr = PoolReceiversBulk(db, byteValue)
		case "event-list":
			res, opErr = EventList(db, byteValue)
		case "receiver-pool-bulk-delete":
			res, opErr = ReceiverPoolBulkDelete(db, byteValue)
		case "receiver-pool-found-delete":
			res, opErr = ReceiverPoolFoundAndDelete(db, byteValue)
		case "return-all-items-transaction-pool":
			res, opErr = ReturnAllItemsInTransactionInPool(db, byteValue)
		case "update-receiver-status":
			res, opErr = UpdateReceiverStatus(db, byteValue)
		case "update-bulk-item-data-pool":
			res, opErr = UpdateBulkItemDataInPool(db, byteValue)
		case "update-bulk-items-pool":
			res, opErr = UpdateBulkItemsInPool(db, byteValue)
		case "update-bulk-items-transaction":
			res, opErr = UpdateBulkItemsInTransaction(db, byteValue)
		case "update-bulk-items-transaction-user":
			res, opErr = UpdateBulkItemsInTransactionPerUserAtOnce(db, byteValue)
		case "update-issue-device":
			res, opErr = UpdateIssueDevice(db, byteValue)
		case "update-pool-receivers":
			res, opErr = UpdatePoolReceivers(db, byteValue)
		case "get-consumer-stats":
			res, opErr = GetConsumerStats(db, byteValue)
		}

		if opErr != nil {
			return Response{Status: "error", Message: opErr.Error()}
		}
		return Response{Status: "success", Message: "Operation successful", Data: res}

	default:
		return Response{Status: "error", Message: fmt.Sprintf("Unknown command: %s", command)}
	}
	return Response{Status: "error", Message: "Unknown error"}
}

func sendHTTPError(w http.ResponseWriter, msg string) {
	resp := Response{
		Status:  "error",
		Message: msg,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func sendCLIError(msg string) {
	resp := Response{
		Status:  "error",
		Message: msg,
	}
	json.NewEncoder(os.Stdout).Encode(resp)
	os.Exit(0)
}
