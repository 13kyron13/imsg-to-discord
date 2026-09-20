const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIdentifier, parseContactsOutput } = require('../src/contacts');

test('normalizeIdentifier matches common Australian phone formats', () => {
  assert.equal(normalizeIdentifier('0412 345 678'), '61412345678');
  assert.equal(normalizeIdentifier('+61 412 345 678'), '61412345678');
  assert.equal(normalizeIdentifier('0061 412 345 678'), '61412345678');
});

test('normalizeIdentifier matches iMessage email identifiers case-insensitively', () => {
  assert.equal(normalizeIdentifier('  Person@Example.COM '), 'person@example.com');
});

test('parseContactsOutput resolves both phone numbers and email addresses', () => {
  const contacts = parseContactsOutput(
    '0412 345 678\tAlice Example\nPerson@Example.COM\tBob Example\n'
  );

  assert.equal(contacts['61412345678'], 'Alice Example');
  assert.equal(contacts['person@example.com'], 'Bob Example');
});

test('parseContactsOutput ignores malformed or empty rows', () => {
  const contacts = parseContactsOutput(
    'not a contact\n\tMissing identifier\n0412 345 678\t\n'
  );

  assert.deepEqual(contacts, {});
});
