import { Module } from '@nestjs/common';
import {AddressValidatorController } from './modules/address-validation/address.validator.controller';

@Module({
  imports: [],
  controllers: [AddressValidatorController],
  providers: [],
})
export class AppModule {}
