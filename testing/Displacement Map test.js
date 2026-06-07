/**
 * Generates a radial displacement texture for PIXI.
 * @param {number} radius - The radius of the hill base.
 * @returns {PIXI.Texture} A PIXI texture formatted for displacement.
 */
function generateBulgeDisplacementTexture(radius) {
  const size = radius * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Fill canvas with neutral displacement (127, 127, 127)
  ctx.fillStyle = "rgb(127, 127, 127)";
  ctx.fillRect(0, 0, size, size);

  // We must manipulate pixel data directly to set precise R and G vectors
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  const center = radius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.hypot(dx, dy);

      // Only warp pixels inside the radius
      if (distance < radius) {
        // Calculate normalized direction vectors (-1 to 1)
        const nx = dx / radius;
        const ny = dy / radius;

        // Easing function to make the bulge look like a smooth bell curve
        const intensity = Math.cos((distance / radius) * (Math.PI / 2));

        // Convert to RGB space (0-255), centered on 127
        const r = 127 + (nx * intensity * 127);
        const g = 127 + (ny * intensity * 127);

        const index = (y * size + x) * 4;
        data[index]     = r;     // Red (X shift)
        data[index + 1] = g;     // Green (Y shift)
        data[index + 2] = 127;   // Blue (Unused by displacement)
        data[index + 3] = 255;   // Alpha
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Convert the HTML canvas directly into a PIXI Texture
  return PIXI.Texture.from(canvas);
}

/**
   * Generates a displacement texture modeled accurately from the hill's Z-height profile.
   * @param {RegionDocument} region - The region document.
   * @param {Object} curve - The curve data {start, end, cp1, cp2}.
   * @param {string} option - The translation option required by hillZAtPoint.
   * @returns {PIXI.Texture} A PIXI texture formatted for displacement.
   */
function generateHillDisplacementTexture(region) {
    const bounds = region.bounds;

    // 1. Cap the resolution for performance. 256px is more than enough for smooth displacement.
    const MAX_RES = 256;
    let texWidth = bounds.width;
    let texHeight = bounds.height;
    const maxDim = Math.max(texWidth, texHeight);

    if (maxDim > MAX_RES) {
      const scale = MAX_RES / maxDim;
      texWidth = Math.floor(texWidth * scale);
      texHeight = Math.floor(texHeight * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = texWidth;
    canvas.height = texHeight;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(texWidth, texHeight);
    const data = imgData.data;

    // 2. Pass 1: Generate the Height Map using hillZAtPoint
    const heightMap = new Float32Array(texWidth * texHeight);
    let peakZ = 0.0001; // Avoid divide-by-zero later
    const tmpPt = PIXI.Point.tmp;
    const tm = region.terrainmapper;
    const curve = tm.hillCurve;
    const type = tm.hillType;

    for (let y = 0; y < texHeight; y++) {
      for (let x = 0; x < texWidth; x++) {
        // Map the low-res texture coordinate back to global canvas coordinates
        const globalX = bounds.left + (x / texWidth) * bounds.width;
        const globalY = bounds.top + (y / texHeight) * bounds.height;

        // Use your existing method to get the exact Z height at this point
        const z = HillDrawingManager.hillZAtPoint(tmpPt.set(globalX, globalY), curve, type);
        heightMap[y * texWidth + x] = z;

        if (z > peakZ) peakZ = z;
      }
    }

    // 3. Pass 2: Calculate the Gradients (Slope) to define the displacement vectors
    // A standard bulge pushes pixels "down" the slope, away from the peak.
    for (let y = 0; y < texHeight; y++) {
      for (let x = 0; x < texWidth; x++) {
        const idx = y * texWidth + x;
        const z = heightMap[idx];

        // If the point is totally flat (base level), assign neutral displacement
        if (z <= 0) {
          data[idx * 4]     = 127; // R
          data[idx * 4 + 1] = 127; // G
          data[idx * 4 + 2] = 127; // B
          data[idx * 4 + 3] = 255; // Alpha
          continue;
        }

        // Sample neighboring pixels to find the slope (Finite Difference Method)
        const leftZ  = x > 0 ? heightMap[y * texWidth + (x - 1)] : z;
        const rightZ = x < texWidth - 1 ? heightMap[y * texWidth + (x + 1)] : z;
        const upZ    = y > 0 ? heightMap[(y - 1) * texWidth + x] : z;
        const downZ  = y < texHeight - 1 ? heightMap[(y + 1) * texWidth + x] : z;

        // Calculate rate of change in X and Y
        const dx = (rightZ - leftZ) / 2;
        const dy = (downZ - upZ) / 2;

        // Normalize the slope based on the peak height to keep RGB values bounded.
        // The multiplier dictates how intensely the slope converts to color shifts.
        const gradientIntensity = 127 / peakZ;

        // Subtracting from 127 ensures the displacement pushes "downhill"
        let r = 127 - (dx * gradientIntensity);
        let g = 127 - (dy * gradientIntensity);

        // Clamp to valid RGB ranges
        r = Math.max(0, Math.min(255, Math.round(r)));
        g = Math.max(0, Math.min(255, Math.round(g)));

        data[idx * 4]     = r;
        data[idx * 4 + 1] = g;
        data[idx * 4 + 2] = 127;
        data[idx * 4 + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return PIXI.Texture.from(canvas);
  }

/**
 * Applies a displacement filter to a target container.
 * @param {PIXI.Container} targetContainer - The container displaying the map art.
 * @param {Object} center - The {x, y} canvas coordinates of the hill's peak.
 * @param {number} radius - The radius of the hill.
 */
function applyHillDisplacement(targetContainer, region) {
  // 1. Get the generated texture
  // const displacementTexture = generateBulgeDisplacementTexture(radius);
  const displacementTexture = generateHillDisplacementTexture(region);

  // 2. Wrap it in a Sprite
  const displacementSprite = new PIXI.Sprite(displacementTexture);

  // Anchor the sprite to its center so it aligns properly with our target coordinates
  displacementSprite.anchor.set(0.5);
  displacementSprite.x = region.center.x;
  displacementSprite.y = region.center.y;

  // IMPORTANT: The displacement sprite MUST be added to the stage or container hierarchy
  // for its transforms (x, y, scale) to update properly, even if it's not rendered visually.
  targetContainer.addChild(displacementSprite);

  // 3. Create the Filter
  const displacementFilter = new PIXI.filters.DisplacementFilter(displacementSprite);

  // The scale determines how extreme the warp is (in pixels)
  displacementFilter.scale.x = 50;
  displacementFilter.scale.y = 50;

  // 4. Apply the filter to the target
  // If the target already has filters, append to the array. Otherwise, create a new array.
  targetContainer.filters = (targetContainer.filters || []).concat([displacementFilter]);

  return { sprite: displacementSprite, filter: displacementFilter };
}


region = canvas.regions.controlled[0]

// 1. Create a container for the visual effect
hillContainer = new PIXI.Container();

// V14 Architecture: Attach to the PrimaryCanvasGroup, ensuring it sorts with other environment elements
hillContainer.elevation = 0 // region.document.elevation?.bottom ?? 0;
hillContainer.sortableChildren = true;
canvas.primary.addChild(hillContainer);

// 2. Clone the map's background sprite
// V14 stores the primary background sprite within canvas.primary.background
primaryBg = canvas.primary.background;
if (primaryBg && primaryBg.texture) {
  const bgSprite = new PIXI.Sprite(primaryBg.texture);

  // Match the dimensions and transform of the base map
  bgSprite.width = primaryBg.width;
  bgSprite.height = primaryBg.height;

  // Sync the transform matrix so it perfectly aligns with the canvas
  bgSprite.x = canvas.scene.dimensions.sceneRect.x
  bgSprite.y = canvas.scene.dimensions.sceneRect.y

  // bgSprite.transform.setFromMatrix(primaryBg.transform.worldTransform);
  hillContainer.addChild(bgSprite);
}

// 3. Mask the container to the Region's exact geometry
maskGraphics = new PIXI.Graphics();
maskGraphics.beginFill(0xFFFFFF);

// V14 graphics uses drawShape for native polygon/rectangle geometries
region.document.polygons.forEach(poly => maskGraphics.drawShape(poly));
maskGraphics.endFill();

hillContainer.addChild(maskGraphics);
hillContainer.mask = maskGraphics;

// 4. Apply the Displacement Filter
// Use the region bounds to calculate the appropriate radius for the warp
effect = applyHillDisplacement(hillContainer, region);

// Increase effect.
effect.filter.scale.x = 1000
effect.filter.scale.y = 1000

// 5. Connecting to the Manager (Optional)
// Update the displacement dynamically during dragging
// effect.sprite.x = newHandlePosition.x;
// effect.sprite.y = newHandlePosition.y;
// effect.filter.scale.set(newZHeight / 2);
