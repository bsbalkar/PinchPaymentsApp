// ============================================
// server.js
// PURPOSE: Main Express server - COMPLETE
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Stripe = require('stripe');
const sqlite3 = require('sqlite3').verbose();

// ----- Initialize Express app -----
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ----- Import after app initialization -----
const db = require('./database/db');
const webhookRoutes = require('./routes/webhooks');
const { handlePaymentCreated } = webhookRoutes;

// ----- Initialize Stripe -----
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ============================================================
// DATABASE SETUP — AUTO-CREATE TABLES
// ============================================================

async function setupDatabase() {
    const dbPath = process.env.DATABASE_PATH || './database/receipts.db';
    
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS payers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pinch_payer_id TEXT UNIQUE NOT NULL,
                    email TEXT NOT NULL,
                    first_name TEXT,
                    last_name TEXT,
                    phone TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME
                )
            `, (err) => {
                if (err) console.error('❌ Error creating payers table:', err.message);
                else console.log('✅ payers table ready');
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS receipts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pinch_payment_id TEXT UNIQUE NOT NULL,
                    payer_id TEXT NOT NULL,
                    customer_email TEXT NOT NULL,
                    customer_name TEXT,
                    amount INTEGER NOT NULL,
                    currency TEXT DEFAULT 'AUD',
                    invoice_number TEXT,
                    reference TEXT,
                    receipt_text TEXT,
                    pdf_path TEXT,
                    pdf_url TEXT,
                    status TEXT DEFAULT 'pending',
                    webhook_received_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME
                )
            `, (err) => {
                if (err) console.error('❌ Error creating receipts table:', err.message);
                else console.log('✅ receipts table ready');
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON receipts(pinch_payment_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_email ON receipts(customer_email)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_payers_email ON payers(email)`);
        });

        db.close((err) => {
            if (err) reject(err);
            else {
                console.log('✅ Database setup complete at:', dbPath);
                resolve();
            }
        });
    });
}

// ============================================================
// PINCH API CONFIGURATION
// ============================================================

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

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get Pinch token');
        }

        pinchAccessToken = data.access_token;
        pinchTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;

        console.log('✅ Pinch token obtained successfully');
        return pinchAccessToken;

    } catch (error) {
        console.error('❌ Failed to get Pinch token:', error.message);
        throw new Error(`Pinch authentication failed: ${error.message}`);
    }
}

// ----- Create Pinch Payer -----
async function createPinchPayer(email, firstName, lastName) {
    try {
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

        if (!response.ok) {
            if (response.status === 409) {
                console.log('ℹ️ Payer already exists, searching...');
                const searchResponse = await fetch(`${PINCH_API_URL}payers?emailAddress=${encodeURIComponent(email)}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'pinch-version': '2020.1'
                    }
                });
                const searchData = await searchResponse.json();
                if (searchData.data && searchData.data.length > 0) {
                    return searchData.data[0];
                }
            }
            throw new Error(data.message || 'Failed to create payer');
        }

        console.log('✅ Payer created:', data.id);
        return data;

    } catch (error) {
        console.error('❌ Failed to create payer:', error.message);
        throw error;
    }
}

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());
app.use(express.json());

// ----- Direct HTML Routes -----
app.get('/demo.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});
app.get('/eftpos.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'eftpos.html'));
});
app.get('/demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});
app.get('/eftpos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'eftpos.html'));
});

// ----- Static Files -----
app.use(express.static(path.join(__dirname, 'public')));

// ----- Receipts Directory -----
const receiptsDir = path.join(__dirname, 'receipts');
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
}
app.use('/receipts', express.static(receiptsDir));

// ============================================================
// ROUTES
// ============================================================

// ----- Home -----
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----- Get all receipts -----
app.get('/receipts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const receipts = await db.getAllReceipts(limit);
        res.json({ success: true, count: receipts.length, receipts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----- View PDF -----
app.get('/receipts/view/:filename', (req, res) => {
    const filePath = path.join(receiptsDir, req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Receipt not found');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
    res.sendFile(filePath);
});

// ----- Dashboard -----
app.get('/receipts/dashboard', async (req, res) => {
    try {
        const receipts = await db.getAllReceipts(50);
        let html = `<!DOCTYPE html>
<html><head><title>Pinch Receipts</title>
<style>
body { font-family: Arial; max-width: 900px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
h1 { color: #1a237e; }
.stats { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
.stats span { margin-right: 30px; }
.stats .number { font-weight: bold; font-size: 20px; color: #1a237e; }
table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; }
th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
th { background: #1a237e; color: white; }
tr:hover { background: #f8f9ff; }
.view-link { color: #1a237e; text-decoration: none; font-weight: 500; }
.view-link:hover { text-decoration: underline; }
.status-pending { color: #ff9800; }
.status-generated { color: #4caf50; }
.empty { text-align: center; color: #999; padding: 40px; }
</style></head><body>
<h1>🧾 Pinch Receipts</h1>
<div class="stats">
<span>📊 <strong>Total:</strong> <span class="number">${receipts.length}</span></span>
<span>⏳ <strong>Pending:</strong> <span class="number">${receipts.filter(r => r.status === 'pending').length}</span></span>
<span>✅ <strong>Generated:</strong> <span class="number">${receipts.filter(r => r.status === 'generated').length}</span></span>
</div>`;

        if (receipts.length === 0) {
            html += `<div class="empty"><p>No receipts found.</p></div>`;
        } else {
            html += `<table><tr><th>Payment ID</th><th>Customer</th><th>Amount</th><th>Status</th><th>Receipt</th></tr>`;
            receipts.forEach(receipt => {
                const hasPdf = receipt.pdf_path && fs.existsSync(receipt.pdf_path);
                const filename = receipt.pdf_path ? path.basename(receipt.pdf_path) : null;
                html += `<tr>
                    <td><code>${receipt.pinch_payment_id}</code></td>
                    <td>${receipt.customer_name || 'Unknown'}</td>
                    <td><strong>$${(receipt.amount / 100).toFixed(2)}</strong></td>
                    <td class="status-${receipt.status}">${receipt.status}</td>
                    <td>${hasPdf ? `<a href="/receipts/view/${filename}" target="_blank" class="view-link">📄 View PDF</a>` : '⏳ Generating...'}</td>
                </tr>`;
            });
            html += `</table>`;
        }
        html += `</body></html>`;
        res.send(html);
    } catch (error) {
        res.status(500).send('Error loading dashboard');
    }
});

// ----- Get receipt by payment ID -----
app.get('/receipts/:paymentId', async (req, res) => {
    try {
        const receipt = await db.getReceiptByPaymentId(req.params.paymentId);
        if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
        res.json({ success: true, receipt });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----- Stats -----
app.get('/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// STRIPE ROUTES
// ============================================================

app.get('/stripe/invoice/:invoiceId', async (req, res) => {
    try {
        const invoiceId = req.params.invoiceId;
        const invoice = await stripe.invoices.retrieve(invoiceId);
        const lineItems = await stripe.invoices.listLineItems(invoiceId, { limit: 100 });
        res.json({ success: true, invoice, line_items: lineItems.data });
    } catch (error) {
        res.status(404).json({ error: error.message || 'Invoice not found' });
    }
});

// ============================================================
// EFTPOS - GENERATE QR ONLY (No Payment)
// ============================================================

app.post('/eftpos-generate', async (req, res) => {
    try {
        const { storeName, storeEmail, staffName, staffPhone, invoiceNumber, reference, items, subtotal, gstAmount, total, gstRate } = req.body;

        const customer = await stripe.customers.create({
            email: storeEmail || 'store@example.com',
            name: storeName || 'Store',
            metadata: { staff_name: staffName || 'N/A', staff_phone: staffPhone || 'N/A' }
        });

        for (const item of items) {
            await stripe.invoiceItems.create({
                customer: customer.id,
                amount: item.amount * (item.quantity || 1),
                currency: 'aud',
                description: `${item.description} - ${item.quantity || 1}x @ $${(item.amount / 100).toFixed(2)}`
            });
        }

        const invoice = await stripe.invoices.create({
            customer: customer.id,
            currency: 'aud',
            collection_method: 'send_invoice',
            days_until_due: 30,
            metadata: { store_name: storeName, staff_name: staffName, invoice_number: invoiceNumber, reference: reference || '', gst_rate: String(gstRate || 10) }
        });

        const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
        res.json({ success: true, invoice_id: finalizedInvoice.id, invoice_number: finalizedInvoice.number || invoiceNumber, total: finalizedInvoice.total, currency: finalizedInvoice.currency, customer_id: customer.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// CREATE PINCH PAYMENT LINK
// ============================================================

app.post('/create-payment', async (req, res) => {
    try {
        const { storeName, invoiceNumber, total, items } = req.body;

        const amountInCents = Math.round(total || 0);
        if (amountInCents < 100) {
            return res.status(400).json({ success: false, error: 'Amount must be at least $1.00 (100 cents)' });
        }

        const token = await getPinchToken();

        const payerEmail = `payer_${Date.now()}@example.com`;
        const payerResponse = await fetch(`${PINCH_API_URL}payers`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'pinch-version': '2020.1' },
            body: JSON.stringify({ emailAddress: payerEmail, firstName: 'Customer', lastName: String(Date.now()) })
        });

        const payerData = await payerResponse.json();
        if (!payerResponse.ok) {
            return res.status(500).json({ success: false, error: 'Payer creation failed: ' + JSON.stringify(payerData) });
        }

        const payerId = payerData.id;
        const invoiceRef = invoiceNumber || `INV-${Date.now()}`;
        const requestBody = {
            payerId: payerId,
            amount: amountInCents,
            currency: 'AUD',
            reference: invoiceRef,
            description: `Payment for ${storeName || 'Store'} - Invoice ${invoiceRef}`,
            allowedPaymentMethods: ['credit-card']
        };

        const paymentLinkResponse = await fetch(`${PINCH_API_URL}payment-links`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'pinch-version': '2020.1' },
            body: JSON.stringify(requestBody)
        });

        const paymentLinkData = await paymentLinkResponse.json();
        if (!paymentLinkResponse.ok) {
            return res.status(500).json({ success: false, error: paymentLinkData });
        }

        res.json({
            success: true,
            paymentLinkId: paymentLinkData.id,
            checkoutUrl: paymentLinkData.url || paymentLinkData.checkoutUrl,
            payerId: payerId,
            total: amountInCents,
            invoiceNumber: invoiceRef,
            storeName: storeName
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// CHECK PAYMENT STATUS — SINGLE VERSION
// ============================================================


// ============================================================
// CHECK PAYMENT STATUS — IMPROVED
// ============================================================

app.get('/check-payment/:paymentLinkId', async (req, res) => {
    try {
        const { paymentLinkId } = req.params;
        console.log(`🔍 Checking payment status for: ${paymentLinkId}`);

        const token = await getPinchToken();

        // Step 1: Get the payment link details
        const linkResponse = await fetch(`${PINCH_API_URL}payment-links/${paymentLinkId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'pinch-version': '2020.1'
            }
        });

        const linkData = await linkResponse.json();

        if (!linkResponse.ok) {
            console.error('❌ Failed to fetch payment link:', linkData);
            return res.status(500).json({
                success: false,
                error: linkData.message || 'Failed to fetch payment status'
            });
        }

        let paymentStatus = 'pending';
        let paymentId = null;
        let paymentAmount = linkData.amountInCents || 0;
        let paymentCurrency = linkData.currency || 'AUD';

        console.log(`📥 Payment link data:`, JSON.stringify(linkData, null, 2));

        // Step 2: Check if there are payments attached to this link
        if (linkData.payments && linkData.payments.length > 0) {
            // Get the most recent payment
            const latestPayment = linkData.payments[linkData.payments.length - 1];
            paymentId = latestPayment.id;
            paymentStatus = latestPayment.status || 'pending';
            
            console.log(`📊 Found payment: ${paymentId}, status: ${paymentStatus}`);
            
            // Step 3: If status is still 'processing' or 'pending', try to get more details
            if (paymentStatus === 'pending' || paymentStatus === 'processing') {
                try {
                    const paymentResponse = await fetch(`${PINCH_API_URL}payments/${paymentId}`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/json',
                            'pinch-version': '2020.1'
                        }
                    });
                    
                    const paymentData = await paymentResponse.json();
                    
                    if (paymentResponse.ok) {
                        console.log(`📊 Payment details:`, JSON.stringify(paymentData, null, 2));
                        // Check if payment has a more specific status
                        if (paymentData.status) {
                            paymentStatus = paymentData.status;
                        }
                        // Check if there are any events or transfers
                        if (paymentData.transfers && paymentData.transfers.length > 0) {
                            paymentStatus = 'approved';
                        }
                    }
                } catch (paymentError) {
                    console.warn('⚠️ Could not fetch payment details:', paymentError.message);
                }
            }
            
            // Step 4: Check if the payment has a successful status
            const successStatuses = ['approved', 'succeeded', 'completed', 'captured', 'settled'];
            if (successStatuses.includes(paymentStatus)) {
                paymentStatus = 'approved';
            }
            
            // Step 5: Check if payment is failed
            const failedStatuses = ['failed', 'declined', 'dishonoured', 'cancelled', 'refunded'];
            if (failedStatuses.includes(paymentStatus)) {
                paymentStatus = 'failed';
            }
        } else {
            // No payments yet - check if link has a status
            paymentStatus = linkData.status || 'pending';
            console.log(`📊 No payments found, link status: ${paymentStatus}`);
        }

        // Step 6: Final status
        console.log(`📊 Final status: ${paymentStatus}, Payment ID: ${paymentId || 'none'}`);

        res.json({
            success: true,
            paymentLinkId: paymentLinkId,
            status: paymentStatus,
            paymentId: paymentId,
            amount: paymentAmount,
            currency: paymentCurrency,
            description: linkData.description
        });

    } catch (error) {
        console.error('❌ Payment status check failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Payment status check failed'
        });
    }
});

// ============================================================
// GENERATE RECEIPT FROM PAYMENT
// ============================================================

app.post('/generate-receipt-from-payment', async (req, res) => {
    try {
        const { paymentId } = req.body;
        console.log('📄 Generating receipt for payment:', paymentId);

        const token = await getPinchToken();
        
        // Fetch payment details from Pinch
        const paymentResponse = await fetch(`${PINCH_API_URL}payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'pinch-version': '2020.1'
            }
        });

        const paymentData = await paymentResponse.json();
        
        if (!paymentResponse.ok) {
            throw new Error(paymentData.message || 'Failed to fetch payment details');
        }

        console.log('📊 Payment data:', JSON.stringify(paymentData, null, 2));

        // Build receipt data
        const receiptData = {
            id: paymentData.id,
            payerId: paymentData.payerId,
            amount: paymentData.amount,
            currency: paymentData.currency || 'AUD',
            reference: paymentData.reference || `INV-${Date.now()}`,
            payer: {
                emailAddress: paymentData.payer?.emailAddress || 'customer@example.com',
                firstName: paymentData.payer?.firstName || 'Customer',
                lastName: paymentData.payer?.lastName || 'User'
            },
            receipt_text: `PINCH PAYMENT RECEIPT\nPayment ID: ${paymentData.id}\nAmount: $${(paymentData.amount / 100).toFixed(2)}\nStatus: ${paymentData.status}`,
            store_name: paymentData.metadata?.store_name || 'Store',
            staff_name: paymentData.metadata?.staff_name || 'Staff',
            invoice_number: paymentData.reference || 'N/A',
            line_items: paymentData.metadata?.items ? JSON.parse(paymentData.metadata.items) : []
        };

        // Save to database
        await db.saveReceiptFromWebhook(receiptData);
        
        // Generate PDF
        const { generateReceipt } = require('./services/pdfGenerator');
        const pdfResult = await generateReceipt(receiptData);
        await db.updateReceiptWithPdf(paymentData.id, pdfResult.filePath, pdfResult.pdfUrl);

        console.log('✅ Receipt generated for:', paymentData.id);

        res.json({
            success: true,
            message: 'Receipt generated successfully',
            receipt: receiptData,
            pdfUrl: pdfResult.pdfUrl
        });

    } catch (error) {
        console.error('❌ Receipt generation failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});



app.post('/simulate-payment', async (req, res) => {
    try {
        const { storeName, invoiceNumber, total, items, payerId } = req.body;

        const fakePaymentId = `pmt_sim_${Date.now()}`;
        const amountInCents = Math.round(total || 5500);

        // ✅ Ensure we have a payer ID
        const payerIdToUse = payerId || `pyr_sim_${Date.now()}`;

        const receiptData = {
            id: fakePaymentId,
            payerId: payerIdToUse,
            amount: amountInCents,
            currency: 'AUD',
            reference: invoiceNumber || `INV-${Date.now()}`,
            payer: {
                emailAddress: 'customer@example.com',
                firstName: 'Customer',
                lastName: 'User'
            },
            receipt_text: `SIMULATED PAYMENT\nPayment ID: ${fakePaymentId}\nAmount: $${(amountInCents / 100).toFixed(2)}\nReference: ${invoiceNumber || 'N/A'}`,
            store_name: storeName || 'Store',
            staff_name: 'Staff',
            invoice_number: invoiceNumber || 'N/A',
            line_items: items || []
        };

        await db.saveReceiptFromWebhook(receiptData);
        // ... rest of code
    } catch (error) {
        // ...
    }
});





// ============================================================
// TEST WEBHOOK
// ============================================================

app.post('/test-webhook', async (req, res) => {
    try {
        const mockData = req.body || {
            type: 'payment.succeeded',
            data: {
                id: `pmt_test_${Date.now()}`,
                payerId: `pyr_test_${Date.now()}`,
                amount: 5500,
                currency: 'AUD',
                reference: 'INV-TEST-001',
                status: 'approved',
                payer: { emailAddress: 'test@example.com', firstName: 'Test', lastName: 'User' },
                metadata: { store_name: 'Bunnings Warehouse', staff_name: 'John Smith', items: JSON.stringify([{ description: 'Hammer', amount: 2500, quantity: 1 }, { description: 'Paint', amount: 1000, quantity: 2 }]) }
            }
        };

        const paymentData = mockData.data;
        const receiptData = {
            id: paymentData.id,
            payerId: paymentData.payerId,
            amount: paymentData.amount,
            currency: paymentData.currency || 'AUD',
            reference: paymentData.reference || 'N/A',
            payer: { emailAddress: paymentData.payer?.emailAddress || 'test@example.com', firstName: paymentData.payer?.firstName || 'Test', lastName: paymentData.payer?.lastName || 'User' },
            receipt_text: `TEST PAYMENT RECEIPT\nPayment ID: ${paymentData.id}\nAmount: $${(paymentData.amount / 100).toFixed(2)}`,
            store_name: paymentData.metadata?.store_name || 'Store',
            staff_name: paymentData.metadata?.staff_name || 'Staff',
            invoice_number: paymentData.reference || 'N/A'
        };

        await handlePaymentCreated(receiptData);
        const { generateReceipt } = require('./services/pdfGenerator');
        const pdfResult = await generateReceipt(receiptData);
        await db.updateReceiptWithPdf(paymentData.id, pdfResult.filePath, pdfResult.pdfUrl);

        res.json({ success: true, message: 'Webhook test completed' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// PINCH WEBHOOK
// ============================================================

app.post('/webhooks/pinch', async (req, res) => {
    try {
        const event = req.body;
        console.log('📨 Webhook received:', event.type);

        if (event.type === 'payment.succeeded' || event.type === 'payment-created') {
            const paymentData = event.data;
            const receiptData = {
                id: paymentData.id,
                payerId: paymentData.payerId,
                amount: paymentData.amount,
                currency: paymentData.currency || 'AUD',
                reference: paymentData.reference || 'N/A',
                payer: { emailAddress: paymentData.payer?.emailAddress || 'customer@example.com', firstName: paymentData.payer?.firstName || 'Customer', lastName: paymentData.payer?.lastName || 'User' },
                receipt_text: `PINCH PAYMENT RECEIPT\nPayment ID: ${paymentData.id}\nAmount: $${(paymentData.amount / 100).toFixed(2)}\nReference: ${paymentData.reference || 'N/A'}\nStatus: ${paymentData.status || 'approved'}`,
                store_name: paymentData.metadata?.store_name || 'Store',
                staff_name: paymentData.metadata?.staff_name || 'Staff',
                invoice_number: paymentData.reference || 'N/A',
                line_items: paymentData.metadata?.items ? JSON.parse(paymentData.metadata.items) : []
            };

            await handlePaymentCreated(receiptData);
            const { generateReceipt } = require('./services/pdfGenerator');
            const pdfResult = await generateReceipt(receiptData);
            await db.updateReceiptWithPdf(paymentData.id, pdfResult.filePath, pdfResult.pdfUrl);
            console.log('✅ Receipt generated for:', paymentData.id);
        }

        res.status(200).json({ received: true });

    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// SERVE PINCH PUBLISHABLE KEY
// ============================================================

app.get('/api/pinch-config', (req, res) => {
    res.json({ publishableKey: process.env.PINCH_PUBLISHABLE_KEY || '' });
});

// ============================================================
// WEBHOOKS ROUTER
// ============================================================

app.use('/webhooks', webhookRoutes);

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    res.status(500).json({ success: false, error: err.message });
});

// ============================================================
// START SERVER
// ============================================================

(async function startServer() {
    try {
        await setupDatabase();
        console.log('✅ Database ready');

        app.listen(PORT, () => {
            console.log(`
╔══════════════════════════════════════════════╗
║         PINCH RECEIPT APP v2.0              ║
╠══════════════════════════════════════════════╣
║   🚀 Server: http://localhost:${PORT}           ║
║   📊 Dashboard: /receipts/dashboard         ║
║   📱 EFTPOS: /eftpos.html                   ║
║   🧾 Customer: /demo.html                   ║
║   💳 Payments: ENABLED                     ║
╚══════════════════════════════════════════════╝
            `);
        });

    } catch (error) {
        console.error('❌ Server startup failed:', error);
        process.exit(1);
    }
})();

module.exports = app;