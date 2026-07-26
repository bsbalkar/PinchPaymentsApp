// ============================================
// routes/webhooks.js
// PURPOSE: Handle webhooks from Pinch and Stripe
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { generateReceipt } = require('../services/pdfGenerator');

// ----- Handle Pinch payment created event -----
async function handlePinchPayment(paymentData) {
    console.log('💳 Pinch payment received:', paymentData.id);

    try {
        // 1. Save receipt to database
        const result = await db.saveReceiptFromPinch(paymentData);
        console.log('✅ Receipt saved to database');

        // 2. Get the full receipt record
        const receipt = await db.getReceiptByPaymentId(paymentData.id);
        if (!receipt) {
            throw new Error('Receipt not found after save');
        }

        // 3. Generate PDF
        const pdfResult = await generateReceipt(receipt);
        console.log('✅ PDF generated:', pdfResult.filename);

        // 4. Update database with PDF path
        await db.updateReceiptWithPdf(
            paymentData.id,
            pdfResult.filePath,
            pdfResult.pdfUrl
        );

        console.log(`✅ Complete: Pinch payment ${paymentData.id} processed`);

        return {
            success: true,
            paymentId: paymentData.id,
            pdfUrl: pdfResult.pdfUrl,
            pdfPath: pdfResult.filePath
        };

    } catch (error) {
        console.error('❌ Error processing Pinch payment:', error);
        throw error;
    }
}

// ----- Webhook endpoint -----
router.post('/pinch', async (req, res) => {
    console.log('📨 Pinch webhook received:', req.body);

    try {
        const event = req.body;

        // Verify webhook secret (optional)
        const webhookSecret = req.headers['x-webhook-secret'];
        if (process.env.WEBHOOK_SECRET && webhookSecret !== process.env.WEBHOOK_SECRET) {
            console.warn('⚠️ Invalid webhook secret');
            return res.status(401).json({ error: 'Invalid webhook secret' });
        }

        // Handle different event types
        switch (event.type) {
            case 'payment-created':
            case 'payment.succeeded':
                await handlePinchPayment(event.data);
                break;

            case 'payment.failed':
                console.log('💳 Pinch payment failed:', event.data.id);
                break;

            default:
                console.log(`📌 Unhandled event type: ${event.type}`);
        }

        res.status(200).json({ received: true });

    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----- Test webhook endpoint -----
router.post('/test', async (req, res) => {
    console.log('🧪 Test webhook received:', req.body);

    try {
        const result = await handlePinchPayment(req.body);
        res.status(200).json({
            success: true,
            message: 'Test payment processed',
            result
        });
    } catch (error) {
        console.error('❌ Test webhook failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----- Legacy Stripe webhook support -----
router.post('/stripe', async (req, res) => {
    console.log('📨 Stripe webhook received:', req.body);

    try {
        const event = req.body;

        // Handle Stripe invoice events
        if (event.type === 'invoice.payment_succeeded') {
            const paymentData = {
                id: event.data.object.id,
                amount: event.data.object.total,
                currency: event.data.object.currency,
                payer: {
                    emailAddress: event.data.object.customer_email || 'customer@example.com',
                    firstName: 'Store',
                    lastName: 'Customer'
                }
            };
            await handlePinchPayment(paymentData);
        }

        res.status(200).json({ received: true });

    } catch (error) {
        console.error('❌ Stripe webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----- EXPORT -----
module.exports = router;
module.exports.handlePaymentCreated = handlePinchPayment;