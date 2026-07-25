// ============================================
// services/pinch.js
// PURPOSE: Pinch API service wrapper with Application Auth
// ============================================

const axios = require('axios');

// Load credentials from .env
const PINCH_API_URL = process.env.PINCH_API_URL || 'https://api.getpinch.com.au/test/';
const APPLICATION_ID = process.env.APPLICATION_ID;
const APPLICATION_SECRET = process.env.APPLICATION_SECRET;

// Token storage
let accessToken = null;
let tokenExpiry = null;

// ----- Get an access token using Application Auth -----
async function getAccessToken() {
    // If token is still valid (with 5 minute buffer), reuse it
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry - (5 * 60 * 1000)) {
        console.log('✅ Using cached access token');
        return accessToken;
    }

    console.log('🔄 Requesting new access token (Application Auth)...');

    try {
        // Application Auth uses Basic Auth with Application ID as username
        const authString = Buffer.from(`${APPLICATION_ID}:${APPLICATION_SECRET}`).toString('base64');

        const response = await axios({
            method: 'POST',
            url: `https://auth.getpinch.com.au/connect/token`,
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: 'grant_type=client_credentials&scope=api1'
        });

        accessToken = response.data.access_token;
        // Tokens typically last 3600 seconds (1 hour)
        tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000;

        console.log('✅ Access token obtained successfully');
        console.log(`⏰ Token expires at: ${new Date(tokenExpiry).toLocaleTimeString()}`);

        return accessToken;

    } catch (error) {
        console.error('❌ Failed to get access token:');
        console.error('Status:', error.response?.status);
        console.error('Error:', error.response?.data?.error || error.message);
        
        // Provide helpful error messages
        if (error.response?.status === 401) {
            console.error('💡 Tip: Check your APPLICATION_ID and APPLICATION_SECRET in .env');
        }
        throw error;
    }
}

// ----- Make an authenticated Pinch API request -----
async function pinchRequest(method, endpoint, data = null, params = null) {
    const token = await getAccessToken();

    try {
        const response = await axios({
            method,
            url: `${PINCH_API_URL}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'pinch-version': '2020.1',
                'Content-Type': 'application/json'
            },
            data,
            params
        });

        return response.data;

    } catch (error) {
        console.error(`❌ Pinch API request failed: ${method} ${endpoint}`);
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
            
            // If token expired, clear it and retry
            if (error.response.status === 401) {
                console.log('🔄 Token may have expired. Clearing and retrying...');
                accessToken = null;
                tokenExpiry = null;
                
                // Retry once with new token
                const newToken = await getAccessToken();
                const retryResponse = await axios({
                    method,
                    url: `${PINCH_API_URL}${endpoint}`,
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'Accept': 'application/json',
                        'pinch-version': '2020.1',
                        'Content-Type': 'application/json'
                    },
                    data,
                    params
                });
                return retryResponse.data;
            }
        } else {
            console.error('Error:', error.message);
        }
        throw error;
    }
}

// ----- Create a webhook -----
async function createWebhook(uri, eventTypes = ['payment-created']) {
    const data = {
        uri: uri,
        eventTypes: eventTypes
    };
    return pinchRequest('POST', 'webhooks', data);
}

// ----- Get all webhooks -----
async function getWebhooks() {
    return pinchRequest('GET', 'webhooks');
}

// ----- Delete a webhook -----
async function deleteWebhook(webhookId) {
    return pinchRequest('DELETE', `webhooks/${webhookId}`);
}

// ----- Create a Payer (customer) -----
async function createPayer(email, firstName, lastName, phone = null) {
    const data = {
        emailAddress: email,
        firstName: firstName || 'Customer',
        lastName: lastName || '',
        phoneNumber: phone || ''
    };
    return pinchRequest('POST', 'payers', data);
}

// ----- Get a Payer by ID -----
async function getPayer(payerId) {
    return pinchRequest('GET', `payers/${payerId}`);
}

// ----- Get or create a Payer by email -----
async function getOrCreatePayer(email, firstName, lastName) {
    try {
        // Try to find existing payer by email
        const result = await pinchRequest('GET', 'payers', null, { emailAddress: email });
        
        if (result && result.data && result.data.length > 0) {
            return result.data[0];
        }
    } catch (error) {
        // Payer not found, create one
    }

    return createPayer(email, firstName, lastName);
}

// ----- Process a realtime payment -----
async function createPayment(payerId, amount, reference, metadata = {}) {
    const data = {
        payerId: payerId,
        amount: amount, // in cents
        currency: 'AUD',
        reference: reference || `INV-${Date.now()}`,
        metadata: metadata,
        source: {
            type: 'card'
        }
    };
    return pinchRequest('POST', 'payments/realtime', data);
}

// ----- Get a payment by ID -----
async function getPayment(paymentId) {
    return pinchRequest('GET', `payments/${paymentId}`);
}

// ----- Get token status (for debugging) -----
function getTokenStatus() {
    return {
        hasToken: !!accessToken,
        expiresAt: tokenExpiry ? new Date(tokenExpiry).toISOString() : null,
        isExpired: tokenExpiry ? Date.now() > tokenExpiry : true,
        timeRemaining: tokenExpiry ? Math.floor((tokenExpiry - Date.now()) / 1000) + 's' : 'No token'
    };
}

module.exports = {
    getAccessToken,
    pinchRequest,
    createWebhook,
    getWebhooks,
    deleteWebhook,
    createPayer,
    getPayer,
    getOrCreatePayer,
    createPayment,
    getPayment,
    getTokenStatus
};