// ============================================
// services/pinch.js
// PURPOSE: Pinch API service wrapper
// ============================================

const PINCH_API_URL = process.env.PINCH_API_URL || 'https://api.getpinch.com.au/test/';
const APPLICATION_ID = process.env.APPLICATION_ID;
const SECRET_KEY = process.env.SECRET_KEY;

let pinchAccessToken = null;
let pinchTokenExpiry = null;

// ----- Get Pinch Access Token -----
async function getPinchToken() {
    if (pinchAccessToken && pinchTokenExpiry && Date.now() < pinchTokenExpiry) {
        return pinchAccessToken;
    }

    try {
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
        pinchAccessToken = data.access_token;
        pinchTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;

        console.log('✅ Pinch token obtained');
        return pinchAccessToken;

    } catch (error) {
        console.error('❌ Failed to get Pinch token:', error);
        throw error;
    }
}

// ----- Create Pinch Payer -----
async function createPinchPayer(email, firstName, lastName) {
    const token = await getPinchToken();
    
    const response = await fetch(`${PINCH_API_URL}payers`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'pinch-version': '2020.1'
        },
        body: JSON.stringify({
            emailAddress: email || 'customer@example.com',
            firstName: firstName || 'Customer',
            lastName: lastName || 'User'
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to create payer');
    return data;
}

// ----- Process Payment with Pinch API -----
async function processPinchPayment(payerId, amount, reference, description = 'Payment') {
    const token = await getPinchToken();
    
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
            reference: reference || `PAY-${Date.now()}`,
            description: description,
            source: {
                type: 'card'
            }
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Payment failed');
    return data;
}

module.exports = {
    getPinchToken,
    createPinchPayer,
    processPinchPayment
};