import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const imagePath =
  './public/library/0a034b7f97afb599c08d25c62e84f528c5f57d93836bd4b8625bb3a05a43e8ca.jpg';

const image = (await fs.readFile(imagePath)).toString('base64');

const prompt = `
Analyze this image for a BINI photo archive.

Tell me:
1. How many people are visible?
2. Is this primarily a person/group photo, object-only photo, or mixed scene?
3. What objects are visible?
4. What is the scene or setting?
5. What are the people doing?
6. Does this appear relevant to a BINI image archive?
7. Give a relevance score from 0 to 100.
8. Give a detailed one-sentence description.
`;

console.log('Sending image to Gemma 3 4B...');

const start = performance.now();

const response = await fetch('http://127.0.0.1:11434/api/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gemma3:4b',
    prompt,
    images: [image],
    stream: false,
    options: {
      temperature: 0.1
    }
  })
});

if (!response.ok) {
  throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
}

const data = await response.json();
const elapsed = (performance.now() - start) / 1000;

console.log('\n===== GEMMA RESULT =====\n');
console.log(data.response || '(empty response)');

console.log('\n===== BENCHMARK =====');
console.log(`Inference time: ${elapsed.toFixed(2)} seconds`);
