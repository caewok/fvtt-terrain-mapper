/* globals
Color
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Color representation specific to Terrain pixel.
// Unlike Color class, this treats alpha as the fourth 8-bit channel.
// See https://stackoverflow.com/questions/6798111/bitwise-operations-on-32-bit-unsigned-ints

/**
 * A representation of a color in hexadecimal format.
 * Color is 8 bit per channel, rgba.
 */
export class AlphaColor extends Color {
  // NOTE: Overwritten Color methods to handle the larger bit shift.
  get rgb() { return [this.r, this.g, this.b]; }

  get r() { return this.rInt / 255; }

  get g() { return this.gInt / 255; }

  get b() { return this.bInt / 255; }

  get littleEndian() { return console.error("littleEndian not implemented for TerrainColor"); }

  toRGBA(alpha) {
    alpha ??= this.aInt;
    const rgba = [this.rInt, this.gInt, this.bInt, alpha];
    return `rgba(${rgba.join(", ")})`;
  }

  static from(color) {
    if ( (color instanceof Array) && (color.length === 4) ) return this.fromRGBA(color);
    return super.from(color);
  }

  static fromRGB(rgb) {
    return new this(this._fromRed(rgb[0] * 255)
      + this._fromGreen(rgb[1] * 255)
      + this._fromBlue(rgb[2] * 255));
  }

  static fromRGBvalues(r, g, b) {
    return new this(this._fromRed(r * 255)
      + this._fromGreen(g * 255)
      + this._fromBlue(b * 255));
  }

  // NOTE: New methods to account for alpha and to facilitate calcs.

// TODO: Switch to ABGR representation.
// TODO: Add mix, multiply, etc. code that can handle alpha correctly.
//   function cArrayToABGR(va) {
//       var res = 0;
//       for (var i = 0; i < va.length; ++i) {
//           var color = va[i];
//           color <<= (8 * i);
//           res += color;
//       }
//       return res >>> 0;
//   }

  static _red(x) { return (((x >>> 16) & 0xFF) >>> 0); }

  static _green(x) { return (((x >>> 8) & 0xFF) >>> 0); }

  static _blue(x) { return (x & 0xFF); }

  static _alpha(x) { return (((x >>> 24) & 0xFF) >>> 0);; }

  static _fromRed(r) { return ((r << 16) >>> 0); }

  static _fromGreen(g) { return ((g << 8) >>> 0); }

  static _fromBlue(b) { return (b | 0); }

  static _fromAlpha(a) { return ((a << 24) >>> 0); }


  get rInt() { return this.constructor._red(this); }

  get gInt() { return this.constructor._green(this); }

  get bInt() { return this.constructor._blue(this); }

  get aInt() { return this.constructor._alpha(this); }

  /**
   * The numeric value of the alpha channel between [0, 1].
   * @type {number}
   */
  get a() { return this.aInt / 255; }

  /**
   * The color represented as an RGBA array.
   * @type {[number, number, number, number]}
   */
  get rbga() { return [this.r, this.g, this.b, this.a]; }

  get rgbaIntegerValues() {
    const { _red, _green, _blue, _alpha } = this.constructor;
    return {
      r: _red(this),
      g: _green(this),
      b: _blue(this),
      a: _alpha(this)
    };
  }

  /**
   * Create a Color instance from RGBA integer values, each between 0 and 255.
   * @param {number} r                          The red value
   * @param {number} g                          The green value
   * @param {number} b                          The blue value
   * @param {number} a                          The alpha value
   * @returns {Color}                           The hex color instance
   */
  static fromRGBAIntegers(r, g, b, a = 0) {
    return new this(this._fromRed(r)
      + this._fromGreen(g)
      + this._fromBlue(b)
      + this._fromAlpha(a));
  }

  /**
   * Create a Color instance from an RGB normalized values.
   * @param {number} r                          The red value
   * @param {number} g                          The green value
   * @param {number} b                          The blue value
   * @param {number} a                          The alpha value
   * @returns {Color}                           The hex color instance
   */
  static fromRGBAvalues(r, g, b, a = 0) {
    return this.fromRGBAIntegers(r * 255, g * 255, b * 255, a * 255);
  }

}

/**
 * A representation of terrain pixels, in hexadecimal format.
 * Each pixel has up to 16 terrains (including 0/none), with 8 layers (1 terrain per layer).
 */
export class TerrainColor extends AlphaColor {
  /**
   * Convert a terrain value and a layer to a color.
   * @param {number} terrainValue   Integer between 0 and 15.
   * @param {number} layer          Integer between 0 and 7.
   * @returns {TerrainColor}
   */
  static fromTerrainValue(terrainValue, layer) {
    terrainValue = Math.clamped(Math.floor(terrainValue), 0, 15);
    layer = Math.clamped(Math.floor(layer), 0, 7);
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    switch ( layer ) {
      case 0: r = terrainValue; break;
      case 1: r = (terrainValue << 4); break;
      case 2: g = terrainValue; break;
      case 3: g = (terrainValue << 4); break;
      case 4: b = terrainValue; break;
      case 5: b = (terrainValue << 4); break;
      case 6: a = terrainValue; break;
      case 7: a = (terrainValue << 4); break;
    }
    return this.fromRGBAIntegers(r, g, b, a);
  }

  /**
   * Convert an array of terrain layers to a pixel color representation.
   * @param {Uint8Array[8]} layers    Array of terrain values.
   * @returns {TerrainColor}
   */
  static fromTerrainLayers(layers) {
    layers = layers.map(l => Math.clamped(Math.floor(l), 0, 15));
    const r = (layers[1] << 4) + layers[0];
    const g = (layers[3] << 4) + layers[2];
    const b = (layers[5] << 4) + layers[4];
    const a = (layers[7] << 4) + layers[6];
    return this.fromRGBAIntegers(r, g, b, a);
  }

  /**
   * Convert this color to the terrain value and layers
   * @returns {Uint8Array[8]}
   */
  toTerrainLayers() {
    const { rInt, gInt, bInt, aInt } = this;
    const layers = new Uint8Array(8);
    layers[0] = (rInt & 15);
    layers[1] = (rInt >> 4);
    layers[2] = (gInt & 15);
    layers[3] = (gInt >> 4);
    layers[4] = (bInt & 15);
    layers[5] = (bInt >> 4);
    layers[6] = (aInt & 15);
    layers[7] = (aInt >> 4);
    return layers;
  }

  /**
   * Add this terrain value for the desired layer in this pixel representation.
   * Overwrites whatever value was there previously.
   * @param {number} terrainValue   Integer between 0 and 15.
   * @param {number} layer          Integer between 0 and 7.
   * @returns {TerrainValue} This updated terrain value.
   */
  overwriteTerrainValue(terrainValue, layer) {
    terrainValue = Math.clamped(Math.floor(terrainValue), 0, 15);
    layer = Math.clamped(Math.floor(layer), 0, 7);

    let { rInt, gInt, bInt, aInt } = this;
    let layer0 = terrainValue;
    let layer1 = terrainValue;
    switch ( layer ) {
      case 0: layer1 = (rInt >> 4); break;
      case 1: layer0 = (rInt & 15); break;
      case 2: layer1 = (gInt >> 4); break;
      case 3: layer0 = (gInt & 15); break;
      case 4: layer1 = (bInt >> 4); break;
      case 5: layer0 = (bInt & 15); break;
      case 6: layer1 = (aInt >> 4); break;
      case 7: layer0 = (aInt & 15); break;
    }

    const newInt = (layer1 << 4) + layer0;
    switch ( layer ) {
      case 0:
      case 1:
        rInt = newInt;
        break;
      case 2:
      case 3:
        gInt = newInt;
        break;
      case 4:
      case 5:
        bInt = newInt;
        break;
      case 6:
      case 7:
        aInt = newInt;
        break;
    }

    return this.constructor.fromRGBAIntegers(rInt, gInt, bInt, aInt);
  }

  /**
   * Remove this terrain value for the desired layer in this pixel representation.
   * Overwrites whatever value was there previously with 0.
   * @param {number} layer          Integer between 0 and 7.
   * @returns {TerrainValue} A new TerrainValue object.
   */
  removeTerrainValue(layer) { return this.overwriteTerrainValue(0, layer); }
}

// Functions required to avoid bit-shifting, since JS is stupid when it comes to 32-bit shifts.
// See https://stackoverflow.com/questions/33137519/how-to-left-shift-numbers-greater-than-32-bits
// (Could use BigInt, but it would be slow.)

/**
 * Equivalent to number << shift
 * @param {number} number     Integer to shift.
 * @param {number} shift      Number of bits to shift.
 * @returns {number}
 */
function shiftLeft(number, shift) {
  return Math.floor(number * Math.pow(2, shift));
}

/**
 * Equivalent to number >> shift
 * @param {number} number     Integer to shift.
 * @param {number} shift      Number of bits to shift.
 * @returns {number}
 */
function shiftRight(number, shift) {
  return Math.floor(number * Math.pow(2, -shift));
}


/* Testing

randomLayer = () => Math.clamped(Math.round(Math.random() * 7), 0, 7);
randomTerrain = () => Math.clamped(Math.round(Math.random() * 15), 0, 15);
random8Bit = () => Math.clamped(Math.round(Math.random() * 255), 0, 255);

// Can convert to/from rgba integers
minC = AlphaColor.fromRGBAIntegers(0, 0, 0, 0)
maxC = AlphaColor.fromRGBAIntegers(255, 255, 255, 255)
minMatches = minC.rInt === 0 && minC.gInt === 0 && minC.bInt === 0 && minC.aInt === 0
maxMatches = maxC.rInt === 255 && maxC.gInt === 255 && maxC.bInt === 255 && maxC.aInt === 255
console.debug(`min matches: ${minMatches}; max matches: ${maxMatches}`)

for ( let i = 0; i < 1000; i += 1 ) {
  const r = random8Bit();
  const g = random8Bit();
  const b = random8Bit();
  const a = random8Bit();
  const c = AlphaColor.fromRGBAIntegers(r, g, b, a);
  const matches = c.rInt === r && c.gInt === g && c.bInt === b && c.aInt === a;
  if ( !matches ) {
    console.debug(`Fail at rgba ${r},${g},${b},${a}`);
    break;
  }
  if ( i % 100 === 0 ) console.debug(`Finished i === ${i}`);
}



// Can convert to/from terrain layers
for ( let terrainValue = 0; terrainValue < 16; terrainValue += 1 ) {
  for ( let layer = 0; layer < 8; layer += 1 ) {
    const c = TerrainColor.fromTerrainValue(terrainValue, layer);
    const layers = c.toTerrainLayers();
    if ( layers[layer] !== terrainValue ) {
      console.debug(`Fail at ${terrainValue}, ${layer}`);
      break;
    }
  }
  console.debug(`Finished terrain ${terrainValue}`);
}

for ( let i = 0; i < 1000; i += 1 ) {
  const layers = (new Array(8)).fill(0).map(l => randomTerrain());
  const c = TerrainColor.fromTerrainLayers(layers);
  const newLayers = Array(...c.toTerrainLayers()); // TerrainColor returns Uint8Array; convert.
  if ( !layers.equals(newLayers) ) {
    console.debug(`Fail at ${i}`, layers, newLayers);
    break;
  }
}

// Can add/remove terrain value
for ( let i = 0; i < 1000; i += 1 ) {
  const layers = (new Array(8)).fill(0).map(l => randomTerrain());
  const c = TerrainColor.fromTerrainLayers(layers);
  const newLayers = Array(...c.toTerrainLayers()); // TerrainColor returns Uint8Array; convert.
  if ( !layers.equals(newLayers) ) {
    console.debug(`Fail at ${i}`, layers, newLayers);
    break;
  }

  const addedLayer = randomLayer();
  const addedTerrain = randomTerrain();
  const addedC = c.overwriteTerrainValue(addedTerrain, addedLayer);
  const addedLayers = addedC.toTerrainLayers();
  for ( let i = 0; i < 8; i += 1 ) {
    if ( i === addedLayer ) {
      if ( addedLayers[i] !== addedTerrain ) console.debug(`Fail at adding layer ${addedLayer} with terrain ${addedTerrain}.`, layers);
    } else if ( addedLayers[i] !== layers[i] ) console.debug(`Fail at adding layer ${addedLayer} with terrain ${addedTerrain} (other layers modified).`, layers);
  }

  const removedC = c.removeTerrainValue(addedLayer);
  const removedLayers = removedC.toTerrainLayers();
  for ( let i = 0; i < 8; i += 1 ) {
    if ( i === addedLayer ) {
      if ( removedLayers[i] !== 0 ) console.debug(`Fail at removing layer ${addedLayer} with terrain ${addedTerrain}.`, layers);
    } else if ( removedLayers[i] !== layers[i] ) console.debug(`Fail at removing layer ${addedLayer} with terrain ${addedTerrain} (other layers modified).`, layers);
  }

  if ( i % 100 === 0 ) console.debug(`Finished i === ${i}`);
}



*/
