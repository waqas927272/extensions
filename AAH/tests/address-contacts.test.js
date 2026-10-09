const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const a = require('../address-validation.js');
const lookup = require('../address-lookup.js');

// Transcribed name/address variations from the user's screenshots. Contacts
// are fixture values: the test checks extraction/matching, not live accuracy.
const examples = [
    ['Animal Medical Clinic Of Vicksburg- Vicksburg, Ms', 'Animal Medical Clinic', 'Vicksburg', 'Vicksburg', 'MS', '100 Thalweg', '100 Thalweg', '39183'],
    ['Mount Dora Veterinary Hospital', 'Mount Dora Veterinary Hospital', 'Mount Dora', 'Mt Dora', 'FL', '6877 Old Highway 441', '6877 Old Hwy 441', '32757'],
    ['Lake Veterinary Clinic', 'Lake Veterinary Clinic', 'Mount Dora', 'Mt Dora', 'FL', '3300 County Road 19A', '3300 County Rd 19A', '32757'],
    ['Paw Health Network-Kronenwetter, Wi', 'PAW Health Network - 24 Hour Animal Care Center', 'Kronenwetter', 'Kronenwetter', 'WI', '1140 Interstate 39 Frontage Road', '1440 I-39 Frontage Rd', '54455'],
    ['Veterinary Emergency Services Of Lincoln', 'Veterinary Emergency Services', 'Lincoln', 'Lincoln', 'NE', '3700 South 9th Street', '3700 S 9th St Ste L', '68502'],
    ['Animal Emergency Clinic Of Northwest Arkansas', 'Animal Emergency and Specialty Center of Northwest Arkansas', 'Springdale', 'Springdale', 'AR', 'Metroplex Drive', '881 Metroplex Dr', '72762'],
    ['Animal Emergency Clinic Of Shreveport', 'Animal Emergency Clinic Inc.', 'Shreveport', 'Shreveport', 'LA', '2421 Line Avenue', '2421 Line Ave', '71104'],
    ['Creature Comforts Animal Emergency Center', 'Creature Comforts Animal Emergency Center', 'Inman', 'Inman', 'SC', 'TBD', '2065 SC-292', '29349'],
    ['Central Hospital For Animals', 'Central Hospital For Animals - Herrin', 'Herrin', 'Herrin', 'IL', '300 Rushing Drive', '300 Rushing Dr', '62948'],
    ['Kent Veterinary Clinic', 'Kent Veterinary Clinic', 'Amite City', 'Amite City', 'LA', 'TBD', '102 W Factory St', '70422'],
    ['Franklin Animal Clinic @ Greenwood', 'Franklin Animal Clinic at Greenwood Park', 'Greenwood', 'Greenwood', 'IN', '424 Forest Park North Drive', '424 Frst Pk N Dr', '46142']
];

for (const [hospital, businessName, city, googleCity, state, savedStreet, streetAddress, zipCode] of examples) {
    test(`saves contacts for ${hospital}`, async () => {
        const job = { hospital, city, state, streetAddress: savedStreet, zipCode };
        const raw = { businessName, city: googleCity, state, streetAddress, zipCode,
            website: 'https://example.com', phone: '+1 555-234-5678' };
        const result = await lookup.lookup(job, { search: async () => raw, maps: async () => raw });
        assert.equal(result.accepted, true, result.reason);
        a.applyAddressOutcome(job, result);
        assert.equal(job.website, raw.website);
        assert.equal(job.phone, raw.phone);
        if (hospital.startsWith('Paw')) {
            assert.equal(job.streetAddress, '1440 I-39 Frontage Rd');
            assert.equal(job.addressVerificationStatus, 'corrected');
        }
    });
}

test('ignores the saved address in search queries and accepts a new street/ZIP', async () => {
    const job = { hospital: 'Kent Veterinary Clinic', city: 'Amite City', state: 'LA',
        streetAddress: '999 Wrong Road', zipCode: '99999' };
    const plans = lookup.buildSearchPlan(job);
    assert.ok(plans.every(plan => !plan.query.includes('999')));
    const result = await lookup.lookup(job, {
        search: async () => ({ businessName: job.hospital, city: job.city, state: 'LA',
            streetAddress: '102 W Factory St', zipCode: '70422', website: 'https://example.com', phone: '555-234-5678' }),
        maps: async () => { throw new Error('Complete search result should stop lookup'); }
    });
    a.applyAddressOutcome(job, result);
    assert.equal(job.streetAddress, '102 W Factory St');
    assert.equal(job.zipCode, '70422');
});

test('rejects different cities, states, hospitals and conflicting Google branches', async () => {
    const context = { hospitalName: 'Sun City Animal Hospital', location: 'Indian Land, SC',
        streetAddress: '6277 Carolina Commons Drive', zipCode: '29707' };
    const raw = { businessName: context.hospitalName, city: 'Fort Mill', state: 'SC',
        streetAddress: context.streetAddress, zipCode: context.zipCode };
    assert.equal(a.validateGoogleResult(raw, context).reason, 'city-mismatch');
    assert.equal(a.validateGoogleResult({ ...raw, city: 'Indian Land', state: 'NC' }, context).reason, 'state-mismatch');
    assert.equal(a.validateGoogleResult({ ...raw, city: 'Indian Land', businessName: 'Other Hospital' }, context).accepted, false);
    const job = { hospital: 'Kent Veterinary Clinic', city: 'Amite City', state: 'LA', streetAddress: '102 W Factory St' };
    const base = { businessName: job.hospital, city: job.city, state: job.state, zipCode: '70422' };
    const result = await lookup.lookup(job, {
        search: async () => ({ ...base, streetAddress: job.streetAddress }),
        maps: async () => ({ ...base, streetAddress: '500 Main St' })
    });
    assert.equal(result.reason, 'ambiguous-results');
});

test('extracts unlabelled local-panel highway address, Website control and aria phone', async () => {
    const element = (text, attrs = {}) => ({ innerText: text, textContent: text,
        href: attrs.href || '', getAttribute: key => attrs[key] || null,
        getBoundingClientRect: () => ({ width: 100, height: 20 }) });
    const title = element('Creature Comforts Animal Emergency Center');
    const website = element('Website', { href: 'https://example.com' });
    const phone = element('Call', { 'aria-label': 'Call +1 864-362-2862' });
    const panel = element('Creature Comforts Animal Emergency Center\n2065 SC-292, Inman, SC 29349, United\nStates');
    panel.querySelector = () => null;
    panel.querySelectorAll = selector => selector === 'h2' ? [title] :
        selector === 'a[href]' ? [website] : selector === '[aria-label^="Call"]' ? [phone] : [];
    const document = { querySelector: selector => selector === '[role="dialog"]' ? panel : null };
    const sandbox = { document, URL, AAHAddressValidation: { ...a,
        waitForContactDetails: async (read) => read() } };
    const result = await vm.runInNewContext(fs.readFileSync(require.resolve('../google-search-scraper.js'), 'utf8'), sandbox);
    assert.equal(result.streetAddress, '2065 SC-292');
    assert.equal(result.zipCode, '29349');
    assert.equal(result.website, 'https://example.com/');
    assert.equal(result.phone, '+1 864-362-2862');
});
