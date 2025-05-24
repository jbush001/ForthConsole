'use strict';

// Copyright 2024 Jeff Bush
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

const SPRITE_BLOCK_SIZE = 8;
const SPRITE_SHEET_W_BLKS = 16;
const SPRITE_SHEET_H_BLKS = 16;
const SPRITE_SHEET_WIDTH = SPRITE_SHEET_W_BLKS * SPRITE_BLOCK_SIZE;
const SPRITE_SHEET_HEIGHT = SPRITE_SHEET_H_BLKS * SPRITE_BLOCK_SIZE;

const BUTTON_L = 1;
const BUTTON_R = 2;
const BUTTON_U = 4;
const BUTTON_D = 8;
const BUTTON_A = 16;
const BUTTON_B = 32;

const BUTTON_MAP = {
  'ArrowUp': BUTTON_U,
  'ArrowLeft': BUTTON_L,
  'ArrowDown': BUTTON_D,
  'ArrowRight': BUTTON_R,
  'z': BUTTON_A,
  'x': BUTTON_B,
};

const PALETTE = [
  [0, 0, 0, 0], // transparent
  [0, 0, 0, 255], // black
  [255, 0, 0, 255], // red
  [0, 192, 0, 255], // light green
  [0, 0, 255, 255], // blue
  [255, 0, 255, 255], // magenta
  [255, 255, 0, 255], // yellow
  [0, 255, 255, 255], // cyan
  [128, 128, 128, 255], // gray
  [0, 165, 255, 255], // light blue
  [255, 165, 0, 255], // orange
  [128, 0, 128, 255], // purple
  [0, 100, 0, 255], // dark green
  [160, 82, 45, 255], // brown
  [217, 113, 98, 255], // salmon
  [255, 255, 255, 255], // white
];

const INVERSE_PALETTE = new Map();
for (let i = 0; i < PALETTE.length; i++) {
  INVERSE_PALETTE.set(PALETTE[i].toString(), i);
}

const MAX_SOUND_EFFECTS = 32;
const NOTES_PER_EFFECT = 32;
const soundEffects = [];

// spriteBitmap must be kept in sync with spriteData (since bitmaps
// are immutable, we keep spriteData around to modify it).
const spriteData = new ImageData(SPRITE_SHEET_WIDTH, SPRITE_SHEET_HEIGHT);
let spriteBitmap = null;

const GLYPH_WIDTH = 8;
const GLYPH_HEIGHT = 8;
const fontBitmap = new Image();
fontBitmap.src = 'font8x8.png';

let outputCanvas = null;
let outputContext = null;
let saveFileName = null;

// Tracks which buttons are currently held.
let buttonMask = 0;

let audioContext = null;
let audioRunning = false;
let playerNode = null;

let forthContext = null;

let running = false;


// Initialize once when the page is loaded.
document.addEventListener('DOMContentLoaded', (event) => {
  outputCanvas = document.getElementById('screen');
  outputContext = outputCanvas.getContext('2d');

  const source = document.getElementById('source');
  source.addEventListener('keydown', handleSourceKeyDown);
  source.addEventListener('input', setNeedsSave);
  source.addEventListener('paste', setNeedsSave);
  document.addEventListener('keydown', handlePageKeyDown);
  document.addEventListener('keyup', handlePageKeyUp);
  document.getElementById('fileSelect').addEventListener('change',
      handleFileSelect);
  window.addEventListener('beforeunload', handleUnload);
  document.getElementById('input').addEventListener('keydown',
      handleReplInput);
  document.getElementById('reset_button').addEventListener('click', () => {
    resetInterpreter();
    startRun();
  });

  openTab('outputtab', document.getElementsByClassName('tablink')[0]);

  newProgram();
  initSpriteEditor();
  initSoundEditor();
  updateFileList();
  initAudioContext();
});

function handleSourceKeyDown(event) {
  // The default action for tab is to switch to the next field on the
  // page. When on the source code tab, instead insert a tab char.
  if (event.key === 'Tab') {
    event.preventDefault();
    document.execCommand('insertText', false, '\t');
  }
}

function handlePageKeyDown(event) {
  if (event.key in BUTTON_MAP) {
    buttonMask |= BUTTON_MAP[event.key];
    event.preventDefault();
  }

  if (event.key == 'Escape') {
    playPause();
  }

  // Save keyboard shortcut
  if ((event.altKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault();
    saveToServer();
  }
}

function handlePageKeyUp(event) {
  if (event.key in BUTTON_MAP) {
    buttonMask &= ~BUTTON_MAP[event.key];
  }
}

/**
 * Try to load selected file when user picks from drop down.
 * @param {Event} event
 */
function handleFileSelect(event) {
  if (!confirmLoseChanges()) {
    return;
  }

  loadFromServer(event.target.value);

  // Move focus away from this element, otherwise when the user taps
  // keys to interact with the game, it will activate this control again.
  document.getElementById('fileSelect').blur();
}

/**
 * Prompt user if they have unsaved changes.
 * This is called when the user attempts to close the browser.
 * @param {BeforeUnloadEvent} event
 * @return {str} confirmation message
 */
function handleUnload(event) {
  if (needsSave) {
    const confirmationMessage =
      'Changes you made may not be saved. Are you sure you want to leave?';
    (event || window.event).returnValue = confirmationMessage;
    return confirmationMessage;
  }
}

const commandHistory = [];
let historyIndex = 0;

function handleReplInput(event) {
  const inputElem = document.getElementById('input');
  switch (event.key) {
    case 'Enter':
      try {
        const command = inputElem.value
        inputElem.value = '';
        commandHistory.push(command);
        historyIndex = -1;
        writeConsole(command + '\n');
        forthContext.interpretSource(command, 'user input');
        writeConsole('ok\n');
      } catch (err) {
        writeConsole(err + '\n');
      }

      break;

    case 'ArrowUp':
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        inputElem.value = commandHistory[commandHistory.length - 1 -
            historyIndex];
      }
      break;

    case 'ArrowDown':
      if (historyIndex == 0) {
        historyIndex--;
        inputElem.value = '';
      } else if (historyIndex > 0) {
        historyIndex--;
        inputElem.value = commandHistory[commandHistory.length - 1 -
            historyIndex];
      }

      break;

    case 'Tab':
      event.preventDefault();
      for (let i = commandHistory.length - 1; i >= 0; i--) {
        const entry = commandHistory[i];
        if (entry.startsWith(inputElem.value)) {
          inputElem.value = entry;
          break;
        }
      }

      break;
  }
}

/**
 * Create audio context object and sound playback worklet.
 * Note that the worklet isn't started until the user attempts
 * to play a sound, both to handle browser requirements for user
 * input to play a sound, and to save CPU when a game is not running.
 */
function initAudioContext() {
  audioContext = new AudioContext();
  audioContext.audioWorklet.addModule('sound-fx-player.js', {
    credentials: 'omit',
  }).then(() => {
    playerNode = new AudioWorkletNode(audioContext, 'sound-fx-player');
    playerNode.onprocessorerror = (err) => {
      console.log('worklet node encountered error', err);
    };

    playerNode.connect(audioContext.destination);
  }).catch((error) => {
    console.log('error initializing audio worklet node', error);
  });
}

/**
 * Reinitialize all interpreter state.
 * Side effects:
 * - Will stop the game from running if it is already
 * - Will read and interpret user supplied game source code.
 * - If there is an error, will stop running and output errors
 *   to the console before rethrowing.
 * @throw ForthError is there is a problem with the source code.
 */
function resetInterpreter() {
  try {
    stopRun();

    document.getElementById('output').textContent = '';

    forthContext = new ForthContext();
    forthContext.createBuiltinWord('cls', 1, clearScreen);
    forthContext.createBuiltinWord('set_color', 1, setColor);
    forthContext.createBuiltinWord('draw_line', 4, drawLine);
    forthContext.createBuiltinWord('draw_sprite', 7, drawSprite);
    forthContext.createBuiltinWord('draw_text', 4, (x, y, ptr, length) => {
      drawText(readForthString(ptr, length), x, y);
    });
    forthContext.createBuiltinWord('fill_rect', 4, fillRect);
    forthContext.createBuiltinWord('.', 1, (val) => {
      writeConsole(val + '\n');
    });
    forthContext.createBuiltinWord('buttons', 0, getButtons);
    forthContext.createBuiltinWord('sfx', 1, playSoundEffect);
    forthContext.createBuiltinWord('words', 0, printWords);
    forthContext.interpretSource(GAME_BUILTINS, 'game-builtins');
    forthContext.interpretSource(`${outputCanvas.width} constant SCREEN_WIDTH
    ${outputCanvas.height} constant SCREEN_HEIGHT`, 'game-builtins');
    const src = getSourceCode();
    if (src) {
      forthContext.interpretSource(src,
        saveFileName ? saveFileName : '<game source>');
    }

    drawFrameAddr = forthContext.lookupWord('draw_frame');
    if (drawFrameAddr === null) {
      throw new Error('draw_frame not defined');
    }
  } catch (err) {
    stopRun();
    writeConsole(err + '\n');
    throw err;
  }
}

/**
 * Pause the game if it is running. If it is not running, do nothing.
 * Side effects:
 *  - Update on-screen controls (disable/enable)
 *  - Stop audio context
 */
function stopRun() {
  if (running) {
    running = false;

    if (drawFrameTimer != -1) {
      clearTimeout(drawFrameTimer);
      drawFrameTimer = -1;
    }

    if (audioRunning) {
      audioContext.suspend();
      audioRunning = false;
    }

    updateControls();
  }
}

/**
 * Start the game if it is paused. If it is not paused, do nothing.
 * Side effects:
 *  - Update on-screen controls (disable/enable)
 */
function startRun() {
  if (!running) {
    running = true;
    updateControls();
    drawFrame();
  }
}

/**
 * Start a new project, clearing out source code, sprites, etc.
 * Create a small sample program.
 * Side effects:
 *  - Resets the interpreter
 *  - Stops the previous game from running if it is.
 */
function newProgram() {
  if (!confirmLoseChanges()) {
    return;
  }

  needsSave = false;
  saveFileName = '';
  updateTitleBar();
  setSourceCode(`: draw_frame
    1 cls
    2 set_color
    16 16 112 112 fill_rect
  ;
`);

  clearSprites();
  clearSoundEffects();
  clearScreen(0);
  resetInterpreter();
  updateControls();
}

/**
 * If the game is currently running, pause it, if it is paused, resume it.
 */
function playPause() {
  if (forthContext !== null) {
    if (running) {
      stopRun();
    } else {
      startRun();
    }
  }
}

/**
 * Copy a string encoded as a series of bytes in FORTH interpreter
 * memory into a Javascript string.
 * @param {number} ptr Byte offset into memory
 * @param {number} length Number of bytes/characters
 * @return {string}
 */
function readForthString(ptr, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(forthContext.fetchByte(ptr + i));
  }

  return str;
}

/**
 * Load the list of available files from the server, which are stored
 * in a manifest file.
 * This uses a manifest file rather than an explicit API, because the
 * former allows serving from a public web server like github for demo mode.
 * See serve.js for more description.
 */
function updateFileList() {
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

// These delineate where sprite and sound data occur in the save file.
const SPRITE_DELIMITER = '\n--SPRITE DATA------\n';
const SOUND_DELIMITER = '\n--SOUND DATA--------\n';

let needsSave = false;

/**
 * Copy source code and sprites to the server (serve.js), which it saves
 * on its local filesystem.
 * @note this does not check needsSave and will always save, just to be safe.
 */
// eslint-disable-next-line no-unused-vars
function saveToServer() {
  console.log('Saving to server...');
  if (!saveFileName) {
    saveFileName = window.prompt('Enter filename:');
    document.title = saveFileName;
  }

  if (!saveFileName) {
    return; // user hit cancel.
  }

  if (!saveFileName.toLowerCase().endsWith('.fth')) {
    saveFileName += '.fth';
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
    needsSave = false;
    updateTitleBar();
  }).catch((error) => {
    alert('Error saving text to server:' + error);
  });
}

function encodeSaveData() {
  return getSourceCode() +
    '\n(' + SPRITE_DELIMITER + encodeSprites() +
    SOUND_DELIMITER + encodeSoundEffects() + '\n)\n';
}

/**
 * Draw current file name, and an asterisk if has unsaved changes.
 */
function updateTitleBar() {
  // The star indicates it needs saving.
  document.title = (saveFileName ? saveFileName : 'Untitled') +
    (needsSave ? '*' : '');
}

/**
 * This is called whenever the user modifies content (sprites, sound, source
 * code), and thus it is unsaved. As a side effect it will:
 *  - Display an indicator in the title bar
 *  - Pop up a message if the user tries to close the window without
 *    saving.
 */
function setNeedsSave() {
  if (!needsSave) {
    needsSave = true;
    updateTitleBar();
  }
}

/**
 * Prompt the user if they are about to do something that would lose changes
 * (e.g. load a new file) and give them a chance to cancel that operation and
 * save.
 * @return {bool} true if this should perform whatever operation the user
 *   attempts and lose changes. false if the operation should be cancelled.
 */
function confirmLoseChanges() {
  if (needsSave) {
    const result = confirm('You will lose unsaved changes. Are you sure?');
    if (!result) {
      return false;
    }
  }

  return true;
}

/**
 * Load source code and sprites from the server over HTTP.
 * @param {string} filename Name of file to load
 */
function loadFromServer(filename) {
  stopRun();

  console.log('loadFromServer', filename);
  saveFileName = filename;
  fetch('games/' + saveFileName).then((response) => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    return response.text();
  }).then((data) => {
    decodeSaveData(data);

    updateTitleBar();
    resetInterpreter();
    startRun();
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
  decodeSprites(sprites);
  const sounds = data.substring(split2 + SOUND_DELIMITER.length);
  decodeSoundEffects(sounds);

  needsSave = false;
}

/**
 * Populate the spriteBitmap and spriteData from a string containing the
 * sprite data (as stored in the file). Each pixel is stored as a single
 * hex digit. These are references into the PALETTE table.
 * @param {string} text Hex encoded version of sprite data
 * @see encodeSprites
 */
function decodeSprites(text) {
  clearSprites();

  let outIndex = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[\s)]/.test(text[i])) {
      const rgba = PALETTE[parseInt(text[i], 16)];
      for (let i = 0; i < 4; i++) {
        spriteData.data[outIndex++] = rgba[i];
      }
    }
  }

  createImageBitmap(spriteData).then((bm) => {
    spriteBitmap = bm;
    repaintSpriteEdit(); // Sprite editor
  });
}

function decodeSoundEffects(string) {
  clearSoundEffects();

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

  for (let i = 0; i < MAX_SOUND_EFFECTS; i++) {
    const noteDuration = nextByte();
    if (noteDuration == null) {
      break;
    }

    const waveform = nextByte();

    const pitches = [];
    const amplitudes = [];
    for (let i = 0; i < NOTES_PER_EFFECT; i++) {
      pitches.push(nextByte());
    }

    for (let i = 0; i < NOTES_PER_EFFECT; i++) {
      amplitudes.push(nextByte());
    }

    soundEffects[i] = {
      noteDuration,
      waveform,
      pitches,
      amplitudes,
    };
  }

  updateSfxTableValues();
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

/**
 * Convert current sprite sheet to a string suitable for storing in a text
 * file. The format is described in decodeSprites.
 * @return {string} Hex representation of image data
 * @see decodeSprites
 */
function encodeSprites() {
  // Ignore any zeroes at the end to save space. Walk backward
  // to determine how many there are.
  const dataEnd = countTrailingZeros(spriteData.data);

  let result = '';
  for (let i = 0; i <= dataEnd; i += 4) {
    const index = INVERSE_PALETTE.get(spriteData.data.slice(i, i + 4).
        toString());
    if (index === undefined) {
      // This shouldn't happen normally.
      console.log('invalid color in sprite data');
      result += '0';
    } else {
      result += index.toString(16);
    }

    if (((i / 4) % SPRITE_SHEET_WIDTH) == SPRITE_SHEET_WIDTH - 1) {
      result += '\n';
    }
  }

  return result;
}

function encodeSoundEffects() {
  // Ignore effects that are empty
  let totalEffects = 0;
  for (let i = MAX_SOUND_EFFECTS - 1; i >= 0; i--) {
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
  for (let i = 0; i < NOTES_PER_EFFECT; i++) {
    if (i < effect.pitches.length) {
      encodeByte(effect.pitches[i]);
    } else {
      encodeByte(0);
    }
  }

  for (let i = 0; i < NOTES_PER_EFFECT; i++) {
    if (i < effect.amplitudes.length) {
      encodeByte(effect.amplitudes[i]);
    } else {
      encodeByte(0);
    }
  }

  return encoded;
}

function clearSoundEffects() {
  soundEffects.length = 0;
  for (let i = 0; i < MAX_SOUND_EFFECTS; i++) {
    soundEffects.push({
      noteDuration: 0,
      waveform: 0,
      pitches: new Array(NOTES_PER_EFFECT).fill(0),
      amplitudes: new Array(NOTES_PER_EFFECT).fill(0),
    });
  }
}

/**
 * Set the sprite sheet to be fully transparent.
 */
function clearSprites() {
  for (let i = 0; i < SPRITE_SHEET_WIDTH * SPRITE_SHEET_HEIGHT * 4; i++) {
    spriteData.data[i] = 0;
  }

  createImageBitmap(spriteData).then((bm) => {
    spriteBitmap = bm;
    repaintSpriteEdit();
  });
}

/**
 * Replace the contents of the source code tab.
 * @param {string} text
 */
function setSourceCode(text) {
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
function getSourceCode() {
  let source = '';
  for (const lineDiv of document.getElementById('source').childNodes) {
    if (lineDiv.innerText) {
      source += lineDiv.innerText.trimEnd() + '\n';
    }
  }

  return source;
}

/**
 * Copy text into an area in the web interface that shows program output.
 * This is usually invoked from the forth '.' word.
 * @param {string} text What to write.
 */
function writeConsole(text) {
  const output = document.getElementById('output');
  output.textContent += text;
  output.scrollTop = output.scrollHeight;
}

/**
 * Convert a color value into a CSS string.
 * @param {number[]} value RGB[A] color.
 * @return {string} CSS string representing the color.
 */
function makeColorString(value) {
  return `rgb(${value[0]}, ${value[1]}, ${value[2]})`;
}

/**
 * Erase the entire drawing area.
 * @param {number} color Index (0-15) into the pallete for the color.
 */
function clearScreen(color) {
  outputContext.fillStyle = makeColorString(PALETTE[color & 15]);
  outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
}

function drawLine(left, top, right, bottom) {
  outputContext.beginPath();
  outputContext.moveTo(left, top);
  outputContext.lineTo(right, bottom);
  outputContext.stroke();
}

function fillRect(left, top, width, height) {
  outputContext.fillRect(left, top, width, height);
}

/**
 * Set the color to be used by subsequent drawLine and fillRect
 * calls. Native forth word.
 * @param {number} color Index into palette table, 0-15
 */
function setColor(color) {
  const colorStr = makeColorString(PALETTE[color & 15]);
  outputContext.strokeStyle = colorStr;
  outputContext.fillStyle = colorStr;
}

/**
 * Draw a sprite onto the screen. Native forth word.
 * @param {number} x Horizontal offset, in pixels
 * @param {number} y Vertical offset in pixels .
 * @param {number} index Index into sprite array, in terms of 8x8 pixel blocks,
 *     numbered left to right, top to bottom.
 * @param {number} w Width, as a number of 8 pixel blocks.
 * @param {number} h Height, as a number of 8 pixel blocks.
 * @param {number} flipX 1 if this should be flipped left to right.
 * @param {number} flipY 1 if this should be flipped top to bottom.
 */
function drawSprite(x, y, index, w, h, flipX, flipY) {
  const sheetRow = Math.floor(index / SPRITE_SHEET_W_BLKS);
  const sheetCol = index % SPRITE_SHEET_W_BLKS;
  const pixWidth = w * SPRITE_BLOCK_SIZE;
  const pixHeight = h * SPRITE_BLOCK_SIZE;
  const dx = flipX ? -x - pixWidth : x;
  const dy = flipY ? -y - pixWidth : y;

  outputContext.save();
  outputContext.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  outputContext.drawImage(spriteBitmap, sheetCol * SPRITE_BLOCK_SIZE, sheetRow *
    SPRITE_BLOCK_SIZE, pixWidth, pixHeight, dx, dy, pixWidth, pixHeight);
  outputContext.restore();
}

/**
 * Read virtual joystick buttons (up/down/left/right/a/b)
 * @return {number} A bitmask of held buttons
 */
function getButtons() {
  return [buttonMask];
}

function playSoundEffect(index) {
  if (!audioRunning) {
    // The audio context requires an interaction with the page to start.
    // Resume lazily to ensure that happens.
    audioContext.resume();
    audioRunning = true;
  }

  if (index >= soundEffects.length || index < 0) {
    return;
  }

  if (playerNode) {
    playerNode.port.postMessage(soundEffects[index]);
  }
}

function printWords() {
  for (const word in forthContext.dictionary) {
    writeConsole(word + '\n');
  }
}

function drawText(string, x, y) {
  for (let index = 0; index < string.length; index++) {
    const code = string.charCodeAt(index);
    if (code >= 33 && code <= 128) {
      outputContext.drawImage(fontBitmap,
          (code - 32) * GLYPH_WIDTH, 0, GLYPH_WIDTH, GLYPH_HEIGHT,
          x + GLYPH_WIDTH * index, y, GLYPH_WIDTH, GLYPH_HEIGHT);
    }
  }
}

let drawFrameTimer = null;
let drawFrameAddr = null;

/**
 * Render a frame to the screen. This invokes the FORTH interpreter
 * to allow the game code to do the actual rendering of the frame, then
 * sets a timer to call itself at the next frame interval.
 */
function drawFrame() {
  try {
    // Set the timeout before starting the draw routine so we get consistent
    // timing.
    drawFrameTimer = setTimeout(() => {
      drawFrame();
    }, 16);

    forthContext.callWord(drawFrameAddr);
  } catch (err) {
    stopRun();
    writeConsole(err + '\n');
  }
}

// Add game specific words.
const GAME_BUILTINS = `
${BUTTON_L} constant BUTTON_L
${BUTTON_R} constant BUTTON_R
${BUTTON_U} constant BUTTON_U
${BUTTON_D} constant BUTTON_D
${BUTTON_A} constant BUTTON_A
${BUTTON_B} constant BUTTON_B

0 constant C_TRANSPARENT
1 constant C_BLACK
2 constant C_RED
3 constant C_LIGHT_GREEN
4 constant C_BLUE
5 constant C_MAGENTA
6 constant C_YELLOW
7 constant C_CYAN
8 constant C_GRAY
9 constant C_LIGHT_BLUE
10 constant C_ORANGE
11 constant C_PURPLE
12 constant C_DARK_GREEN
13 constant C_BROWN
14 constant C_SALMON
15 constant C_WHITE
`;

/**
 * Set the stop button and input field to be enabled/disabled depending on the
 * state of the game engine.
 */
function updateControls() {
  const inputElem = document.getElementById('input');
  const button = document.getElementById('play_pause_button');
  if (running) {
    button.innerText = 'Pause';
    inputElem.disabled = true;
    inputElem.placeholder = 'Unavailable while running';
  } else {
    button.innerText = 'Resume';
    inputElem.disabled = false;
    inputElem.placeholder = 'enter command';
  }
}

function openTab(pageName, element) {
  for (const tab of document.getElementsByClassName('tabcontent')) {
    tab.style.display = 'none';
  }

  for (const tab of document.getElementsByClassName('tablink')) {
    tab.className = tab.className.replace(' active', '');
  }

  document.getElementById(pageName).style.display = 'block';
  element.className += ' active';
}
