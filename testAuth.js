// ============================================
// testAuth.js - Test Application Authentication
// ============================================

require('dotenv').config();
const { getAccessToken, getTokenStatus } = require('./services/pinch');

async function testAuth() {
    console.log('🔄 Testing Application Authentication...');
    console.log('📌 Application ID:', process.env.APPLICATION_ID?.substring(0, 10) + '...');
    
    try {
        const token = await getAccessToken();
        console.log('✅ Token obtained:', token.substring(0, 20) + '...');
        console.log('📊 Token status:', getTokenStatus());
        console.log('✅ Authentication test passed!');
    } catch (error) {
        console.error('❌ Authentication test failed:');
        console.error('Please check your APPLICATION_ID and APPLICATION_SECRET in .env');
    }
}

testAuth();