// ============================================
// testPinch.js - Pinch Authentication Test
// ============================================

require('dotenv').config();
const axios = require('axios');

// --- Configuration ---
// The PINCH_API_URL is the base URL for the test environment
const PINCH_API_URL = process.env.PINCH_API_URL || 'https://api.getpinch.com.au/test/';
// Your Application ID and Secret Key from the Pinch dashboard
const TEST_MERCHANT_ID = process.env.TEST_MERCHANT_ID;
const SECRET_KEY = process.env.SECRET_KEY;

async function getAccessToken() {
    console.log('🔄 Requesting access token...');
    
    try {
        // Pinch uses OAuth 2.0 client_credentials flow.
        // The credentials are sent as Basic Authentication in the header.
        const authString = Buffer.from(`${TEST_MERCHANT_ID}:${SECRET_KEY}`).toString('base64');

        const response = await axios({
            method: 'POST',
            url: `${PINCH_API_URL}connect/token`, // The OAuth token endpoint
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded' // Important: OAuth typically uses this content-type
            },
            data: 'grant_type=client_credentials&scope=api1' // Required OAuth parameters
        });

        console.log('✅ Access token obtained!');
        return response.data.access_token;

    } catch (error) {
        console.error('❌ Failed to get access token:');
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        throw error;
    }
}

async function testPinchConnection() {
    // 1. First, get the access token using your credentials
    const accessToken = await getAccessToken();

    // 2. Now use the token to make a real API call
    try {
        console.log('🔄 Testing API connection with health endpoint...');

        const response = await axios({
            method: 'GET',
            url: `${PINCH_API_URL}health/auth`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'accept': 'application/json',
                'pinch-version': '2020.1' // Specifying a version is good practice
            }
        });

        console.log('✅ Pinch API connection successful!');
        console.log('📌 Status:', response.status);
        console.log('📌 Response:', JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('❌ API call failed:');
        console.error('Status:', error.response?.status);
        console.error('Data:', JSON.stringify(error.response?.data, null, 2));
    }
}

// --- Run the test ---
testPinchConnection();