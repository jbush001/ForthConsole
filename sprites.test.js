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

test('color conversion', () => {
  const value = sprites.PALETTE[3];
  const value2 = [...value];
  value2[0] = 1;

  expect(sprites.findNearestPaletteEntry(value)).toStrictEqual(value);
  expect(sprites.findNearestPaletteEntry(value2)).toStrictEqual(value);
});

test('undo buffer', () => {
  const buf = new sprites.UndoBuffer();
  expect(buf.redo()).toBe(null);
  expect(buf.undo()).toBe(null);

  buf.do('a');
  buf.do('b');
  buf.do('c');

  expect(buf.redo()).toBe(null);

  expect(buf.undo()).toBe('c');
  expect(buf.undo()).toBe('b');
  expect(buf.undo()).toBe('a');
  expect(buf.undo()).toBe(null);

  expect(buf.redo()).toBe('a');
  expect(buf.redo()).toBe('b');

  buf.do('d');
  expect(buf.redo()).toBe(null);
  expect(buf.undo()).toBe('d');
  expect(buf.undo()).toBe('b');
});
