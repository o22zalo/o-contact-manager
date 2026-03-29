'use strict';

const { getFirestore, FieldValue } = require('./firebase-admin');
const { buildContactDocs, encodeDocId } = require('./contactMapper');

async function getExistingContactMeta(db, contactId) {
  const snap = await db.collection('contacts_index').doc(contactId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    allEmails: data.allEmails || [],
    userDefinedKeys: data.userDefinedKeys || [],
    createdAt: data.createdAt || null,
  };
}

async function writeContact(contactJson, options = {}) {
  const db = getFirestore();
  const { isUpdate = false } = options;

  const requestedContactId = options.contactId;
  const existingMeta = (isUpdate && requestedContactId)
    ? await getExistingContactMeta(db, requestedContactId)
    : null;

  const { contactId, indexDoc, detailDoc, emailLookupDocs, udKeyUpdates } =
    buildContactDocs(contactJson, {
      ...options,
      createdAt: existingMeta?.createdAt || options.createdAt || null,
    });

  const oldEmailDocIds = new Set((existingMeta?.allEmails || []).map(email => encodeDocId(email)));
  const oldUdKeys = new Set(existingMeta?.userDefinedKeys || []);

  const batch = db.batch();

  batch.set(db.collection('contacts_index').doc(contactId), indexDoc);
  batch.set(db.collection('contacts_detail').doc(contactId), detailDoc);

  const newEmailDocIds = new Set(emailLookupDocs.map(e => e.docId));
  for (const oldDocId of oldEmailDocIds) {
    if (!newEmailDocIds.has(oldDocId)) {
      batch.delete(db.collection('email_lookup').doc(oldDocId));
    }
  }
  for (const { docId, data } of emailLookupDocs) {
    batch.set(db.collection('email_lookup').doc(docId), data);
  }

  const newUdKeys = new Set(udKeyUpdates.map(u => u.key));
  const nowISO = new Date().toISOString();

  for (const oldKey of oldUdKeys) {
    if (!newUdKeys.has(oldKey)) {
      const oldDocId = encodeDocId(oldKey);
      batch.set(db.collection('ud_key_lookup').doc(oldDocId), {
        key: oldKey,
        contactIds: FieldValue.arrayRemove(contactId),
        count: FieldValue.increment(-1),
        updatedAt: nowISO,
      }, { merge: true });
    }
  }

  for (const { docId, key } of udKeyUpdates) {
    const isExistingKey = oldUdKeys.has(key);
    batch.set(db.collection('ud_key_lookup').doc(docId), {
      key,
      contactIds: FieldValue.arrayUnion(contactId),
      ...(isExistingKey ? {} : { count: FieldValue.increment(1) }),
      updatedAt: nowISO,
    }, { merge: true });
  }

  await batch.commit();
  return { contactId, emailCount: emailLookupDocs.length, udKeyCount: udKeyUpdates.length };
}

async function deleteContact(contactId) {
  const db = getFirestore();
  const indexSnap = await db.collection('contacts_index').doc(contactId).get();
  if (!indexSnap.exists) throw new Error(`Contact not found: ${contactId}`);

  const { allEmails = [], userDefinedKeys = [] } = indexSnap.data();
  const batch = db.batch();

  batch.delete(db.collection('contacts_index').doc(contactId));
  batch.delete(db.collection('contacts_detail').doc(contactId));
  for (const email of allEmails) {
    batch.delete(db.collection('email_lookup').doc(encodeDocId(email)));
  }
  for (const key of userDefinedKeys) {
    batch.set(db.collection('ud_key_lookup').doc(encodeDocId(key)), {
      contactIds: FieldValue.arrayRemove(contactId),
      count: FieldValue.increment(-1),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  await batch.commit();
  return { contactId, deletedEmails: allEmails.length, cleanedUdKeys: userDefinedKeys.length };
}

async function bulkWriteContacts(contactJsonArray, options = {}) {
  const { concurrency = 5, onProgress = null } = options;
  const total = contactJsonArray.length;
  let done = 0;
  const errors = [];

  for (let i = 0; i < total; i += concurrency) {
    const chunk = contactJsonArray.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((contact, idx) =>
        writeContact(contact, { ...options, contactId: undefined })
          .then(() => ({ ok: true }))
          .catch(err => ({ ok: false, index: i + idx, error: err.message }))
      )
    );
    for (const result of results) {
      done++;
      if (result.status === 'fulfilled' && !result.value.ok) {
        errors.push({ index: result.value.index, error: result.value.error });
      } else if (result.status === 'rejected') {
        errors.push({ index: i, error: result.reason?.message || 'Unknown error' });
      }
    }
    if (onProgress) onProgress(done, total);
  }

  return { success: done - errors.length, errors };
}

module.exports = { writeContact, deleteContact, bulkWriteContacts };
