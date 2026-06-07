// Copyright 2024-2026 Jeff Bush
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

// This module implements both audio playback and the audio editor page.

import * as loadsave from './loadsave.js';

const MAX_SOUND_EFFECTS = 32;
export const NOTES_PER_EFFECT = 32;
export const soundEffects = [];
let audioContext = null;
let audioRunning = false;
let playerNode = null;
let soundEffectDiv = null;
let currentFx = 0;
let soundTable = null;

/**
 * This is called once, when the page is first loaded.
 */
export function initSoundEffectEditor() {
  soundEffectDiv = document.getElementById('soundstab');

  document.getElementById('prevfx').addEventListener('click', () => {
    if (currentFx > 0) {
      currentFx --;
      updateSoundEffectTableValues();
    }
  });

  document.getElementById('nextfx').addEventListener('click', () => {
    if (currentFx < MAX_SOUND_EFFECTS - 1) {
      currentFx++;
      updateSoundEffectTableValues();
    }
  });

  document.getElementById('playfx').addEventListener('click', () => {
    playSoundEffect(currentFx);
  });

  const durationInput = document.getElementById('sfxduration');
  durationInput.addEventListener('blur', () => {
    const noteDuration = Math.min(Math.max(parseInt(durationInput.value),
        0), 255);
    durationInput.value = noteDuration;
    soundEffects[currentFx].noteDuration = noteDuration;
    loadsave.setNeedsSave();
  });

  const waveformInput = document.getElementById('waveform');
  waveformInput.addEventListener('change', () => {
    let waveform = 0;
    switch (waveformInput.value) {
      case 'square':
        waveform = 0;
        break;
      case 'triangle':
        waveform = 1;
        break;
      case 'sawtooth':
        waveform = 2;
        break;
    }
    soundEffects[currentFx].waveform = waveform;
    loadsave.setNeedsSave();
  });

  // Create a table of volumes and pitches.
  soundTable = document.createElement('table');
  soundTable.classList.add('note-table');
  for (let i = 0; i < 2; i++) {
    const row = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.innerText = ['Pitch', 'Amp'][i];
    row.appendChild(rowHeader);

    for (let j = 0; j < NOTES_PER_EFFECT; j++) {
      const cell = document.createElement('td');
      cell.contentEditable = 'true';
      cell.addEventListener('blur', () => {
        const value = Math.min(Math.max(parseInt(cell.innerText), 0), 255);
        cell.innerText = value;
        if (i == 0) {
          soundEffects[currentFx].pitches[j] = value;
        } else {
          soundEffects[currentFx].amplitudes[j] = value;
        }

        loadsave.setNeedsSave();
      });

      cell.addEventListener('focus', () => {
        // Select contents of cell
        const range = document.createRange();
        range.selectNodeContents(cell);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return false;
      });

      row.appendChild(cell);
    }

    soundTable.appendChild(row);
  }

  soundEffectDiv.appendChild(soundTable);
  updateSoundEffectTableValues();
}

/**
 * Update all display values in page whenever underlying values have changed.
 */
function updateSoundEffectTableValues() {
  if (soundEffects[currentFx]=== undefined) {
    return;
  }

  const currentIndexDiv = document.getElementById('curfx');
  currentIndexDiv.innerText = 'Effect #' + currentFx;

  const durationInput = document.getElementById('sfxduration');
  durationInput.value = soundEffects[currentFx].noteDuration;

  const waveformInput = document.getElementById('waveform');
  switch (soundEffects[currentFx].waveform) {
    case 0:
      waveformInput.value = 'square';
      break;
    case 1:
      waveformInput.value = 'triangle';
      break;
    case 2:
      waveformInput.value = 'sawtooth';
      break;
  }

  const pitches = soundEffects[currentFx].pitches;
  const amplitudes = soundEffects[currentFx].amplitudes;
  for (let rowi = 0; rowi < 2; rowi++) {
    for (let coli = 0; coli < NOTES_PER_EFFECT; coli++) {
      const cell = soundTable.rows[rowi].cells[coli + 1];
      if (rowi == 0) {
        cell.innerText = pitches[coli];
      } else {
        cell.innerText = amplitudes[coli];
      }
    }
  }
}

export function setSoundEffectData(data) {
  soundEffects.length = 0;
  let i = 0;
  for (; i < data.length; i++) {
    soundEffects.push(data[i]);
  }

  for (; i < MAX_SOUND_EFFECTS; i++) {
    soundEffects.push({
      noteDuration: 0,
      waveform: 0,
      pitches: new Uint8ClampedArray(NOTES_PER_EFFECT).fill(0),
      amplitudes: new Uint8ClampedArray(NOTES_PER_EFFECT).fill(0),
    });
  }

  updateSoundEffectTableValues();
}

export function clearSoundEffects() {
  soundEffects.length = 0;
  for (let i = 0; i < MAX_SOUND_EFFECTS; i++) {
    soundEffects.push({
      noteDuration: 0,
      waveform: 0,
      pitches: new Uint8ClampedArray(NOTES_PER_EFFECT).fill(0),
      amplitudes: new Uint8ClampedArray(NOTES_PER_EFFECT).fill(0),
    });
  }
}

/**
 * Create audio context object and sound playback worklet.
 * Note that the worklet isn't started until the user attempts
 * to play a sound, both to handle browser requirements for user
 * input to play a sound, and to save CPU when a game is not running.
 */
export function initAudioContext() {
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

export function suspendAudio() {
  if (audioRunning) {
    audioContext.suspend();
    audioRunning = false;
  }
}

export function playSoundEffect(index) {
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
