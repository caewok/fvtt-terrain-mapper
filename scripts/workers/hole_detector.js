/* ------------------------------------*/
 * Hole Detector Worker Functions
/* ------------------------------------*/

/**
 * Placeholder for eventual worker method that takes the tile array and constructs a hole array
 * @param {Uint8Array} tileCachePixels      The pixel array for a tile
 * @param {number} width                    The local width of the tile cache
 * @param {number} alphaPixelThreshold      Value between 0 and 255; above this is non-transparent.
 *                                          Default is alphaThreshold = 75%
 * @returns {Uint16Array} The hole cache array
 */
function calculateHoleCachePixels({ tileCachePixels, width, alphaPixelThreshold = 191.25 } = {}) {
  const MAX_VALUE = 65535; // Uint16Array maximum.
  const nPixels = tileCachePixels.length;
  const holeCachePixels = new Uint16Array(nPixels);

  // Set each alpha pixel to the max integer value to start, 0 otherwise.
  console.time(`${MODULE_ID}|Mark each alpha pixel`);
  for ( let i = 0; i < nPixels; i += 1 ) holeCachePixels[i] = tileCachePixels[i] > alphaPixelThreshold ? 0 : MAX_VALUE;
  console.timeEnd(`${MODULE_ID}|Mark each alpha pixel`); // 6.5 ms.
  // avgPixels(holeCache.pixels); // 0.66
  // drawPixels(holeCache)
  // drawHoles(holeCache)
  // pixelCounts(holeCache, max = 1) // {0: 616231, 1: 0, > 1: 1408769, numPixels: 2025000}

  const changedIndices = new Set();
  const updatePixel = idx => {
    const value = holeCachePixels[idx];
    if ( !value ) return;
    const newValue = Math.min(MAX_VALUE, Math.min(...localNeighbors(holeCachePixels, idx, width)) + 1);
    if ( value === newValue ) return;
    holeCachePixels[idx] = newValue;
    changedIndices.add(idx);
  }

  // For each pixel that is greater than 0, its value is 1 + min of 8 neighbors.
  // Record changed indices so we can re-process those neighbors.
  console.time(`${MODULE_ID}|Iterate over every pixel`);
  for ( let i = 0; i < nPixels; i += 1 ) updatePixel(i);
  console.timeEnd(`${MODULE_ID}|Iterate over every pixel`); // 100 ms
  // avgPixels(holeCache.pixels); // 1.33
  // drawPixels(holeCache)
  // drawHoles(holeCache)
  // pixelCounts(holeCache, max = 2) // {0: 616231, 1: 11632, 2: 7360, > 2: 1389777, numPixels: 2025000}

  const MAX_ITER = 1000;
  console.time(`${MODULE_ID}|Update pixels`);
  let iter = 0;
  while ( changedIndices.size && iter < MAX_ITER ) {
    iter += 1;
    const indices = [...changedIndices.values()];
    changedIndices.clear();
    for ( const idx of indices ) {
      const neighborIndices = localNeighborIndices(holeCachePixels, idx, width);
      for ( const neighborIdx of neighborIndices ) updatePixel(neighborIdx);
    }
  }
  console.timeEnd(`${MODULE_ID}|Update pixels`); // 28801.6630859375 ms // 11687.419189453125 ms using pixelStep instead of x,y.
  console.log(`${MODULE_ID}|${iter} iterations.`);
  return holeCachePixels;
}


/**
 * For this rectangular frame of local pixels, step backward or forward in the x and y directions
 * from a current index. Presumes index is row-based, such that:
 * 0 1 2 3
 * 4 5 6 7...
 * @param {number} currIdx
 * @param {number} [xStep = 0]
 * @param {number} [yStep = 0]
 * @returns {number} The new index position
 */
function localPixelStep(currIdx, localWidth, xStep = 0, yStep = 0) {
  return currIdx + (yStep * localWidth) + xStep;
}

/**
 * Indices of the 8 neighbors to this local pixel index. Does not
 * @param {number} currIdx
 * @returns {number[]}
 */
function localNeighborIndices(pixels, currIdx, localWidth, trimBorder = true) {
  const arr = [];
  const maxIdx = pixels.length - 1;
  for ( let xi = -1; xi < 2; xi += 1 ) {
    for ( let yi = -1; yi < 2; yi += 1 ) {
      if ( !(xi || yi) ) continue;
      const neighborIdx = localPixelStep(currIdx, localWidth, xi, yi);
      if ( trimBorder && !neighborIdx.between(0, maxIdx) ) continue;
      arr.push(neighborIdx);
    }
  }
  return arr;
}

/**
 * Retrieve the 8 neighbors to a given index on the local cache.
 * @param {number} currIdx
 * @param {boolean} [trimBorder=true]    If true, exclude the border values
 * @returns {number[]} The values, in column order, skipping the middle value.
 */
function localNeighbors(pixels, currIdx, localWidth, trimBorder = true) {
  return localNeighborIndices(pixels, currIdx, localWidth, trimBorder).map(idx => pixels[idx]);
}