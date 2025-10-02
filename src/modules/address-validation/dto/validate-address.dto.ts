import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ValidateAddressDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    address: string;
}
