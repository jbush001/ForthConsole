// Copyright 2026 Jeff Bush
//
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as sprite from './sprites.js';
import * as audio from './audio.js';

export let saveFileName = null;
export let needsSave = false;

/**
 * This is called whenever the user modifies content (sprites, sound, source
 * code), and thus it is unsaved. As a side effect it will:
 *  - Display an indicator in the title bar
 *  - Pop up a message if the user tries to close the window without
 *    saving.
 */
export function setNeedsSave() {
  if (!needsSave) {
    needsSave = true;
    updateTitleBar();
  }
}

export function clearNeedsSave() {
  needsSave = false;
  updateTitleBar();
}

export function setSaveFileName(value) {
  saveFileName = value;
}

export function clearFileName() {
  saveFileName = '';
}

/**
 * Draw current file name, and an asterisk if has unsaved changes.
 */
export function updateTitleBar() {
  // The star indicates it needs saving.
  document.title = (saveFileName ? saveFileName : 'Untitled') +
    (needsSave ? '*' : '');
}

// These delineate where sprite and sound data occur in the save file.
const SPRITE_DELIMITER = '\n--SPRITE DATA------\n';
const SOUND_DELIMITER = '\n--SOUND DATA--------\n';

/**
 * Copy source code and sprites to the server (serve.js), which it saves
 * on its local filesystem.
 * @note this does not check needsSave and will always save, just to be safe.
 */
// eslint-disable-next-line no-unused-vars
export function saveToServer() {
  console.log('Saving to server...');
  if (!saveFileName) {
    saveFileName = window.prompt('Enter filename:');
    document.title = saveFileName;
  }

  if (!saveFileName) {
    return; // user hit cancel.
  }

  if (!saveFileName.toLowerCase().endsWith('.fth')) {
    setSaveFileName(saveFileName + '.fth');
  }

  const content = encodeSaveData();

  fetch(`/save/${saveFileName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: content,
  }).then((response) => {
    if (!response.ok) {
      throw new Error('Unable to save to server');
    }
    console.log('Saved');

    updateFileList();
    clearNeedsSave();
    updateTitleBar();
  }).catch((error) => {
    alert('Error saving text to server:' + error);
  });
}

function encodeSaveData() {
  return getSourceCode() +
    '\n(' + SPRITE_DELIMITER + sprite.encodeSprites() +
    SOUND_DELIMITER + audio.encodeSoundEffects() + '\n)\n';
}

/**
 * Load source code and sprites from the server over HTTP.
 * @param {string} filename Name of file to load
 */
export async function loadFromServer(filename) {
  console.log('loadFromServer', filename);
  setSaveFileName(filename);
  return fetch('games/' + saveFileName).then((response) => {
    if (!response.ok) {
      throw new Error(`Server error, returned status ${response.status}`);
    }

    return response.text();
  }).then((data) => {
    decodeSaveData(data);

    updateTitleBar();
  }).catch((error) => {
    alert('Error loading file: ' + error);
  });
}

/**
 * Parse string contents of a file containing sprite, source, and sound
 * data and populate global data structures used by the engine.
 * @param {string} data
 */
function decodeSaveData(data) {
  // Split this into sections.
  const split1 = data.indexOf(SPRITE_DELIMITER);
  const split2 = data.indexOf(SOUND_DELIMITER);
  if (split1 == -1 || split2 == -1) {
    throw new Error('error loading file: missing sound/sprite data');
  }

  const endOfCode = data.lastIndexOf('(', split1);
  const code = data.substring(0, endOfCode);
  setSourceCode(code);
  const sprites = data.substring(split1 + SPRITE_DELIMITER.length, split2);
  sprite.decodeSprites(sprites);
  const sounds = data.substring(split2 + SOUND_DELIMITER.length);
  audio.decodeSoundEffects(sounds);

  clearNeedsSave();
}

/**
 * Replace the contents of the source code tab.
 * @param {string} text
 */
export function setSourceCode(text) {
  const source = document.getElementById('source');
  source.innerHTML = '';
  for (const line of text.trimEnd().split('\n')) {
    const lineDiv = document.createElement('div');
    if (line == '') {
      lineDiv.innerText = ' '; // Avoid collapsing divs.
    } else {
      lineDiv.innerText = line;
    }
    source.appendChild(lineDiv);
  }
}

/**
 * Get the content of the source code tab as a string.
 * @return {string} content of the source code tab
 */
export function getSourceCode() {
  let source = '';
  for (const lineDiv of document.getElementById('source').childNodes) {
    if (lineDiv.innerText) {
      source += lineDiv.innerText.trimEnd() + '\n';
    }
  }

  return source;
}


/**
 * Load the list of available files from the server, which are stored
 * in a manifest file.
 * This uses a manifest file rather than an explicit API, because the
 * former allows serving from a public web server like github for demo mode.
 * See serve.js for more description.
 */
export function updateFileList() {
  fetch('games/manifest.json').then((response) => {
    return response.json();
  }).then((files) => {
    const fileSelect = document.getElementById('fileSelect');
    fileSelect.innerHTML = '<option value="">Select a file...</option>';
    const selectOptions = files.map((file) =>
      `<option value="${file}">${file}</option>`);
    fileSelect.innerHTML += selectOptions.join('');
  });
}
