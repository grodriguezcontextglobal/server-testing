package main

import (
	"fmt"
	"os"
	"sync"

	"github.com/joho/godotenv"
	"github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/paymentintent"
)

type CheckStripePaymentIntentsRequest struct {
	PaymentIntents []string `json:"payment_intents"`
}

type CheckStripePaymentIntentsResponse struct {
	RequiresCapture []*stripe.PaymentIntent `json:"requires_capture"`
}

func InitStripe() error {
	// Load .env file from parent directory (since worker is in ./go-worker)
	if err := godotenv.Load("../.env"); err != nil {
		// Fallback: try loading from current dir if running locally
		_ = godotenv.Load(".env")
	}

	key := os.Getenv("STRIPE_SECRET_KEY")
	if key == "" {
		return fmt.Errorf("STRIPE_SECRET_KEY not set in environment")
	}
	stripe.Key = key
	return nil
}

func CheckStripePaymentIntents(req CheckStripePaymentIntentsRequest) ([]*stripe.PaymentIntent, error) {
	if err := InitStripe(); err != nil {
		return nil, err
	}

	var requiresCapture []*stripe.PaymentIntent
	var mutex sync.Mutex
	var wg sync.WaitGroup

	// Semaphore to limit concurrency (Stripe rate limits)
	sem := make(chan struct{}, 20) // 20 concurrent requests

	for _, piID := range req.PaymentIntents {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			// Recover from panics in this goroutine
			defer func() {
				if r := recover(); r != nil {
					LogError("Panic in Stripe goroutine", fmt.Errorf("%v", r), map[string]interface{}{"id": id})
				}
			}()

			sem <- struct{}{}        // Acquire
			defer func() { <-sem }() // Release

			pi, err := paymentintent.Get(id, nil)
			if err != nil {
				// Log error but continue?
				// For now, we just skip it or log it
				LogError(fmt.Sprintf("Error retrieving payment intent %s", id), err, nil)
				return
			}

			if pi.Status == stripe.PaymentIntentStatusRequiresCapture {
				mutex.Lock()
				requiresCapture = append(requiresCapture, pi)
				mutex.Unlock()
			}
		}(piID)
	}

	wg.Wait()
	return requiresCapture, nil
}
