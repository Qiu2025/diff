# Diff
Compare PDF documents privately and securely in your browser. No uploads, no servers, 100% client-side processing.

> [!NOTE]
> This project is a modified and rebranded version of the original [PDF Diff](https://github.com/jamesmontemagno/pdf-diff) by [James Montemagno](https://github.com/jamesmontemagno). I forked it to adapt the tool for my personal workflow. All credit for the original core logic goes to him.

## ✨ Features

### 🔐 Privacy-First Design
- **100% Private & Secure** - Your PDFs never leave your device
- **No Server Uploads** - Zero data transmission, zero risk
- **Works Offline** - Once loaded, no internet connection required
- **Open Source** - Inspect the code yourself to verify our privacy claims

### 📊 Powerful Comparison Views
- **Side-by-Side View** - Compare documents with synchronized scrolling
- **Unified View** - See all changes inline with color coding
- **Additions Only** - View only what was added
- **Removals Only** - View only what was removed
- **Changes Only** - See additions and removals side-by-side per page

### 🎯 Advanced Features
- **CLI Support** - Use via `npx pdf-diff` for command-line comparisons
- **Multi-Page Support** - Compare entire documents page by page
- **Show All Pages** - View all changes across all pages at once
- **Export to PDF** - Save comparison results as a formatted PDF report
- **Page Navigation** - Quick navigation between pages
- **Statistics Dashboard** - Get instant insights on changes
- **Dark/Light/System Theme** - Choose your preferred appearance
- **Visual HTML/PDF Reports** - Generate shareable diff reports

### 📱 User Experience
- **Responsive Design** - Works perfectly on desktop, tablet, and mobile
- **Drag & Drop** - Easy file upload with drag and drop support
- **Real-time Processing** - Instant comparison results
- **Clean Interface** - Intuitive and clutter-free design

## 🛠️ Tech Stack

- **[React 19](https://react.dev/)** - Modern UI framework
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe development
- **[Vite](https://vite.dev/)** - Lightning-fast build tool
- **[PDF.js](https://mozilla.github.io/pdf.js/)** - Mozilla's PDF rendering engine
- **[jsPDF](https://github.com/parallax/jsPDF)** - PDF generation for exports
- **[diff](https://github.com/kpdecker/jsdiff)** - Text comparison algorithm

## 🌐 Usage (Web App)

1. Visit **[diff.sqiu.dev](https://diff.sqiu.dev)**
2. Upload or drag your **original PDF**
3. Upload or drag your **modified PDF**
4. View comparison results instantly
5. Switch between view modes as needed
6. Export results to PDF if desired

## 💻 Usage (CLI)

Compare PDFs directly from your terminal with zero installation:

```bash
# Basic comparison
npx pdf-diff original.pdf modified.pdf

# Generate only HTML report
npx pdf-diff original.pdf modified.pdf --report html

# CI-friendly: exit with code 1 if differences found
npx pdf-diff original.pdf modified.pdf --fail-on-diff

# Output as JSON for programmatic use
npx pdf-diff original.pdf modified.pdf --format json

# Interactive mode
npx pdf-diff --interactive
```

#### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --report <type>` | Report type: `html`, `pdf`, or `both` | `both` |
| `-o, --out <dir>` | Output directory for reports | `./pdf-diff-report` |
| `--open` / `--no-open` | Open HTML report in browser after completion | `--open` |
| `-f, --format <type>` | Output format: `text`, `json`, or `junit` | `text` |
| `--fail-on-diff` | Exit with code 1 if differences are found | - |
| `-p, --pages <spec>` | Pages to compare (e.g., `1-3,5,7`) | All pages |
| `-t, --threshold <float>` | Change percentage threshold for failure | - |
| `-i, --interactive` | Interactive mode with guided prompts | - |

## 🐳 Self Hosting (Docker)
You can easily deploy your own private instance using Docker Compose: 
```
services:
  pdf-diff:
    image: qiu321/diff:latest
    container_name: pdf-diff
    restart: unless-stopped
    ports:
      - "8085:80"
```
or by running the following line:
```
docker run -d \
  --name pdf-diff \
  -p 8085:80 \
  --restart unless-stopped \
  qiu321/diff:latest
```

## 🚀 Development

```bash
# Clone the repository
git clone https://github.com/qiu2025/diff.git
cd pdf-diff

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint
```
