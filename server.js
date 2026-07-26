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

// ----- Initialize Express app -----
const app = express();
const PORT = process.env.PORT || 5000;

// ----- Import after app initialization -----
const db = require('./database/db');
const webhookRoutes = require('./routes/webhooks');
const { handlePaymentCreated } = webhookRoutes;

// ----- Initialize Stripe -----
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
            // If payer already exists, try to find existing one
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

// ----- Process Payment with Pinch API (Realtime) -----
async function processPinchPayment(payerId, amount, reference, description = 'Payment') {
    try {
        const token = await getPinchToken();

        const requestBody = {
            payerId: payerId,
            amount: amount, // in cents
            currency: 'AUD',
            reference: reference || `PAY-${Date.now()}`,
            description: description,
            source: {
                type: 'card'
            }
        };

        console.log('💳 Sending Pinch payment request:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${PINCH_API_URL}payments/realtime`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'pinch-version': '2020.1'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Pinch payment error response:', JSON.stringify(data, null, 2));
            throw new Error(data.message || data.error || 'Payment failed');
        }

        console.log('✅ Payment processed:', data.id);
        return data;

    } catch (error) {
        console.error('❌ Pinch payment failed:', error.message);
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
    res.json({
        name: 'Pinch Receipt App',
        status: 'running',
        version: '2.0.0',
        endpoints: [
            'GET / — API status',
            'GET /receipts/dashboard — Dashboard',
            'GET /receipts — All receipts (JSON)',
            'GET /stats — Stats',
            'POST /test-payment — Test payment with Pinch',
            'POST /webhooks/pinch — Pinch webhook',
            'GET /stripe/invoice/:invoiceId — Fetch Stripe invoice',
            'POST /eftpos-generate — Generate QR invoice',
            'POST /process-stripe-invoice — Process invoice to receipt',
            'GET /demo.html — Customer app',
            'GET /eftpos.html — EFTPOS simulator'
        ]
    });
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

// ----- Fetch Stripe invoice -----
app.get('/stripe/invoice/:invoiceId', async (req, res) => {
    try {
        const invoiceId = req.params.invoiceId;
        console.log('🔄 Fetching Stripe invoice:', invoiceId);

        const invoice = await stripe.invoices.retrieve(invoiceId);
        const lineItems = await stripe.invoices.listLineItems(invoiceId, { limit: 100 });

        res.json({
            success: true,
            invoice_id: invoiceId,
            invoice: invoice,
            line_items: lineItems.data,
            total: invoice.total,
            currency: invoice.currency,
            number: invoice.number,
            customer_name: invoice.customer_name,
            customer_email: invoice.customer_email,
            status: invoice.status,
            created: invoice.created,
            metadata: invoice.metadata
        });
    } catch (error) {
        console.error('❌ Error fetching Stripe invoice:', error);
        res.status(404).json({
            success: false,
            error: error.message || 'Invoice not found'
        });
    }
});

// ----- Process Stripe invoice to receipt -----
app.post('/process-stripe-invoice', async (req, res) => {
    try {
        const result = await handlePaymentCreated(req.body);
        res.json({ success: true, message: 'Receipt generated', result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// EFTPOS - GENERATE QR ONLY (No Payment)
// ============================================================

app.post('/eftpos-generate', async (req, res) => {
    try {
        const { storeName, storeEmail, staffName, staffPhone, invoiceNumber, reference, items, subtotal, gstAmount, total, gstRate } = req.body;

        console.log('📄 QR Generation:', storeName, invoiceNumber, (total / 100).toFixed(2));

        // Create customer in Stripe
        const customer = await stripe.customers.create({
            email: storeEmail || 'store@example.com',
            name: storeName || 'Store',
            metadata: { staff_name: staffName || 'N/A', staff_phone: staffPhone || 'N/A' }
        });

        // Create invoice items
        for (const item of items) {
            await stripe.invoiceItems.create({
                customer: customer.id,
                amount: item.amount * (item.quantity || 1),
                currency: 'aud',
                description: `${item.description} - ${item.quantity || 1}x @ $${(item.amount / 100).toFixed(2)}`
            });
        }

        // Create and finalize invoice
        const invoice = await stripe.invoices.create({
            customer: customer.id,
            currency: 'aud',
            collection_method: 'send_invoice',
            days_until_due: 30,
            metadata: {
                store_name: storeName,
                staff_name: staffName,
                invoice_number: invoiceNumber,
                reference: reference || '',
                gst_rate: String(gstRate || 10)
            }
        });

        const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

        res.json({
            success: true,
            invoice_id: finalizedInvoice.id,
            invoice_number: finalizedInvoice.number || invoiceNumber,
            total: finalizedInvoice.total,
            currency: finalizedInvoice.currency,
            customer_id: customer.id,
            store_name: storeName,
            staff_name: staffName,
            invoice_number_display: invoiceNumber
        });

    } catch (error) {
        console.error('❌ QR generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// TEST PAYMENT WITH PINCH API
// ============================================================

app.post('/test-payment', async (req, res) => {
    try {
        const { email, firstName, lastName, amount, reference, items } = req.body;

        console.log('💳 Test payment request:', { email, firstName, lastName, amount, reference });

        // Step 1: Create Payer in Pinch
        const payer = await createPinchPayer(email, firstName, lastName);
        console.log('✅ Payer created/found:', payer.id);

        // Step 2: Process payment with Pinch
        const payment = await processPinchPayment(
            payer.id,
            amount || 1000,
            reference || `INV-${Date.now()}`,
            `Payment for ${reference || 'invoice'}`
        );
        console.log('✅ Payment processed:', payment.id);

        // Step 3: Generate receipt text
        let receiptText = `═══════════════════════════════════════\n`;
        receiptText += `           PINCH RECEIPT\n`;
        receiptText += `═══════════════════════════════════════\n`;
        receiptText += `Payment ID:   ${payment.id}\n`;
        receiptText += `Payer:        ${firstName || 'Customer'} ${lastName || ''}\n`;
        receiptText += `Amount:       AUD $${(payment.amount / 100).toFixed(2)}\n`;
        receiptText += `Reference:    ${payment.reference || reference}\n`;
        receiptText += `Status:       ${payment.status || 'approved'}\n`;
        receiptText += `Date:         ${new Date().toLocaleString()}\n`;

        if (items && items.length > 0) {
            receiptText += `\n--- Items ---\n`;
            items.forEach(item => {
                receiptText += `  ${item.description || 'Item'} × ${item.quantity || 1} - $${(item.amount / 100).toFixed(2)}\n`;
            });
            const total = items.reduce((sum, i) => sum + (i.amount * (i.quantity || 1)), 0);
            receiptText += `─────────────────────────────────────\n`;
            receiptText += `  Total: AUD $${(total / 100).toFixed(2)}\n`;
        }
        receiptText += `═══════════════════════════════════════\n`;
        receiptText += `  Thank you for your payment!`;

        // Step 4: Save to database
        const receiptData = {
            id: payment.id,
            payerId: payer.id,
            amount: payment.amount,
            currency: payment.currency || 'AUD',
            reference: payment.reference || reference,
            payer: {
                emailAddress: payer.emailAddress || email,
                firstName: payer.firstName || firstName,
                lastName: payer.lastName || lastName
            },
            receipt_text: receiptText,
            pinch_payment: payment,
            line_items: items || []
        };

        const result = await handlePaymentCreated(receiptData);

        res.json({
            success: true,
            message: 'Payment processed with Pinch API',
            payment: payment,
            payer: payer,
            receipt_url: `/receipts/dashboard`,
            result: result
        });

    } catch (error) {
        console.error('❌ Pinch payment failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Payment processing failed'
        });
    }
});

// ============================================================
// WEBHOOKS
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

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║         PINCH RECEIPT APP v2.0              ║
╠══════════════════════════════════════════════╣
║   🚀 Server: http://localhost:${PORT}           ║
║   📊 Dashboard: /receipts/dashboard         ║
║   📱 EFTPOS: /eftpos.html                   ║
║   🧾 Customer: /demo.html                   ║
║   💳 Pinch Payments: ENABLED               ║
╚══════════════════════════════════════════════╝
    `);
});

module.exports = app;