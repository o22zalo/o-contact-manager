'use strict';

const { nanoid } = require('nanoid');
const { buildSearchTokens, normalize } = require('./searchTokens');

function encodeDocId(key) {
  return key.replace(/\./g, ',');
}

function domainOf(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

function extractEmails(contact) {
  const emails = [];
  if (Array.isArray(contact.emails)) {
    for (const e of contact.emails) {
      const v = (e.value || e.email || '').toLowerCase().trim();
      if (v && v.includes('@')) emails.push(v);
    }
  }
  if (contact.email) {
    const flat = Array.isArray(contact.email) ? contact.email : [contact.email];
    for (const e of flat) {
      const v = (e || '').toLowerCase().trim();
      if (v && v.includes('@')) emails.push(v);
    }
  }
  return [...new Set(emails)];
}

function extractPhones(contact) {
  const phones = [];
  if (Array.isArray(contact.phones)) {
    for (const p of contact.phones) {
      const v = (p.value || p.phone || '').trim();
      if (v) phones.push(v);
    }
  }
  if (contact.phone) {
    const flat = Array.isArray(contact.phone) ? contact.phone : [contact.phone];
    for (const p of flat) {
      if (p) phones.push(String(p).trim());
    }
  }
  return [...new Set(phones)];
}

function extractDisplayName(contact) {
  if (contact.displayName) return contact.displayName.trim();
  if (contact.fn) return contact.fn.trim();
  if (contact.name) {
    const n = contact.name;
    if (typeof n === 'string') return n.trim();
    const parts = [n.given, n.middle, n.family].filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  return '';
}

function extractUdKeys(userDefined) {
  if (!userDefined || typeof userDefined !== 'object') return [];
  return Object.keys(userDefined).filter(k => k && userDefined[k] != null);
}

function buildContactDocs(contactJson, options = {}) {
  const {
    contactId = `uid_${nanoid(12)}`,
    sourceFile = null,
    importedAt = new Date(),
    createdAt = null,
    version = 1,
  } = options;

  const contactData = contactJson.contact || contactJson;
  const userDefined = contactJson.userDefined || contactData.userDefined || {};

  const displayName = extractDisplayName(contactData);
  const nameNormalized = normalize(displayName);
  const organization = (contactData.organization || contactData.org || '').trim();

  const allEmails = extractEmails(contactData);
  const primaryEmail = allEmails[0] || '';
  const emailDomain = domainOf(primaryEmail) || '';
  const allDomains = [...new Set(allEmails.map(domainOf).filter(Boolean))];

  const allPhones = extractPhones(contactData);
  const primaryPhone = allPhones[0] || '';

  const categories = Array.isArray(contactData.categories) ? contactData.categories : [];
  const tags = Array.isArray(contactData.tags) ? contactData.tags : [];
  const photoUrl = contactData.photoUrl || contactData.photo || null;

  const userDefinedKeys = extractUdKeys(userDefined);
  const hasUserDefined = userDefinedKeys.length > 0;

  const now = new Date().toISOString();
  const createdAtISO = createdAt || now;
  const importedAtISO = importedAt instanceof Date ? importedAt.toISOString() : importedAt;

  const searchTokens = buildSearchTokens({ displayName, organization, primaryEmail, allEmails });

  const indexDoc = {
    id: contactId, displayName, nameNormalized, primaryEmail, emailDomain,
    allEmails, allDomains, primaryPhone, organization, photoUrl, categories, tags,
    searchTokens, userDefinedKeys, hasUserDefined,
    udKeyCount: userDefinedKeys.length, emailCount: allEmails.length,
    phoneCount: allPhones.length, createdAt: createdAtISO, updatedAt: now,
    importedAt: importedAtISO, sourceFile, version,
  };

  if (!photoUrl) delete indexDoc.photoUrl;
  if (!sourceFile) delete indexDoc.sourceFile;
  if (!organization) delete indexDoc.organization;
  if (!primaryPhone) delete indexDoc.primaryPhone;

  const detailDoc = {
    id: contactId,
    contact: {
      displayName, name: contactData.name || null,
      emails: (contactData.emails || allEmails.map(v => ({ type: ['INTERNET'], value: v }))),
      phones: (contactData.phones || allPhones.map(v => ({ type: ['VOICE'], value: v }))),
      organization, categories,
    },
    userDefined,
    vcfRaw: contactJson.vcfRaw || contactData.vcfRaw || null,
    createdAt: createdAtISO, updatedAt: now, version,
  };

  if (!detailDoc.contact.name) delete detailDoc.contact.name;
  if (!detailDoc.vcfRaw) delete detailDoc.vcfRaw;

  const emailLookupDocs = allEmails.map((email, idx) => {
    const emailObj = Array.isArray(contactData.emails)
      ? contactData.emails.find(e => (e.value || '').toLowerCase() === email)
      : null;
    return {
      docId: encodeDocId(email),
      data: {
        email, contactId, isPrimary: idx === 0,
        type: emailObj ? (emailObj.type || ['INTERNET']) : ['INTERNET'],
        label: emailObj ? (emailObj.label || null) : null,
      },
    };
  });

  const udKeyUpdates = userDefinedKeys.map(key => ({
    docId: encodeDocId(key), key, contactId, operation: 'add',
  }));

  return { contactId, indexDoc, detailDoc, emailLookupDocs, udKeyUpdates };
}

module.exports = { buildContactDocs, encodeDocId, extractEmails, extractPhones, extractDisplayName, extractUdKeys };
