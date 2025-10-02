import { InternalServerErrorException, Logger} from '@nestjs/common';
import got from 'got';
import {ParsedAddress, ValidatedAddress, ValidationResult} from "./types";

export class AddressValidatorService {
  private readonly logger = new Logger(AddressValidatorService.name);

  private statesTrie: Map<string, string>;
  private stateAbbreviations: Set<string>;
  private streetSuffixes: Map<string, string>;

  constructor() {
    this.initializeStateMaps();
  }

  private initializeStateMaps() {
    this.stateAbbreviations = new Set([
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
    ]);

    this.streetSuffixes = new Map([
      ['street', 'St'], ['st', 'St'], ['str', 'St'],
      ['avenue', 'Ave'], ['ave', 'Ave'], ['av', 'Ave'],
      ['road', 'Rd'], ['rd', 'Rd'],
      ['drive', 'Dr'], ['dr', 'Dr'], ['drv', 'Dr'],
      ['lane', 'Ln'], ['ln', 'Ln'],
      ['court', 'Ct'], ['ct', 'Ct'],
      ['boulevard', 'Blvd'], ['blvd', 'Blvd'], ['blv', 'Blvd'],
      ['circle', 'Cir'], ['cir', 'Cir'],
      ['way', 'Way'], ['terrace', 'Ter'], ['ter', 'Ter'],
      ['place', 'Pl'], ['pl', 'Pl'],
      ['parkway', 'Pkwy'], ['pkwy', 'Pkwy'],
      ['highway', 'Hwy'], ['hwy', 'Hwy'],
    ]);

    this.statesTrie = new Map([
      ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'],
      ['california', 'CA'], ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'],
      ['florida', 'FL'], ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'],
      ['illinois', 'IL'], ['indiana', 'IN'], ['iowa', 'IA'], ['kansas', 'KS'],
      ['kentucky', 'KY'], ['louisiana', 'LA'], ['maine', 'ME'], ['maryland', 'MD'],
      ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'], ['mississippi', 'MS'],
      ['missouri', 'MO'], ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'],
      ['new hampshire', 'NH'], ['new jersey', 'NJ'], ['new mexico', 'NM'], ['new york', 'NY'],
      ['north carolina', 'NC'], ['north dakota', 'ND'], ['ohio', 'OH'], ['oklahoma', 'OK'],
      ['oregon', 'OR'], ['pennsylvania', 'PA'], ['rhode island', 'RI'], ['south carolina', 'SC'],
      ['south dakota', 'SD'], ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'],
      ['vermont', 'VT'], ['virginia', 'VA'], ['washington', 'WA'], ['west virginia', 'WV'],
      ['wisconsin', 'WI'], ['wyoming', 'WY'], ['district of columbia', 'DC']
    ]);
  }

  async validateAddress(address: string): Promise<ValidatedAddress> {
    let confidence, parsed, normalized;
    try {
      normalized = this.normalizeInput(address);
      parsed = this.parseAddress(normalized);
      confidence = this.calculateConfidence(parsed);
    } catch (error){
      this.logger.warn(`Internal validation failed: ${error.message}`);
      throw new InternalServerErrorException('Occurred an error trying to validate the address, Please contact the support.')
    }

    const hasAllRequiredComponents = parsed.number && parsed.street && parsed.city && 
                                   parsed.state && this.stateAbbreviations.has(parsed.state) && 
                                   parsed.zipCode && /^\d{5}(-\d{4})?$/.test(parsed.zipCode);

    if (confidence < 0.7 || !hasAllRequiredComponents) {
      try {
        const result = await this.validateWithExternalAPI(address);
        if(result !== null)
          return result;
      } catch (error) {
        this.logger.warn(`External validation failed: ${error.message}`);
      }
    }

    return {
      status: confidence >= 0.6 ? ValidationResult.VALID : confidence >= 0.5 ? ValidationResult.CORRECTED : ValidationResult.UNVERIFIABLE,
      confidence,
      original: address,
      parsed,
      standardized: this.standardizeAddress(parsed),
      errors: this.getValidationErrors(parsed)
    };
  }

  private normalizeInput(address: string): string {
    return address
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[,]+/g, ',')
        .replace(/\s*,\s*/g, ', ');
  }

  private parseAddress(address: string): ParsedAddress {
    const parsed: ParsedAddress = {};
    const parts = address.split(',').map(p => p.trim());

    if (parts.length === 1) {
      return this.parseSingleLineAddress(address);
    }

    const streetRegexPattern = /^(\d+[a-zA-Z]?)\s+(.+?)(?:\s+(#|apt|unit|ste|suite)\s*(.+))?$/i;

    if (parts.length >= 3) {
      const streetPart = parts[0];
      const cityPart = parts[1];
      const stateZipPart = parts[2];


      const streetMatch = streetPart.match(streetRegexPattern);
      if (streetMatch) {
        parsed.number = streetMatch[1];
        parsed.street = this.normalizeStreet(streetMatch[2]);
        if (streetMatch[4]) {
          parsed.unit = streetMatch[4];
        }
      } else {
        parsed.street = this.normalizeStreet(streetPart);
      }

      parsed.city = this.normalizeCity(cityPart);
      const stateZip = this.parseStateZip(stateZipPart);
      parsed.state = stateZip.state;
      parsed.zipCode = stateZip.zip;
    } else if (parts.length === 2) {
      const streetPart = parts[0];
      const cityStateZipPart = parts[1];

      const streetMatch = streetPart.match(streetRegexPattern);
      if (streetMatch) {
        parsed.number = streetMatch[1];
        parsed.street = this.normalizeStreet(streetMatch[2]);
        if (streetMatch[4]) {
          parsed.unit = streetMatch[4];
        }
      } else {
        parsed.street = this.normalizeStreet(streetPart);
      }

      const cityStateZip = this.parseCityStateZip(cityStateZipPart);
      parsed.city = cityStateZip.city;
      parsed.state = cityStateZip.state;
      parsed.zipCode = cityStateZip.zip;
    }

    return parsed;
  }

  private parseSingleLineAddress(address: string): ParsedAddress {
    const parsed: ParsedAddress = {};
    let remainingAddress = address;

    const zipMatch = remainingAddress.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch) {
      parsed.zipCode = zipMatch[1];
      remainingAddress = remainingAddress.replace(zipMatch[0], '').trim();
    }

    const stateMatch = remainingAddress.match(/\b([A-Z]{2})\b(?!\d)/);
    if (stateMatch && this.stateAbbreviations.has(stateMatch[1])) {
      parsed.state = stateMatch[1];
      remainingAddress = remainingAddress.replace(stateMatch[0], '').trim();
    } else {
      const lowerAddress = remainingAddress.toLowerCase();
      for (const [stateName, abbr] of this.statesTrie) {
        const idx = lowerAddress.lastIndexOf(stateName);
        if (idx !== -1 && idx + stateName.length <= lowerAddress.length) {
          parsed.state = abbr;
          remainingAddress = remainingAddress.substring(0, idx) + 
                           remainingAddress.substring(idx + stateName.length);
          remainingAddress = remainingAddress.replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }

    const streetMatch = remainingAddress.match(/^(\d+[a-zA-Z]?)\s+(.+?)(?:\s+(?:#|apt|unit|ste|suite)\s*(.+?))?$/i);
    if (streetMatch) {
      parsed.number = streetMatch[1];
      let streetAndCity = streetMatch[2];
      
      if (streetMatch[3]) {
        parsed.unit = streetMatch[3];
      }

      const words = streetAndCity.split(/\s+/);
      if (words.length > 2) {
        const possibleCity = words.slice(-2).join(' ');
        const possibleStreet = words.slice(0, -2).join(' ');

        const streetWords = possibleStreet.toLowerCase().split(/\s+/);
        const lastStreetWord = streetWords[streetWords.length - 1];
        
        if (this.streetSuffixes.has(lastStreetWord) || possibleStreet.length > 3) {
          parsed.city = this.normalizeCity(possibleCity);
          parsed.street = this.normalizeStreet(possibleStreet);
        } else {
          parsed.street = this.normalizeStreet(streetAndCity);
        }
      } else {
        parsed.street = this.normalizeStreet(streetAndCity);
      }
    } else {
      const words = remainingAddress.split(/\s+/);
      if (words.length > 2) {
        parsed.city = this.normalizeCity(words.slice(-2).join(' '));
        parsed.street = this.normalizeStreet(words.slice(0, -2).join(' '));
      } else {
        parsed.street = this.normalizeStreet(remainingAddress);
      }
    }
    return parsed;
  }

  private parseStateZip(part: string): { state?: string; zip?: string } {
    const result: { state?: string; zip?: string } = {};
    const match = part.match(/([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/);
    if (match && this.stateAbbreviations.has(match[1])) {
      result.state = match[1];
      result.zip = match[2];
      return result;
    }

    const lowerPart = part.toLowerCase();
    for (const [stateName, abbr] of this.statesTrie) {
      if (lowerPart.includes(stateName)) {
        result.state = abbr;
        const remaining = part.replace(new RegExp(stateName, 'i'), '').trim();
        const zipMatch = remaining.match(/(\d{5}(?:-\d{4})?)/);
        if (zipMatch) {
          result.zip = zipMatch[1];
        }
        break;
      }
    }

    if (!result.state && !result.zip) {
      const zipMatch = part.match(/(\d{5}(?:-\d{4})?)/);
      if (zipMatch) {
        result.zip = zipMatch[1];
      }

      const stateMatch = part.match(/\b([A-Z]{2})\b/);
      if (stateMatch && this.stateAbbreviations.has(stateMatch[1])) {
        result.state = stateMatch[1];
      }
    }
    return result;
  }

  private parseCityStateZip(part: string): { city?: string; state?: string; zip?: string } {
    const result: { city?: string; state?: string; zip?: string } = {};
    let remainingPart = part;

    const zipMatch = remainingPart.match(/(\d{5}(?:-\d{4})?)/);
    if (zipMatch) {
      result.zip = zipMatch[1];
      remainingPart = remainingPart.replace(zipMatch[0], '').trim();
    }

    const stateMatch = remainingPart.match(/\b([A-Z]{2})\b/);
    if (stateMatch && this.stateAbbreviations.has(stateMatch[1])) {
      result.state = stateMatch[1];
      remainingPart = remainingPart.replace(stateMatch[0], '').trim();
    } else {
      const lowerPart = remainingPart.toLowerCase();
      for (const [stateName, abbr] of this.statesTrie) {
        if (lowerPart.includes(stateName)) {
          result.state = abbr;
          remainingPart = remainingPart.replace(new RegExp(stateName, 'i'), '').trim();
          break;
        }
      }
    }

    if (remainingPart) {
      result.city = this.normalizeCity(remainingPart);
    }
    return result;
  }

  private normalizeStreet(street: string): string {
    const words = street.toLowerCase().split(/\s+/);
    const lastWord = words[words.length - 1];

    if (this.streetSuffixes.has(lastWord)) {
      words[words.length - 1] = this.streetSuffixes.get(lastWord);
    }

    return words.map((w, i) =>
        i === words.length - 1 ? w : w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
  }

  private normalizeCity(city: string): string {
    return city.split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
  }

  private standardizeAddress(parsed: ParsedAddress): ParsedAddress {
    return {
      number: parsed.number,
      street: parsed.street,
      unit: parsed.unit,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode
    };
  }

  private calculateConfidence(parsed: ParsedAddress): number {
    let score = 0;
    let maxScore = 6;

    if (parsed.number && /^\d+[a-zA-Z]?$/.test(parsed.number)) score += 1;
    if (parsed.street && parsed.street.length > 2) score += 1.5;
    if (parsed.city && parsed.city.length > 2) score += 1.5;
    if (parsed.state && this.stateAbbreviations.has(parsed.state)) score += 1;
    if (parsed.zipCode && /^\d{5}(-\d{4})?$/.test(parsed.zipCode)) score += 1;

    return Math.min(score / maxScore, 1);
  }

  private getValidationErrors(parsed: ParsedAddress): string[] {
    const errors: string[] = [];

    if (!parsed.number) {
      errors.push('Missing street number');
    } else if (!/^\d+[a-zA-Z]?$/.test(parsed.number)) {
      errors.push('Invalid street number format');
    }

    if (!parsed.street) {
      errors.push('Missing street name');
    } else if (parsed.street.length < 3) {
      errors.push('Street name too short');
    }

    if (!parsed.city) {
      errors.push('Missing city');
    } else if (parsed.city.length < 2) {
      errors.push('City name too short');
    }

    if (!parsed.state) {
      errors.push('Missing state');
    } else if (!this.stateAbbreviations.has(parsed.state)) {
      errors.push('Invalid state code');
    }

    if (!parsed.zipCode) {
      errors.push('Missing ZIP code');
    } else if (!/^\d{5}(-\d{4})?$/.test(parsed.zipCode)) {
      errors.push('Invalid ZIP code format');
    }

    return errors;
  }

  private async validateWithExternalAPI(address: string): Promise<ValidatedAddress> {
    try {
      const response = await got('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress', {
        searchParams: {
          address: address,
          benchmark: 'Public_AR_Current',
          format: 'json'
        },
        timeout: {
          request: 2000
        },
        retry: {
          limit: 3,
          methods: ['GET']
        }
      }).json<any>();

      if (response?.addressMatches?.length > 0) {
        const match = response.addressMatches[0];
        const parsed: ParsedAddress = {
          number: match.addressComponents.fromAddress,
          street: match.addressComponents.streetName,
          city: match.addressComponents.city,
          state: match.addressComponents.state,
          zipCode: match.addressComponents.zip
        };

        return {
          status: 'valid',
          confidence: 0.95,
          original: address,
          parsed,
          standardized: parsed,
          errors: []
        };
      }
    } catch (error) {
      this.logger.error(`External API geocoding error: ${error.message}`);
    }

    return null;
  }
}