/* globals
CONFIG,
CONST,
foundry,
game,
readTextFromFile,
renderTemplate,
saveDataToFile,
TextEditor,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Much of this is from
// https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/app/convenient-effects-controller.js

import { Settings } from "./settings.js";
import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
import { TMFolderConfig } from "./TMFolderConfig.js";

/**
 * Controller class to handle app events and manipulate underlying Foundry data.
 */
export class TerrainEffectsControllerV2 {

  static ALL_TERRAINS_FOLDER = "all-terrains";

  static FAVORITE_TERRAINS_FOLDER = "favorite-terrains";

  /** @type {TerrainEffectsApp} */
  #viewMvc;

  /**
   * Initializes the controller and its dependencies
   * @param {TerrainEffectsApp} viewMvc - the app that the controller can interact with
   */
  constructor(viewMvc) {
    this.#viewMvc = viewMvc;
  }

  static canModifyFolder(folderId) {
    return !(folderId === this.ALL_TERRAINS_FOLDER && folderId === this.FAVORITE_TERRAINS_FOLDER);
  }

  /**
   * Rerender the application for this controller.
   * Need only rerender the directory listing.
   */
  rerender() { this.#viewMvc.render({ parts: ["directory"], force: true }); }

  /**
   * Configure and return data specific for the header.
   * @returns {Object} the data to pass to the template
   */
  headerData(context) {
    context.hasDefaults = Boolean(CONFIG[MODULE_ID].Terrain._resetDefaultEffects);
    return context;
  }

  /**
   * Configure and return data specific for the directories.
   * @returns {Object} the data to pass to the template
   */
  directoryData(context) {
    const terrains = [...CONFIG[MODULE_ID].Terrain._instances.values()];
    this._sortTerrains(terrains);
    const folderData = [];

    // Folder holding all terrains.
    folderData.push({
      folder: {
        name: game.i18n.localize(`${MODULE_ID}.terrainbook.all-terrains`),
        id: this.constructor.ALL_TERRAINS_FOLDER,
        color: "black",
      },
      effects: terrains,
    });

    // Folder holding marked favorites
    folderData.push({
      folder: {
        name: game.i18n.localize(`${MODULE_ID}.terrainbook.favorites`),
        id: this.constructor.FAVORITE_TERRAINS_FOLDER,
        color: "green",
      },
      effects: this._fetchFavorites(terrains),
    });

    // User-defined folders
    Settings.folders.forEach(folder => {
      folderData.push({
        folder,
        effects: folder.effects.map(id => CONFIG[MODULE_ID].Terrain._instances.get(id)),
      });
    });

    Object.assign(context, {
      folderData,
      entryPartial: this.#viewMvc.constructor._entryPartial,
      folderPartial: this.#viewMvc.constructor._folderPartial,
    });
  }


  _fetchFavorites(terrains) {
    log("TerrainEffectsController|_fetchFavorites");
    const favorites = new Set(Settings.get(Settings.KEYS.CONTROL_APP.FAVORITES));
    return terrains.filter(t => favorites.has(t.uniqueEffectId));
  }


  _sortTerrains(terrains) {
    terrains.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      if ( nameA < nameB ) return -1;
      if ( nameA > nameB ) return 1;
      return 0;
    });
    return terrains;
  }

  /**
   * Remove the collapsed class from all saved, expanded folders
   */
//   expandSavedFolders() {
//     Settings.expandedFolders.forEach(folderId => this.#viewMvc.expandFolder(folderId));
//   }

  // ----- NOTE: Buttons ---- //

  /**
   * Handles clicks on the create effect button
   * @param {MouseEvent} event
   */
  async onCreateTerrain(folderId) {
    log("TerrainEffectsController|onCreateTerrain", { folderId });
    const terrain = await CONFIG[MODULE_ID].Terrain.create();
    if ( folderId && this.constructor.canModifyFolder(folderId) ) await Settings.addFolder({
      id: folderId,
      effects: [terrain.uniqueEffectId],
    });
    if ( folderId === this.constructor.FAVORITE_TERRAINS_FOLDER ) await Settings.addToFavorites(terrain.uniqueEffectId);
    this.rerender();
    terrain.document.sheet.render(true);
  }

  /**
   * Handles clicks on the create defaults button
   * @param {MouseEvent} event
   */
  async onCreateDefaults() {
    log("TerrainEffectsController|onCreateDefaults");
    const confirmText = game.i18n.localize(`${MODULE_ID}.terrainbook.are-you-sure`);
    const descriptionText = game.i18n.localize(`${MODULE_ID}.terrainbook.create-defaults-description`);
    const proceed = await foundry.applications.api.DialogV2.confirm({
      title: "Replace Default Terrains",
      content:`<h4>${confirmText}</h4><p>${descriptionText}`,
      rejectClose: false,
      modal: true,
    });
    if ( !proceed ) return;
    log("TerrainEffectsController|onCreateDefaultsClick yes");
    await CONFIG[MODULE_ID].Terrain._resetDefaultEffects();
    this.rerender();
  }


  /**
   * Handles clicks on the reset status effects button
   * @param {MouseEvent} event
   */
//   async onReset(_event) {
//     return foundry.applications.api.DialogV2.confirm({
//       title: "Reset Terrain",
//       content:
//         "<h4>Are You Sure?</h4><p>This will reset all configured terrain effects to the module defaults and reload Foundry.",
//       yes: async () => {
//         log("TerrainEffectsController|onResetStatusEffectsClick");
//         await this._settings.resetStatusEffects();
//         window.location.reload();
//       }
//     });
//   }

  // ----- NOTE: Folder management ----- //

  /**
   * Handles clicks on the collapse all button
   * @param {MouseEvent} event - event that corresponds to clicking the collapse all
   */
//   async onCollapseAllClick(_event) {
//     this.#viewMvc.collapseAllFolders();
//     await Settings.clearExpandedFolders();
//   }

  /**
   * Handles clicks on folders by collapsing or expanding them
   * @param {MouseEvent} event - event that corresponds to clicking on the folder
   */
//   async onFolderClick(event) {
//     let folderId = event.currentTarget.parentElement.dataset.folderId;
//
//     if (this.#viewMvc.isFolderCollapsed(folderId)) {
//       this.#viewMvc.expandFolder(folderId);
//     } else {
//       this.#viewMvc.collapseFolder(folderId);
//     }
//
//     if (Settings.isFolderExpanded(folderId)) {
//       await Settings.removeExpandedFolder(folderId);
//     } else {
//       await Settings.addExpandedFolder(folderId);
//     }
//   }

  async onCreateFolder() {
    const folderConfig = new TMFolderConfig({ viewMvc: this.#viewMvc });
    folderConfig.render({ force: true });
  }

  async onEditFolder(folderId) {
    if ( !folderId ) return;
    const folderConfig = new TMFolderConfig({ folderId, viewMvc: this.#viewMvc } );
    folderConfig.render({ force: true });
  }

  async onDeleteFolder(folderId) {
    if ( !folderId ) return;
    await Settings.deleteFolder(folderId);
    this.rerender();
  }

  // ----- NOTE: Terrain item management ----- //

  /**
   * Handles clicks on effect items by opening their edit control
   * @param {MouseEvent} event - event that corresponds to clicking an effect item
   */
//   async onEffectClick(event) {
//     log("TerrainEffectsController|onEffectClick");
//     const effectId = event.currentTarget.dataset.effectId;
//     const ce = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
//     ce.document.sheet.render(true);
//   }

  /**
   * Handle editing the custom effect
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onEditTerrain(effectId) {
    log("TerrainEffectsController|onEditEffectClick", { effectId });
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    terrain.document.sheet.render(true);
  }

  /**
   * Handle deleting the custom effect
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onDeleteTerrain(effectId) {
    log("TerrainEffectsController|onDeleteEffectClick", { effectId });
    const confirmText = game.i18n.localize(`${MODULE_ID}.terrainbook.are-you-sure`);
    const descriptionText = game.i18n.localize(`${MODULE_ID}.terrainbook.remove-terrain-description`);
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${MODULE_ID}.terrainbook.delete-terrain`) },
      content: `<h4>${confirmText}</h4><p>${descriptionText}`,
      rejectClose: false,
      modal: true,
    });
    if ( !proceed ) return;
    log("TerrainEffectsController|onDeleteEffectClick yes");
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    await terrain.destroy(true);
    this.rerender();
  }

  /**
   * Handle adding the effect to the favorites settings and to the favorites folder
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onAddFavorite(effectId) {
    log("TerrainEffectsController|onAddFavorite", { effectId });
    await Settings.addToFavorites(effectId);
    this.rerender();
  }

  /**
   * Handle removing the effect from the favorites settings and from the favorites folder
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onRemoveFavorite(effectId) {
    log("TerrainEffectsController|onRemoveFavorite", { effectId });
    await Settings.removeFromFavorites(effectId);
    this.rerender();
  }

  /**
   * Checks if the provided effect is favorited
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   * @returns true if the effect is favorited
   */
  isFavorited(effectItem) {
    log("TerrainEffectsController|isFavorited");
    const effectId = effectItem.dataset.effectId;
    return Settings.isFavorite(effectId);
  }

  /**
   * Handle clicks on the import terrain menu item.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onImportTerrain(effectId) {
    log("TerrainEffectsController|onImportTerrain", { effectId });
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    const res = await this.importFromJSONDialog(terrain);
    if ( !res || res.type === "error" || res === "cancel" ) return;
    await terrain.fromJSON(res);
    this.rerender();
  }

  /**
   * Handle clicks on the export terrain menu item.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  onExportTerrain(effectId) {
    log("TerrainEffectsController|onExportTerrain", { effectId });
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    const data = terrain.toJSON();

    data.flags.exportSource = {
      world: game.world.id,
      system: game.system.id,
      coreVersion: game.version,
      systemVersion: game.system.version,
      terrainMapperVersion: game.modules.get(MODULE_ID).version
    };
    const filename = `${MODULE_ID}_${terrain.name}`;
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename}.json`);
  }

  /**
   * Handle duplicating an effect.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onDuplicateTerrain(effectId) {
    log("TerrainEffectsController|onDuplicate", { effectId });
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    await terrain.duplicate();
    this.rerender();
  }

  // ----- NOTE: Drag / Drop ----- //

  canDragStart(_event) {
    return game.user.role >= CONST.USER_ROLES.ASSISTANT;
  }

  canDragDrop(_event) {
    return game.user.role >= CONST.USER_ROLES.ASSISTANT;
  }


  /**
   * Handles starting the drag for effect items
   * For non-nested effects, populates the dataTransfer with Foundry's expected
   * ActiveEffect type and data to make non-nested effects behave as core does
   * @param {DragEvent} event - event that corresponds to the drag start
   */
  onDragStart(_event) {
    log(`TerrainEffectsController|onEffectDragStart for ${event.target.dataset.entryName}`);
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(event.target.dataset.entryId);
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify(terrain.toDragData())
    );
  }


  /**
   * Callback actions which occur when a dragged element is dropped on a target.
   * @param {DragEvent} event       The originating DragEvent
   */
  async onEffectDrop(event) {
    log(`TerrainEffectsController|onEffectDrop`);
    event.preventDefault();
    const data = TextEditor.getDragEventData(event);
    await CONFIG[MODULE_ID].Terrain._processEffectDrop(data);
    this.rerender();
  }

  /**
   * Callback actions which occur when a dragged element is dragged over a target.
   * @param {DragEvent} event       The originating DragEvent
   */
  async onDragOver(_event) { return; }

  // ----- NOTE: Search ----- //


  /**
   * @param {string} query
   * @param {Set<string>} entryIds
   * @param {HTMLElement} element
   * @param {object} options
   */
  _onMatchSearchEntry(query, entryIds, element, _options) {
    const entryId = element.dataset.entryId;
    if ( !entryId ) return;
    element.style.display = !query || entryIds.has(entryId) ? "flex" : "none";
  }

  /**
   * @param {KeyboardEvent} event
   * @param {string} query
   * @param {RegExp|undefined} rgx
   * @param {HTMLElement|null|undefined} html
   */
  _onSearchFilter(_event, query, rgx, html) {
    const entryIds = new Set();
    const folderIds = new Set();
    const autoExpandIds = new Set();
    const options = {};

    // Match entries and folders.
    if ( query ) {
      // First match search folders.
      this._matchSearchFolders(rgx, folderIds, autoExpandIds, options);

      // Next match entries.
      this._matchSearchEntries(rgx, entryIds, folderIds, autoExpandIds, options);
    }

    // Toggle each directory entry.
    for ( const elHTML of html?.querySelectorAll(".directory-item") ?? []) {
      if ( elHTML.hidden ) continue; // No current option to hide
      if ( elHTML.classList.contains("folder") ) {
        const folderId = elHTML.dataset.folderId;
        if ( !folderId ) continue;

        const match = Settings.folders.has(folderId);
        elHTML.style.display = !query || match ? "flex" : "none";
        if ( autoExpandIds.has(folderId ?? "")) {
          if ( query && match ) elHTML.classList.add("expanded");
        } else elHTML.classList.toggle("expanded", Settings.isFolderExpanded(folderId));
      } else this._onMatchSearchEntry(query, entryIds, elHTML, options);
    }
  }

  /**
   * @param {RegExp|undefined} query
   * @param {Set<string>} folderIds
   * @param {Set<string>} autoExpandIds
   * @param {object} options
   */
  _matchSearchFolders(query, folderIds, autoExpandIds, _options) {
    const SearchFilter = foundry.applications.ux.SearchFilter;
    const folders = Settings.folders;
    folders.forEach(folder => {
      if ( query?.test(SearchFilter.cleanQuery(folder.name)) ) {
        this.#onMatchFolder(folder, folderIds, autoExpandIds, { autoExpand: false });
      }
    });
  }

  /**
   * @param {object} folder
   * @param {Set<string>} folderIds
   * @param {Set<string>} autoExpandIds
   * @param {object} [opts]
   * @param {boolean} [opts.autoExpand=true]
   */
  #onMatchFolder(folder, folderIds, autoExpandIds, { autoExpand = true } = {}) {
    folderIds.add(folder.id);
    if ( autoExpand ) autoExpandIds.add(folder.id);
  }

  /**
   * @param {RegExp|undefined} query
   * @param {Set<string} entryIds
   * @param {Set<string>} folderIds
   * @param {Set<string>} autoExpandIds
   * @param {object} options
   */
  _matchSearchEntries(query, entryIds, folderIds, autoExpandIds, _options) {
    // Note: From FoundryVTT; we could do a different search.
    const SearchFilter = foundry.applications.ux.SearchFilter;
    const nameOnlySearch = true;

    // If we matched a folder, add its child entries
    const folders = Settings.folders;
    for ( const folderId of folderIds ) {
      const folder = folders.get(folderId);
      folder.effects.forEach(id => entryIds.add(id));
    }

    // Search by effect name
    if ( nameOnlySearch ) {
      for ( const entry of CONFIG[MODULE_ID].Terrain._instances ) {
        // If searching by name, match the entry name.
        if ( query?.test(SearchFilter.cleanQuery(entry.name)) ) {
          entryIds.add(entry.uniqueEffectId);
          const entryFolders = Settings.findFoldersForEffect(entry.uniqueEffectId);
          entryFolders.forEach(folder => this.#onMatchFolder(folder, folderIds, autoExpandIds));
        }
      }
    }
    if ( nameOnlySearch ) return;

    // Search by effect description
    for ( const entry of CONFIG[MODULE_ID].Terrain._instances ) {
      if ( query?.test(SearchFilter.cleanQuery(entry.document.description)) ) {
        entryIds.add(entry.uniqueEffectId);
        const entryFolders = Settings.findFoldersForEffect(entry.uniqueEffectId);
        entryFolders.forEach(folder => this.#onMatchFolder(folder, folderIds, autoExpandIds));
      }
    }
  }


  // ----- NOTE: Sub-Dialogs ----- //

  /**
   * Open a dialog to import data into a terrain.
   * @param {UniqueActiveEffect} terrain    The terrain for which to overwrite
   * @returns {string|"close"|null} The json from the imported text file. "close" if close button hit; null if dialog closed.
   */
  async importFromJSONDialog(terrain) {
    // See https://github.com/DFreds/dfreds-convenient-effects/blob/c2d5e81eb1d28d4db3cb0889c22a775c765c24e3/scripts/effects/custom-effects-handler.js#L156
    const hint1 = game.i18n.localize(`${MODULE_ID}.terrainbook.import-terrain-description`);
    const content = await renderTemplate("templates/apps/import-data.hbs", { hint1 }); // Skip hint2.
    const dialogConfig = {
      window: { title: game.i18n.localize(`${MODULE_ID}.terrainbook.import-terrain`) },
      position: { width: 400 },
      content,
      buttons: [{
        action: "import",
        icon: '<i class="fas fa-file-import"></i>',
        label: game.i18n.localize("SIDEBAR.Import"),
        default: true,
        callback: async (event, button, _dialog) => {
          const form = button.form;
          if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
          const json = await readTextFromFile(form.data.files[0]);
          log("importFromJSONDialog|Read text");
          return json;
        }
      },
      {
        action: "cancel",
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("Cancel"),
      }],
    };
    return foundry.applications.api.DialogV2.wait(dialogConfig);
  }
}
