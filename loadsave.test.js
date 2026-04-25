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

import * as loadsave from './loadsave.js';
import * as sprite from './sprites.js';
import * as audio from './audio.js';

test('round trip', () => {
  const spriteData = new Uint8ClampedArray(sprite.SPRITE_SHEET_WIDTH *
    sprite.SPRITE_SHEET_HEIGHT * 4);
  for (let i = 0; i < 1000; i += 4) {
    for (let j = 0; j < 4; j++) {
      spriteData[i + j] = sprite.PALETTE[i % 16][j];
    }
  }

  const code = `: draw_frame
    1 cls
    2 set_color
    16 16 112 112 fill_rect
  ;
`;

  function makeSoundEffect(noteDuration, waveform, pitches, amplitudes) {
    const result = {
      noteDuration: noteDuration,
      waveform: waveform,
      pitches: new Uint8ClampedArray(audio.NOTES_PER_EFFECT).fill(0),
      amplitudes: new Uint8ClampedArray(audio.NOTES_PER_EFFECT).fill(0),
    };

    // The input arrays are shorter, so copy them in ensuring zero padding
    // (necessary to match below)
    for (let i = 0; i < pitches.length; i++) {
      result.pitches[i] = pitches[i];
      result.amplitudes[i] = amplitudes[i];
    }

    return result;
  }

  const soundEffects = [
    makeSoundEffect(1, 0, [1, 2, 3, 4], [5, 6, 7, 8]),
    makeSoundEffect(2, 2, [9, 10, 11], [12, 13, 14]),
    makeSoundEffect(4, 3, [18, 19, 20, 21, 22], [23, 24, 25, 26, 27]),
  ];
  const encoded = loadsave.encodeSaveData(code, spriteData, soundEffects);
  const [decodedCode, decodedSprites, decodedSoundEffects] =
    loadsave.decodeSaveData(encoded);

  expect(decodedCode).toBe(code);
  expect(decodedSprites).toStrictEqual(spriteData);
  expect(decodedSoundEffects).toStrictEqual(soundEffects);
});
