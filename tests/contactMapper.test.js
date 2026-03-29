'use strict';

const { buildSearchTokens, normalize, tokensFromText } = require('../functions/utils/searchTokens');
const { buildContactDocs, encodeDocId, extractEmails } = require('../functions/utils/contactMapper');

describe('normalize()', () => {
  test('lowercase + trim', () => { expect(normalize('  John DOE  ')).toBe('john doe'); });
  test('remove diacritics tiếng Việt', () => {
    expect(normalize('Nguyễn Văn An')).toBe('nguyen van an');
    expect(normalize('Trần Thị Bình')).toBe('tran thi binh');
  });
  test('empty string', () => {
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('tokensFromText()', () => {
  test('prefix ngrams từ min length 2', () => {
    const tokens = tokensFromText('john');
    expect(tokens).toContain('jo');
    expect(tokens).toContain('joh');
    expect(tokens).toContain('john');
    expect(tokens).not.toContain('j');
  });
  test('multi-word: sinh prefix cho từng từ + full phrase', () => {
    const tokens = tokensFromText('john doe');
    expect(tokens).toContain('jo');
    expect(tokens).toContain('do');
    expect(tokens).toContain('john doe');
  });
  test('tiếng Việt normalize trước khi sinh token', () => {
    const tokens = tokensFromText('Nguyễn Hậu');
    expect(tokens).toContain('ng');
    expect(tokens).toContain('ha');
    expect(tokens).toContain('hau');
  });
});

describe('buildSearchTokens()', () => {
  test('basic contact', () => {
    const tokens = buildSearchTokens({ displayName: 'John Doe', organization: 'ACME Corp', primaryEmail: 'john@acme.com', allEmails: ['john@acme.com'] });
    expect(tokens).toContain('jo');
    expect(tokens).toContain('john');
    expect(tokens).toContain('ac');
    expect(tokens).toContain('acme');
  });
  test('dedup tokens', () => {
    const tokens = buildSearchTokens({ displayName: 'John', primaryEmail: 'john@test.com', allEmails: ['john@test.com'] });
    expect(tokens.filter(t => t === 'jo').length).toBe(1);
  });
  test('empty input không crash', () => {
    expect(Array.isArray(buildSearchTokens({ displayName: '' }))).toBe(true);
  });
});

describe('encodeDocId()', () => {
  test('thay . bằng ,', () => {
    expect(encodeDocId('gitea.token')).toBe('gitea,token');
    expect(encodeDocId('ongtrieuhau@gmail.com')).toBe('ongtrieuhau@gmail,com');
  });
  test('không có . thì giữ nguyên', () => { expect(encodeDocId('mykey')).toBe('mykey'); });
});

describe('extractEmails()', () => {
  test('format mảng emails[].value', () => {
    const emails = extractEmails({ emails: [{ value: 'work@example.com' }, { value: 'home@gmail.com' }] });
    expect(emails).toEqual(['work@example.com', 'home@gmail.com']);
  });
  test('lowercase + dedup', () => {
    const emails = extractEmails({ emails: [{ value: 'USER@GMAIL.COM' }, { value: 'user@gmail.com' }] });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toBe('user@gmail.com');
  });
  test('bỏ email không có @', () => {
    const emails = extractEmails({ emails: [{ value: 'notanemail' }, { value: 'valid@test.com' }] });
    expect(emails).toEqual(['valid@test.com']);
  });
});

describe('buildContactDocs()', () => {
  const sampleContact = {
    contact: {
      displayName: 'John Doe',
      name: { given: 'John', family: 'Doe' },
      emails: [{ type: ['INTERNET', 'WORK'], value: 'john@work.com' }, { type: ['INTERNET', 'HOME'], value: 'john@gmail.com' }],
      phones: [{ type: ['CELL'], value: '0901234567' }],
      organization: 'ACME Corp',
      categories: ['myContacts'],
    },
    userDefined: { 'github.token': 'ghp_xxx', 'gitea.token': 'gta_yyy' },
  };
  let result;
  beforeAll(() => { result = buildContactDocs(sampleContact, { contactId: 'uid_test123', sourceFile: 'test.vcf' }); });

  test('trả về đúng cấu trúc', () => {
    expect(result).toHaveProperty('contactId', 'uid_test123');
    expect(result).toHaveProperty('indexDoc');
    expect(result).toHaveProperty('detailDoc');
    expect(result).toHaveProperty('emailLookupDocs');
    expect(result).toHaveProperty('udKeyUpdates');
  });
  test('indexDoc có đủ fields quan trọng', () => {
    const idx = result.indexDoc;
    expect(idx.displayName).toBe('John Doe');
    expect(idx.primaryEmail).toBe('john@work.com');
    expect(idx.allEmails).toEqual(['john@work.com', 'john@gmail.com']);
    expect(idx.hasUserDefined).toBe(true);
    expect(idx.udKeyCount).toBe(2);
    expect(idx.searchTokens.length).toBeGreaterThan(0);
  });
  test('emailLookupDocs có đúng số lượng', () => {
    expect(result.emailLookupDocs).toHaveLength(2);
    const primary = result.emailLookupDocs.find(e => e.data.isPrimary);
    expect(primary.data.email).toBe('john@work.com');
    expect(primary.docId).toBe('john@work,com');
  });
  test('udKeyUpdates đúng', () => {
    expect(result.udKeyUpdates).toHaveLength(2);
    const gh = result.udKeyUpdates.find(u => u.key === 'github.token');
    expect(gh.docId).toBe('github,token');
    expect(gh.operation).toBe('add');
  });
  test('tự sinh contactId nếu không truyền', () => {
    const r = buildContactDocs(sampleContact);
    expect(r.contactId).toMatch(/^uid_/);
  });
  test('flat format contact', () => {
    const r = buildContactDocs({ displayName: 'Jane Smith', emails: [{ value: 'jane@test.com' }] });
    expect(r.indexDoc.displayName).toBe('Jane Smith');
    expect(r.indexDoc.primaryEmail).toBe('jane@test.com');
  });
  test('giữ createdAt nếu được truyền khi update', () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const r = buildContactDocs(sampleContact, { contactId: 'uid_test123', createdAt });
    expect(r.indexDoc.createdAt).toBe(createdAt);
    expect(r.detailDoc.createdAt).toBe(createdAt);
  });
});
