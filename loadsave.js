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

import * as sprites from './sprites.js';
import * as audio from './audio.js';

// These delineate where sprites and sound data occur in the save file.
const SPRITE_DELIMITER = '\n--SPRITE DATA------\n';
const SOUND_DELIMITER = '\n--SOUND DATA--------\n';

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

/**
 * Draw current file name, and an asterisk if has unsaved changes.
 */
export function updateTitleBar() {
  // The star indicates it needs saving.
  document.title = (saveFileName ? saveFileName : 'Untitled') +
    (needsSave ? '*' : '');
}

/**
 * Copy source code and sprites to the server (serve.js), which it saves
 * on its local filesystem.
 * @note this does not check needsSave and will always save, just to be safe.
 */
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

  const content = encodeSaveData(getSourceCode(), sprites.spriteData.data,
      audio.soundEffects);

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
  }).catch((error) => {
    alert('Error saving text to server:' + error);
  });
}

/**
 * Convert all game data into a file that can be saved
 * @param {str} code Text of the source code
 * @param {Uint8ClampedArray} imageData
 * @param {[]} soundEffects
 * @return {str}
 */
export function encodeSaveData(code, imageData, soundEffects) {
  return code +
    '\n(' + SPRITE_DELIMITER + encodeSprites(imageData) +
    SOUND_DELIMITER + encodeSoundEffects(soundEffects) + '\n)\n';
}

/**
 * Convert current sprites sheet to a string suitable for storing in a text
 * file. The format is described in decodeSprites.
 * @param {Uint8ClampedArray} imageData
 * @return {string} Hex representation of image data
 * @see decodeSprites
 */
export function encodeSprites(imageData) {
  // Ignore any zeroes at the end to save space. Walk backward
  // to determine how many there are.
  const dataEnd = countTrailingZeros(imageData);

  let result = '';
  for (let i = 0; i <= dataEnd; i += 4) {
    const index = sprites.INVERSE_PALETTE.get(imageData.slice(i, i + 4).
        toString());
    if (index === undefined) {
      // This shouldn't happen normally.
      console.log('invalid color in sprites data');
      result += '0';
    } else {
      result += index.toString(16);
    }

    if (((i / 4) % sprites.SPRITE_SHEET_WIDTH) ==
      sprites.SPRITE_SHEET_WIDTH - 1) {
      result += '\n';
    }
  }

  return result;
}

/**
 * Find index of last non-zero value in array.
 * @param {number} arr
 * @return {number}
 */
function countTrailingZeros(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != 0) {
      return i;
    }
  }

  return 0;
}

function encodeSoundEffects(soundEffects) {
  // Ignore effects that are empty
  let totalEffects = 0;
  for (let i = soundEffects.length - 1; i >= 0; i--) {
    if (!soundEffects[i].amplitudes.every((value) => value === 0) ||
      !soundEffects[i].pitches.every((value) => value === 0)) {
      totalEffects = i + 1;
      break;
    }
  }

  // Encode effects that are non-zero
  let result = '';
  for (let i = 0; i < totalEffects; i++) {
    result += encodeSoundEffect(soundEffects[i]) + '\n';
  }

  return result;
}

function encodeSoundEffect(effect) {
  let encoded = '';
  function encodeByte(val) {
    encoded += val.toString(16).padStart(2, '0');
  }

  encodeByte(effect.noteDuration);
  encodeByte(effect.waveform);
  for (let i = 0; i < audio.NOTES_PER_EFFECT; i++) {
    if (i < effect.pitches.length) {
      encodeByte(effect.pitches[i]);
    } else {
      encodeByte(0);
    }
  }

  for (let i = 0; i < audio.NOTES_PER_EFFECT; i++) {
    if (i < effect.amplitudes.length) {
      encodeByte(effect.amplitudes[i]);
    } else {
      encodeByte(0);
    }
  }

  return encoded;
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
    const [code, spritePixels, soundEffects] = decodeSaveData(data);
    setSourceCode(code);
    sprites.setSpriteData(spritePixels);
    audio.setSoundEffectData(soundEffects);
    clearNeedsSave();
  }).catch((error) => {
    alert('Error loading file: ' + error);
  });
}

/**
 * Parse string contents of a file containing sprites, source, and sound
 * data and populate global data structures used by the engine.
 * @param {string} data
 * @return {[code, spritPixels, soundEffects]}
 */
export function decodeSaveData(data) {
  // Split this into sections.
  const split1 = data.indexOf(SPRITE_DELIMITER);
  const split2 = data.indexOf(SOUND_DELIMITER);
  if (split1 == -1 || split2 == -1) {
    throw new Error('error loading file: missing sound/sprites data');
  }

  const endOfCode = data.lastIndexOf('(', split1);
  const code = data.substring(0, endOfCode - 1);
  const spriteString = data.substring(split1 + SPRITE_DELIMITER.length, split2);
  const spritePixels = decodeSprites(spriteString);
  const soundString = data.substring(split2 + SOUND_DELIMITER.length);
  const soundEffects = decodeSoundEffects(soundString);

  return [code, spritePixels, soundEffects];
}

function decodeSoundEffects(string) {
  const result = [];

  // Remove stray characters
  const compressed = string.replace(/[^a-f0-9]/gi, '');
  let index = 0;
  function nextByte() {
    if (index >= compressed.length) {
      return null;
    }

    const val = parseInt(compressed.substring(index, index + 2), 16);
    index += 2;
    return val;
  }

  while (index < compressed.length) {
    const noteDuration = nextByte();
    if (noteDuration == null) {
      break;
    }

    const waveform = nextByte();

    const pitches = new Uint8ClampedArray(audio.NOTES_PER_EFFECT).fill(0);
    const amplitudes = new Uint8ClampedArray(audio.NOTES_PER_EFFECT).fill(0);
    for (let i = 0; i < audio.NOTES_PER_EFFECT; i++) {
      pitches[i] = nextByte();
    }

    for (let i = 0; i < audio.NOTES_PER_EFFECT; i++) {
      amplitudes[i] = nextByte();
    }

    result.push({
      noteDuration,
      waveform,
      pitches,
      amplitudes,
    });
  }

  return result;
}

/**
 * Populate the spriteBitmap and spriteData from a string containing the
 * sprites data (as stored in the file). Each pixel is stored as a single
 * hex digit. These are references into the PALETTE table.
 * @param {string} text Hex encoded version of sprites data
 * @see encodeSprites
 * @return {Uint8ClampedArray} Pixel data
 */
export function decodeSprites(text) {
  const pixelData = new Uint8ClampedArray(sprites.SPRITE_SHEET_WIDTH *
    sprites.SPRITE_SHEET_HEIGHT * 4);
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[\s)]/.test(text[i])) {
      const rgba = sprites.PALETTE[parseInt(text[i], 16)];
      for (let i = 0; i < 4; i++) {
        pixelData[offset++] = rgba[i];
      }
    }
  }

  return pixelData;
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
