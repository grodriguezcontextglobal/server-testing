package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// LogEntry matches the structure of the Winston JSON logs
type LogEntry struct {
	Timestamp string      `json:"timestamp"`
	Level     string      `json:"level"`
	Message   string      `json:"message"`
	Data      interface{} `json:"data,omitempty"`
	Service   string      `json:"service"`
	Stack     string      `json:"stack,omitempty"`
}

// Logger handles writing logs to the file system
type Logger struct {
	LogFile string
}

var globalLogger *Logger

// InitLogger initializes the logger
func InitLogger() {
	// Determine log path. Prefer standard project structure.
	// We check if "logs" directory exists in current dir or parent.
	
	possiblePaths := []string{
		"logs",
		"../logs",
	}

	var logDir string
	for _, p := range possiblePaths {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			logDir = p
			break
		}
	}

	// If no logs dir found, try to create "logs" in current directory
	if logDir == "" {
		logDir = "logs"
		_ = os.Mkdir(logDir, 0755)
	}

	globalLogger = &Logger{
		LogFile: filepath.Join(logDir, "go-worker.log"),
	}
}

// Log writes a log entry
func Log(level, message string, data interface{}, err error) {
	if globalLogger == nil {
		InitLogger()
	}

	entry := LogEntry{
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		Level:     level,
		Message:   message,
		Data:      data,
		Service:   "devitrak-go-worker",
	}

	if err != nil {
		entry.Stack = err.Error()
	}

	jsonBytes, _ := json.Marshal(entry)
	
	f, openErr := os.OpenFile(globalLogger.LogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if openErr != nil {
		// Fallback to stderr
		fmt.Fprintf(os.Stderr, "Failed to open log file: %v. Log: %s\n", openErr, string(jsonBytes))
		return
	}
	defer f.Close()

	f.WriteString(string(jsonBytes) + "\n")
}

func LogInfo(message string, data interface{}) {
	Log("info", message, data, nil)
}

func LogError(message string, err error, data interface{}) {
	Log("error", message, data, err)
}
