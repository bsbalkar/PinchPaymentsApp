// ============================================
// services/bunnings.js
// PURPOSE: Fetch receipts from Bunnings sandbox API
// ============================================

// ============================================
// services/bunnings.js
// ============================================


require('dotenv').config();

const axios = require('axios');

// Configuration from .env
const CLIENT_ID = process.env.BUNNINGS_CLIENT_ID;
const CLIENT_SECRET = process.env.BUNNINGS_CLIENT_SECRET;
const AUTH_URL = process.env.BUNNINGS_AUTH_URL || 'https://connect.sandbox.api.bunnings.com.au/connect/token';
const BASE_URL = process.env.BUNNINGS_BASE_URL || 'https://transaction.sandbox.api.bunnings.com.au/transaction';

// Token cache
let bunningsToken = null;
let tokenExpiry = null;

// ----- Get OAuth2 token -----
async function getBunningsToken() {
    // Use cached token if still valid
    if (bunningsToken && tokenExpiry && Date.now() < tokenExpiry) {
        return bunningsToken;
    }

    try {
        const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

        const response = await axios({
            method: 'POST',
            url: AUTH_URL,
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: 'grant_type=client_credentials'
        });

        bunningsToken = response.data.access_token;
        // Tokens typically last 3600 seconds
        tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000;

        console.log('✅ Bunnings token obtained');
        return bunningsToken;

    } catch (error) {
        console.error('❌ Failed to get Bunnings token:');
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        throw error;
    }
}

// ----- Fetch a transaction by reference -----
async function fetchBunningsTransaction(transactionRef) {
    const token = await getBunningsToken();

    try {
        const response = await axios({
            method: 'GET',
            url: `${BASE_URL}/transactions/${transactionRef}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        console.log(`✅ Bunnings transaction fetched: ${transactionRef}`);
        return response.data;

    } catch (error) {
        console.error(`❌ Failed to fetch transaction ${transactionRef}:`);
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        throw error;
    }
}

// ----- Convert Bunnings transaction to receipt format -----
function formatBunningsReceipt(transactionData) {
    // Extract data from Bunnings response
    const transaction = transactionData.transaction || transactionData;
    
    // Build receipt text
    let receiptText = `
╔═══════════════════════════════════════════════╗
║              BUNNINGS RECEIPT                ║
╠═══════════════════════════════════════════════╣
║ Transaction Ref: ${transaction.transactionRef || 'N/A'}
║ Date: ${transaction.transactionDateTime || new Date().toISOString()}
╠═══════════════════════════════════════════════╣
║ Items:                                        ║
`;

    // Add line items if available
    if (transaction.accountEntries && transaction.accountEntries.length > 0) {
        transaction.accountEntries.forEach(entry => {
            if (entry.lines && entry.lines.length > 0) {
                entry.lines.forEach(line => {
                    receiptText += `║ ${line.quantity || 1}x ${line.itemDescription || 'Item'}  $${(line.unitPriceInclGst || 0).toFixed(2)}\n`;
                });
            }
        });
    }

    // Add total
    const total = transaction.totalAmount || transaction.amount || 0;
    receiptText += `
╠═══════════════════════════════════════════════╣
║ Total: AUD $${(total / 100).toFixed(2)}
╚═══════════════════════════════════════════════╝
    `.trim();

    return {
        id: transaction.transactionRef || `bun_${Date.now()}`,
        payerId: `bun_payer_${Date.now()}`,
        amount: total,
        currency: 'AUD',
        reference: transaction.transactionRef || 'BUNNINGS-REF',
        payer: {
            emailAddress: 'bunnings@example.com',
            firstName: 'Bunnings',
            lastName: 'Customer'
        },
        receipt_text: receiptText,
        raw_data: transaction
    };
}

module.exports = {
    getBunningsToken,
    fetchBunningsTransaction,
    formatBunningsReceipt
};