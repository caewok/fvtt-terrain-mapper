/* globals
foundry,
fromUuid,
fromUuidSync,
game,
Hooks,
socketlib
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SOCKETS } from "../const.js";

// ----- NOTE: Set up sockets so GM can create or modify effects on tokens ----- //
Hooks.once("socketlib.ready", () => {
  SOCKETS.socket ??= socketlib.registerModule(MODULE_ID);
  SOCKETS.socket.register("createDocument", createDocument);
  SOCKETS.socket.register("updateDocument", updateDocument);
  SOCKETS.socket.register("deleteDocument", deleteDocument);
  SOCKETS.socket.register("createEmbeddedDocuments", createEmbeddedDocuments);
  SOCKETS.socket.register("updateEmbeddedDocuments", updateEmbeddedDocuments);
  SOCKETS.socket.register("deleteEmbeddedDocuments", deleteEmbeddedDocuments);
});

/**
 * Socket function: createDocument
 * GM creates an document such as an item
 * @param {string} classPath   Path to document to create. E.g. "CONFIG.Item.documentClass"
 * @param {object} data   Data used to create the document
 * @returns {string} uuid of the item created
 */
export async function createDocument(classPath, data) {
  if ( !game.user.isGM ) return SOCKETS.socket.executeAsGM("createDocument", classPath, data);
  const cl = foundry.utils.getProperty(window, classPath);
  if ( !cl ) return;
  const doc = cl.create(data);
  return doc.uuid;
}

/**
 * Socket function: updateDocument
 * GM updates an document such as an item
 * @param {string} uuid   Container to update
 * @param {object} data   Data used to update the document
 */
export async function updateDocument(uuid, data) {
  if ( !game.user.isGM ) return SOCKETS.socket.executeAsGM("updateDocument", uuid, data);
  const doc = fromUuidSync(uuid);
  if ( !doc ) return;
  await doc.update(data);
}

/**
 * Socket function: deleteDocument
 * GM deletes a document such as an item
 * @param {string} uuid   Item to delete
 * @param {object} data   Data used to create the effect
 */
export async function deleteDocument(uuid) {
  if ( !game.user.isGM ) return SOCKETS.socket.executeAsGM("deleteDocument", uuid);
  const doc = fromUuidSync(uuid);
  if ( !doc ) return;
  await doc.delete();
}

/**
 * Socket function: createEmbeddedDocuments
 * GM creates the embedded documents in a collection
 * Document should already exist somewhere else so its data can be copied.
 * @param {string} uuid           Container that embeds the documents
 * @param {string} embeddedName   Name of the embed
 * @param {object[]} data         Document data
 * @param {string[]} [uuids]      If provided, used to locate the documents instead of the data parameter
 * @returns {string[]} The created effect uuids.
 */
export async function createEmbeddedDocuments(containerUuid, embeddedName, data, uuids) {
  if ( !game.user.isGM ) return SOCKETS.socket.executeAsGM("createEmbeddedDocuments", containerUuid, embeddedName, data);
  if ( !data.length && !uuids?.length ) return;
  const container = await fromUuid(containerUuid);
  if ( !container ) return [];
  if ( uuids ) {
    const promises = [];
    for ( const uuid of uuids ) promises.push(fromUuid(uuid));
    data = (await Promise.allSettled(promises)).map(p => p.value).filter(doc => Boolean(doc));
  }
  const res = await container.createEmbeddedDocuments(embeddedName, data);
  return res.map(elem => elem.uuid);
}

/**
 * Socket function: updateEmbeddedDocuments
 * GM updates the embedded documents in a collection
 * Document should already exist somewhere else so its data can be copied.
 * @param {string} uuid           Container that embeds the documents
 * @param {string} embeddedName   Name of the embed
 * @param {string[]} data         Data used to update the embedded docs
 */
export async function updateEmbeddedDocuments(containerUuid, embeddedName, data) {
  if ( !game.user.isGM ) return SOCKETS.socket.executeAsGM("updateEmbeddedDocuments", containerUuid, embeddedName, data);
  if ( !data.length ) return;
  const container = fromUuidSync(containerUuid);
  if ( !container ) return [];
  await container.updateEmbeddedDocuments(embeddedName, data);
}

/**
 * Socket function: deleteEmbeddedDocuments
 * GM deletes the embedded documents from a collection
 * Document should already exist somewhere else so its data can be copied.
 * @param {string} uuid           Container that embeds the documents
 * @param {string} embeddedName   Name of the embed
 * @param {string[]} ids          Document ids to be deleted
 */
export async function deleteEmbeddedDocuments(containerUuid, embeddedName, ids) {
  if ( !game.user.isGM ) return SOCKETS.socket.executeAsGM("deleteEmbeddedDocuments", containerUuid, embeddedName, ids);
  if ( !ids.length ) return;
  const container = fromUuidSync(containerUuid);
  if ( !container ) return [];
  await container.deleteEmbeddedDocuments(embeddedName, ids);
}
