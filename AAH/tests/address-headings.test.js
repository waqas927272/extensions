const assert = require('node:assert/strict');
const { test } = require('node:test');
const validation = require('../address-validation.js');
const lookup = require('../address-lookup.js');

for (const hospital of ['Kent Veterinary Clinic', 'Creature Comforts Animal Emergency Center']) {
    test(`rejects the search heading for ${hospital}`, () => {
        const streetAddress = `Results for ${hospital}`;
        assert.equal(validation.isUsableStreetAddress(streetAddress), false);
        assert.equal(validation.isValidStreetAddress(streetAddress), false);
        assert.equal(validation.validateGoogleResult({ businessName: hospital, streetAddress,
            city: 'Amite City', state: 'LA', zipCode: '70422' },
        { hospitalName: hospital, location: 'Amite City, LA' }).accepted, false);
    });
}

test('preserves valid streets and routes', () => {
    for (const street of ['123 Main St', '25-62 31st Street', '5091 U.S. 1',
        'State 710', 'U.S. 31 South', '227k Mechanic Street', 'Main Street', 'PO Box 12']) {
        assert.equal(validation.isUsableStreetAddress(street), true, street);
        const job = { streetAddress: street, zipCode: '70422' };
        assert.equal(validation.repairSearchHeadingAddress(job), false);
        assert.equal(job.streetAddress, street);
    }
    assert.equal(validation.isUsableStreetAddress('Results for Route 123 Veterinary Clinic'), false);
});

test('repairs saved headings, restoring a previous street when available', () => {
    const job = { streetAddress: 'Results for Kent Veterinary Clinic', zipCode: '00000',
        addressVerificationStatus: 'found' };
    assert.equal(validation.repairSearchHeadingAddress(job), true);
    assert.equal(job.streetAddress, 'TBD');
    assert.equal(job.zipCode, '00000');
    assert.equal(job.addressVerificationStatus, 'not-found');
    assert.equal(validation.repairSearchHeadingAddress(job), false);
    const corrected = { streetAddress: 'Results for Kent Veterinary Clinic',
        addressVerification: { previousStreetAddress: '123 Main St', previousZipCode: '70422' } };
    validation.repairSearchHeadingAddress(corrected);
    assert.equal(corrected.streetAddress, '123 Main St');
    assert.equal(corrected.zipCode, '70422');
});

test('lookup continues after a heading and saves a real address', async () => {
    const job = { hospital: 'Kent Veterinary Clinic', city: 'Amite City', state: 'Louisiana' };
    const base = { businessName: job.hospital, city: job.city, state: 'LA' };
    const result = await lookup.lookup(job, {
        search: async () => ({ ...base, streetAddress: 'Results for Kent Veterinary Clinic' }),
        maps: async () => ({ ...base, streetAddress: '123 Main St', zipCode: '70422',
            phone: '555-0100', website: 'https://example.com' })
    });
    assert.equal(result.attempts[0].reason, 'search-heading');
    validation.applyAddressOutcome(job, result);
    assert.equal(job.streetAddress, '123 Main St');
    assert.equal(job.zipCode, '70422');
});

test('heading-only results preserve an existing street or use placeholders', async () => {
    for (const streetAddress of ['', '123 Main St']) {
        const job = { hospital: 'Kent Veterinary Clinic', city: 'Amite City', state: 'LA', streetAddress };
        const provider = async () => ({ businessName: job.hospital, city: job.city,
            state: job.state, streetAddress: 'Results for Kent Veterinary Clinic' });
        const result = await lookup.lookup(job, { search: provider, maps: provider });
        assert.equal(result.accepted, false);
        validation.applyAddressOutcome(job, result);
        assert.equal(job.streetAddress, streetAddress || 'TBD');
        assert.equal(job.zipCode, '00000');
    }
});
