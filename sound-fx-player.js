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

//
// This module implements background thread that plays sound effects. The main
// game thread sends messages to this thread to kick off playback.
// Each sound effect consists of a series of frequencies (each being a byte that
// indicates a piano note), amplitudes, as well as an overall speed and
// waveform.
//

function square(time) {
  return time > 0.5 ? 1 : 0;
}

function triangle(time) {
  return 4 * Math.abs(time - 0.5) - 1;
}

function saw(time) {
  return time;
}

class SoundEffectsPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.port.onmessage = this.handleMessage.bind(this);

    this.time = 0.0;
    this.deltaTime = 0;
    this.pitches = null;
    this.amplitudes = null;
    this.effectIndex = 0;
    this.samplesPerNote = 0;
    this.sampleCount = 0;
    this.wavefn = square;
  }

  // @bug: This has popping and crackling because of abrupt transitions
  // at the beginning and end of playback.
  process(inputs, outputs, parameters) {
    const outputBuf = outputs[0][0];
    if (this.pitches === null || this.effectIndex == this.pitches.length) {
      return true;
    }

    for (let i = 0; i < outputBuf.length; i++) {
      outputBuf[i] = this.wavefn(this.time) * this.amplitude;
      this.time = (this.time + this.deltaTime) % 1.0;

      if (++this.sampleCount == this.samplesPerNote) {
        this.sampleCount = 0;
        if (++this.effectIndex == this.pitches.length) {
          break;
        } else {
          this.setNote(this.pitches[this.effectIndex],
              this.amplitudes[this.effectIndex]);
        }
      }
    }

    return true;
  }

  setNote(pitch, amplitude) {
    const frequency = 27.5 * 2 ** (Math.floor(pitch) / 12);
    this.deltaTime = frequency / sampleRate;
    this.amplitude = amplitude / 255;
  }

  handleMessage(event) {
    if (event.data.noteDuration == 0) {
      return;
    }

    this.samplesPerNote = Math.floor(event.data.noteDuration / 255 *
      sampleRate);
    this.pitches = event.data.pitches;
    this.amplitudes = event.data.amplitudes;
    switch (event.data.waveform) {
      case 0:
        this.wavefn = square;
        break;
      case 1:
        this.wavefn = triangle;
        break;
      case 2:
        this.wavefn = saw;
        break;
    }

    this.setNote(this.pitches[0], this.amplitudes[0]);
    this.effectIndex = 0;
    this.sampleCount = 0;
    this.time = 0; // Avoid a pop at the beginning.
  }
}

registerProcessor('sound-fx-player', SoundEffectsPlayer);
