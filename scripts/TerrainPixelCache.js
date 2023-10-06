/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PixelCache } from "./PixelCache.js";

/**
 * Cache a single texture, representing RGB layer.
 * Each layer can have color values between 0 and 2^5 (31).
 */
export class TerrainLayerPixelCache extends PixelCache {
  /**
   * Take RGB values and convert to a value.
   */
  static #decodeTerrainChannels(r, g, b) { return TerrainLayerPixel.fromRGBIntegers(r, g, b); }

  /**
   * Return the terrain layers at this cache.
   * @returns {Uint8Array}    3 for TerrainLayerPixelCache but may be more than 3 for subclasses.
   */
  terrainLayersAt(x, y) {
    const pixelValue = this.pixelAtCanvas(x, y);
    const px = new TerrainLayerPixel(pixelValue);
    return px.toTerrainLayers();
  }

  /**
   * As the parent fromTexture but with options preset.
   * @param {PIXI.Texture} texture      Texture from which to pull pixel data
   * @returns {TerrainLayerPixelCache}
   */
  static fromTexture(texture) {
    return super.fromTexture(texture, this._textureOptions);
  }

  /**
   * As the parent updateFromTexture but with options preset.
   * @param {PIXI.Texture} texture      Texture from which to pull pixel data
   * @returns {TerrainLayerPixelCache}
   */
  updateFromTexture(texture) {
    return super.updateFromTexture(texture, this._textureOptions);
  }

  /**
   * Configure options used to create this cache from a texture.
   */
  static get _textureOptions() {
    const { sceneX: x, sceneY: y } = canvas.dimensions;
    const combineFn = this.#decodeTerrainChannels;
    return { x, y, arrayClass: Uint8Array, combineFn };
  }
}

/**
 * Cache two textures, representing 6 terrain layers.
 * Each texture is an RGB (3 layers).
 * Each layer can have color values between 0 and 2^5 (31).
 */
export class TerrainPixelCache extends TerrainLayerPixelCache {

  /**
   * Build the cache from two TerrainLayerPixelCache.
   * Does not check that the frames are the same, but they should be to avoid weirdness.
   * @param {TerrainLayerPixelCache} cache0   For layers 0, 1, 2
   * @param {TerrainLayerPixelCache} cache1   For layers 3, 4, 5
   * @returns {TerrainPixelCache}
   */
  static fromTerrainLayerCaches(cache0, cache1) {
    const { x, y, localFrame, pixels: pixels0, scale } = cache0;
    const pixels1 = cache1.pixels;

    const ln = pixels0.length;
    const newPixels = new Uint32Array(ln);
    const cache = new this(newPixels, localFrame.width,
      { x, y, pixelHeight: localFrame.height, resolution: scale.resolution });

    // Instead of constructing and saving the layers for each pixel, use bit math.
    // Shift the second cache and combine.
    for ( let i = 0; i < ln; i += 1 ) {
      cache.pixels[i] = TerrainLayerPixel.combineTwoPixels(pixels0[i], pixels1[i]);
    }

    // Because this is a new cache, no need to reset cached values.
    return cache;
  }

  /**
   * Update the cache from two TerrainLayerPixelCache.
   * Does not check that the frames are the same, but they should be to avoid weirdness.
   * @param {TerrainLayerPixelCache} cache0   For layers 0, 1, 2
   * @param {TerrainLayerPixelCache} cache1   For layers 3, 4, 5
   * @returns {TerrainPixelCache}
   */
  updateFromTerrainLayerCaches(cache0, cache1) {
    // Instead of constructing and saving the layers for each pixel, use bit math.
    // Shift the second cache and combine.
    const pixels0 = cache0.pixels;
    const pixels1 = cache1.pixels;
    const ln = pixels0.length;
    for ( let i = 0; i < ln; i += 1 ) {
      this.pixels[i] = TerrainLayerPixel.combineTwoPixels(pixels0[i], pixels1[i]);
    }

    // Clear cached parameters.
    this.clearTransforms();
    this._clearLocalThresholdBoundingBoxes();
    return this;
  }
}


const BITS = 5;
const NUM_VALUES = Math.pow(2, BITS) - 1;
const NUM_LAYERS = 6;

/**
 * Represent a terrain color and layer using 30 bits of a 32 bit number.
 * Each terrain can take 2^5 (32) values.
 * Handles 6 layers.
 * Mostly follows the approach of Color class.
 */
export class TerrainLayerPixel extends Number {
  /**
   * Use the first 5 bits of the RGB values to construct a TerrainLayerPixel.
   * @param {number} r      The red value (0 to 31)
   * @param {number} g      The green value (0 to 31)
   * @param {number} b      The blue value (0 to 31)
   * @returns {TerrainLayerPixel}
   */
  static fromRGBIntegers(r, g, b) {
    r = Math.clamped(Math.floor(r), 0, NUM_VALUES);
    g = Math.clamped(Math.floor(g), 0, NUM_VALUES);
    b = Math.clamped(Math.floor(b), 0, NUM_VALUES);
    return this.fromTerrainLayers([r, g, b]);
  }

  /**
   * Store up to 6 layers of terrain values as an unsigned integer (number).
   * @param {number[6]} layers     Array with terrain values between 0 and 31.
   * @returns {TerrainLayerPixel}
   */
  static fromTerrainLayers(layers) {
    layers ??= new Uint8Array(NUM_LAYERS);
    let x = (layers[0] ?? 0) | 0;
    for ( let i = 1; i < NUM_LAYERS; i += 1 ) {
      const terrainValue = layers[i] ?? 0;
      x += (terrainValue << (BITS * i));
    }
    return new this(x);
  }

  /**
   * Combine two pixels, where the first 3 layers are represented by the first pixel,
   * and the second 3 layers by the second pixel.
   * @param {TerrainLayerPixel} layer123   First pixel, with only layers 0–2.
   * @param {TerrainLayerPixel} layer456   Second pixel, with only layers 0–2.
   * @returns {TerrainLayerPixel}
   */
  static combineTwoPixels(layer123, layer456) {
    return new this((layer123 + (layer456 << (BITS * 3))));
  }

  /**
   * Convert this number to 6 layers of terrain values.
   * @returns {Uint8Array[6]}
   */
  toTerrainLayers() {
    const layers = new Uint8Array(NUM_LAYERS);
    layers[0] = (this & NUM_VALUES);
    for ( let channel = 1; channel < NUM_LAYERS; channel += 1 ) {
      const shiftIdx = BITS * channel;
      layers[channel] = ((this >> shiftIdx) & NUM_VALUES);
    }
    return layers;
  }

  /**
   * Convert a terrain value and a layer to a TerrainLayerPixel.
   * @param {number} terrainValue   Integer between 0 and 31.
   * @param {number} layer          Integer between 0 and 5.
   * @returns {TerrainLayerPixel}
   */
  static fromTerrainValue(terrainValue, layer) {
    terrainValue = Math.clamped(Math.floor(terrainValue), 0, NUM_VALUES);
    layer = Math.clamped(Math.floor(layer), 0, BITS);

    // Faster than calling fromTerrainLayers.
    if ( layer === 0 ) return new this(terrainValue);
    const x = (terrainValue << (BITS * layer));
    return new this(x);
  }

  /**
   * Add this terrain value for the desired layer in this pixel representation.
   * Overwrites whatever value was there previously.
   * @param {number} terrainValue   Integer between 0 and 31.
   * @param {number} layer          Integer between 0 and 5.
   * @returns {TerrainValue} This updated terrain value.
   */
  overwriteTerrainValue(terrainValue, layer) {
    terrainValue = Math.clamped(Math.floor(terrainValue), 0, NUM_VALUES);
    layer = Math.clamped(Math.floor(layer), 0, BITS);
    const currentLayers = this.toTerrainLayers();
    currentLayers[layer] = terrainValue;
    return this.constructor.fromTerrainLayers(currentLayers);
  }

  /**
   * Remove this terrain value for the desired layer in this pixel representation.
   * Overwrites whatever value was there previously with 0.
   * @param {number} layer          Integer between 0 and 2.
   * @returns {TerrainValue} A new TerrainValue object.
   */
  removeTerrainValue(layer) { return this.overwriteTerrainValue(0, layer); }
}

/* Testing

randomLayer = () => Math.clamped(Math.round(Math.random() * BITS), 0, BITS);
randomTerrain = () => Math.clamped(Math.round(Math.random() * 15), 0, 31);
random8Bit = () => Math.clamped(Math.round(Math.random() * 255), 0, 255);

// Can convert to/from rgba integers
minC = TerrainLayerPixel.fromRGBIntegers(0, 0, 0)
minMatches = minC.toTerrainLayers().every(elem => elem === 0);
console.debug(`min matches: ${minMatches}`);

maxC = TerrainLayerPixel.fromRGBIntegers(255, 255, 255)
tmp = maxC.toTerrainLayers();
maxMatches = tmp[0] === 31 && tmp[1] === 31 && tmp[2] === 31 && tmp[3] === 0 && tmp[4] === 0 && tmp[5] === 0
console.debug(`max matches: ${maxMatches}`)

// Can convert to/from terrain layers
for ( let terrainValue = 0; terrainValue < 16; terrainValue += 1 ) {
  for ( let layer = 0; layer < 6; layer += 1 ) {
    const c = TerrainLayerPixel.fromTerrainValue(terrainValue, layer);
    const layers = c.toTerrainLayers();
    if ( layers[layer] !== terrainValue ) {
      console.debug(`Fail at ${terrainValue}, ${layer}`);
      break;
    }
  }
  console.debug(`Finished terrain ${terrainValue}`);
}

for ( let i = 0; i < 1000; i += 1 ) {
  const layers = (new Array(6)).fill(0).map(l => randomTerrain());
  const c = TerrainLayerPixel.fromTerrainLayers(layers);
  const newLayers = Array(...c.toTerrainLayers()); // TerrainLayerPixel returns Uint8Array; convert.
  if ( !layers.equals(newLayers) ) {
    console.debug(`Fail at ${i}`, layers, newLayers);
    break;
  }
}

// Can add/remove terrain value
for ( let i = 0; i < 1000; i += 1 ) {
  const layers = (new Array(6)).fill(0).map(l => randomTerrain());
  const c = TerrainLayerPixel.fromTerrainLayers(layers);
  const newLayers = Array(...c.toTerrainLayers()); // TerrainLayerPixel returns Uint8Array; convert.
  if ( !layers.equals(newLayers) ) {
    console.debug(`Fail at ${i}`, layers, newLayers);
    break;
  }

  const addedLayer = randomLayer();
  const addedTerrain = randomTerrain();
  const addedC = c.overwriteTerrainValue(addedTerrain, addedLayer);
  const addedLayers = addedC.toTerrainLayers();
  for ( let i = 0; i < 6; i += 1 ) {
    if ( i === addedLayer ) {
      if ( addedLayers[i] !== addedTerrain ) console.debug(`Fail at adding layer ${addedLayer} with terrain ${addedTerrain}.`, layers);
    } else if ( addedLayers[i] !== layers[i] ) console.debug(`Fail at adding layer ${addedLayer} with terrain ${addedTerrain} (other layers modified).`, layers);
  }

  const removedC = c.removeTerrainValue(addedLayer);
  const removedLayers = removedC.toTerrainLayers();
  for ( let i = 0; i < 6; i += 1 ) {
    if ( i === addedLayer ) {
      if ( removedLayers[i] !== 0 ) console.debug(`Fail at removing layer ${addedLayer} with terrain ${addedTerrain}.`, layers);
    } else if ( removedLayers[i] !== layers[i] ) console.debug(`Fail at removing layer ${addedLayer} with terrain ${addedTerrain} (other layers modified).`, layers);
  }

  if ( i % 100 === 0 ) console.debug(`Finished i === ${i}`);
}

*/

