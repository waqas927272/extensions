import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractDetailsFromDescription,
    normalizeAddressData,
    normalizeJobLocationData,
    selectHospitalForLocation
} from './detail-rules.mjs';

function description(title, body, city = 'Test City', state = 'CT') {
    return [
        '=== JOB POSTING DATA ===',
        `Title: ${title}`,
        'Industry/Category: General Practice',
        'Hiring Organization:',
        'Office Name:',
        'Brand Name:',
        'Locations:',
        `  - ${city}, ${state}, US`,
        '',
        '=== FULL JOB DESCRIPTION ===',
        body
    ].join('\n');
}

function hospitalFor(title, body, city, state) {
    const result = extractDetailsFromDescription(title, description(title, body, city, state));
    return selectHospitalForLocation(result.locations[0], result.hospitalName);
}

test('extracts a hospital from the leading Hospital | City format', () => {
    assert.equal(
        hospitalFor(
            'Veterinarian',
            'Associate Veterinarian\nPieper Veterinary Marlborough | Marlborough, Connecticut\nPieper Veterinary Marlborough is seeking an Associate Veterinarian.',
            'Marlborough',
            'CT'
        ),
        'Pieper Veterinary Marlborough'
    );
});

test('extracts a hospital from the Role - Hospital format', () => {
    assert.equal(
        hospitalFor(
            'Veterinarian - Dentist',
            'Veterinary Dentist – Hickory Veterinary and Specialty Hospital\nPlymouth Meeting, PA | Full-Time',
            'Plymouth Meeting',
            'PA'
        ),
        'Hickory Veterinary and Specialty Hospital'
    );
});

test('keeps ampersands inside facility names', () => {
    assert.equal(
        hospitalFor(
            'Veterinary Oncologist',
            'Hickory Veterinary & Specialty Hospital in Plymouth Meeting, PA is seeking a Veterinary Oncologist.',
            'Plymouth Meeting',
            'PA'
        ),
        'Hickory Veterinary & Specialty Hospital'
    );
});

test('extracts a facility name at the start of a descriptive sentence', () => {
    assert.equal(
        hospitalFor(
            'Veterinary Cardiologist',
            'Animal Clinic Northview is a full-service veterinary and emergency hospital in the greater Cleveland area.',
            'North Ridgeville',
            'OH'
        ),
        'Animal Clinic Northview'
    );
});

test('does not include a preceding marketing sentence in the hospital name', () => {
    assert.equal(
        hospitalFor(
            'Veterinary Surgeon',
            'Mass-RI Veterinary Services\nSwansea, Massachusetts\nLead with Purpose. Practice Exceptional Medicine.\nMass-RI Veterinary Services is seeking an experienced Veterinary Surgeon.',
            'Swansea',
            'MA'
        ),
        'Mass-RI Veterinary Services'
    );
});

test('handles an acronym and city between the facility name and is seeking', () => {
    assert.equal(
        hospitalFor(
            'Veterinarian - Urgent Care',
            'Portland Veterinary Emergency and Specialty Care (PVESC) in Portland, Maine is seeking an Urgent Care Veterinarian.',
            'Portland',
            'ME'
        ),
        'Portland Veterinary Emergency and Specialty Care'
    );
});

test('preserves a location suffix written with an en dash', () => {
    assert.equal(
        hospitalFor(
            'Veterinarian - Urgent Care',
            'Look no further than Pieper Veterinary – Madison. This urgent care is positively thriving.',
            'Madison',
            'CT'
        ),
        'Pieper Veterinary-Madison'
    );
});

test('rejects duty and benefit lines as hospital names', () => {
    const result = extractDetailsFromDescription(
        'Veterinarian',
        description(
            'Veterinarian',
            'Lead anesthesia and pain management services across a wide range of procedures.\n• Licensed to practice veterinary medicine in Ohio.'
        )
    );
    assert.equal(result.hospitalName, '');
});

test('repairs city, state, and location when country was stored as the state', () => {
    assert.deepEqual(
        normalizeJobLocationData({
            city: 'Marlborough, CT',
            state: 'US',
            location: 'Marlborough, CT, US'
        }),
        {
            city: 'Marlborough',
            state: 'CT',
            location: 'Marlborough, CT'
        }
    );

    const address = normalizeAddressData({ city: 'Marlborough, CT', state: 'US' });
    assert.equal(address.city, 'Marlborough');
    assert.equal(address.state, 'CT');

    const validAddress = normalizeAddressData({ city: 'Marlborough', state: 'Connecticut' });
    assert.equal(validAddress.city, 'Marlborough');
    assert.equal(validAddress.state, 'Connecticut');
    assert.equal(validAddress.addressRepaired, undefined);
});

test('uses the location-specific Pieper Stratford facility name', () => {
    const source = [
        '=== JOB POSTING DATA ===',
        'Title: Internal Medicine Veterinarian',
        'Locations:',
        '  - Stratford CT',
        '',
        '=== FULL JOB DESCRIPTION ===',
        'Pieper Veterinary is seeking a Small Animal Internist to join our team in Stratford, CT.',
        'At Pieper Veterinary, Stratford, we take pride in exceptional care. Pieper Stratford\u2019s Internal Medicine Department is growing.'
    ].join('\n');
    const result = extractDetailsFromDescription('Internal Medicine Veterinarian', source);
    assert.equal(
        selectHospitalForLocation(result.locations[0], result.hospitalName),
        'Pieper Veterinary Stratford'
    );
});
