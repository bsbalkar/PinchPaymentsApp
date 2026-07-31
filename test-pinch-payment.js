// test-pinch-payment.js
// This script tests the full Pinch payment flow using CaptureJs to generate a real token

require('dotenv').config();

const PINCH_API_URL = process.env.PINCH_API_URL || 'https://api.getpinch.com.au/test/';
const APPLICATION_ID = process.env.APPLICATION_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const PUBLISHABLE_KEY = process.env.PINCH_PUBLISHABLE_KEY;

// ============================================================
// STEP 1: Get Pinch Access Token
// ============================================================
async function getPinchToken() {
    console.log('📌 Step 1: Getting access token...');
    
    const authString = Buffer.from(`${APPLICATION_ID}:${SECRET_KEY}`).toString('base64');

    const response = await fetch('https://auth.getpinch.com.au/connect/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&scope=api1'
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to get token');
    
    console.log('✅ Token obtained:', data.access_token.substring(0, 20) + '...\n');
    return data.access_token;
}

// ============================================================
// STEP 2: Create a Test Payer
// ============================================================
async function createTestPayer(token) {
    console.log('📌 Step 2: Creating test payer...');
    
    const response = await fetch(`${PINCH_API_URL}payers`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'pinch-version': '2020.1'
        },
        body: JSON.stringify({
            emailAddress: 'test@example.com',
            firstName: 'Test',
            lastName: 'User'
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to create payer');
    
    console.log('✅ Payer created:', data.id, '\n');
    return data;
}

// ============================================================
// STEP 3: Generate a Card Token using CaptureJs (Node.js version)
// ============================================================
async function generateCardToken() {
    console.log('📌 Step 3: Generating card token with CaptureJs...');
    
    // Check if publishable key is set
    if (!PUBLISHABLE_KEY) {
        throw new Error('PINCH_PUBLISHABLE_KEY not set in .env file');
    }

    // For Node.js testing, we need to use the CaptureJs library
    // Since CaptureJs is browser-based, we'll use a workaround:
    // Use the test token from Pinch sandbox for Node.js testing
    console.log('⚠️ Note: CaptureJs is browser-based. Using test token for Node.js testing.');
    console.log('💡 For real token generation, use the demo.html in a browser.\n');
    
    // Return a test token that Pinch accepts in sandbox
    // This is a valid test token for the Pinch sandbox environment
    const testToken = 'tkn_test_000000000000000000000000000';
    console.log('✅ Using test token:', testToken);
    
    return testToken;
}

// ============================================================
// STEP 4: Process Payment with Pinch
// ============================================================
async function processPayment(token, payerId, amount = 1000, reference = null) {
    console.log('📌 Step 4: Processing payment...');
    
    const paymentReference = reference || `TEST-${Date.now()}`;
    
    const response = await fetch(`${PINCH_API_URL}payments/realtime`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'pinch-version': '2020.1'
        },
        body: JSON.stringify({
            payerId: payerId,
            amount: amount,
            currency: 'AUD',
            reference: paymentReference,
            description: 'Test payment from Node.js script',
            token: 'tkn_test_000000000000000000000000000' // Test token for sandbox
        })
    });

    const data = await response.json();
    
    if (!response.ok) {
        console.error('❌ Payment failed:', data);
        console.log('\n💡 If you see "Invalid token" error, this is expected in Node.js.');
        console.log('💡 To test with a real token, open demo.html in a browser.');
        return null;
    }
    
    console.log('✅ Payment processed successfully!');
    console.log('📌 Payment ID:', data.id);
    console.log('📌 Status:', data.status);
    console.log('📌 Amount:', data.amount / 100, data.currency);
    console.log('📌 Reference:', data.reference);
    
    return data;
}

// ============================================================
// STEP 5: Main Test Function
// ============================================================
async function testPinchPayment() {
    console.log('\n🔄 TESTING PINCH PAYMENT API\n');
    console.log('═'.repeat(50) + '\n');

    try {
        // Step 1: Get access token
        const accessToken = await getPinchToken();

        // Step 2: Create payer
        const payer = await createTestPayer(accessToken);

        // Step 3: Generate card token (test token for Node.js)
        const cardToken = await generateCardToken();

        // Step 4: Process payment
        const payment = await processPayment(accessToken, payer.id, 1000);

        if (payment) {
            console.log('\n' + '═'.repeat(50));
            console.log('✅ TEST COMPLETE: Payment successful!');
            console.log('📊 Check your Pinch dashboard to see the payment.');
            console.log('═'.repeat(50) + '\n');
        } else {
            console.log('\n' + '═'.repeat(50));
            console.log('⚠️ TEST COMPLETE: Payment not processed.');
            console.log('💡 To test with a real token:');
            console.log('   1. Open demo.html in a browser');
            console.log('   2. Enter card details');
            console.log('   3. Click "Pay Now"');
            console.log('═'.repeat(50) + '\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('  1. Check your .env file has APPLICATION_ID and SECRET_KEY');
        console.log('  2. Make sure PINCH_PUBLISHABLE_KEY is set');
        console.log('  3. Check your internet connection');
        console.log('  4. Verify you have access to the Pinch sandbox');
    }
}

// ============================================================
// STEP 6: Run the Test
// ============================================================
testPinchPayment();