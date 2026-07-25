// testDb.js
const db = require('./database/db');

async function testDatabase() {
    console.log('🔄 Testing database...');
    
    try {
        // Check stats
        const stats = await db.getStats();
        console.log('📊 Database stats:', stats);
        
        // Get all receipts
        const receipts = await db.getAllReceipts(10);
        console.log(`📋 Found ${receipts.length} receipts in database`);
        
        console.log('✅ Database test passed!');
    } catch (error) {
        console.error('❌ Database test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

testDatabase();