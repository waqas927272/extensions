const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const quality = require('../address-quality.js');

function candidate(overrides = {}) {
    return {
        streetAddress: '677 Brevard Rd',
        city: 'Asheville',
        state: 'NC',
        zipCode: '28806',
        fullAddress: '677 Brevard Rd, Asheville, NC 28806',
        website: 'https://www.medvet.com/location/asheville/',
        phone: '828.665.4399',
        placeName: 'MedVet Asheville',
        sourceType: 'google-maps',
        ...overrides
    };
}

test('accepts a complete address for the requested MedVet facility', () => {
    const validation = quality.validateAddressCandidate(candidate(), {
        hospitalName: 'MedVet Asheville',
        location: 'Asheville, North Carolina'
    });

    assert.equal(validation.accepted, true);
    assert.equal(validation.result.verified, true);
    assert.equal(validation.result.locationMismatch, false);
});

test('rejects the CSV Cary/Asheville false positive', () => {
    const validation = quality.validateAddressCandidate(candidate(), {
        hospitalName: 'MedVet',
        location: 'Cary, North Carolina'
    });

    assert.equal(validation.accepted, false);
    assert.equal(validation.reason, 'city-and-name-mismatch');
});

test('rejects an address whose parser failed to produce a city', () => {
    const validation = quality.validateAddressCandidate(candidate({
        streetAddress: '677 Brevard Rd. Asheville',
        city: ''
    }), {
        hospitalName: 'MedVet',
        location: 'Cary, North Carolina'
    });

    assert.equal(validation.accepted, false);
    assert.equal(validation.reason, 'incomplete-address');
});

test('rejects a Google result without a verified place name', () => {
    const validation = quality.validateAddressCandidate(candidate({ placeName: '' }), {
        hospitalName: 'MedVet Asheville',
        location: 'Asheville, North Carolina'
    });

    assert.equal(validation.accepted, false);
    assert.equal(validation.reason, 'missing-place-name');
});

test('rejects West Asheville Family Vet for a WestVet query', () => {
    const validation = quality.validateAddressCandidate(candidate({
        streetAddress: '547 Haywood Rd',
        phone: '828-202-5038',
        placeName: 'West Asheville Family Vet'
    }), {
        hospitalName: 'WestVet Asheville',
        location: 'Asheville, North Carolina'
    });

    assert.equal(validation.accepted, false);
    assert.equal(validation.reason, 'brand-mismatch');
});

test('rejects Far West Veterinary Clinic for the CSV WestVet Austin query', () => {
    const validation = quality.validateAddressCandidate(candidate({
        streetAddress: '3720 Far West Blvd, Ste 101',
        city: 'Austin',
        state: 'TX',
        zipCode: '78731',
        fullAddress: '3720 Far West Blvd, Ste 101, Austin, TX 78731',
        placeName: 'Far West Veterinary Clinic'
    }), {
        hospitalName: 'WestVet',
        location: 'Austin, Texas'
    });

    assert.equal(validation.accepted, false);
    assert.equal(validation.reason, 'brand-mismatch');
});

test('allows a strictly verified opposite-brand recovery for a corrupted legacy row', () => {
    const medVetAustin = candidate({
        streetAddress: '12400 N Interstate Hwy 35 Bldg B',
        city: 'Austin',
        state: 'TX',
        zipCode: '78753',
        fullAddress: '12400 N Interstate Hwy 35 Bldg B, Austin, TX 78753',
        phone: '737.931.0345',
        website: 'https://www.medvet.com/location/austin/',
        placeName: 'MedVet Austin'
    });
    const validation = quality.validateAddressCandidate(medVetAustin, {
        hospitalName: 'MedVet Austin',
        location: 'Austin, Texas'
    });

    assert.equal(validation.accepted, true);
    assert.equal(validation.result.streetAddress, '12400 N Interstate Hwy 35 Bldg B');
    assert.equal(validation.result.placeName, 'MedVet Austin');
});

test('accepts a strongly named facility with a legitimate mailing-city difference', () => {
    const validation = quality.validateAddressCandidate(candidate({
        streetAddress: '2714 Springboro West Rd',
        city: 'Moraine',
        state: 'OH',
        zipCode: '45439',
        fullAddress: '2714 Springboro West Rd, Moraine, OH 45439',
        placeName: 'MedVet Dayton'
    }), {
        hospitalName: 'MedVet Dayton',
        location: 'Dayton, Ohio'
    });

    assert.equal(validation.accepted, true);
    assert.equal(validation.result.locationMismatch, true);
});

test('accepts the official MedVet West Chester township address', () => {
    const validation = quality.validateAddressCandidate(candidate({
        streetAddress: '7735 Liberty Field Dr',
        city: 'West Chester Township',
        state: 'OH',
        zipCode: '45069',
        fullAddress: '7735 Liberty Field Dr, West Chester Township, OH 45069',
        phone: '513.298.4016',
        website: 'https://www.medvet.com/location/west-chester/',
        placeName: 'MedVet West Chester'
    }), {
        hospitalName: 'MedVet West Chester',
        location: 'West Chester, Ohio'
    });

    assert.equal(validation.accepted, true);
    assert.equal(validation.result.zipCode, '45069');
});

test('never combines partial fields from separate search attempts', () => {
    const partialAddress = candidate({ city: '', state: '', placeName: '' });
    const partialIdentity = candidate({ streetAddress: '', zipCode: '' });
    const result = quality.selectAtomicAddress(partialAddress, partialIdentity, {
        hospitalName: 'MedVet Asheville',
        location: 'Asheville, North Carolina'
    });

    assert.equal(result.verified, false);
    assert.equal(result.streetAddress, '');
    assert.equal(result.website, '');
});

test('keeps contact fields from the same accepted candidate', () => {
    const rejected = candidate({
        streetAddress: '547 Haywood Rd',
        phone: '828-202-5038',
        placeName: 'West Asheville Family Vet'
    });
    const accepted = candidate();
    const result = quality.selectAtomicAddress(rejected, accepted, {
        hospitalName: 'MedVet Asheville',
        location: 'Asheville, North Carolina'
    });

    assert.equal(result.streetAddress, '677 Brevard Rd');
    assert.equal(result.phone, '828.665.4399');
    assert.equal(result.website, 'https://www.medvet.com/location/asheville/');
});

test('repairs duplicated and prose-corrupted hospital search names', () => {
    assert.equal(
        quality.normalizeHospitalName('MedVet Boston MedVet Boston', 'Newton, Massachusetts'),
        'MedVet Boston'
    );
    assert.equal(
        quality.normalizeHospitalName('MedVet BostoMedVet Boston', 'Newton, Massachusetts'),
        'MedVet Boston'
    );
    assert.equal(
        quality.normalizeHospitalName('MedVet to enhance online', 'Worthington, Ohio'),
        'MedVet Worthington'
    );
    assert.equal(
        quality.normalizeHospitalName('MedVet', 'Cary, North Carolina'),
        'MedVet Cary'
    );
});

test('reconciles generic Raleigh and Dallas rows from specific same-location jobs', () => {
    const jobs = [
        { hospital: 'MedVet Raleigh', location: 'Cary, North Carolina' },
        { hospital: 'MedVet Raleigh', location: 'Cary, North Carolina' },
        { hospital: 'MedVet', location: 'Cary, North Carolina' },
        { hospital: 'MedVet Dallas', location: 'Dallas, Texas' },
        { hospital: 'MedVet', location: 'Dallas, Texas' },
        { hospital: 'WestVet Meridian', location: 'Meridian, Idaho' },
        { hospital: 'WestVet', location: 'Meridian, Idaho' },
        {
            hospital: 'MedVet Cincinnati',
            location: 'West Chester, Ohio',
            description: '=== FULL JOB DESCRIPTION === Why Join MedVet West Chester? Take a video tour of our hospital.'
        }
    ];

    const updated = quality.reconcileGenericHospitalNames(jobs);

    assert.equal(updated, 4);
    assert.equal(jobs[2].hospital, 'MedVet Raleigh');
    assert.equal(jobs[4].hospital, 'MedVet Dallas');
    assert.equal(jobs[6].hospital, 'WestVet Meridian');
    assert.equal(jobs[7].hospital, 'MedVet West Chester');
});

test('extracts an explicit hospital name despite mojibake spacing', () => {
    const description = '=== FULL JOB DESCRIPTION === Now hiring at MedVet\u00c2 Dallas. Why Join MedVet\u00c2 Dallas?';
    assert.equal(
        quality.extractExplicitHospitalName(description, 'Dallas, Texas', 'MedVet'),
        'MedVet Dallas'
    );
});

test('does not guess when a location has tied specific facility names', () => {
    const jobs = [
        { hospital: 'MedVet Alpha', location: 'Example, Ohio' },
        { hospital: 'MedVet Beta', location: 'Example, Ohio' },
        { hospital: 'MedVet', location: 'Example, Ohio' }
    ];

    const updated = quality.reconcileGenericHospitalNames(jobs);

    assert.equal(updated, 0);
    assert.equal(jobs[2].hospital, 'MedVet');
});

test('Google Search scraper does not scan arbitrary body text for addresses', () => {
    const scraper = fs.readFileSync(path.join(__dirname, '..', 'google-search-scraper.js'), 'utf8');
    assert.doesNotMatch(scraper, /extractAddress\(bodyText\)/);
    assert.doesNotMatch(scraper, /extractWebsiteFromPanel\(\)\s*\|\|\s*extractWebsiteFromResults/);
});

test('records pipeline uses the atomic selector instead of field-wise address merging', () => {
    const records = fs.readFileSync(path.join(__dirname, '..', 'records.js'), 'utf8');
    assert.match(records, /addressQuality\.selectAtomicAddress/);
    assert.match(records, /candidate\s*&&\s*addressQuality\.isGenericHospitalName\(candidate\)/);
    assert.match(records, /addressQuality\.reconcileGenericHospitalNames/);
    assert.doesNotMatch(records, /primary\.streetAddress\s*\|\|\s*safeSecondary\.streetAddress/);
});

test('address quality helpers load before the records page code', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'records.html'), 'utf8');
    const qualityScript = html.indexOf('<script src="address-quality.js"></script>');
    const recordsScript = html.indexOf('<script src="records.js"></script>');

    assert.notEqual(qualityScript, -1);
    assert.notEqual(recordsScript, -1);
    assert.ok(qualityScript < recordsScript);
});
