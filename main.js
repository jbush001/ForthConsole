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

function rgb(r, g, b) {
  return [r, g, b, 0xff];
}

const PALETTE = [
  [0, 0, 0, 0], // transparent
  rgb(0, 0, 0), // black
  rgb(255, 0, 0), // red
  rgb(0, 192, 0), // light green
  rgb(0, 0, 255), // blue
  rgb(255, 0, 255), // magenta
  rgb(255, 255, 0), // yellow
  rgb(0, 255, 255), // cyan
  rgb(128, 128, 128), // gray
  rgb(0, 165, 255), // light blue
  rgb(255, 165, 0), // orange
  rgb(128, 0, 128), // purple
  rgb(0, 100, 0), // dark green
  rgb(160, 82, 45), // brown
  rgb(217, 113, 98), // salmon
  rgb(255, 255, 255), // white
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

let outputCanvas = null;
let outputContext = null;
let saveFileName = null;

// Tracks which buttons are currently held.
let buttonMask = 0;

let audioContext = null;
let audioRunning = false;
let playerNode = null;

// eslint-disable-next-line no-unused-vars
function startup() {
  outputCanvas = document.getElementById('screen');
  outputContext = outputCanvas.getContext('2d');
  outputContext.imageSmoothingEnabled = false;

  // Intercept tab key so it inserts into the source instead of switching
  // to a different element in the page.
  const source = document.getElementById('source');
  source.addEventListener('keydown', (evt) => {
    if (evt.key === 'Tab') {
      evt.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  });

  source.addEventListener('input', setNeedsSave);
  source.addEventListener('paste', setNeedsSave);

  document.addEventListener('keydown', function(event) {
    if (event.key in BUTTON_MAP) {
      buttonMask |= BUTTON_MAP[event.key];
    }
  });

  document.addEventListener('keyup', function(event) {
    if (event.key in BUTTON_MAP) {
      buttonMask &= ~BUTTON_MAP[event.key];
    }
  });

  openTab('outputtab', document.getElementsByClassName('tablink')[0]);

  newProgram();
  initSpriteEditor();
  initSoundEditor();

  const fileSelect = document.getElementById('fileSelect');
  fileSelect.addEventListener('change', function(event) {
    loadFromServer(event.target.value);
  });

  updateFileList();

  window.addEventListener('beforeunload', function(event) {
    // Check if textarea has been modified
    if (needsSave) {
      // Display confirmation message
      const confirmationMessage =
        'Changes you made may not be saved. Are you sure you want to leave?';
      (event || window.event).returnValue = confirmationMessage;
      return confirmationMessage;
    }
  });

  // Save shortcut
  document.addEventListener('keydown', function(event) {
    if ((event.altKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      saveToServer();
    }
  });

  audioContext = new AudioContext();
  audioContext.audioWorklet.addModule('effects-player.js', {
    credentials: 'omit',
  }).then(() => {
    playerNode = new AudioWorkletNode(audioContext, 'effects-player');
    playerNode.onprocessorerror = (err) => {
      console.log('worklet node encountered error', err);
    };

    playerNode.connect(audioContext.destination);
  }).catch((error) => {
    console.log('error initializing audio worklet node', error);
  });
}

/**
 * Load the list of files on the server from a manifest file.
 * This is explained more in serve.js, but the manifest file allows
 * this to run with its custom server (allowing saving), or from
 * a public web server like github for demo mode.
 */
function updateFileList() {
  fetch('games/manifest.json').then((response) => {
    return response.json();
  }).then((files) => {
    fileSelect.innerHTML = '<option value="">Select a file...</option>';
    const selectOptions = files.map((file) =>
      `<option value="${file}">${file}</option>`);
    fileSelect.innerHTML += selectOptions.join('');
  });
}

// This separates the FORTH source code (above) from the text sprite
// representation (below).
const SPRITE_DELIMITER = '\n--SPRITE DATA------\n';
const SOUND_DELIMITER = '\n--SOUND DATA--------\n';

let needsSave = false;

/**
 * Copy source code and sprites to the web server (serve.js), which
 * will save on the local filesystem. Note that we will save even
 * if needSave is false, just to be safe (it's possible there could
 * be a bug where needsSave doesn't get set).
 */
// eslint-disable-next-line no-unused-vars
function saveToServer() {
  console.log('Saving to server...');
  if (!saveFileName) {
    saveFileName = window.prompt('Enter filename:');
    document.title = saveFileName;
  }

  if (!saveFileName) {
    return; // cancelled by user
  }

  if (!saveFileName.toLowerCase().endsWith('.fth')) {
    saveFileName += '.fth';
  }

  const content = getSourceCode() +
    '(' + SPRITE_DELIMITER + encodeSprites() +
    SOUND_DELIMITER + encodeSoundEffects() + '\n)\n';

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

function updateTitleBar() {
  // The star indicates it needs saving.
  document.title = (saveFileName ? saveFileName : 'Untitled') +
    (needsSave ? '*' : '');
}

function setNeedsSave() {
  if (!needsSave) {
    needsSave = true;
    updateTitleBar();
  }
}

/**
 * Load source code and sprites from the server. This just
 * uses a normal GET.
 * @param {string} filename Name of file to load
 */
function loadFromServer(filename) {
  stopRun();

  console.log('loadFromServer', filename);
  saveFileName = filename;
  updateTitleBar();
  fetch('games/' + saveFileName).then((response) => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    return response.text();
  }).then((data) => {
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

    resetInterpreter();

    // Important to move focus away from this, otherwise user
    // input for the game ends up loading another file.
    document.getElementById('fileSelect').blur();
    needsSave = false;
    updateTitleBar();
  }).catch((error) => {
    alert('Error loading file: ' + error);
  });
}

/**
 * Given a string containing the sprite data (as stored in the file),
 * populate the spriteBitmap and spriteData. Each pixel is stored as a single
 * digit, a hex value 0-15. These are references into the PALETTE table.
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

  // Remove any stray characters
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
      pitches,
      amplitudes,
    };
  }

  updateSfxTableValues();
}

/**
 * Index of last non-zero value in array.
 * @param {number} arr
 * @return {number}
 */
function findTrailingZeroes(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != 0) {
      return i;
    }
  }

  return 0;
}

/**
 * Takes the current sprite sheet and converts it to a string suitable for
 * storing in a text file. The format is described in decodeSprites.
 * @return {string} Hex representation of image data
 * @see decodeSprites
 */
function encodeSprites() {
  // We ignore any zeroes at the end to save space. Walk backward
  // to determine how many there are.
  const dataEnd = findTrailingZeroes(spriteData.data);

  let result = '';
  for (let i = 0; i <= dataEnd; i += 4) {
    const index = INVERSE_PALETTE.get(spriteData.data.slice(i, i + 4).
        toString());
    if (index === undefined) {
      // This can happen if a pasted image has colors not in the
      // palette (or if there is some sort of bug). For now, just
      // encode as transparent.
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

function encodeSoundEffect(effect) {
  let encoded = '';
  function encodeByte(val) {
    encoded += val.toString(16).padStart(2, '0');
  }

  encodeByte(effect.noteDuration);
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

function encodeSoundEffects() {
  // Ignore any effects that are empty
  let totalEffects = 0;
  for (let i = MAX_SOUND_EFFECTS - 1; i >= 0; i--) {
    if (!soundEffects[i].amplitudes.every((value) => value === 0) ||
      !soundEffects[i].pitches.every((value) => value === 0)) {
      totalEffects = i + 1;
      break;
    }
  }

  // Now encode the ones that are non-zero
  let result = '';
  for (let i = 0; i < totalEffects; i++) {
    result += encodeSoundEffect(soundEffects[i]) + '\n';
  }

  return result;
}

function clearSoundEffects() {
  soundEffects.length = 0;
  for (let i = 0; i < MAX_SOUND_EFFECTS; i++) {
    soundEffects.push({
      noteDuration: 0,
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
    repaintSpriteEdit(); // Sprite editor
  });
}

/**
 * Start a new project, clearing out source code, sprites, etc.
 */
function newProgram() {
  stopRun();

  if (needsSave) {
    const result = confirm('You will lose unsaved changes. Are you sure?');
    if (!result) {
      return;
    }
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
}

function setSourceCode(text) {
  const source = document.getElementById('source');
  source.innerHTML = '';
  for (const line of text.split('\n')) {
    const lineDiv = document.createElement('div');
    if (line == '') {
      lineDiv.innerText = ' '; // Avoid collapsing divs.
    } else {
      lineDiv.innerText = line;
    }
    source.appendChild(lineDiv);
  }
}

function getSourceCode(text) {
  let source = '';
  for (const lineDiv of document.getElementById('source').childNodes) {
    source += lineDiv.innerText.trimEnd() + '\n';
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
 * calls. This is invoked as a FORTH word.
 * @param {number} color Index into palette table, 0-15
 */
function setColor(color) {
  const colorStr = makeColorString(PALETTE[color & 15]);
  outputContext.strokeStyle = colorStr;
  outputContext.fillStyle = colorStr;
}

/**
 * Draw a sprite onto the screen. This is invoked as a FORTH word.
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
    // Resume this lazily to ensure that happens.
    audioContext.resume();
    audioRunning = true;
  }

  if (index >= soundEffects.length || index < 0) {
    return;
  }

  playerNode.port.postMessage(soundEffects[index]);
}

let drawFrameTimer = null;
let drawFrameAddr = null;

/**
 * Called to render a frame to the screen. This invokes the FORTH interpreter
 * to allow the game code to do the actual rendering of the frame, then
 * sets a timer to call itself at the next frame interval.
 * @param {ForthContext} ctx
 */
function drawFrame(ctx) {
  try {
    // Set the timeout before starting the draw routine so
    // we get consistent timing.
    drawFrameTimer = setTimeout(() => {
      drawFrame(ctx);
    }, 33);

    ctx.callWord(drawFrameAddr);
  } catch (err) {
    clearTimeout(drawFrameTimer);
    drawFrameTimer = -1;
    updateStopButton();

    alert(err);
  }
}

// This code is invoked when the game interpreter is created to add
// any game specific words.
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
 * Called to set up the interpreter and start running code.
 */
function resetInterpreter() {
  try {
    stopRun();

    document.getElementById('output').textContent = '';

    const ctx = new ForthContext();
    ctx.createBuiltinWord('cls', 1, clearScreen);
    ctx.createBuiltinWord('set_color', 1, setColor);
    ctx.createBuiltinWord('draw_line', 4, drawLine);
    ctx.createBuiltinWord('draw_sprite', 7, drawSprite);
    ctx.createBuiltinWord('draw_text', 4, (x, y, ptr, length) => {
      let str = '';
      for (let i = 0; i < length; i++) {
        str += String.fromCharCode(ctx.fetchByte(ptr + i));
      }

      outputContext.font = '10px monospace';
      outputContext.fillText(str, x, y + 8);
    });
    ctx.createBuiltinWord('fill_rect', 4, fillRect);
    ctx.createBuiltinWord('.', 1, (val) => {
      writeConsole(val + '\n');
    });
    ctx.createBuiltinWord('buttons', 0, getButtons);
    ctx.createBuiltinWord('sfx', 1, playSoundEffect);
    ctx.interpretSource(GAME_BUILTINS, 'game-builtins');
    ctx.interpretSource(`${outputCanvas.width} constant SCREEN_WIDTH
    ${outputCanvas.height} constant SCREEN_HEIGHT`, 'game-builtins');
    ctx.interpretSource(getSourceCode(),
        saveFileName ? saveFileName : '<game source>');

    drawFrameAddr = ctx.lookupWord('draw_frame');
    if (drawFrameAddr === null) {
      throw new Error('draw_frame not defined');
    }

    clearTimeout(drawFrameTimer);
    drawFrame(ctx);
    updateStopButton();
  } catch (err) {
    clearTimeout(drawFrameTimer);
    drawFrameTimer = -1;
    updateStopButton();
    alert(err);
  }
}

function stopRun() {
  if (drawFrameTimer != -1) {
    clearTimeout(drawFrameTimer);
    drawFrameTimer = -1;
    updateStopButton();
  }

  if (audioRunning) {
    audioContext.suspend();
    audioRunning = false;
  }
}

/**
 * Set the stop button to be enabled/disabled depending on the state of the
 * game engine.
 */
function updateStopButton() {
  document.getElementById('stop_button').disabled = drawFrameTimer == -1;
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

