export interface ParsedAddress {
    number?: string;
    street?: string;
    unit?: string;
    city?: string;
    state?: string;
    zipCode?: string;
}

export interface ValidatedAddress {
    status: 'valid' | 'corrected' | 'unverifiable';
    confidence: number;
    original: string;
    parsed: ParsedAddress;
    standardized?: ParsedAddress;
    suggestions?: ParsedAddress[];
    errors?: string[];
}

export enum ValidationResult {
    VALID = 'valid',
    CORRECTED = 'corrected',
    UNVERIFIABLE = 'unverifiable'
}