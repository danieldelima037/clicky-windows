const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const chatDir = path.join(root, 'src', 'renderer', 'chat');

const deps = [
  {
    src: path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'),
    dst: path.join(chatDir, 'marked.min.js'),
  },
  {
    src: path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
    dst: path.join(chatDir, 'dompurify.min.js'),
  },
];

for (const dep of deps) {
  try {
    if (fs.existsSync(dep.src)) {
      fs.copyFileSync(dep.src, dep.dst);
      console.log(`Copied ${path.basename(dep.src)} -> ${path.basename(dep.dst)}`);
    } else {
      console.warn(`Source not found: ${dep.src} (already vendored or not installed)`);
    }
  } catch (err) {
    console.warn(`Failed to copy ${path.basename(dep.src)}:`, err.message);
  }
}
