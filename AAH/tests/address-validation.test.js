const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../address-validation.js');

function mapsResult(overrides = {}) {
    return {
        businessName: 'Berclair Animal Hospital',
        streetAddress: '5169 Wheelis Dr',
        city: 'Memphis',
        state: 'TN',
        zipCode: '38117',
        fullAddress: '5169 Wheelis Dr, Memphis, TN 38117',
        website: 'https://berclairanimal.com/',
        phone: '+19016411545',
        ...overrides
    };
}

test('accepts a complete address matching hospital, city, and state', () => {
    const result = validation.validateGoogleResult(mapsResult(), {
        hospitalName: 'Berclair Animal Hospital',
        location: 'Memphis, TN'
    });
    assert.equal(result.accepted, true);
    assert.equal(result.reason, 'exact-location');
});

test('accepts Affton as a hospital-name city alias but preserves St. Louis filtration', () => {
    const result = validation.validateGoogleResult(mapsResult({
        businessName: 'PriorityPet Urgent Care',
        streetAddress: '9998 Gravois Rd',
        city: 'Affton',
        state: 'MO',
        zipCode: '63123'
    }), {
        hospitalName: 'Prioritypet Urgent Care Of Affton',
        location: 'St. Louis, MO'
    });
    assert.equal(result.accepted, true);
    assert.equal(result.reason, 'hospital-city-alias');

    const job = { city: 'Affton', state: 'Missouri', location: 'St. Louis, MO' };
    validation.applyAddressOutcome(job, result);
    assert.deepEqual(
        { street: job.streetAddress, city: job.city, state: job.state, zip: job.zipCode },
        { street: '9998 Gravois Rd', city: 'St. Louis', state: 'Missouri', zip: '63123' }
    );
});

test('accepts an exact business in the same state for a metro-area filtration city', () => {
    const result = validation.validateGoogleResult(mapsResult({
        businessName: 'Cy-Fair Animal Hospital',
        streetAddress: '15003 Inwood Rd Suite D',
        city: 'Addison',
        state: 'TX',
        zipCode: '75001'
    }), {
        hospitalName: 'Cy-Fair Animal Hospital',
        location: 'Dallas, TX'
    });
    assert.equal(result.accepted, true);
    assert.equal(result.reason, 'exact-business-same-state');

    const job = { city: '', state: '', location: 'Dallas, TX' };
    validation.applyAddressOutcome(job, result);
    assert.equal(job.city, 'Dallas');
    assert.equal(job.state, 'Texas');
    assert.equal(job.streetAddress, '15003 Inwood Rd Suite D');
    assert.equal(job.zipCode, '75001');
});

test('keeps a Google regional prefix as part of the verified street address', () => {
    const result = validation.validateGoogleResult(mapsResult({
        businessName: 'Plum Creek Regional Animal Medical Center',
        streetAddress: 'South Suburbs, 1751 E Exchange St',
        city: 'Crete',
        state: 'IL',
        zipCode: '60417'
    }), {
        hospitalName: 'Plum Creek Regional Animal Medical Center',
        location: 'Crete, IL'
    });
    assert.equal(result.accepted, true);
    assert.equal(result.result.streetAddress, 'South Suburbs, 1751 E Exchange St');
});

test('matches punctuated business acronyms such as A.C.E. versus Ace', () => {
    const result = validation.validateGoogleResult(mapsResult({
        businessName: 'A.C.E. Veterinary Hospital',
        streetAddress: '1078 NY-82',
        city: 'Hopewell Junction',
        state: 'NY',
        zipCode: '12533'
    }), {
        hospitalName: 'Ace Veterinary Hospital',
        location: 'Hopewell Junction, NY'
    });
    assert.equal(result.accepted, true);
    assert.equal(result.result.streetAddress, '1078 NY-82');
});

test('rejects a different business even when its city and state match', () => {
    const result = validation.validateGoogleResult(mapsResult({ businessName: 'Unrelated Pet Clinic' }), {
        hospitalName: 'Berclair Animal Hospital',
        location: 'Memphis, TN'
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'business-name-mismatch');
});

test('rejects a result from a different state', () => {
    const result = validation.validateGoogleResult(mapsResult({ state: 'AR' }), {
        hospitalName: 'Berclair Animal Hospital',
        location: 'Memphis, TN'
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'state-mismatch');
});

test('rejects incomplete, placeholder, or malformed address values', () => {
    for (const candidate of [
        mapsResult({ zipCode: '' }),
        mapsResult({ zipCode: '00000' }),
        mapsResult({ streetAddress: 'Not Available (TBD)' }),
        mapsResult({ streetAddress: 'Company Description and Qualifications' })
    ]) {
        const result = validation.validateGoogleResult(candidate, {
            hospitalName: 'Berclair Animal Hospital',
            location: 'Memphis, TN'
        });
        assert.equal(result.accepted, false);
        assert.equal(result.reason, 'incomplete-address');
    }
});

test('fallback uses exact TBD values and preserves filtration city and state', () => {
    const job = {
        streetAddress: 'Wrong address',
        zipCode: '12345',
        city: 'Wrong city',
        state: 'Wrong state',
        location: 'Lake Worth, FL'
    };
    validation.applyAddressOutcome(job, { accepted: false, result: null });
    assert.equal(job.streetAddress, 'Not Available (TBD)');
    assert.equal(job.zipCode, '00000');
    assert.equal(job.city, 'Lake Worth');
    assert.equal(job.state, 'Florida');
});

test('address components are chosen atomically instead of mixed between attempts', () => {
    const partialFirst = mapsResult({ streetAddress: 'Wrong Street 1', zipCode: '' });
    const completeSecond = mapsResult({ streetAddress: '5169 Wheelis Dr', zipCode: '38117' });
    const chosen = validation.chooseCompleteAddressResult(partialFirst, completeSecond);
    assert.equal(chosen.streetAddress, '5169 Wheelis Dr');
    assert.equal(chosen.zipCode, '38117');
});

test('a missing result never erases the filtration city or state', () => {
    const job = { location: 'Saratoga Springs, NY', city: '', state: '' };
    validation.applyAddressOutcome(job, null);
    assert.equal(job.city, 'Saratoga Springs');
    assert.equal(job.state, 'New York');
    assert.equal(job.streetAddress, 'Not Available (TBD)');
    assert.equal(job.zipCode, '00000');
});
