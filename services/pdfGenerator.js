// ============================================
// services/pdfGenerator.js
// PURPOSE: Generate PDF receipts with Pinch branding
// ============================================

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const RECEIPTS_DIR = path.join(__dirname, '..', 'receipts');
if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// ----- Generate a clean PDF receipt with Pinch branding -----
async function generateReceipt(receiptData) {
    return new Promise((resolve, reject) => {
        try {
            const {
                id,
                pinch_payment_id,
                customer_name,
                customer_email,
                amount,
                currency = 'AUD',
                reference,
                receipt_text,
                created_at,
                store_name = 'Store',
                staff_name = 'Staff',
                invoice_number,
                line_items = []
            } = receiptData;

            const paymentId = pinch_payment_id || id || `pmt_${Date.now()}`;
            const filename = `receipt_${paymentId}_${Date.now()}.pdf`;
            const filePath = path.join(RECEIPTS_DIR, filename);

            // ✅ Create PDF with proper margins
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50,
                info: {
                    Title: `Receipt ${reference || paymentId}`,
                    Author: 'Pinch Payments',
                    Subject: 'Payment Receipt',
                    Creator: 'Pinch Receipt App'
                },
                compress: true
            });

            const writeStream = fs.createWriteStream(filePath);
            doc.pipe(writeStream);

            // ============================================================
            // HEADER: Pinch Branding
            // ============================================================
            
            // Pinch purple header bar
            doc.rect(0, 0, doc.page.width, 70)
               .fillColor('#1a237e')
               .fill();
            
            doc.fillColor('#ffffff')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text('PINCH', 50, 22)
               .fontSize(12)
               .font('Helvetica')
               .text('PAYMENTS', 50, 44);
            
            doc.fontSize(12)
               .text('RECEIPT', { align: 'right', width: doc.page.width - 50 })
               .fillColor('#e0e0e0')
               .fontSize(10)
               .text(`#${(reference || paymentId).slice(0, 12)}`, { align: 'right', width: doc.page.width - 50 });
            
            doc.y = 80;

            // ============================================================
            // STORE INFORMATION
            // ============================================================
            
            doc.fillColor('#1a237e')
               .fontSize(16)
               .font('Helvetica-Bold')
               .text(store_name || 'Store', 50, doc.y);
            
            doc.y += 5;
            doc.fillColor('#666666')
               .fontSize(10)
               .font('Helvetica')
               .text(`Invoice #: ${invoice_number || reference || 'N/A'}`, 50, doc.y);
            
            doc.y += 5;
            doc.text(`Date: ${new Date(created_at || Date.now()).toLocaleString('en-AU')}`, 50, doc.y);
            
            doc.y += 5;
            doc.text(`Staff: ${staff_name || 'N/A'}`, 50, doc.y);
            
            doc.y += 12;

            // ============================================================
            // DIVIDER
            // ============================================================
            
            doc.strokeColor('#e0e0e0')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            
            doc.y += 12;

            // ============================================================
            // LINE ITEMS TABLE — FIXED ALIGNMENT
            // ============================================================
            
            doc.fillColor('#333333')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('ITEMS', 50, doc.y);
            
            doc.y += 5;
            
            // Table headers with fixed positions
            const col1 = 50;      // Item name
            const col2 = 380;     // Qty
            const col3 = 430;     // Price
            const col4 = 490;     // Total
            const tableWidth = doc.page.width - 100;
            
            doc.fillColor('#666666')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('Item', col1, doc.y)
               .text('Qty', col2, doc.y, { width: 40, align: 'center' })
               .text('Price', col3, doc.y, { width: 60, align: 'right' })
               .text('Total', col4, doc.y, { width: 60, align: 'right' });
            
            doc.y += 4;
            doc.strokeColor('#e0e0e0')
               .lineWidth(0.5)
               .moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            
            let rowY = doc.y + 6;
            let subtotal = 0;
            
            // Get line items
            let items = line_items || [];
            
            // If no line_items, try to extract from receipt_text
            if (items.length === 0 && receipt_text) {
                const lines = receipt_text.split('\n');
                let parsingItems = false;
                for (const line of lines) {
                    if (line.includes('Items:') || line.includes('ITEMS')) {
                        parsingItems = true;
                        continue;
                    }
                    if (parsingItems && line.trim() && !line.includes('Total') && !line.includes('Subtotal')) {
                        const match = line.match(/(\d+)x\s+(.+?)\s*[-–]\s*\$?([\d.]+)/);
                        if (match) {
                            const qty = parseInt(match[1]);
                            const desc = match[2].trim();
                            const price = parseFloat(match[3]);
                            items.push({ description: desc, quantity: qty, amount: Math.round(price * 100) });
                        }
                    }
                    if (line.includes('Total')) {
                        parsingItems = false;
                    }
                }
            }
            
            // If still no items, use defaults
            if (items.length === 0) {
                items = [
                    { description: 'Hammer', quantity: 1, amount: 2500 },
                    { description: 'Paint', quantity: 2, amount: 1000 },
                    { description: 'Tape', quantity: 1, amount: 500 }
                ];
            }
            
            // Calculate subtotal and render items
            items.forEach(item => {
                const qty = item.quantity || 1;
                const price = item.amount || 0;
                const total = qty * price;
                subtotal += total;
                const desc = (item.description || 'Item').substring(0, 30);
                
                // ✅ Check if we need a new page
                if (rowY > doc.page.height - 120) {
                    doc.addPage();
                    rowY = 50;
                }
                
                doc.fontSize(9)
                   .font('Helvetica')
                   .fillColor('#333333')
                   .text(desc, col1, rowY, { width: 280 })
                   .text(qty.toString(), col2, rowY, { width: 40, align: 'center' })
                   .text(`$${(price / 100).toFixed(2)}`, col3, rowY, { width: 60, align: 'right' })
                   .text(`$${(total / 100).toFixed(2)}`, col4, rowY, { width: 60, align: 'right' });
                
                rowY += 16;
            });
            
            // ============================================================
            // TOTALS
            // ============================================================
            
            doc.y = rowY + 8;
            
            // Divider
            doc.strokeColor('#e0e0e0')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            
            doc.y += 8;
            
            const totalAmount = amount || subtotal;
            const gst = Math.round(totalAmount * 0.1);
            const subtotalWithoutGst = totalAmount - gst;
            
            // Right-aligned totals with fixed positions
            const totalLabelX = 400;
            const totalValueX = 490;
            
            doc.fillColor('#666666')
               .fontSize(9)
               .font('Helvetica')
               .text('Subtotal', totalLabelX, doc.y, { width: 80, align: 'right' })
               .text(`$${(subtotalWithoutGst / 100).toFixed(2)}`, totalValueX, doc.y, { width: 60, align: 'right' });
            
            doc.y += 16;
            doc.fillColor('#666666')
               .text('GST (10%)', totalLabelX, doc.y, { width: 80, align: 'right' })
               .text(`$${(gst / 100).toFixed(2)}`, totalValueX, doc.y, { width: 60, align: 'right' });
            
            doc.y += 16;
            
            // Total (bold, larger)
            doc.fillColor('#1a237e')
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('TOTAL', totalLabelX, doc.y, { width: 80, align: 'right' })
               .text(`${currency || 'AUD'} $${(totalAmount / 100).toFixed(2)}`, totalValueX, doc.y, { width: 70, align: 'right' });
            
            doc.y += 20;

            // ============================================================
            // PAYMENT DETAILS (Footer)
            // ============================================================
            
            // Divider
            doc.strokeColor('#e0e0e0')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            
            doc.y += 12;
            
            doc.fillColor('#666666')
               .fontSize(8)
               .font('Helvetica')
               .text(`Payment ID: ${paymentId}`, 50, doc.y)
               .text(`Reference: ${reference || 'N/A'}`, 50, doc.y + 12)
               .text(`Customer: ${customer_name || 'N/A'}`, 50, doc.y + 24)
               .text(`Email: ${customer_email || 'N/A'}`, 50, doc.y + 36);
            
            doc.y += 50;

            // ============================================================
            // FOOTER
            // ============================================================
            
            doc.fillColor('#1a237e')
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('Thank you for your payment!', { align: 'center' });
            
            doc.fillColor('#999999')
               .fontSize(8)
               .font('Helvetica')
               .text('This is a system-generated receipt from Pinch Payments.', { align: 'center' })
               .text(`Generated on ${new Date().toLocaleString('en-AU')}`, { align: 'center' });

            // ✅ Finalize PDF
            doc.end();

            writeStream.on('finish', () => {
                console.log(`✅ PDF generated: ${filename}`);
                resolve({
                    filename,
                    filePath,
                    pdfUrl: `/receipts/${filename}`
                });
            });

            writeStream.on('error', (err) => {
                console.error('❌ Write stream error:', err);
                reject(err);
            });

        } catch (error) {
            console.error('❌ PDF generation failed:', error);
            reject(error);
        }
    });
}

module.exports = {
    generateReceipt,
    RECEIPTS_DIR
};