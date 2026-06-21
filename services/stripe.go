package services

import (
	"fmt"
	"log"
	"os"

	"github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/customer"
	"github.com/stripe/stripe-go/v78/paymentintent"
	"github.com/stripe/stripe-go/v78/price"
	"github.com/stripe/stripe-go/v78/subscription"
)

// StripeService maneja todas las operaciones de Stripe
type StripeService struct {
	secretKey string
}

// NewStripeService crea una nueva instancia del servicio
func NewStripeService() (*StripeService, error) {
	secretKey := os.Getenv("STRIPE_SECRET_KEY")
	if secretKey == "" {
		return nil, fmt.Errorf("STRIPE_SECRET_KEY no está configurado")
	}

	// Configurar Stripe con la clave secreta
	stripe.Key = secretKey

	return &StripeService{
		secretKey: secretKey,
	}, nil
}

// CreateCustomer crea un nuevo cliente en Stripe
func (s *StripeService) CreateCustomer(email, name, phone string) (*stripe.Customer, error) {
	params := &stripe.CustomerParams{
		Email: stripe.String(email),
		Name:  stripe.String(name),
		Phone: stripe.String(phone),
	}

	return customer.New(params)
}

// CreatePaymentIntent crea un PaymentIntent para un pago único
func (s *StripeService) CreatePaymentIntent(amount int64, currency, customerID, description string) (*stripe.PaymentIntent, error) {
	params := &stripe.PaymentIntentParams{
		Amount:      stripe.Int64(amount), // Monto en centavos
		Currency:    stripe.String(currency),
		Customer:    stripe.String(customerID),
		Description: stripe.String(description),
		AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
			Enabled: stripe.Bool(true),
		},
	}

	return paymentintent.New(params)
}

// CreateSubscription crea una suscripción para un cliente
func (s *StripeService) CreateSubscription(customerID, priceID string) (*stripe.Subscription, error) {
	params := &stripe.SubscriptionParams{
		Customer: stripe.String(customerID),
		Items: []*stripe.SubscriptionItemsParams{
			{
				Price: stripe.String(priceID),
			},
		},
		PaymentBehavior: stripe.String("default_incomplete"),
		PaymentSettings: &stripe.SubscriptionPaymentSettingsParams{
			SaveDefaultPaymentMethod: stripe.String("on_subscription"),
		},
		Expand: []*string{
			stripe.String("latest_invoice.payment_intent"),
		},
	}

	return subscription.New(params)
}

// CancelSubscription cancela una suscripción de forma inmediata
func (s *StripeService) CancelSubscription(subscriptionID string) (*stripe.Subscription, error) {
	params := &stripe.SubscriptionCancelParams{}
	return subscription.Cancel(subscriptionID, params)
}

// CancelAtPeriodEnd marca la suscripción para cancelarse al final del período actual
// El usuario conserva acceso hasta que venza — NO cancela de inmediato
func (s *StripeService) CancelAtPeriodEnd(subscriptionID string) error {
	params := &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(true),
	}
	_, err := subscription.Update(subscriptionID, params)
	return err
}

// UpdateSubscription actualiza una suscripción (cambiar plan)
func (s *StripeService) UpdateSubscription(subscriptionID, newPriceID string) (*stripe.Subscription, error) {
	// Primero obtenemos la suscripción actual
	sub, err := subscription.Get(subscriptionID, nil)
	if err != nil {
		return nil, err
	}

	// Actualizamos el item de la suscripción
	params := &stripe.SubscriptionParams{
		Items: []*stripe.SubscriptionItemsParams{
			{
				ID:    stripe.String(sub.Items.Data[0].ID),
				Price: stripe.String(newPriceID),
			},
		},
		ProrationBehavior: stripe.String("create_prorations"),
	}

	return subscription.Update(subscriptionID, params)
}

// GetSubscription obtiene información de una suscripción
func (s *StripeService) GetSubscription(subscriptionID string) (*stripe.Subscription, error) {
	return subscription.Get(subscriptionID, nil)
}

// GetCustomer obtiene información de un cliente
func (s *StripeService) GetCustomer(customerID string) (*stripe.Customer, error) {
	return customer.Get(customerID, nil)
}

// ListPrices obtiene todos los precios configurados
func (s *StripeService) ListPrices() []*stripe.Price {
	params := &stripe.PriceListParams{
		Active: stripe.Bool(true),
	}
	params.Limit = stripe.Int64(100)

	i := price.List(params)
	var prices []*stripe.Price

	for i.Next() {
		prices = append(prices, i.Price())
	}

	return prices
}

// GetPriceIDForPlan retorna el Price ID de Stripe según el plan y período
func (s *StripeService) GetPriceIDForPlan(planName, billingPeriod string) string {
	// Mapeo de variables de entorno según plan y período
	envKeyMap := map[string]map[string]string{
		"proton": {
			"monthly": "STRIPE_PROTON_MONTHLY_PRICE_ID",
			"annual":  "STRIPE_PROTON_ANNUAL_PRICE_ID",
		},
		"neutron": {
			"monthly": "STRIPE_NEUTRON_MONTHLY_PRICE_ID",
			"annual":  "STRIPE_NEUTRON_ANNUAL_PRICE_ID",
		},
		"electron": {
			"monthly": "STRIPE_ELECTRON_MONTHLY_PRICE_ID",
			"annual":  "STRIPE_ELECTRON_ANNUAL_PRICE_ID",
		},
	}

	if plan, exists := envKeyMap[planName]; exists {
		if envKey, exists := plan[billingPeriod]; exists {
			priceID := os.Getenv(envKey)
			if priceID != "" {
				return priceID
			}
			log.Printf("⚠️  %s no está configurado en variables de entorno", envKey)
		}
	}

	return ""
}

// CalculateAmount calcula el monto en centavos obteniendo el precio desde Stripe API
func (s *StripeService) CalculateAmount(planName, billingPeriod string) int64 {
	// Obtener el Price ID desde las variables de entorno
	priceID := s.GetPriceIDForPlan(planName, billingPeriod)

	if priceID == "" {
		log.Printf("❌ No se encontró Price ID para plan=%s, billing=%s", planName, billingPeriod)
		return 0
	}

	// Obtener el precio desde Stripe API
	p, err := price.Get(priceID, nil)
	if err != nil {
		log.Printf("❌ Error obteniendo precio de Stripe para %s: %v", priceID, err)
		return 0
	}

	// Validar que el precio tenga un monto válido
	if p.UnitAmount == 0 {
		log.Printf("⚠️  Precio %s tiene monto 0", priceID)
		return 0
	}

	log.Printf("✅ Precio obtenido de Stripe: Plan=%s, Período=%s, Monto=%d centavos ($%.2f %s)",
		planName, billingPeriod, p.UnitAmount, float64(p.UnitAmount)/100, p.Currency)

	return p.UnitAmount
}

// GetPriceFromStripe obtiene el precio completo desde Stripe API
func (s *StripeService) GetPriceFromStripe(priceID string) (*stripe.Price, error) {
	if priceID == "" {
		return nil, fmt.Errorf("priceID vacío")
	}

	p, err := price.Get(priceID, nil)
	if err != nil {
		return nil, fmt.Errorf("error obteniendo precio: %w", err)
	}

	return p, nil
}
