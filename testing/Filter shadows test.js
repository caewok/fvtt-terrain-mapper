  /**
   * Generates a Normal Map texture from the hillZAtPoint topography.
   * @param {RegionDocument} region - The region document.
   * @param {Object} curve - The curve data {start, end, cp1, cp2}.
   * @param {string} option - The translation option.
   * @returns {PIXI.Texture} A PIXI texture formatted as an RGB Normal Map.
   */
function generateHillNormalMap(region, steepness = 2.5) {
  const tm = region.terrainmapper;
  const curve = tm.hillCurve;
  const type = tm.hillType;

  const bounds = region.bounds;
  const MAX_RES = 256; // Cap resolution for CPU performance
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

  // Pass 1: Generate Height Map
  const heightMap = new Float32Array(texWidth * texHeight);
  using tmpPt = PIXI.Point.tmp;
  for (let y = 0; y < texHeight; y++) {
    for (let x = 0; x < texWidth; x++) {
      const globalX = bounds.left + (x / texWidth) * bounds.width;
      const globalY = bounds.top + (y / texHeight) * bounds.height;
      heightMap[y * texWidth + x] = HillDrawingManager.hillZAtPoint(tmpPt.set(globalX, globalY), curve, type);
    }
  }

  // Scaling factors to convert pixel distance back to world distance for accurate slopes
  const stepX = bounds.width / texWidth;
  const stepY = bounds.height / texHeight;

  // Pass 2: Calculate Surface Normals
  for (let y = 0; y < texHeight; y++) {
    for (let x = 0; x < texWidth; x++) {
      const idx = (y * texWidth + x) * 4;
      const z = heightMap[y * texWidth + x];

      // Flat ground = straight up normal vector (0, 0, 1) mapped to RGB (128, 128, 255)
      if (z <= 0) {
        data[idx] = 128;     // R (X vector: 0) Neutral X.
        data[idx + 1] = 128; // G (Y vector: 0) Neutral Y.
        data[idx + 2] = 255; // B (Z vector: 1) Facing straight up Z.
        data[idx + 3] = 255; // Alpha
        continue;
      }

      // Sample neighbors to find slopes (dz/dx and dz/dy)
      const leftZ  = x > 0 ? heightMap[y * texWidth + (x - 1)] : z;
      const rightZ = x < texWidth - 1 ? heightMap[y * texWidth + (x + 1)] : z;
      const upZ    = y > 0 ? heightMap[(y - 1) * texWidth + x] : z;
      const downZ  = y < texHeight - 1 ? heightMap[(y + 1) * texWidth + x] : z;

      // Partial derivatives
      // Multiply by the steepness variable to push vectors further away from {0, 0, 1}.
      const dzdx = ((rightZ - leftZ) / (2 * stepX)) * steepness;
      const dzdy = ((downZ - upZ) / (2 * stepY)) * steepness;

      // Calculate the normal vector components
      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1.0; // The strength of the Z axis determines how "bumpy" the normal map looks

      // Normalize the vector length to 1.0
      const len = Math.hypot(nx, ny, nz);
      const normX = nx / len;
      const normY = ny / len;
      const normZ = nz / len;

      // Convert normalized vector [-1.0 to 1.0] to RGB [0 to 255]
      data[idx]     = Math.round((normX + 1.0) * 127.5);
      data[idx + 1] = Math.round((normY + 1.0) * 127.5);
      data[idx + 2] = Math.round((normZ + 1.0) * 127.5);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // PIXI configurations to ensure smooth scaling of the low-res normal map
  const texture = PIXI.Texture.from(canvas);
  texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
  return texture;
}

/**
 * A custom PIXI Filter that calculates 3D lighting using a normal map.
 */
class HillShaderFilter extends PIXI.Filter {
  constructor(normalMapTexture) {
    // Default PIXI vertex shader
    const vertexSrc = `
      attribute vec2 aVertexPosition;
      attribute vec2 aTextureCoord;

      uniform mat3 projectionMatrix;
      uniform mat3 filterMatrix; // From PIXI.

      varying vec2 vTextureCoord; // Screen-clamped space.
      varying vec2 vFilterCoord; // Unclamped, stable map space.

      void main(void) {
        gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
        vTextureCoord = aTextureCoord;
        vFilterCoord = (filterMatrix * vec3(aTextureCoord, 1.0)).xy;
      }
    `;

    // Custom Fragment Shader
    const fragmentSrc = `
      varying vec2 vTextureCoord;
      varying vec2 vFilterCoord;

      uniform sampler2D uSampler;     // The underlying map texture
      uniform sampler2D uNormalMap;   // Our generated normal map
      uniform vec3 uLightDirection;   // The direction of the sun
      uniform vec3 uLightColor;       // The color of the sun
      uniform vec3 uAmbientColor;     // Base shadow color

      // Coordinates mapping the region bounding box inside the whole map.
      uniform vec2 uRegionUVOffset;
      uniform vec2 uRegionUVScale;

      void main(void) {
        // Sample the original map pixel
        vec4 baseColor = texture2D(uSampler, vTextureCoord);


        // Translate the stable map UV coordinate down to our region's isolated normal map UV space
        vec2 uvNormal = (vFilterCoord - uRegionUVOffset) / uRegionUVScale;

        // Default to a perfectly flat surface vector pointing straight up (no shadow adjustment)
        vec3 normal = vec3(0.0, 0.0, 1.0);
        gl_FragColor = vec4(normal, 0.5);

        // Only sample the normal map if we are within the boundaries of the region bounding box
        if (uvNormal.x >= 0.0 && uvNormal.x <= 1.0 && uvNormal.y >= 0.0 && uvNormal.y <= 1.0) {
          vec4 normalColor = texture2D(uNormalMap, uvNormal);
          gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
          normal = normalize(normalColor.rgb * 2.0 - 1.0);
        }
        /*
        // Calculate stable diffuse lighting
        float diff = max(dot(normal, normalize(uLightDirection)), 0.0);
        vec3 diffuse = diff * uLightColor;

        vec3 finalLighting = uAmbientColor + diffuse;
        gl_FragColor = vec4(baseColor.rgb * finalLighting, baseColor.a);
        */

      }
    `;

    // Initialize uniforms
    super(vertexSrc, fragmentSrc, {
      uNormalMap: normalMapTexture,

      // Default: Sun coming from the top-left, pointing down and right
      uLightDirection: new Float32Array([1.0, 1.0, 1.0]),

      // Default: Bright white light
      uLightColor: new Float32Array([1.0, 1.0, 1.0]),

      // Default: 40% ambient brightness for shadows
      uAmbientColor: new Float32Array([0.4, 0.4, 0.4]),

      uRegionUVOffset: new Float32Array([0.0, 0.0]),
      uRegionUVScale: new Float32Array([1.0, 1.0]),
    });
  }

  /**
   * Helper to easily update the normal map texture if the hill changes
   */
  updateNormalMap(texture) {
    this.uniforms.uNormalMap = texture;
  }
}

/**
   * Applies the WebGL photorealistic lighting effect to the Region.
   * @param {PIXI.Container} effectContainer - The PIXI container on the primary group.
   * @param {RegionDocument} region - The region document.
   * @param {Object} curve - The current curve data.
   * @param {string} option - The translation option.
   */
function applyPhotorealisticHill(hillContainer, region) {
  // 1. Generate the Normal Map
  const normalTex = generateHillNormalMap(region);

  // 2. Set up the Shader Filter
  const lightingFilter = new HillShaderFilter(normalTex);

  // Optional: Hook into Foundry's daylight/darkness systems to adjust ambient lighting dynamically
  // lightingFilter.uniforms.uAmbientColor = new Float32Array([0.2, 0.2, 0.3]); // Darker, bluish shadow

  // 3. Clear container and setup the background sprite clone (v14 approach)
  hillContainer.removeChildren();

  const primaryBg = canvas.primary.background;
  if (primaryBg && primaryBg.texture) {
    const bgSprite = new PIXI.Sprite(primaryBg.texture);
    bgSprite.width = primaryBg.width;
    bgSprite.height = primaryBg.height;
    bgSprite.x = primaryBg.x;
    bgSprite.y = primaryBg.y;

    if ( primaryBg.anchor ) bgSprite.anchor.copyFrom(primaryBg.anchor);

    // Calculate where the region lives inside the world map asset (0.0 to 1.0 scale)
    const mapWidth = primaryBg.width;
    const mapHeight = primaryBg.height;

    const uvX = region.bounds.left / mapWidth;
    const uvY = region.bounds.top / mapHeight;
    const uvW = region.bounds.width / mapWidth;
    const uvH = region.bounds.height / mapHeight;

    // Inject the layout metrics into the shader uniforms
    lightingFilter.uniforms.uRegionUVOffset = new Float32Array([uvX, uvY]);
    lightingFilter.uniforms.uRegionUVScale = new Float32Array([uvW, uvH]);

    // Apply the WebGL shader to the sprite
    bgSprite.filters = [lightingFilter];
    hillContainer.addChild(bgSprite);
  }

  // 4. Mask to Region
  const mask = new PIXI.Graphics();
  mask.beginFill(0xFFFFFF);
  region.document.polygons.forEach(poly => mask.drawShape(poly));
  mask.endFill();

  hillContainer.addChild(mask);
  hillContainer.mask = mask;

  // 5. Store the filter reference to update it dynamically during dragging
  return lightingFilter;
}



hillContainer = new PIXI.Container();

// V14 Architecture: Attach to the PrimaryCanvasGroup, ensuring it sorts with other environment elements
hillContainer.elevation = 0 // region.document.elevation?.bottom ?? 0;
hillContainer.sortableChildren = true;

lightingFilter = applyPhotorealisticHill(hillContainer, region)

canvas.primary.addChild(hillContainer);

canvas.primary.removeChild(hillContainer);

steepness = 2.5
normalTex = generateHillNormalMap(region, steepness);
lightingFilter.updateNormalMap(normalTex)

