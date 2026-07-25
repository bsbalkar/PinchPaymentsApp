// testFlow.js
const axios = require('axios');

async function testPayment() {
    console.log('🔄 Testing payment flow...');
    
    const testData = {
        email: 'customer@example.com',
        firstName: 'John',
        lastName: 'Doe',
        amount: 2500,        // $25.00
        reference: 'INV-TEST-001'
    };
    
    try {
        const response = await axios.post(
            'http://localhost:5000/test-payment',
            testData
        );
        
        console.log('✅ Payment processed successfully!');
        console.log('📌 Payment ID:', response.data.data.id);
        console.log('📌 Receipt URL:', response.data.receipt_url);
        console.log('📌 Response:', JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        console.error('❌ Payment failed:');
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
    }
}

testPayment();