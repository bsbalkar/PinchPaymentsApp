// test-bunnings-direct.js
require('dotenv').config();
const axios = require('axios');

async function testBunningsDirect() {
    console.log('🔑 Testing Bunnings credentials directly...');
    console.log('Client ID:', process.env.BUNNINGS_CLIENT_ID ? '✅ Present' : '❌ Missing');
    console.log('Client Secret:', process.env.BUNNINGS_CLIENT_SECRET ? '✅ Present' : '❌ Missing');

    // --- Configuration ---
    const CLIENT_ID = process.env.BUNNINGS_CLIENT_ID;
    const CLIENT_SECRET = process.env.BUNNINGS_CLIENT_SECRET;
    // Try different scope names if 'transaction_api' doesn't work
    const SCOPES = ['transaction_api', 'transaction.api', 'query_transaction', 'api_products'];

    try {
        // --- Step 1: Try to get a token with each scope ---
        let token = null;
        let workingScope = null;

        for (const scope of SCOPES) {
            console.log(`\n🔄 Attempting to get token with scope: '${scope}'...`);
            const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

            try {
                const tokenResponse = await axios({
                    method: 'POST',
                    url: 'https://connect.sandbox.api.bunnings.com.au/connect/token',
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    data: `grant_type=client_credentials&scope=${scope}`
                });

                token = tokenResponse.data.access_token;
                workingScope = scope;
                console.log(`✅ Token obtained successfully with scope: '${scope}'`);
                console.log('Token:', token.substring(0, 20) + '...');
                break; // Exit loop if token works

            } catch (scopeError) {
                console.log(`❌ Scope '${scope}' failed:`, scopeError.response?.data?.fault?.faultstring || scopeError.message);
                // Continue to next scope
            }
        }

        if (!token) {
            console.error('\n❌ All scopes failed. Please check your Bunnings portal for the correct scope name.');
            console.log('💡 Look in: API Products → Transaction API → Scopes');
            return;
        }

        // --- Step 2: Try to fetch a transaction with the working token ---
        console.log('\n🔄 Attempting to fetch transaction...');
        const transactionRef = '91401766829120210811';
        
        try {
            const transactionResponse = await axios({
                method: 'GET',
                url: `https://transaction.sandbox.api.bunnings.com.au/transaction/transactions/${transactionRef}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });

            console.log('✅ Transaction fetched successfully!');
            console.log('Transaction data:', JSON.stringify(transactionResponse.data, null, 2));

        } catch (fetchError) {
            console.error('\n❌ Failed to fetch transaction:');
            if (fetchError.response) {
                console.error('Status:', fetchError.response.status);
                console.error('Data:', JSON.stringify(fetchError.response.data, null, 2));
                
                if (fetchError.response.status === 401) {
                    console.error('\n💡 Even with a valid token, the API is rejecting the request.');
                    console.error('This means the token does not have permission for this specific API endpoint.');
                    console.error('📌 Possible causes:');
                    console.error('  1. The API product is not correctly linked to your app');
                    console.error('  2. The scope is still incorrect');
                    console.error('  3. The API endpoint URL might be wrong');
                    console.error('\n🔧 Check in the Bunnings portal:');
                    console.error('  1. Team Apps → Your App → API Products → Is "Transaction API" listed and enabled?');
                    console.error('  2. API Products → Transaction API → What is the exact scope name?');
                }
            } else if (fetchError.request) {
                console.error('No response received from server');
                console.error('Error:', fetchError.message);
            } else {
                console.error('Error setting up request:', fetchError.message);
            }
        }

    } catch (error) {
        console.error('\n❌ Unexpected error:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
    }
}

testBunningsDirect();