function normalizeIdentifier(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  // iMessage/email identifiers should be matched case-insensitively.
  if (raw.includes('@')) return raw.toLowerCase();

  // Normalize phone numbers to digits. Convert common Australian local
  // numbers (04xx...) to their +61 form, while accepting +61 and 00 prefixes.
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = '61' + digits.slice(1);
  }
  return digits;
}

function parseContactsOutput(output) {
  const contacts = {};
  if (!output) return contacts;

  for (const line of String(output).trim().split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;

    const identifier = normalizeIdentifier(line.slice(0, tab));
    const name = line.slice(tab + 1).trim();
    if (identifier && name) contacts[identifier] = name;
  }

  return contacts;
}

module.exports = { normalizeIdentifier, parseContactsOutput };
