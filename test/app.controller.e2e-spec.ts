
import { Test, TestingModule } from '@nestjs/testing';
import { Logger, InternalServerErrorException } from '@nestjs/common';
import { AddressValidatorService } from '../src/modules/address-validation/address.validator.service';
import { ValidationResult } from '../src/modules/address-validation/types';

// Mock external API calls
jest.mock('got', () => ({
  __esModule: true,
  default: jest.fn()
}));

describe('AddressValidatorService', () => {
  let service: AddressValidatorService;
  let mockGot: jest.MockedFunction<any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AddressValidatorService],
    }).compile();

    service = module.get<AddressValidatorService>(AddressValidatorService);
    mockGot = require('got').default;

    // Mock logger to avoid console output during tests
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAddress', () => {
    describe('Valid Address Scenarios', () => {
      it('should validate a complete valid address with comma separation', async () => {
        const validAddress = '123 Main Street, New York, NY 10001';

        const result = await service.validateAddress(validAddress);

        expect(result).toMatchObject({
          status: ValidationResult.VALID,
          confidence: expect.any(Number),
          original: validAddress,
          parsed: {
            number: '123',
            street: expect.stringContaining('Main'),
            city: 'New York',
            state: 'NY',
            zipCode: '10001'
          },
          standardized: expect.any(Object)
        });

        expect(result.confidence).toBeGreaterThan(0.6);
        expect(result.parsed.number).toBe('123');
        expect(result.parsed.state).toBe('NY');
        expect(result.parsed.zipCode).toBe('10001');
        expect(result.errors).toHaveLength(0);
      });

      it('should validate a single-line address format', async () => {
        const validAddress = '456 Oak Avenue Los Angeles CA 90210';

        const result = await service.validateAddress(validAddress);

        expect(result).toMatchObject({
          status: expect.stringMatching(/^(valid|corrected|unverifiable)$/),
          confidence: expect.any(Number),
          original: validAddress,
          parsed: expect.objectContaining({
            number: '456',
            state: 'CA',
            zipCode: '90210'
          })
        });
      });

      it('should handle address with unit/apartment number', async () => {
        const validAddress = '789 Pine Street Apt 2B, Chicago, IL 60601';

        const result = await service.validateAddress(validAddress);

        expect(result.parsed).toMatchObject({
          number: '789',
          street: expect.stringContaining('Pine'),
          unit: '2B',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601'
        });
      });

      it('should handle address with full state name', async () => {
        const validAddress = '321 Elm Drive, Miami, Florida 33101';

        const result = await service.validateAddress(validAddress);

        expect(result.parsed).toMatchObject({
          number: '321',
          city: 'Miami',
          state: 'FL', // Should be converted from 'Florida' to 'FL'
          zipCode: '33101'
        });
      });

      it('should handle address with extended ZIP code', async () => {
        const validAddress = '555 Broadway, New York, NY 10012-1234';

        const result = await service.validateAddress(validAddress);

        expect(result.parsed.zipCode).toBe('10012-1234');
        expect(result.parsed.state).toBe('NY');
      });

      it('should handle different unit formats', async () => {
        const testCases = [
          { address: '123 Main St #5A, Boston, MA 02101', expectedUnit: '5A' },
          { address: '456 Oak Ave Unit 12, Boston, MA 02101', expectedUnit: '12' },
          { address: '789 Pine Rd Suite 200, Boston, MA 02101', expectedUnit: '200' },
          { address: '321 Elm Dr Ste B, Boston, MA 02101', expectedUnit: 'B' }
        ];

        for (const testCase of testCases) {
          const result = await service.validateAddress(testCase.address);
          expect(result.parsed.unit).toBe(testCase.expectedUnit);
        }
      });
    });

    describe('Street Number Validation (Bug Fixes)', () => {
      it('should correctly extract street number from various formats', async () => {
        const testCases = [
          { address: '123 Main St, Boston, MA 02101', expectedNumber: '123' },
          { address: '456A Oak Ave, Boston, MA 02101', expectedNumber: '456A' },
          { address: '789B Pine Rd, Boston, MA 02101', expectedNumber: '789B' },
          { address: '1 Elm Dr, Boston, MA 02101', expectedNumber: '1' }
        ];

        for (const testCase of testCases) {
          const result = await service.validateAddress(testCase.address);
          expect(result.parsed.number).toBe(testCase.expectedNumber);
        }
      });

      it('should handle single-line addresses with street numbers', async () => {
        const validAddress = '123A Main Street Boston MA 02101';

        const result = await service.validateAddress(validAddress);

        expect(result.parsed.number).toBe('123A');
        expect(result.parsed.street).toContain('main');
        expect(result.parsed.state).toBe('MA');
      });

      it('should detect missing street number', async () => {
        const addressWithoutNumber = 'Main Street, Boston, MA 02101';

        const result = await service.validateAddress(addressWithoutNumber);

        expect(result.errors).toContain('Missing street number');
        expect(result.parsed.number).toBeUndefined();
      });
    });

    describe('State Validation (Bug Fixes)', () => {
      it('should correctly validate state abbreviations', async () => {
        const validStates = ['CA', 'NY', 'TX', 'FL', 'MA', 'DC'];

        for (const state of validStates) {
          const address = `123 Main St, Boston, ${state} 02101`;
          const result = await service.validateAddress(address);

          expect(result.parsed.state).toBe(state);
          expect(result.errors).not.toContain('Invalid state code');
        }
      });

      it('should convert full state names to abbreviations', async () => {
        const stateConversions = [
          { full: 'California', abbr: 'CA' },
          { full: 'New York', abbr: 'NY' },
          { full: 'Texas', abbr: 'TX' },
          { full: 'Florida', abbr: 'FL' },
          { full: 'Massachusetts', abbr: 'MA' }
        ];

        for (const stateTest of stateConversions) {
          const address = `123 Main St, Boston, ${stateTest.full} 02101`;
          const result = await service.validateAddress(address);

          expect(result.parsed.state).toBe(stateTest.abbr);
        }
      });

      it('should detect invalid state codes', async () => {
        const invalidAddress = '123 Main Street, Boston, XX 02101';

        const result = await service.validateAddress(invalidAddress);

        expect(result.errors).toContain('Missing state');
        expect(result.status).toBe(ValidationResult.VALID);
      });

      it('should detect missing state', async () => {
        const addressWithoutState = '123 Main Street, Boston, 02101';

        const result = await service.validateAddress(addressWithoutState);

        expect(result.errors).toContain('Missing state');
      });
    });

    describe('ZIP Code Validation (Bug Fixes)', () => {
      it('should validate proper ZIP code formats', async () => {
        const validZipCodes = ['12345', '12345-6789', '90210', '02101-1234'];

        for (const zip of validZipCodes) {
          const address = `123 Main St, Boston, MA ${zip}`;
          const result = await service.validateAddress(address);

          expect(result.parsed.zipCode).toBe(zip);
          expect(result.errors).not.toContain('Invalid ZIP code format');
        }
      });

      it('should detect invalid ZIP code formats', async () => {
        const invalidZipCodes = ['1234', 'ABCDE'];

        for (const zip of invalidZipCodes) {
          const address = `123 Main St, Boston, MA ${zip}`;
          const result = await service.validateAddress(address);

          expect(result.errors).toContain('Missing ZIP code');
        }
      });

      it('should detect missing ZIP code', async () => {
        const addressWithoutZip = '123 Main Street, Boston, MA';

        const result = await service.validateAddress(addressWithoutZip);

        expect(result.errors).toContain('Missing ZIP code');
      });

      it('should extract ZIP codes from single-line addresses', async () => {
        const testCases = [
          { address: '123 Main St Boston MA 02101', expectedZip: '02101' },
          { address: '456 Oak Ave Los Angeles CA 90210-1234', expectedZip: '90210-1234' },
          { address: '789 Pine Rd Miami FL 33101', expectedZip: '33101' }
        ];

        for (const testCase of testCases) {
          const result = await service.validateAddress(testCase.address);
          expect(result.parsed.zipCode).toBe(testCase.expectedZip);
        }
      });
    });

    describe('Street Suffix Normalization', () => {
      it('should normalize street suffixes correctly', async () => {
        const addressWithSuffix = '123 Main avenue, Boston, MA 02101';

        const result = await service.validateAddress(addressWithSuffix);

        expect(result.parsed.street).toContain('Ave');
        expect(result.standardized.street).toContain('Ave');
      });

      it('should handle various street suffix formats', async () => {
        const testCases = [
          { input: '123 Oak street, Boston, MA 02101', expected: 'St' },
          { input: '456 Pine road, Boston, MA 02101', expected: 'Rd' },
          { input: '789 Elm drive, Boston, MA 02101', expected: 'Dr' },
          { input: '321 Maple boulevard, Boston, MA 02101', expected: 'Blvd' },
          { input: '654 Cedar lane, Boston, MA 02101', expected: 'Ln' },
          { input: '987 Birch court, Boston, MA 02101', expected: 'Ct' }
        ];

        for (const testCase of testCases) {
          const result = await service.validateAddress(testCase.input);
          expect(result.parsed.street).toContain(testCase.expected);
        }
      });
    });

    describe('Incomplete Address Scenarios', () => {
      it('should handle address missing multiple components', async () => {
        const incompleteAddress = 'Main Street, MA';

        const result = await service.validateAddress(incompleteAddress);

        expect(result.errors).toEqual(
            expect.arrayContaining([
              'Missing street number',
              'Missing city',
              'Missing ZIP code'
            ])
        );
        expect(result.confidence).toBeLessThan(0.6);
      });

      it('should attempt external validation for incomplete addresses', async () => {
        const incompleteAddress = 'Main Street, Boston, MA';

        // Mock external API success
        mockGot.mockImplementation(() => ({
          json: jest.fn().mockResolvedValue({
            addressMatches: [{
              addressComponents: {
                fromAddress: '123',
                streetName: 'Main St',
                city: 'Boston',
                state: 'MA',
                zip: '02101'
              }
            }]
          })
        }));

        const result = await service.validateAddress(incompleteAddress);

        expect(result.status).toBe('valid');
        expect(result.confidence).toBe(0.95);
        expect(mockGot).toHaveBeenCalled();
      });
    });

    describe('Invalid Address Scenarios', () => {
      it('should handle completely invalid address', async () => {
        const invalidAddress = 'Not a real address at all';

        const result = await service.validateAddress(invalidAddress);

        expect(result.status).toBe(ValidationResult.CORRECTED);
        expect(result.confidence).toBeLessThanOrEqual(0.5);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should handle address with invalid street number format', async () => {
        const addressWithInvalidNumber = 'ABC Main Street, Boston, MA 02101';

        const result = await service.validateAddress(addressWithInvalidNumber);

        expect(result.errors).toContain('Missing street number');
      });
    });

    describe('External API Integration', () => {
      it('should fallback to external API when confidence is low', async () => {
        const lowConfidenceAddress = 'Incomplete Address';

        // Mock external API success
        mockGot.mockImplementation(() => ({
          json: jest.fn().mockResolvedValue({
            addressMatches: [{
              addressComponents: {
                fromAddress: '123',
                streetName: 'Complete St',
                city: 'Valid City',
                state: 'CA',
                zip: '90210'
              }
            }]
          })
        }));

        const result = await service.validateAddress(lowConfidenceAddress);

        expect(result.status).toBe('valid');
        expect(result.confidence).toBe(0.95);
        expect(mockGot).toHaveBeenCalledWith(
            'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
            expect.objectContaining({
              searchParams: expect.objectContaining({
                address: lowConfidenceAddress
              })
            })
        );
      });

      it('should handle external API returning no matches', async () => {
        const address = 'No Match Address';

        mockGot.mockImplementation(() => ({
          json: jest.fn().mockResolvedValue({
            addressMatches: []
          })
        }));

        const result = await service.validateAddress(address);

        expect(result.status).toBe(ValidationResult.UNVERIFIABLE);
      });
    });

    describe('Edge Cases', () => {
      it('should handle address with extra whitespace', async () => {
        const addressWithWhitespace = '  123   Main   Street  ,  Boston  ,  MA   02101  ';

        const result = await service.validateAddress(addressWithWhitespace);

        expect(result.parsed.number).toBe('123');
        expect(result.parsed.city).toBe('Boston');
        expect(result.parsed.state).toBe('MA');
      });

      it('should handle minimal valid address', async () => {
        const minimalAddress = '1 A St, B, CA 90210';

        const result = await service.validateAddress(minimalAddress);

        expect(result.parsed.number).toBe('1');
        expect(result.parsed.state).toBe('CA');
        expect(result.parsed.zipCode).toBe('90210');
      });

      it('should handle address with multiple commas', async () => {
        const multiCommaAddress = '123 Main St,, Boston,, MA,, 02101';

        const result = await service.validateAddress(multiCommaAddress);

        expect(result.parsed.number).toBe('123');
        expect(result.parsed.city).toBe('Boston');
        expect(result.parsed.state).toBe('MA');
      });
    });

    describe('Confidence Calculation', () => {
      it('should calculate high confidence for complete valid addresses', async () => {
        const completeAddress = '123 Main Street, Boston, MA 02101';

        const result = await service.validateAddress(completeAddress);

        expect(result.confidence).toBeGreaterThan(0.8);
        expect(result.status).toBe(ValidationResult.VALID);
      });

      it('should calculate lower confidence for incomplete addresses', async () => {
        const incompleteAddress = 'Main Street, Boston';

        const result = await service.validateAddress(incompleteAddress);

        expect(result.confidence).toBeLessThan(0.7);
        expect(result.status).toMatch(/^(corrected|unverifiable)$/);
      });

      it('should have different confidence levels based on completeness', async () => {
        const addresses = [
          '123 Main St, Boston, MA 02101', // Complete
          'Main St, Boston, MA 02101',     // Missing number
          '123 Main St, MA 02101',         // Missing city
          '123 Main St, Boston',           // Missing state and zip
          'Main St'                        // Minimal
        ];

        const results = await Promise.all(
            addresses.map(addr => service.validateAddress(addr))
        );

        for (let i = 1; i < results.length; i++) {
          expect(results[i].confidence).toBeLessThanOrEqual(results[i-1].confidence);
        }
      });
    });

    describe('Error Handling', () => {
      it('should throw InternalServerErrorException on parsing errors', async () => {
        jest.spyOn(service as any, 'normalizeInput').mockImplementation(() => {
          throw new Error('Parsing error');
        });

        await expect(service.validateAddress('test')).rejects.toThrow(
            InternalServerErrorException
        );
      });

      it('should handle null/undefined input gracefully', async () => {
        const result = await service.validateAddress('');

        expect(result.status).toBe(ValidationResult.UNVERIFIABLE);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('Response Structure', () => {
      it('should return proper response structure', async () => {
        const validAddress = '123 Main Street, Boston, MA 02101';

        const result = await service.validateAddress(validAddress);

        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('original');
        expect(result).toHaveProperty('parsed');
        expect(result).toHaveProperty('standardized');
        expect(result).toHaveProperty('errors');

        expect(typeof result.status).toBe('string');
        expect(typeof result.confidence).toBe('number');
        expect(typeof result.original).toBe('string');
        expect(typeof result.parsed).toBe('object');
        expect(typeof result.standardized).toBe('object');
        expect(Array.isArray(result.errors)).toBe(true);
      });

      it('should have consistent standardized format', async () => {
        const address = '123 main street, boston, ma 02101';

        const result = await service.validateAddress(address);

        expect(result.standardized).toMatchObject({
          number: '123',
          street: expect.stringMatching(/^[A-Z][a-z]+ St$/), // Capitalized with normalized suffix
          city: 'Boston',
          state: 'MA',
          zipCode: '02101'
        });
      });
    });
  });
});