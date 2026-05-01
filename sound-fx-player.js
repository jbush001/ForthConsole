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

function square(time, outputBuf, offset, length, amplitude, dT) {
  for (let i = 0; i < length; i++) {
    outputBuf[i + offset] = (time > 0.5 ? 1 : -1) * amplitude;
    time += dT;
    if (time >= 1.0) {
      time -= 1.0;
    }
  }

  return time;
}

function triangle(time, outputBuf, offset, length, amplitude, dT) {
  for (let i = 0; i < length; i++) {
    outputBuf[i + offset] = (4 * Math.abs(time - 0.5) - 1) * amplitude;
    time += dT;
    if (time >= 1.0) {
      time -= 1.0;
    }
  }

  return time;
}

function saw(time, outputBuf, offset, length, amplitude, dT) {
  for (let i = 0; i < length; i++) {
    outputBuf[i + offset] = time * amplitude;
    time += dT;
    if (time >= 1.0) {
      time -= 1.0;
    }
  }

  return time;
}

function clearBuffer(outputBuf, offset, length) {
  for (let i = 0; i < length; i++) {
    outputBuf[i + offset] = 0;
  }
}

class SoundEffectsPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.port.onmessage = this.handleMessage.bind(this);

    this.time = 0.0;
    this.pitches = null;
    this.amplitudes = null;
    this.effectIndex = 0;
    this.samplesPerNote = 0;
    this.sampleCount = 0; // samples played for the current note
    this.wavefn = square;
    this.amplitude = 0;
    this.dT = 0;
  }

  updateNoteParams() {
    if (this.effectIndex < this.pitches.length) {
      this.amplitude = this.amplitudes[this.effectIndex] / 255;
      const frequency = 27.5 * 2 **
        (Math.floor(this.pitches[this.effectIndex]) / 12);
      this.dT = frequency / sampleRate;
    } else {
      this.amplitude = 0;
    }
  }

  // @bug: This has popping and crackling because of abrupt transitions
  // at the beginning and end of playback.
  process(inputs, outputs, parameters) {
    const outputBuf = outputs[0][0];
    if (this.pitches === null) {
      return true;
    }

    let index = 0;
    while (index < outputBuf.length && this.effectIndex < this.pitches.length) {
      const sliceLength = Math.min(outputBuf.length - index,
          this.samplesPerNote - this.sampleCount);
      if (this.amplitude == 0) {
        clearBuffer(outputBuf, index, sliceLength);
      } else {
        this.time = this.wavefn(this.time, outputBuf, index, sliceLength,
            this.amplitude, this.dT);
      }

      index += sliceLength;
      this.sampleCount += sliceLength;

      // XXX note: this does not check for zero crossings, so there will
      // be some noise on note changes.
      if (this.sampleCount == this.samplesPerNote) {
        this.sampleCount = 0;
        this.effectIndex++;
        this.updateNoteParams();
      }
    }

    if (index < outputBuf.length) {
      clearBuffer(index, outputBuf.length - index);
    }

    return true;
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

    this.effectIndex = 0;
    this.sampleCount = 0;
    this.time = 0; // Avoid a pop at the beginning.
    this.updateNoteParams();
  }
}

registerProcessor('sound-fx-player', SoundEffectsPlayer);
