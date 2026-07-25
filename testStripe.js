// ============================================
// testStripe.js
// PURPOSE: Test Stripe connection and create a PaymentIntent
// ============================================

// Load environment variables from .env file
require('dotenv').config();

// Import Stripe library
const Stripe = require('stripe');

// Initialize Stripe with your secret key
// The `apiVersion` ensures we use a consistent version
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia'
});

// ----- STEP 1: Create a PaymentIntent -----
// A PaymentIntent represents a payment that needs to be collected
// Think of it as: "I want to charge $10.00 to a customer"

async function createTestPayment() {
    try {
        console.log('🔄 Creating test PaymentIntent...');

        const paymentIntent = await stripe.paymentIntents.create({
            amount: 1000,              // $10.00 in cents
            currency: 'aud',           // Australian dollars
            metadata: {
                // This is where you'd store your invoice reference
                invoice_number: 'INV-12345',
                customer_email: 'test@example.com'
            }
        });

        // ----- STEP 2: Display the response -----
        console.log('✅ PaymentIntent created successfully!');
        console.log('📌 PaymentIntent ID:', paymentIntent.id);
        console.log('💰 Amount:', paymentIntent.amount / 100, paymentIntent.currency);
        console.log('📋 Metadata:', paymentIntent.metadata);
        console.log('🔑 Client Secret (for frontend):', paymentIntent.client_secret);

        // The `client_secret` is what you'd send to your frontend
        // to confirm the payment on the customer's device

        return paymentIntent;

    } catch (error) {
        console.error('❌ Error creating PaymentIntent:');
        console.error('Message:', error.message);
        console.error('Type:', error.type);
        console.error('Code:', error.code);
        console.error('Request ID:', error.requestId);
    }
}

// ----- STEP 3: Run the test -----
createTestPayment();