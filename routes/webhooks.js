// routes/webhooks.js
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { generateReceipt } = require('../services/pdfGenerator');
const { handlePaymentCreated } = require('./webhooks');

// Pinch webhook endpoint
router.post('/pinch', async (req, res) => {
    try {
        const event = req.body;

        console.log('📨 Webhook received:', event.type);

        if (event.type === 'payment.succeeded' || event.type === 'payment-created') {
            const paymentData = event.data;

            console.log('💰 Payment succeeded:', paymentData.id);

            // Generate receipt
            const receiptData = {
                id: paymentData.id,
                payerId: paymentData.payerId,
                amount: paymentData.amount,
                currency: paymentData.currency || 'AUD',
                reference: paymentData.reference,
                payer: {
                    emailAddress: paymentData.payer?.emailAddress || 'customer@example.com',
                    firstName: paymentData.payer?.firstName || 'Customer',
                    lastName: paymentData.payer?.lastName || 'User'
                },
                receipt_text: `PINCH PAYMENT RECEIPT\nPayment ID: ${paymentData.id}\nAmount: $${(paymentData.amount / 100).toFixed(2)}\nReference: ${paymentData.reference}\nStatus: ${paymentData.status}`,
                store_name: paymentData.metadata?.store_name || 'Store',
                staff_name: paymentData.metadata?.staff_name || 'Staff',
                invoice_number: paymentData.reference,
                line_items: paymentData.metadata?.items ? JSON.parse(paymentData.metadata.items) : []
            };

            await handlePaymentCreated(receiptData);

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

module.exports = router;