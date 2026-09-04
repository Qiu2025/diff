import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Version 1 PDF
const doc1 = new jsPDF();
doc1.setCreationDate("D:20250101000000+00'00'");
doc1.setFileId('00000000000000000000000000000001');
doc1.setFontSize(16);
doc1.text('Software License Agreement', 20, 20);
doc1.setFontSize(12);
doc1.text('Version 1.0', 20, 30);
doc1.text('Effective Date: January 1, 2025', 20, 40);

doc1.setFontSize(11);
let y = 55;

doc1.text('1. Grant of License', 20, y);
y += 10;
doc1.text('The licensor grants you a non-exclusive license to use this software.', 25, y);
y += 10;
doc1.text('This license is valid for one year from the purchase date.', 25, y);
y += 15;

doc1.text('2. Permitted Uses', 20, y);
y += 10;
doc1.text('You may install the software on up to 3 devices.', 25, y);
y += 10;
doc1.text('You may use the software for personal purposes only.', 25, y);
y += 15;

doc1.text('3. Restrictions', 20, y);
y += 10;
doc1.text('You may not distribute, sell, or sublicense the software.', 25, y);
y += 10;
doc1.text('You may not reverse engineer or decompile the software.', 25, y);
y += 15;

doc1.text('4. Support and Updates', 20, y);
y += 10;
doc1.text('Technical support is provided via email only.', 25, y);
y += 10;
doc1.text('Updates are provided at our discretion.', 25, y);
y += 15;

doc1.text('5. Warranty', 20, y);
y += 10;
doc1.text('The software is provided "as is" without warranty.', 25, y);
y += 10;
doc1.text('We do not guarantee uninterrupted service.', 25, y);
y += 15;

doc1.text('6. Termination', 20, y);
y += 10;
doc1.text('This license terminates if you breach any terms.', 25, y);

// Add second page
doc1.addPage();
y = 20;

doc1.setFontSize(16);
doc1.text('Additional Terms', 20, y);
y += 15;

doc1.setFontSize(11);
doc1.text('7. Liability Limitation', 20, y);
y += 10;
doc1.text('We are not liable for any damages arising from use of the software.', 25, y);
y += 10;
doc1.text('Maximum liability is limited to the purchase price.', 25, y);
y += 15;

doc1.text('8. Dispute Resolution', 20, y);
y += 10;
doc1.text('Any disputes will be resolved through arbitration.', 25, y);
y += 10;
doc1.text('Arbitration will take place in New York.', 25, y);
y += 15;

doc1.text('9. Governing Law', 20, y);
y += 10;
doc1.text('This agreement is governed by the laws of New York.', 25, y);
y += 15;

doc1.text('10. Contact Information', 20, y);
y += 10;
doc1.text('Email: support@example.com', 25, y);
y += 10;
doc1.text('Phone: (555) 123-4567', 25, y);
y += 15;

doc1.text('By using this software, you agree to these terms and conditions.', 20, y);

// Save Version 1
const outputPath1 = path.join(__dirname, '../public/demo-original.pdf');
fs.writeFileSync(outputPath1, Buffer.from(doc1.output('arraybuffer')));
console.log('Created demo-original.pdf');

// Create Version 2 PDF (Modified)
const doc2 = new jsPDF();
doc2.setCreationDate("D:20250301000000+00'00'");
doc2.setFileId('00000000000000000000000000000002');
doc2.setFontSize(16);
doc2.text('Software License Agreement', 20, 20);
doc2.setFontSize(12);
doc2.text('Version 2.0', 20, 30);
doc2.text('Effective Date: March 1, 2025', 20, 40);

doc2.setFontSize(11);
y = 55;

doc2.text('1. Grant of License', 20, y);
y += 10;
doc2.text('The licensor grants you a non-exclusive, worldwide license to use this software.', 25, y);
y += 10;
doc2.text('This license is perpetual and does not expire.', 25, y);
y += 15;

doc2.text('2. Permitted Uses', 20, y);
y += 10;
doc2.text('You may install the software on up to 5 devices.', 25, y);
y += 10;
doc2.text('You may use the software for both personal and commercial purposes.', 25, y);
y += 10;
doc2.text('You may create backup copies of the software.', 25, y);
y += 15;

doc2.text('3. Restrictions', 20, y);
y += 10;
doc2.text('You may not distribute, sell, or sublicense the software.', 25, y);
y += 10;
doc2.text('You may not reverse engineer or decompile the software.', 25, y);
y += 10;
doc2.text('You may not remove any copyright notices from the software.', 25, y);
y += 15;

doc2.text('4. Support and Updates', 20, y);
y += 10;
doc2.text('Technical support is provided via email and live chat.', 25, y);
y += 10;
doc2.text('Free updates are provided for one year from purchase.', 25, y);
y += 10;
doc2.text('Extended support is available for an additional fee.', 25, y);
y += 15;

doc2.text('5. Warranty', 20, y);
y += 10;
doc2.text('The software is provided "as is" without warranty.', 25, y);
y += 10;
doc2.text('We do not guarantee uninterrupted service.', 25, y);
y += 10;
doc2.text('However, we will fix critical bugs within 30 days of reporting.', 25, y);
y += 15;

doc2.text('6. Termination', 20, y);
y += 10;
doc2.text('This license terminates if you breach any terms.', 25, y);
y += 10;
doc2.text('Upon termination, you must delete all copies of the software.', 25, y);
y += 15;

// Add second page
doc2.addPage();
y = 20;

doc2.setFontSize(16);
doc2.text('Additional Terms', 20, y);
y += 15;

doc2.setFontSize(11);
doc2.text('7. Privacy', 20, y);
y += 10;
doc2.text('We collect minimal usage data to improve the software.', 25, y);
y += 10;
doc2.text('Your data is never sold to third parties.', 25, y);
y += 15;

doc2.text('8. Liability Limitation', 20, y);
y += 10;
doc2.text('We are not liable for any damages arising from use of the software.', 25, y);
y += 10;
doc2.text('Maximum liability is limited to twice the purchase price.', 25, y);
y += 10;
doc2.text('This limitation applies to all claims, whether in contract or tort.', 25, y);
y += 15;

doc2.text('9. Dispute Resolution', 20, y);
y += 10;
doc2.text('Any disputes will be resolved through mediation first.', 25, y);
y += 10;
doc2.text('If mediation fails, disputes will go to arbitration.', 25, y);
y += 10;
doc2.text('Arbitration will take place in California.', 25, y);
y += 15;

doc2.text('10. Governing Law', 20, y);
y += 10;
doc2.text('This agreement is governed by the laws of California.', 25, y);
y += 10;
doc2.text('The UN Convention on Contracts does not apply.', 25, y);
y += 15;

doc2.text('11. Contact Information', 20, y);
y += 10;
doc2.text('Email: support@example.com', 25, y);
y += 10;
doc2.text('Phone: (555) 123-4567', 25, y);
y += 10;
doc2.text('Website: https://www.example.com/support', 25, y);
y += 15;

doc2.text('By using this software, you agree to these terms and conditions.', 20, y);
y += 10;
doc2.text('Last updated: March 1, 2025', 20, y);

// Save Version 2
const outputPath2 = path.join(__dirname, '../public/demo-modified.pdf');
fs.writeFileSync(outputPath2, Buffer.from(doc2.output('arraybuffer')));
console.log('Created demo-modified.pdf');

console.log('Demo PDFs generated successfully!');
