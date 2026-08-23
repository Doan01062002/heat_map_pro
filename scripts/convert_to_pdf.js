const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function convertMarkdownToPdf() {
  const rootDir = path.join(__dirname, '..');
  const mdPath = path.join(rootDir, 'docs', 'TECHNICAL_DOCUMENTATION.md');
  const tempBodyPath = path.join(rootDir, 'docs', 'temp_body.html');
  const finalHtmlPath = path.join(rootDir, 'docs', 'TECHNICAL_DOCUMENTATION.html');
  const pdfPath = path.join(rootDir, 'docs', 'TECHNICAL_DOCUMENTATION.pdf');

  // 1. Compile exact markdown to HTML via marked CLI
  execSync(`npx -y marked -i "${mdPath}" -o "${tempBodyPath}" --gfm`, {
    cwd: rootDir,
    stdio: 'inherit'
  });

  const bodyHtml = fs.readFileSync(tempBodyPath, 'utf8');

  // Clean temp file
  if (fs.existsSync(tempBodyPath)) {
    fs.unlinkSync(tempBodyPath);
  }

  // 2. Build full HTML document with clean, professional light styling
  const fullHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tài Liệu Kỹ Thuật — Hệ Thống Bản Đồ Nhiệt</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

    @page {
      size: A4;
      margin: 18mm 15mm 18mm 15mm;
      @bottom-right {
        content: counter(page);
        font-family: 'Inter', sans-serif;
        font-size: 8.5pt;
        color: #64748b;
      }
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.6;
      color: #1e293b;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }

    /* Document Title H1 */
    h1:first-of-type {
      font-size: 18pt;
      font-weight: 800;
      color: #0f172a;
      border-bottom: 2.5px solid #2563eb;
      padding-bottom: 8px;
      margin-top: 0;
      margin-bottom: 12px;
      line-height: 1.35;
    }

    /* Metadata Blockquote exactly like Markdown */
    blockquote {
      margin: 10px 0 18px 0;
      padding: 10px 16px;
      background-color: #f8fafc;
      border-left: 4px solid #3b82f6;
      color: #334155;
      font-size: 9.5pt;
      line-height: 1.6;
      border-radius: 0 6px 6px 0;
    }

    blockquote p {
      margin: 3px 0;
    }

    /* Section Headings */
    h1 {
      font-size: 15pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 26px;
      margin-bottom: 12px;
      page-break-after: avoid;
      break-after: avoid;
    }

    h2 {
      font-size: 12.5pt;
      font-weight: 700;
      color: #0f172a;
      margin-top: 22px;
      margin-bottom: 10px;
      page-break-after: avoid;
      break-after: avoid;
    }

    h3 {
      font-size: 11pt;
      font-weight: 600;
      color: #1e293b;
      margin-top: 16px;
      margin-bottom: 8px;
      page-break-after: avoid;
      break-after: avoid;
    }

    h4 {
      font-size: 10pt;
      font-weight: 600;
      color: #334155;
      margin-top: 12px;
      margin-bottom: 6px;
      page-break-after: avoid;
      break-after: avoid;
    }

    p {
      margin: 6px 0 10px 0;
      text-align: justify;
    }

    hr {
      border: 0;
      height: 1px;
      background: #e2e8f0;
      margin: 18px 0;
    }

    /* Lists */
    ul, ol {
      margin: 6px 0 12px 0;
      padding-left: 24px;
    }

    li {
      margin-bottom: 3px;
    }

    /* Links */
    a {
      color: #2563eb;
      text-decoration: none;
    }

    strong {
      color: #0f172a;
      font-weight: 600;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 16px 0;
      font-size: 8.8pt;
      page-break-inside: avoid;
      break-inside: avoid;
      background: #ffffff;
    }

    th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
      text-align: left;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
    }

    td {
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      color: #334155;
      vertical-align: top;
    }

    tr:nth-child(even) td {
      background-color: #f8fafc;
    }

    /* Inline Code */
    code {
      font-family: 'Consolas', 'Courier New', 'JetBrains Mono', monospace;
      font-size: 8.8pt;
      background-color: #f1f5f9;
      color: #0369a1;
      padding: 1.5px 4.5px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    /* Code Blocks & ASCII Diagrams: Perfectly aligned, Clean Light Background, NO Black Box */
    pre {
      background-color: #f8fafc !important;
      color: #0f172a !important;
      border: 1.2px solid #cbd5e1 !important;
      border-radius: 6px;
      padding: 12px 14px;
      margin: 12px 0 16px 0;
      overflow-x: auto;
      page-break-inside: avoid;
      break-inside: avoid;
      
      /* Perfect monospace alignment for ASCII diagrams */
      font-family: 'Consolas', 'Courier New', 'Lucida Console', monospace !important;
      font-size: 7.6pt !important;
      line-height: 1.28 !important;
      letter-spacing: 0 !important;
      white-space: pre !important;
      tab-size: 4;
      font-variant-east-asian: normal;
    }

    pre code {
      background: transparent !important;
      color: inherit !important;
      padding: 0 !important;
      border: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      line-height: inherit !important;
      letter-spacing: inherit !important;
      white-space: pre !important;
    }

    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      pre, table, blockquote {
        page-break-inside: avoid;
        break-inside: avoid;
      }
      h1, h2, h3, h4 {
        page-break-after: avoid;
        break-after: avoid;
      }
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;

  fs.writeFileSync(finalHtmlPath, fullHtml, 'utf8');
  console.log('Generated HTML at:', finalHtmlPath);

  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const edgeBin = edgePaths.find(p => fs.existsSync(p));

  if (!edgeBin) {
    throw new Error('Microsoft Edge executable not found!');
  }

  console.log('Printing to PDF via Edge Headless...');
  const cmd = `"${edgeBin}" --headless --disable-gpu --run-all-compositor-stages-before-draw --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${finalHtmlPath}"`;
  execSync(cmd, { stdio: 'inherit' });

  if (fs.existsSync(pdfPath)) {
    const stats = fs.statSync(pdfPath);
    console.log(`\n✅ THÀNH CÔNG! Đã cập nhật PDF: ${pdfPath} (${(stats.size / 1024).toFixed(1)} KB)`);
  }
}

convertMarkdownToPdf();
