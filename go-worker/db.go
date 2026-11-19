package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"strings"

	_ "github.com/go-sql-driver/mysql"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ConnectDB establishes a connection to the PlanetScale MySQL database.
//
// NO carga el .env: eso lo hace LoadEnv() una vez en main(), antes que nada.
// Antes se cargaba aqui tambien, tirando el error, y el resultado fue que un
// fichero ilegible se veia como un fallo de red en tiempo de peticion. Ver
// env.go.
func ConnectDB() (*sql.DB, error) {
	host := os.Getenv("PLANETSCALE_DATABASE_HOST")
	user := os.Getenv("PLANETSCALE_DATABASE_USERNAME")
	password := os.Getenv("PLANETSCALE_DATABASE_PASSWORD")
	dbName := os.Getenv("PLANETSCALE_DATABASE_NAME")

	// Cinturon y tirantes: LoadEnv ya se niega a arrancar sin estas, pero si
	// algun dia aparece otra via de entrada al binario, mas vale un error que
	// diga que falta la configuracion que un `tcp(:3306)` acusando a la red.
	if host == "" || user == "" || dbName == "" {
		return nil, fmt.Errorf(
			"MySQL is not configured: PLANETSCALE_DATABASE_HOST/USERNAME/NAME are empty " +
				"(the .env was not loaded; see logs/go-worker.log at startup)")
	}

	// DSN format: user:password@tcp(host:3306)/dbname?tls=true
	// PlanetScale requires TLS, but a local MySQL uses plaintext — set
	// PLANETSCALE_DATABASE_SSL=false for local dev to disable it.
	tlsMode := "true"
	if os.Getenv("PLANETSCALE_DATABASE_SSL") == "false" {
		tlsMode = "false"
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:3306)/%s?tls=%s&parseTime=true", user, password, host, dbName, tlsMode)

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

// ConnectMongoDB — tampoco carga el .env, por el mismo motivo que ConnectDB.
func ConnectMongoDB() (*mongo.Database, error) {
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
