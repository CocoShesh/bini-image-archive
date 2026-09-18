import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const imagePath =
  process.argv[2] ||
  './public/library/0a034b7f97afb599c08d25c62e84f528c5f57d93836bd4b8625bb3a05a43e8ca.jpg';

const model = process.env.OLLAMA_MODEL || 'llava:7b';
const url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';

const image = (await fs.readFile(imagePath)).toString('base64');

const prompt = `
Analyze this image for a BINI image archive.

Return concise structured information:
- number of visible people
- whether this is primarily a person/group photo, object-only photo, or mixed scene
- visible objects
- scene/setting
- activity
- overall relevance to a BINI photo archive from 0-100
- one-sentence description
`;

console.log(`Model: ${model}`);
console.log(`Image: ${imagePath}`);
console.log('Sending image to Ollama...');

const start = performance.now();

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    prompt,
    images: [image],
    stream: false,
    options: {
      temperature: 0.1
    }
  })
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Ollama HTTP ${response.status}: ${text}`);
}

const data = await response.json();
const elapsed = (performance.now() - start) / 1000;

console.log('\n===== RESULT =====\n');
console.log(data.response || '(No response)');
console.log('\n===== BENCHMARK =====');
console.log(`Inference time: ${elapsed.toFixed(2)} seconds`);
console.log(`Model: ${model}`);
