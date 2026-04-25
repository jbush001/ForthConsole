// Copyright 2024-2026 Jeff Bush
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Local web server, which allows saving games from the web app.

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());

app.post('/save/:filename', (req, res) => {
  let receivedData = '';
  req.on('data', (chunk) => {
    receivedData += chunk.toString(); // Concatenate received chunks
  });

  req.on('end', () => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'games', filename);

    fs.writeFile(filePath, receivedData, (err) => {
      if (err) {
        console.error('Error saving file:', err);
        res.status(500).send('Error saving file');
      } else {
        console.log('File saved successfully:', filename);
        res.status(200).send('File saved successfully');
      }
    });

    writeManifest();
  });
});

/**
 * Create a new manifest file on the local filesystem.
 * The manifest file contains a list of all files that are in the games
 * directory. We use a file instead of a REST call (e.g. list) to
 * allow static hosting of files on a public server like github.
 */
function writeManifest() {
  const directoryPath = path.join(__dirname, 'games');
  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return;
    }

    const fthFiles = files.filter((file) =>
      path.extname(file).toLowerCase() === '.fth');
    const fileNames = fthFiles.map((file) => path.parse(file).base);
    const manifestFilePath = path.join(directoryPath, 'manifest.json');
    fs.writeFile(manifestFilePath, JSON.stringify(fileNames, null, 2),
        (err) => {
          if (err) {
            console.error('Error writing manifest file:', err);
            return;
          }
          console.log('Manifest file written to ', manifestFilePath);
        });
  });
}

app.use(express.static(__dirname));

writeManifest();

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
