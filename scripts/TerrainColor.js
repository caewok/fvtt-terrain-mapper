/* globals
Color
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Color representation specific to Terrain pixel.

/**
 * A representation of terrain pixels, in hexadecimal format.
 * Each pixel has up to 16 terrains (including 0/none), with 6 layers (1 terrain per layer in RGB).
 */
export class TerrainColor extends Color {

  /**
   * Create a TerrainColor instance from RGB values.
   * @param {number} r      The red value (0 to 255)
   * @param {number} g      The green value (0 to 255)
   * @param {number} b      The blue value (0 to 255)
   * @returns {TerrainColor}
   */
  static fromRGBIntegers(r, g, b) { return new this((r << 16) + (g << 8) + ( b | 0)); }

  /**
   * Get an RGB array, non-normalized. (Each number is 0–255.)
   * @type {[number, number, number]}
   */
  get rgbInt() { return [((this >> 16) & 0xFF), ((this >> 8) & 0xFF), (this & 0xFF)]; }

  /**
   * Convert a terrain value and a layer to a color.
   * @param {number} terrainValue   Integer between 0 and 15.
   * @param {number} layer          Integer between 0 and 7.
   * @returns {TerrainColor}
   */
  static fromTerrainValue(terrainValue, layer) {
    terrainValue = Math.clamped(Math.floor(terrainValue), 0, 15);
    layer = Math.clamped(Math.floor(layer), 0, 5);
    let r = 0;
    let g = 0;
    let b = 0;
    switch ( layer ) {
      case 0: r = terrainValue; break;
      case 1: r = (terrainValue << 4); break;
      case 2: g = terrainValue; break;
      case 3: g = (terrainValue << 4); break;
      case 4: b = terrainValue; break;
      case 5: b = (terrainValue << 4); break;
    }
    return this.fromRGBIntegers(r, g, b);
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
    return this.fromRGBIntegers(r, g, b);
  }

  /**
   * Convert this color to the terrain value and layers
   * @returns {Uint8Array[8]}
   */
  toTerrainLayers() {
    const rgbInt = this.rgbInt;
    const layers = new Uint8Array(6);
    for ( let channel = 0; channel < 3; channel += 1 ) {
      const first8 = channel * 2;
      const second8 = (channel * 2) + 1;
      layers[first8] = (rgbInt[channel] & 15);  // Even
      layers[second8] = (rgbInt[channel] >> 4); // Odd
    }
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
    layer = Math.clamped(Math.floor(layer), 0, 5);

    const rgbInt = this.rgbInt;
    let rInt = rgbInt[0];
    let gInt = rgbInt[1];
    let bInt = rgbInt[2];

    let layer0 = terrainValue;
    let layer1 = terrainValue;
    switch ( layer ) {
      case 0: layer1 = (rInt >> 4); break;
      case 1: layer0 = (rInt & 15); break;
      case 2: layer1 = (gInt >> 4); break;
      case 3: layer0 = (gInt & 15); break;
      case 4: layer1 = (bInt >> 4); break;
      case 5: layer0 = (bInt & 15); break;
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
    }

    return this.constructor.fromRGBIntegers(rInt, gInt, bInt);
  }

  /**
   * Remove this terrain value for the desired layer in this pixel representation.
   * Overwrites whatever value was there previously with 0.
   * @param {number} layer          Integer between 0 and 7.
   * @returns {TerrainValue} A new TerrainValue object.
   */
  removeTerrainValue(layer) { return this.overwriteTerrainValue(0, layer); }
}


/* Testing

randomLayer = () => Math.clamped(Math.round(Math.random() * 5), 0, 5);
randomTerrain = () => Math.clamped(Math.round(Math.random() * 15), 0, 15);
random8Bit = () => Math.clamped(Math.round(Math.random() * 255), 0, 255);

// Can convert to/from rgba integers
minC = TerrainColor.fromRGBIntegers(0, 0, 0, 0)
maxC = TerrainColor.fromRGBIntegers(255, 255, 255, 255)
minMatches = minC.rgbInt[0] === 0 && minC.rgbInt[1] === 0 && minC.rgbInt[2] === 0
maxMatches = maxC.rgbInt[0] === 255 && maxC.rgbInt[1] === 255 && maxC.rgbInt[2] === 255
console.debug(`min matches: ${minMatches}; max matches: ${maxMatches}`)

for ( let i = 0; i < 1000; i += 1 ) {
  const r = random8Bit();
  const g = random8Bit();
  const b = random8Bit();
  const c = TerrainColor.fromRGBIntegers(r, g, b);
  const matches = c.rgbInt[0] === r && c.rgbInt[1] === g && c.rgbInt[2] === b;
  if ( !matches ) {
    console.debug(`Fail at rgb ${r},${g},${b}`);
    break;
  }
  if ( i % 100 === 0 ) console.debug(`Finished i === ${i}`);
}

// Can convert to/from terrain layers
for ( let terrainValue = 0; terrainValue < 16; terrainValue += 1 ) {
  for ( let layer = 0; layer < 6; layer += 1 ) {
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
  const layers = (new Array(6)).fill(0).map(l => randomTerrain());
  const c = TerrainColor.fromTerrainLayers(layers);
  const newLayers = Array(...c.toTerrainLayers()); // TerrainColor returns Uint8Array; convert.
  if ( !layers.equals(newLayers) ) {
    console.debug(`Fail at ${i}`, layers, newLayers);
    break;
  }
}

// Can add/remove terrain value
for ( let i = 0; i < 1000; i += 1 ) {
  const layers = (new Array(6)).fill(0).map(l => randomTerrain());
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
