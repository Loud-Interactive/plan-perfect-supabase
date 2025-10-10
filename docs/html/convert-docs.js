#!/usr/bin/env node

/**
 * Documentation to HTML Converter
 * Converts markdown documentation files to styled HTML with Mermaid diagrams
 * Uses Loud Interactive brand colors and styling
 */

const fs = require('fs');
const path = require('path');

// Simple markdown to HTML converter
function convertMarkdownToHTML(markdown) {
  let html = markdown;

  // Convert headers
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');

  // Convert code blocks with language specification
  html = html.replace(/```(\w+)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Convert inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Convert mermaid diagrams
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, '<div class="mermaid">$1</div>');

  // Convert ASCII diagrams
  html = html.replace(/```\n([\s\S]*?[│┌└├─┬┴┤┐┘►▼][\s\S]*?)```/g, '<pre class="ascii-diagram">$1</pre>');

  // Convert tables
  html = convertTables(html);

  // Convert bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Convert italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Convert unordered lists
  html = convertLists(html);

  // Convert blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Convert emojis/badges at start of lines
  html = html.replace(/^(📚|⚡|🔄|📊|🔁|🎯|⏱️|🧮|🔍|📈|✅|❌|⚠️|📝|ℹ️) (.+)$/gm,
    (match, emoji, text) => {
      let className = 'alert-info';
      if (emoji === '⚠️') className = 'alert-warning';
      if (emoji === '✅') className = 'alert-success';
      if (emoji === '📝') className = 'alert-note';
      return `<div class="alert ${className}"><div>${text}</div></div>`;
    });

  // Convert paragraphs (lines that don't start with HTML tags)
  const lines = html.split('\n');
  const processedLines = [];
  let inParagraph = false;

  for (let line of lines) {
    if (line.trim() === '') {
      if (inParagraph) {
        processedLines.push('</p>');
        inParagraph = false;
      }
      processedLines.push('');
    } else if (line.match(/^<[h1-6|div|pre|ul|ol|table|blockquote]/)) {
      if (inParagraph) {
        processedLines.push('</p>');
        inParagraph = false;
      }
      processedLines.push(line);
    } else if (!line.match(/^<\/[h1-6|div|pre|ul|ol|li|table|blockquote]/)) {
      if (!inParagraph) {
        processedLines.push('<p>');
        inParagraph = true;
      }
      processedLines.push(line);
    } else {
      processedLines.push(line);
    }
  }

  if (inParagraph) {
    processedLines.push('</p>');
  }

  return processedLines.join('\n');
}

function convertTables(markdown) {
  const tableRegex = /(\|.+\|[\r\n]+\|[-:\s|]+\|[\r\n]+(?:\|.+\|[\r\n]*)+)/g;

  return markdown.replace(tableRegex, (table) => {
    const rows = table.trim().split('\n');
    let html = '<table>\n';

    // Header row
    const headers = rows[0].split('|').filter(h => h.trim());
    html += '<thead>\n<tr>\n';
    headers.forEach(header => {
      html += `<th>${header.trim()}</th>\n`;
    });
    html += '</tr>\n</thead>\n';

    // Body rows (skip separator row)
    html += '<tbody>\n';
    for (let i = 2; i < rows.length; i++) {
      const cells = rows[i].split('|').filter(c => c.trim());
      if (cells.length > 0) {
        html += '<tr>\n';
        cells.forEach(cell => {
          html += `<td>${cell.trim()}</td>\n`;
        });
        html += '</tr>\n';
      }
    }
    html += '</tbody>\n</table>\n';

    return html;
  });
}

function convertLists(markdown) {
  let html = markdown;

  // Unordered lists
  const ulRegex = /(?:^- .+$\n?)+/gm;
  html = html.replace(ulRegex, (match) => {
    const items = match.split('\n').filter(l => l.trim());
    let listHtml = '<ul>\n';
    items.forEach(item => {
      const text = item.replace(/^- /, '');
      listHtml += `<li>${text}</li>\n`;
    });
    listHtml += '</ul>\n';
    return listHtml;
  });

  // Ordered lists
  const olRegex = /(?:^\d+\. .+$\n?)+/gm;
  html = html.replace(olRegex, (match) => {
    const items = match.split('\n').filter(l => l.trim());
    let listHtml = '<ol>\n';
    items.forEach(item => {
      const text = item.replace(/^\d+\. /, '');
      listHtml += `<li>${text}</li>\n`;
    });
    listHtml += '</ol>\n';
    return listHtml;
  });

  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateHTML(title, content, subtitle = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Loud Interactive Documentation</title>
    <link rel="stylesheet" href="styles.css">
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script>
      mermaid.initialize({
        startOnLoad: true,
        theme: 'base',
        themeVariables: {
          primaryColor: '#FEDFCE',
          primaryTextColor: '#3E3E3E',
          primaryBorderColor: '#FF5900',
          lineColor: '#FF5900',
          secondaryColor: '#CEDFFE',
          tertiaryColor: '#F8FCDA',
          background: '#FFFFFF',
          mainBkg: '#FEDFCE',
          secondBkg: '#CEDFFE',
          tertiaryBkg: '#F8FCDA',
          nodeBorder: '#FF5900',
          clusterBkg: '#FFFFFF',
          clusterBorder: '#3E3E3E',
          defaultLinkColor: '#FF5900',
          titleColor: '#3E3E3E',
          edgeLabelBackground: '#FFFFFF',
          actorBorder: '#FF5900',
          actorBkg: '#FEDFCE',
          actorTextColor: '#3E3E3E',
          actorLineColor: '#3E3E3E',
          signalColor: '#3E3E3E',
          signalTextColor: '#3E3E3E',
          labelBoxBkgColor: '#FEDFCE',
          labelBoxBorderColor: '#FF5900',
          labelTextColor: '#3E3E3E',
          loopTextColor: '#3E3E3E',
          activationBorderColor: '#FF5900',
          activationBkgColor: '#FEDFCE',
          sequenceNumberColor: '#FFFFFF'
        }
      });
    </script>
    <style>
      @media print {
        @page {
          size: A4;
          margin: 2cm;
        }
        body {
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .no-print {
          display: none;
        }
      }
    </style>
</head>
<body>
    <div class="doc-header">
        <h1>${title}</h1>
        ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
        <div class="doc-meta">
            Loud Interactive Technical Documentation • Generated ${new Date().toLocaleDateString()}
        </div>
    </div>

    <main class="doc-content">
        ${content}
    </main>

    <footer class="doc-footer">
        <p>© ${new Date().getFullYear()} Loud Interactive. All rights reserved.</p>
        <p class="text-muted">For questions or support, contact: <a href="mailto:support@loud.us">support@loud.us</a></p>
    </footer>
</body>
</html>`;
}

// Main conversion function
function convertFile(inputPath, outputPath) {
  console.log(`Converting ${inputPath}...`);

  const markdown = fs.readFileSync(inputPath, 'utf8');

  // Extract title from first h1
  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : path.basename(inputPath, '.md');

  // Extract subtitle if exists
  const subtitleMatch = markdown.match(/^## Overview[\s\S]*?(?=\n##|\n$)/m);
  const subtitle = subtitleMatch ?
    'Comprehensive technical documentation for the pp-supabase platform' : '';

  const content = convertMarkdownToHTML(markdown);
  const html = generateHTML(title, content, subtitle);

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`✓ Created ${outputPath}`);
}

// Process all documentation files
const docsDir = path.join(__dirname, '..');
const outputDir = __dirname;

const files = [
  { input: 'SYSTEMS-OVERVIEW.md', output: 'systems-overview.html' },
  { input: 'PLANPERFECT-SYSTEM.md', output: 'planperfect-system.html' },
  { input: 'PAGEPERFECT-SYSTEM.md', output: 'pageperfect-system.html' },
  { input: 'README.md', output: 'index.html' }
];

console.log('📚 Converting documentation to HTML...\n');

files.forEach(({ input, output }) => {
  const inputPath = path.join(docsDir, input);
  const outputPath = path.join(outputDir, output);

  if (fs.existsSync(inputPath)) {
    convertFile(inputPath, outputPath);
  } else {
    console.log(`⚠️  ${input} not found, skipping...`);
  }
});

console.log('\n✅ Conversion complete!');
console.log('\n📄 Generated HTML files:');
files.forEach(({ output }) => {
  console.log(`   • html/${output}`);
});

console.log('\n💡 To generate PDFs:');
console.log('   1. Open each HTML file in Chrome/Edge');
console.log('   2. Press Ctrl/Cmd + P');
console.log('   3. Select "Save as PDF"');
console.log('   4. Enable "Background graphics"');
console.log('   5. Save the PDF\n');
