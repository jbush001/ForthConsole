'use strict';

// Copyright 2024 Jeff Bush
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

let spriteCanvas = null;
let spriteContext = null;
// spriteBitmap and spriteData are defined in main.js

/**
 * Base class for any UI component.
 */
class View {
  constructor(width, height) {
    this.children = [];
    this.xoffs = 0;
    this.yoffs = 0;
    this.width = width;
    this.height = height;
  }

  addChild(view, xoffs, yoffs) {
    view.xoffs = xoffs;
    view.yoffs = yoffs;
    this.children.push(view);
  }

  mouseDown(x, y) {}
  mouseMoved(x, y) {}
  mouseUp(x, y) {}
  draw(context) {}
}

let root = null;

function repaint() {
  spriteContext.fillStyle = 'white';
  spriteContext.fillRect(0, 0, spriteCanvas.width, spriteCanvas.height);

  function recurse(view) {
    spriteContext.save();
    spriteContext.translate(view.xoffs, view.yoffs);
    view.draw(spriteContext);
    for (const child of view.children) {
      recurse(child);
    }
    spriteContext.restore();
  }

  recurse(root);
}

function repaintSpriteEdit() {
  setTimeout(repaint, 0);
}

/**
 * Find the component that the mouse is over and invoke the passed callback
 * with that as the parameter and the local (relative) mouse coordinates.
 * @param {Event} event
 * @param {Function} callback
 */
function dispatchMouse(event, callback) {
  function recurse(view, cx, cy) {
    if (cx >= view.xoffs && cy >= view.yoffs && cx < view.xoffs + view.width &&
      cy < view.yoffs + view.height) {
      cx -= view.xoffs;
      cy -= view.yoffs;
      for (const child of view.children) {
        const found = recurse(child, cx, cy);
        if (found) {
          return true;
        }
      }

      callback(view, cx, cy);
      return true;
    }

    return false;
  }

  const rect = event.target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  recurse(root, x, y);
}

function handleMouseDown(event) {
  dispatchMouse(event, (view, x, y) => {
    view.mouseDown(x, y);
  });
}

function handleMouseUp(event) {
  dispatchMouse(event, (view, x, y) => {
    view.mouseUp(x, y);
  });
}

function handleMouseMoved(event) {
  dispatchMouse(event, (view, x, y) => {
    view.mouseMoved(x, y);
  });
}

let checkerPattern = null;

class UndoBuffer {
  constructor() {
    this.actions = [];
    this.undoIndex = 0;
  }

  do(action) {
    if (this.undoIndex < this.actions.length) {
      this.actions.length = this.undoIndex;
    }

    this.actions.push(action);
    this.undoIndex = this.actions.length;
  }

  undo() {
    if (this.undoIndex > 0) {
      return this.actions[--this.undoIndex];
    } else {
      return null;
    }
  }

  redo() {
    if (this.undoIndex < this.actions.length) {
      return this.actions[this.undoIndex++];
    } else {
      return null;
    }
  }
}

class SpriteEditorModel {
  constructor() {
    this.selectedRow = 0;
    this.selectedCol = 0;
    this.currentColor = 0;
    this.spriteSize = 1;
    this.brushSize = 1;
    this.undoBuffer = new UndoBuffer();
  }
}

const MAP_SIZE = 400;

/**
 * This view has two purposes: show all of the sprites in the map,
 * and selecting which sprites the editor view currently points to.
 */
class SpriteMapView extends View {
  constructor(width, height, model) {
    super(width, height);
    this.model = model;
  }

  draw(context) {
    if (!spriteBitmap) {
      return; // Not initialized yet
    }

    // This represents transparent areas.
    context.fillStyle = checkerPattern;
    context.fillRect(1, 1, MAP_SIZE, MAP_SIZE);

    context.drawImage(spriteBitmap, 1, 1,
        MAP_SIZE, MAP_SIZE);
    context.strokeStyle = 'black';
    context.strokeRect(0, 0, MAP_SIZE + 2, MAP_SIZE + 2);

    const spriteWidth = MAP_SIZE / SPRITE_SHEET_W_BLKS;
    const spriteHeight = MAP_SIZE / SPRITE_SHEET_H_BLKS;

    context.beginPath();
    context.strokeStyle = 'red';
    const selectLeft = this.model.selectedCol * spriteWidth + 1;
    const selectTop = this.model.selectedRow * spriteHeight + 1;
    context.strokeRect(selectLeft, selectTop,
        spriteWidth * this.model.spriteSize,
        spriteHeight * this.model.spriteSize);
  }

  mouseDown(x, y) {
    if (x <= MAP_SIZE + 2 && y <= MAP_SIZE + 2) {
      this.model.selectedCol = Math.floor(x / (MAP_SIZE /
        SPRITE_SHEET_W_BLKS));
      if (this.model.selectedCol + this.model.spriteSize >
        SPRITE_SHEET_W_BLKS) {
        this.model.selectedCol = SPRITE_SHEET_W_BLKS - this.model.spriteSize;
      }

      if (this.model.selectedRow + this.model.spriteSize >
        SPRITE_SHEET_H_BLKS) {
        this.model.selectedRow = SPRITE_SHEET_H_BLKS - this.model.spriteSize;
      }

      this.model.selectedRow = Math.floor(y / (MAP_SIZE /
        SPRITE_SHEET_H_BLKS));
      repaintSpriteEdit();
    }
  }
}

/**
 * This view allows updating individual pixels.
 */
class EditView extends View {
  constructor(width, height, model) {
    super(width, height);
    this.model = model;
    this.mouseIsDown = false;
  }

  draw(context) {
    if (!spriteBitmap) {
      return; // Not initialized yet
    }

    // Checker pattern represents transparent areas.
    context.fillStyle = checkerPattern;
    context.fillRect(0, 0, this.width, this.height);

    const left = this.model.selectedCol * SPRITE_BLOCK_SIZE;
    const top = this.model.selectedRow * SPRITE_BLOCK_SIZE;
    const size = this.model.spriteSize * SPRITE_BLOCK_SIZE;
    context.drawImage(spriteBitmap, left, top, size,
        size, 0, 0, this.width, this.height);

    // Draw grid lines
    context.strokeStyle = '#808080';
    const numLines = this.model.spriteSize * 8;
    const pixelSize = this.width / numLines;
    for (let i = 1; i < numLines; i++) {
      const offs = i * pixelSize;
      context.beginPath();
      context.moveTo(offs, 0);
      context.lineTo(offs, this.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, offs);
      context.lineTo(this.width, offs);
      context.stroke();
    }

    context.strokeStyle = 'black';
    context.strokeRect(0, 0, this.width, this.height);
  }

  mouseDown(x, y) {
    this.mouseIsDown = true;
    this._setPixel(x, y);
  }

  mouseUp(x, y) {
    this.mouseIsDown = false;
  }

  mouseMoved(x, y) {
    if (this.mouseIsDown) {
      this._setPixel(x, y);
    }
  }

  _setPixel(x, y) {
    const size = this.model.spriteSize * SPRITE_BLOCK_SIZE;
    const left = this.model.selectedCol * SPRITE_BLOCK_SIZE;
    const top = this.model.selectedRow * SPRITE_BLOCK_SIZE;
    const coloffs = Math.floor(x * size / this.width);
    const rowoffs = Math.floor(y * size / this.height);
    const colorVal = PALETTE[this.model.currentColor];
    const col = left + coloffs;
    const row = top + rowoffs;

    const oldPixel = getPixel(col, row);
    if (!oldPixel.every((val, index) => val === colorVal[index])) {
      this.model.undoBuffer.do([col, row, oldPixel, colorVal]);
      setPixel(col, row, colorVal);
    }
  }
}

/**
 * Select which color to paint, from the system palette of 16.
 */
class ColorPicker extends View {
  constructor(width, height, model) {
    super(width, height);
    this.model = model;
    this.swatchWidth = width / 8;
    this.swatchHeight = height / 2;
  }

  draw(context) {
    const NUM_COLS = 8;
    const NUM_ROWS = 2;
    for (let col = 0; col < NUM_COLS; col++) {
      for (let row = 0; row < NUM_ROWS; row++) {
        context.fillStyle = makeColorString(PALETTE[row *
            NUM_COLS + col]);
        context.fillRect(col * this.swatchWidth, row * this.swatchHeight,
            this.swatchWidth, this.swatchHeight);
      }
    }

    context.fillStyle = checkerPattern;
    context.fillRect(0, 0, this.swatchWidth, this.swatchHeight);

    context.strokeStyle = 'black';
    context.strokeRect(0, 0, this.width, this.height);

    const selectedCol = Math.floor(this.model.currentColor % NUM_COLS);
    const selectedRow = Math.floor(this.model.currentColor / NUM_COLS);
    context.strokeStyle = 'black';
    context.lineWidth = 4;
    context.strokeRect(selectedCol * this.swatchWidth,
        selectedRow * this.swatchHeight, this.swatchWidth,
        this.swatchHeight);
    context.lineWidth = 1;
  }

  mouseDown(x, y) {
    const col = Math.floor(x / this.swatchWidth);
    const row = Math.floor(y / this.swatchHeight);
    this.model.currentColor = row * 8 + col;
    repaintSpriteEdit();
  }
}

/**
 * Select how many 8x8 sprite chunks the editor window covers.
 */
class SliderControl extends View {
  constructor(width, height, label, numDetents) {
    super(width, height);
    this.label = label;
    this.numDetents = numDetents;
    this.currentValue = 0;
    this.dragging = false;
  }

  draw(context) {
    context.strokeStyle = 'black';
    context.strokeRect(0, 10, this.width, 6);
    for (let i = 0; i < this.numDetents; i++) {
      const x = Math.floor(this.width / (this.numDetents - 1) * i);
      context.beginPath();
      context.moveTo(x, 10);
      context.lineTo(x, 16);
      context.stroke();
    }

    const thumbX = Math.floor(this.width / (this.numDetents - 1) *
      this.currentValue);
    const thumbWidth = 10;
    context.fillStyle = 'black';
    context.strokeStyle = 'black';
    context.beginPath();
    context.moveTo(thumbX, 10);
    context.lineTo(thumbX + thumbWidth / 2, 5);
    context.lineTo(thumbX + thumbWidth / 2, 0);
    context.lineTo(thumbX - thumbWidth / 2, 0);
    context.lineTo(thumbX - thumbWidth / 2, 5);
    context.lineTo(thumbX, 10);
    context.fill();
    context.fillText(this.label, 4, 26);
  }

  setValue(val) {
  }

  mouseDown(x, y) {
    this._updateThumb(x);
    this.dragging = true;
  }

  mouseUp(x, y) {
    this.dragging = false;
  }

  mouseMoved(x, y) {
    if (this.dragging) {
      this._updateThumb(x);
    }
  }

  _updateThumb(x) {
    this.currentValue = Math.min(Math.floor(x / (this.width / this.numDetents)),
        this.numDetents - 1);
    this.setValue(this.currentValue);
    repaintSpriteEdit();
  }
}

class SpriteSizeControl extends SliderControl {
  constructor(width, height, model) {
    super(width, height, 'Sprite Size', 3);
    this.model = model;
  }

  setValue(value) {
    const SIZES = [1, 2, 4];
    this.model.spriteSize = SIZES[value];

    // Clamp so this is in-bounds
    if (this.model.selectedCol + this.model.spriteSize > SPRITE_SHEET_W_BLKS) {
      this.model.selectedCol = SPRITE_SHEET_W_BLKS - this.model.spriteSize;
    }

    if (this.model.selectedRow + this.model.spriteSize > SPRITE_SHEET_H_BLKS) {
      this.model.selectedRow = SPRITE_SHEET_H_BLKS - this.model.spriteSize;
    }

    repaintSpriteEdit();
  }
}

/**
 * Displays the sprite number for reference.
 */
class SpriteIndexView extends View {
  constructor(width, height, model) {
    super(width, height);
    this.model = model;
  }

  draw(context) {
    context.font = '12px monospace';
    context.fillStyle = 'black';
    context.fillText('Sprite #' + (this.model.selectedRow *
      SPRITE_SHEET_W_BLKS + this.model.selectedCol), 0, 12);
  }
}

function getPixel(x, y) {
  const pixelIndex = (y * spriteBitmap.width + x) * 4;
  return spriteData.data.slice(pixelIndex, pixelIndex + 4);
}

function setPixel(x, y, colorVal) {
  const pixelIndex = (y * spriteBitmap.width + x) * 4;
  const pix = spriteData.data;
  for (let i = 0; i < 4; i++) {
    pix[pixelIndex + i] = colorVal[i];
  }

  setNeedsSave();
  createImageBitmap(spriteData).then((bm) => {
    spriteBitmap = bm;
    repaint();
  });
}

function undoAction(undoBuffer) {
  const entry = undoBuffer.undo();
  if (entry) {
    setPixel(entry[0], entry[1], entry[2]);
  }
}

function redoAction(undoBuffer) {
  const entry = undoBuffer.redo();
  if (entry) {
    setPixel(entry[0], entry[1], entry[3]);
  }
}

/**
 * Copy the currently edited sprite to the clipboard.
 * @param {SpriteEditorModel} model
 */
async function copyCanvas(model) {
  const canvas = document.createElement('canvas');
  canvas.width = model.spriteSize * 8;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');

  const left = model.selectedCol * SPRITE_BLOCK_SIZE;
  const top = model.selectedRow * SPRITE_BLOCK_SIZE;
  const size = model.spriteSize * SPRITE_BLOCK_SIZE;
  context.drawImage(spriteBitmap, left, top, size,
      size, 0, 0, canvas.width, canvas.height);

  const dataURL = canvas.toDataURL('image/png');
  const blob = await (await fetch(dataURL)).blob();
  const clipboardItem = new ClipboardItem({'image/png': blob});
  navigator.clipboard.write([clipboardItem]).catch((error) => {
    console.error('Unable to copy to clipboard:', error);
  });
}

/**
 * Copy clipboard content into editor area in response to user paste
 * request.
 * The paste could come from an image copied from another area of the
 * sprite editor, or it could be an image copied from another app.
 * The latter case can be useful for reference images or external
 * tools, but adds some complexity, because we need to match palette
 * and aspect ratio.
 * @param {ClipboardEvent} event Native event passed to the paste callback
 * @param {SpriteEditorModel} model the data model for sprites
 * @bug does not update undo history.
 */
async function pasteCanvas(event, model) {
  const items = event.clipboardData.items;
  for (const item of items) {
    if (item.type === 'image/png' || item.type === 'image/jpeg') {
      const blob = item.getAsFile();
      const sourceBitmap = await createImageBitmap(blob);
      const pasteBitmap = await clampToPalette(sourceBitmap);

      const left = model.selectedCol * SPRITE_BLOCK_SIZE;
      const top = model.selectedRow * SPRITE_BLOCK_SIZE;


      // pasteBitmap.width, pasteBitmap.height
      const srcWidth = pasteBitmap.width;
      const srcHeight = pasteBitmap.height;
      let destWidth = model.spriteSize * SPRITE_BLOCK_SIZE;
      let destHeight = model.spriteSize * SPRITE_BLOCK_SIZE;

      // Adjust aspect ratio if necessary to fit the pasted image.
      if (srcWidth > srcHeight) {
        destHeight = Math.floor(srcHeight / srcWidth * destHeight);
      } else if (srcWidth < srcHeight) {
        destWidth = Math.floor(srcWidth / srcHeight * destWidth);
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = spriteBitmap.width;
      tempCanvas.height = spriteBitmap.height;
      const tempContext = tempCanvas.getContext('2d');

      // This resizes to the destination size when pasting. Without
      // this flag, it will perform smoothing, which will create many
      // colors that are not in the palette.
      tempContext.imageSmoothingEnabled = false;

      // Copy existing sprite sheet first, since we're only updating the
      // sprite we are currently editing.
      tempContext.drawImage(spriteBitmap, 0, 0);

      // Clear the destination image to (0, 0, 0, 0) first so any transparent
      // pixels in the source are copied the destination rather than blending
      // together the source and destinations (which just makes a big mess in
      // most cases).
      tempContext.clearRect(left, top, destWidth, destHeight);
      tempContext.drawImage(pasteBitmap,
          0, 0, srcWidth, srcHeight,
          left, top, destWidth, destHeight);
      spriteBitmap = await createImageBitmap(tempCanvas);
      spriteData.data.set(tempContext.getImageData(0, 0,
          tempCanvas.width, tempCanvas.height).data);
      setNeedsSave();
      repaintSpriteEdit();
      break;
    }
  }
}

/**
 * Ensure all colors in the bitmap are in the palette.
 * This will always be the case if images were copied from within the
 * sprite editor, but will not if they were taken from an external
 * source.
 * @param {ImageBitmap} sourceBitmap
 * @return {ImageBitmap}
 */
async function clampToPalette(sourceBitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = sourceBitmap.width;
  canvas.height = sourceBitmap.height;
  const context = canvas.getContext('2d');
  context.drawImage(sourceBitmap, 0, 0);

  const imageData = context.getImageData(0, 0,
      sourceBitmap.width, sourceBitmap.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const rgba = imageData.data.slice(i, i + 4);
    if (!INVERSE_PALETTE.has(rgba.toString())) {
      const newRgba = findNearestPaletteEntry(rgba);
      imageData.data[i] = newRgba[0];
      imageData.data[i + 1] = newRgba[1];
      imageData.data[i + 2] = newRgba[2];
      imageData.data[i + 3] = newRgba[3];
    }
  }

  context.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

/**
 * Find the palette entry that is most similar to a passed RGB color.
 * @param {Array} rgba input color
 * @return {Array} closest match
 */
function findNearestPaletteEntry(rgba) {
  let minDistance = Number.POSITIVE_INFINITY;
  let bestColor = [0, 0, 0, 0];

  // Note: this assumes palette entry 0 is transparent
  for (let i = 1; i < PALETTE.length; i++) {
    const thisDistance = computeDistance(rgba, PALETTE[i]);
    if (thisDistance < minDistance) {
      minDistance = thisDistance;
      bestColor = PALETTE[i];
    }
  }

  return bestColor;
}

/**
 * Calculate the perceptual difference between two colors
 * @param {Array} color1 RGBA
 * @param {Array} color2 RGBA
 * @return {number} Distance metric, smaller is more similar
 */
function computeDistance(color1, color2) {
  // Special case: if these are both transparent, then the color
  // doesn't matter.
  if (color1[3] == 0 && color2[3] == 0) {
    return 0;
  }

  const cie1 = rgbToCielab(color1);
  const cie2 = rgbToCielab(color2);

  let distance = 0;
  for (let i = 0; i < 3; i++) {
    distance += (cie1[i] - cie2[i]) ** 2;
  }

  return distance;
}

/**
 * Convert from RGB color space to CIELab, which is more perceptually uniform.
 * https://en.wikipedia.org/wiki/CIELAB_color_space
 * This ignores the alpha channel.
 * @param {Array} tuple Array of red, blue, green, alpha
 * @return {Array} L, A, B
 */
function rgbToCielab(tuple) {
  let [red, green, blue, _] = tuple;

  // First convert to CIE 1931 XYZ color space
  // https://en.wikipedia.org/wiki/CIE_1931_color_space
  red /= 255;
  green /= 255;
  blue /= 255;

  // Gamma correction
  red = (red > 0.04045) ? Math.pow((red + 0.055) / 1.055, 2.4) : red / 12.92;
  green = (green > 0.04045) ? Math.pow((green + 0.055) / 1.055, 2.4) :
      green / 12.92;
  blue = (blue > 0.04045) ? Math.pow((blue + 0.055) / 1.055, 2.4) :
      blue / 12.92;

  red *= 100;
  green *= 100;
  blue *= 100;

  let x = red * 0.4124564 + green * 0.3575761 + blue * 0.1804375;
  let y = red * 0.2126729 + green * 0.7151522 + blue * 0.0721750;
  let z = red * 0.0193339 + green * 0.1191920 + blue * 0.9503041;

  // Convert from XYZ to CieLab
  x /= 95.047;
  y /= 100.000;
  z /= 108.883;

  x = (x > 0.008856) ? Math.pow(x, 1/3) : (7.787 * x) + (16 / 116);
  y = (y > 0.008856) ? Math.pow(y, 1/3) : (7.787 * y) + (16 / 116);
  z = (z > 0.008856) ? Math.pow(z, 1/3) : (7.787 * z) + (16 / 116);

  const l = (116 * y) - 16;
  const a = 500 * (x - y);
  const b = 200 * (y - z);

  return [l, a, b];
}

/**
 * Set up resources related to the sprite editor.
 * This is only called once when page is initially loaded
 */
// eslint-disable-next-line no-unused-vars
function initSpriteEditor() {
  spriteCanvas = document.getElementById('sprite_edit');
  spriteContext = spriteCanvas.getContext('2d');
  spriteContext.imageSmoothingEnabled = false;
  checkerPattern = makeCheckerPattern(spriteContext);

  spriteCanvas.addEventListener('mousedown', handleMouseDown);
  spriteCanvas.addEventListener('mouseup', handleMouseUp);
  spriteCanvas.addEventListener('mousemove', handleMouseMoved);
  root = new View(spriteCanvas.width, spriteCanvas.height);
  const model = new SpriteEditorModel();

  root.addChild(new EditView(320, 320, model), 30, 32);
  root.addChild(new SpriteMapView(512, 512, model), 380, 24);
  root.addChild(new ColorPicker(320, 32, model), 30, 360);
  root.addChild(new SpriteSizeControl(64, 32, model), 30, 400);
  root.addChild(new SpriteIndexView(32, 16, model), 148, 12);
  repaint();

  const tab = document.getElementById('spritestab');
  document.addEventListener('keydown', (event) => {
    if (window.getComputedStyle(tab).display !== 'none') {
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        event.preventDefault();
        copyCanvas(model);
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        undoAction(model.undoBuffer);
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault();
        redoAction(model.undoBuffer);
      }
    }
  });

  document.addEventListener('paste', (event) => {
    if (window.getComputedStyle(tab).display !== 'none') {
      event.preventDefault();
      pasteCanvas(event, model);
    }
  });
}

/**
 * Create checkerboard pattern of white and gray squares that is used to
 * indicate areas of transparency.
 * @param {CanvasRenderingContext2D} context The context that this will be
 *     drawn onto.
 * @return {CanvasPattern} A pattern
 */
function makeCheckerPattern(context) {
  const checkerSize = 10;

  const miniCanvas = document.createElement('canvas');
  miniCanvas.width = checkerSize;
  miniCanvas.height = checkerSize;
  const miniCtx = miniCanvas.getContext('2d');

  miniCtx.fillStyle = 'white';
  miniCtx.fillRect(0, 0, checkerSize, checkerSize);

  miniCtx.fillStyle = '#ddd';
  miniCtx.fillRect(checkerSize / 2, 0, checkerSize / 2, checkerSize / 2);
  miniCtx.fillRect(0, checkerSize / 2, checkerSize / 2, checkerSize / 2);

  return context.createPattern(miniCanvas, 'repeat');
}
