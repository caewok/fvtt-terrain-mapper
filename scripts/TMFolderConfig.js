/* globals
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";


// See https://github.com/DFreds/dfreds-convenient-effects/blob/fc4a43ed11bffb4a09731e2b9a149b4b25690b30/src/ts/ui/ce-config/convenient-folder-config.ts#L17
// Allow user to name and color folders in the terrain book.
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TMFolderConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {TerrainEffectsAppV2} */
  #viewMvc;

  constructor({ folderId, viewMvc, ...options } = {}) {
    super(options);
    this.#viewMvc = viewMvc;
    this.#folderId = folderId || foundry.utils.randomID();
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-folder-config`,
    classes: ["sheet", "folder-config"],
    tag: "form",
    document: null,
    window: {
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-folder",
    },
    position: {
      width: 480,
    },
    form: {
      handler: this.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/terrain-effects-menu-app-folder-config.html`,
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  };

  /** @type {string} */
  get title() {
    return this.document?.id
     ? `${game.i18n.localize("FOLDER.Update")}: ${this.document.name}`
            : game.i18n.localize("SIDEBAR.ACTIONS.CREATE.Folder");
  }

  /** @type {string} */
  #folderId = "";

  get folderId() { return this.#folderId; }

  /**
   * @param {HandlebarsRenderOptions} options
   * @returns {Promise<object>} The context object.
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const folders = Settings.folders;
    if ( !folders.has(this.folderId) ) await Settings.addFolder({ id: this.folderId });
    const folder = Settings.folders.get(this.folderId);
    Object.assign(context, {
      folder,
      namePlaceholder: game.i18n.localize("DOCUMENT.Folder"),
    });
    return context;
  }

  /**
   * @param {string} partId
   * @param {object} context
   * @param {HandlebarsRenderOptions} options
   */
  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    switch ( partId ) {
      case "footer":
        this.#prepareFooterContext(partContext);
        break;
    }
    return partContext;
  }

  /**
   * @param {object} context
   */
  #prepareFooterContext(context) {
    Object.assign(context, {
      buttons: [
        {
          type: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: this.document?._id ? "FOLDER.Update" : "SIDEBAR.ACTIONS.CREATE.Folder",
        },
      ],
    });
  }

  /**
   * @param {SubmitEvent|Event} event
   * @param {HTMLFormElement} form
   * @param {object} submitData
   * @param {object} options
   */
  async #processSubmitData(_event, _form, submitData, _options) {
    if ( !submitData || !submitData.folder ) return;
    return Settings.addFolder(submitData.folder);
  }

  /**
   * @param {SubmitEvent|Event} event
   * @param {HTMLFormElement} form
   * @param {object} submitData
   * @param {object} options
   */
  async #prepareSubmitData(event, form, formData, updateData) {
    const submitData = foundry.utils.expandObject(formData.object);
    if (updateData) {
      foundry.utils.mergeObject(submitData, updateData, {
          inplace: true,
          performDeletions: true,
      });
    }
    if ( submitData.folder ) submitData.folder.id ??= this.folderId;
    this.#validateData(submitData);
    return submitData;
  }

  #validateData(_submitData) { return true; }

  /**
   * @param {SubmitEvent|Event} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   * @param {object} options
   */
  static async #onSubmit(event, form, formData, options = {}) {
    const { updateData, ...updateOptions } = options;
    const submitData = await this.#prepareSubmitData(
      event,
      form,
      formData,
      updateData,
    );
    await this.#processSubmitData(
      event,
      form,
      submitData,
      updateOptions,
    );

    if ( this.#viewMvc ) this.#viewMvc.render({ parts: ["directory"], force: true });
  }
}

