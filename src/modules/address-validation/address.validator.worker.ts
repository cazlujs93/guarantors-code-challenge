import { AddressValidatorService } from "./address.validator.service";
const service = new AddressValidatorService();
const addressValidator = service.validateAddress.bind(service);
export default function worker(address: string) {
    return addressValidator(address);
}