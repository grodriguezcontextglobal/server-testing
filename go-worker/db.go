package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ConnectDB establishes a connection to the PlanetScale MySQL database
func ConnectDB() (*sql.DB, error) {
	// Load .env file from parent directory (since worker is in ./go-worker)
	if err := godotenv.Load("../.env"); err != nil {
		// Fallback: try loading from current dir if running locally
		_ = godotenv.Load(".env")
	}

	host := os.Getenv("PLANETSCALE_DATABASE_HOST")
	user := os.Getenv("PLANETSCALE_DATABASE_USERNAME")
	password := os.Getenv("PLANETSCALE_DATABASE_PASSWORD")
	dbName := os.Getenv("PLANETSCALE_DATABASE_NAME")

	// DSN format: user:password@tcp(host:3306)/dbname?tls=true
	dsn := fmt.Sprintf("%s:%s@tcp(%s:3306)/%s?tls=true&parseTime=true", user, password, host, dbName)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}

	// Verify connection
	if err := db.Ping(); err != nil {
		return nil, err
	}

	return db, nil
}

func ConnectMongoDB() (*mongo.Database, error) {
	if err := godotenv.Load("../.env"); err != nil {
		_ = godotenv.Load(".env")
	}

	uri := os.Getenv("DB_CNN")
	if uri == "" {
		return nil, fmt.Errorf("DB_CNN environment variable not set")
	}

	clientOptions := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(context.TODO(), clientOptions)
	if err != nil {
		return nil, err
	}

	if err := client.Ping(context.TODO(), nil); err != nil {
		return nil, err
	}

	// Extract DB name from URI
	// URI format: mongodb+srv://user:pass@host/dbname?params
	dbName := "devitrakdb_test" // Default fallback
	if idx := strings.LastIndex(uri, "/"); idx != -1 {
		part := uri[idx+1:]
		if qIdx := strings.Index(part, "?"); qIdx != -1 {
			dbName = part[:qIdx]
		} else {
			dbName = part
		}
	}

	// If dbName is empty (e.g. URI ends in /), fallback
	if dbName == "" {
		dbName = "devitrakdb_test"
	}

	return client.Database(dbName), nil
}
