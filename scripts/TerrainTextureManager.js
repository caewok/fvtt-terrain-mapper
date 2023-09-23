/* globals
canvas,
CONFIG,
FilePicker,
game,
isNewerVersion,
PIXI,
TextureLoader
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";


// Class to manage loading and saving of the elevation texture.

export class TerrainTextureManager {
  /**
   * The maximum allowable visibility texture size.
   * In v11, this is equal to CanvasVisibility.#MAXIMUM_VISIBILITY_TEXTURE_SIZE
   * @type {number}
   */
  static #MAXIMUM_TEXTURE_SIZE = CONFIG[MODULE_ID]?.elevationTextureSize ?? 4096;

  /** @type {boolean} */
  #initialized = false;

  /** @type {boolean} */
  #useCachedTexture = false;

  /** @type {string} */
  #filePath = "";

  /** @type {string} */
  #fileName = "";

  /**
   * @typedef {object} ElevationTextureConfiguration
   * @property {number} resolution    Resolution of the texture
   * @property {number} width         Width, based on sceneWidth
   * @property {number} height        Height, based on sceneHeight
   * @property {PIXI.MIPMAP_MODES} mipmap
   * @property {PIXI.SCALE_MODES} scaleMode
   * @property {PIXI.MSAA_QUALITY} multisample
   * @property {PIXI.FORMATS} format
   */

  /** @type {ElevationTextureConfiguration} */
  #textureConfiguration;

  /**
   * Initialize the elevation texture - resetting it when switching scenes or redrawing canvas.
   * @param {object} [opts]               Optional parameters that affect storage location
   * @param {string} [opts.filePath]      Directory path of the elevation image file
   * @param {string} [opts.fileName]      Name of the file, without file extension (.webp will be added)
   * @param {string} [opts.fileURL]       Full path of the file with file extension.
   *                                      If provided, filePath and fileName are ignored.
   * @returns {Promise<void>}
   */
  async initialize({filePath, fileName, fileURL} = {}) {
    this.#initialized = false;
    this.#textureConfiguration = undefined;

    // Set default values.
    if ( fileURL ) {
      const pathArr = fileURL.split("/");
      fileName = pathArr.at(-1);
      filePath = pathArr.slice(0, -1).join("/");
    } else {
      const fileExt = "webp";
      filePath ??= `worlds/${game.world.id}/assets/${MODULE_ID}`;
      fileName ??= `${game.world.id}-${canvas.scene.id}-elevationMap`;
      fileName += `.${fileExt}`;
      filePath = await this.constructor.constructSaveDirectory(filePath);
    }

    // Set the file path for the texture and ensure that the folder structure is present
    this.#filePath = filePath;
    this.#fileName = fileName;

    // Conversion from older versions of EV.
    this.#initialized = await this.convertFromSceneFlag();
  }

  get textureConfiguration() {
    return this.#textureConfiguration ?? (this.#textureConfiguration = this._getElevationTextureConfiguration());
  }

  /**
   * Load the elevation texture from the stored file for the world and scene.
   * @returns {PIXI.Texture}
   */
  async load() {
    let filePath = `${this.#filePath}/${this.#fileName}`;

    // Bust the caching of the texture (The Forge issue).
    if ( filePath.startsWith("https://")
      || filePath.startsWith("http://") ) filePath = `${filePath}?v=${Math.random()}`;

    console.debug(`Loading ${filePath}`);
    try {
      const baseTexture = await TextureLoader.loader.loadTexture(filePath);
      const texture = new PIXI.Texture(baseTexture);
      return this._formatElevationTexture(texture);
    } catch(err) {
      console.warn("ElevatedVision|ElevationTextureManager load threw error", err);
      return undefined; // May or may not be an error depending on whether texture should be there.
    }
  }

  /**
   * Import elevation data from the provided image file location into a texture
   * @param {File} file
   * @returns {PIXI.Texture}
   */
  async loadFromFile(file) {
    console.debug("Loading from file");
    try {
      const texture = await PIXI.Texture.fromURL(file);
      return this._formatElevationTexture(texture);

    } catch(err) {
      console.error("ElevatedVision|loadFromFile encountered error", err, file);
      return undefined;
    }
  }

  /**
   * Format a texture for use as an elevation texture.
   * @param {PIXI.Texture}
   * @returns {PIXI.Texture}
   */
  _formatElevationTexture(texture) {
    const { width, height } = canvas.dimensions.sceneRect;
    const resolution = texture.width > texture.height ? texture.width / width : texture.height / height;
    texture.baseTexture.setSize(width, height, resolution);
    texture.baseTexture.setStyle(this.textureConfiguration.scaleMode, this.textureConfiguration.mipmap);
    return texture;
  }

  /**
   * Get the elevation data from the scene flag, save it to the folder, and test loading it.
   * If all that works, remove the data from the scene flag and update the scene flag version.
   */
  async convertFromSceneFlag() {
    const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
    if ( !elevationImage || !elevationImage.imageData || isNewerVersion(elevationImage.version, "0.5.0") ) return true;

    console.debug(`Converting from scene flag to ${this.#filePath}/${this.#fileName}`);
    try {
      const saveRes = await this.constructor.uploadBase64(
        elevationImage.imageData, this.#fileName, this.#filePath, { type: "image", notify: true });
      const texture = await this.load();
      if ( !texture.valid ) throw new Error("Elevation texture is invalid.");

      elevationImage.imageURL = saveRes.path;
      elevationImage.version = game.modules.get(MODULE_ID).version;
      elevationImage.timestamp = Date.now();
      elevationImage.imageData = null;
      await canvas.scene.setFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE, elevationImage);

    } catch(err) {
      console.error("ElevatedVision|Conversion of elevation texture from scene flag failed.", err);
      return false;
    }

    return true;
  }

  /**
   * Confirm if a hierarchy of directories exist within the "data" storage location.
   * Create new directories if missing.
   * @param {string} filePath   The directory path, separated by "/".
   * @returns {string} The constructed storage path, not including "data".
   */
  static async constructSaveDirectory(filePath) {
    const dirs = filePath.split("/");
    const res = await buildDirPath(dirs);
    if ( !res ) { console.error(`Error constructing the file path ${filePath}.`); }
    return filePath;
  }

  /**
   * Save the provided texture to the location in "data" provided in the initialization step.
   * Default location is data/worlds/world-id/assets/elevatedvision/
   * @param {PIXI.Texture} texture      Texture to save as the elevation map
   * @returns {Promise<object>}  The response object from FilePicker.upload.
   */
  async save(texture) {
    console.debug(`Saving texture to ${this.#filePath}/${this.#fileName}`);
    const base64image = await this.convertTextureToImage(texture);
    return this.constructor.uploadBase64(base64image, this.#fileName, this.#filePath, { type: "image", notify: false });
  }

  /**
   * Like ImageHelper.uploadBase64, but passes notify through to FilePicker.upload.
   * Upload a base64 image string to a persisted data storage location
   * @param {string} base64       The base64 string
   * @param {string} fileName     The file name to upload
   * @param {string} filePath     The file path where the file should be uploaded
   * @param {object} [options]    Additional options which affect uploading
   * @param {string} [options.storage=data]   The data storage location to which the file should be uploaded
   * @param {string} [options.type]           The MIME type of the file being uploaded
   * @returns {Promise<object>}   A promise which resolves to the FilePicker upload response
   */
  static async uploadBase64(base64, fileName, filePath, { storage="data", type, notify = true }={}) {
    type ||= base64.split(";")[0].split("data:")[1];
    const blob = await fetch(base64).then(r => r.blob());
    const file = new File([blob], fileName, {type});
    return FilePicker.upload(storage, filePath, file, {}, { notify });
  }

  /**
   * Convert a texture to a specific image format for saving.
   * @param {PIXI.Texture} texture    Texture from which to pull data
   * @param {object} [opts]           Options that affect the image format returned
   * @param {string} [opts.format]    MIME type image format
   * @param {number} [opts.quality]   Quality, used for some formats such as jpeg.
   * @returns {string}
   */
  async convertTextureToImage(texture, { type = "image/webp", quality = 1 } = {}) {
    return canvas.app.renderer.plugins.extractAsync.base64(texture, type, quality);
  }

  /**
   * @typedef {object} ElevationTextureConfiguration
   * @property {number} resolution    Resolution of the texture
   * @property {number} width         Width, based on sceneWidth
   * @property {number} height        Height, based on sceneHeight
   * @property {PIXI.MIPMAP_MODES} mipmap
   * @property {PIXI.SCALE_MODES} scaleMode
   * @property {PIXI.MSAA_QUALITY} multisample
   * @property {PIXI.FORMATS} format
   */


  /**
   * Values used when rendering elevation data to a texture representing the scene canvas.
   * It may be important that width/height of the elevation texture is evenly divisible
   * by the downscaling resolution. (It is important for fog manager to prevent drift.)
   * @returns {ElevationTextureConfiguration}
   */
  _getElevationTextureConfiguration() {
    // In v11, see CanvasVisibility.prototype.#configureVisibilityTexture
    const dims = canvas.scene.dimensions;
    let width = dims.sceneWidth;
    let height = dims.sceneHeight;

    let resolution = Math.clamped(CONFIG[MODULE_ID]?.resolution ?? 0.25, .01, 1);
    const maxSize = Math.min(
      this.constructor.#MAXIMUM_TEXTURE_SIZE,
      resolution * Math.max(width, height));

    if ( width >= height ) {
      resolution = maxSize / width;
      height = Math.ceil(height * resolution) / resolution;
    } else {
      resolution = maxSize / height;
      width = Math.ceil(width * resolution) / resolution;
    }

    return {
      resolution,
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RG, // 256 * 256 = 65,536 elevation increments in total.
      type: PIXI.TYPES.UNSIGNED_BYTE
    };
  }
}

/**
 * Recursively construct a directory path from an array of folders.
 * Based in the "data" path.
 * @param {string[]} dirs   Array of folder names, representing a folder hierarchy
 * @param {number} [idx]    Used internally to control the recursion through the folders
 * @returns {boolean} True if successful or path already exists.
 */
async function buildDirPath(dirs, idx = dirs.length) {
  // Need to build the folder structure in steps or it will error out.
  // Browse is more expensive than createDirectory.

  // FilePicker.createDirectory has three basic returns:
  // 1. EEXIST: file already exists if the directory path is present
  // 2. ENOENT: no such file or directory if part of the directory path is not present
  // 3. the file path if the base path exists and the folder is created.
  if ( !idx ) return false;
  if ( idx > dirs.length ) return true;

  const path = dirs.slice(0, idx).join("/");
  const res = await FilePicker.createDirectory("data", path).catch(err => { return err; });

  // For The Forge, FilePicker.createDirectory may return undefined if nothing was created.
  if ( res && res.message ) {
    // If this path exists, we can move down in the folder hierarchy
    if ( res.message.includes("EEXIST: file already exists") ) return buildDirPath(dirs, idx + 1);

    // Something in the path is missing; move up in the folder hierarchy to find and create it.
    return buildDirPath(dirs, idx - 1);
  } else {
    // Folder at end of path was created. Either we are done or we need to move down the hierarchy.
    if ( idx === dirs.length ) return true;
    return buildDirPath(dirs, idx + 1);
  }
  return true; // eslint-disable-line no-unreachable
}
