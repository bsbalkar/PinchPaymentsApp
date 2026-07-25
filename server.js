// ============================================
// server.js
// PURPOSE: Main Express server - COMPLETE
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./database/db');
const { createWebhook, getWebhooks, getTokenStatus } = require('./services/pinch');

// Import webhook handler correctly
const webhookRoutes = require('./routes/webhooks');
const { handlePaymentCreated } = webhookRoutes;

// ----- Initialize Express app -----
const app = express();
const PORT = process.env.PORT || 5000;

// ----- Middleware -----
app.use(cors());
app.use(express.json());

// ----- Serve static files (receipts) -----
const receiptsDir = path.join(__dirname, 'receipts');
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
}
app.use('/receipts', express.static(receiptsDir));

// ----- Routes -----

// Home route - API status
app.get('/', (req, res) => {
    res.json({
        name: 'Pinch Receipt App',
        status: 'running',
        version: '1.0.0',
        endpoints: [
            'GET / — API status',
            'GET /receipts — List all receipts (JSON)',
            'GET /receipts/dashboard — View receipts dashboard',
            'GET /receipts/:paymentId — Get receipt by payment ID',
            'GET /receipts/view/:filename — View PDF in browser',
            'POST /webhooks/pinch — Pinch webhook endpoint',
            'GET /stats — Dashboard stats',
            'POST /test-payment — Simulate a test payment'
        ]
    });
});

// ----- Get all receipts (JSON) -----
app.get('/receipts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const receipts = await db.getAllReceipts(limit);
        res.json({
            success: true,
            count: receipts.length,
            receipts
        });
    } catch (error) {
        console.error('❌ Error fetching receipts:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----- View a specific receipt PDF -----
app.get('/receipts/view/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(receiptsDir, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Receipt not found');
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
});

// ----- Receipts dashboard (HTML view) -----
app.get('/receipts/dashboard', async (req, res) => {
    try {
        const receipts = await db.getAllReceipts(50);
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Pinch Receipts</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
                    h1 { color: #1a237e; }
                    .stats { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .stats span { margin-right: 30px; }
                    .stats .number { font-weight: bold; font-size: 20px; color: #1a237e; }
                    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
                    th { background: #1a237e; color: white; font-weight: 600; }
                    tr:hover { background: #f8f9ff; }
                    .view-link { color: #1a237e; text-decoration: none; font-weight: 500; }
                    .view-link:hover { text-decoration: underline; }
                    .status-pending { color: #ff9800; }
                    .status-generated { color: #4caf50; }
                    .status-sent { color: #2196f3; }
                    .status-failed { color: #f44336; }
                    .empty { text-align: center; color: #999; padding: 40px; }
                    .refresh { margin-top: 20px; color: #666; font-size: 14px; }
                    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
                </style>
            </head>
            <body>
                <h1>🧾 Pinch Receipts</h1>
                <div class="stats">
                    <span>📊 <strong>Total:</strong> <span class="number">${receipts.length}</span></span>
                    <span>⏳ <strong>Pending:</strong> <span class="number">${receipts.filter(r => r.status === 'pending').length}</span></span>
                    <span>✅ <strong>Generated:</strong> <span class="number">${receipts.filter(r => r.status === 'generated').length}</span></span>
                    <span>📤 <strong>Sent:</strong> <span class="number">${receipts.filter(r => r.status === 'sent').length}</span></span>
                </div>
        `;

        if (receipts.length === 0) {
            html += `
                <div class="empty">
                    <p>No receipts found. Process a test payment first:</p>
                    <code>curl -X POST http://localhost:${PORT}/test-payment \\</code><br>
                    <code>  -H "Content-Type: application/json" \\</code><br>
                    <code>  -d '{"email":"test@example.com","firstName":"John","lastName":"Doe","amount":2500,"reference":"INV-001"}'</code>
                </div>
            `;
        } else {
            html += `
                <table>
                    <tr>
                        <th>Payment ID</th>
                        <th>Customer</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Receipt</th>
                    </tr>
            `;

            receipts.forEach(receipt => {
                const hasPdf = receipt.pdf_path && fs.existsSync(receipt.pdf_path);
                const filename = receipt.pdf_path ? path.basename(receipt.pdf_path) : null;
                
                html += `
                    <tr>
                        <td><code>${receipt.pinch_payment_id}</code></td>
                        <td>${receipt.customer_name || 'Unknown'}<br><small style="color:#999;">${receipt.customer_email}</small></td>
                        <td><strong>$${(receipt.amount / 100).toFixed(2)}</strong></td>
                        <td class="status-${receipt.status}">${receipt.status}</td>
                        <td>
                            ${hasPdf ? 
                                `<a href="/receipts/view/${filename}" target="_blank" class="view-link">📄 View PDF</a>` : 
                                `<span style="color:#999;">⏳ Generating...</span>`
                            }
                        </td>
                    </tr>
                `;
            });

            html += `
                </table>
            `;
        }

        html += `
                <div class="refresh">
                    <p>🔄 Refresh page to see new receipts</p>
                    <p style="font-size:12px;color:#999;">PDFs are stored in /receipts folder</p>
                </div>
            </body>
            </html>
        `;

        res.send(html);

    } catch (error) {
        console.error('❌ Error loading dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

// ----- Get receipt by payment ID -----
app.get('/receipts/:paymentId', async (req, res) => {
    try {
        const receipt = await db.getReceiptByPaymentId(req.params.paymentId);
        if (!receipt) {
            return res.status(404).json({ error: 'Receipt not found' });
        }
        res.json({ success: true, receipt });
    } catch (error) {
        console.error('❌ Error fetching receipt:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----- Get stats -----
app.get('/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json({ success: true, stats });
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----- Test endpoint: Simulate a payment -----
app.post('/test-payment', async (req, res) => {
    try {
        const { email, firstName, lastName, amount, reference } = req.body;

        const testData = {
            id: `pmt_test_${Date.now()}`,
            payerId: `pyr_test_${Date.now()}`,
            amount: amount || 1000,
            currency: 'AUD',
            reference: reference || `TEST-INV-${Date.now()}`,
            payer: {
                emailAddress: email || 'test@example.com',
                firstName: firstName || 'Test',
                lastName: lastName || 'User'
            }
        };

        console.log('🔄 Test payment received:', testData);

        const result = await handlePaymentCreated(testData);

        res.json({
            success: true,
            message: 'Test payment processed',
            data: testData,
            result: result,
            receipt_url: `http://localhost:${PORT}/receipts/dashboard`
        });

    } catch (error) {
        console.error('❌ Test payment failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----- Webhook routes -----
app.use('/webhooks', webhookRoutes);

// ----- Error handling middleware -----
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

// ----- Setup webhook on startup -----
async function setupWebhook() {
    try {
        console.log('🔧 Setting up webhook...');
        
        // Check if webhook exists
        const webhooks = await getWebhooks();
        
        // Use ngrok URL or webhook.site for testing
        const publicUrl = process.env.PUBLIC_URL || 'https://webhook.site/your-id';
        
        // Look for existing webhook
        const existingWebhook = webhooks.data?.find(w => w.uri === publicUrl);
        
        if (existingWebhook) {
            console.log(`✅ Webhook already exists: ${existingWebhook.id}`);
            return;
        }
        
        // Create new webhook
        const newWebhook = await createWebhook(
            publicUrl,
            ['payment-created', 'payment.succeeded']
        );
        
        console.log(`✅ Webhook created: ${newWebhook.id}`);
        if (newWebhook.secret) {
            console.log(`🔑 Webhook Secret: ${newWebhook.secret}`);
            console.log('💡 Add this to your .env as WEBHOOK_SECRET');
        }
        
    } catch (error) {
        console.error('❌ Webhook setup failed:', error.message);
        console.log('💡 You can set up webhook manually in the Pinch dashboard');
        console.log('💡 Or test with: POST /test-payment');
    }
}

// ----- Start server -----
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║         PINCH RECEIPT APP                    ║
╠══════════════════════════════════════════════╣
║   🚀 Server running on http://localhost:${PORT}  ║
║   📊 Dashboard: http://localhost:${PORT}/receipts/dashboard   ║
║   📈 Stats: http://localhost:${PORT}/stats          ║
║   📄 Receipts: http://localhost:${PORT}/receipts           ║
╠══════════════════════════════════════════════╣
║   🧪 Test: POST /test-payment               ║
║   📨 Webhook: POST /webhooks/pinch          ║
║                                              ║
║   ✅ Email service REMOVED                   ║
║   📄 PDFs displayed in browser               ║
╚══════════════════════════════════════════════╝
    `);
});

module.exports = app;