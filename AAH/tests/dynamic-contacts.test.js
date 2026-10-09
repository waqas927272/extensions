const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const a = require('../address-validation.js');
const lookup = require('../address-lookup.js');

// User-provided evidence is fixture data only; production has no hospital list.
const cases = [
    ['Horizon Veterinary Specialists', 'Ventura', 'CA', '5280 Valentine Rd Ste 120', '93003', '+1 805-303-8996', 'https://horizonvets.com/'],
    ['PAW Health Network - 24 Hour Animal Care Center', 'Kronenwetter', 'WI', '1440 I-39 Frontage Rd', '54455', '+1 715-883-3497', 'https://pawhealthnetwork.com/'],
    ['Creature Comforts Animal Emergency Center', 'Inman', 'SC', '2065 SC-292', '29349', '+1 864-362-2862', 'https://creaturecomfortser.com/'],
    ['Plum Creek Regional Animal Medical Center', 'Crete', 'IL', 'South Suburbs, 1751 E Exchange St', '60417', '+1 708-627-2483', 'https://plumcreekanimal.com/'],
    ['Kent Veterinary Clinic', 'Amite City', 'LA', '102 W Factory St', '70422', '+1 985-239-0147', 'http://www.kentveterinaryclinic.com/']
];

function element(text, attrs = {}) {
    return { innerText: text, textContent: text, href: attrs.href || '',
        getAttribute: key => attrs[key] || null,
        getBoundingClientRect: () => ({ width: 100, height: 20 }) };
}

function makePanel(name, address, phone, website, mode) {
    const heading = element(name);
    const link = element(mode === 'domain' ? new URL(website).hostname : 'Website',
        { href: mode === 'redirect' ? `https://www.google.com/url?q=${encodeURIComponent(website)}` : website });
    const button = element('Call', { 'aria-label': `Call ${phone}` });
    const authority = element(new URL(website).hostname, { 'data-item-id': 'authority', 'aria-label': `Website: ${new URL(website).hostname}` });
    const panel = element(`${name}\n${address}\n${mode === 'plain' ? phone : ''}`);
    panel.querySelector = () => null;
    panel.querySelectorAll = selector => {
        if (selector === '[role="heading"][aria-level="1"]') return [heading];
        if (selector === 'a[href]') return mode === 'button' ? [] : [link];
        if (selector === '[aria-label^="Call"]') return mode === 'plain' ? [] : [button];
        if (selector === '[data-item-id="authority"], [aria-label^="Website"], [data-tooltip="Open website"]') return mode === 'button' ? [authority] : [];
        return [];
    };
    return panel;
}

for (const [index, [hospital, city, state, street, zip, phone, website]] of cases.entries()) {
    test(`dynamic panel extraction and save: ${hospital}`, async () => {
        const job = { hospital, city, state, streetAddress: '999 Old Street', zipCode: '00000' };
        const panel = makePanel(hospital, `${street}, ${city}, ${state} ${zip}, United\nStates`, phone,
            `${website}?utm_source=GMBlisting`, ['domain', 'redirect', 'plain', 'button', 'domain'][index]);
        const unrelated = makePanel('Unrelated Animal Hospital', '1 Other St, Elsewhere, TX 75001', '+1 555-234-5678', 'https://wrong.example/', 'domain');
        const document = { querySelectorAll: selector => selector === '[role="dialog"]' ? [unrelated] : selector === '#rhs' ? [panel] : [] };
        const context = lookup.getContext(job);
        const raw = await vm.runInNewContext(fs.readFileSync(require.resolve('../google-search-scraper.js'), 'utf8'), {
            document, URL, __AAH_ADDRESS_CONTEXT__: context,
            AAHAddressValidation: { ...a, waitForContactDetails: async read => read() }
        });
        assert.equal(raw.businessName, hospital);
        assert.equal(raw.phone, phone);
        assert.equal(raw.website, website);
        const outcome = await lookup.lookup(job, { search: async () => raw, maps: async () => ({}) });
        assert.equal(outcome.accepted, true, outcome.reason);
        a.applyAddressOutcome(job, outcome);
        assert.equal(job.phone, phone);
        assert.equal(job.website, website);
        assert.equal(job.zipCode, zip);
        assert.equal(job.streetAddress, street.replace(/^South Suburbs, /, ''));
    });
}

test('does not copy booking links, unrelated domains or review numbers', () => {
    const panel = makePanel('Hospital', '123 Main St, Austin, TX 78701', '', 'https://example.com/', 'domain');
    panel.innerText = 'Hospital\nReviews: 1234567890';
    panel.querySelectorAll = selector => selector === 'a[href]' ? [
        element('Book online', { href: 'https://booking.example/' }),
        element('hospital.example', { href: 'https://unrelated.example/' }),
        element('Website', { href: 'https://www.google.com/maps/place/test' })
    ] : [];
    assert.deepEqual(a.extractPanelContacts(panel), { website: '', phone: '' });
    assert.equal(a.extractContactPhone('Call +1\u202f805‑303‑8996'), '+1 805-303-8996');
});
